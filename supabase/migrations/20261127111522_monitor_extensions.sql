set local search_path=public;
alter table website_monitors add column if not exists check_config jsonb not null default '{}' check(jsonb_typeof(check_config)='object');
alter table website_checks add column if not exists details jsonb not null default '{}' check(jsonb_typeof(details)='object');
alter table website_monitors add column if not exists tls_expires_at timestamptz;
alter table website_monitors add column if not exists tls_observed_at timestamptz;
alter table website_monitors add column if not exists tls_notification_expires_at timestamptz;

create or replace function public.cfm_create_website_monitor(input_monitor jsonb)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  created_row website_monitors%rowtype;
begin
  insert into website_monitors (
    check_config, name, url, method, expected_status_min, expected_status_max,
    interval_sec, timeout_sec, grace_period_sec, enabled, hidden, hide_url,
    agent_probe_mode, agent_probe_clients, agent_probe_limit, agent_probe_status_enabled,
    description, category, tags, icon, server_uuid, domain, deployment, repository_url, note,
    sort_order
  ) values (
    coalesce(input_monitor->'check_config','{}'::jsonb),
    coalesce(input_monitor->>'name', ''),
    coalesce(input_monitor->>'url', ''),
    coalesce(input_monitor->>'method', 'GET'),
    coalesce((input_monitor->>'expected_status_min')::integer, 200),
    coalesce((input_monitor->>'expected_status_max')::integer, 399),
    coalesce((input_monitor->>'interval_sec')::integer, 120),
    coalesce((input_monitor->>'timeout_sec')::integer, 10),
    coalesce((input_monitor->>'grace_period_sec')::integer, 180),
    coalesce((input_monitor->>'enabled')::boolean, true),
    coalesce((input_monitor->>'hidden')::boolean, false),
    coalesce((input_monitor->>'hide_url')::boolean, false),
    case when input_monitor->>'agent_probe_mode' in ('off', 'selected', 'country_auto') then input_monitor->>'agent_probe_mode' else 'country_auto' end,
    case when input_monitor ? 'agent_probe_clients' and jsonb_typeof(input_monitor->'agent_probe_clients') = 'array' then input_monitor->'agent_probe_clients' else '[]'::jsonb end,
    least(greatest(coalesce((input_monitor->>'agent_probe_limit')::integer, 3), 1), 10),
    coalesce((input_monitor->>'agent_probe_status_enabled')::boolean, true),
    coalesce(input_monitor->>'description', ''),
    coalesce(input_monitor->>'category', ''),
    case when input_monitor ? 'tags' and jsonb_typeof(input_monitor->'tags') = 'array' then input_monitor->'tags' else '[]'::jsonb end,
    coalesce(input_monitor->>'icon', ''),
    nullif(input_monitor->>'server_uuid', ''),
    coalesce(input_monitor->>'domain', ''),
    coalesce(input_monitor->>'deployment', ''),
    coalesce(input_monitor->>'repository_url', ''),
    coalesce(input_monitor->>'note', ''),
    (select coalesce(max(sort_order), 0) + 1 from website_monitors)
  )
  returning * into created_row;

  return to_jsonb(created_row);
end;
$$;

