import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { createWorkerLoader } from '../../test-support/worker-module.mjs';
import { createTestDatabase, rpc } from '../../../scripts/test-support/postgres.mjs';
import { authorizeAdminApiRequest, machineTokenDigest } from './admin-api-token.ts';

const RAW = 'cvm_' + '3'.repeat(64);
const token = { id: '0877f163-dda8-4351-a61f-771a1fcd53a3', name: 'reader', scopes: ['assets:read'], expires_at: null, revoked_at: null };
const auth = (path, method = 'GET', record = token) => authorizeAdminApiRequest({ authorization: `Bearer ${RAW}`, env: {}, method, pathname: '/api/v1' + path, lookupToken: async digest => { assert.equal(digest, await machineTokenDigest(RAW)); return record; } });

test('independent tokens isolate scopes and revoke or expire without a cache', async () => {
  assert.equal((await auth('/assets')).ok, true);
  assert.equal((await auth('/capabilities')).ok, true);
  assert.equal((await auth('/documents')).reason, 'insufficient_scope');
  assert.equal((await auth('/assets', 'POST')).reason, 'insufficient_scope');
  assert.equal((await auth('/account/machine-tokens', 'POST', { ...token, scopes: ['read','write','backup','restore'] })).reason, 'forbidden');
  assert.equal((await auth('/assets', 'GET', { ...token, revoked_at: new Date().toISOString() })).reason, 'invalid');
  assert.equal((await auth('/assets', 'GET', { ...token, expires_at: '2000-01-01T00:00:00Z' })).reason, 'invalid');
  assert.equal((await auth('/assets', 'GET', { ...token, expires_at: 'broken' })).reason, 'invalid');
});

test('recovery is opt-in, rotates independently, and ignores database credentials', async () => {
  const loader = createWorkerLoader();
  const { adminRecoveryEnabled, authorizeAdminRecovery } = loader.load('worker/src/auth/admin-recovery.ts');
  const env = { ADMIN_RECOVERY_ENABLED: 'true', ADMIN_RECOVERY_TOKEN: 'a'.repeat(64), SUPABASE_SECRET_KEY: 'sb_secret_database_key' };
  assert.equal(adminRecoveryEnabled({}), false);
  assert.equal(adminRecoveryEnabled({ ADMIN_RECOVERY_TOKEN: env.ADMIN_RECOVERY_TOKEN }), false);
  assert.equal(await authorizeAdminRecovery(env, env.SUPABASE_SECRET_KEY), false);
  assert.equal(await authorizeAdminRecovery(env, env.ADMIN_RECOVERY_TOKEN), true);
  assert.equal(await authorizeAdminRecovery({ ...env, ADMIN_RECOVERY_TOKEN: 'b'.repeat(64) }, env.ADMIN_RECOVERY_TOKEN), false);
});

