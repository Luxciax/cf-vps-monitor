import assert from 'node:assert/strict';
import test from 'node:test';
import { Readable, Writable } from 'node:stream';
import { apiTarget, cvmRequest } from './lib/cvm-api.mjs';
import { createMcpServer, runStdio, buildTools } from './cvm-mcp.mjs';

const initialize = {jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'test-client',version:'1'}}};

test('MCP session negotiates, lists actual tools and reports scoped API data as untrusted', async()=>{
  const calls=[];
  const dispatch=createMcpServer({env:{},request:async(path,options)=>{calls.push({path,options});return {asset:{name:'untrusted content'}};}});
  assert.equal((await dispatch({jsonrpc:'2.0',id:0,method:'tools/list'})).error.code,-32002);
  assert.equal((await dispatch(initialize)).result.protocolVersion,'2025-11-25');
  assert.equal(await dispatch({jsonrpc:'2.0',method:'notifications/initialized'}),undefined);
  const list=await dispatch({jsonrpc:'2.0',id:2,method:'tools/list'});
  assert.equal(list.result.tools.some(t=>t.name==='cvm_report_operation'),false);
  const id='29f04741-2cd7-4d62-9e63-371209ffdb74';
  const result=await dispatch({jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'cvm_asset_context',arguments:{id,fields:['configuration'],limit:5}}});
  assert.equal(calls[0].path,`/assets/${id}/context?fields=configuration&limit=5`);
  assert.equal(JSON.parse(result.result.content[0].text).trust.execution_authority,'none');
  assert.equal((await dispatch({jsonrpc:'2.0',id:4,method:'tools/call',params:{name:'cvm_assets',arguments:{limit:100000}}})).error.code,-32602);
});

test('MCP writable operations record claims with explicit enablement and never expose executors', async()=>{
  const definitions=buildTools(true);
  assert.ok(definitions.some(t=>t.name==='cvm_report_operation'));
  assert.equal(definitions.some(t=>/exec|shell|ssh/.test(t.name)),false);
  const report=definitions.find(t=>t.name==='cvm_report_operation');
  assert.equal(report.path({}),'/operations');
  assert.deepEqual(report.body({record:{summary:'external claim'}}),{summary:'external claim'});
});

test('stdio emits only newline JSON-RPC and survives parse errors', async()=>{
  const lines=[initialize,{jsonrpc:'2.0',method:'notifications/initialized'},{jsonrpc:'2.0',id:2,method:'tools/list'}];
  let output='';
  await runStdio(Readable.from(['broken\n',...lines.map(item=>JSON.stringify(item)+'\n')]),new Writable({write(chunk,_encoding,done){output+=chunk;done();}}),{env:{}});
  const parsed=output.trim().split('\n').map(line=>JSON.parse(line));
  assert.equal(parsed[0].error.code,-32700);
  assert.equal(parsed[1].result.serverInfo.name,'cvm-infrastructure');
  assert.ok(parsed[2].result.tools.length>=9);
});

test('API client rejects token-exfiltration paths, cross-origin redirects and unbounded output', async()=>{
  for(const path of ['/api/v1/../../admin','/api/v1/%2e%2e/%2e%2e/admin','/api/v1/assets#fragment'])assert.throws(()=>apiTarget('https://panel.example',path));
  assert.throws(()=>apiTarget('http://external.example','/assets'));
  assert.throws(()=>apiTarget('https://u:p@external.example','/assets'));
  const env={CFVM_URL:'https://panel.example',CFVM_TOKEN:'x'.repeat(64)};
  await assert.rejects(cvmRequest('/assets',{env,fetcher:async(_url,options)=>{assert.equal(options.redirect,'error');return Response.json({x:'a'.repeat(1048576)});}}),/exceeds/);
});
