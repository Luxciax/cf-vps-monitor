create table if not exists public.machine_tokens (
  id uuid primary key,
  name text not null check (length(name) between 1 and 80),
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  prefix text not null check (prefix ~ '^cvm_[a-f0-9]{8}$'),
  scopes jsonb not null check (jsonb_typeof(scopes) = 'array' and jsonb_array_length(scopes) between 1 and 24),
  created_at timestamptz not null default now(),
  created_by text not null,
  expires_at timestamptz,
  revoked_at timestamptz,
  last_used_at timestamptz,
  last_audit_at timestamptz
);
alter table public.machine_tokens enable row level security;
revoke all on public.machine_tokens from public, anon, authenticated;
grant select, insert, update, delete on public.machine_tokens to service_role;
create index if not exists machine_tokens_active on public.machine_tokens(expires_at) where revoked_at is null;

create or replace function public.cfm_machine_tokens(input_operation text, input_payload jsonb default '{}'::jsonb, input_actor text default '')
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  item public.machine_tokens%rowtype;
  allowed_scopes constant jsonb := '["read","write","backup","restore","assets:read","assets:write","discovery:read","discovery:write","config:read","config:write","knowledge:read","knowledge:write","changes:read","changes:write","baselines:read","baselines:write","monitors:read","monitors:write","settings:read","settings:write","audit:read"]'::jsonb;
begin
  if jsonb_typeof(input_payload) <> 'object' then raise exception 'Token payload must be an object' using errcode = '22023'; end if;
  if input_operation = 'authenticate' then
    select * into item from public.machine_tokens
    where token_hash = input_payload->>'token_hash' and revoked_at is null and (expires_at is null or expires_at > now());
    if not found then return null; end if;
    if item.last_audit_at is null or item.last_audit_at < now() - interval '15 minutes' then
      update public.machine_tokens set last_audit_at = now(), last_used_at = now()
      where id = item.id and (last_audit_at is null or last_audit_at < now() - interval '15 minutes');
      if found then
        insert into public.audit_logs ("user", action, detail, level)
        values ('machine:' || item.id, 'machine_token_used', jsonb_build_object('token_id', item.id, 'name', item.name)::text, 'info');
      end if;
    elsif item.last_used_at is null or item.last_used_at < now() - interval '1 minute' then
      update public.machine_tokens set last_used_at = now() where id = item.id and (last_used_at is null or last_used_at < now() - interval '1 minute');
    end if;
    return to_jsonb(item) - 'token_hash' - 'last_audit_at';
  elsif input_operation = 'list' then
    return coalesce((select jsonb_agg(value order by created_at desc) from (
      select to_jsonb(t) - 'token_hash' - 'last_audit_at' as value, t.created_at from public.machine_tokens t order by t.created_at desc limit 500
    ) rows), '[]'::jsonb);
  elsif input_operation = 'create' then
    if jsonb_typeof(input_payload->'scopes') <> 'array' or not ((input_payload->'scopes') <@ allowed_scopes)
      or jsonb_array_length(input_payload->'scopes') not between 1 and 24
    then raise exception 'Invalid token scopes' using errcode = '22023'; end if;
    if input_payload->>'expires_at' is not null and ((input_payload->>'expires_at')::timestamptz <= now()
      or (input_payload->>'expires_at')::timestamptz > now() + interval '10 years')
    then raise exception 'Invalid token expiry' using errcode = '22023'; end if;
    lock table public.machine_tokens in share row exclusive mode;
    delete from public.machine_tokens where coalesce(revoked_at, expires_at) < now() - interval '180 days';
    if (select count(*) from public.machine_tokens where revoked_at is null and (expires_at is null or expires_at > now())) >= 64
      or (select count(*) from public.machine_tokens) >= 500
    then raise exception 'Machine token capacity reached' using errcode = '54000'; end if;
    insert into public.machine_tokens(id, name, token_hash, prefix, scopes, created_by, expires_at)
    values ((input_payload->>'id')::uuid, input_payload->>'name', input_payload->>'token_hash', input_payload->>'prefix', input_payload->'scopes', left(input_actor,128), (input_payload->>'expires_at')::timestamptz)
    returning * into item;
    insert into public.audit_logs ("user", action, detail, level)
    values (left(input_actor,128), 'machine_token_created', jsonb_build_object('token_id',item.id,'name',item.name,'scopes',item.scopes,'expires_at',item.expires_at)::text,'warning');
    return to_jsonb(item) - 'token_hash' - 'last_audit_at';
  elsif input_operation = 'rotate' then
    update public.machine_tokens
    set token_hash = input_payload->>'token_hash', prefix = input_payload->>'prefix', last_used_at = null, last_audit_at = null
    where id = (input_payload->>'id')::uuid and revoked_at is null and (expires_at is null or expires_at > now())
    returning * into item;
    if not found then return null; end if;
    insert into public.audit_logs ("user", action, detail, level)
    values (left(input_actor,128),'machine_token_rotated',jsonb_build_object('token_id',item.id,'name',item.name)::text,'warning');
    return to_jsonb(item) - 'token_hash' - 'last_audit_at';
  elsif input_operation = 'revoke' then
    update public.machine_tokens set revoked_at = now() where id = (input_payload->>'id')::uuid and revoked_at is null returning * into item;
    if found then
      insert into public.audit_logs ("user", action, detail, level)
      values (left(input_actor,128),'machine_token_revoked',jsonb_build_object('token_id',item.id,'name',item.name)::text,'warning');
    end if;
    return jsonb_build_object('success',true);
  else
    raise exception 'Unsupported token operation' using errcode = '22023';
  end if;
end;
$$;
revoke all on function public.cfm_machine_tokens(text,jsonb,text) from public, anon, authenticated;
grant execute on function public.cfm_machine_tokens(text,jsonb,text) to service_role;
