-- LOCAL/OPERATOR EVIDENCE. SELECT-only; run with psql -v test_farm_id=... -v test_start=....
-- Output contains only table names, counts, status labels, and one-way MD5 aggregates.
\set ON_ERROR_STOP on
begin read only;
do $$
declare can_bypass boolean;
begin
  select r.rolsuper or r.rolbypassrls into can_bypass
  from pg_catalog.pg_roles r where r.rolname = current_user;
  if not coalesce(can_bypass, false) then
    raise exception 'isolation evidence refused: role % cannot bypass row-level security; connect as supabase_read_only_user with BYPASSRLS', current_user;
  end if;
end
$$;

select :'test_start'::timestamptz as test_start;

-- Keep this bucket list in sync with service-repository/apply_farm_changes and call-run tables.
with foreign_rows(table_name, row_data) as (
  select 'farms', to_jsonb(t)::text from public.farms t where t.id <> :'test_farm_id'::uuid
  union all select 'workers', to_jsonb(t)::text from public.workers t where t.farm_id <> :'test_farm_id'::uuid
  union all select 'camels', to_jsonb(t)::text from public.camels t where t.farm_id <> :'test_farm_id'::uuid
  union all select 'resources', to_jsonb(t)::text from public.resources t where t.farm_id <> :'test_farm_id'::uuid
  union all select 'report_call_runs', to_jsonb(t)::text from public.report_call_runs t where t.farm_id <> :'test_farm_id'::uuid
  union all select 'reports', to_jsonb(t)::text from public.reports t where t.farm_id <> :'test_farm_id'::uuid
  union all select 'report_answers', to_jsonb(a)::text from public.report_answers a join public.reports r on r.id = a.report_id where r.farm_id <> :'test_farm_id'::uuid
  union all select 'findings', to_jsonb(f)::text from public.findings f join public.reports r on r.id = f.report_id where r.farm_id <> :'test_farm_id'::uuid
  union all select 'calls', to_jsonb(t)::text from public.calls t where t.farm_id <> :'test_farm_id'::uuid
  union all select 'events', to_jsonb(t)::text from public.events t where t.farm_id <> :'test_farm_id'::uuid
  union all select 'task_tickets', to_jsonb(t)::text from public.task_tickets t where t.farm_id <> :'test_farm_id'::uuid
  union all select 'relays', to_jsonb(t)::text from public.relays t where t.farm_id <> :'test_farm_id'::uuid
  union all select 'pending_worker_calls', to_jsonb(t)::text from public.pending_worker_calls t where t.farm_id <> :'test_farm_id'::uuid
  union all select 'pending_worker_call_tasks', to_jsonb(t)::text from public.pending_worker_call_tasks t where t.farm_id <> :'test_farm_id'::uuid
  union all select 'worker_call_attempts', to_jsonb(a)::text from public.worker_call_attempts a join public.pending_worker_calls p on p.id = a.pending_call_id where p.farm_id <> :'test_farm_id'::uuid
  union all select 'no_answer_tickets', to_jsonb(t)::text from public.no_answer_tickets t where t.farm_id <> :'test_farm_id'::uuid
  union all select 'voice_events', to_jsonb(t)::text from public.voice_events t where t.farm_id <> :'test_farm_id'::uuid
  union all select 'voice_call_sessions', to_jsonb(t)::text from public.voice_call_sessions t where t.farm_id <> :'test_farm_id'::uuid
  union all select 'test_call_ranches', to_jsonb(t)::text from public.test_call_ranches t where t.farm_id <> :'test_farm_id'::uuid
  union all select 'test_calls', to_jsonb(t)::text from public.test_calls t where t.farm_id <> :'test_farm_id'::uuid
), names(table_name) as (
  values ('farms'), ('workers'), ('camels'), ('resources'), ('report_call_runs'), ('reports'), ('report_answers'), ('findings'),
         ('calls'), ('events'), ('task_tickets'), ('relays'), ('pending_worker_calls'), ('pending_worker_call_tasks'),
         ('worker_call_attempts'), ('no_answer_tickets'), ('voice_events'), ('voice_call_sessions'), ('test_call_ranches'), ('test_calls')
), hashed as (
  select table_name, md5(row_data) as row_hash from foreign_rows
)
select n.table_name, count(h.row_hash)::bigint as row_count,
       md5(coalesce(string_agg(h.row_hash, '' order by h.row_hash), '')) as checksum
