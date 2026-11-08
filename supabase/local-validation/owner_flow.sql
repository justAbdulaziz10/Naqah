-- LOCAL ONLY. Checks 0006 (schedule, herd count, several workers, report calls) on a throwaway
-- database after bootstrap.sql and every migration (see run-foundation.sh). Prints PASS/FAIL rows.
\set A '''00000000-0000-0000-0000-00000000000a'''
\set B '''00000000-0000-0000-0000-00000000000b'''
create schema t; grant usage on schema t to public;
create table t.results(n serial, name text, ok boolean, detail text); grant insert, select on t.results to public;
grant usage on sequence t.results_n_seq to public;
create function t.fails(name text, q text, state text) returns void language plpgsql as $$
begin
  begin execute q;
  exception when others then
    insert into t.results(name, ok, detail) values (name, state is null or sqlstate = state, sqlstate || ' ' || sqlerrm);
    return;
  end;
  insert into t.results(name, ok, detail) values (name, false, 'succeeded unexpectedly');
end $$;
create function t.check(name text, cond boolean, detail text default '') returns void language sql as $$
  insert into t.results(name, ok, detail) values (name, coalesce(cond, false), detail);
$$;
grant execute on all functions in schema t to public;

insert into auth.users values (:A), (:B);

-- ── Owner A: schedule, herd count, workers ──
set role authenticated; select set_config('request.jwt.claim.sub', :A, false);
insert into farms (owner_id) values (:A);
update farms set call_day = 4, call_time = '17:30', herd_count = 42, herd_count_reviewed_at = now();
select t.check('owner saves the call schedule and herd count', (select call_day = 4 and call_time = '17:30' and herd_count = 42 from farms));
select t.fails('call day is a weekday', 'update farms set call_day = 7', '23514');
select t.fails('herd count is not negative', 'update farms set herd_count = -1', '23514');
select t.fails('owner cannot write herd_count_reported', $q$update reports set herd_count_reported = 1$q$, '42501');

insert into workers (id, farm_id, name) select ('20000000-0000-4000-8000-00000000000' || g)::uuid, id, 'W' || g from farms, generate_series(1, 3) g;
select t.check('Basic: three workers', (select count(*) = 3 from workers));
select t.fails('Basic: no fourth worker', $q$insert into workers (farm_id, name) select id, 'W4' from farms$q$, '23514');
insert into workers (id, farm_id, name) select '20000000-0000-4000-8000-000000000001', id, 'again' from farms
  on conflict (id) do update set name = excluded.name;
select t.check('Basic: retrying an existing worker is not a fourth', (select count(*) = 3 and bool_or(name = 'again') from workers));
update farms set primary_worker_id = '20000000-0000-4000-8000-000000000002';
select t.check('owner picks the primary worker', (select primary_worker_id = '20000000-0000-4000-8000-000000000002' from farms));
update farms set primary_worker_id = '20000000-0000-4000-8000-000000000003';
select t.check('owner switches the primary worker in one update', (select primary_worker_id = '20000000-0000-4000-8000-000000000003' from farms));
delete from workers where id = '20000000-0000-4000-8000-000000000003';
select t.check('deleting the primary worker clears it', (select primary_worker_id is null from farms));
select t.fails('owner cannot write report calls', $q$insert into report_call_runs (farm_id, occurrence, trigger, state) select id, now(), 'manual', 'calling' from farms$q$, '42501');
reset role;

-- ── Owner B can't see or point at A's workers ──
set role authenticated; select set_config('request.jwt.claim.sub', :B, false);
insert into farms (owner_id) values (:B);
select t.check('B sees no A worker', (select count(*) = 0 from workers));
select t.fails('B cannot make A worker their primary', $q$update farms set primary_worker_id = '20000000-0000-4000-8000-000000000001'$q$, '23503');
reset role;

-- Ultimate allows ten.
update farms set plan = 'ultimate' where owner_id = :B;
insert into workers (farm_id, name) select id, 'U' || g from farms, generate_series(1, 10) g where owner_id = :B;
select t.check('Ultimate: ten workers', (select count(*) = 10 from workers w join farms f on f.id = w.farm_id where f.owner_id = :B));
select t.fails('Ultimate: no eleventh worker', format($q$insert into workers (farm_id) values (%L)$q$, (select id from farms where owner_id = :B)), '23514');

