-- Report-call scheduler: Supabase pg_cron + pg_net call GET /api/cron/report-calls every 5 minutes.
--
-- Safe to apply before activation. Without both Vault secrets the job runs, finds nothing and sends no
-- request. Without NAQAH_SCHEDULED_CALLS=1 on the server the route answers "scheduled_calls_off".
-- No URL or secret lives in this file or in the job's text; both are read from Vault on every run.
--
-- Activation (owner-approved, in this order; full checklist in docs/integrations/twilio-activation.md):
--   1. Vercel: set CRON_SECRET and NAQAH_SCHEDULED_CALLS=1 (plus the farm-mode/Twilio variables), redeploy.
--   2. Vault, in the SQL editor (never commit the values):
--        select vault.create_secret('https://<origin>/api/cron/report-calls', 'naqah_scheduler_url', 'NAQAH scheduler route');
--        select vault.create_secret('<CRON_SECRET>', 'naqah_cron_secret', 'Bearer secret for the NAQAH scheduler route');
--   3. Apply this migration (or, if already applied, nothing more to do: the next run picks up the secrets).
--   4. Verify: select * from cron.job_run_details order by start_time desc limit 5;
--              select status_code, content, error_msg from net._http_response order by created desc limit 5;
--              select * from public.scheduler_heartbeats;
-- Pause:  select cron.alter_job((select jobid from cron.job where jobname = 'naqah-report-calls'), active := false);
-- Remove: select cron.unschedule('naqah-report-calls');

-- Supabase installs pg_cron in pg_catalog (it creates the cron schema) and pg_net in extensions (it creates net).
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- pg_net grants its queue and response tables to PUBLIC. The queued request carries the Bearer secret in its
-- headers, so only the roles that already own them (postgres, the pg_net worker) may read either table.
do $$
begin
  if to_regclass('net.http_request_queue') is not null then
    revoke all on table net.http_request_queue from public, anon, authenticated;
  end if;
  if to_regclass('net._http_response') is not null then
    revoke all on table net._http_response from public, anon, authenticated;
  end if;
end;
$$;

-- Last time the route ran after a valid secret, written by the route with the service key. Operational only:
-- no farm data, never readable by owners or anonymous callers.
create table if not exists public.scheduler_heartbeats (
  job text primary key check (job ~ '^[a-z][a-z-]{0,39}$'),
  last_run_at timestamptz not null,
  outcome text not null check (char_length(outcome) <= 40),
  summary jsonb not null default '{}'::jsonb
);
alter table public.scheduler_heartbeats enable row level security;
revoke all on table public.scheduler_heartbeats from public, anon, authenticated;
grant select, insert, update on table public.scheduler_heartbeats to service_role;

-- Runs as the job's owner (the migration role), which can read Vault and use pg_net, so no SECURITY DEFINER.
-- Returns the pg_net request id, or null when the secrets are missing or the URL is not https.
-- naqah_cron_url is the name the earlier manual runbook used; it is still accepted.
create or replace function private.trigger_report_calls()
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target text;
  secret text;
begin
  select coalesce(
      (select s.decrypted_secret from vault.decrypted_secrets s where s.name = 'naqah_scheduler_url' limit 1),
      (select s.decrypted_secret from vault.decrypted_secrets s where s.name = 'naqah_cron_url' limit 1))
    into target;
  select s.decrypted_secret into secret from vault.decrypted_secrets s where s.name = 'naqah_cron_secret' limit 1;

  if target is null or secret is null or btrim(secret) = '' or target !~ '^https://[^\s]+$' then
    return null;
  end if;

  return net.http_get(
    url := btrim(target),
    headers := jsonb_build_object('Authorization', 'Bearer ' || btrim(secret)),
    timeout_milliseconds := 55000
  );
end;
$$;

revoke execute on function private.trigger_report_calls() from public, anon, authenticated, service_role;

-- cron.job_run_details is never pruned automatically; keep a week of this job's history.
create or replace function private.prune_report_call_cron_history()
returns void
language sql
security invoker
set search_path = ''
as $$
  -- Also history left by jobs that no longer exist (an earlier version of these jobs, or one removed by hand).
  delete from cron.job_run_details d
  where d.end_time < now() - interval '7 days'
    and (
      d.jobid in (select j.jobid from cron.job j where j.jobname in ('naqah-report-calls', 'naqah-report-calls-history'))
      or not exists (select 1 from cron.job j where j.jobid = d.jobid)
    );
$$;

revoke execute on function private.prune_report_call_cron_history() from public, anon, authenticated, service_role;

-- Idempotent: scheduling by name updates an existing job in place (including one made by the old runbook)
-- and keeps its id, so its history stays prunable.
select cron.schedule('naqah-report-calls', '*/5 * * * *', 'select private.trigger_report_calls()');
select cron.schedule('naqah-report-calls-history', '17 3 * * *', 'select private.prune_report_call_cron_history()');
