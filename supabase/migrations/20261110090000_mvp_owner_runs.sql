-- The current or latest scheduled owner call. Nullable, so the deployed application keeps working
-- without it. Owners can read it through the farm row; only the service role writes it, because
-- no column grant to authenticated covers it.
alter table public.farms
  add column owner_call_run jsonb check (owner_call_run is null or jsonb_typeof(owner_call_run) = 'object');

alter function public.apply_farm_changes(uuid, bigint, jsonb, text, jsonb) set schema private;
alter function private.apply_farm_changes(uuid, bigint, jsonb, text, jsonb) rename to apply_farm_changes_before_owner_runs;
revoke all on function private.apply_farm_changes_before_owner_runs(uuid, bigint, jsonb, text, jsonb) from public, anon, authenticated;
grant execute on function private.apply_farm_changes_before_owner_runs(uuid, bigint, jsonb, text, jsonb) to service_role;

create function public.apply_farm_changes(
  p_farm_id uuid, p_expected_revision bigint, p_changes jsonb,
  p_event_id text default null, p_outcome jsonb default null
) returns bigint language plpgsql security invoker set search_path = '' as $$
declare
  revision bigint;
begin
  revision := private.apply_farm_changes_before_owner_runs(p_farm_id, p_expected_revision, p_changes, p_event_id, p_outcome);
  -- 20261109182526 rebuilt this function on an older link of the chain and dropped this write.
  update public.reports report
  set mode = item.mode, coverage = coalesce(item.coverage, '[]'::jsonb)
  from jsonb_populate_recordset(null::public.reports, coalesce(p_changes -> 'reports', '[]'::jsonb)) item
  where report.id = item.id and report.farm_id = p_farm_id;
  -- Omitted key: left untouched, so an older application cannot clear a run.
  if p_changes -> 'farm' ? 'owner_call_run' then
    update public.farms
    set owner_call_run = nullif(p_changes -> 'farm' -> 'owner_call_run', 'null'::jsonb)
    where id = p_farm_id;
  end if;
  return revision;
end $$;
revoke all on function public.apply_farm_changes(uuid, bigint, jsonb, text, jsonb) from public, anon, authenticated;
grant execute on function public.apply_farm_changes(uuid, bigint, jsonb, text, jsonb) to service_role;
-- Basic has no tasks, owner instructions, relays or follow-up calls to the worker. New rows are
-- refused; existing rows keep saving. apply_farm_changes upserts every changed row and BEFORE
-- INSERT fires on those too, so a row that already exists must pass.
-- SECURITY INVOKER on purpose, like the custom question limit: lookups stay under RLS.
create function private.enforce_ultimate_only_row() returns trigger
language plpgsql set search_path = '' as $$
declare
  farm_plan public.plan;
  already boolean;
begin
  select f.plan into farm_plan from public.farms f where f.id = new.farm_id;
  if farm_plan is distinct from 'basic' then
    return new;
  end if;
  execute format('select exists (select 1 from public.%I where id = $1 and farm_id = $2)', TG_TABLE_NAME)
    into already using new.id, new.farm_id;
  if not already then
    raise exception 'Basic plan has no %', TG_TABLE_NAME using errcode = 'check_violation';
  end if;
  return new;
end $$;
revoke all on function private.enforce_ultimate_only_row() from public, anon, authenticated;
create trigger task_tickets_ultimate_only before insert on public.task_tickets
  for each row execute function private.enforce_ultimate_only_row();
create trigger relays_ultimate_only before insert on public.relays
  for each row execute function private.enforce_ultimate_only_row();
create trigger pending_worker_calls_ultimate_only before insert on public.pending_worker_calls
  for each row execute function private.enforce_ultimate_only_row();

notify pgrst, 'reload schema';
