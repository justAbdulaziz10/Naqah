-- NAQAH | ناقة — owner flow. Applies on top of 0005.
--
-- NAQAH now calls the worker at a time the owner chooses, a farm can register more than one
-- worker, and the owner keeps an official herd count. Additive: no column or row is removed.
-- The retired Basic reporting window (window_day/start/end) stays so older data still loads.

-- ───────────────────────────── report call schedule + herd count ─────────────────────────────
-- Asia/Riyadh wall clock. Basic uses day + time (weekly); Ultimate uses time (daily) and ignores day.
alter table farms
  add column call_day smallint check (call_day between 0 and 6), -- 0 = Sunday
  add column call_time time,
  -- Official camel count, owner-controlled. A worker's count on a call is only a proposal.
  add column herd_count integer check (herd_count between 0 and 100000),
  -- Reports at or before this time have had their reported count reviewed by the owner.
  add column herd_count_reviewed_at timestamptz;

grant insert (call_day, call_time, herd_count, herd_count_reviewed_at) on farms to authenticated;
grant update (call_day, call_time, herd_count, herd_count_reviewed_at) on farms to authenticated;

-- ───────────────────────────── registered workers ─────────────────────────────
-- Was exactly one worker per farm. Now up to 3 (Basic) or 10 (Ultimate); the primary one is the
-- worker NAQAH calls for the report. Primary lives on the farm, so switching it is one update.
alter table workers drop constraint workers_farm_id_key;
alter table workers add constraint workers_farm_id_id_key unique (farm_id, id); -- also indexes farm_id

alter table farms add column primary_worker_id uuid;
alter table farms add constraint farms_primary_worker_fk foreign key (id, primary_worker_id)
  references workers (farm_id, id) on delete set null (primary_worker_id);
create index farms_primary_worker on farms (primary_worker_id, id) where primary_worker_id is not null;
grant insert (primary_worker_id) on farms to authenticated;
grant update (primary_worker_id) on farms to authenticated;

-- Every existing farm has at most one worker: it becomes the primary.
update farms f set primary_worker_id = w.id
from workers w where w.farm_id = f.id and f.primary_worker_id is null;

-- Same shape as the custom question limit (0005): lock the farm so two inserts can't both pass,
-- and don't count the row itself, so a retried upsert of an existing worker is not refused.
create function private.enforce_worker_limit() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare
  farm_plan public.plan;
  existing int;
begin
  select f.plan into farm_plan from public.farms f where f.id = new.farm_id for update;
  select count(*) into existing from public.workers w where w.farm_id = new.farm_id and w.id <> new.id;
  if existing >= (case when farm_plan = 'ultimate' then 10 else 3 end) then
    raise exception 'Worker limit reached for this plan' using errcode = 'check_violation';
  end if;
  return new;
end $$;
revoke all on function private.enforce_worker_limit() from public, anon, authenticated;
create trigger workers_limit before insert on workers for each row execute function private.enforce_worker_limit();

-- ───────────────────────────── report calls (NAQAH → worker) ─────────────────────────────
alter type call_kind add value if not exists 'worker_report_missed';

-- The worker's count on this report: a proposal for the owner, never the official count.
alter table reports add column herd_count_reported integer check (herd_count_reported between 0 and 100000);

-- One scheduled (or owner-triggered) report call: first attempt + retries 20 minutes apart.
-- occurrence is unique per farm, so a scheduler that runs twice can never call twice for one slot.
create table report_call_runs (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references farms (id) on delete cascade,
  occurrence timestamptz not null,
  trigger text not null check (trigger in ('schedule', 'manual')),
  -- [{ "at": iso, "result": "pending" | "answered" | "no_answer" }], oldest first.
  attempts jsonb not null default '[]'::jsonb check (jsonb_typeof(attempts) = 'array'),
  next_attempt_at timestamptz,
  state text not null check (state in ('calling', 'answered', 'completed', 'missed')),
  report_id uuid,
  provider_call_id text check (length(provider_call_id) <= 128),
  created_at timestamptz not null default now(),
  unique (farm_id, id),
  unique (farm_id, occurrence),
  constraint report_call_runs_report_fk foreign key (farm_id, report_id)
    references reports (farm_id, id) on delete set null (report_id)
);
create index report_call_runs_due on report_call_runs (next_attempt_at) where state = 'calling';
create index report_call_runs_report on report_call_runs (farm_id, report_id) where report_id is not null;
create index report_call_runs_provider on report_call_runs (provider_call_id) where provider_call_id is not null;
create trigger report_call_runs_keep_farm before update of farm_id on report_call_runs
  for each row execute function private.keep_parent('farm_id');

-- Written only by the voice service; owners read.
alter table report_call_runs enable row level security;
revoke all on table report_call_runs from public, anon, authenticated;
grant select on table report_call_runs to authenticated;
grant all on table report_call_runs to service_role;
create policy report_call_runs_owner_read on report_call_runs for select to authenticated
  using (private.is_farm_owner(farm_id));

-- ───────────────────────────── atomic service writes ─────────────────────────────
-- Same as 0002, plus reports.herd_count_reported and report_call_runs.
create or replace function public.apply_farm_changes(
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
  insert into public.reports (id, farm_id, call_id, at, herd_count_reported)
  select r.id, p_farm_id, r.call_id, r.at, r.herd_count_reported
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

  -- After reports, so a run can point at the report this same change saved.
  insert into public.report_call_runs (id, farm_id, occurrence, trigger, attempts, next_attempt_at, state, report_id, provider_call_id)
  select r.id, p_farm_id, r.occurrence, r.trigger, coalesce(r.attempts, '[]'::jsonb), r.next_attempt_at, r.state, r.report_id, r.provider_call_id
  from jsonb_populate_recordset(null::public.report_call_runs, coalesce(p_changes -> 'report_call_runs', '[]'::jsonb)) r
  on conflict (id) do update
    set attempts = excluded.attempts, next_attempt_at = excluded.next_attempt_at, state = excluded.state,
        report_id = excluded.report_id,
        provider_call_id = coalesce(excluded.provider_call_id, public.report_call_runs.provider_call_id)
    where public.report_call_runs.farm_id = excluded.farm_id;
  get diagnostics applied = row_count;
  perform private.require_applied('report_call_runs', applied, p_changes);

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