from names n left join hashed h using (table_name)
group by n.table_name order by n.table_name;

-- Timestamp columns provide an independent signal even when track_commit_timestamp is off.
with other_farm_timestamped_rows(table_name) as (
  select 'farms' from public.farms t where t.id <> :'test_farm_id'::uuid and (t.created_at >= :'test_start'::timestamptz or t.updated_at >= :'test_start'::timestamptz)
  union all select 'workers' from public.workers t where t.farm_id <> :'test_farm_id'::uuid and (t.created_at >= :'test_start'::timestamptz or t.updated_at >= :'test_start'::timestamptz)
  union all select 'camels' from public.camels t where t.farm_id <> :'test_farm_id'::uuid and (t.created_at >= :'test_start'::timestamptz or t.updated_at >= :'test_start'::timestamptz)
  union all select 'resources' from public.resources t where t.farm_id <> :'test_farm_id'::uuid and t.updated_at >= :'test_start'::timestamptz
  union all select 'report_call_runs' from public.report_call_runs t where t.farm_id <> :'test_farm_id'::uuid and t.created_at >= :'test_start'::timestamptz
  union all select 'task_tickets' from public.task_tickets t where t.farm_id <> :'test_farm_id'::uuid and t.created_at >= :'test_start'::timestamptz
  union all select 'pending_worker_calls' from public.pending_worker_calls t where t.farm_id <> :'test_farm_id'::uuid and t.created_at >= :'test_start'::timestamptz
  union all select 'no_answer_tickets' from public.no_answer_tickets t where t.farm_id <> :'test_farm_id'::uuid and t.created_at >= :'test_start'::timestamptz
  union all select 'voice_events' from public.voice_events t where t.farm_id <> :'test_farm_id'::uuid and t.created_at >= :'test_start'::timestamptz
  union all select 'voice_call_sessions' from public.voice_call_sessions t where t.farm_id <> :'test_farm_id'::uuid and (t.created_at >= :'test_start'::timestamptz or t.updated_at >= :'test_start'::timestamptz)
  union all select 'test_call_ranches' from public.test_call_ranches t where t.farm_id <> :'test_farm_id'::uuid and t.created_at >= :'test_start'::timestamptz
  union all select 'test_calls' from public.test_calls t where t.farm_id <> :'test_farm_id'::uuid and (t.created_at >= :'test_start'::timestamptz or t.updated_at >= :'test_start'::timestamptz)
), timestamp_names(table_name) as (
  values ('farms'), ('workers'), ('camels'), ('resources'), ('report_call_runs'), ('task_tickets'), ('pending_worker_calls'),
         ('no_answer_tickets'), ('voice_events'), ('voice_call_sessions'), ('test_call_ranches'), ('test_calls')
)
select n.table_name, count(r.table_name)::bigint as created_or_updated_after_test_start
from timestamp_names n left join other_farm_timestamped_rows r using (table_name)
group by n.table_name order by n.table_name;

