-- LOCAL ONLY. Owner isolation, plan limit, same-farm links, grants and function checks.
-- Runs after bootstrap.sql + the migration on a throwaway database (see run.sh). Prints PASS/FAIL rows.
\set A '''00000000-0000-0000-0000-00000000000a'''
\set B '''00000000-0000-0000-0000-00000000000b'''
create schema t; grant usage on schema t to public;
create table t.results(n serial, name text, ok boolean, detail text); grant insert, select on t.results to public; grant usage on t.results_n_seq to public;
create function t.fails(name text, q text, state text) returns void language plpgsql as $$
begin
  begin execute q;
  exception when others then
    insert into t.results(name, ok, detail) values (name, state is null or sqlstate = state, sqlstate || ' ' || sqlerrm); return;
  end;
  insert into t.results(name, ok, detail) values (name, false, 'succeeded unexpectedly');
end $$;
create function t.check(name text, cond boolean, detail text default '') returns void language sql as $$
  insert into t.results(name, ok, detail) values (name, coalesce(cond, false), detail);
$$;
grant execute on all functions in schema t to public;

insert into auth.users values (:A), (:B);

-- ── Owner A ──
set role authenticated; select set_config('request.jwt.claim.sub', :A, false);
select t.fails('A cannot choose plan on insert', format($q$insert into farms (owner_id, plan) values (%L, 'ultimate')$q$, :A), '42501');
select t.fails('A cannot create farm for B', format($q$insert into farms (owner_id) values (%L)$q$, :B), '42501');
insert into farms (owner_id, setup_complete) values (:A, true);  -- skipped setup: empty details, Basic, no window
select t.check('A: skipped setup saved with empty details and no window', (select setup_complete and plan = 'basic' and window_day is null from farms));
select t.fails('A cannot upgrade own plan', 'update farms set plan = ''ultimate''', '42501');
select t.fails('A cannot write allowance bookkeeping', 'update farms set owner_allowance_used_at = now()', '42501');
select t.fails('A cannot write last_update_at', 'update farms set last_update_at = now()', '42501');
select t.fails('A cannot hand farm to B', format('update farms set owner_id = %L', :B), '42501');
update farms set window_day = 4;   -- draft: day first
select t.check('A: window draft with day only', (select window_day = 4 and window_start is null from farms));
select t.fails('times without a day rejected', 'update farms set window_day = null, window_start = ''17:00'', window_end = ''19:00''', '23514');
select t.fails('end before start rejected', 'update farms set window_start = ''19:00'', window_end = ''17:00''', '23514');
select t.fails('half coordinates rejected', 'update farms set latitude = 24.1', '23514');
update farms set window_start = '17:00', window_end = '19:00', latitude = 24.155, longitude = 47.334,
  owner_name = 'Abdullah', supplier_name = 'Feed Co', supplier_phone = '+966500000000';
insert into workers (farm_id) select id from farms;  -- worker details optional
select t.check('A: worker saved empty', (select name = '' and phone = '' from workers));
insert into camels (farm_id, name) select id, 'Hamra' from farms;
insert into camels (farm_id, name, tag) select id, 'Shaqha', 'SA-0042' from farms;  -- older record with a tag
update camels set name = 'Shaqha 2', health = 'watch' where tag = 'SA-0042';  -- edit form no longer sends tag
select t.check('camel tag defaults to empty', (select tag = '' from camels where name = 'Hamra'));
select t.check('existing camel tag preserved on edit', (select tag = 'SA-0042' from camels where name = 'Shaqha 2'));
insert into custom_questions (farm_id, text) select id, 'Q' || g from farms, generate_series(1, 5) g;
select t.fails('Basic: 6th custom question rejected', 'insert into custom_questions (farm_id, text) select id, ''Q6'' from farms', '23514');
select t.check('Basic keeps exactly 5', (select count(*) = 5 from custom_questions));
insert into criteria (farm_id, kind) select id, 'sick_camel' from farms;
insert into resources (farm_id, kind) select id, 'feed' from farms;
select t.fails('owner cannot insert calls', 'insert into calls (farm_id, kind, direction, party, outcome) select id, ''owner_inquiry'', ''inbound'', ''owner'', ''completed'' from farms', '42501');
select t.fails('owner cannot insert events', 'insert into events (farm_id, text_ar, text_en) select id, ''x'', ''x'' from farms', '42501');
select t.fails('owner cannot truncate calls', 'truncate calls', '42501');
select t.fails('owner cannot truncate camels', 'truncate camels', '42501');
select t.check('owner reads predefined questions', (select count(*) = 7 from predefined_questions));
select t.fails('owner cannot edit predefined questions', 'update predefined_questions set active = false', '42501');
reset role;

