-- Preserve custom website assets with upstream address privacy.
set local search_path = public;

alter table website_monitors add column if not exists description text not null default '';
alter table website_monitors add column if not exists category text not null default '';
alter table website_monitors add column if not exists tags jsonb not null default '[]'::jsonb;
alter table website_monitors add column if not exists icon text not null default '';
alter table website_monitors add column if not exists server_uuid text;
alter table website_monitors add column if not exists domain text not null default '';
alter table website_monitors add column if not exists deployment text not null default '';
alter table website_monitors add column if not exists repository_url text not null default '';
alter table website_monitors add column if not exists note text not null default '';

update website_monitors
set tags = '[]'::jsonb
where tags is null or jsonb_typeof(tags) <> 'array';

alter table website_monitors drop constraint if exists website_monitors_tags_array_check;
alter table website_monitors
  add constraint website_monitors_tags_array_check check (jsonb_typeof(tags) = 'array');

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
      interval_sec, status, last_checked_at,
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
      interval_sec, status, last_checked_at,
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

create or replace function public.cfm_create_website_monitor(input_monitor jsonb)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  created_row website_monitors%rowtype;
begin
  insert into website_monitors (
    name, url, method, expected_status_min, expected_status_max,
    interval_sec, timeout_sec, grace_period_sec, enabled, hidden, hide_url,
    agent_probe_mode, agent_probe_clients, agent_probe_limit, agent_probe_status_enabled,
    description, category, tags, icon, server_uuid, domain, deployment, repository_url, note,
    sort_order
  ) values (
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
    name = coalesce(input_monitor->>'name', name),
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

revoke all on function public.cfm_public_websites(integer, integer, boolean) from public;
revoke all on function public.cfm_public_websites(integer, integer, boolean) from anon;
revoke all on function public.cfm_public_websites(integer, integer, boolean) from authenticated;
grant execute on function public.cfm_public_websites(integer, integer, boolean) to service_role;

revoke all on function public.cfm_public_website_monitor(integer, integer, boolean) from public;
revoke all on function public.cfm_public_website_monitor(integer, integer, boolean) from anon;
revoke all on function public.cfm_public_website_monitor(integer, integer, boolean) from authenticated;
grant execute on function public.cfm_public_website_monitor(integer, integer, boolean) to service_role;

revoke all on function public.cfm_create_website_monitor(jsonb) from public;
revoke all on function public.cfm_create_website_monitor(jsonb) from anon;
revoke all on function public.cfm_create_website_monitor(jsonb) from authenticated;
grant execute on function public.cfm_create_website_monitor(jsonb) to service_role;

revoke all on function public.cfm_update_website_monitor(integer, jsonb) from public;
revoke all on function public.cfm_update_website_monitor(integer, jsonb) from anon;
revoke all on function public.cfm_update_website_monitor(integer, jsonb) from authenticated;
grant execute on function public.cfm_update_website_monitor(integer, jsonb) to service_role;

notify pgrst, 'reload schema';
