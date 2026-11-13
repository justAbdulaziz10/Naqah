# Calling release runbook v1

Operator runbook for taking real calling live. It adds order, SQL and a test script on top of
[go-live-checklist](../integrations/go-live-checklist.md); it does not repeat it. Nothing here is authorized by itself:
each step marked **[approval]** needs the owner's explicit go-ahead. Never commit real numbers or secrets.

## 1. Production state (observed 2026-11-14, public `GET /api/integrations/status`)
- Voice mode `farm` but **not configured**, `manualCalls: true`, `scheduledCalls: false`, allowlist count 0.
- Consequence: nothing can ring (the allowlist fails closed), but the owner's "Call now" is live and will fail preflight.
- Recommended now **[approval]**: unset `NAQAH_MANUAL_REPORT_CALLS` in Vercel and redeploy. Set it again only in section 5.
- Hosted Supabase is applied through `20261110090000_mvp_owner_runs.sql` (AGENT.md, Current state).

## 2. Supabase migrations (hosted) **[approval]**
Order: `20261113100000_worker_call_claims`, then `20261113090000_report_call_scheduler`.

Why this order is safe:
- `worker_call_claims` only adds the nullable `pending_worker_calls.dial_claimed_at` and moves the old `private.apply_farm_changes`
  body behind a wrapper. Code that predates it ignores the column, and code that needs it tolerates it missing, so deploy order does not matter.
- `report_call_scheduler` creates `private.trigger_report_calls()` and two cron jobs. The function reads `naqah_scheduler_url` and
  `naqah_cron_secret` from Vault on every run and sends nothing when either is missing or the URL is not `https://`. Even with both,
  the route answers `scheduled_calls_off` while `NAQAH_SCHEDULED_CALLS` is unset. It stays idle until Vault is filled and the flag is set.

Steps:
1. Backup: dashboard backup (or `pg_dump`), then note `select version from supabase_migrations.schema_migrations order by 1 desc limit 3;`.
2. Apply `20261113100000_worker_call_claims.sql`. Verify:
   ```sql
   select column_name from information_schema.columns where table_name='pending_worker_calls' and column_name='dial_claimed_at'; -- 1 row
   select to_regprocedure('private.apply_farm_changes_before_worker_claims(uuid,bigint,jsonb,text,jsonb)') is not null;        -- true
   ```
3. Apply `20261113090000_report_call_scheduler.sql` (needs `pg_cron` and `pg_net`). Verify:
   ```sql
   select jobname, schedule, active from cron.job where jobname like 'naqah-%';  -- naqah-report-calls (*/5), naqah-report-calls-history (daily)
   select to_regclass('public.scheduler_heartbeats') is not null;                -- true
   select has_table_privilege('anon','net.http_request_queue','select'),
          has_table_privilege('authenticated','net._http_response','select'),
          has_table_privilege('authenticated','public.scheduler_heartbeats','select');  -- all false
   select private.trigger_report_calls();                                         -- null while Vault is empty
   ```
4. Vault, only when section 3 is ready (names are fixed by the migration): `naqah_scheduler_url` =
   `https://<vercel-origin>/api/cron/report-calls` and `naqah_cron_secret` = the `CRON_SECRET` value, created with
   `vault.create_secret(value, name, description)` as in the checklist. Skip this to keep the job inert.

## 3. Vercel env matrix
Real values live only in Vercel, the bridge host and Vault. Variable names and notes are in `.env.example`.