-- ── Owner B ──
set role authenticated; select set_config('request.jwt.claim.sub', :B, false);
insert into farms (owner_id) values (:B);
select t.check('B sees only own farm', (select count(*) = 1 and bool_and(owner_id = :B) from farms));
select t.check('B sees no A camels/questions/workers/criteria', (select (select count(*) from camels) + (select count(*) from custom_questions) + (select count(*) from workers) + (select count(*) from criteria) = 0));
reset role;
select set_config('t.farm_a', (select id::text from farms where owner_id = :A), false);
select set_config('t.farm_b', (select id::text from farms where owner_id = :B), false);
set role authenticated; select set_config('request.jwt.claim.sub', :B, false);
with i as (insert into camels (farm_id, name) select id, 'x' from farms f where owner_id = :A returning 1) select t.check('B cannot target A farm by lookup (0 rows)', (select count(*) = 0 from i));
select t.fails('B cannot add worker to A farm by id', format('insert into workers (farm_id) values (%L)', current_setting('t.farm_a')), '42501');
select t.fails('B cannot add question to A farm by id', format('insert into custom_questions (farm_id, text) values (%L, ''x'')', current_setting('t.farm_a')), '42501');
select t.fails('B cannot insert camel with A farm_id', format('insert into camels (farm_id, name) values (%L, ''x'')', current_setting('t.farm_a')), '42501');
with u as (update camels set name = 'stolen' returning 1) select t.check('B updates 0 A camels', (select count(*) = 0 from u));
with d as (delete from custom_questions returning 1) select t.check('B deletes 0 A questions', (select count(*) = 0 from d));
with u as (update farms set name = 'x' where id = current_setting('t.farm_a')::uuid returning 1) select t.check('B updates 0 A farm rows', (select count(*) = 0 from u));
select t.check('is_farm_owner false for other farm', not private.is_farm_owner(current_setting('t.farm_a')::uuid));
reset role;

-- ── anon ──
set role anon; select set_config('request.jwt.claim.sub', '', false);
select t.fails('anon cannot read farms', 'select * from farms', '42501');
select t.fails('anon cannot read camels', 'select * from camels', '42501');
select t.fails('anon cannot read predefined questions', 'select * from predefined_questions', '42501');
select t.fails('anon cannot call is_farm_owner', format('select private.is_farm_owner(%L)', current_setting('t.farm_a')), '42501');
reset role;

-- ── service_role (voice service) ──
set role service_role;
update farms set plan = 'ultimate' where id = current_setting('t.farm_b')::uuid;
insert into custom_questions (farm_id, text) select current_setting('t.farm_b')::uuid, 'B' || g from generate_series(1, 7) g;
select t.check('Ultimate allows 7 questions', (select count(*) = 7 from custom_questions where farm_id = current_setting('t.farm_b')::uuid));
select t.fails('downgrade with 7 questions rejected', format('update farms set plan = ''basic'' where id = %L', current_setting('t.farm_b')), '23514');
select t.fails('moving a question into a full Basic farm rejected', format('update custom_questions set farm_id = %L where farm_id = %L and text = ''B1''', current_setting('t.farm_a'), current_setting('t.farm_b')), '23514');
select t.fails('moving a camel between farms rejected', format('update camels set farm_id = %L where name = ''Hamra''', current_setting('t.farm_b')), '23514');
select t.fails('service cannot exceed Basic limit either', format('insert into custom_questions (farm_id, text) values (%L, ''Q6'')', current_setting('t.farm_a')), '23514');
delete from custom_questions where farm_id = current_setting('t.farm_b')::uuid and text in ('B6', 'B7');
update farms set plan = 'basic' where id = current_setting('t.farm_b')::uuid;
select t.check('downgrade allowed at 5 questions', (select plan = 'basic' from farms where id = current_setting('t.farm_b')::uuid));

