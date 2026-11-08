-- NAQAH | ناقة — initial production schema (Supabase / Postgres 15+).
--
-- Mirrors src/domain/types.ts. The investor demo does NOT use this yet (it keeps one
-- Workspace in localStorage); this is the starting point for the real service.
--
-- Ownership model (MVP scope): one owner (auth.users row) → one farm → one worker.
-- Every child row carries farm_id; RLS lets an authenticated owner read/write only
-- their own farm. Telephony webhooks (Twilio + voice model) run server-side with the
-- service_role key, which bypasses RLS — never expose that key to the browser.
-- Rows never move between farms, and every cross-table link stays inside one farm
-- (composite foreign keys + triggers), so a service-side bug cannot mix two farms.
--
-- Postgres 15+ is required for `on delete set null (column)` on composite foreign keys.
-- Recordings are never stored. Only extracted facts (answers, levels, findings).

-- ───────────────────────────── enums ─────────────────────────────
create type plan as enum ('basic', 'ultimate');
create type worker_language as enum ('ar', 'en', 'ur', 'hi', 'bn', 'fil');
create type certainty as enum ('reported', 'approximate', 'unknown', 'verified');
create type resource_kind as enum ('feed', 'water', 'fences', 'shelter', 'medicine');
create type level as enum ('good', 'medium', 'low', 'critical', 'unknown');
create type health_status as enum ('healthy', 'watch', 'sick', 'unknown');
create type camel_sex as enum ('female', 'male');
create type criterion_kind as enum ('sick_camel', 'low_feed', 'low_water', 'fence_damage', 'missing_camel', 'medicine_low', 'custom');
create type emergency_kind as enum ('injury', 'missing_camel', 'fire', 'predator', 'theft', 'death', 'custom');
create type question_category as enum ('health', 'feed', 'water', 'fences', 'shelter', 'medicine', 'general');
create type answer_kind as enum ('level', 'yesno', 'herd-health', 'text');
create type call_kind as enum (
  'worker_report', 'worker_report_rejected', 'worker_callback', 'worker_instruction',
  'worker_task_verification', 'owner_notification', 'owner_inquiry', 'owner_inquiry_rejected'
);
create type call_outcome as enum ('completed', 'no_answer', 'rejected');
create type call_direction as enum ('inbound', 'outbound');
create type call_party as enum ('worker', 'owner');
create type ticket_status as enum ('open', 'closed');
create type worker_call_purpose as enum ('instruction', 'task_verification');
create type worker_call_state as enum ('pending', 'delivered', 'no_answer_ticket');
create type event_tone as enum ('neutral', 'success', 'attention', 'danger');

-- ───────────────────────────── shared helpers ─────────────────────────────
-- Helpers live in `private`, which the Data API does not expose, so none of them is an RPC.
-- Every function pins an empty search_path and schema-qualifies what it touches.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

create function private.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- A row keeps the parent it was created under (farm_id, report_id, …): moving it would
-- carry one farm's data into another and skip the checks that ran on insert.
create function private.keep_parent() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (to_jsonb(new) -> tg_argv[0]) is distinct from (to_jsonb(old) -> tg_argv[0]) then
    raise exception '%.% cannot change after the row is created', tg_table_name, tg_argv[0]
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

-- ───────────────────────────── farm (owner + settings) ─────────────────────────────
-- Setup details are optional: the owner may finish or skip the guided setup with empty
-- names, phones and schedule. Call readiness is decided by the app/voice service, not here.
create table farms (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references auth.users (id) on delete cascade, -- MVP: one farm per owner
  plan plan not null default 'basic',
  setup_complete boolean not null default false, -- finished or skipped the guided setup
  owner_name text not null default '',
  owner_phone text not null default '',          -- E.164; used to recognise the owner's inbound calls
  name text not null default '',
  location text not null default '',
  latitude double precision check (latitude between -90 and 90),     -- optional GPS point for weather
  longitude double precision check (longitude between -180 and 180),
  supplier_name text not null default '',        -- Settings → Connections (WhatsApp deep links)
  supplier_phone text not null default '',
  -- Basic only: weekly reporting window (Asia/Riyadh). Owner sets day + start + end explicitly.
  -- A saved draft may hold the day before the times; reporting needs all three (enforced in src/domain/rules.ts).
  window_day smallint check (window_day between 0 and 6), -- 0 = Sunday
  window_start time,
  window_end time,
  last_update_at timestamptz,
  owner_allowance_used_at timestamptz,          -- Basic: weekly owner call consumed
  missed_notification_at timestamptz,           -- Basic: a missed notification allows one callback
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint coords_complete check ((latitude is null) = (longitude is null)),
  constraint window_times_need_day check (window_day is not null or (window_start is null and window_end is null)),
  constraint window_end_after_start check (window_start is null or window_end is null or window_end > window_start)
);
create trigger farms_updated before update on farms for each row execute function private.set_updated_at();

