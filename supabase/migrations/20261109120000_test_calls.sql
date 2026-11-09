create table test_call_ranches (
  farm_id uuid primary key references farms (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table test_calls (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  actor_id uuid not null references auth.users (id),
  farm_id uuid not null references farms (id) on delete cascade,
  run_id uuid references report_call_runs (id) on delete set null,
  destination_masked text not null check (destination_masked ~ '^\+9665\*{6}[0-9]{2}$'),
  charge_confirmed boolean not null check (charge_confirmed),
  consent_confirmed boolean not null check (consent_confirmed),
  status text not null check (status in ('calling', 'ringing', 'connected', 'completed', 'failed')),
  result text check (result in ('report_saved', 'no_report', 'no_answer', 'busy', 'failed', 'canceled', 'timed_out')),
  failure text check (failure in ('saudi_calls_disabled', 'provider_rejected', 'number_rejected', 'network_error', 'not_placed')),
  report_saved boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ended_at timestamptz
);
create unique index test_calls_one_active on test_calls ((true)) where status in ('calling', 'ringing', 'connected');
create index test_calls_actor_latest on test_calls (actor_id, created_at desc);
create unique index test_calls_run on test_calls (run_id) where run_id is not null;

alter table test_call_ranches enable row level security;
alter table test_calls enable row level security;
revoke all on test_call_ranches, test_calls from public, anon, authenticated;
grant all on test_call_ranches, test_calls to service_role;

create function reset_test_call_ranch(p_test_call_id uuid) returns void
language plpgsql security invoker set search_path = '' as $$
declare ranch_id uuid;
begin
  select f.id into ranch_id from public.test_calls t
    join public.farms f on f.id = t.farm_id and f.owner_id = t.actor_id
    join public.test_call_ranches r on r.farm_id = f.id
    where t.id = p_test_call_id and t.status = 'calling'
    for update of f, r, t;
  if ranch_id is null then
    raise exception 'No marked test ranch' using errcode = 'insufficient_privilege';
  end if;
  update public.test_calls t set report_saved = (t.report_saved or r.report_id is not null)
    from public.report_call_runs r where t.run_id = r.id and t.farm_id = ranch_id;
  delete from public.voice_call_sessions where farm_id = ranch_id;
  delete from public.report_call_runs where farm_id = ranch_id;
  delete from public.reports where farm_id = ranch_id;
  update public.farms set last_update_at = null, revision = revision + 1 where id = ranch_id;
end $$;
revoke all on function reset_test_call_ranch(uuid) from public, anon, authenticated;
grant execute on function reset_test_call_ranch(uuid) to service_role;
