import { createHash } from 'node:crypto';

const CF = 'https://api.cloudflare.com/client/v4';
const GH = 'https://api.github.com';
const MAX_ASSETS = 500;
const MAX_REQUESTS = 80;
const MAX_PAGES = 5;
const short = (value, max = 200) => typeof value === 'string' ? value.slice(0,max) : '';
// A provider's natural key may exceed the API limit (for example a long custom
// hostname plus its account namespace). Prefix truncation alone can alias two
// real resources. Preserve a readable prefix and hash the complete identity,
// using the same function for both asset IDs and relation targets.
const boundedIdentity = value => value.length <= 240
  ? value
  : `${value.slice(0, 168).replace(/[\uD800-\uDBFF]$/, '')}:sha256:${createHash('sha256').update(value).digest('hex')}`;
const scopeHash = values => createHash('sha256').update([...values].sort().join(',')).digest('hex').slice(0,12);
class ProviderError extends Error { constructor(status) { super(`Provider returned HTTP ${status}`); this.status=status; } }

function collectorState(source, now) {
  const assets=new Map(), collectors=new Map();
  const mark=(name,status='ok',reason='')=>{
    const previous=collectors.get(name);
    if(previous&&previous.status!=='ok'&&status==='ok')return;
    collectors.set(name,{name,status,...(reason?{reason:short(reason,500)}:{})});
  };
  return {
    assets,mark,
    add(external_id,kind,name,metadata,relations=[],evidence={}) {
      if(!external_id||!name)return;
      const identity=boundedIdentity(external_id);
      if(assets.size>=MAX_ASSETS&&!assets.has(identity)){mark('collection_limit','partial','500-asset limit reached; unseen resources are not evidence of deletion');return;}
      assets.set(identity,{external_id:identity,kind,name:short(name),metadata,evidence:{provider_api:true,...evidence},relations:relations.slice(0,30).map(relation=>({...relation,target_external_id:boundedIdentity(relation.target_external_id)}))});
    },
    async collect(name,work) {
      try { const result=await work();mark(name);return result; }
      catch(error){mark(name,error.status===401||error.status===403?'permission_denied':'error',error instanceof ProviderError?error.message:error.message==='Request budget exhausted'?'Request budget exhausted':'Collection unavailable; retry after checking provider access');return null;}
    },
    finish(){return {schema_version:1,source,collected_at:now.toISOString(),complete:[...collectors.values()].every(c=>c.status==='ok'),collectors:[...collectors.values()],assets:[...assets.values()]};},
  };
}
function providerClient(origin,token,fetcher) {
  let requests=0;
  return async path=>{
    if(++requests>MAX_REQUESTS)throw new Error('Request budget exhausted');
    const url=new URL(origin+path);
    if(url.origin!==new URL(origin).origin||!path.startsWith('/')||path.includes('..'))throw new Error('Invalid provider path');
    const headers={Authorization:`Bearer ${token}`,Accept:origin===GH?'application/vnd.github+json':'application/json',...(origin===GH?{'X-GitHub-Api-Version':'2026-03-10','User-Agent':'CVM-read-only-discovery'}:{})};
    const response=await fetcher(url,{method:'GET',headers,redirect:'error',signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw new ProviderError(response.status);
    const reader=response.body.getReader();let size=0;const chunks=[];
    try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>2*1024*1024){await reader.cancel();throw new Error('Provider response too large');}chunks.push(value);}}finally{reader.releaseLock();}
    const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if(origin===CF&&data.success===false)throw new ProviderError(403);
    return {data,link:response.headers.get('link')||''};
  };
}
async function cloudflarePages(client,path,state,collector,{single=false,cursor=false}={}) {
  const result=[];let next='';const seen=new Set();
  for(let page=1;page<=MAX_PAGES;page++){
    const params=new URLSearchParams(single?{}:cursor?{per_page:'100',cursor:next}:{per_page:'100',page:String(page)});
    const {data}=await client(path+(path.includes('?')?'&':'?')+params);
    if(!Array.isArray(data.result))throw new Error('Unexpected provider list response');
    result.push(...data.result);
    if(single)return result;
    const info=data.result_info||{};
    if(cursor){next=info.cursor||'';if(!next)return result;if(seen.has(next))break;seen.add(next);}
    else if((Number.isFinite(info.total_pages)&&page>=info.total_pages)||(!Number.isFinite(info.total_pages)&&data.result.length<100))return result;
  }
  state.mark(collector,'partial','Pagination bound reached; unseen resources are not evidence of deletion');
  return result;
}