-- MVP: exactly one worker per farm. Name and phone may be saved empty during setup.
create table workers (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null unique references farms (id) on delete cascade,
  name text not null default '',
  phone text not null default '',                -- E.164; identification signal only, not proof
  language worker_language not null default 'ar',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger workers_updated before update on workers for each row execute function private.set_updated_at();

create table camels (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references farms (id) on delete cascade,
  name text not null,
  tag text not null default '',                  -- no longer asked for; existing tags are kept and shown
  sex camel_sex not null default 'female',
  age_years smallint check (age_years between 0 and 60),
  health health_status not null default 'unknown',
  health_note text,
  certainty certainty not null default 'unknown',
  updated_at timestamptz,
  created_at timestamptz not null default now()
);
create index camels_farm on camels (farm_id);

create table resources (
  farm_id uuid not null references farms (id) on delete cascade,
  kind resource_kind not null,
  present boolean not null default true,
  level level not null default 'unknown',
  quantity text,                                 -- rough, e.g. "about 12 bags"; never a precise stock count
  note text,
  certainty certainty not null default 'unknown',
  updated_at timestamptz,
  primary key (farm_id, kind)
);

-- Predefined questions are owned by the NAQAH team (global, read-only for owners).
create table predefined_questions (
  id text primary key,
  category question_category not null,
  requires resource_kind,
  answer_kind answer_kind not null,
  text_ar text not null,
  text_en text not null,
  sort_order smallint not null default 0,
  active boolean not null default true
);

create table custom_questions (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references farms (id) on delete cascade,
  text text not null check (length(trim(text)) > 0),
  sort_order smallint not null default 0,
  created_at timestamptz not null default now()
);
create index custom_questions_farm on custom_questions (farm_id);

-- Basic plan: at most 5 custom questions (enforced in the DB as well as the app).
-- Inserts are the only way to add a question to a farm: farm_id is immutable (keep_parent).
-- SECURITY INVOKER on purpose: an owner's lookup stays under RLS (they see all of their own
-- farm's questions, and nothing of another farm's), so this trigger never reads or locks
-- another owner's farm before the RLS check rejects the row.
create function private.enforce_custom_question_limit() returns trigger
language plpgsql set search_path = '' as $$
declare
  farm_plan public.plan;
  existing int;
begin
  -- Lock the farm row so two concurrent inserts (or an insert and a downgrade) can't both pass.
  select f.plan into farm_plan from public.farms f where f.id = new.farm_id for update;
  if farm_plan = 'basic' then
    select count(*) into existing from public.custom_questions q where q.farm_id = new.farm_id;
    if existing >= 5 then
      raise exception 'Basic plan allows up to 5 custom questions' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;
create trigger custom_questions_limit before insert on custom_questions
  for each row execute function private.enforce_custom_question_limit();

-- Switching a farm to Basic must also respect the 5-question limit.
-- Only service_role can change plan (column grants), so this runs with full visibility.
create function private.enforce_plan_downgrade() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.plan = 'basic' and old.plan <> 'basic'
     and (select count(*) from public.custom_questions q where q.farm_id = new.id) > 5 then
    raise exception 'Remove custom questions down to 5 before switching to Basic' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger farms_plan_downgrade before update of plan on farms
  for each row execute function private.enforce_plan_downgrade();

