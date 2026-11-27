import test from 'node:test';
import assert from 'node:assert/strict';
import { checkWebsiteContent, parseWebsiteCheckConfig, readBoundedMonitorBody, normalizeWebsiteCheckDetails, shouldNotifyCertificateExpiry } from './website-check-config.ts';
import { checkWebsiteMonitorHttp, isWebsiteCheckDue, shouldNotifyWebsiteDown, validateWebsiteMonitorInput } from './website-monitor.ts';
import { analyzeWebsiteChecks } from './website-statistics.ts';

const base = { id:1,config_revision:'v1',url:'https://example.com',method:'GET',timeout_sec:1,expected_status_min:200,expected_status_max:399 };
test('configuration rejects arbitrary expressions and incompatible content checks',()=>{
 assert.equal(parseWebsiteCheckConfig({json_path:'__proto__.password',json_equals:'x'}).ok,false);
 assert.equal(parseWebsiteCheckConfig({remote_command:'id'}).ok,false);
 assert.equal(parseWebsiteCheckConfig({maintenance:[{start:'2026-01-02',end:'2026-01-01'}]}).ok,false);
 assert.equal(validateWebsiteMonitorInput({...base,name:'api',method:'HEAD',check_config:{keyword:'ok'}}).ok,false);
 assert.equal(validateWebsiteMonitorInput({...base,name:'socket',url:'wss://example.com/ws',check_config:{kind:'websocket'}}).value.url,'https://example.com/ws');
 assert.equal(checkWebsiteContent('{"data":{"status":"ok"}}',{json_path:'data.status',json_equals:'ok'}),null);
 assert.equal(checkWebsiteContent('{"status":true}',{json_path:'status',json_equals:'true'}),'json_content_mismatch');
 assert.equal(checkWebsiteContent('{"items":[1,2]}',{json_path:'items.01',json_equals:2}),'json_path_missing');
 assert.equal(checkWebsiteContent('{"items":[1,2]}',{json_path:'items.length',json_equals:2}),'json_path_missing');
});
test('body size limit rejects unbounded streamed responses',async()=>{
 await assert.rejects(()=>readBoundedMonitorBody(new Response('a'.repeat(200)),100),/content_too_large/);
 assert.equal(await readBoundedMonitorBody(new Response('hello'),100),'hello');
});
test('HTTP content mismatch changes actual check status',async()=>{
 const previous=globalThis.fetch;
 globalThis.fetch=async()=>new Response('{"ok":false}',{status:200});
 try{
  const result=await checkWebsiteMonitorHttp({...base,check_config:{json_path:'ok',json_equals:true}});
  assert.equal(result.ok,false);assert.equal(result.effective_reason,'json_content_mismatch');
  assert.equal(result.details.tls_status,'unknown');
 }finally{globalThis.fetch=previous;}
});
test('DNS monitor verifies answer types and expectations',async()=>{
 const previous=globalThis.fetch;
 globalThis.fetch=async(url)=>{assert.equal(new URL(url).hostname,'cloudflare-dns.com');return Response.json({Status:0,Answer:[{type:1,data:'93.184.215.14'},{type:5,data:'alias.example.com.'}]});};
 try{
  const good=await checkWebsiteMonitorHttp({...base,check_config:{kind:'dns',dns_type:'A',dns_expected:['93.184.215.14']}});
  assert.equal(good.ok,true);assert.deepEqual(good.details.dns_answers,['93.184.215.14']);
  const bad=await checkWebsiteMonitorHttp({...base,check_config:{kind:'dns',dns_expected:['93.184.215.15']}});
  assert.equal(bad.ok,false);assert.equal(bad.effective_reason,'dns_answer_mismatch');
 }finally{globalThis.fetch=previous;}
});
test('WebSocket checks close the accepted connection without sending application messages',async()=>{
 const previous=globalThis.fetch;const calls=[];
 globalThis.fetch=async(_url,init)=>{assert.equal(init.headers.Upgrade,'websocket');return {status:101,webSocket:{accept(){calls.push('accept');},close(code){calls.push(code);}}};};
 try{assert.equal((await checkWebsiteMonitorHttp({...base,check_config:{kind:'websocket'}})).ok,true);assert.deepEqual(calls,['accept',1000]);}finally{globalThis.fetch=previous;}
});
test('DNS TXT presentation and IPv6 forms agree across Worker and agent probes',async()=>{
 const previous=globalThis.fetch;
 try{
  globalThis.fetch=async()=>Response.json({Status:0,Answer:[{type:16,data:'"v=spf1 " "include:example.net"'}]});
  const txt=await checkWebsiteMonitorHttp({...base,check_config:{kind:'dns',dns_type:'TXT',dns_expected:['v=spf1 include:example.net']}});
  assert.equal(txt.ok,true);assert.deepEqual(txt.details.dns_answers,['v=spf1 include:example.net']);
  globalThis.fetch=async()=>Response.json({Status:0,Answer:[{type:28,data:'2001:db8::1'}]});
  const ipv6=await checkWebsiteMonitorHttp({...base,check_config:{kind:'dns',dns_type:'AAAA',dns_expected:['2001:db8:0:0:0:0:0:1']}});
  assert.equal(ipv6.ok,true);
  globalThis.fetch=async()=>Response.json({Status:0,Answer:[{type:16,data:'"'+ 'a'.repeat(513) +'"'}]});
  const long=await checkWebsiteMonitorHttp({...base,check_config:{kind:'dns',dns_type:'TXT',dns_expected:['a'.repeat(512)]}});
  assert.equal(long.ok,false,'truncating display evidence must never turn a mismatch into success');
 }finally{globalThis.fetch=previous;}
});
test('maintenance and silence suppress checks/notifications without fabricating success',()=>{
 const config={maintenance:[{start:'2026-01-01T00:00:00Z',end:'2026-01-01T01:00:00Z'}]};
 const now=new Date('2026-01-01T00:30:00Z');
 assert.equal(isWebsiteCheckDue({enabled:true,last_checked_at:null,interval_sec:120,check_config:config},now),false);
 assert.equal(shouldNotifyWebsiteDown({enabled:true,status:'down',last_notified_at:null,down_since:'2026-01-01T00:00:00Z',grace_period_sec:30,check_config:config},now),false);
});
test('availability reports observation gaps and excludes overlapping maintenance',()=>{
 const checks=[{checked_at:'2026-01-01T00:00:00Z',ok:true,latency_ms:10},{checked_at:'2026-01-01T00:01:00Z',ok:false,latency_ms:0},{checked_at:'2026-01-01T00:05:00Z',ok:true,latency_ms:50},{checked_at:'2026-01-01T00:06:00Z',ok:true,latency_ms:100,source_type:'agent',source_client:'node'}];
 const result=analyzeWebsiteChecks(checks,{since:'2026-01-01T00:00:00Z',until:'2026-01-01T00:10:00Z',intervalSec:60,maintenance:[{start:'2026-01-01T00:03:00Z',end:'2026-01-01T00:04:00Z'},{start:'2026-01-01T00:03:30Z',end:'2026-01-01T00:05:00Z'}]});
 assert.equal(result.up_ms,180000);assert.equal(result.down_ms,120000);assert.equal(result.unknown_ms,180000);assert.equal(result.maintenance_ms,120000);
 assert.equal(result.availability_percent,60);assert.equal(result.coverage_percent,62.5);assert.equal(result.p50_ms,10);assert.equal(result.p95_ms,50);assert.equal(result.incidents[0].observation_gap,true);
 const empty=analyzeWebsiteChecks([],{since:'2026-01-01T00:00:00Z',until:'2026-01-01T01:00:00Z',intervalSec:60});assert.equal(empty.availability_percent,null);assert.equal(empty.unknown_ms,3600000);
});
test('certificate reminders require recent measured evidence and deduplicate by certificate expiry',()=>{
 const now=new Date('2026-01-01T00:00:00Z');const expiry='2026-01-10T00:00:00.000Z';
 const input={checked_at:now.toISOString(),details:{tls_expires_at:expiry},check_config:{tls_warning_days:14}};
 assert.equal(shouldNotifyCertificateExpiry(input,now),true);assert.equal(shouldNotifyCertificateExpiry({...input,last_notified_expiry:expiry},now),false);
 assert.equal(shouldNotifyCertificateExpiry({...input,checked_at:'2025-01-01'},now),false);
 assert.deepEqual(normalizeWebsiteCheckDetails({tls_status:'valid',authorization:'secret',dns_answers:['example.com'],tls_days_remaining:Infinity}),{tls_status:'valid',dns_answers:['example.com']});
});
test('statistics never include incidents recovered before the range or maintenance-only samples',()=>{
 const result=analyzeWebsiteChecks([
  {checked_at:'2026-01-01T00:00:00Z',ok:false},
  {checked_at:'2026-01-01T00:00:30Z',ok:true,latency_ms:5},
  {checked_at:'2026-01-01T00:01:30Z',ok:false,latency_ms:1},
  {checked_at:'2026-01-01T00:02:00Z',ok:true,latency_ms:20},
 ],{since:'2026-01-01T00:01:00Z',until:'2026-01-01T00:03:00Z',intervalSec:60,maintenance:[{start:'2026-01-01T00:01:15Z',end:'2026-01-01T00:01:45Z'}]});
 assert.deepEqual(result.incidents,[]);assert.equal(result.samples,1);assert.equal(result.p50_ms,20);
 assert.equal(result.up_ms,75000);assert.equal(result.unknown_ms,15000);assert.equal(result.maintenance_ms,30000);
});
