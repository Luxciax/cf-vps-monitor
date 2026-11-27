import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { createWorkerLoader } from '../../test-support/worker-module.mjs';

const { Hono } = createRequire(new URL('../../package.json', import.meta.url))('hono');
const asset = { id:'9249139a-3e89-4c39-a67d-a83a5de8fcc7', kind:'vps' };

test('discovery configuration and history cleanup require their own write scopes before database access', async () => {
  const calls=[];
  const loader=createWorkerLoader({overrides:{'worker/src/db/supabase-api/client.ts':{callSupabaseRpc:async(...args)=>{calls.push(args);return {success:true};}}}});
  const {infrastructureRoutes}=loader.load('worker/src/routes/infrastructure.ts');
  const app=new Hono();app.use('*',async(c,next)=>{c.set('machineScopes',['assets:write','discovery:write']);c.set('username','scope-fixture');await next();});app.route('/api/v1',infrastructureRoutes);
  const report={source:'test',schema_version:1,collected_at:new Date().toISOString(),complete:false,collectors:[],assets:[],configuration:{system:{status:'unknown'}}};
  assert.equal((await app.request('https://fixture/api/v1/discovery/reports',{method:'POST',body:JSON.stringify(report)})).status,403);
  assert.equal((await app.request('https://fixture/api/v1/infrastructure/cleanup',{method:'POST'})).status,403);
  assert.equal(calls.length,0);
});

test('baseline results preserve reported evidence and cannot turn disabled or future collection into compliance', () => {
  const {evaluateBaseline}=createWorkerLoader().load('worker/src/infra/baselines.ts');
  const now=new Date('2026-11-27T12:00:00Z');
  const baseline={id:'5034c97b-5114-4a69-b926-104b745d6ab3',version:1,asset_kinds:[],environments:[],max_age_hours:48,exceptions:[],rules:[{id:'config',path:'ssh.value',operator:'exists',severity:'info',description:'Evidence available'}]};
  const snapshot={id:'d3b6effd-d4bf-4b4f-9b28-c752def7ad26',source:'harness:fixture',environment:'linux',confidence:'reported',collected_at:now.toISOString(),data:{ssh:{status:'disabled',value:null}}};
  assert.equal(evaluateBaseline(baseline,asset,snapshot,now).status,'unknown');
  assert.equal(evaluateBaseline(baseline,asset,{...snapshot,data:{ssh:{status:'partial',value:{key:'present'}}}},now).status,'unknown');
  const report=evaluateBaseline(baseline,asset,{...snapshot,data:{ssh:{status:'available',value:{enabled:true}}}},now);
  assert.equal(report.status,'compliant');assert.equal(report.results[0].evidence.confidence,'reported');
  assert.equal(evaluateBaseline(baseline,asset,{...snapshot,collected_at:'2030-01-01T00:00:00Z'},now).status,'unknown');
  const objectRule={...baseline,rules:[{...baseline.rules[0],operator:'eq',expected:{b:2,a:1}}]};
  assert.equal(evaluateBaseline(objectRule,asset,{...snapshot,data:{ssh:{status:'available',value:{a:1,b:2}}}},now).status,'compliant');
});

test('inventory rejects mixed-case credentials, embedded token URLs and credential-bearing descriptions', () => {
  const {safeData,assetInput}=createWorkerLoader().load('worker/src/infra/validation.ts');
  for(const key of ['token','apiToken','access-token','db_password','privateKey','DATABASE_URL','rawConfig'])
    assert.throws(()=>safeData({[key]:'sensitive-value'}),/not permitted/);
  assert.throws(()=>assetInput({kind:'website',name:'Unsafe',url:'https://example.com/?apiToken=secret'}),/authentication query/);
  assert.throws(()=>assetInput({kind:'service',name:'Unsafe',description:'bearer abcdefghijklmnop'}),/Credentials/);
  assert.deepEqual(safeData({ssh:{passwordauthentication:'no'},configuration_path:'/etc/ssh/sshd_config'}),{ssh:{passwordauthentication:'no'},configuration_path:'/etc/ssh/sshd_config'});
});

test('asset context budgets actual UTF-8 output and marks truncated sections without losing its identity', async () => {
  const records=Array.from({length:12},(_,i)=>({id:String(i),content:'安全配置资料'.repeat(120)}));
  const loader=createWorkerLoader({overrides:{'worker/src/db/supabase-api/client.ts':{callSupabaseRpc:async(_env,_name,p)=>p.p_operation==='assets.get'?{...asset,name:'测试资产'}:p.p_operation==='documents.applicable'?records.map(r=>({...r})):{data:records.map(r=>({...r})),total:12,limit:20,offset:0}}}});
  const {assetContext}=loader.load('worker/src/infra/service.ts');
  const result=await assetContext({},asset.id,{fields:'asset,documents,configuration',limit:20,max_bytes:4096},['assets:read','knowledge:read','config:read']);
  assert.equal(result.asset.id,asset.id);
  assert.ok(new TextEncoder().encode(JSON.stringify(result)).length<=4096);
  assert.ok(result.limits.truncated_sections.length>0);
  assert.equal(result.trust.execution_authority,'none');
});
