set local search_path=public;

create or replace function cfm_internal.infra_change(aid uuid,k text,s text,actor text,v text,b jsonb,a jsonb,docs jsonb default '[]') returns void language sql set search_path=public as $$
 insert into infra_changes(asset_id,kind,summary,source,verification,"before","after",document_ids) values(aid,k,left(s,1000),actor,v,b,a,docs);
$$;

create or replace function cfm_internal.infra_asset_save(p jsonb,actor text) returns jsonb language plpgsql set search_path=public as $$
declare oldrow infra_assets%rowtype; r infra_assets%rowtype; aid uuid;
begin
 if p ? 'id' then
  select * into oldrow from infra_assets where id=(p->>'id')::uuid for update;
  if not found then raise exception 'CVM_NOT_FOUND: asset'; end if;
  aid:=oldrow.id;
  if oldrow.client_id is not null and p ? 'kind' and p->>'kind'<>oldrow.kind then raise exception 'CVM_CONFLICT: a monitored VPS kind is bound to its client identity'; end if;
  if p ? 'client_id' and (p->>'client_id') is distinct from oldrow.client_id then raise exception 'CVM_CONFLICT: use client enrollment or asset merge to change a VPS binding'; end if;
  if oldrow.source<>'manual' and ((p ? 'source' and p->>'source'<>oldrow.source) or (p ? 'external_id' and p->>'external_id'<>oldrow.external_id)) then raise exception 'CVM_CONFLICT: discovered identity is immutable'; end if;
  update infra_assets set source=coalesce(nullif(p->>'source',''),source),external_id=coalesce(p->>'external_id',external_id), name=coalesce(p->>'name',name),kind=coalesce(p->>'kind',kind),status=coalesce(p->>'status',status),category=coalesce(p->>'category',category),tags=coalesce(p->'tags',tags),description=coalesce(p->>'description',description),metadata=coalesce(p->'metadata',metadata),url=coalesce(p->>'url',url),provider=coalesce(p->>'provider',provider),client_id=case when p ? 'client_id' then p->>'client_id' else client_id end,cost=case when p ? 'cost' then (p->>'cost')::numeric else cost end,currency=coalesce(p->>'currency',currency),billing_cycle=coalesce(p->>'billing_cycle',billing_cycle),expires_at=case when p ? 'expires_at' then (p->>'expires_at')::timestamptz else expires_at end,updated_at=now() where id=aid returning * into r;
 else
  if nullif(p->>'client_id','') is not null then raise exception 'CVM_CONFLICT: client identities are created by enrollment and consolidated with asset merge'; end if;
  insert into infra_assets(kind,name,status,category,tags,description,source,external_id,metadata,url,provider,client_id,cost,currency,billing_cycle,expires_at)
  values(p->>'kind',p->>'name',coalesce(p->>'status','active'),coalesce(p->>'category',''),coalesce(p->'tags','[]'),coalesce(p->>'description',''),coalesce(nullif(p->>'source',''),'manual'),coalesce(p->>'external_id',''),coalesce(p->'metadata','{}'),coalesce(p->>'url',''),coalesce(p->>'provider',''),p->>'client_id',(p->>'cost')::numeric,coalesce(p->>'currency','USD'),coalesce(p->>'billing_cycle',''),(p->>'expires_at')::timestamptz) returning * into r;
 end if;
 perform cfm_internal.infra_change(r.id,case when aid is null then 'asset.created' else 'asset.updated' end,r.name,actor,'manual',case when aid is null then null else to_jsonb(oldrow) end,to_jsonb(r));
 return to_jsonb(r);
end $$;

create or replace function cfm_internal.infra_snapshot_save(p jsonb,actor text) returns jsonb language plpgsql set search_path=public as $$
declare prev infra_configuration_snapshots%rowtype; r infra_configuration_snapshots%rowtype;
begin
 select * into prev from infra_configuration_snapshots where asset_id=(p->>'asset_id')::uuid and source=actor order by collected_at desc limit 1;
 insert into infra_configuration_snapshots(asset_id,source,collected_at,confidence,environment,data,collectors)
 values((p->>'asset_id')::uuid,actor,(p->>'collected_at')::timestamptz,coalesce(p->>'confidence','reported'),coalesce(p->>'environment',''),p->'data',coalesce(p->'collectors','[]'))
 on conflict(asset_id,source,collected_at) do nothing returning * into r;
 if r.id is null then select * into r from infra_configuration_snapshots where asset_id=(p->>'asset_id')::uuid and source=actor and collected_at=(p->>'collected_at')::timestamptz; return to_jsonb(r); end if;
 if (prev.id is null or prev.data is distinct from r.data) and (prev.id is null or r.collected_at>=prev.collected_at) then
  perform cfm_internal.infra_change(r.asset_id,'configuration.changed','Configuration snapshot',actor,case when r.confidence='observed' then 'observed' else 'claimed' end,prev.data,r.data);
 end if;
 return to_jsonb(r);
end $$;

