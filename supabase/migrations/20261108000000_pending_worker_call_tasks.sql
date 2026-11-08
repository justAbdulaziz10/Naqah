-- Task A: durable Task C batch associations. Deploy this BEFORE the compatible app code.
-- Existing single-task columns/RPC signature remain valid. No task/call/farm is deleted.
alter table public.pending_worker_calls
  add column batch_id text check (batch_id is null or (length(btrim(batch_id)) > 0 and length(batch_id) <= 128)),
  add column task_links_explicit boolean not null default false,
  add constraint pending_worker_calls_farm_id_id_key unique (farm_id, id);
create unique index pending_worker_calls_batch on public.pending_worker_calls (farm_id, batch_id) where batch_id is not null;

create table public.pending_worker_call_tasks (
  farm_id uuid not null,
  pending_call_id uuid not null,
  task_ticket_id uuid not null,
  covered_order integer check (covered_order is null or covered_order >= 0),
  primary key (farm_id, pending_call_id, task_ticket_id),
  unique (farm_id, pending_call_id, covered_order),
  foreign key (farm_id, pending_call_id) references public.pending_worker_calls (farm_id, id) on delete cascade,
  foreign key (farm_id, task_ticket_id) references public.task_tickets (farm_id, id) on delete cascade
);
create index pending_worker_call_tasks_task on public.pending_worker_call_tasks (farm_id, task_ticket_id);
alter table public.pending_worker_call_tasks enable row level security;
revoke all on public.pending_worker_call_tasks from public, anon, authenticated;
grant select on public.pending_worker_call_tasks to authenticated;
grant all on public.pending_worker_call_tasks to service_role;
create policy pending_worker_call_tasks_owner_read on public.pending_worker_call_tasks for select to authenticated
  using (private.is_farm_owner(farm_id));

-- NULL order distinguishes legacy-only links from the explicit ordered array, including [].
insert into public.pending_worker_call_tasks (farm_id, pending_call_id, task_ticket_id)
select p.farm_id, p.id, p.task_ticket_id from public.pending_worker_calls p
join public.task_tickets t on t.farm_id = p.farm_id and t.id = p.task_ticket_id
on conflict do nothing;

-- Old deployed code keeps writing the old column. Keep that relationship without erasing
-- grouped links, and retain the existing SET NULL / cascade behavior when a task is deleted.
create function private.sync_legacy_pending_call_task() returns trigger
language plpgsql set search_path = '' as $$
begin
  if TG_OP = 'UPDATE' and old.task_ticket_id is distinct from new.task_ticket_id then
    delete from public.pending_worker_call_tasks
      where farm_id = old.farm_id and pending_call_id = old.id
        and task_ticket_id = old.task_ticket_id and covered_order is null;
  end if;
  if new.task_ticket_id is not null then
    insert into public.pending_worker_call_tasks (farm_id, pending_call_id, task_ticket_id)
      values (new.farm_id, new.id, new.task_ticket_id) on conflict do nothing;
  end if;
  return new;
end $$;
revoke all on function private.sync_legacy_pending_call_task() from public, anon, authenticated;
grant execute on function private.sync_legacy_pending_call_task() to service_role;
create trigger sync_legacy_pending_call_task after insert or update of task_ticket_id on public.pending_worker_calls
  for each row execute function private.sync_legacy_pending_call_task();

-- Preserve the entire reviewed 0006 transaction, revision lock and replay guard verbatim.
-- The public wrapper extends the SAME transaction; any invalid link rolls back the base too.
alter function public.apply_farm_changes(uuid, bigint, jsonb, text, jsonb) rename to apply_farm_changes_before_task_links;
alter function public.apply_farm_changes_before_task_links(uuid, bigint, jsonb, text, jsonb) set schema private;
revoke all on function private.apply_farm_changes_before_task_links(uuid, bigint, jsonb, text, jsonb) from public, anon, authenticated;
grant execute on function private.apply_farm_changes_before_task_links(uuid, bigint, jsonb, text, jsonb) to service_role;

create function public.apply_farm_changes(
  p_farm_id uuid, p_expected_revision bigint, p_changes jsonb,
  p_event_id text default null, p_outcome jsonb default null
) returns bigint language plpgsql security invoker set search_path = '' as $$
declare
  revision bigint;
  item jsonb;
  call_id uuid;
  legacy_id uuid;
  previous_batch text;
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
    -- Omitted means KEEP, not clear: old applications/retry payloads cannot erase a group.
    if not (item ? 'covered_task_ids') then continue; end if;
    if jsonb_typeof(item -> 'covered_task_ids') is distinct from 'array' then
      raise exception 'covered_task_ids must be an array' using errcode = 'invalid_parameter_value';
    end if;
    if exists (select 1 from jsonb_array_elements(item -> 'covered_task_ids') x where jsonb_typeof(x) <> 'string') then
      raise exception 'covered_task_ids must contain UUID strings' using errcode = 'invalid_parameter_value';
    end if;
    -- Preserve the legacy relationship separately; explicit [] removes only grouped links.
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
  return revision;
end $$;
revoke all on function public.apply_farm_changes(uuid, bigint, jsonb, text, jsonb) from public, anon, authenticated;
grant execute on function public.apply_farm_changes(uuid, bigint, jsonb, text, jsonb) to service_role;
notify pgrst, 'reload schema';