create or replace function public.cfm_update_website_monitor(input_id integer, input_monitor jsonb)
returns jsonb
language sql
set search_path = public
as $$
  update website_monitors
  set
    check_config = coalesce(input_monitor->'check_config',check_config),    name = coalesce(input_monitor->>'name', name),
    url = coalesce(input_monitor->>'url', url),
    method = coalesce(input_monitor->>'method', method),
    expected_status_min = coalesce((input_monitor->>'expected_status_min')::integer, expected_status_min),
    expected_status_max = coalesce((input_monitor->>'expected_status_max')::integer, expected_status_max),
    interval_sec = coalesce((input_monitor->>'interval_sec')::integer, interval_sec),
    timeout_sec = coalesce((input_monitor->>'timeout_sec')::integer, timeout_sec),
    grace_period_sec = coalesce((input_monitor->>'grace_period_sec')::integer, grace_period_sec),
    enabled = case when input_monitor ? 'enabled' then coalesce((input_monitor->>'enabled')::boolean, enabled) else enabled end,
    hidden = case when input_monitor ? 'hidden' then coalesce((input_monitor->>'hidden')::boolean, hidden) else hidden end,
    hide_url = case when input_monitor ? 'hide_url' then coalesce((input_monitor->>'hide_url')::boolean, hide_url) else hide_url end,
    agent_probe_mode = case when input_monitor->>'agent_probe_mode' in ('off', 'selected', 'country_auto') then input_monitor->>'agent_probe_mode' else agent_probe_mode end,
    agent_probe_clients = case when input_monitor ? 'agent_probe_clients' and jsonb_typeof(input_monitor->'agent_probe_clients') = 'array' then input_monitor->'agent_probe_clients' else agent_probe_clients end,
    agent_probe_limit = case when input_monitor ? 'agent_probe_limit' then least(greatest(coalesce((input_monitor->>'agent_probe_limit')::integer, agent_probe_limit), 1), 10) else agent_probe_limit end,
    agent_probe_status_enabled = case when input_monitor ? 'agent_probe_status_enabled' then coalesce((input_monitor->>'agent_probe_status_enabled')::boolean, agent_probe_status_enabled) else agent_probe_status_enabled end,
    description = coalesce(input_monitor->>'description', description),
    category = coalesce(input_monitor->>'category', category),
    tags = case when input_monitor ? 'tags' and jsonb_typeof(input_monitor->'tags') = 'array' then input_monitor->'tags' else tags end,
    icon = coalesce(input_monitor->>'icon', icon),
    server_uuid = case when input_monitor ? 'server_uuid' then nullif(input_monitor->>'server_uuid', '') else server_uuid end,
    domain = coalesce(input_monitor->>'domain', domain),
    deployment = coalesce(input_monitor->>'deployment', deployment),
    repository_url = coalesce(input_monitor->>'repository_url', repository_url),
    note = coalesce(input_monitor->>'note', note),
    updated_at = now()
  where id = input_id
  returning to_jsonb(website_monitors.*);
$$;

create or replace function public.cfm_record_website_check(input_check jsonb)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  monitor_row website_monitors%rowtype;
  check_ok boolean;
  checked_time timestamptz;
  source_kind text;
  source_client_id text;