test('token RPC persists hashes, bounds privileges, audits lifecycle and is closed to public roles', async () => {
  const database = await createTestDatabase();
  try {
    const create = { ...token, token_hash: await machineTokenDigest(RAW), prefix: RAW.slice(0,12) };
    await database.exec('set role service_role');
    const created = await rpc(database, 'cfm_machine_tokens', { input_operation: 'create', input_payload: create, input_actor: 'admin' });
    assert.equal(created.name, 'reader');
    assert.equal(created.token_hash, undefined);
    assert.equal((await rpc(database, 'cfm_machine_tokens', { input_operation: 'authenticate', input_payload: { token_hash: create.token_hash } })).id, token.id);
    assert.equal((await rpc(database, 'cfm_machine_tokens', { input_operation: 'list' }))[0].token_hash, undefined);
    const rotatedHash = await machineTokenDigest('cvm_' + '4'.repeat(64));
    const rotated = await rpc(database, 'cfm_machine_tokens', { input_operation: 'rotate', input_payload: { id: token.id, token_hash: rotatedHash, prefix: 'cvm_44444444' }, input_actor: 'admin' });
    assert.equal(rotated.id, token.id);
    assert.equal(rotated.token_hash, undefined);
    assert.equal(await rpc(database, 'cfm_machine_tokens', { input_operation: 'authenticate', input_payload: { token_hash: create.token_hash } }), null);
    assert.equal((await rpc(database, 'cfm_machine_tokens', { input_operation: 'authenticate', input_payload: { token_hash: rotatedHash } })).id, token.id);
    await rpc(database, 'cfm_machine_tokens', { input_operation: 'revoke', input_payload: { id: token.id }, input_actor: 'admin' });
    assert.equal(await rpc(database, 'cfm_machine_tokens', { input_operation: 'authenticate', input_payload: { token_hash: rotatedHash } }), null);
    assert.equal(await rpc(database, 'cfm_machine_tokens', { input_operation: 'rotate', input_payload: { id: token.id, token_hash: create.token_hash, prefix: create.prefix }, input_actor: 'admin' }), null);
    await assert.rejects(rpc(database, 'cfm_machine_tokens', { input_operation: 'create', input_payload: { ...create, scopes: ['shell:execute'] } }), /Invalid token scopes/);
    const audits = (await database.query("select action, detail from audit_logs where action like 'machine_token_%'")).rows;
    assert.equal(audits.length, 5);
    assert.equal(JSON.stringify(audits).includes(create.token_hash), false);
    await database.exec('reset role; set role anon');
    await assert.rejects(database.query('select * from public.machine_tokens'), /permission denied/);
    await assert.rejects(rpc(database, 'cfm_machine_tokens', { input_operation: 'list' }), /permission denied/);
    await database.exec('reset role; set role service_role');
    const {Hono}=createRequire(new URL('../../package.json',import.meta.url))('hono');
    const loader=createWorkerLoader({overrides:{'worker/src/db/supabase-api/client.ts':{callSupabaseRpc:(_env,name,args)=>rpc(database,name,args)}}});
    const app=new Hono();app.use('*',async(c,next)=>{c.set('username','human-fixture');await next();});
    app.route('/api/admin/account/machine-tokens',loader.load('worker/src/auth/machine-tokens.ts').machineTokenAdminRoutes);
    const createdResponse=await app.request('https://fixture/api/admin/account/machine-tokens',{method:'POST',body:JSON.stringify({name:'HTTP token',scopes:['knowledge:read']})},{});
    assert.equal(createdResponse.status,201);
    const issued=await createdResponse.json();assert.match(issued.token,/^cvm_[a-f0-9]{64}$/);
    const list=await (await app.request('https://fixture/api/admin/account/machine-tokens',{},{})).json();
    assert.equal(JSON.stringify(list).includes(issued.token),false);
    assert.equal(list.tokens.find(t=>t.id===issued.record.id).token_hash,undefined);
    const renewed=await (await app.request(`https://fixture/api/admin/account/machine-tokens/${issued.record.id}/rotate`,{method:'POST'},{})).json();
    assert.equal(renewed.record.id,issued.record.id);assert.notEqual(renewed.token,issued.token);
    assert.equal(await rpc(database,'cfm_machine_tokens',{input_operation:'authenticate',input_payload:{token_hash:await machineTokenDigest(issued.token)}}),null);
  } finally { await database.close(); }
});

test('proxy fails closed, uses a reviewed RPC allowlist and bounds request streams', async () => {
  const loader = createWorkerLoader();
  const { createProxyHandler } = loader.load('supabase/functions/cfvm-db-proxy/index.ts');
  const proxyToken = 'p'.repeat(64);
  const env = { CFVM_PROXY_TOKEN_SHA256: await machineTokenDigest(proxyToken), SUPABASE_URL: 'https://test-project.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-role' };
  const calls = [];
  const handler = createProxyHandler({ get: name => env[name] }, async (url, options) => { calls.push({url,options}); return Response.json({ ok: true }); });
  const request = body => new Request('https://proxy.example', { method: 'POST', headers: { 'x-cfvm-proxy-token': proxyToken }, body: JSON.stringify(body) });
  assert.equal((await handler(request({ kind: 'rpc', functionName: 'cfm_infra', body: { p_operation: 'assets.list' } }))).status, 200);
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal((await handler(request({ kind: 'rpc', functionName: 'cfm_execute_arbitrary_sql' }))).status, 403);
  assert.equal((await handler(request({ kind: 'table', path: 'users?select=*' }))).status, 403);
  assert.equal((await handler(request({ kind: 'rpc', functionName: 'cfm_infra', body: { too_large: 'x'.repeat(6 * 1024 * 1024) } }))).status, 413);
  env.CFVM_PROXY_TOKEN_SHA256 = '';
  assert.equal((await handler(request({ kind: 'rpc', functionName: 'cfm_infra' }))).status, 503);
});

test('unscoped administrator settings never reveal notification credentials', () => {
  const { adminSettingsResponse } = createWorkerLoader().load('worker/src/auth/settings-response.ts');
  const result = adminSettingsResponse({site_title:'CVM',telegram_bot_token:'synthetic-bot-secret-value',email_smtp_password:'mail-password',webhook_url:'https://hook.example/?token=secret',webhook_headers_json:'{"Authorization":"Bearer secret"}'});
  assert.equal(result.site_title,'CVM');
  for(const key of ['telegram_bot_token','email_smtp_password','webhook_url','webhook_headers_json'])assert.equal(result[key],undefined);
  assert.equal(result.telegram_bot_token_set,'true');
  assert.equal(JSON.stringify(result).includes('synthetic-bot-secret-value'),false);
});
