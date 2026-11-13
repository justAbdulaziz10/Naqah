# Calling go-live checklist

Order matters. **[approval]** = needs the owner's explicit go-ahead. **[paid]** = costs money (Twilio minutes, OpenAI).
Real values live only in Vercel, the bridge host and Supabase Vault, never in the repo.
Background: [twilio-activation](twilio-activation.md), [realtime-voice](realtime-voice.md), [supabase-backend](supabase-backend.md),
[phone](phone.md), [voice bridge](../../services/voice-bridge/README.md).

## 0. Preconditions
- [ ] PR `integration/calling-reliability` merged to `main`; CI green (`npm run typecheck && npm run lint && npm test && npm run build`).
- [ ] `NAQAH_SCHEDULED_CALLS` is **unset** in Vercel and stays so until step 6. `NAQAH_CALL_OWNER` unset too.
- [ ] Recording and transcription storage off in Twilio (no-recordings rule, AGENT.md 8.3).

## 1. Caller ID **[approval][paid]**
Why: calls from the +44 test number were screened as spam by Saudi carriers (evidence 11-12 Nov), so workers did not answer.
- [ ] Verify an owned `+966…` number as an outbound caller ID in the Twilio console (code by SMS/voice), or buy a Saudi number
  (needs a regulatory bundle: business documents, see twilio-activation.md).
- [ ] Twilio console, Voice, Geographic permissions: Saudi Arabia enabled.
- [ ] `TWILIO_PHONE_NUMBER=+966…` (E.164) and `TWILIO_ACCOUNT_SID`.
- [ ] `NAQAH_CALL_ALLOWLIST`: comma-separated `+9665XXXXXXXX` only. Fails closed (unset or invalid = nothing rings).
  Policy: start with the consenting test worker (and owner); add a farm's worker only after the owner confirms the worker agreed.

## 2. Hosted voice bridge **[approval][paid]**
Replace laptop + ngrok with an always-on host (Fly.io, Render or a small VPS in a Gulf/EU region).
- [ ] Run `services/voice-bridge` (start command in its README) with `OPENAI_API_KEY`, `TWILIO_AUTH_TOKEN`,
  `NAQAH_VOICE_SECRET` (same value as Vercel, at least 32 random bytes), `NAQAH_BRIDGE_PUBLIC_URL=wss://<bridge-domain>/voice-bridge/media`,
  `NAQAH_BRIDGE_UPSTREAM=https://<next-origin>` (the Next.js app it calls back), `PORT`.
- [ ] Keep defaults unless a test shows otherwise: `NAQAH_BRIDGE_DNS_ORDER=ipv4first` (avoids NAT64 timeouts),
  `NAQAH_BRIDGE_SILENCE_SECONDS=12` (5-60; one quiet window reprompts, the second ends the call).
- [ ] Leave `NAQAH_REALTIME_URL` and `NAQAH_CALL_TRACE_DIR` unset (tests and debugging only).
- [ ] Stable domain with valid TLS on 443 for https and wss. No ngrok.
- [ ] Health: `curl -s https://<bridge-domain>/voice-bridge/health` returns `ok: true`, `publicUrl`, `maxCallSeconds` and no secrets.
- [ ] Next app side: `NAQAH_BRIDGE_PUBLIC_URL` is the env var that points the app at the bridge. The preflight check `public_bridge_url`
  requires its host to equal `NAQAH_PUBLIC_BASE_URL` (the origin Twilio calls back), so route `/voice-bridge/*` and the voice webhooks
  accordingly (see realtime-voice.md).
- [ ] Restart policy: always restart on crash and boot (Fly machine restart, Render service, or systemd `Restart=always`).
- [ ] Logs: stdout only; confirm they hold no transcripts, audio or full phone numbers (no-recordings rule).

## 3. Supabase **[approval]**
- [ ] Back up first (dashboard backup or `pg_dump`); note the current migration list.
- [ ] Apply `20261113100000_worker_call_claims.sql`. Safe before or after the deploy: it only adds the nullable
  `pending_worker_calls.dial_claimed_at` and wraps `apply_farm_changes` (the old body moves to `private`), so old code ignores the
  column and new code works once it exists. Apply it first anyway.
- [ ] Apply `20261113090000_report_call_scheduler.sql` (pg_cron + pg_net; jobs `naqah-report-calls` every 5 min and a daily history prune).
  Safe while idle: without the Vault secrets the job sends nothing; without `NAQAH_SCHEDULED_CALLS=1` the route answers `scheduled_calls_off`.
- [ ] Verify:
  ```sql
  select jobname, schedule, active from cron.job where jobname like 'naqah-%';
  select has_table_privilege('anon','net.http_request_queue','select'),
         has_table_privilege('authenticated','net.http_request_queue','select'),
         has_table_privilege('anon','net._http_response','select'),
         has_table_privilege('authenticated','public.scheduler_heartbeats','select');  -- all false
  select column_name from information_schema.columns
   where table_name='pending_worker_calls' and column_name='dial_claimed_at';
  ```
