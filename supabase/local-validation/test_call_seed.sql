-- LOCAL ONLY. Fixtures for the manual "Test AI Call": one test ranch and one separate control ranch.
-- Applied by scripts/test-call-local.mjs to the disposable naqah_test_call database, after it has created
-- both Auth users through the local gateway:
--
--   psql -d naqah_test_call -v tester_id=<uuid> -v control_id=<uuid> -f test_call_seed.sql
--
-- Every value here is sample data. The placeholder numbers are never on a call allowlist.
\set ON_ERROR_STOP on
\set test_farm '11111111-1111-4111-8111-111111111111'
\set test_worker '11111111-1111-4111-8111-1111111111aa'
\set control_farm '22222222-2222-4222-8222-222222222222'
\set control_worker '22222222-2222-4222-8222-2222222222aa'
\set control_call '22222222-2222-4222-8222-2222222222cc'
\set control_report '22222222-2222-4222-8222-2222222222dd'

-- Refuse anything but the disposable database on this machine. A Unix socket reports no address, so it is refused too.
do $$
begin
  if current_database() <> 'naqah_test_call' then
    raise exception 'test_call_seed.sql only runs on naqah_test_call, not %', current_database();
  end if;
  if inet_server_addr() is null or not (host(inet_server_addr()) like '127.%' or host(inet_server_addr()) = '::1') then
    raise exception 'test_call_seed.sql only runs over a loopback connection';
  end if;
end $$;

begin;

-- ─────────────── the test ranch ───────────────
insert into farms (id, owner_id, plan, plan_selected_at, setup_complete, name, owner_name, owner_phone, location, herd_count)
values (:'test_farm', :'tester_id', 'ultimate', now(), true, 'عزبة التجربة (اختبار فقط)', 'مختبر ناقة', '+966500000090', 'موقع تجريبي', 20);

insert into workers (id, farm_id, name, phone, language)
values (:'test_worker', :'test_farm', 'أحمد', '+966500000099', 'ar');
update farms set primary_worker_id = :'test_worker' where id = :'test_farm';

insert into resources (farm_id, kind, present) values
  (:'test_farm', 'feed', true), (:'test_farm', 'water', true), (:'test_farm', 'fences', true),
  (:'test_farm', 'shelter', false), (:'test_farm', 'medicine', false);

insert into camels (farm_id, name, sex, health, certainty) values
  (:'test_farm', 'نورة', 'female', 'healthy', 'reported'),
  (:'test_farm', 'مزون', 'female', 'healthy', 'reported'),
  (:'test_farm', 'شيخة', 'female', 'unknown', 'unknown');

insert into custom_questions (farm_id, text, sort_order) values
  (:'test_farm', 'جا البيطري اليوم؟', 0),
  (:'test_farm', 'فيه أحد زار العزبة اليوم؟', 1);

insert into criteria (farm_id, kind, enabled) values
  (:'test_farm', 'sick_camel', true), (:'test_farm', 'low_feed', true), (:'test_farm', 'low_water', true);
insert into emergency_categories (farm_id, kind) values (:'test_farm', 'injury'), (:'test_farm', 'fire');

-- The table arrives with the Test AI Call migration; older checkouts run without it.
select format('insert into test_call_ranches (farm_id) values (%L)', :'test_farm')
where to_regclass('public.test_call_ranches') is not null \gexec

-- ─────────────── the control ranch: a stand-in for a real customer, used to prove nothing leaks ───────────────
insert into farms (id, owner_id, plan, plan_selected_at, setup_complete, name, owner_name, owner_phone, location, herd_count, call_time, last_update_at)
values (:'control_farm', :'control_id', 'basic', now(), true, 'عزبة الضابطة', 'مالك الضابطة', '+966500000091', 'موقع ضابط', 12, '09:00', '2026-11-01T06:00:00Z');

insert into workers (id, farm_id, name, phone, language)
values (:'control_worker', :'control_farm', 'سالم', '+966500000098', 'ar');
update farms set primary_worker_id = :'control_worker' where id = :'control_farm';

insert into resources (farm_id, kind, present, level, certainty) values
  (:'control_farm', 'feed', true, 'good', 'reported'), (:'control_farm', 'water', true, 'good', 'reported'),
  (:'control_farm', 'fences', false, 'unknown', 'unknown'), (:'control_farm', 'shelter', false, 'unknown', 'unknown'),
  (:'control_farm', 'medicine', false, 'unknown', 'unknown');

insert into camels (farm_id, name, sex, health, certainty) values
  (:'control_farm', 'هيا', 'female', 'healthy', 'reported'), (:'control_farm', 'صيته', 'female', 'healthy', 'reported');

insert into custom_questions (farm_id, text, sort_order) values (:'control_farm', 'سؤال الضابطة؟', 0);

insert into calls (id, farm_id, kind, direction, party, at, outcome, attempt, summary_ar, summary_en, provider_call_id)
values (:'control_call', :'control_farm', 'worker_report', 'outbound', 'worker', '2026-11-01T06:00:00Z', 'completed', 1, 'تقرير سابق', 'Earlier report', 'CA22222222222222222222222222222222');

insert into reports (id, farm_id, call_id, at, herd_count_reported)
values (:'control_report', :'control_farm', :'control_call', '2026-11-01T06:00:00Z', 12);
update calls set report_id = :'control_report' where id = :'control_call';

insert into report_answers (report_id, question_id, question_ar, question_en, answer, answer_ar, answer_en, certainty, sort_order) values
  (:'control_report', 'herd_health', 'كيف حال الحلال؟', 'How are the camels?', 'yes', 'بخير', 'All well', 'reported', 0),
  (:'control_report', 'feed_level', 'كيف العلف؟', 'How is the feed?', 'good', 'كافي', 'Sufficient', 'reported', 1);

insert into report_call_runs (farm_id, occurrence, trigger, attempts, state, report_id, provider_call_id)
values (:'control_farm', '2026-11-01T06:00:00Z', 'schedule', '[{"at":"2026-11-01T06:00:00Z","result":"answered"}]', 'completed', :'control_report', 'CA22222222222222222222222222222222');

insert into events (farm_id, at, tone, text_ar, text_en)
values (:'control_farm', '2026-11-01T06:00:00Z', 'success', 'وصل تقرير العزبة', 'Ranch report received');

commit;