create or replace function cfm_internal.infra_document_save(p jsonb,actor text) returns jsonb language plpgsql set search_path=public as $$
declare oldrow infra_documents%rowtype; r infra_documents%rowtype; aid text;
begin
 for aid in select jsonb_array_elements_text(coalesce(p->'asset_ids','[]')) loop
  if not exists(select 1 from infra_assets where id=aid::uuid) then raise exception 'CVM_NOT_FOUND: linked asset'; end if;
 end loop;
 if p ? 'id' then
  select * into oldrow from infra_documents where id=(p->>'id')::uuid for update;
  if not found then raise exception 'CVM_NOT_FOUND: document'; end if;
  if not(p ? 'version') or (p->>'version')::int<>oldrow.version then raise exception 'CVM_CONFLICT: document version changed'; end if;
  update infra_documents set title=coalesce(p->>'title',title),slug=coalesce(p->>'slug',slug),content=coalesce(p->>'content',content),category=coalesce(p->>'category',category),tags=coalesce(p->'tags',tags),environments=coalesce(p->'environments',environments),asset_kinds=coalesce(p->'asset_kinds',asset_kinds),risk=coalesce(p->>'risk',risk),asset_ids=coalesce(p->'asset_ids',asset_ids),version=version+1,updated_at=now() where id=oldrow.id returning * into r;
 else
  insert into infra_documents(slug,title,content,category,tags,environments,asset_kinds,risk,asset_ids) values(coalesce(nullif(p->>'slug',''),gen_random_uuid()::text),p->>'title',p->>'content',coalesce(p->>'category',''),coalesce(p->'tags','[]'),coalesce(p->'environments','[]'),coalesce(p->'asset_kinds','[]'),coalesce(p->>'risk','medium'),coalesce(p->'asset_ids','[]')) returning * into r;
 end if;
 insert into infra_document_versions(document_id,version,document,actor) values(r.id,r.version,to_jsonb(r),actor);
 return to_jsonb(r);
end $$;

create or replace function cfm_internal.infra_baseline_save(p jsonb,actor text) returns jsonb language plpgsql set search_path=public as $$
declare oldrow infra_baselines%rowtype; r infra_baselines%rowtype; linked jsonb;
begin
 for linked in select value from jsonb_array_elements(coalesce(p->'rules','[]')) loop
  if linked ? 'sop_id' and not exists(select 1 from infra_documents where id=(linked->>'sop_id')::uuid) then raise exception 'CVM_NOT_FOUND: baseline SOP'; end if;
 end loop;
 for linked in select value from jsonb_array_elements(coalesce(p->'exceptions',(select exceptions from infra_baselines where id=(p->>'id')::uuid),'[]')) loop
  if not exists(select 1 from infra_assets where id=(linked->>'asset_id')::uuid) then raise exception 'CVM_NOT_FOUND: exception asset'; end if;
  if not exists(select 1 from jsonb_array_elements(coalesce(p->'rules',(select rules from infra_baselines where id=(p->>'id')::uuid),'[]')) rule where rule->>'id'=linked->>'rule_id') then raise exception 'CVM_INVALID: exception rule does not exist'; end if;
 end loop;
 if p ? 'id' then
  select * into oldrow from infra_baselines where id=(p->>'id')::uuid for update;
  if not found then raise exception 'CVM_NOT_FOUND: baseline'; end if;
  if not(p ? 'version') or (p->>'version')::int<>oldrow.version then raise exception 'CVM_CONFLICT: baseline version changed'; end if;
  update infra_baselines set name=coalesce(p->>'name',name),description=coalesce(p->>'description',description),environments=coalesce(p->'environments',environments),asset_kinds=coalesce(p->'asset_kinds',asset_kinds),rules=coalesce(p->'rules',rules),exceptions=coalesce(p->'exceptions',exceptions),max_age_hours=coalesce((p->>'max_age_hours')::int,max_age_hours),version=version+1,updated_at=now() where id=oldrow.id returning * into r;
 else
  insert into infra_baselines(name,description,environments,asset_kinds,rules,exceptions,max_age_hours) values(p->>'name',coalesce(p->>'description',''),coalesce(p->'environments','[]'),coalesce(p->'asset_kinds','[]'),p->'rules',coalesce(p->'exceptions','[]'),coalesce((p->>'max_age_hours')::int,48)) returning * into r;
 end if;
 insert into infra_baseline_versions(baseline_id,version,baseline,actor) values(r.id,r.version,to_jsonb(r),actor);
 return to_jsonb(r);
end $$;

create or replace function cfm_internal.infra_sync_relations(src text,run_id uuid,allow_remove boolean) returns void language plpgsql set search_path=public as $$
begin
 if allow_remove then
  with removed as (delete from infra_relationships r where r.source=src
   and exists(select 1 from infra_discovery_candidates d where d.asset_id=r.source_id and d.source=src and d.last_run_id=run_id and d.status in ('imported','merged'))
   and not exists(select 1 from infra_discovery_candidates d cross join lateral jsonb_array_elements(d.relations) e join infra_discovery_candidates t on t.source=d.source and t.external_id=e->>'target_external_id' where d.source=src and d.asset_id=r.source_id and t.asset_id=r.target_id and e->>'kind'=r.kind and d.status in ('imported','merged') and t.status in ('imported','merged'))
   returning r.*)
  insert into infra_changes(asset_id,kind,summary,source,verification,"before","after")
  select source_id,'relationship.removed','Discovered relationship removed: '||kind,src,case when src like 'agent:%' then 'observed' else 'claimed' end,to_jsonb(removed),null from removed;
 end if;
 with added as (insert into infra_relationships(source_id,target_id,kind,source)
 select distinct d.asset_id,t.asset_id,e->>'kind',src from infra_discovery_candidates d cross join lateral jsonb_array_elements(d.relations) e join infra_discovery_candidates t on t.source=d.source and t.external_id=e->>'target_external_id'
 where d.source=src and d.status in ('imported','merged') and t.status in ('imported','merged') and d.asset_id is not null and t.asset_id is not null and d.asset_id<>t.asset_id
 and e->>'kind' in ('runs_on','depends_on','routes_to','part_of','deploys','resolves_to','uses','exposes','backs_up','secured_by')
 on conflict(source_id,target_id,kind) do nothing returning *)
 insert into infra_changes(asset_id,kind,summary,source,verification,"before","after")
 select source_id,'relationship.added','Discovered relationship added: '||kind,src,case when src like 'agent:%' then 'observed' else 'claimed' end,null,to_jsonb(added) from added;
end $$;
revoke all on function cfm_internal.infra_sync_relations(text,uuid,boolean) from public,anon,authenticated;
grant execute on function cfm_internal.infra_sync_relations(text,uuid,boolean) to service_role;