insert into task_tickets (farm_id, instruction) values (current_setting('t.farm_b')::uuid, 'B task');
insert into relays (farm_id, message) values (current_setting('t.farm_b')::uuid, 'B relay');
insert into criteria (farm_id, kind) values (current_setting('t.farm_b')::uuid, 'low_feed');
insert into calls (farm_id, kind, direction, party, outcome) values (current_setting('t.farm_b')::uuid, 'worker_report', 'inbound', 'worker', 'completed');
insert into task_tickets (farm_id, instruction) values (current_setting('t.farm_a')::uuid, 'A task');
insert into calls (farm_id, kind, direction, party, outcome) values (current_setting('t.farm_a')::uuid, 'worker_report', 'inbound', 'worker', 'completed');
select t.fails('call → other farm ticket rejected', format('insert into calls (farm_id, kind, direction, party, outcome, task_ticket_id) select %L, ''worker_instruction'', ''outbound'', ''worker'', ''completed'', id from task_tickets where instruction = ''B task''', current_setting('t.farm_a')), '23503');
select t.fails('report → other farm call rejected', format('insert into reports (farm_id, call_id) select %L, id from calls where farm_id = %L', current_setting('t.farm_a'), current_setting('t.farm_b')), '23503');
select t.fails('pending call → other farm relay rejected', format('insert into pending_worker_calls (farm_id, purpose, message, relay_id) select %L, ''instruction'', ''m'', id from relays', current_setting('t.farm_a')), '23503');
select t.fails('pending call → other farm ticket rejected', format('insert into pending_worker_calls (farm_id, purpose, message, task_ticket_id) select %L, ''instruction'', ''m'', id from task_tickets where instruction = ''B task''', current_setting('t.farm_a')), '23503');
select t.fails('no-answer ticket → other farm task rejected', format('insert into no_answer_tickets (farm_id, purpose, message, task_ticket_id) select %L, ''instruction'', ''m'', id from task_tickets where instruction = ''B task''', current_setting('t.farm_a')), '23503');
insert into reports (farm_id, call_id) select farm_id, id from calls where farm_id = current_setting('t.farm_a')::uuid;
update calls set report_id = (select id from reports) where farm_id = current_setting('t.farm_a')::uuid;
select t.fails('finding → other farm criterion rejected', 'insert into findings (report_id, criterion_id, text_ar, text_en) select r.id, c.id, ''x'', ''x'' from reports r, criteria c where c.kind = ''low_feed''', '23503');
insert into findings (report_id, criterion_id, text_ar, text_en) select r.id, c.id, 'x', 'x' from reports r, criteria c where c.kind = 'sick_camel';
select t.fails('finding cannot switch to other farm criterion', 'update findings set criterion_id = (select id from criteria where kind = ''low_feed'')', '23503');
select t.fails('call cannot move farms', format('update calls set farm_id = %L where farm_id = %L', current_setting('t.farm_b'), current_setting('t.farm_a')), '23514');
insert into report_answers (report_id, question_id, question_ar, question_en, answer, certainty) select id, 'herd_health', 'x', 'x', 'ok', 'reported' from reports;
update calls set task_ticket_id = (select id from task_tickets where instruction = 'A task') where farm_id = current_setting('t.farm_a')::uuid;
insert into pending_worker_calls (farm_id, purpose, message, task_ticket_id) select farm_id, 'task_verification', 'm', id from task_tickets where instruction = 'A task';
insert into worker_call_attempts (pending_call_id, answered) select id, false from pending_worker_calls;
delete from task_tickets where instruction = 'A task';
select t.check('deleting a ticket keeps the call and its farm', (select task_ticket_id is null and farm_id = current_setting('t.farm_a')::uuid from calls where farm_id = current_setting('t.farm_a')::uuid));
select t.check('deleting a ticket keeps the pending call', (select count(*) = 1 from pending_worker_calls where task_ticket_id is null));
insert into events (farm_id, text_ar, text_en) values (current_setting('t.farm_a')::uuid, 'x', 'x');
reset role;

-- ── Owner reads ──
set role authenticated; select set_config('request.jwt.claim.sub', :A, false);
select t.check('A reads own call/report/answers/finding/attempt/event', (select (select count(*) from calls) = 1 and (select count(*) from reports) = 1 and (select count(*) from report_answers) = 1 and (select count(*) from findings) = 1 and (select count(*) from worker_call_attempts) = 1 and (select count(*) from events) = 1));
select t.fails('A cannot mark relay delivered', 'update relays set delivered = true', '42501');
select t.fails('A cannot close a ticket', 'update no_answer_tickets set status = ''closed''', '42501');
reset role;
set role authenticated; select set_config('request.jwt.claim.sub', :B, false);
select t.check('B reads none of A service data', (select (select count(*) from calls where farm_id = current_setting('t.farm_a')::uuid) + (select count(*) from reports) + (select count(*) from report_answers) + (select count(*) from findings) + (select count(*) from worker_call_attempts) + (select count(*) from events) = 0));
reset role;

-- ── catalog checks ──
select t.check('RLS on every public table', (select bool_and(relrowsecurity) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'), (select string_agg(relname, ',') from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and not relrowsecurity));
select t.check('no functions in public (no exposed RPC)', (select count(*) = 0 from pg_proc where pronamespace = 'public'::regnamespace));
select t.check('every NAQAH function pins search_path', (select bool_and(proconfig @> array['search_path=""']) from pg_proc where pronamespace = 'private'::regnamespace), (select string_agg(proname || ':' || coalesce(array_to_string(proconfig, ','), 'none'), ' ') from pg_proc where pronamespace = 'private'::regnamespace));
select t.check('anon/authenticated cannot run trigger functions', (select not bool_or(has_function_privilege(r, p.oid, 'execute')) from pg_proc p, unnest(array['anon','authenticated']) r where p.pronamespace = 'private'::regnamespace and p.prorettype = 'trigger'::regtype));
select t.check('anon has no table privileges', (select count(*) = 0 from information_schema.role_table_grants where grantee = 'anon' and table_schema = 'public'));
select t.check('authenticated has no TRUNCATE/TRIGGER/REFERENCES', (select count(*) = 0 from information_schema.role_table_grants where grantee = 'authenticated' and table_schema = 'public' and privilege_type in ('TRUNCATE','TRIGGER','REFERENCES')));
select t.check('private schema not usable by anon', not has_schema_privilege('anon', 'private', 'usage'));

select n, case when ok then 'PASS' else 'FAIL' end as result, name, detail from t.results order by n;
select count(*) filter (where ok) as passed, count(*) filter (where not ok) as failed from t.results;