-- ── Service: a report call, its retries, then the report ──
create function t.fa() returns uuid language sql stable as $$ select id from public.farms where owner_id = '00000000-0000-0000-0000-00000000000a' $$;
grant execute on function t.fa() to public;
set role service_role;
select t.check('service: start a report call', (select apply_farm_changes(t.fa(), 0, jsonb_build_object(
  'report_call_runs', jsonb_build_array(jsonb_build_object('id', '50000000-0000-4000-8000-000000000001', 'occurrence', '2026-11-12T14:30:00Z',
    'trigger', 'schedule', 'attempts', '[{"at":"2026-11-12T14:30:05Z","result":"pending"}]'::jsonb, 'state', 'calling',
    'provider_call_id', 'CA100')))) = 1));
select t.fails('service: one run per slot', format($q$select apply_farm_changes(t.fa(), 1, %L::jsonb)$q$, jsonb_build_object(
  'report_call_runs', jsonb_build_array(jsonb_build_object('id', '50000000-0000-4000-8000-000000000002', 'occurrence', '2026-11-12T14:30:00Z',
    'trigger', 'schedule', 'state', 'calling')))), '23505');
select t.check('service: retry keeps the provider call id', (select apply_farm_changes(t.fa(), 1, jsonb_build_object(
  'report_call_runs', jsonb_build_array(jsonb_build_object('id', '50000000-0000-4000-8000-000000000001', 'occurrence', '2026-11-12T14:30:00Z',
    'trigger', 'schedule', 'attempts', '[{"at":"2026-11-12T14:30:05Z","result":"no_answer"}]'::jsonb, 'state', 'calling',
    'next_attempt_at', '2026-11-12T14:50:05Z')))) = 2));
select t.check('service: a retry keeps the first provider call id', (select provider_call_id = 'CA100' from report_call_runs));
select t.check('service: report with a herd count completes the run', (select apply_farm_changes(t.fa(), 2, jsonb_build_object(
  'calls', jsonb_build_array(jsonb_build_object('id', '30000000-0000-4000-8000-000000000001', 'kind', 'worker_report', 'direction', 'outbound',
    'party', 'worker', 'at', '2026-11-12T14:52:00Z', 'outcome', 'completed', 'summary_ar', 'م', 'summary_en', 'c',
    'report_id', '40000000-0000-4000-8000-000000000001')),
  'reports', jsonb_build_array(jsonb_build_object('id', '40000000-0000-4000-8000-000000000001', 'call_id', '30000000-0000-4000-8000-000000000001',
    'at', '2026-11-12T14:52:00Z', 'herd_count_reported', 40)),
  'report_call_runs', jsonb_build_array(jsonb_build_object('id', '50000000-0000-4000-8000-000000000001', 'occurrence', '2026-11-12T14:30:00Z',
    'trigger', 'schedule', 'attempts', '[{"at":"2026-11-12T14:30:05Z","result":"no_answer"},{"at":"2026-11-12T14:50:05Z","result":"answered"}]'::jsonb,
    'state', 'completed', 'report_id', '40000000-0000-4000-8000-000000000001')))) = 3));
select t.check('service: the reported herd count is stored', (select herd_count_reported = 40 from reports));
select t.check('service: the run points at its report', (select state = 'completed' and report_id is not null and jsonb_array_length(attempts) = 2 from report_call_runs));
select t.check('service: logs a missed report call', (select apply_farm_changes(t.fa(), 3, jsonb_build_object(
  'calls', jsonb_build_array(jsonb_build_object('id', '30000000-0000-4000-8000-000000000002', 'kind', 'worker_report_missed', 'direction', 'outbound',
    'party', 'worker', 'at', '2026-11-12T14:30:40Z', 'outcome', 'no_answer', 'attempt', 1, 'summary_ar', 'م', 'summary_en', 'm')))) = 4));
select t.fails('service: cannot move another farm run', format($q$select apply_farm_changes(%L, 0, %L::jsonb)$q$, (select id from farms where owner_id = :B),
  jsonb_build_object('report_call_runs', jsonb_build_array(jsonb_build_object('id', '50000000-0000-4000-8000-000000000001',
    'occurrence', '2026-11-12T14:30:00Z', 'trigger', 'schedule', 'state', 'missed')))), '23503');
reset role;

set role authenticated; select set_config('request.jwt.claim.sub', :A, false);
select t.check('owner reads their report calls', (select count(*) = 1 from report_call_runs));
reset role;
set role authenticated; select set_config('request.jwt.claim.sub', :B, false);
select t.check('B reads no A report call', (select count(*) = 0 from report_call_runs));
reset role;

select t.check('anon reads no report call', not has_table_privilege('anon', 'report_call_runs', 'select'));

select (case when ok then 'PASS ' else 'FAIL ' end) || name || case when ok then '' else ' :: ' || detail end from t.results order by n;
select count(*) filter (where ok) || '|' || count(*) from t.results;