create table criteria (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references farms (id) on delete cascade,
  kind criterion_kind not null,
  label text,
  enabled boolean not null default true,
  constraint custom_needs_label check (kind <> 'custom' or label is not null)
);
create index criteria_farm on criteria (farm_id);

create table emergency_categories (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references farms (id) on delete cascade,
  kind emergency_kind not null,
  label text,
  constraint custom_needs_label check (kind <> 'custom' or label is not null)
);
create index emergency_categories_farm on emergency_categories (farm_id);

-- ───────────────────────────── calls & reports ─────────────────────────────
-- No audio, no transcripts: only what NAQAH did and the facts it extracted.
-- Links between farm tables use (farm_id, id) foreign keys, so both ends share a farm.
create table calls (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references farms (id) on delete cascade,
  kind call_kind not null,
  direction call_direction not null,
  party call_party not null,
  at timestamptz not null default now(),
  outcome call_outcome not null,
  attempt smallint check (attempt between 1 and 4),  -- 1 = first attempt, 2..4 = retries
  summary_ar text not null default '',
  summary_en text not null default '',
  provider_call_id text,                         -- e.g. Twilio CallSid (for support, not audio)
  task_ticket_id uuid,
  report_id uuid,
  unique (farm_id, id)
);
create index calls_farm_at on calls (farm_id, at desc);

create table reports (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references farms (id) on delete cascade,
  call_id uuid,
  at timestamptz not null default now(),
  unique (farm_id, id),
  constraint reports_call_fk foreign key (farm_id, call_id)
    references calls (farm_id, id) on delete set null (call_id)
);
create index reports_farm_at on reports (farm_id, at desc);

create table report_answers (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references reports (id) on delete cascade,
  question_id text not null,                     -- predefined id or custom_questions.id (snapshot, not a FK)
  question_ar text not null,
  question_en text not null,
  answer text not null,                          -- what the worker said (free text kept verbatim)
  answer_ar text,                                -- fixed-choice answers in both UI languages (null for free text)
  answer_en text,
  certainty certainty not null,
  follow_up boolean not null default false,      -- contextual follow-up; does not count toward Basic's 5
  sort_order smallint not null default 0
);
create index report_answers_report on report_answers (report_id);

create table findings (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references reports (id) on delete cascade,
  criterion_id uuid references criteria (id) on delete set null,
  text_ar text not null,
  text_en text not null
);
create index findings_report on findings (report_id);

-- A finding's criterion must belong to the same farm as its report.
create function private.check_finding_farm() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.criterion_id is not null and not exists (
    select 1
    from public.reports r
    join public.criteria c on c.farm_id = r.farm_id
    where r.id = new.report_id and c.id = new.criterion_id
  ) then
    raise exception 'Finding criterion belongs to a different farm than its report'
      using errcode = 'foreign_key_violation';
  end if;
  return new;
end $$;
create trigger findings_same_farm before insert or update of report_id, criterion_id on findings
  for each row execute function private.check_finding_farm();

alter table calls add constraint calls_report_fk foreign key (farm_id, report_id)
  references reports (farm_id, id) on delete set null (report_id);

-- ───────────────────────────── tickets & follow-ups ─────────────────────────────
-- Ultimate only. Closes ONLY when the worker explicitly confirms; deadlines never close it.
create table task_tickets (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references farms (id) on delete cascade,
  instruction text not null,
  created_at timestamptz not null default now(),
  scheduled_for timestamptz,                     -- null = "any time"
  status ticket_status not null default 'open',
  closed_at timestamptz,
  closed_via call_kind,
  unique (farm_id, id),
  constraint closed_consistent check (
    (status = 'open' and closed_at is null and closed_via is null)
    or (status = 'closed' and closed_at is not null and closed_via is not null)
  )
);
create index task_tickets_farm_status on task_tickets (farm_id, status);

alter table calls add constraint calls_task_fk foreign key (farm_id, task_ticket_id)
  references task_tickets (farm_id, id) on delete set null (task_ticket_id);

-- A message relayed to the worker (Basic relays without a ticket).
create table relays (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references farms (id) on delete cascade,
  at timestamptz not null default now(),
  message text not null,
  delivered boolean not null default false,
  unique (farm_id, id)
);
create index relays_farm on relays (farm_id);

