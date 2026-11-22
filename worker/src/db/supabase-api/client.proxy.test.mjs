import assert from 'node:assert/strict';
import test from 'node:test';

import {
  callSupabaseRpc,
  getSupabaseSettingsByKeys,
  isSupabaseApiConfigured,
} from './client.ts';

const TOKEN = 'p'.repeat(64);
const ENV = {
  SUPABASE_PROXY_URL: 'https://proxyproj.supabase.co/functions/v1/cfvm-db-proxy',
  SUPABASE_PROXY_TOKEN: TOKEN,
};

test('proxy-only configuration is accepted and RPC calls use only the proxy token', async () => {
  assert.equal(isSupabaseApiConfigured(ENV), true);
  const calls = [];
  const result = await callSupabaseRpc(
    ENV,
    'cfm_users_count',
    { sample: true },
    async (url, init = {}) => {
      calls.push({ url: String(url), init });
      return Response.json(3);
    },
  );

  assert.equal(result, 3);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, ENV.SUPABASE_PROXY_URL);
  const headers = new Headers(calls[0].init.headers);
  assert.equal(headers.get('x-cfvm-proxy-token'), TOKEN);
  assert.equal(headers.has('apikey'), false);
  assert.equal(headers.has('authorization'), false);
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    kind: 'rpc',
    functionName: 'cfm_users_count',
    body: { sample: true },
  });
});

test('settings fallback remains functional through the proxy transport', async () => {
  const payloads = [];
  const rows = await getSupabaseSettingsByKeys(
    ENV,
    ['record_enabled'],
    async (_url, init = {}) => {
      const payload = JSON.parse(init.body);
      payloads.push(payload);
      if (payload.kind === 'rpc') {
        return new Response(JSON.stringify({
          code: 'PGRST202',
          message: 'Could not find the function public.cfm_settings_by_keys',
        }), { status: 404, headers: { 'Content-Type': 'application/json' } });
      }
      return Response.json([{ key: 'record_enabled', value: 'true' }]);
    },
  );

  assert.deepEqual(rows, { record_enabled: 'true' });
  assert.equal(payloads.length, 2);
  assert.equal(payloads[0].kind, 'rpc');
  assert.equal(payloads[1].kind, 'table');
  assert.equal(payloads[1].path, 'settings?select=key,value');
  assert.equal(payloads[1].method, 'GET');
});
