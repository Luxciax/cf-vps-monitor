-- Disable further scheduled probes and drain history in bounded transactions.
-- Repeating the operation resumes an interrupted deletion of the same monitor.
create or replace function public.cfm_delete_website_monitor_batch(input_id integer)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  removed integer;
begin
  if input_id is null or input_id <= 0 then
    raise exception 'Invalid website monitor ID';
  end if;

  perform 1 from website_monitors where id = input_id for update;
  if not found then
    return jsonb_build_object('deleted', true, 'deleted_checks', 0);
  end if;

  update website_monitors set enabled = false, status = 'paused', updated_at = now()
  where id = input_id and enabled;

  delete from website_checks
  where ctid in (
    select ctid from website_checks
    where monitor_id = input_id
    order by checked_at desc
    limit 1000
  ) and monitor_id = input_id;
  get diagnostics removed = row_count;

  if removed > 0 then
    return jsonb_build_object('deleted', false, 'deleted_checks', removed);
  end if;

  delete from website_monitors where id = input_id;
  return jsonb_build_object('deleted', true, 'deleted_checks', 0);
end;
$$;

revoke all on function public.cfm_delete_website_monitor_batch(integer) from public, anon, authenticated;
grant execute on function public.cfm_delete_website_monitor_batch(integer) to service_role;
notify pgrst, 'reload schema';
