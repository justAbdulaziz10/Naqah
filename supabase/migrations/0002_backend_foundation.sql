-- NAQAH | ناقة — backend foundation. Applies on top of 0001_init.sql.
--
-- Closes the gaps between the schema and the domain model, and adds the one write path for
-- the voice service: load a Workspace, run a pure action from src/domain, then save what
-- changed with apply_farm_changes. Business rules stay in src/domain, not in SQL.

-- ───────────────────────────── concurrency ─────────────────────────────
-- Bumped by every apply_farm_changes. Owners can read it but not write it (0001 grants farm
-- writes per column), so two calls cannot both act on the same state.
alter table farms add column revision bigint not null default 0;

-- ───────────────────────────── domain gaps ─────────────────────────────
-- A worker callback logs the No Answer Ticket it closes, which is not a task ticket.
alter table no_answer_tickets add constraint no_answer_tickets_farm_id_key unique (farm_id, id);
alter table calls add column no_answer_ticket_id uuid;
alter table calls add constraint calls_no_answer_fk foreign key (farm_id, no_answer_ticket_id)
  references no_answer_tickets (farm_id, id) on delete set null (no_answer_ticket_id);

-- Findings raised by the conversation (the heat-day check) have no criterion row. `source`
-- keeps the domain's key for them.
alter table findings add column source text;

-- calls and reports point at each other, so one transaction must be able to insert both.
alter table reports alter constraint reports_call_fk deferrable initially immediate;
alter table calls alter constraint calls_report_fk deferrable initially immediate;

-- ───────────────────────────── call identity ─────────────────────────────
-- Inbound calls are matched on these, so they must be comparable: E.164 or not set yet.
alter table farms add constraint owner_phone_e164 check (owner_phone = '' or owner_phone ~ '^\+[1-9][0-9]{7,14}$');
alter table workers add constraint worker_phone_e164 check (phone = '' or phone ~ '^\+[1-9][0-9]{7,14}$');
-- Deliberately not unique: a unique number would let one owner block or detect another's
-- worker. The service treats a number matching more than one farm as unregistered.
create index workers_phone on workers (phone) where phone <> '';
create index farms_owner_phone on farms (owner_phone) where owner_phone <> '';

create index calls_provider_call on calls (farm_id, provider_call_id) where provider_call_id is not null;
create unique index reports_one_per_call on reports (farm_id, call_id) where call_id is not null;

-- Telephony webhooks retry, and a retry must get the first answer back. Running the rules again
-- would be wrong: a replayed report would now be refused as "already reported today".
-- Service only. RLS is on with no policy, so owners and anon cannot reach it.
create table voice_events (
  farm_id uuid not null references farms (id) on delete cascade,
  event_id text not null check (length(event_id) between 1 and 128),
  outcome jsonb not null,
  created_at timestamptz not null default now(),
  primary key (farm_id, event_id)
);
alter table voice_events enable row level security;
revoke all on table voice_events from public, anon, authenticated;
grant all on table voice_events to service_role;

-- ───────────────────────────── foreign key indexes ─────────────────────────────
create index calls_task on calls (farm_id, task_ticket_id) where task_ticket_id is not null;
create index calls_report on calls (farm_id, report_id) where report_id is not null;
create index calls_no_answer on calls (farm_id, no_answer_ticket_id) where no_answer_ticket_id is not null;
create index findings_criterion on findings (criterion_id) where criterion_id is not null;
create index pending_worker_calls_task on pending_worker_calls (farm_id, task_ticket_id) where task_ticket_id is not null;
create index pending_worker_calls_relay on pending_worker_calls (farm_id, relay_id) where relay_id is not null;
create index no_answer_tickets_task on no_answer_tickets (farm_id, task_ticket_id) where task_ticket_id is not null;

-- ───────────────────────────── atomic service writes ─────────────────────────────
-- A row belonging to another farm is skipped by the upserts below, which then lands here.
create function private.require_applied(p_section text, p_applied int, p_changes jsonb) returns void
language plpgsql set search_path = '' as $$
begin
  if p_applied <> jsonb_array_length(coalesce(p_changes -> p_section, '[]'::jsonb)) then
    raise exception 'apply_farm_changes: % contains rows outside this farm', p_section
      using errcode = 'foreign_key_violation';
  end if;
end $$;
revoke all on function private.require_applied(text, int, jsonb) from public, anon, authenticated;
grant execute on function private.require_applied(text, int, jsonb) to service_role;

