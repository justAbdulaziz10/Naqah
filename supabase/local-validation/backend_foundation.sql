-- LOCAL ONLY. Checks 0002 on a throwaway database after bootstrap.sql and both migrations
-- (see run-foundation.sh). Prints PASS/FAIL rows.
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

-- ── First sign-in, exactly as the owner repository writes it (ensureFarm) ──
set role authenticated; select set_config('request.jwt.claim.sub', :A, false);
insert into farms (owner_id) values (:A) on conflict (owner_id) do nothing;
insert into farms (owner_id) values (:A) on conflict (owner_id) do nothing;
select t.check('ensureFarm: repeating creates one farm', (select count(*) = 1 from farms));
insert into resources (farm_id, kind, present) select id, 'feed', true from farms on conflict (farm_id, kind) do nothing;
insert into resources (farm_id, kind, present) select id, 'feed', false from farms on conflict (farm_id, kind) do nothing;
select t.check('ensureFarm: repeating keeps the first resource', (select present from resources where kind = 'feed'));
insert into criteria (id, farm_id, kind, enabled) select '10000000-0000-4000-8000-000000000001', id, 'low_feed', true from farms on conflict (id) do nothing;
insert into criteria (id, farm_id, kind, enabled) select '10000000-0000-4000-8000-000000000001', id, 'low_feed', false from farms on conflict (id) do nothing;
select t.check('ensureFarm: repeating adds no second criterion', (select count(*) = 1 and bool_and(enabled) from criteria));
insert into workers (id, farm_id) select '20000000-0000-4000-8000-000000000001', id from farms on conflict (id) do nothing;
insert into workers (id, farm_id) select '20000000-0000-4000-8000-000000000001', id from farms on conflict (id) do nothing;
select t.check('ensureFarm: repeating adds no second worker', (select count(*) = 1 from workers));
select t.check('new farm starts on Basic', (select plan = 'basic' from farms));

-- ── Owner writes ──
select t.check('owner reads revision', (select revision = 0 from farms));
select t.fails('owner cannot write revision', 'update farms set revision = 99', '42501');
select t.fails('owner cannot run apply_farm_changes',
  format($q$select apply_farm_changes(%L, 0, '{}'::jsonb)$q$, (select id from farms)), '42501');
select t.fails('owner cannot read voice_events', 'select * from voice_events', '42501');
select t.fails('owner cannot read voice_call_sessions', 'select * from voice_call_sessions', '42501');
select t.fails('owner cannot delete their farm', 'delete from farms', '42501');
select t.fails('owner cannot store an oversized camel note',
  format($q$insert into camels (farm_id, name, health_note) values (%L, 'x', repeat('a', 501))$q$, (select id from farms)), '23514');
select t.fails('owner cannot store a blank question',
  format($q$insert into custom_questions (farm_id, text) values (%L, E'\t')$q$, (select id from farms)), '23514');
select t.fails('owner cannot write voice_events',
  format($q$insert into voice_events (farm_id, event_id, outcome) values (%L, 'x', '{}')$q$, (select id from farms)), '42501');
select t.fails('owner cannot set a malformed owner phone', $q$update farms set owner_phone = '0501234567'$q$, '23514');
select t.fails('owner cannot set a malformed worker phone', $q$update workers set phone = 'call me'$q$, '23514');
update farms set owner_phone = '+966501234567'; update workers set phone = '+966507654321';
select t.check('E.164 phones are saved', (select owner_phone = '+966501234567' from farms));
update workers set phone = '';
select t.check('a phone can still be cleared', (select phone = '' from workers));
update workers set phone = '+966507654321';
select t.fails('owner cannot write a call', $q$insert into calls (farm_id, kind, direction, party, outcome) select id, 'worker_report', 'inbound', 'worker', 'completed' from farms$q$, '42501');
select t.fails('owner cannot write a report', $q$insert into reports (farm_id) select id from farms$q$, '42501');
select t.fails('owner cannot close a task', $q$update task_tickets set status = 'closed'$q$, '42501');
reset role;

-- ── Owner B: same worker number is allowed, and neither sees the other ──
set role authenticated; select set_config('request.jwt.claim.sub', :B, false);
insert into farms (owner_id) values (:B);
insert into workers (farm_id, phone) select id, '+966507654321' from farms;
select t.check('B sees only their own farm', (select count(*) = 1 from farms));
select t.check('B sees only their own worker', (select count(*) = 1 from workers));
select t.check('B cannot see A camels or resources', (select count(*) = 0 from resources));
reset role;
select t.fails('B cannot insert into A farm by id', format($q$set local role authenticated; set local request.jwt.claim.sub = %L; insert into camels (farm_id, name) values (%L, 'x')$q$,
  '00000000-0000-0000-0000-00000000000b', (select id from farms where owner_id = :A)), '42501');
reset role;

-- ── anon ──
set role anon;
select t.fails('anon cannot read farms', 'select * from farms', '42501');
select t.fails('anon cannot read voice_events', 'select * from voice_events', '42501');
select t.fails('anon cannot read voice_call_sessions', 'select * from voice_call_sessions', '42501');
select t.fails('anon cannot run apply_farm_changes',
  $q$select apply_farm_changes('00000000-0000-0000-0000-000000000000', 0, '{}'::jsonb)$q$, '42501');
reset role;

