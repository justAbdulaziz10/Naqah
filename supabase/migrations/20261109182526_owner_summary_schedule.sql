-- Separate owner-summary schedule. Nullable, so the deployed application keeps working
-- without these columns. Owners may set the call time. Only the service role writes the queue.
alter table public.farms
  add column owner_call_day smallint check (owner_call_day is null or owner_call_day between 0 and 6),
  add column owner_call_time time,
  add column owner_summary_report_id uuid,
  add column owner_summary_not_before timestamptz;

alter table public.farms
  add constraint farms_owner_summary_report_fk
  foreign key (owner_summary_report_id) references public.reports (id);

create index farms_owner_summary_due on public.farms (owner_summary_not_before)
  where owner_summary_not_before is not null;

grant insert (owner_call_day, owner_call_time) on public.farms to authenticated;
grant update (owner_call_day, owner_call_time) on public.farms to authenticated;

-- Keep the Task A wrapper and also persist the queued owner summary.
-- Omitted keys are left untouched, so an older application cannot clear the queue.
create or replace function public.apply_farm_changes(
  p_farm_id uuid, p_expected_revision bigint, p_changes jsonb,
  p_event_id text default null, p_outcome jsonb default null
) returns bigint language plpgsql security invoker set search_path = '' as $$
declare
  revision bigint;
  item jsonb;
  call_id uuid;
  legacy_id uuid;
  previous_batch text;
  summary_report uuid;
begin
  revision := private.apply_farm_changes_before_task_links(p_farm_id, p_expected_revision, p_changes, p_event_id, p_outcome);
  for item in select value from jsonb_array_elements(coalesce(p_changes -> 'pending_worker_calls', '[]'::jsonb)) loop
    call_id := (item ->> 'id')::uuid;
    select task_ticket_id, batch_id into strict legacy_id, previous_batch
      from public.pending_worker_calls where id = call_id and farm_id = p_farm_id;
    if item ? 'batch_id' and item ->> 'batch_id' is not null then
      if previous_batch is not null and previous_batch <> item ->> 'batch_id' then
        raise exception 'pending call batch identity is immutable' using errcode = 'check_violation';
      end if;
      update public.pending_worker_calls set batch_id = item ->> 'batch_id' where id = call_id and farm_id = p_farm_id;
    end if;
    if not (item ? 'covered_task_ids') then continue; end if;
    if jsonb_typeof(item -> 'covered_task_ids') is distinct from 'array' then
      raise exception 'covered_task_ids must be an array' using errcode = 'invalid_parameter_value';
    end if;
    if exists (select 1 from jsonb_array_elements(item -> 'covered_task_ids') x where jsonb_typeof(x) <> 'string') then
      raise exception 'covered_task_ids must contain UUID strings' using errcode = 'invalid_parameter_value';
    end if;
    delete from public.pending_worker_call_tasks where farm_id = p_farm_id and pending_call_id = call_id
      and (legacy_id is null or task_ticket_id <> legacy_id);
    update public.pending_worker_call_tasks set covered_order = null where farm_id = p_farm_id and pending_call_id = call_id;
    insert into public.pending_worker_call_tasks (farm_id, pending_call_id, task_ticket_id, covered_order)
      select p_farm_id, call_id, task_id, (row_number() over (order by first_position) - 1)::integer
      from (select value::uuid as task_id, min(position) as first_position
        from jsonb_array_elements_text(item -> 'covered_task_ids') with ordinality as ids(value, position)
        group by value::uuid) ordered
      on conflict (farm_id, pending_call_id, task_ticket_id) do update set covered_order = excluded.covered_order;
    update public.pending_worker_calls set task_links_explicit = true where id = call_id and farm_id = p_farm_id;
  end loop;

  if p_changes -> 'farm' ? 'owner_summary_report_id' or p_changes -> 'farm' ? 'owner_summary_not_before' then
    summary_report := nullif(p_changes -> 'farm' ->> 'owner_summary_report_id', '')::uuid;
    if summary_report is not null and not exists (
      select 1 from public.reports where id = summary_report and farm_id = p_farm_id
    ) then
      raise exception 'owner summary report is not on this farm' using errcode = 'foreign_key_violation';
    end if;
    update public.farms set
      owner_summary_report_id = case when p_changes -> 'farm' ? 'owner_summary_report_id'
        then summary_report else owner_summary_report_id end,
      owner_summary_not_before = case when p_changes -> 'farm' ? 'owner_summary_not_before'
        then nullif(p_changes -> 'farm' ->> 'owner_summary_not_before', '')::timestamptz else owner_summary_not_before end
    where id = p_farm_id;
  end if;

  return revision;
end $$;

revoke all on function public.apply_farm_changes(uuid, bigint, jsonb, text, jsonb) from public, anon, authenticated;
grant execute on function public.apply_farm_changes(uuid, bigint, jsonb, text, jsonb) to service_role;
notify pgrst, 'reload schema';
