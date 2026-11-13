alter table public.pending_worker_calls add column if not exists dial_claimed_at timestamptz;

do $$
begin
  if to_regprocedure('private.apply_farm_changes_before_worker_claims(uuid,bigint,jsonb,text,jsonb)') is null then
    alter function public.apply_farm_changes(uuid, bigint, jsonb, text, jsonb) set schema private;
    alter function private.apply_farm_changes(uuid, bigint, jsonb, text, jsonb) rename to apply_farm_changes_before_worker_claims;
  end if;
end $$;

revoke all on function private.apply_farm_changes_before_worker_claims(uuid, bigint, jsonb, text, jsonb) from public, anon, authenticated;
grant execute on function private.apply_farm_changes_before_worker_claims(uuid, bigint, jsonb, text, jsonb) to service_role;

create or replace function public.apply_farm_changes(
  p_farm_id uuid, p_expected_revision bigint, p_changes jsonb,
  p_event_id text default null, p_outcome jsonb default null
) returns bigint language plpgsql security invoker set search_path = '' as $$
declare
  revision bigint;
begin
  revision := private.apply_farm_changes_before_worker_claims(p_farm_id, p_expected_revision, p_changes, p_event_id, p_outcome);
  update public.pending_worker_calls call
  set dial_claimed_at = (item ->> 'dial_claimed_at')::timestamptz
  from jsonb_array_elements(coalesce(p_changes -> 'pending_worker_calls', '[]'::jsonb)) item
  where call.id = (item ->> 'id')::uuid and call.farm_id = p_farm_id and item ? 'dial_claimed_at';
  return revision;
end $$;

revoke all on function public.apply_farm_changes(uuid, bigint, jsonb, text, jsonb) from public, anon, authenticated;
grant execute on function public.apply_farm_changes(uuid, bigint, jsonb, text, jsonb) to service_role;

notify pgrst, 'reload schema';