-- ── Service writes ──
create function t.fa() returns uuid language sql as $$ select id from public.farms where owner_id = '00000000-0000-0000-0000-00000000000a' $$;
create function t.fb() returns uuid language sql as $$ select id from public.farms where owner_id = '00000000-0000-0000-0000-00000000000b' $$;
grant execute on function t.fa(), t.fb() to public;
set role service_role;
select t.check('service: empty change bumps the revision', (select apply_farm_changes(t.fa(), 0, '{}'::jsonb) = 1));
select t.fails('service: stale revision is refused', 'select apply_farm_changes(t.fa(), 0, ''{}''::jsonb)', 'NQ409');
select t.fails('service: unknown farm is refused',
  $q$select apply_farm_changes('00000000-0000-0000-0000-000000000000', 0, '{}'::jsonb)$q$, 'NQ404');

-- A report and its call point at each other and must land together.
select apply_farm_changes(t.fa(), 1, jsonb_build_object(
  'reports', jsonb_build_array(jsonb_build_object('id', '20000000-0000-4000-8000-000000000001', 'call_id', '30000000-0000-4000-8000-000000000001', 'at', now())),
  'calls', jsonb_build_array(jsonb_build_object('id', '30000000-0000-4000-8000-000000000001', 'kind', 'worker_report', 'direction', 'inbound', 'party', 'worker',
    'at', now(), 'outcome', 'completed', 'summary_ar', 'ن', 'summary_en', 'n', 'report_id', '20000000-0000-4000-8000-000000000001')),
  'farm', jsonb_build_object('last_update_at', now())
), 'CA1:report', '{"status":"saved"}');
select t.check('service: report and call saved together', (select count(*) = 1 from calls c join reports r on r.call_id = c.id and c.report_id = r.id));
select t.check('service: bookkeeping saved', (select last_update_at is not null from farms where id = t.fa()));
select t.check('service: event recorded with its outcome', (select outcome ->> 'status' = 'saved' from voice_events where event_id = 'CA1:report'));
select t.fails('service: a repeated event is refused',
  $q$select apply_farm_changes(t.fa(), 2, '{}'::jsonb, 'CA1:report', '{}')$q$, '23505');
select t.check('service: a refused event bumps nothing', (select revision = 2 from farms where id = t.fa()));

select t.fails('service: a report must have its call', format($q$select apply_farm_changes(t.fa(), 2, %L::jsonb)$q$, jsonb_build_object(
  'reports', jsonb_build_array(jsonb_build_object('id', '20000000-0000-4000-8000-000000000002', 'call_id', '30000000-0000-4000-8000-000000000999', 'at', now())))), '23503');
select t.check('service: a failed save leaves nothing behind', (select count(*) = 1 from reports));

select t.fails('service: cannot update another farm row through its own farm', format($q$select apply_farm_changes(t.fb(), 0, %L::jsonb)$q$, jsonb_build_object(
  'calls', jsonb_build_array(jsonb_build_object('id', '30000000-0000-4000-8000-000000000001', 'kind', 'worker_report', 'direction', 'inbound', 'party', 'worker',
    'at', now(), 'outcome', 'completed', 'summary_ar', 'ن', 'summary_en', 'n')))), '23503');
select t.fails('service: cannot add answers to another farm report', format($q$select apply_farm_changes(t.fb(), 0, %L::jsonb)$q$, jsonb_build_object(
  'report_answers', jsonb_build_array(jsonb_build_object('report_id', '20000000-0000-4000-8000-000000000001', 'question_id', 'q', 'question_ar', 'q', 'question_en', 'q',
    'answer', 'a', 'certainty', 'reported', 'follow_up', false, 'sort_order', 0)))), '23503');
select t.fails('service: cannot edit another farm camel or an unknown resource', format($q$select apply_farm_changes(t.fb(), 0, %L::jsonb)$q$, jsonb_build_object(
  'resources', jsonb_build_array(jsonb_build_object('kind', 'feed', 'level', 'low', 'certainty', 'reported')))), '23503');
select t.check('service: failed cross-farm writes bump nothing', (select revision = 0 from farms where id = t.fb()));

-- Same event id on two farms is two events.
select t.check('service: event ids are per farm', (select apply_farm_changes(t.fb(), 0, '{}'::jsonb, 'CA1:report', '{}') = 1));
reset role;

-- ── Deleting ──
delete from reports where id = '20000000-0000-4000-8000-000000000001';
select t.check('deleting a report keeps its call', (select report_id is null from calls where id = '30000000-0000-4000-8000-000000000001'));

-- ── Catalogue ──
select t.check('RLS on every public table', (select count(*) = 0 from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and not relrowsecurity));
select t.check('apply_farm_changes is SECURITY INVOKER', (select not prosecdef from pg_proc where proname = 'apply_farm_changes'));
select t.check('no public function runs for anon or authenticated', (
  select not bool_or(has_function_privilege(r, p.oid, 'execute'))
  from pg_proc p, unnest(array['anon', 'authenticated']) r where p.pronamespace = 'public'::regnamespace));
select t.check('every function pins search_path', (
  select count(*) = 0 from pg_proc where pronamespace in ('public'::regnamespace, 'private'::regnamespace)
    and not coalesce(proconfig::text like '%search_path=%', false)));
select t.check('every foreign key has a leading index', (
  select count(*) = 0 from pg_constraint c
  where c.contype = 'f' and c.connamespace = 'public'::regnamespace
    and not exists (select 1 from pg_index i where i.indrelid = c.conrelid
      and (i.indkey::int2[])[0:cardinality(c.conkey) - 1] @> c.conkey))) ;

select (case when ok then 'PASS ' else 'FAIL ' end) || name || case when ok then '' else ' :: ' || detail end from t.results order by n;
select count(*) filter (where ok) || '|' || count(*) from t.results;
