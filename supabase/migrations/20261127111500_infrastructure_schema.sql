set local search_path = public;

create table if not exists public.infra_assets (
 id uuid primary key default gen_random_uuid(),
 kind text not null check (kind in ('vps','website','api','domain','container','compose','reverse_proxy','service','repository','deployment','cloudflare_worker','cloudflare_pages','database','storage','certificate','provider','other')),
 name text not null check (length(name) between 1 and 200),
 status text not null default 'active' check (status in ('active','planned','archived')),
 category text not null default '', tags jsonb not null default '[]' check (jsonb_typeof(tags)='array'),
 description text not null default '', source text not null default 'manual', external_id text not null default '',
 metadata jsonb not null default '{}' check (jsonb_typeof(metadata)='object'),
 observed jsonb not null default '{}' check (jsonb_typeof(observed)='object'),
 observed_source text not null default '', observed_at timestamptz,
 observed_confidence text not null default 'unknown' check(observed_confidence in ('observed','reported','unknown')),
 url text not null default '', provider text not null default '',
 client_id text references public.clients(uuid) on delete set null check(client_id is null or kind='vps'),
 cost numeric check (cost is null or cost>=0), currency text not null default 'USD', billing_cycle text not null default '',
 expires_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index if not exists infra_assets_identity on infra_assets(source,external_id) where external_id<>'';
create unique index if not exists infra_assets_client on infra_assets(client_id) where kind='vps' and client_id is not null;
create index if not exists infra_assets_kind_status on infra_assets(kind,status,updated_at desc);
create index if not exists infra_assets_tags on infra_assets using gin(tags);
create index if not exists infra_assets_search on infra_assets using gin(to_tsvector('simple',name||' '||description));

create table if not exists infra_relationships (
 id uuid primary key default gen_random_uuid(),
 source_id uuid not null references infra_assets(id) on delete cascade,
 target_id uuid not null references infra_assets(id) on delete cascade,
 kind text not null check (kind in ('runs_on','depends_on','routes_to','part_of','deploys','resolves_to','uses','exposes','backs_up','secured_by')),
 description text not null default '', source text not null default 'manual', created_at timestamptz not null default now(),
 unique(source_id,target_id,kind), check(source_id<>target_id)
);
create index if not exists infra_relationships_target on infra_relationships(target_id,kind);
create table if not exists infra_monitor_links (
 asset_id uuid not null references infra_assets(id) on delete cascade,
 monitor_type text not null check(monitor_type in ('website','ping','client')),
 monitor_id text not null, primary key(monitor_type,monitor_id)
);
create index if not exists infra_monitor_links_asset on infra_monitor_links(asset_id);

create table if not exists infra_discovery_runs (
 id uuid primary key default gen_random_uuid(), source text not null, client_id text references clients(uuid) on delete set null,
 collected_at timestamptz not null, complete boolean not null, collectors jsonb not null default '[]',
 asset_count integer not null default 0, created_at timestamptz not null default now(), unique(source,collected_at)
);
create index if not exists infra_discovery_runs_source on infra_discovery_runs(source,collected_at desc);
create table if not exists infra_discovery_candidates (
 id uuid primary key default gen_random_uuid(), source text not null, external_id text not null,
 kind text not null, name text not null, metadata jsonb not null default '{}', evidence jsonb not null default '{}', relations jsonb not null default '[]',
 status text not null default 'pending' check(status in ('pending','imported','ignored','merged')),
 asset_id uuid references infra_assets(id) on delete set null,
 first_seen timestamptz not null default now(), last_seen timestamptz not null,
 missing_since timestamptz, last_run_id uuid references infra_discovery_runs(id) on delete set null,
 unique(source,external_id)
);
create index if not exists infra_discovery_candidates_status on infra_discovery_candidates(status,last_seen desc);
create index if not exists infra_discovery_candidates_asset on infra_discovery_candidates(asset_id);

create table if not exists infra_configuration_snapshots (
 id uuid primary key default gen_random_uuid(), asset_id uuid not null references infra_assets(id) on delete cascade,
 source text not null, collected_at timestamptz not null,
 confidence text not null check(confidence in ('observed','reported','unknown')), environment text not null default '',
 data jsonb not null check(jsonb_typeof(data)='object'), collectors jsonb not null default '[]',
 created_at timestamptz not null default now(), unique(asset_id,source,collected_at)
);
create index if not exists infra_snapshots_asset_time on infra_configuration_snapshots(asset_id,collected_at desc);
create table if not exists infra_changes (
 id uuid primary key default gen_random_uuid(), asset_id uuid references infra_assets(id) on delete set null,
 kind text not null, summary text not null, source text not null,
 verification text not null check(verification in ('observed','claimed','manual')),
 "before" jsonb, "after" jsonb, document_ids jsonb not null default '[]',
 created_at timestamptz not null default now()
);
create index if not exists infra_changes_asset_time on infra_changes(asset_id,created_at desc);
create index if not exists infra_changes_time on infra_changes(created_at desc);

create table if not exists infra_documents (
 id uuid primary key default gen_random_uuid(), slug text not null unique, title text not null,
 category text not null default '', tags jsonb not null default '[]', content text not null,
 environments jsonb not null default '[]', asset_kinds jsonb not null default '[]' check(jsonb_typeof(asset_kinds)='array'),
 risk text not null default 'medium' check(risk in ('low','medium','high')),
 asset_ids jsonb not null default '[]', version integer not null default 1,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists infra_documents_assets on infra_documents using gin(asset_ids);
create index if not exists infra_documents_search on infra_documents using gin(to_tsvector('simple',title||' '||content));
create table if not exists infra_document_versions (
 document_id uuid not null references infra_documents(id) on delete cascade, version integer not null,
 document jsonb not null, actor text not null, created_at timestamptz not null default now(), primary key(document_id,version)
);
create table if not exists infra_baselines (
 id uuid primary key default gen_random_uuid(), name text not null, description text not null default '',
 environments jsonb not null default '[]', asset_kinds jsonb not null default '[]', rules jsonb not null,
 exceptions jsonb not null default '[]', max_age_hours integer not null default 48 check(max_age_hours between 1 and 8760),
 version integer not null default 1, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists infra_baseline_versions (
 baseline_id uuid not null references infra_baselines(id) on delete cascade, version integer not null,
 baseline jsonb not null, actor text not null, created_at timestamptz not null default now(), primary key(baseline_id,version)
);
create table if not exists infra_baseline_evaluations (
 id uuid primary key default gen_random_uuid(), baseline_id uuid not null references infra_baselines(id) on delete cascade,
 asset_id uuid not null references infra_assets(id) on delete cascade, snapshot_id uuid references infra_configuration_snapshots(id) on delete set null,
 baseline_version integer not null, evaluated_at timestamptz not null, status text not null,
 results jsonb not null
);
create index if not exists infra_baseline_evaluations_asset on infra_baseline_evaluations(asset_id,evaluated_at desc);
create index if not exists infra_baseline_evaluations_baseline on infra_baseline_evaluations(baseline_id,evaluated_at desc);

-- Inventory is readable with assets:read. Never copy a monitor's authentication
-- query, fragment or URL userinfo into this less privileged resource family.
create or replace function cfm_internal.inventory_url(value text) returns text language sql immutable set search_path=public as $$
 select case when coalesce(value,'') ~* '^(https?|tcp|dns|wss?)://' then
 regexp_replace(split_part(split_part(value,'?',1),'#',1),'^([a-zA-Z][a-zA-Z0-9+.-]*://)[^/]*@','\1') else '' end;
$$;
revoke all on function cfm_internal.inventory_url(text) from public,anon,authenticated;
grant execute on function cfm_internal.inventory_url(text) to service_role;

-- Existing monitor identities stay stable; inventory is a separate, linked concern.
insert into infra_assets(kind,name,source,external_id,client_id,description,category,tags,cost,currency,billing_cycle,expires_at,observed,observed_source,observed_confidence)
select 'vps',coalesce(nullif(c.name,''),c.uuid),'monitor','client:'||c.uuid,c.uuid,coalesce(c.remark,''),coalesce(c."group",''),coalesce((select jsonb_agg(trim(x)) from unnest(regexp_split_to_array(coalesce(c.tags,''),'[;,]')) x where trim(x)<>''),'[]'::jsonb),case when c.price>=0 then c.price else null end,c.currency,c.billing_cycle::text,
 c.expired_at,
 jsonb_build_object('os',c.os,'kernel',c.kernel_version,'arch',c.arch,'ipv4',c.ipv4,'ipv6',c.ipv6),'monitor','reported'
from clients c on conflict do nothing;
insert into infra_assets(kind,name,source,external_id,url,description,category,tags,metadata)
select distinct on(w.url) 'website',coalesce(nullif(w.name,''),nullif(cfm_internal.inventory_url(w.url),''),'Website '||w.id),'monitor','website:'||md5(w.url),cfm_internal.inventory_url(w.url),w.description,w.category,w.tags,
 jsonb_build_object('domain',w.domain,'deployment',w.deployment,'repository_url',cfm_internal.inventory_url(w.repository_url),'note',w.note)
from website_monitors w order by w.url,w.id on conflict do nothing;
insert into infra_monitor_links(asset_id,monitor_type,monitor_id)
select id,'client',client_id from infra_assets where kind='vps' and client_id is not null on conflict do nothing;
insert into infra_monitor_links(asset_id,monitor_type,monitor_id)
select a.id,'website',w.id::text from website_monitors w join infra_assets a on a.source='monitor' and a.external_id='website:'||md5(w.url) on conflict do nothing;
insert into infra_relationships(source_id,target_id,kind,source)
select l.asset_id,a.id,'runs_on','monitor' from website_monitors w join infra_monitor_links l on l.monitor_type='website' and l.monitor_id=w.id::text join infra_assets a on a.client_id=w.server_uuid and a.kind='vps'
where l.asset_id<>a.id on conflict do nothing;

create or replace function cfm_internal.infra_sync_monitor_relations(aid uuid) returns void language plpgsql set search_path=public as $$
begin
  -- Only monitor-derived deployment edges are reconciled. Other monitors on the
  -- same website asset may still reference the old host, and manual edges win.
  with removed as (delete from infra_relationships r where r.source='monitor' and r.kind='runs_on' and r.source_id=aid
   and not exists(select 1 from infra_monitor_links l join website_monitors w on l.monitor_type='website' and l.monitor_id=w.id::text join infra_assets h on h.kind='vps' and h.client_id=w.server_uuid where l.asset_id=aid and h.id=r.target_id and exists(select 1 from clients where uuid=h.client_id))
   returning r.*)
  insert into infra_changes(asset_id,kind,summary,source,verification,"before","after")
  select source_id,'relationship.removed','Monitor deployment association removed','monitor','manual',to_jsonb(removed),null from removed;
  with added as (insert into infra_relationships(source_id,target_id,kind,source)
   select distinct aid,h.id,'runs_on','monitor' from infra_monitor_links l join website_monitors w on l.monitor_type='website' and l.monitor_id=w.id::text join infra_assets h on h.kind='vps' and h.client_id=w.server_uuid where l.asset_id=aid and h.id<>aid and exists(select 1 from clients where uuid=h.client_id)
   on conflict(source_id,target_id,kind) do nothing returning *)
  insert into infra_changes(asset_id,kind,summary,source,verification,"before","after")
  select source_id,'relationship.added','Monitor deployment association added','monitor','manual',null,to_jsonb(added) from added;
end $$;
revoke all on function cfm_internal.infra_sync_monitor_relations(uuid) from public,anon,authenticated;
grant execute on function cfm_internal.infra_sync_monitor_relations(uuid) to service_role;

create or replace function cfm_internal.sync_monitor_inventory() returns trigger language plpgsql set search_path=public as $$
declare aid uuid; dependent_id uuid;
begin
 if current_setting('cfm.inventory_restore',true)='true' then if tg_op='DELETE' then return old; else return new; end if; end if;
 if tg_op='DELETE' then
  if tg_table_name='clients' then
   select asset_id into aid from infra_monitor_links where monitor_type='client' and monitor_id=old.uuid;
   delete from infra_monitor_links where monitor_type='client' and monitor_id=old.uuid;
   for dependent_id in select source_id from infra_relationships where target_id=aid and source='monitor' and kind='runs_on' loop perform cfm_internal.infra_sync_monitor_relations(dependent_id); end loop;
   return old;
  end if;
  if tg_table_name='ping_tasks' then delete from infra_monitor_links where monitor_type='ping' and monitor_id=old.id::text; return old; end if;
  select asset_id into aid from infra_monitor_links where monitor_type='website' and monitor_id=old.id::text;
  delete from infra_monitor_links where monitor_type='website' and monitor_id=old.id::text;
 elsif tg_table_name='clients' then
  select id into aid from infra_assets where client_id=new.uuid and kind='vps';
  if aid is null then
   insert into infra_assets(kind,name,source,external_id,client_id,observed)
   values('vps',coalesce(nullif(new.name,''),new.uuid),'monitor','client:'||new.uuid,new.uuid,jsonb_build_object('os',new.os,'kernel',new.kernel_version,'arch',new.arch,'ipv4',new.ipv4,'ipv6',new.ipv6)) on conflict(source,external_id) where external_id<>'' do update set client_id=excluded.client_id;
   select id into aid from infra_assets where client_id=new.uuid and kind='vps';
  end if;
  update infra_assets set observed=jsonb_build_object('os',new.os,'kernel',new.kernel_version,'arch',new.arch,'ipv4',new.ipv4,'ipv6',new.ipv6),observed_source='monitor',observed_confidence='reported' where id=aid and observed_source in ('','monitor');
  insert into infra_monitor_links values(aid,'client',new.uuid) on conflict do nothing;
 else
  select asset_id into aid from infra_monitor_links where monitor_type='website' and monitor_id=new.id::text;
  if aid is null then
   insert into infra_assets(kind,name,source,external_id,url,description,category,tags,metadata)
   values('website',coalesce(nullif(new.name,''),nullif(cfm_internal.inventory_url(new.url),''),'Website '||new.id),'monitor','website:'||md5(new.url),cfm_internal.inventory_url(new.url),new.description,new.category,new.tags,jsonb_build_object('domain',new.domain,'deployment',new.deployment,'repository_url',cfm_internal.inventory_url(new.repository_url),'note',new.note)) on conflict do nothing;
   select id into aid from infra_assets where source='monitor' and external_id='website:'||md5(new.url);
   insert into infra_monitor_links values(aid,'website',new.id::text) on conflict do nothing;
  end if;
 end if;
 if tg_table_name='website_monitors' and aid is not null then
  perform cfm_internal.infra_sync_monitor_relations(aid);
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end $$;
revoke all on function cfm_internal.sync_monitor_inventory() from public,anon,authenticated;
drop trigger if exists cfm_clients_inventory on clients;
create trigger cfm_clients_inventory after insert or update of name,os,kernel_version,arch,ipv4,ipv6 or delete on clients for each row execute function cfm_internal.sync_monitor_inventory();
drop trigger if exists cfm_websites_inventory on website_monitors;
create trigger cfm_websites_inventory after insert or update of name,url,server_uuid or delete on website_monitors for each row execute function cfm_internal.sync_monitor_inventory();

drop trigger if exists cfm_pings_inventory on ping_tasks;
create trigger cfm_pings_inventory after delete on ping_tasks for each row execute function cfm_internal.sync_monitor_inventory();

-- No direct anonymous/authenticated access, including inherited PUBLIC privileges.
do $$ declare t text; begin
 foreach t in array array['infra_assets','infra_relationships','infra_monitor_links','infra_discovery_runs','infra_discovery_candidates','infra_configuration_snapshots','infra_changes','infra_documents','infra_document_versions','infra_baselines','infra_baseline_versions','infra_baseline_evaluations'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('alter table public.%I force row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select,insert,update,delete on public.%I to service_role,cf_monitor_app',t);
  execute format('drop policy if exists cf_monitor_app_all on public.%I',t);
  execute format('create policy cf_monitor_app_all on public.%I for all to cf_monitor_app using(true) with check(true)',t);
 end loop;
end $$;

create index if not exists infra_snapshots_retention on infra_configuration_snapshots(created_at);
create index if not exists infra_discovery_runs_retention on infra_discovery_runs(created_at);