| Variable | Value / source | Set when |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_NAQAH_ACCOUNT_DATA=1` | Supabase project (build-time) | already set |
| `SUPABASE_SECRET_KEY` | service key, server only | already set |
| `NAQAH_VOICE_MODE=farm` | literal | already set |
| `NAQAH_VOICE_LOCALE=ar` | literal | before the test call |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` | Twilio; the number is a verified `+966...` caller ID | after caller ID approval |
| `NAQAH_CALL_ALLOWLIST` | one consenting `+9665XXXXXXXX` | before the test call |
| `NAQAH_VOICE_SECRET` | random, at least 32 bytes; identical on the bridge | with the bridge |
| `NAQAH_VOICE_ENGINE=realtime` | literal | with the bridge |
| `NAQAH_BRIDGE_PUBLIC_URL` | `wss://<bridge-domain>/voice-bridge/media`, identical on the bridge | with the bridge |
| `NAQAH_PUBLIC_BASE_URL` | `https://<bridge-domain>`; host must equal the WSS host or preflight `public_bridge_url` fails | with the bridge |
| `NAQAH_CALL_TIME_LIMIT_SECONDS` | optional, 10-299; must match the bridge | only to change the default 300 |
| `NAQAH_AMD_SPEECH_THRESHOLD_MS`, `_SPEECH_END_THRESHOLD_MS`, `_SILENCE_TIMEOUT_MS` | optional; defaults suit long Arabic greetings | only after a failed AMD test |
| `NEXT_PUBLIC_NAQAH_BUILD_COMMIT` | commit SHA at build | each deploy |
| `CRON_SECRET` | same value as Vault `naqah_cron_secret` | before scheduling |
| `NAQAH_MANUAL_REPORT_CALLS=1` | owner "Call now" | section 5 only, then unset |
| `NAQAH_SCHEDULED_CALLS=1` | scheduler dials | go-live step 6, after a passed test |
| `NAQAH_CALL_OWNER=1` | owner summary calls | only if separately approved |

Leave `NAQAH_CALL_TRACE_DIR` and `NAQAH_REALTIME_URL` unset everywhere.

## 4. Voice bridge **[approval][paid]**
Recommended: Fly.io, one always-on machine. Routing rules (the bridge fronts the public voice domain; its upstream is the direct
Vercel origin, never itself) are in [voice-bridge-hosting](../integrations/voice-bridge-hosting.md).
Docker was not available when this was written, so **the image has never been built**; do the local build first.

```sh
# local verification, from the repo root
docker build -t naqah-voice-bridge:local services/voice-bridge
docker run --rm -p 3300:3300 \
  -e NAQAH_BRIDGE_PUBLIC_URL=wss://calls.example.com/voice-bridge/media -e TWILIO_AUTH_TOKEN=dummy \
  -e NAQAH_VOICE_SECRET=$(openssl rand -hex 32) -e OPENAI_API_KEY=dummy naqah-voice-bridge:local
curl -s localhost:3300/voice-bridge/health   # ok:true, publicUrl, maxCallSeconds
```

Fly (the Dockerfile exposes 3300, runs as non-root `node` and has its own HEALTHCHECK):
1. Region: `fra`, the EU example in the hosting doc; confirm availability and latency first.
2. `cd services/voice-bridge && fly launch --no-deploy --region fra` with an owned app name and the TOML from the hosting doc
   (`internal_port 3300`, `auto_stop_machines = "off"`, `min_machines_running = 1`, `kill_timeout = "15s"`, check `/voice-bridge/health` every 30 s).
3. `fly secrets set OPENAI_API_KEY=... TWILIO_AUTH_TOKEN=... NAQAH_VOICE_SECRET=... NAQAH_BRIDGE_PUBLIC_URL=wss://<bridge-domain>/voice-bridge/media NAQAH_BRIDGE_UPSTREAM=https://naqah.vercel.app`
   (add `NAQAH_CALL_TIME_LIMIT_SECONDS` only if Vercel sets it).
4. `fly deploy`, then `fly scale count 1`. One machine keeps a call on one process; a deploy drops live calls, so deploy outside call windows.
5. `fly certs add <bridge-domain>`, point DNS at it, and add the same domain to the Vercel project (no redirects).
6. Confirm `curl -s https://<bridge-domain>/voice-bridge/health`. Cost: a small always-on machine, which is minor next to OpenAI and Twilio per-minute usage.