with foreign_versions(table_name, row_xmin) as (
  select 'farms', t.xmin from public.farms t where t.id <> :'test_farm_id'::uuid
  union all select 'workers', t.xmin from public.workers t where t.farm_id <> :'test_farm_id'::uuid
  union all select 'camels', t.xmin from public.camels t where t.farm_id <> :'test_farm_id'::uuid
  union all select 'resources', t.xmin from public.resources t where t.farm_id <> :'test_farm_id'::uuid
  union all select 'report_call_runs', t.xmin from public.report_call_runs t where t.farm_id <> :'test_farm_id'::uuid
  union all select 'reports', t.xmin from public.reports t where t.farm_id <> :'test_farm_id'::uuid
  union all select 'report_answers', a.xmin from public.report_answers a join public.reports r on r.id = a.report_id where r.farm_id <> :'test_farm_id'::uuid
  union all select 'findings', f.xmin from public.findings f join public.reports r on r.id = f.report_id where r.farm_id <> :'test_farm_id'::uuid
  union all select 'calls', t.xmin from public.calls t where t.farm_id <> :'test_farm_id'::uuid
  union all select 'events', t.xmin from public.events t where t.farm_id <> :'test_farm_id'::uuid
  union all select 'task_tickets', t.xmin from public.task_tickets t where t.farm_id <> :'test_farm_id'::uuid
  union all select 'relays', t.xmin from public.relays t where t.farm_id <> :'test_farm_id'::uuid
  union all select 'pending_worker_calls', t.xmin from public.pending_worker_calls t where t.farm_id <> :'test_farm_id'::uuid
  union all select 'pending_worker_call_tasks', t.xmin from public.pending_worker_call_tasks t where t.farm_id <> :'test_farm_id'::uuid
  union all select 'worker_call_attempts', a.xmin from public.worker_call_attempts a join public.pending_worker_calls p on p.id = a.pending_call_id where p.farm_id <> :'test_farm_id'::uuid
  union all select 'no_answer_tickets', t.xmin from public.no_answer_tickets t where t.farm_id <> :'test_farm_id'::uuid
  union all select 'voice_events', t.xmin from public.voice_events t where t.farm_id <> :'test_farm_id'::uuid
  union all select 'voice_call_sessions', t.xmin from public.voice_call_sessions t where t.farm_id <> :'test_farm_id'::uuid
  union all select 'test_call_ranches', t.xmin from public.test_call_ranches t where t.farm_id <> :'test_farm_id'::uuid
  union all select 'test_calls', t.xmin from public.test_calls t where t.farm_id <> :'test_farm_id'::uuid
)
select 'foreign_rows_created_or_updated_since_test_start' as check_name,
       case when current_setting('track_commit_timestamp') = 'on' then 'available' else 'commit timestamps unavailable' end as status,
       case when current_setting('track_commit_timestamp') = 'on'
            then count(*) filter (where pg_xact_commit_timestamp(row_xmin) >= :'test_start'::timestamptz)
            else null end as changed_rows
from foreign_versions;

select 'rate_limit_buckets_without_test_ranch_prefix' as table_name, count(*)::bigint as row_count,
       md5(coalesce(string_agg(md5(key || '|' || count::text || '|' || reset_at::text), '' order by md5(key)), '')) as checksum,
       case when current_setting('track_commit_timestamp') = 'on' then 'available' else 'commit timestamps unavailable' end as commit_timestamp_status,
       case when current_setting('track_commit_timestamp') = 'on'
            then count(*) filter (where pg_xact_commit_timestamp(xmin) >= :'test_start'::timestamptz)
            else null end as changed_since_test_start
from public.rate_limit_buckets where key not like 'test-ranch:%';

-- Farm-scoped ordinary rate limits are separated so this ranch's own keys do not mask a foreign change.
with foreign_buckets as (
  select b.key, b.count, b.reset_at
  from public.rate_limit_buckets b
  where b.key not like 'test-ranch:%'
    and substring(b.key from '^[^:]+:farm:([0-9a-f-]{36}):') is not null
    and substring(b.key from '^[^:]+:farm:([0-9a-f-]{36}):') <> :'test_farm_id'
)
select 'rate_limit_buckets_for_other_farms' as table_name, count(*)::bigint as row_count,
       md5(coalesce(string_agg(md5(key || '|' || count::text || '|' || reset_at::text), '' order by md5(key)), '')) as checksum
from foreign_buckets;

with foreign_test_ranch_buckets as (
  select b.key, b.count, b.reset_at
  from public.rate_limit_buckets b
  where substring(b.key from '^test-ranch:([0-9a-f-]{36}):') is not null
    and substring(b.key from '^test-ranch:([0-9a-f-]{36}):') <> :'test_farm_id'
)
select 'test_ranch_rate_limit_buckets_for_other_farms' as table_name, count(*)::bigint as row_count,
       md5(coalesce(string_agg(md5(key || '|' || count::text || '|' || reset_at::text), '' order by md5(key)), '')) as checksum
from foreign_test_ranch_buckets;
commit;