-- AI → worker call with retries: first attempt + up to 3 retries, 20 minutes apart.
create table pending_worker_calls (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references farms (id) on delete cascade,
  purpose worker_call_purpose not null,
  message text not null,
  task_ticket_id uuid,
  relay_id uuid,
  next_attempt_at timestamptz,                   -- null when finished; a scheduler polls this
  state worker_call_state not null default 'pending',
  created_at timestamptz not null default now(),
  constraint pending_worker_calls_task_fk foreign key (farm_id, task_ticket_id)
    references task_tickets (farm_id, id) on delete set null (task_ticket_id),
  constraint pending_worker_calls_relay_fk foreign key (farm_id, relay_id)
    references relays (farm_id, id) on delete set null (relay_id)
);
create index pending_worker_calls_due on pending_worker_calls (next_attempt_at) where state = 'pending';
create index pending_worker_calls_farm on pending_worker_calls (farm_id);

create table worker_call_attempts (
  id uuid primary key default gen_random_uuid(),
  pending_call_id uuid not null references pending_worker_calls (id) on delete cascade,
  at timestamptz not null default now(),
  answered boolean not null
);
create index worker_call_attempts_call on worker_call_attempts (pending_call_id);

create table no_answer_tickets (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references farms (id) on delete cascade,
  created_at timestamptz not null default now(),
  purpose worker_call_purpose not null,
  message text not null,
  task_ticket_id uuid,
  status ticket_status not null default 'open',
  closed_at timestamptz,
  constraint no_answer_tickets_task_fk foreign key (farm_id, task_ticket_id)
    references task_tickets (farm_id, id) on delete set null (task_ticket_id)
);
create index no_answer_tickets_farm_status on no_answer_tickets (farm_id, status);

create table events (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references farms (id) on delete cascade,
  at timestamptz not null default now(),
  tone event_tone not null default 'neutral',
  text_ar text not null,
  text_en text not null
);
create index events_farm_at on events (farm_id, at desc);

-- Rows never change parent (see private.keep_parent).
do $$
declare t text;
begin
  foreach t in array array[
    'workers', 'camels', 'resources', 'custom_questions', 'criteria', 'emergency_categories',
    'calls', 'reports', 'task_tickets', 'relays', 'pending_worker_calls', 'no_answer_tickets', 'events'
  ] loop
    execute format(
      'create trigger %I before update of farm_id on %I for each row execute function private.keep_parent(%L)',
      t || '_keep_farm', t, 'farm_id'
    );
  end loop;
end $$;
create trigger report_answers_keep_report before update of report_id on report_answers
  for each row execute function private.keep_parent('report_id');
create trigger findings_keep_report before update of report_id on findings
  for each row execute function private.keep_parent('report_id');
create trigger worker_call_attempts_keep_call before update of pending_call_id on worker_call_attempts
  for each row execute function private.keep_parent('pending_call_id');

-- Trigger functions run only as triggers; nobody needs to call them directly.
revoke all on function private.set_updated_at(), private.keep_parent(),
  private.enforce_custom_question_limit(), private.enforce_plan_downgrade(), private.check_finding_farm()
  from public, anon, authenticated;

-- ───────────────────────────── row level security ─────────────────────────────
create function private.is_farm_owner(fid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.farms f where f.id = fid and f.owner_id = (select auth.uid()));
$$;
revoke all on function private.is_farm_owner(uuid) from public, anon;
grant execute on function private.is_farm_owner(uuid) to authenticated;

-- Table privileges are explicit rather than inherited from Supabase's broad defaults
-- (which grant ALL, including TRUNCATE, to anon and authenticated). anon gets nothing.
revoke all on table
  farms, workers, camels, resources, predefined_questions, custom_questions, criteria, emergency_categories,
  calls, reports, report_answers, findings, task_tickets, relays, pending_worker_calls, worker_call_attempts,
  no_answer_tickets, events
  from public, anon, authenticated;
grant all on table
  farms, workers, camels, resources, predefined_questions, custom_questions, criteria, emergency_categories,
  calls, reports, report_answers, findings, task_tickets, relays, pending_worker_calls, worker_call_attempts,
  no_answer_tickets, events
  to service_role;