## 5. One controlled Arabic end-to-end call **[approval][paid]**
Preconditions, all required:
- Owner's written approval and the worker's consent; Twilio recording and transcription off.
- Saudi caller ID in `TWILIO_PHONE_NUMBER` (the +44 number was screened as spam).
- The worker's number is the only `NAQAH_CALL_ALLOWLIST` entry and is an approved test number (see [test-calls](../integrations/test-calls.md)),
  or the owner uses "Call now" with `NAQAH_MANUAL_REPORT_CALLS=1`.
- Free preflight reports READY with every check passing (places no call):
  `node --env-file=.env.local scripts/preflight-call.mjs --base https://<exact-origin> --expect +9665XXXXXXXX --locale ar`
- `NAQAH_SCHEDULED_CALLS` unset. Tail the Vercel and bridge logs before dialling.

Call 1, the only one covered by the base approval. The worker:
1. Answers with a long greeting: «السلام عليكم ورحمة الله وبركاته، هلا مين؟» (AMD must say human, not `machine_*`).
2. Answers each guided question, one at a time.
3. At the read-back hears «أحفظه؟».
4. Says «إيه احفظ». Only now may the agent say it is saved.

Calls 2 and 3, only if separately approved: silence (answer and say nothing; expect one reprompt, then one goodbye) and voicemail or phone off
(expect `machine_*` and an unanswered run).

Record: Vercel log `[NAQAH] call answered (<token>): <AnsweredBy>`; bridge stdout JSON `event=call_ended` (`reason`, `durationMs`, `workerSpoke`);
`select occurrence, state, attempts, report_id from report_call_runs order by created_at desc limit 5;`; the saved report in the dashboard; no recording in Twilio.

Pass: human AnsweredBy, call ends after the read-back, `report_id` set, one attempt, no "saved" before the explicit yes, `call_ended` logged.
Fail (stop; no retry until reviewed): `machine_*` for a human, no `report_id` after the yes, "saved" said early, `bridge_error`, `openai_credit`, any dial outside the allowlist.
Afterwards unset `NAQAH_MANUAL_REPORT_CALLS` unless the owner wants it kept.

## 6. Rollback and "calls misbehaving"
Per layer, fastest first:
1. Hard stop: empty `NAQAH_CALL_ALLOWLIST` and redeploy (nothing can be dialled), or promote the previous Vercel deployment.
2. Dial flags: unset `NAQAH_SCHEDULED_CALLS`, `NAQAH_CALL_OWNER`, `NAQAH_MANUAL_REPORT_CALLS`, redeploy.
3. Scheduler: `select cron.alter_job((select jobid from cron.job where jobname='naqah-report-calls'), active := false);`
   or `select cron.unschedule('naqah-report-calls');`. Deleting the two Vault secrets also silences it.
4. Bridge: `fly scale count 0`. Calls fall back or end; harmless once step 1 is done.
5. Migrations: both are additive, so leave them applied. Old code ignores `dial_claimed_at`, and the idle jobs send nothing.

Decision tree:
- An unwanted call rang: step 1, then check the allowlist and `cron.job_run_details`.
- Rings but silent or drops early: check bridge health, `bridge_error` and `openai_credit` in bridge logs, run preflight, fix, re-test per section 5.
- Voicemail treated as human, or the reverse: read the `AnsweredBy` log, tune `NAQAH_AMD_*_MS` within range, one test call.
- Nothing rings on schedule: a heartbeat older than 15 minutes means check the Vault secrets, the `CRON_SECRET` match and `NAQAH_SCHEDULED_CALLS`;
  a fresh heartbeat with no call means no farm is due or the number is not allowlisted.
- Retries or duplicates: step 3, then inspect `report_call_runs` attempts (3 total, 20 minutes apart) before re-enabling.
