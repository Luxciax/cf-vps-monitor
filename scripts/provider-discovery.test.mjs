import assert from 'node:assert/strict';
import test from 'node:test';
import { discoverCloudflare, discoverGithub } from './lib/provider-discovery.mjs';
import { createWorkerLoader } from '../worker/test-support/worker-module.mjs';

const account='a'.repeat(32),zone='b'.repeat(32);

test('Cloudflare collection has stable IDs and relations, omits secrets and marks permission failures',async()=>{
 const calls=[];
 const fetcher=async(url,options)=>{
  assert.equal(options.method,'GET');assert.equal(options.redirect,'error');calls.push(String(url));
  const path=new URL(url).pathname;
  const result=path.endsWith('/zones')?[{id:zone,name:'example.com'}]:path.endsWith('/dns_records')?[{id:'record1',name:'app.example.com',type:'CNAME',content:'project.pages.dev'},{id:'record2',name:'verify.example.com',type:'TXT',content:'secret-verification-do-not-copy'}]:path.endsWith('/workers/scripts')?[{id:'api-worker',bindings:[{type:'secret_text',text:'do-not-copy'}],compatibility_date:'2026-11-01'}]:path.endsWith('/pages/projects')?[{id:'project1',name:'project',domains:['app.example.com'],deployment_configs:{production:{env_vars:{SECRET:{value:'never-copy'}}}},source:{config:{owner:'owner',repo_name:'repo'}}}]:null;
  if(result===null)return new Response('',{status:403});
  return Response.json({success:true,result,result_info:{total_pages:1}});
 };
 const result=await discoverCloudflare({env:{CF_ACCOUNT_ID:account,CF_API_TOKEN:'provider-secret'},fetcher});
 assert.equal(result.complete,false);
 assert.equal(result.collectors.find(x=>x.name==='cloudflare_worker_domains').status,'permission_denied');
 assert.ok(result.assets.some(x=>x.external_id==='cloudflare:dns:record1'));
 assert.equal(result.assets.find(x=>x.external_id==='cloudflare:dns:record1').metadata.platform,'cloudflare');
 assert.equal(result.assets.find(x=>x.kind==='repository').metadata.platform,undefined);
 const serialized=JSON.stringify(result);for(const forbidden of ['provider-secret','do-not-copy','never-copy','secret-verification-do-not-copy'])assert.equal(serialized.includes(forbidden),false);
 assert.ok(result.assets.find(x=>x.kind==='cloudflare_pages').relations.some(x=>x.kind==='depends_on'));
 assert.ok(calls.every(url=>url.startsWith('https://api.cloudflare.com/client/v4/')));
});

test('GitHub repository and deployment discovery includes status but excludes payloads and config secrets',async()=>{
 const fetcher=async(url,options)=>{
  assert.equal(options.method,'GET');
  const path=new URL(url).pathname;
  assert.notEqual(path,'/user','installation tokens with explicit repositories must not require user identity');
  if(path==='/repos/owner/repo')return Response.json({id:9,full_name:'owner/repo',default_branch:'main',private:true});
  if(path.endsWith('/deployments'))return Response.json([{id:7,environment:'production',sha:'a'.repeat(40),payload:{password:'do-not-upload'}}]);
  if(path.endsWith('/statuses'))return Response.json([{state:'success',log_url:'https://host/?token=do-not-upload'}]);
  throw new Error('Unexpected request');
 };
 const result=await discoverGithub({env:{GH_TOKEN:'provider-secret',GITHUB_REPOSITORIES:'owner/repo'},fetcher});
 assert.equal(result.complete,true);
 assert.equal(result.assets.find(x=>x.kind==='deployment').metadata.state,'success');
 assert.equal(JSON.stringify(result).includes('do-not-upload'),false);
 assert.equal(JSON.stringify(result).includes('omit@example.com'),false);
 assert.equal(JSON.stringify(result).includes('provider-secret'),false);
});

test('provider pagination bounds do not claim a complete snapshot',async()=>{
 let calls=0;
 const result=await discoverCloudflare({env:{CF_ACCOUNT_ID:account,CF_API_TOKEN:'provider-secret',CF_ZONE_IDS:zone},fetcher:async(url)=>{
  calls++;
  const path=new URL(url).pathname;
  if(path.endsWith('/zones/'+zone))return Response.json({success:true,result:{id:zone,name:'example.com'}});
  if(path.endsWith('/dns_records'))return Response.json({success:true,result:[{id:'record',name:'example.com',type:'A',content:'1.1.1.1'}],result_info:{cursor:'same-cursor'}});
  return Response.json({success:true,result:[],result_info:{total_pages:1}});
 }});
 assert.equal(result.complete,false);
 assert.equal(result.collectors.find(x=>x.name==='cloudflare_dns').status,'partial');
 assert.ok(calls<10);
 assert.equal(new Set(result.assets.map(x=>x.external_id)).size,result.assets.length);
});

test('long provider identities remain distinct, deterministic and valid across relation targets',async()=>{
 const stem=`${'a'.repeat(60)}.${'b'.repeat(60)}.${'c'.repeat(60)}.${'d'.repeat(50)}`;
 const domains=[`${stem}.one.example`,`${stem}.two.example`];
 const projectId='project-identity-'.repeat(20);
 const fetcher=async(url)=>{
  const path=new URL(url).pathname;
  const result=path.endsWith('/pages/projects')?[{id:projectId,name:'Long-domain project',domains}]:[];
  return Response.json({success:true,result,result_info:{total_pages:1}});
 };
 const options={env:{CF_ACCOUNT_ID:account,CF_API_TOKEN:'provider-secret'},fetcher};
 const report=await discoverCloudflare(options);
 const second=await discoverCloudflare(options);
 const domainAssets=report.assets.filter(asset=>asset.external_id.startsWith('cloudflare:pages-domain:'));
 const project=report.assets.find(asset=>asset.kind==='cloudflare_pages');
 assert.equal(domainAssets.length,2);
 assert.notEqual(domainAssets[0].external_id,domainAssets[1].external_id,'a shared long prefix must not collapse domains');
 assert.deepEqual(domainAssets.map(asset=>asset.metadata.hostname),domains,'bounded display labels must not discard the complete hostname');
 assert.ok(report.assets.every(asset=>asset.external_id.length<=240));
 assert.ok(domainAssets.every(asset=>asset.relations[0].target_external_id===project.external_id));
 assert.deepEqual(report.assets.map(asset=>asset.external_id),second.assets.map(asset=>asset.external_id));
 const {discoveryInput}=createWorkerLoader().load('worker/src/infra/validation.ts');
 assert.ok(discoveryInput(report,'harness:provider-identity-review'));
});
