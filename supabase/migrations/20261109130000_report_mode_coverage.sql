alter table public.reports
  add column mode text check (mode in ('guided', 'open')),
  add column coverage jsonb not null default '[]'::jsonb check (jsonb_typeof(coverage) = 'array');

alter function public.apply_farm_changes(uuid, bigint, jsonb, text, jsonb) set schema private;
alter function private.apply_farm_changes(uuid, bigint, jsonb, text, jsonb) rename to apply_farm_changes_before_report_coverage;
revoke all on function private.apply_farm_changes_before_report_coverage(uuid, bigint, jsonb, text, jsonb) from public, anon, authenticated;
grant execute on function private.apply_farm_changes_before_report_coverage(uuid, bigint, jsonb, text, jsonb) to service_role;

create function public.apply_farm_changes(
  p_farm_id uuid, p_expected_revision bigint, p_changes jsonb,
  p_event_id text default null, p_outcome jsonb default null
) returns bigint language plpgsql security invoker set search_path = '' as $$
declare
  revision bigint;
begin
  revision := private.apply_farm_changes_before_report_coverage(p_farm_id, p_expected_revision, p_changes, p_event_id, p_outcome);
  update public.reports report
  set mode = item.mode, coverage = coalesce(item.coverage, '[]'::jsonb)
  from jsonb_populate_recordset(null::public.reports, coalesce(p_changes -> 'reports', '[]'::jsonb)) item
  where report.id = item.id and report.farm_id = p_farm_id;
  return revision;
end $$;
revoke all on function public.apply_farm_changes(uuid, bigint, jsonb, text, jsonb) from public, anon, authenticated;
grant execute on function public.apply_farm_changes(uuid, bigint, jsonb, text, jsonb) to service_role;