- [ ] Vault (SQL editor; never commit values):
  ```sql
  select vault.create_secret('https://<vercel-origin>/api/cron/report-calls', 'naqah_scheduler_url', 'NAQAH scheduler route');
  select vault.create_secret('<CRON_SECRET>', 'naqah_cron_secret', 'Bearer secret for the NAQAH scheduler route');
  ```

## 4. Vercel environment **[approval]**
- [ ] `NAQAH_VOICE_MODE=farm`, `NAQAH_VOICE_LOCALE=ar`, `NAQAH_VOICE_ENGINE=realtime`, `NAQAH_VOICE_SECRET`, `TWILIO_AUTH_TOKEN`,
  `TWILIO_ACCOUNT_SID`, `TWILIO_PHONE_NUMBER`, `NAQAH_PUBLIC_BASE_URL`, `NAQAH_BRIDGE_PUBLIC_URL`, `NAQAH_CALL_ALLOWLIST`,
  `SUPABASE_SECRET_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_NAQAH_ACCOUNT_DATA=1`.
- [ ] `CRON_SECRET` (same value as Vault `naqah_cron_secret`).
- [ ] Answering-machine detection, optional (defaults suit long Arabic greetings): `NAQAH_AMD_SPEECH_THRESHOLD_MS` (3500, range 1000-6000),
  `NAQAH_AMD_SPEECH_END_THRESHOLD_MS` (1000, 500-5000), `NAQAH_AMD_SILENCE_TIMEOUT_MS` (5000, 2000-10000). Out-of-range values fall back.
- [ ] Call length: `NAQAH_CALL_TIME_LIMIT_SECONDS` optional (10-299, default 300). Twilio's hard limit adds `CALL_END_GRACE_SECONDS` (60 s).
- [ ] `NAQAH_SCHEDULED_CALLS` still unset. Optionally `NAQAH_MANUAL_REPORT_CALLS=1` for the owner's "Call now" during the test.
- [ ] Redeploy, built with `NEXT_PUBLIC_NAQAH_BUILD_COMMIT` (see twilio-activation.md); note the commit.

## 5. Preflight and ONE real test call **[approval][paid]**
- [ ] Free preflight, places no call:
  `node --env-file=.env.local scripts/preflight-call.mjs --base https://<exact-origin> --expect +9665XXXXXXXX --locale ar`
  Every check must PASS (build, allowlist, farm mode, scheduled calls off, signed probes). The server-side preflight (`src/server/voice/preflight.ts`)
  also checks `twilio_account`, `twilio_voice_number`, `bridge_health`, `bridge_configuration`, `openai_key`, `openai_realtime` (fails on exhausted credit).
- [ ] The owner approves in writing, with the worker's consent. One call at a time; stop and review after any failure:
  1. Worker answers with a long Arabic greeting (e.g. «السلام عليكم ورحمة الله وبركاته، هلا مين؟»): log line `[NAQAH] call answered (...)`
     shows a human result, not `machine_*`, and the call continues.
  2. Phone switched off or voicemail: log shows `machine_*`; the run ends **unanswered**; retry in 20 min (up to 2 retries).
  3. Answer and stay silent: one reprompt, then one goodbye; run unanswered with a retry; no "sorry" line.
  4. Full report ending with «أحفظه؟», then an explicit yes: report saved; "saved" is spoken only after that.
- [ ] After each call check Vercel function logs, the dashboard call log, the run state
  (`select occurrence, state, attempts, report_id from report_call_runs order by created_at desc limit 5;`) and that Twilio holds no recording.

## 6. Enable scheduling **[approval][paid]**
- [ ] Set `NAQAH_SCHEDULED_CALLS=1` in Vercel (add `NAQAH_CALL_OWNER=1` only if owner summary calls are approved) and redeploy.
- [ ] Watch for an hour:
  ```sql
  select * from public.scheduler_heartbeats;
  select status, return_message, start_time from cron.job_run_details order by start_time desc limit 12;
  select status_code, error_msg, created from net._http_response order by created desc limit 12;
  ```
  Expect a heartbeat about every 5 min, `succeeded`, status 200. Only farms with a due call time ring, and only allowlisted numbers.

## 7. Rollback
- [ ] Stop dialing: unset `NAQAH_SCHEDULED_CALLS` (also `NAQAH_CALL_OWNER`, `NAQAH_MANUAL_REPORT_CALLS`) in Vercel and redeploy.
- [ ] Pause the trigger: `select cron.alter_job((select jobid from cron.job where jobname='naqah-report-calls'), active := false);`
  Remove it: `select cron.unschedule('naqah-report-calls');`
- [ ] Hard stop: empty `NAQAH_CALL_ALLOWLIST` (nothing can be dialled), or revert the Vercel deployment.
- [ ] The migrations are additive; leave them applied during a rollback.