-- Saves one domain action in one transaction. Raises NQ409 when the farm changed since it
-- was loaded; the caller reloads and runs the action again, so the rules see the new state.
-- A repeated p_event_id raises unique_violation, and nothing from that attempt is saved.
-- SECURITY INVOKER and service_role only: it is reachable as an RPC, but never by owners.
create function public.apply_farm_changes(
  p_farm_id uuid, p_expected_revision bigint, p_changes jsonb,
  p_event_id text default null, p_outcome jsonb default null
)
returns bigint language plpgsql set search_path = '' as $$
declare
  current_revision bigint;
  applied int;
begin
  select f.revision into current_revision from public.farms f where f.id = p_farm_id for update;
  if not found then
    raise exception 'farm not found' using errcode = 'NQ404';
  end if;
  if current_revision <> p_expected_revision then
    raise exception 'farm revision is %, expected %', current_revision, p_expected_revision using errcode = 'NQ409';
  end if;

  if p_event_id is not null then
    insert into public.voice_events (farm_id, event_id, outcome) values (p_farm_id, p_event_id, coalesce(p_outcome, '{}'::jsonb));
  end if;

  set constraints public.reports_call_fk, public.calls_report_fk deferred;

  insert into public.task_tickets (id, farm_id, instruction, created_at, scheduled_for, status, closed_at, closed_via)
  select r.id, p_farm_id, r.instruction, r.created_at, r.scheduled_for, r.status, r.closed_at, r.closed_via
  from jsonb_populate_recordset(null::public.task_tickets, coalesce(p_changes -> 'task_tickets', '[]'::jsonb)) r
  on conflict (id) do update
    set scheduled_for = excluded.scheduled_for, status = excluded.status,
        closed_at = excluded.closed_at, closed_via = excluded.closed_via
    where public.task_tickets.farm_id = excluded.farm_id;
  get diagnostics applied = row_count;
  perform private.require_applied('task_tickets', applied, p_changes);

  insert into public.relays (id, farm_id, at, message, delivered)
  select r.id, p_farm_id, r.at, r.message, r.delivered
  from jsonb_populate_recordset(null::public.relays, coalesce(p_changes -> 'relays', '[]'::jsonb)) r
  on conflict (id) do update set delivered = excluded.delivered
    where public.relays.farm_id = excluded.farm_id;
  get diagnostics applied = row_count;
  perform private.require_applied('relays', applied, p_changes);

  insert into public.no_answer_tickets (id, farm_id, created_at, purpose, message, task_ticket_id, status, closed_at)
  select r.id, p_farm_id, r.created_at, r.purpose, r.message, r.task_ticket_id, r.status, r.closed_at
  from jsonb_populate_recordset(null::public.no_answer_tickets, coalesce(p_changes -> 'no_answer_tickets', '[]'::jsonb)) r
  on conflict (id) do update set status = excluded.status, closed_at = excluded.closed_at
    where public.no_answer_tickets.farm_id = excluded.farm_id;
  get diagnostics applied = row_count;
  perform private.require_applied('no_answer_tickets', applied, p_changes);

  insert into public.pending_worker_calls (id, farm_id, purpose, message, task_ticket_id, relay_id, next_attempt_at, state, created_at)
  select r.id, p_farm_id, r.purpose, r.message, r.task_ticket_id, r.relay_id, r.next_attempt_at, r.state, coalesce(r.created_at, now())
  from jsonb_populate_recordset(null::public.pending_worker_calls, coalesce(p_changes -> 'pending_worker_calls', '[]'::jsonb)) r
  on conflict (id) do update set next_attempt_at = excluded.next_attempt_at, state = excluded.state
    where public.pending_worker_calls.farm_id = excluded.farm_id;
  get diagnostics applied = row_count;
  perform private.require_applied('pending_worker_calls', applied, p_changes);

  insert into public.worker_call_attempts (pending_call_id, at, answered)
  select r.pending_call_id, r.at, r.answered
  from jsonb_populate_recordset(null::public.worker_call_attempts, coalesce(p_changes -> 'worker_call_attempts', '[]'::jsonb)) r
  join public.pending_worker_calls p on p.id = r.pending_call_id and p.farm_id = p_farm_id;
  get diagnostics applied = row_count;
  perform private.require_applied('worker_call_attempts', applied, p_changes);

  -- Reports and calls are history: a report never changes, and a call only gains its links.
  insert into public.reports (id, farm_id, call_id, at)
  select r.id, p_farm_id, r.call_id, r.at
  from jsonb_populate_recordset(null::public.reports, coalesce(p_changes -> 'reports', '[]'::jsonb)) r
  on conflict (id) do nothing;
  get diagnostics applied = row_count;
  perform private.require_applied('reports', applied, p_changes);

  insert into public.calls (id, farm_id, kind, direction, party, at, outcome, attempt, summary_ar, summary_en,
                            provider_call_id, task_ticket_id, report_id, no_answer_ticket_id)
  select r.id, p_farm_id, r.kind, r.direction, r.party, r.at, r.outcome, r.attempt, r.summary_ar, r.summary_en,
         r.provider_call_id, r.task_ticket_id, r.report_id, r.no_answer_ticket_id
  from jsonb_populate_recordset(null::public.calls, coalesce(p_changes -> 'calls', '[]'::jsonb)) r
  on conflict (id) do update
    set task_ticket_id = excluded.task_ticket_id, report_id = excluded.report_id,
        no_answer_ticket_id = excluded.no_answer_ticket_id
    where public.calls.farm_id = excluded.farm_id;
  get diagnostics applied = row_count;
  perform private.require_applied('calls', applied, p_changes);

  insert into public.report_answers (report_id, question_id, question_ar, question_en, answer, answer_ar, answer_en,
                                     certainty, follow_up, sort_order)
  select r.report_id, r.question_id, r.question_ar, r.question_en, r.answer, r.answer_ar, r.answer_en,
         r.certainty, r.follow_up, r.sort_order
  from jsonb_populate_recordset(null::public.report_answers, coalesce(p_changes -> 'report_answers', '[]'::jsonb)) r
  join public.reports p on p.id = r.report_id and p.farm_id = p_farm_id;
  get diagnostics applied = row_count;
  perform private.require_applied('report_answers', applied, p_changes);

  insert into public.findings (id, report_id, criterion_id, source, text_ar, text_en)
  select r.id, r.report_id, r.criterion_id, r.source, r.text_ar, r.text_en
  from jsonb_populate_recordset(null::public.findings, coalesce(p_changes -> 'findings', '[]'::jsonb)) r
  join public.reports p on p.id = r.report_id and p.farm_id = p_farm_id;
  get diagnostics applied = row_count;
  perform private.require_applied('findings', applied, p_changes);

  insert into public.events (id, farm_id, at, tone, text_ar, text_en)
  select r.id, p_farm_id, r.at, r.tone, r.text_ar, r.text_en
  from jsonb_populate_recordset(null::public.events, coalesce(p_changes -> 'events', '[]'::jsonb)) r
  on conflict (id) do nothing;
  get diagnostics applied = row_count;
  perform private.require_applied('events', applied, p_changes);

  -- The herd list and resource set belong to the owner; calls only update what was reported.
  update public.camels c
  set health = r.health, health_note = r.health_note, certainty = r.certainty, updated_at = r.updated_at
  from jsonb_populate_recordset(null::public.camels, coalesce(p_changes -> 'camels', '[]'::jsonb)) r
  where c.id = r.id and c.farm_id = p_farm_id;
  get diagnostics applied = row_count;
  perform private.require_applied('camels', applied, p_changes);

  update public.resources c
  set level = r.level, quantity = r.quantity, note = r.note, certainty = r.certainty, updated_at = r.updated_at
  from jsonb_populate_recordset(null::public.resources, coalesce(p_changes -> 'resources', '[]'::jsonb)) r
  where c.farm_id = p_farm_id and c.kind = r.kind;
  get diagnostics applied = row_count;
  perform private.require_applied('resources', applied, p_changes);

  update public.farms f
  set revision = f.revision + 1,
      last_update_at = case when p_changes -> 'farm' ? 'last_update_at'
        then (p_changes -> 'farm' ->> 'last_update_at')::timestamptz else f.last_update_at end,
      owner_allowance_used_at = case when p_changes -> 'farm' ? 'owner_allowance_used_at'
        then (p_changes -> 'farm' ->> 'owner_allowance_used_at')::timestamptz else f.owner_allowance_used_at end,
      missed_notification_at = case when p_changes -> 'farm' ? 'missed_notification_at'
        then (p_changes -> 'farm' ->> 'missed_notification_at')::timestamptz else f.missed_notification_at end
  where f.id = p_farm_id;

  -- Check the report ↔ call links now, so a broken pair fails here and not at commit.
  set constraints public.reports_call_fk, public.calls_report_fk immediate;

  return current_revision + 1;
end $$;
revoke all on function public.apply_farm_changes(uuid, bigint, jsonb, text, jsonb) from public, anon, authenticated;
grant execute on function public.apply_farm_changes(uuid, bigint, jsonb, text, jsonb) to service_role;