create or replace function cfm_internal.infra_discovery_submit(p jsonb,actor text) returns jsonb language plpgsql set search_path=public as $$
declare r infra_discovery_runs%rowtype; a jsonb; c infra_discovery_candidates%rowtype; aid uuid; prev jsonb; src text:=p->>'source'; collected timestamptz:=(p->>'collected_at')::timestamptz; prior_run timestamptz;
begin
 -- Serialize each source so late/incomplete reports cannot mark newer observations missing.
 perform pg_advisory_xact_lock(hashtext('infra-discovery:'||src));
 select max(collected_at) into prior_run from infra_discovery_runs where source=src;
 insert into infra_discovery_runs(source,client_id,collected_at,complete,collectors,asset_count) values(src,p->>'client_id',collected,(p->>'complete')::boolean,p->'collectors',jsonb_array_length(p->'assets')) on conflict(source,collected_at) do nothing returning * into r;
 if r.id is null then return jsonb_build_object('duplicate',true,'source',src); end if;
 if prior_run is not null and collected<prior_run then return jsonb_build_object('run',to_jsonb(r),'stale',true,'updated',0); end if;
 for a in select value from jsonb_array_elements(p->'assets') loop
  insert into infra_discovery_candidates(source,external_id,kind,name,metadata,evidence,relations,last_seen,last_run_id)
  values(src,a->>'external_id',a->>'kind',a->>'name',a->'metadata',a->'evidence',coalesce(a->'relations','[]'),collected,r.id)
  on conflict(source,external_id) do update set kind=excluded.kind,name=excluded.name,metadata=excluded.metadata,evidence=excluded.evidence,relations=excluded.relations,last_seen=excluded.last_seen,missing_since=null,last_run_id=r.id returning * into c;
  if c.asset_id is null and p ? 'client_id' and c.kind='vps' and c.external_id='host' then
   select id into aid from infra_assets where client_id=p->>'client_id' and kind='vps';
   if aid is not null then update infra_discovery_candidates set asset_id=aid,status='imported' where id=c.id returning * into c; end if;
  end if;
  if c.asset_id is not null and c.status in ('imported','merged') then
   select observed into prev from infra_assets where id=c.asset_id and (observed_at is null or observed_at<=collected) for update;
   if found then
   if prev is distinct from a->'metadata' then
    update infra_assets set observed=a->'metadata',updated_at=now() where id=c.asset_id;
    perform cfm_internal.infra_change(c.asset_id,'discovery.changed',c.name,src,case when src like 'agent:%' then 'observed' else 'claimed' end,prev,a->'metadata');
   end if;
   update infra_assets set observed_source=src,observed_at=collected,observed_confidence=case when src like 'agent:%' then 'observed' else 'reported' end where id=c.asset_id;
   end if;
  end if;
 end loop;
 if (p->>'complete')::boolean and not exists(select 1 from jsonb_array_elements(p->'collectors') x where x->>'status' not in ('ok','success','available')) then
  update infra_discovery_candidates set missing_since=coalesce(missing_since,collected) where source=src and last_seen<collected and last_run_id<>r.id;
 end if;
 perform cfm_internal.infra_sync_relations(src,r.id,(p->>'complete')::boolean and not exists(select 1 from jsonb_array_elements(p->'collectors') x where x->>'status' not in ('ok','success','available')));
 if p ? 'configuration' and p ? 'client_id' then
  select id into aid from infra_assets where client_id=p->>'client_id' and kind='vps';
  if aid is not null then perform cfm_internal.infra_snapshot_save(jsonb_build_object('asset_id',aid,'collected_at',collected,'confidence',case when src like 'agent:%' then 'observed' else 'reported' end,'environment',coalesce(p#>>'{configuration,system,value,os}',p#>>'{configuration,os,value,id}',p#>>'{configuration,os,value}',''),'data',p->'configuration','collectors',p->'collectors'),src); end if;
 end if;
 return jsonb_build_object('run',to_jsonb(r),'updated',jsonb_array_length(p->'assets'));
end $$;

create or replace function cfm_internal.infra_resolve(p jsonb,actor text) returns jsonb language plpgsql set search_path=public as $$
declare c infra_discovery_candidates%rowtype; aid uuid; previous_observed jsonb;
begin
 select * into c from infra_discovery_candidates where id=(p->>'id')::uuid for update;
 if not found then raise exception 'CVM_NOT_FOUND: candidate'; end if;
 if p->>'action'='ignore' then update infra_discovery_candidates set status='ignored' where id=c.id returning * into c; return to_jsonb(c); end if;
 if c.asset_id is not null and c.status in ('imported','merged') then return to_jsonb(c); end if;
 if p->>'action'='merge' then
  aid:=(p->>'asset_id')::uuid;
  if not exists(select 1 from infra_assets where id=aid) then raise exception 'CVM_NOT_FOUND: target asset'; end if;
  if not exists(select 1 from infra_assets where id=aid and kind=c.kind) then raise exception 'CVM_CONFLICT: discovery merge requires same asset kind'; end if;
 elsif p->>'action'='import' then
  select id into aid from infra_assets where source=c.source and external_id=c.external_id;
  if aid is null then
   insert into infra_assets(kind,name,source,external_id,observed,observed_source,observed_at,observed_confidence) values(c.kind,c.name,c.source,c.external_id,c.metadata,c.source,c.last_seen,case when c.source like 'agent:%' then 'observed' else 'reported' end) returning id into aid;
   perform cfm_internal.infra_change(aid,'asset.imported',c.name,actor,'manual',null,c.metadata);
  end if;
 else raise exception 'CVM_INVALID: candidate action'; end if;
 update infra_discovery_candidates set asset_id=aid,status=case when p->>'action'='merge' then 'merged' else 'imported' end where id=c.id returning * into c;
 select observed into previous_observed from infra_assets where id=aid and (observed_at is null or observed_at<=c.last_seen) for update;
 if found then
  if previous_observed is distinct from c.metadata then
   perform cfm_internal.infra_change(aid,'discovery.changed',c.name,c.source,case when c.source like 'agent:%' then 'observed' else 'claimed' end,previous_observed,c.metadata);
  end if;
  update infra_assets set observed=c.metadata,observed_source=c.source,observed_at=c.last_seen,observed_confidence=case when c.source like 'agent:%' then 'observed' else 'reported' end where id=aid;
 end if;
 -- Resolve both directions, preserving ignored candidates and manual edges.
 perform cfm_internal.infra_sync_relations(c.source,c.last_run_id,false);
 return to_jsonb(c);
end $$;

create or replace function cfm_internal.infra_dispatch(p_operation text,p_payload jsonb default '{}',p_actor text default 'unknown') returns jsonb language plpgsql set search_path=public as $$
declare lim int:=least(greatest(coalesce((p_payload->>'limit')::int,50),1),100); offst int:=least(greatest(coalesce((p_payload->>'offset')::int,0),0),100000); tbl text; timecol text; filter text; ordering text; rows jsonb; total bigint; result jsonb; item jsonb; aid uuid; bid uuid; oldrow jsonb; ids uuid[]; walk_count int; rel record; current_version int;
begin
 if jsonb_typeof(p_payload)<>'object' then raise exception 'CVM_INVALID: payload'; end if;
 if p_operation='summary' then
  return jsonb_build_object('assets_total',(select count(*) from infra_assets where status<>'archived'),'assets_by_kind',coalesce((select jsonb_object_agg(kind,n) from (select kind,count(*) n from infra_assets where status<>'archived' group by kind) q),'{}'),'assets_by_status',coalesce((select jsonb_object_agg(status,n) from (select status,count(*) n from infra_assets group by status) q),'{}'),'discovery_pending',(select count(*) from infra_discovery_candidates where status='pending'),'changes_24h',(select count(*) from infra_changes where created_at>now()-interval '24 hours'),'documents_total',(select count(*) from infra_documents),'baselines_total',(select count(*) from infra_baselines),'configuration_total',(select count(distinct asset_id) from infra_configuration_snapshots));
 elsif p_operation in ('assets.list','relationships.list','discovery.list','discovery.runs','snapshots.list','changes.list','documents.list','baselines.list','evaluations.list') then
  tbl:=case p_operation when 'assets.list' then 'infra_assets' when 'relationships.list' then 'infra_relationships' when 'discovery.list' then 'infra_discovery_candidates' when 'discovery.runs' then 'infra_discovery_runs' when 'snapshots.list' then 'infra_configuration_snapshots' when 'changes.list' then 'infra_changes' when 'documents.list' then 'infra_documents' when 'baselines.list' then 'infra_baselines' else 'infra_baseline_evaluations' end;
  timecol:=case when p_operation='discovery.list' then 'last_seen' when p_operation='evaluations.list' then 'evaluated_at' when p_operation='snapshots.list' then 'collected_at' else 'created_at' end;
  filter:='true';
  ordering:=format('%I desc,id',timecol);
  if p_operation='assets.list' then
   ordering:=case p_payload->>'sort' when 'name' then 'name asc,id' when 'kind' then 'kind asc,name asc,id' when 'expires_at' then 'expires_at asc nulls last,id' else 'updated_at desc,id' end;
   if p_payload ? 'client_id' then filter:=filter||format(' and client_id=%L',p_payload->>'client_id'); end if;
   if p_payload ? 'monitor_type' and p_payload ? 'monitor_id' then filter:=filter||format(' and exists(select 1 from infra_monitor_links l where l.asset_id=t.id and l.monitor_type=%L and l.monitor_id=%L)',p_payload->>'monitor_type',p_payload->>'monitor_id'); end if;
  end if;
  if p_operation='changes.list' and p_payload ? 'verification' then filter:=filter||format(' and verification=%L',p_payload->>'verification'); end if;
  if p_payload ? 'q' and p_payload->>'q'<>'' then filter:=filter||format(' and to_jsonb(t)::text ilike %L','%'||replace(replace(replace(p_payload->>'q','\','\\'),'%','\%'),'_','\_')||'%'); end if;
  if p_payload ? 'category' then filter:=filter||format(' and to_jsonb(t)->>''category''=%L',p_payload->>'category'); end if;
  if p_payload ? 'tag' then filter:=filter||format(' and to_jsonb(t)->''tags'' @> %L::jsonb',jsonb_build_array(p_payload->>'tag')::text); end if;
  if p_payload ? 'kind' then filter:=filter||format(' and to_jsonb(t)->>''kind''=%L',p_payload->>'kind'); end if;
  if p_payload ? 'status' then filter:=filter||format(' and to_jsonb(t)->>''status''=%L',p_payload->>'status'); end if;
  if p_payload ? 'source' then filter:=filter||format(' and to_jsonb(t)->>''source''=%L',p_payload->>'source'); end if;
  if p_payload ? 'asset_id' then
   if p_operation='relationships.list' then filter:=filter||format(' and (source_id=%L::uuid or target_id=%L::uuid)',p_payload->>'asset_id',p_payload->>'asset_id');
   elsif p_operation='documents.list' then filter:=filter||format(' and asset_ids @> %L::jsonb',jsonb_build_array(p_payload->>'asset_id')::text);
   else filter:=filter||format(' and to_jsonb(t)->>''asset_id''=%L',p_payload->>'asset_id'); end if;
  end if;
  if p_payload ? 'baseline_id' then filter:=filter||format(' and to_jsonb(t)->>''baseline_id''=%L',p_payload->>'baseline_id'); end if;
  if p_payload ? 'since' then filter:=filter||format(' and %I >= %L::timestamptz',timecol,p_payload->>'since'); end if;
  if p_payload ? 'until' then filter:=filter||format(' and %I <= %L::timestamptz',timecol,p_payload->>'until'); end if;
  execute format('select count(*) from %I t where %s',tbl,filter) into total;
  execute format('select coalesce(jsonb_agg(to_jsonb(q)),''[]'') from (select * from %I t where %s order by %s limit %s offset %s) q',tbl,filter,ordering,lim,offst) into rows;
  return jsonb_build_object('data',rows,'total',total,'limit',lim,'offset',offst);
 elsif p_operation in ('assets.get','documents.get','baselines.get') then
  tbl:=case p_operation when 'assets.get' then 'infra_assets' when 'documents.get' then 'infra_documents' else 'infra_baselines' end;
  execute format('select to_jsonb(t) from %I t where id=$1',tbl) into result using (p_payload->>'id')::uuid;
  if result is null then raise exception 'CVM_NOT_FOUND: resource'; end if; return result;
 elsif p_operation='assets.save' then return cfm_internal.infra_asset_save(p_payload,p_actor);
 elsif p_operation='assets.import' then
  rows:='[]'; for item in select value from jsonb_array_elements(p_payload->'assets') loop
   aid:=null; if item ? 'import_id' then select id into aid from infra_assets where id=(item->>'import_id')::uuid; end if; if aid is null and coalesce(item->>'external_id','')<>'' then select id into aid from infra_assets where source=coalesce(nullif(item->>'source',''),'manual') and external_id=item->>'external_id'; end if;
   if aid is null then rows:=rows||jsonb_build_array(cfm_internal.infra_asset_save(item,p_actor)); else select to_jsonb(a) into result from infra_assets a where id=aid; rows:=rows||jsonb_build_array(result); end if;
  end loop; return jsonb_build_object('data',rows,'count',jsonb_array_length(rows));
 elsif p_operation='assets.batch' then
  select array_agg(value::uuid) into ids from jsonb_array_elements_text(p_payload->'ids');
  if (select count(*) from infra_assets where id=any(ids))<>cardinality(ids) then raise exception 'CVM_NOT_FOUND: batch asset'; end if;
  for aid in select unnest(ids) loop
   if p_payload->>'action'='archive' then perform cfm_internal.infra_asset_save(jsonb_build_object('id',aid,'status','archived'),p_actor);
   elsif p_payload->>'action'='tag' then perform cfm_internal.infra_asset_save(jsonb_build_object('id',aid,'tags',p_payload->'tags'),p_actor);
   else raise exception 'CVM_INVALID: batch action'; end if;
  end loop; return jsonb_build_object('updated',cardinality(ids));
 elsif p_operation='assets.merge' then
  aid:=(p_payload->>'id')::uuid; bid:=(p_payload->>'target_id')::uuid;
  if aid=bid then raise exception 'CVM_INVALID: cannot merge asset into itself'; end if;
  perform id from infra_assets where id in (aid,bid) order by id for update;
  if (select count(*) from infra_assets where id in(aid,bid))<>2 then raise exception 'CVM_NOT_FOUND: merge assets'; end if;
  select to_jsonb(a) into oldrow from infra_assets a where id=aid;
  if (select kind from infra_assets where id=aid)<>(select kind from infra_assets where id=bid) then raise exception 'CVM_CONFLICT: merge requires same asset kind'; end if;
  if oldrow->>'kind'='vps' and oldrow->>'client_id' is not null then
   if exists(select 1 from infra_assets where id=bid and client_id is not null and client_id<>oldrow->>'client_id') then raise exception 'CVM_CONFLICT: distinct monitored VPS identities cannot be merged'; end if;
   update infra_assets set client_id=null where id=aid;
   update infra_assets set client_id=oldrow->>'client_id' where id=bid;
  end if;
  update infra_monitor_links set asset_id=bid where asset_id=aid;
  update infra_discovery_candidates set asset_id=bid,status='merged' where asset_id=aid;
  for rel in select * from infra_relationships where source_id=aid or target_id=aid loop
   if (case when rel.source_id=aid then bid else rel.source_id end)<>(case when rel.target_id=aid then bid else rel.target_id end) then
    insert into infra_relationships(source_id,target_id,kind,description,source) values(case when rel.source_id=aid then bid else rel.source_id end,case when rel.target_id=aid then bid else rel.target_id end,rel.kind,rel.description,rel.source) on conflict do nothing;
   end if;
  end loop;
  delete from infra_relationships where source_id=aid or target_id=aid;
  update infra_configuration_snapshots s set asset_id=bid where s.asset_id=aid and not exists(select 1 from infra_configuration_snapshots t where t.asset_id=bid and t.source=s.source and t.collected_at=s.collected_at);
  update infra_changes set asset_id=bid where asset_id=aid;
  update infra_baseline_evaluations set asset_id=bid where asset_id=aid;
  for item in select to_jsonb(d) from infra_documents d where asset_ids @> jsonb_build_array(aid) loop
   perform cfm_internal.infra_document_save(item||jsonb_build_object('asset_ids',((item->'asset_ids')-aid::text-bid::text)||jsonb_build_array(bid)),p_actor);
  end loop;
  for item in select to_jsonb(b) from infra_baselines b where exists(select 1 from jsonb_array_elements(exceptions) e where e->>'asset_id'=aid::text) loop
   perform cfm_internal.infra_baseline_save(item||jsonb_build_object('exceptions',(select jsonb_agg(case when e->>'asset_id'=aid::text then e||jsonb_build_object('asset_id',bid) else e end) from jsonb_array_elements(item->'exceptions') e)),p_actor);
  end loop;
  update infra_assets set status='archived',metadata=metadata||jsonb_build_object('merged_into',bid),updated_at=now() where id=aid;
  perform cfm_internal.infra_change(bid,'asset.merged','Merged asset '||aid,p_actor,'manual',oldrow,jsonb_build_object('target_id',bid));
  select to_jsonb(a) into result from infra_assets a where id=bid; return result;
 elsif p_operation='relationships.save' then
  insert into infra_relationships(source_id,target_id,kind,description,source) values((p_payload->>'source_id')::uuid,(p_payload->>'target_id')::uuid,p_payload->>'kind',coalesce(p_payload->>'description',''),p_actor) on conflict(source_id,target_id,kind) do update set description=excluded.description,source=excluded.source returning to_jsonb(infra_relationships.*) into result;
  perform cfm_internal.infra_change((p_payload->>'source_id')::uuid,'relationship.changed',p_payload->>'kind',p_actor,'manual',null,result); return result;
 elsif p_operation='relationships.delete' then
  delete from infra_relationships where id=(p_payload->>'id')::uuid returning to_jsonb(infra_relationships.*) into result;
  if result is not null then perform cfm_internal.infra_change((result->>'source_id')::uuid,'relationship.removed',result->>'kind',p_actor,'manual',result,null); end if;
  return jsonb_build_object('success',true,'already_absent',result is null);
 elsif p_operation='monitors.list' then
  -- Existing persisted measurements, not inferred live state. Each linked
  -- monitor contributes at most ten recent samples and retains its timestamps.
  select coalesce(jsonb_agg(jsonb_build_object(
   'type',l.monitor_type,'id',l.monitor_id,'monitor_type',l.monitor_type,'monitor_id',l.monitor_id,
   'monitor',case l.monitor_type
    when 'website' then to_jsonb(w)
    when 'ping' then to_jsonb(t)||jsonb_build_object('recent_checks',ping_data.samples,'sample_source','persisted_history')
    else jsonb_build_object('uuid',c.uuid,'name',c.name,'os',c.os,'arch',c.arch,'version',c.version,
      'latest_record',record_data.samples->0,'recent_records',record_data.samples,'sample_source','persisted_history') end
   ) order by l.monitor_type,l.monitor_id),'[]') into result
  from (select * from infra_monitor_links where asset_id=(p_payload->>'asset_id')::uuid order by monitor_type,monitor_id limit lim offset offst) l
  left join clients c on l.monitor_type='client' and c.uuid=l.monitor_id
  left join website_monitors w on l.monitor_type='website' and w.id::text=l.monitor_id
  left join ping_tasks t on l.monitor_type='ping' and t.id::text=l.monitor_id
  left join lateral (
   select coalesce(jsonb_agg(s.payload order by s.time desc),'[]') samples from (
    select r.time,to_jsonb(r)-'id'-'client' as payload from records r where r.client=c.uuid
     and r.time>=coalesce((p_payload->>'since')::timestamptz,now()-interval '24 hours')
     and r.time<=coalesce((p_payload->>'until')::timestamptz,now()) order by r.time desc,r.id desc limit 10
   ) s
  ) record_data on c.uuid is not null
  left join lateral (
   select coalesce(jsonb_agg(s.payload order by s.time desc),'[]') samples from (
    select r.time,jsonb_build_object('client',r.client,'time',r.time,'value',r.value) as payload from ping_records r where r.task_id=t.id
     and r.time>=coalesce((p_payload->>'since')::timestamptz,now()-interval '24 hours')
     and r.time<=coalesce((p_payload->>'until')::timestamptz,now()) order by r.time desc,r.id desc limit 10
   ) s
  ) ping_data on t.id is not null;
  return result;
 elsif p_operation='monitors.unlink' then
  if p_payload->>'monitor_type'='client' then raise exception 'CVM_CONFLICT: a client monitor is a stable VPS identity; use asset merge or the monitor lifecycle'; end if;
  delete from infra_monitor_links where asset_id=(p_payload->>'asset_id')::uuid and monitor_type=p_payload->>'monitor_type' and monitor_id=p_payload->>'monitor_id'; if p_payload->>'monitor_type'='website' then perform cfm_internal.infra_sync_monitor_relations((p_payload->>'asset_id')::uuid); end if; return jsonb_build_object('success',true);
 elsif p_operation='monitors.link' then
  if p_payload->>'monitor_type'='client' and not exists(select 1 from infra_assets where id=(p_payload->>'asset_id')::uuid and kind='vps' and client_id=p_payload->>'monitor_id') then raise exception 'CVM_CONFLICT: move a client identity with asset merge, not a monitor link'; end if;
  if not exists(select 1 from infra_assets where id=(p_payload->>'asset_id')::uuid) then raise exception 'CVM_NOT_FOUND: asset'; end if;
  if not ((p_payload->>'monitor_type'='website' and exists(select 1 from website_monitors where id::text=p_payload->>'monitor_id')) or (p_payload->>'monitor_type'='ping' and exists(select 1 from ping_tasks where id::text=p_payload->>'monitor_id')) or (p_payload->>'monitor_type'='client' and exists(select 1 from clients where uuid=p_payload->>'monitor_id'))) then raise exception 'CVM_NOT_FOUND: monitor'; end if;
  select asset_id into aid from infra_monitor_links where monitor_type=p_payload->>'monitor_type' and monitor_id=p_payload->>'monitor_id' for update;
  insert into infra_monitor_links values((p_payload->>'asset_id')::uuid,p_payload->>'monitor_type',p_payload->>'monitor_id') on conflict(monitor_type,monitor_id) do update set asset_id=excluded.asset_id;
  if p_payload->>'monitor_type'='website' then
   if aid is not null and aid<>(p_payload->>'asset_id')::uuid then perform cfm_internal.infra_sync_monitor_relations(aid); end if;
   perform cfm_internal.infra_sync_monitor_relations((p_payload->>'asset_id')::uuid);
  end if;
  return jsonb_build_object('success',true);
 elsif p_operation='topology' then
  if not exists(select 1 from infra_assets where id=(p_payload->>'id')::uuid) then raise exception 'CVM_NOT_FOUND: asset'; end if;
  with recursive walk(id,depth,path) as (
   select (p_payload->>'id')::uuid,0,array[(p_payload->>'id')::uuid]
   union all
   select case when r.source_id=w.id then r.target_id else r.source_id end,w.depth+1,w.path||case when r.source_id=w.id then r.target_id else r.source_id end
   from walk w join infra_relationships r on ((coalesce(p_payload->>'direction','both') in ('both','upstream') and r.source_id=w.id) or (coalesce(p_payload->>'direction','both') in ('both','downstream') and r.target_id=w.id))
   where w.depth<least(coalesce((p_payload->>'depth')::int,3),5) and not(case when r.source_id=w.id then r.target_id else r.source_id end=any(w.path))
  ) select array_agg(distinct id),count(*) into ids,walk_count from (select id from walk limit 1001) q;
  ids:=array_prepend((p_payload->>'id')::uuid,array_remove(ids,(p_payload->>'id')::uuid));
  select jsonb_build_object('nodes',coalesce((select jsonb_agg(to_jsonb(a)) from infra_assets a where a.id=any(ids[1:200])),'[]'),'edges',coalesce((select jsonb_agg(to_jsonb(r)) from (select * from infra_relationships where source_id=any(ids[1:200]) and target_id=any(ids[1:200]) order by id limit 1000) r),'[]'),'truncated',cardinality(ids)>200 or walk_count>=1001 or (select count(*)>1000 from (select 1 from infra_relationships where source_id=any(ids[1:200]) and target_id=any(ids[1:200]) limit 1001) e),'direction',coalesce(p_payload->>'direction','both'),'depth',least(coalesce((p_payload->>'depth')::int,3),5)) into result; return result;
 elsif p_operation='discovery.submit' then return cfm_internal.infra_discovery_submit(p_payload,p_actor);
 elsif p_operation='discovery.resolve' then return cfm_internal.infra_resolve(p_payload,p_actor);
 elsif p_operation='snapshots.save' then return cfm_internal.infra_snapshot_save(p_payload,p_actor);
 elsif p_operation='operations.save' then
  perform cfm_internal.infra_change((p_payload->>'asset_id')::uuid,'operation.reported',p_payload->>'summary',p_actor,'claimed',p_payload->'before',p_payload->'after',coalesce(p_payload->'document_ids','[]')); return jsonb_build_object('success',true,'verification','claimed','execution_authority','none');
 elsif p_operation='documents.applicable' then
  -- Explicit links express user intent. Global SOPs require both the asset-kind
  -- and known-environment filters; a missing environment never implies Linux.
  with target as (
   select a.*,s.environment snapshot_environment,s.confidence snapshot_confidence,s.data snapshot_data
   from infra_assets a left join lateral (
    select environment,confidence,data from infra_configuration_snapshots where asset_id=a.id and collected_at<=now()
    order by collected_at desc,created_at desc,id desc limit 1
   ) s on true where a.id=(p_payload->>'asset_id')::uuid
  ), environment_values as (
   select lower(btrim(v #>> '{}')) value from target t
   cross join lateral jsonb_array_elements(jsonb_build_array(
    case when t.kind in ('cloudflare_worker','cloudflare_pages') then '"cloudflare"'::jsonb end,
    case when lower(btrim(t.provider))='cloudflare' then '"cloudflare"'::jsonb end,
    t.metadata->'environment',t.metadata->'os',t.metadata->'platform',
    case when t.observed_confidence<>'unknown' then t.observed->'environment' end,
    case when t.observed_confidence<>'unknown' then t.observed->'os' end,
    case when t.observed_confidence<>'unknown' then t.observed->'platform' end,
    case when t.snapshot_confidence<>'unknown' then to_jsonb(t.snapshot_environment) end,
    case when t.snapshot_confidence<>'unknown' and coalesce(t.snapshot_data#>>'{system,status}','available') in ('available','ok','success') then t.snapshot_data#>'{system,value,os}' end,
    case when t.snapshot_confidence<>'unknown' and coalesce(t.snapshot_data#>>'{system,status}','available') in ('available','ok','success') then t.snapshot_data#>'{system,value,platform}' end,
    case when t.snapshot_confidence<>'unknown' and coalesce(t.snapshot_data#>>'{os,status}','available') in ('available','ok','success') then t.snapshot_data#>'{os,value,id}' end
   )) v where jsonb_typeof(v)='string'
  ), environment_tokens as (
   select value from environment_values where value<>''
   union select regexp_split_to_table(value,'[^a-z0-9._-]+') from environment_values
  ), environments as (
   select value from environment_tokens where value<>''
   union select 'linux' where exists(select 1 from environment_tokens where value in ('debian','ubuntu','alpine','fedora','centos','rhel','rocky','almalinux','arch','archlinux','gentoo','opensuse','suse','amzn','nixos'))
  ) select coalesce(jsonb_agg(to_jsonb(d)),'[]') into result from (
   select d.* from infra_documents d cross join target t
   where d.asset_ids @> jsonb_build_array(t.id::text)
    or (d.asset_ids='[]'
     and (d.asset_kinds='[]' or d.asset_kinds @> jsonb_build_array(t.kind))
     and (d.environments='[]' or exists(select 1 from jsonb_array_elements_text(d.environments) e where lower(btrim(e)) in (select value from environments))))
   order by (d.asset_ids @> jsonb_build_array(t.id::text)) desc,d.updated_at desc,d.id limit lim
  ) d; return result;
 elsif p_operation='documents.save' then return cfm_internal.infra_document_save(p_payload,p_actor);
 elsif p_operation='documents.restore' then
  select document into item from infra_document_versions where document_id=(p_payload->>'id')::uuid and version=(p_payload->>'version')::int;
  if item is null then raise exception 'CVM_NOT_FOUND: document version'; end if;
  select version into current_version from infra_documents where id=(p_payload->>'id')::uuid;
  return cfm_internal.infra_document_save(item||jsonb_build_object('version',current_version),p_actor);
 elsif p_operation in ('documents.versions','baselines.versions') then
  tbl:=case p_operation when 'documents.versions' then 'infra_document_versions' else 'infra_baseline_versions' end;
  filter:=case p_operation when 'documents.versions' then 'document_id' else 'baseline_id' end;
  execute format('select count(*) from %I where %I=$1',tbl,filter) into total using (p_payload->>'id')::uuid;
  execute format('select coalesce(jsonb_agg(to_jsonb(q)),''[]'') from (select * from %I where %I=$1 order by version desc limit $2 offset $3) q',tbl,filter) into rows using (p_payload->>'id')::uuid,lim,offst;
  return jsonb_build_object('data',rows,'total',total,'limit',lim,'offset',offst);
 elsif p_operation='baselines.save' then return cfm_internal.infra_baseline_save(p_payload,p_actor);
 elsif p_operation='evaluations.save' then
  insert into infra_baseline_evaluations(baseline_id,asset_id,snapshot_id,baseline_version,evaluated_at,status,results) values((p_payload->>'baseline_id')::uuid,(p_payload->>'asset_id')::uuid,(p_payload->>'snapshot_id')::uuid,(p_payload->>'baseline_version')::int,(p_payload->>'evaluated_at')::timestamptz,p_payload->>'status',p_payload->'results') returning to_jsonb(infra_baseline_evaluations.*) into result;
  if p_payload->>'status'<>'compliant' then perform cfm_internal.infra_change((p_payload->>'asset_id')::uuid,'baseline.'||(p_payload->>'status'),'Baseline evaluation',p_actor,'manual',null,p_payload); end if; return result;
 elsif p_operation='cleanup' then
  delete from infra_changes where id in(select id from infra_changes where created_at<now()-interval '180 days' order by created_at limit 500);
  get diagnostics total=row_count;
  delete from infra_configuration_snapshots where id in(select s.id from infra_configuration_snapshots s where s.created_at<now()-interval '90 days' and exists(select 1 from infra_configuration_snapshots newer where newer.asset_id=s.asset_id and newer.source=s.source and newer.collected_at>s.collected_at) order by s.created_at limit 500);
  delete from infra_discovery_runs where id in(select r.id from infra_discovery_runs r where r.created_at<now()-interval '30 days' and not exists(select 1 from infra_discovery_candidates c where c.last_run_id=r.id) order by created_at limit 500);
  delete from infra_baseline_evaluations where id in(select id from infra_baseline_evaluations where evaluated_at<now()-interval '90 days' order by evaluated_at limit 500);
  return jsonb_build_object('changes_deleted',total,'bounded',true,'has_more',exists(select 1 from infra_changes where created_at<now()-interval '180 days') or exists(select 1 from infra_configuration_snapshots s where s.created_at<now()-interval '90 days' and exists(select 1 from infra_configuration_snapshots newer where newer.asset_id=s.asset_id and newer.source=s.source and newer.collected_at>s.collected_at)) or exists(select 1 from infra_discovery_runs r where r.created_at<now()-interval '30 days' and not exists(select 1 from infra_discovery_candidates c where c.last_run_id=r.id)) or exists(select 1 from infra_baseline_evaluations where evaluated_at<now()-interval '90 days'));
 else raise exception 'CVM_INVALID: unsupported infrastructure operation';
 end if;
end $$;

create or replace function public.cfm_infra(p_operation text,p_payload jsonb default '{}',p_actor text default 'unknown') returns jsonb language plpgsql set search_path=public as $$
declare result jsonb;
begin
 result:=cfm_internal.infra_dispatch(p_operation,p_payload,p_actor);
 if p_operation in ('assets.save','assets.import','assets.batch','assets.merge','relationships.save','relationships.delete','monitors.link','monitors.unlink','discovery.submit','discovery.resolve','snapshots.save','operations.save','documents.save','documents.restore','baselines.save','evaluations.save','cleanup') then
  insert into audit_logs("user",action,detail,level) values(left(p_actor,200),'infra.'||p_operation,jsonb_build_object('id',p_payload->>'id','asset_id',p_payload->>'asset_id','outcome','committed')::text,'info');
 end if;
 return result;
end $$;
revoke all on function cfm_internal.infra_dispatch(text,jsonb,text) from public,anon,authenticated;
grant execute on function cfm_internal.infra_dispatch(text,jsonb,text) to service_role;

revoke all on function public.cfm_infra(text,jsonb,text) from public,anon,authenticated;
grant execute on function public.cfm_infra(text,jsonb,text) to service_role;
revoke all on function cfm_internal.infra_change(uuid,text,text,text,text,jsonb,jsonb,jsonb) from public,anon,authenticated;
revoke all on function cfm_internal.infra_asset_save(jsonb,text) from public,anon,authenticated;
revoke all on function cfm_internal.infra_snapshot_save(jsonb,text) from public,anon,authenticated;
revoke all on function cfm_internal.infra_document_save(jsonb,text) from public,anon,authenticated;
revoke all on function cfm_internal.infra_baseline_save(jsonb,text) from public,anon,authenticated;
revoke all on function cfm_internal.infra_discovery_submit(jsonb,text) from public,anon,authenticated;
revoke all on function cfm_internal.infra_resolve(jsonb,text) from public,anon,authenticated;
grant usage on schema cfm_internal to service_role;
grant execute on function cfm_internal.infra_change(uuid,text,text,text,text,jsonb,jsonb,jsonb),cfm_internal.infra_asset_save(jsonb,text),cfm_internal.infra_snapshot_save(jsonb,text),cfm_internal.infra_document_save(jsonb,text),cfm_internal.infra_baseline_save(jsonb,text),cfm_internal.infra_discovery_submit(jsonb,text),cfm_internal.infra_resolve(jsonb,text) to service_role;