begin
  if input_check is null or jsonb_typeof(input_check) <> 'object' then
    return null;
  end if;

  check_ok := coalesce((input_check->>'ok')::boolean, false);
  checked_time := coalesce((input_check->>'checked_at')::timestamptz, now());
  source_kind := coalesce(nullif(input_check->>'source_type', ''), 'worker');
  if source_kind not in ('worker', 'agent') then
    source_kind := 'worker';
  end if;
  source_client_id := nullif(input_check->>'source_client', '');

  select * into monitor_row
  from website_monitors
  where id = (input_check->>'monitor_id')::integer
  for update;
  if not found then
    return null;
  end if;

  -- Lock first: an administrator edit and a result commit must not both
  -- succeed from the same old observation. Reject ties before history insert.
  if exists(select 1 from jsonb_array_elements(coalesce(monitor_row.check_config->'maintenance','[]')) w where checked_time >= (w->>'start')::timestamptz and checked_time < (w->>'end')::timestamptz) then return null; end if;

  if not monitor_row.enabled
    or monitor_row.config_revision::text is distinct from input_check->>'config_revision'
    or (monitor_row.last_checked_at is not null and checked_time <= monitor_row.last_checked_at)
    or exists (
      select 1 from website_checks previous
      where previous.monitor_id = monitor_row.id
        and previous.config_revision = monitor_row.config_revision
        and previous.source_type = source_kind
        and previous.source_client is not distinct from source_client_id
        and previous.checked_at >= checked_time
    ) then
    return null;
  end if;

  insert into website_checks (
    monitor_id, config_revision, checked_at, ok, effective_status, effective_reason,
    status_code, raw_status_code, latency_ms, error, source_type, source_client, details
  )
  values (
    monitor_row.id,
    monitor_row.config_revision,
    checked_time,
    check_ok,
    case when input_check->>'effective_status' = 'up' then 'up' else 'down' end,
    input_check->>'effective_reason',
    nullif(input_check->>'status_code', '')::integer,
    nullif(input_check->>'raw_status_code', '')::integer,
    nullif(input_check->>'latency_ms', '')::integer,
    input_check->>'error',
    source_kind,
    source_client_id,
    coalesce(input_check->'details','{}'::jsonb)
  );

  if source_kind='agent' and input_check#>>'{details,tls_expires_at}' is not null then
    update website_monitors set tls_expires_at=(input_check#>>'{details,tls_expires_at}')::timestamptz,tls_observed_at=checked_time where id=monitor_row.id;
  end if;

  if source_kind = 'agent' and monitor_row.agent_probe_status_enabled = true and check_ok = false then
    if exists (
      select 1
      from website_checks recent_agent_success
      where recent_agent_success.monitor_id = monitor_row.id
        and recent_agent_success.config_revision = monitor_row.config_revision
        and recent_agent_success.source_type = 'agent'
        and recent_agent_success.effective_status = 'up'
        and recent_agent_success.checked_at >= checked_time - (greatest(monitor_row.interval_sec + 30, monitor_row.grace_period_sec, 180) * interval '1 second')
      limit 1
    ) then
      return null;
    end if;
    return to_jsonb(monitor_row);
  end if;

  if check_ok then
    update website_monitors
    set status = 'up',
        last_checked_at = checked_time,
        last_success_at = checked_time,
        last_status_code = nullif(input_check->>'status_code', '')::integer,
        last_raw_status_code = nullif(input_check->>'raw_status_code', '')::integer,
        last_latency_ms = nullif(input_check->>'latency_ms', '')::integer,
        last_effective_reason = input_check->>'effective_reason',
        last_error = null,
        down_since = null,
        updated_at = now()
    where id = (input_check->>'monitor_id')::integer
    returning * into monitor_row;
  else
    update website_monitors
    set status = 'down',
        last_checked_at = checked_time,
        last_failure_at = checked_time,
        last_status_code = nullif(input_check->>'status_code', '')::integer,
        last_raw_status_code = nullif(input_check->>'raw_status_code', '')::integer,
        last_latency_ms = nullif(input_check->>'latency_ms', '')::integer,
        last_effective_reason = input_check->>'effective_reason',
        last_error = input_check->>'error',
        down_since = coalesce(down_since, checked_time),
        last_notified_at = case when status = 'down' then last_notified_at else null end,
        updated_at = now()
    where id = (input_check->>'monitor_id')::integer
    returning * into monitor_row;
  end if;

  if not found then
    return null;
  end if;
  return to_jsonb(monitor_row);
end;
$$;

create or replace function cfm_internal.rotate_website_config_revision()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.url is distinct from old.url or new.method is distinct from old.method then
    new.tls_expires_at:=null; new.tls_observed_at:=null; new.tls_notification_expires_at:=null;
  end if;
  if new.config_revision is distinct from old.config_revision
    or row(new.check_config - array['maintenance','silenced_until','tls_warning_days'],new.url, new.method, new.expected_status_min, new.expected_status_max,
      new.interval_sec, new.timeout_sec, new.grace_period_sec, new.enabled,
      new.agent_probe_mode, new.agent_probe_clients, new.agent_probe_limit, new.agent_probe_status_enabled)
    is distinct from row(old.check_config - array['maintenance','silenced_until','tls_warning_days'],old.url, old.method, old.expected_status_min, old.expected_status_max,
      old.interval_sec, old.timeout_sec, old.grace_period_sec, old.enabled,
      old.agent_probe_mode, old.agent_probe_clients, old.agent_probe_limit, old.agent_probe_status_enabled)
  then
    new.config_revision := gen_random_uuid();
    new.status := case when new.enabled then 'pending' else 'paused' end;
    new.last_checked_at := null;
    new.last_success_at := null;
    new.last_failure_at := null;
    new.last_status_code := null;
    new.last_raw_status_code := null;
    new.last_latency_ms := null;
    new.last_effective_reason := null;
    new.last_error := null;
    new.down_since := null;
    new.last_notified_at := null;
  end if;
  return new;
end;
$$;
create or replace function public.cfm_mark_certificate_notified(input_monitor_id integer,input_expires_at timestamptz,input_config_revision uuid) returns boolean language plpgsql set search_path=public as $$
begin
 update website_monitors set tls_notification_expires_at=input_expires_at where id=input_monitor_id and tls_expires_at=input_expires_at and config_revision=input_config_revision;
 return found;
end $$;
revoke all on function public.cfm_mark_certificate_notified(integer,timestamptz,uuid) from public,anon,authenticated;
grant execute on function public.cfm_mark_certificate_notified(integer,timestamptz,uuid) to service_role;

create or replace function public.cfm_agent_website_probe_tasks(input_client text, input_now text, input_limit integer default 20)
returns jsonb
language sql
stable
set search_path = public
as $$
  with args as (
    select
      nullif(input_client, '') as client_id,
      least(greatest(coalesce(input_limit, 20), 1), 50) as safe_limit
  ),
  selected as (
    select id, check_config, config_revision, name, url, method, expected_status_min, expected_status_max, interval_sec,
      timeout_sec, grace_period_sec, enabled, hidden, agent_probe_mode, agent_probe_clients,
      agent_probe_limit, agent_probe_status_enabled, sort_order, status, last_checked_at,
      last_success_at, last_failure_at, last_status_code, last_raw_status_code, last_latency_ms,
      last_effective_reason, last_error, down_since, last_notified_at, created_at, updated_at
    from website_monitors wm, args a
    where wm.enabled = true
      and wm.agent_probe_mode = 'selected'
      and exists (
        select 1
        from jsonb_array_elements_text(wm.agent_probe_clients) client_id
        where client_id = a.client_id
      )
  ),
  country_candidates as (
    select
      wm.id, wm.check_config, wm.config_revision, wm.name, wm.url, wm.method, wm.expected_status_min, wm.expected_status_max, wm.interval_sec,
      wm.timeout_sec, wm.grace_period_sec, wm.enabled, wm.hidden, wm.agent_probe_mode, wm.agent_probe_clients,
      wm.agent_probe_limit, wm.agent_probe_status_enabled, wm.sort_order, wm.status, wm.last_checked_at,
      wm.last_success_at, wm.last_failure_at, wm.last_status_code, wm.last_raw_status_code, wm.last_latency_ms,
      wm.last_effective_reason, wm.last_error, wm.down_since, wm.last_notified_at, wm.created_at, wm.updated_at,
      c.uuid,
      row_number() over (
        partition by wm.id, coalesce(nullif(c.region, ''), c.uuid)
        order by c.sort_order asc, c.name asc, c.uuid asc
      ) as country_rank,
      row_number() over (
        partition by wm.id
        order by c.sort_order asc, c.name asc, c.uuid asc
      ) as monitor_rank
    from website_monitors wm
    join clients c on c.hidden = 0
    where wm.enabled = true
      and wm.agent_probe_mode = 'country_auto'
  ),
  country_selected as (
    select id, check_config, config_revision, name, url, method, expected_status_min, expected_status_max, interval_sec,
      timeout_sec, grace_period_sec, enabled, hidden, agent_probe_mode, agent_probe_clients,
      agent_probe_limit, agent_probe_status_enabled, sort_order, status, last_checked_at,
      last_success_at, last_failure_at, last_status_code, last_raw_status_code, last_latency_ms,
      last_effective_reason, last_error, down_since, last_notified_at, created_at, updated_at
    from country_candidates, args a
    where uuid = a.client_id
      and country_rank = 1
      and monitor_rank <= agent_probe_limit
  ),
  all_rows as (
    select * from selected
    union
    select * from country_selected
  )
  select coalesce(jsonb_agg(to_jsonb(row_data) order by sort_order asc, id asc), '[]'::jsonb)
  from (
    select *
    from all_rows
    order by sort_order asc, id asc
    limit (select safe_limit from args)
  ) row_data;
$$;

create or replace function public.cfm_website_statistics_checks(input_monitor_id integer,input_since timestamptz,input_until timestamptz,input_source_client text default null) returns jsonb language sql stable set search_path=public as $$
 select coalesce(jsonb_agg(to_jsonb(c) order by checked_at desc),'[]') from (
  select w.checked_at,w.ok,w.latency_ms,w.source_type,w.source_client
  from website_checks w join website_monitors m on m.id=w.monitor_id and m.config_revision=w.config_revision
  where w.monitor_id=input_monitor_id and w.checked_at >= input_since-(m.interval_sec*2*interval '1 second') and w.checked_at<=input_until
   and input_until>input_since and input_until-input_since<=interval '30 days'
   and ((input_source_client is null and w.source_type='worker') or (input_source_client is not null and w.source_type='agent' and w.source_client=input_source_client))
  order by w.checked_at desc,w.id desc limit 10001
 ) c;
$$;
revoke all on function public.cfm_website_statistics_checks(integer,timestamptz,timestamptz,text) from public,anon,authenticated;
grant execute on function public.cfm_website_statistics_checks(integer,timestamptz,timestamptz,text) to service_role;

-- Public certificate expiry evidence contains no hostname, configuration or credentials.
create or replace function public.cfm_public_websites(
  period_hours int default 24,
  check_limit int default 120,
  input_include_hidden boolean default false
)
returns jsonb
language sql
stable
set search_path = public
as $$
  with args as (
    select
      least(greatest(coalesce(period_hours, 24), 1), 72) as safe_hours,
      least(greatest(coalesce(check_limit, 120), 1), 120) as safe_limit
  ),
  monitor_rows as (
    select
      id, name, method, hide_url,
      case when input_include_hidden or not hide_url then url else null end as url,
      interval_sec, status, last_checked_at, tls_expires_at, tls_observed_at,
      last_status_code, last_raw_status_code, last_latency_ms, last_effective_reason,
      description, category, tags,
      case when input_include_hidden or not hide_url then icon else '' end as icon,
      server_uuid,
      case when input_include_hidden or not hide_url then domain else '' end as domain,
      deployment, repository_url,
      sort_order
    from website_monitors
    where input_include_hidden or hidden = false
    order by sort_order asc, id asc
  ),
  check_rows as (
    select *
    from (
      select
        wc.monitor_id, wc.checked_at, wc.ok, wc.effective_status, wc.effective_reason,
        wc.status_code, wc.raw_status_code, wc.latency_ms, wc.source_type, wc.source_client,
        row_number() over (
          partition by wc.monitor_id,
          floor(extract(epoch from (now() - wc.checked_at)) / greatest(60, floor((a.safe_hours * 60 * 60) / a.safe_limit)))
          order by wc.checked_at desc, wc.id desc
        ) as rn
      from website_checks wc
      join website_monitors wm on wm.id = wc.monitor_id and wc.config_revision = wm.config_revision
      cross join args a
      where (input_include_hidden or wm.hidden = false)
        and wc.checked_at >= now() - (a.safe_hours * interval '1 hour')
        and (
          wc.source_type = 'worker'
          or wc.effective_status = 'up'
          or wm.agent_probe_status_enabled = false
        )
    ) ranked
    where rn = 1
  )
  select coalesce(jsonb_agg(
    (to_jsonb(m) - 'sort_order') || jsonb_build_object(
      'checks',
      coalesce((
        select jsonb_agg(to_jsonb(c) - 'monitor_id' - 'rn' order by c.checked_at desc)
        from check_rows c
        where c.monitor_id = m.id
      ), '[]'::jsonb)
    )
    order by m.sort_order asc, m.id asc
  ), '[]'::jsonb)
  from monitor_rows m;
$$;

create or replace function public.cfm_public_website_monitor(
  input_id integer,
  input_check_limit integer default 120,
  input_include_hidden boolean default false
)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
begin
  return (
    with
      args as (
        select least(greatest(coalesce(input_check_limit, 120), 1), 500) as safe_limit
      ),
      monitor_row as (
        select
          id, name, method, hide_url,
      case when input_include_hidden or not hide_url then url else null end as url,
      interval_sec, status, last_checked_at, tls_expires_at, tls_observed_at,
          last_status_code, last_raw_status_code, last_latency_ms, last_effective_reason,
        description, category, tags,
        case when input_include_hidden or not hide_url then icon else '' end as icon,
        server_uuid,
        case when input_include_hidden or not hide_url then domain else '' end as domain,
        deployment, repository_url
        from website_monitors
        where id = input_id
          and (input_include_hidden or hidden = false)
        limit 1
      ),
      check_rows as (
        select wc.checked_at, wc.ok, wc.effective_status, wc.effective_reason,
          wc.status_code, wc.raw_status_code, wc.latency_ms, wc.source_type, wc.source_client
        from website_checks wc
        join website_monitors wm on wm.id = wc.monitor_id and wc.config_revision = wm.config_revision
        cross join args
        where wc.monitor_id = input_id
          and (
            wc.source_type = 'worker'
            or wc.effective_status = 'up'
            or wm.agent_probe_status_enabled = false
          )
        order by wc.checked_at desc, wc.id desc
        limit (select safe_limit from args)
      )
    select to_jsonb(m) || jsonb_build_object(
      'checks',
      coalesce((select jsonb_agg(to_jsonb(c) order by c.checked_at desc) from check_rows c), '[]'::jsonb)
    )
    from monitor_row m
  );
end;
$$;