export async function discoverCloudflare({env=process.env,fetcher=fetch,now=new Date()}={}) {
  const token=String(env.CF_API_TOKEN||env.CLOUDFLARE_API_TOKEN||'').trim();
  const account=String(env.CF_ACCOUNT_ID||env.CLOUDFLARE_ACCOUNT_ID||'').trim();
  if(!token||!/^[a-f0-9]{32}$/i.test(account))throw new Error('CF_API_TOKEN and a 32-character CF_ACCOUNT_ID are required');
  const zoneIds=String(env.CF_ZONE_IDS||'').split(',').map(v=>v.trim()).filter(Boolean);
  if(zoneIds.length>20||zoneIds.some(v=>!/^[a-f0-9]{32}$/i.test(v)))throw new Error('CF_ZONE_IDS accepts at most 20 comma-separated zone IDs');
  const state=collectorState(`cloudflare:${account}${zoneIds.length?':'+scopeHash(zoneIds):''}`,now);
  const client=providerClient(CF,token,fetcher);
  const providerId=`cloudflare:account:${account}`;
  state.add(providerId,'provider','Cloudflare',{account_id:account});
  const zones=await state.collect('cloudflare_dns',async()=>{
    const list=zoneIds.length?await Promise.all(zoneIds.map(async id=>(await client('/zones/'+id)).data.result)):await cloudflarePages(client,`/zones?account.id=${account}`,state,'cloudflare_dns');
    if(list.length>20)state.mark('cloudflare_dns','partial','20-zone per-run bound reached; use CF_ZONE_IDS to partition collection');
    for(const zone of list.slice(0,20)){
      if(!/^[a-f0-9]{32}$/i.test(String(zone.id)))continue;
      const zoneId=`cloudflare:zone:${zone.id}`;
      state.add(zoneId,'domain',zone.name,{hostname:short(zone.name,253),zone_id:zone.id,status:short(zone.status),account_id:account},[{target_external_id:providerId,kind:'uses'}]);
      const records=await cloudflarePages(client,`/zones/${zone.id}/dns_records`,state,'cloudflare_dns',{cursor:true});
      for(const record of records){
        const metadata={hostname:short(record.name,253),record_type:short(record.type,20),zone_id:zone.id,ttl:typeof record.ttl==='number'?record.ttl:null,proxied:typeof record.proxied==='boolean'?record.proxied:null};
        if(['A','AAAA','CNAME','MX','NS'].includes(record.type))metadata.target=short(record.content,500);
        else metadata.content_status='omitted_to_avoid_secret_disclosure';
        state.add(`cloudflare:dns:${record.id}`,'domain',record.name,metadata,[{target_external_id:zoneId,kind:'part_of'},{target_external_id:providerId,kind:'uses'}],{modified_at:short(record.modified_on,40)});
      }
    }
    return list;
  });
  void zones;
  await state.collect('cloudflare_workers',async()=>{
    const workers=await cloudflarePages(client,`/accounts/${account}/workers/scripts`,state,'cloudflare_workers',{single:true});
    for(const worker of workers)state.add(`cloudflare:worker:${account}:${worker.id}`,'cloudflare_worker',worker.id,{account_id:account,etag:short(worker.etag),compatibility_date:short(worker.compatibility_date,40)},[{target_external_id:providerId,kind:'uses'}],{modified_at:short(worker.modified_on,40)});
  });
  await state.collect('cloudflare_worker_domains',async()=>{
    const domains=await cloudflarePages(client,`/accounts/${account}/workers/domains`,state,'cloudflare_worker_domains');
    for(const domain of domains)state.add(`cloudflare:worker-domain:${domain.id}`,'domain',domain.hostname,{hostname:short(domain.hostname,253),zone_id:short(domain.zone_id),environment:short(domain.environment)},[{target_external_id:`cloudflare:worker:${account}:${domain.service}`,kind:'routes_to'}]);
  });
  await state.collect('cloudflare_pages',async()=>{
    const projects=await cloudflarePages(client,`/accounts/${account}/pages/projects`,state,'cloudflare_pages');
    for(const project of projects){
      const id=`cloudflare:pages:${account}:${project.id||project.name}`;
      const source=project.source?.config;
      const metadata={account_id:account,subdomain:short(project.subdomain),production_branch:short(project.production_branch)};
      const relations=[{target_external_id:providerId,kind:'uses'}];
      if(source?.owner&&source?.repo_name){
        const repo=`${short(source.owner,100)}/${short(source.repo_name,100)}`;
        const repoId=`github:repository-name:${repo.toLowerCase()}`;
        state.add(repoId,'repository',repo,{url:`https://github.com/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.repo_name)}`});
        relations.push({target_external_id:repoId,kind:'depends_on'});
      }
      state.add(id,'cloudflare_pages',project.name,metadata,relations);
      for(const domain of Array.isArray(project.domains)?project.domains:[])if(typeof domain==='string')state.add(`cloudflare:pages-domain:${account}:${domain.toLowerCase()}`,'domain',domain,{hostname:short(domain,253)},[{target_external_id:id,kind:'routes_to'}]);
      const deployment=project.canonical_deployment;
      if(deployment?.id)state.add(`cloudflare:pages-deployment:${deployment.id}`,'deployment',`${project.name} production`,{environment:short(deployment.environment),commit_hash:short(deployment.deployment_trigger?.metadata?.commit_hash,80),stage:short(deployment.latest_stage?.name),state:short(deployment.latest_stage?.status)||'unknown'},[{target_external_id:id,kind:'deploys'}]);
    }
  });
  const report=state.finish();
  // The provider platform is independent of deployment environments such as
  // production/preview. Keep both so domain and deployment SOP filters work.
  for(const asset of report.assets)if(asset.external_id.startsWith('cloudflare:'))asset.metadata.platform='cloudflare';
  return report;
}

