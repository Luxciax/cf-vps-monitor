set local search_path=public;

create or replace function cfm_internal.infra_backup() returns jsonb language sql stable set search_path=public as $$
 select jsonb_build_object(
 'assets',coalesce((select jsonb_agg(to_jsonb(a)) from infra_assets a),'[]'),
 'relationships',coalesce((select jsonb_agg(to_jsonb(a)) from infra_relationships a),'[]'),
 'monitor_links',coalesce((select jsonb_agg(to_jsonb(a)) from infra_monitor_links a),'[]'),
 'documents',coalesce((select jsonb_agg(to_jsonb(a)) from infra_documents a),'[]'),
 'document_versions',coalesce((select jsonb_agg(to_jsonb(a)) from infra_document_versions a),'[]'),
 'baselines',coalesce((select jsonb_agg(to_jsonb(a)) from infra_baselines a),'[]'),
 'baseline_versions',coalesce((select jsonb_agg(to_jsonb(a)) from infra_baseline_versions a),'[]'));
$$;
create or replace function cfm_internal.infra_restore(p jsonb) returns void language plpgsql set search_path=public as $$
declare tbl text; cols text; assignments text;
begin
 if jsonb_typeof(p) is distinct from 'object' then raise exception 'CVM_INVALID: infrastructure backup'; end if;
 foreach tbl in array array['assets','documents','baselines','relationships','monitor_links','document_versions','baseline_versions'] loop
  if jsonb_typeof(p->tbl) is distinct from 'array' then raise exception 'CVM_INVALID: infrastructure backup table %',tbl; end if;
  if jsonb_array_length(p->tbl)>5000 then raise exception 'CVM_INVALID: infrastructure backup table %',tbl; end if;
 end loop;
 -- Older infrastructure exports predate explicit document kind applicability.
 -- Missing means unrestricted, while an explicitly invalid/null value remains
 -- invalid; PostgreSQL record population does not apply column defaults.
 p:=jsonb_set(p,'{documents}',coalesce((select jsonb_agg(d||jsonb_build_object('asset_kinds',coalesce(d->'asset_kinds','[]'::jsonb))) from jsonb_array_elements(p->'documents') d),'[]'::jsonb));
 p:=jsonb_set(p,'{document_versions}',coalesce((select jsonb_agg(v||jsonb_build_object('document',(v->'document')||jsonb_build_object('asset_kinds',coalesce(v#>'{document,asset_kinds}','[]'::jsonb)))) from jsonb_array_elements(p->'document_versions') v),'[]'::jsonb));
 if exists(select 1 from (
   select d->'asset_kinds' as kinds from jsonb_array_elements(p->'documents') d
   union all select v#>'{document,asset_kinds}' from jsonb_array_elements(p->'document_versions') v
  ) rows where jsonb_typeof(kinds) is distinct from 'array') then
  raise exception 'CVM_INVALID: restored document asset kinds';
 end if;
 if exists(select 1 from (
   select d->'asset_kinds' as kinds from jsonb_array_elements(p->'documents') d
   union all select v#>'{document,asset_kinds}' from jsonb_array_elements(p->'document_versions') v
  ) rows cross join lateral jsonb_array_elements_text(kinds) k where k not in ('vps','website','api','domain','container','compose','reverse_proxy','service','repository','deployment','cloudflare_worker','cloudflare_pages','database','storage','certificate','provider','other')) then
  raise exception 'CVM_INVALID: restored document asset kind';
 end if;
 -- Version rows are immutable evidence. Reject a row whose embedded document
 -- describes another identity/revision, including conflicts that an INSERT
 -- ... ON CONFLICT DO NOTHING would otherwise silently hide.
 if exists(select 1 from jsonb_array_elements(p->'document_versions') v where
   (v->>'document_id')::uuid is distinct from (v#>>'{document,id}')::uuid or
   v->>'version' is distinct from v#>>'{document,version}' or
   coalesce(v->>'version','') !~ '^[1-9][0-9]*$') then
  raise exception 'CVM_INVALID: document version identity';
 end if;
 if exists(select 1 from jsonb_array_elements(p->'baseline_versions') v where
   (v->>'baseline_id')::uuid is distinct from (v#>>'{baseline,id}')::uuid or
   v->>'version' is distinct from v#>>'{baseline,version}' or
   coalesce(v->>'version','') !~ '^[1-9][0-9]*$') then
  raise exception 'CVM_INVALID: baseline version identity';
 end if;
 -- Polymorphic monitor references have no SQL foreign key. Check the actual
 -- post-restore monitoring tables before accepting an inventory link.
 if exists(select 1 from jsonb_array_elements(p->'monitor_links') l where not (
   (l->>'monitor_type'='client' and exists(select 1 from clients c where c.uuid=l->>'monitor_id')) or
   (l->>'monitor_type'='website' and exists(select 1 from website_monitors w where w.id::text=l->>'monitor_id')) or
   (l->>'monitor_type'='ping' and exists(select 1 from ping_tasks t where t.id::text=l->>'monitor_id')))) then
  raise exception 'CVM_NOT_FOUND: restored monitor link';
 end if;
 foreach tbl in array array['assets','documents','baselines','relationships','monitor_links','document_versions','baseline_versions'] loop
  select string_agg(quote_ident(attname),',' order by attnum) into cols from pg_attribute where attrelid=('public.infra_'||tbl)::regclass and attnum>0 and not attisdropped;
  if tbl='monitor_links' then
   insert into infra_monitor_links select * from jsonb_populate_recordset(null::infra_monitor_links,p->tbl) on conflict(monitor_type,monitor_id) do update set asset_id=excluded.asset_id;
  elsif tbl in ('document_versions','baseline_versions') then
   execute format('insert into infra_%I(%s) select %s from jsonb_populate_recordset(null::infra_%I,$1) on conflict do nothing',tbl,cols,cols,tbl) using p->tbl;
  else
   select string_agg(format('%I=excluded.%I',attname,attname),',' order by attnum) into assignments from pg_attribute where attrelid=('public.infra_'||tbl)::regclass and attnum>0 and not attisdropped and attname not in ('id','created_at','version');
   if tbl in ('documents','baselines') then assignments:=assignments||format(',version=greatest(infra_%I.version,excluded.version)+1',tbl); end if;
   execute format('insert into infra_%I(%s) select %s from jsonb_populate_recordset(null::infra_%I,$1) on conflict(id) do update set %s',tbl,cols,cols,tbl,assignments) using p->tbl;
  end if;
 end loop;
 -- Current JSON relationships must point at real resources. Historical
 -- revision contents remain historical; their parent identity is constrained
 -- above and by the version-table foreign keys.
 if exists(select 1 from infra_documents d cross join lateral jsonb_array_elements_text(d.asset_ids) a
   where d.id in(select (x->>'id')::uuid from jsonb_array_elements(p->'documents') x)
   and not exists(select 1 from infra_assets target where target.id=a::uuid)) then
  raise exception 'CVM_NOT_FOUND: restored document asset';
 end if;
 if exists(select 1 from infra_baselines b cross join lateral jsonb_array_elements(b.exceptions) e
   where b.id in(select (x->>'id')::uuid from jsonb_array_elements(p->'baselines') x)
   and not exists(select 1 from infra_assets target where target.id=(e->>'asset_id')::uuid)) then
  raise exception 'CVM_NOT_FOUND: restored baseline exception asset';
 end if;
 if exists(select 1 from infra_baselines b cross join lateral jsonb_array_elements(b.rules) r
   where b.id in(select (x->>'id')::uuid from jsonb_array_elements(p->'baselines') x)
   and r ? 'sop_id' and not exists(select 1 from infra_documents target where target.id=(r->>'sop_id')::uuid)) then
  raise exception 'CVM_NOT_FOUND: restored baseline SOP';
 end if;
 if exists(select 1 from infra_baselines b cross join lateral jsonb_array_elements(b.exceptions) e
   where b.id in(select (x->>'id')::uuid from jsonb_array_elements(p->'baselines') x)
   and not exists(select 1 from jsonb_array_elements(b.rules) r where r->>'id'=e->>'rule_id')) then
  raise exception 'CVM_INVALID: restored baseline exception rule';
 end if;
 if exists(select 1 from infra_monitor_links l join infra_assets a on a.id=l.asset_id
   where l.monitor_type='client' and (a.kind<>'vps' or a.client_id is distinct from l.monitor_id)) or
   exists(select 1 from infra_assets a where a.client_id is not null and
     (a.kind<>'vps' or not exists(select 1 from infra_monitor_links l where l.asset_id=a.id and l.monitor_type='client' and l.monitor_id=a.client_id))) or
   exists(select 1 from clients c where not exists(select 1 from infra_assets a join infra_monitor_links l on l.asset_id=a.id and l.monitor_type='client' and l.monitor_id=c.uuid where a.kind='vps' and a.client_id=c.uuid)) then
  raise exception 'CVM_CONFLICT: restored client identity binding';
 end if;
 insert into infra_document_versions(document_id,version,document,actor) select id,version,to_jsonb(d),'backup-restore' from infra_documents d where id in(select (x->>'id')::uuid from jsonb_array_elements(p->'documents') x) on conflict do nothing;
 insert into infra_baseline_versions(baseline_id,version,baseline,actor) select id,version,to_jsonb(b),'backup-restore' from infra_baselines b where id in(select (x->>'id')::uuid from jsonb_array_elements(p->'baselines') x) on conflict do nothing;
end $$;
revoke all on function cfm_internal.infra_backup(),cfm_internal.infra_restore(jsonb) from public,anon,authenticated;
grant execute on function cfm_internal.infra_backup(),cfm_internal.infra_restore(jsonb) to service_role;

create or replace function public.cfm_backup_configuration_snapshot()
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'settings', public.cfm_public_settings(),
    'clients', public.cfm_admin_clients(),
    'ping_tasks', public.cfm_public_ping_tasks(),
    'offline_notifications', public.cfm_offline_notifications(),
    'expiry_notifications', public.cfm_expiry_notifications(),
    'load_notifications', public.cfm_load_notifications(),
    'website_monitors', public.cfm_website_monitors(),
    'infrastructure', cfm_internal.infra_backup()
  );
$$;
create or replace function public.cfm_restore_backup_data(input_backup jsonb)
returns void
language plpgsql
set search_path = public
as $$
declare
  item jsonb;
  client_ids text[];
  task_ids bigint[];
  website_ids bigint[];
begin
  if input_backup is null or jsonb_typeof(input_backup) <> 'object' then
    raise exception 'backup must be a JSON object';
  end if;

  if input_backup ? 'infrastructure' then perform set_config('cfm.inventory_restore','true',true); end if;

  if input_backup ? 'settings' and jsonb_typeof(input_backup->'settings') = 'object' then
    insert into settings (key, value)
    select key, value
    from jsonb_each_text(input_backup->'settings')
    where trim(key) <> ''
    on conflict (key) do update set value = excluded.value;
  end if;

  if input_backup ? 'clients' and jsonb_typeof(input_backup->'clients') = 'array' then
    select coalesce(array_agg(uuid), array[]::text[]) into client_ids
    from (
      select nullif(trim(value->>'uuid'), '') as uuid
      from jsonb_array_elements(input_backup->'clients')
    ) rows
    where uuid is not null;

    delete from records where not (client = any(client_ids));
    delete from gpu_records where not (client = any(client_ids));
    delete from gpu_snapshots where not (client = any(client_ids));
    delete from ping_records where not (client = any(client_ids));
    delete from ping_snapshots where not (client = any(client_ids));
    delete from offline_notifications where not (client = any(client_ids));
    delete from expiry_notifications where not (client = any(client_ids));
    delete from clients where not (uuid = any(client_ids));

    for item in select value from jsonb_array_elements(input_backup->'clients')
    loop
      if nullif(trim(item->>'uuid'), '') is null then
        continue;
      end if;

      insert into clients (
        uuid, token, token_hash, token_last_used_at, token_last_used_ip, token_rotated_at,
        name, cpu_name, virtualization, arch, cpu_cores, os, kernel_version, gpu_name,
        ipv4, ipv6, region, remark, public_remark, mem_total, swap_total, disk_total,
        version, price, billing_cycle, auto_renewal, currency, expired_at, "group", tags,
        hidden, traffic_limit, traffic_limit_type, traffic_reset_day, sort_order, created_at, updated_at
      )
      values (
        item->>'uuid',
        nullif(item->>'token', ''),
        nullif(item->>'token_hash', ''),
        nullif(item->>'token_last_used_at', '')::timestamptz,
        coalesce(item->>'token_last_used_ip', ''),
        nullif(item->>'token_rotated_at', '')::timestamptz,
        coalesce(item->>'name', ''),
        coalesce(item->>'cpu_name', ''),
        coalesce(item->>'virtualization', ''),
        coalesce(item->>'arch', ''),
        coalesce((item->>'cpu_cores')::integer, 0),
        coalesce(item->>'os', ''),
        coalesce(item->>'kernel_version', ''),
        coalesce(item->>'gpu_name', ''),
        coalesce(item->>'ipv4', ''),
        coalesce(item->>'ipv6', ''),
        coalesce(item->>'region', ''),
        coalesce(item->>'remark', ''),
        coalesce(item->>'public_remark', ''),
        coalesce((item->>'mem_total')::bigint, 0),
        coalesce((item->>'swap_total')::bigint, 0),
        coalesce((item->>'disk_total')::bigint, 0),
        coalesce(item->>'version', ''),
        coalesce((item->>'price')::double precision, 0),
        coalesce((item->>'billing_cycle')::smallint, 0),
        case when coalesce((item->>'auto_renewal')::boolean, false) then 1 else 0 end,
        coalesce(item->>'currency', '$'),
        nullif(item->>'expired_at', '')::timestamptz,
        coalesce(item->>'group', ''),
        coalesce(item->>'tags', ''),
        case when coalesce((item->>'hidden')::boolean, false) then 1 else 0 end,
        coalesce((item->>'traffic_limit')::bigint, 0),
        -- 兜底值与 cfm_create_client / cfm_update_client 保持一致（'sum'）；
        -- 还原路径漏改会让从旧备份恢复的节点静默回到 'max' 口径。
        coalesce(nullif(item->>'traffic_limit_type', ''), 'sum'),
        -- 缺省补 1 并钳到 1~31：列上有 check 约束，直接写 0 会让整个还原事务失败。
        least(greatest(coalesce((item->>'traffic_reset_day')::smallint, 1), 1), 31),
        coalesce((item->>'sort_order')::integer, 0),
        coalesce(nullif(item->>'created_at', '')::timestamptz, now()),
        coalesce(nullif(item->>'updated_at', '')::timestamptz, now())
      )
      on conflict (uuid) do update set
        token = excluded.token,
        token_hash = excluded.token_hash,
        token_last_used_at = excluded.token_last_used_at,
        token_last_used_ip = excluded.token_last_used_ip,
        token_rotated_at = excluded.token_rotated_at,
        name = excluded.name,
        cpu_name = excluded.cpu_name,
        virtualization = excluded.virtualization,
        arch = excluded.arch,
        cpu_cores = excluded.cpu_cores,
        os = excluded.os,
        kernel_version = excluded.kernel_version,
        gpu_name = excluded.gpu_name,
        ipv4 = excluded.ipv4,
        ipv6 = excluded.ipv6,
        region = excluded.region,
        remark = excluded.remark,
        public_remark = excluded.public_remark,
        mem_total = excluded.mem_total,
        swap_total = excluded.swap_total,
        disk_total = excluded.disk_total,
        version = excluded.version,
        price = excluded.price,
        billing_cycle = excluded.billing_cycle,
        auto_renewal = excluded.auto_renewal,
        currency = excluded.currency,
        expired_at = excluded.expired_at,
        "group" = excluded."group",
        tags = excluded.tags,
        hidden = excluded.hidden,
        traffic_limit = excluded.traffic_limit,
        traffic_limit_type = excluded.traffic_limit_type,
        traffic_reset_day = excluded.traffic_reset_day,
        sort_order = excluded.sort_order,
        updated_at = now();
      perform cfm_internal.retire_client_notification_deliveries(item->>'uuid');
    end loop;
  end if;

  if input_backup ? 'website_monitors' then
    if jsonb_typeof(input_backup->'website_monitors') <> 'array' then
      raise exception 'website_monitors must be an array';
    end if;
    if exists (
      select 1 from jsonb_array_elements(input_backup->'website_monitors') row_data
      where jsonb_typeof(row_data) <> 'object'
        or (row_data ? 'id' and (coalesce(row_data->>'id', '') !~ '^[1-9][0-9]*$'
          or (row_data->>'id')::numeric > 9007199254740991))
    ) then
      raise exception 'invalid website monitor identity';
    end if;
    if exists (
      select (value->>'id')::bigint
      from jsonb_array_elements(input_backup->'website_monitors')
      where value ? 'id'
      group by (value->>'id')::bigint having count(*) > 1
    ) then
      raise exception 'duplicate website monitor identity';
    end if;
    select coalesce(array_agg((value->>'id')::bigint), array[]::bigint[])
      into website_ids
    from jsonb_array_elements(input_backup->'website_monitors') where value ? 'id';

    -- setval is not rolled back: never move below existing or already allocated
    -- identities, even if a later module rejects the transaction. Serialize
    -- writers while reserving explicit IDs ahead of entries without an ID.
    lock table website_monitors in share row exclusive mode;
    perform setval(pg_get_serial_sequence('website_monitors', 'id'),
      greatest(
        coalesce((select max(id) from website_monitors), 0) + 1,
        coalesce((select max(id) from unnest(website_ids) as restored(id)), 0) + 1,
        nextval(pg_get_serial_sequence('website_monitors', 'id'))
      ), false);
    delete from website_monitors where not (id = any(website_ids));

    for item in select value from jsonb_array_elements(input_backup->'website_monitors')
    loop
      if item ? 'agent_probe_clients' and jsonb_typeof(item->'agent_probe_clients') <> 'array' then
        raise exception 'website monitor agents must be an array';
      end if;
      if exists (
        select 1 from jsonb_array_elements_text(coalesce(item->'agent_probe_clients', '[]'::jsonb)) as agents(uuid)
        where not exists (select 1 from clients where clients.uuid = agents.uuid)
      ) then
        raise exception 'website monitor references an unknown agent';
      end if;
      insert into website_monitors (
        id, check_config, name, url, method, expected_status_min, expected_status_max,
        interval_sec, timeout_sec, grace_period_sec, enabled, hidden, hide_url, description, category, tags, icon, server_uuid, domain, deployment, repository_url, note,
        agent_probe_mode, agent_probe_clients, agent_probe_limit, agent_probe_status_enabled,
        sort_order, status
      ) values (
        coalesce((item->>'id')::bigint, nextval(pg_get_serial_sequence('website_monitors', 'id'))),
        coalesce(item->'check_config','{}'::jsonb), coalesce(item->>'name', ''), coalesce(item->>'url', ''), coalesce(item->>'method', 'GET'),
        coalesce((item->>'expected_status_min')::integer, 200),
        coalesce((item->>'expected_status_max')::integer, 399),
        coalesce((item->>'interval_sec')::integer, 120), coalesce((item->>'timeout_sec')::integer, 10),
        coalesce((item->>'grace_period_sec')::integer, 180), coalesce((item->>'enabled')::boolean, true),
        coalesce((item->>'hidden')::boolean, false), coalesce((item->>'hide_url')::boolean, false),
        coalesce(item->>'description', ''), coalesce(item->>'category', ''), coalesce(item->'tags', '[]'::jsonb),
        coalesce(item->>'icon', ''), nullif(item->>'server_uuid', ''), coalesce(item->>'domain', ''),
        coalesce(item->>'deployment', ''), coalesce(item->>'repository_url', ''), coalesce(item->>'note', ''),
        coalesce(item->>'agent_probe_mode', 'off'), coalesce(item->'agent_probe_clients', '[]'::jsonb),
        coalesce((item->>'agent_probe_limit')::integer, 3),
        coalesce((item->>'agent_probe_status_enabled')::boolean, true),
        coalesce((item->>'sort_order')::integer, 0),
        case when coalesce((item->>'enabled')::boolean, true) then 'pending' else 'paused' end
      )
      on conflict (id) do update set
        check_config = excluded.check_config, name = excluded.name, url = excluded.url, method = excluded.method,
        expected_status_min = excluded.expected_status_min, expected_status_max = excluded.expected_status_max,
        interval_sec = excluded.interval_sec, timeout_sec = excluded.timeout_sec,
        grace_period_sec = excluded.grace_period_sec, enabled = excluded.enabled,
        hidden = excluded.hidden, hide_url = excluded.hide_url, description = excluded.description, category = excluded.category, tags = excluded.tags, icon = excluded.icon, server_uuid = excluded.server_uuid, domain = excluded.domain, deployment = excluded.deployment, repository_url = excluded.repository_url, note = excluded.note,
        agent_probe_mode = excluded.agent_probe_mode, agent_probe_clients = excluded.agent_probe_clients,
        agent_probe_limit = excluded.agent_probe_limit, agent_probe_status_enabled = excluded.agent_probe_status_enabled,
        sort_order = excluded.sort_order, status = excluded.status,
        config_revision = excluded.config_revision,
        last_checked_at = null, last_success_at = null, last_failure_at = null,
        last_status_code = null, last_raw_status_code = null, last_latency_ms = null,
        last_effective_reason = null, last_error = null, down_since = null,
        last_notified_at = null, updated_at = now();
    end loop;
  end if;

  if input_backup ? 'ping_tasks' and jsonb_typeof(input_backup->'ping_tasks') = 'array' then
    select coalesce(array_agg(id), array[]::bigint[]) into task_ids
    from (
      select (value->>'id')::bigint as id
      from jsonb_array_elements(input_backup->'ping_tasks')
      where coalesce(value->>'id', '') ~ '^[0-9]+$'
        and (value->>'id')::bigint > 0
    ) rows;

    lock table ping_tasks in share row exclusive mode;
    perform setval(pg_get_serial_sequence('ping_tasks', 'id'),
      greatest(
        coalesce((select max(id) from ping_tasks), 0) + 1,
        coalesce((select max(id) from unnest(task_ids) as restored(id)), 0) + 1,
        nextval(pg_get_serial_sequence('ping_tasks', 'id'))
      ), false);
    if coalesce(array_length(task_ids, 1), 0) > 0 then
      delete from ping_tasks where not (id = any(task_ids));
    else
      delete from ping_tasks where true;
    end if;

    for item in select value from jsonb_array_elements(input_backup->'ping_tasks')
    loop
      if coalesce(item->>'id', '') ~ '^[0-9]+$' and (item->>'id')::bigint > 0 then
        insert into ping_tasks (id, name, clients, all_clients, type, target, interval_sec, sort_order)
        values (
          (item->>'id')::bigint,
          coalesce(item->>'name', ''),
          case when jsonb_typeof(item->'clients') = 'array' then item->'clients' else '[]'::jsonb end,
          case when coalesce((item->>'all_clients')::boolean, false) then 1 else 0 end,
          coalesce(item->>'type', 'icmp'),
          coalesce(item->>'target', ''),
          coalesce((item->>'interval_sec')::integer, 120),
          coalesce((item->>'sort_order')::integer, (item->>'id')::integer)
        )
        on conflict (id) do update set
          name = excluded.name,
          clients = excluded.clients,
          all_clients = excluded.all_clients,
          type = excluded.type,
          target = excluded.target,
          interval_sec = excluded.interval_sec,
          sort_order = excluded.sort_order;
      else
        insert into ping_tasks (name, clients, all_clients, type, target, interval_sec, sort_order)
        values (
          coalesce(item->>'name', ''),
          case when jsonb_typeof(item->'clients') = 'array' then item->'clients' else '[]'::jsonb end,
          case when coalesce((item->>'all_clients')::boolean, false) then 1 else 0 end,
          coalesce(item->>'type', 'icmp'),
          coalesce(item->>'target', ''),
          coalesce((item->>'interval_sec')::integer, 120),
          coalesce((item->>'sort_order')::integer, 0)
        );
      end if;
    end loop;
  end if;

  if input_backup ? 'offline_notifications' and jsonb_typeof(input_backup->'offline_notifications') = 'array' then
    delete from offline_notifications where true;
    insert into offline_notifications (client, enable, grace_period, last_notified)
    select
      value->>'client',
      case when coalesce((value->>'enable')::boolean, false) then 1 else 0 end,
      coalesce((value->>'grace_period')::integer, 180),
      nullif(value->>'last_notified', '')::timestamptz
    from jsonb_array_elements(input_backup->'offline_notifications')
    where nullif(value->>'client', '') is not null;
  end if;

  if input_backup ? 'expiry_notifications' and jsonb_typeof(input_backup->'expiry_notifications') = 'array' then
    delete from expiry_notifications where true;
    insert into expiry_notifications (client, enable, advance_days, last_notified)
    select
      value->>'client',
      case when coalesce((value->>'enable')::boolean, false) then 1 else 0 end,
      coalesce((value->>'advance_days')::integer, 7),
      nullif(value->>'last_notified', '')::timestamptz
    from jsonb_array_elements(input_backup->'expiry_notifications')
    where nullif(value->>'client', '') is not null;
  end if;

  if input_backup ? 'load_notifications' and jsonb_typeof(input_backup->'load_notifications') = 'array' then
    lock table load_notifications in share row exclusive mode;
    perform setval(pg_get_serial_sequence('load_notifications', 'id'),
      greatest(
        coalesce((select max(id) from load_notifications), 0) + 1,
        coalesce((select max(case when coalesce(value->>'id', '') ~ '^[0-9]+$'
          then (value->>'id')::bigint else 0 end)
          from jsonb_array_elements(input_backup->'load_notifications')), 0) + 1,
        nextval(pg_get_serial_sequence('load_notifications', 'id'))
      ), false);
    delete from load_notifications where true;
    for item in select value from jsonb_array_elements(input_backup->'load_notifications')
    loop
      if coalesce(item->>'id', '') ~ '^[0-9]+$' and (item->>'id')::bigint > 0 then
        insert into load_notifications (id, name, clients, metric, threshold, ratio, interval_min, last_notified)
        values (
          (item->>'id')::bigint,
          coalesce(item->>'name', ''),
          case when jsonb_typeof(item->'clients') = 'array' then item->'clients' else '[]'::jsonb end,
          coalesce(item->>'metric', 'cpu'),
          coalesce((item->>'threshold')::double precision, 80),
          coalesce((item->>'ratio')::double precision, 0.8),
          coalesce((item->>'interval_min')::integer, 15),
          nullif(item->>'last_notified', '')::timestamptz
        );
      else
        insert into load_notifications (name, clients, metric, threshold, ratio, interval_min, last_notified)
        values (
          coalesce(item->>'name', ''),
          case when jsonb_typeof(item->'clients') = 'array' then item->'clients' else '[]'::jsonb end,
          coalesce(item->>'metric', 'cpu'),
          coalesce((item->>'threshold')::double precision, 80),
          coalesce((item->>'ratio')::double precision, 0.8),
          coalesce((item->>'interval_min')::integer, 15),
          nullif(item->>'last_notified', '')::timestamptz
        );
      end if;
    end loop;
  end if;
  -- The inventory synchronization trigger is paused while complete monitor
  -- modules are replaced. Remove links to deliberately removed monitors, but
  -- never delete the formal inventory asset or accept invalid incoming links.
  if input_backup ? 'clients' then
    delete from infra_monitor_links l where l.monitor_type='client' and not exists(select 1 from clients c where c.uuid=l.monitor_id);
  end if;
  if input_backup ? 'website_monitors' then
    delete from infra_monitor_links l where l.monitor_type='website' and not exists(select 1 from website_monitors w where w.id::text=l.monitor_id);
  end if;
  if input_backup ? 'ping_tasks' then
    delete from infra_monitor_links l where l.monitor_type='ping' and not exists(select 1 from ping_tasks t where t.id::text=l.monitor_id);
  end if;
  if input_backup ? 'infrastructure' then perform cfm_internal.infra_restore(input_backup->'infrastructure'); end if;
  if input_backup ? 'infrastructure' or input_backup ? 'website_monitors' or input_backup ? 'clients' then
    perform cfm_internal.infra_sync_monitor_relations(affected.asset_id) from (
      select distinct asset_id from infra_monitor_links where monitor_type='website'
      union select source_id from infra_relationships where source='monitor' and kind='runs_on'
    ) affected;
  end if;
  perform set_config('cfm.inventory_restore','false',true);
end;
$$;