alter table farms enable row level security;
create policy farms_owner on farms for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

-- RLS scopes *rows*; column grants scope *what* an owner may write. Plan (billing) and the
-- call-allowance / last-update bookkeeping are written only by the service (service_role).
grant select, delete on farms to authenticated;
grant insert (owner_id, owner_name, owner_phone, name, location, latitude, longitude, supplier_name, supplier_phone,
              window_day, window_start, window_end, setup_complete)
  on farms to authenticated;
grant update (owner_name, owner_phone, name, location, latitude, longitude, supplier_name, supplier_phone,
              window_day, window_start, window_end, setup_complete)
  on farms to authenticated;

-- Tables keyed directly by farm_id: owner has full access to their farm's rows.
do $$
declare t text;
begin
  foreach t in array array[
    'workers', 'camels', 'resources', 'custom_questions', 'criteria', 'emergency_categories'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('grant select, insert, update, delete on table %I to authenticated', t);
    execute format(
      'create policy %I on %I for all to authenticated using (private.is_farm_owner(farm_id)) with check (private.is_farm_owner(farm_id))',
      t || '_owner', t
    );
  end loop;
end $$;

-- Written only by the voice service (service_role). Owners may read.
do $$
declare t text;
begin
  -- relays + events included: owners must not mark messages delivered or forge the activity feed.
  foreach t in array array['calls', 'reports', 'pending_worker_calls', 'no_answer_tickets', 'task_tickets', 'relays', 'events'] loop
    execute format('alter table %I enable row level security', t);
    execute format('grant select on table %I to authenticated', t);
    execute format(
      'create policy %I on %I for select to authenticated using (private.is_farm_owner(farm_id))',
      t || '_owner_read', t
    );
  end loop;
end $$;

grant select on table report_answers, findings, worker_call_attempts, predefined_questions to authenticated;

alter table report_answers enable row level security;
create policy report_answers_owner_read on report_answers for select to authenticated
  using (exists (select 1 from reports r where r.id = report_id and private.is_farm_owner(r.farm_id)));

alter table findings enable row level security;
create policy findings_owner_read on findings for select to authenticated
  using (exists (select 1 from reports r where r.id = report_id and private.is_farm_owner(r.farm_id)));

alter table worker_call_attempts enable row level security;
create policy worker_call_attempts_owner_read on worker_call_attempts for select to authenticated
  using (exists (select 1 from pending_worker_calls p where p.id = pending_call_id and private.is_farm_owner(p.farm_id)));

alter table predefined_questions enable row level security;
create policy predefined_questions_read on predefined_questions for select to authenticated using (active);

-- ───────────────────────────── seed: predefined questions (DRAFT wording) ─────────────────────────────
-- Keep in sync with PREDEFINED_QUESTIONS in src/domain/catalog.ts (OPEN DECISION 9).
insert into predefined_questions (id, category, requires, answer_kind, text_ar, text_en, sort_order) values
  ('herd_health', 'health', null, 'herd-health', 'كيف حال الحلال اليوم؟ فيه ناقة مريضة أو مصابة أو ما تاكل زين؟', 'How are the camels today? Is any camel sick, injured, or not eating well?', 1),
  ('herd_count', 'health', null, 'yesno', 'الحلال كله موجود وكامل العدد؟', 'Are all the camels present and accounted for?', 2),
  ('feed_level', 'feed', 'feed', 'level', 'كم باقي من العلف تقريباً؟', 'Roughly how much feed is left?', 3),
  ('water_level', 'water', 'water', 'level', 'كيف وضع الماء؟ الخزان كافي؟', 'How is the water supply? Is the tank sufficient?', 4),
  ('fences_condition', 'fences', 'fences', 'level', 'الشبك سليم ولا فيه خراب؟', 'Are the fences intact, or is there any damage?', 5),
  ('shelter_condition', 'shelter', 'shelter', 'level', 'المظلات سليمة؟', 'Is the shade and shelter in good condition?', 6),
  ('medicine_stock', 'medicine', 'medicine', 'level', 'المستلزمات البيطرية كافية ولا قربت تخلص؟', 'Are the vet supplies sufficient, or running low?', 7);