export async function discoverGithub({env=process.env,fetcher=fetch,now=new Date()}={}) {
  const token=String(env.GITHUB_TOKEN||env.GH_TOKEN||'').trim();
  if(!token)throw new Error('GITHUB_TOKEN or GH_TOKEN is required');
  const specified=String(env.GITHUB_REPOSITORIES||'').split(',').map(v=>v.trim()).filter(Boolean);
  if(specified.length>20||specified.some(v=>!/^[-\w.]+\/[-\w.]+$/.test(v)))throw new Error('GITHUB_REPOSITORIES accepts at most 20 owner/repository names');
  const client=providerClient(GH,token,fetcher);
  // Explicit repositories also work with installation/GitHub Actions tokens that
  // intentionally cannot read /user. The repository set is the stable source scope.
  const identity=specified.length?null:(await client('/user')).data;
  if(!specified.length&&!/^[-\w]+$/.test(identity?.login||''))throw new Error('A user token or explicit GITHUB_REPOSITORIES is required');
  const state=collectorState(specified.length?`github:repositories:${scopeHash(specified.map(name=>name.toLowerCase()))}`:`github:${short(identity.login,40)}`,now);
  const repos=await state.collect('github_repositories',async()=>{
    if(specified.length){
      const results=await Promise.allSettled(specified.map(async name=>(await client('/repos/'+name.split('/').map(encodeURIComponent).join('/'))).data));
      if(results.some(r=>r.status==='rejected'))state.mark('github_repositories','partial','Some requested repositories are inaccessible; accessible repositories were retained');
      return results.filter(r=>r.status==='fulfilled').map(r=>r.value);
    }
    const all=[];
    for(let page=1;page<=MAX_PAGES;page++){
      const {data,link}=await client(`/user/repos?per_page=20&page=${page}&sort=updated&affiliation=owner,collaborator,organization_member`);
      if(!Array.isArray(data))throw new Error('Unexpected repository response');
      all.push(...data);
      if(!link.includes('rel="next"'))return all;
      if(all.length>=20){state.mark('github_repositories','partial','20-repository per-run bound reached; use GITHUB_REPOSITORIES to partition collection');return all;}
    }
    return all;
  });
  for(const repo of repos||[]){
    if(!repo.id||!/^[-\w.]+\/[-\w.]+$/.test(repo.full_name||''))continue;
    const id=`github:repository:${repo.id}`;
    state.add(id,'repository',repo.full_name,{url:`https://github.com/${repo.full_name}`,visibility:repo.private?'private':'public',default_branch:short(repo.default_branch),archived:Boolean(repo.archived),language:short(repo.language),fork:Boolean(repo.fork)},[],{updated_at:short(repo.updated_at,40)});
    await state.collect('github_deployments',async()=>{
      const {data:deployments,link}=await client(`/repos/${repo.full_name}/deployments?per_page=10`);
      if(!Array.isArray(deployments))throw new Error('Unexpected deployment response');
      if(link.includes('rel="next"'))state.mark('github_deployments','partial','Only the 10 most recent deployments per repository are included');
      for(const deployment of deployments){
        const metadata={repository:repo.full_name,commit_hash:short(deployment.sha,80),ref:short(deployment.ref),environment:short(deployment.environment),production:Boolean(deployment.production_environment),state:'unknown'};
        await state.collect('github_deployment_status',async()=>{
          const {data:statuses}=await client(`/repos/${repo.full_name}/deployments/${encodeURIComponent(String(deployment.id))}/statuses?per_page=1`);
          if(Array.isArray(statuses)&&statuses.length)metadata.state=short(statuses[0].state,80);
        });
        state.add(`github:deployment:${repo.id}:${deployment.id}`,'deployment',`${repo.full_name} · ${short(deployment.environment,60)||'deployment'}`,metadata,[{target_external_id:id,kind:'depends_on'}],{created_at:short(deployment.created_at,40)});
      }
    });
  }
  return state.finish();
}
