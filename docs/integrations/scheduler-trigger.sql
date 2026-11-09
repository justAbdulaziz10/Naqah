-- OPTIONAL RUNBOOK. NOT a migration, and nothing applies it automatically.
-- It makes Supabase call NAQAH's scheduler route every 5 minutes. Run it by hand, once, only after
-- the owner approves unattended calls. See docs/integrations/owner-call-runs.md.
-- Replace the two <placeholders> in your own SQL session. Never commit the real values.

-- 1. Extensions.
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 2. The route's URL and CRON_SECRET, kept in Vault so they are not stored in the job's text.
select vault.create_secret('https://<public-origin>/api/cron/report-calls', 'naqah_cron_url', 'NAQAH scheduler route');
select vault.create_secret('<CRON_SECRET>', 'naqah_cron_secret', 'Bearer secret for the NAQAH scheduler route');

-- 3. The job. Two overlapping runs are safe: each claim is saved under a revision check before dialling.
select cron.schedule('naqah-report-calls', '*/5 * * * *', $job$
  select net.http_get(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'naqah_cron_url'),
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'naqah_cron_secret')
    ),
    timeout_milliseconds := 55000
  );
$job$);

-- Check it (read only).
-- select jobid, jobname, schedule, active from cron.job where jobname = 'naqah-report-calls';
-- select status, return_message, start_time from cron.job_run_details order by start_time desc limit 10;
-- select status_code, content, error_msg from net._http_response order by created desc limit 10;

-- Pause without removing.
-- select cron.alter_job((select jobid from cron.job where jobname = 'naqah-report-calls'), active := false);

-- Remove.
-- select cron.unschedule('naqah-report-calls');
-- delete from vault.secrets where name in ('naqah_cron_url', 'naqah_cron_secret');
