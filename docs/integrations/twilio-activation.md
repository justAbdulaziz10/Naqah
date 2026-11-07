# Twilio activation: one authorized test call

Status (2026-11-08): the NAQAH **Twilio subaccount** is connected in the local preview (git-ignored
`.env.local` of the `NAQAH-owner-flow` worktree; never in git). **No call has been placed.** Webhooks are
verified over HTTPS through an ngrok tunnel. Unattended scheduled calls are off.

| Item | State |
|---|---|
| Account | NAQAH subaccount, active, full (not trial). Bills to the parent account's balance. |
| Caller ID | `+447447199952` (UK, voice-capable), `TWILIO_PHONE_NUMBER` |
| Saudi (+966) | Allowed: the subaccount inherits the parent's voice geo permissions (Saudi low-risk on) |
| Credentials | The subaccount's own SID and auth token (Twilio signs its webhooks with that token) |
| Public origin | `https://breastless-nonfraudulently-marquetta.ngrok-free.dev` → `next start -p 3300` |
| Number's own Voice URL | Not set (only needed for workers phoning in; outbound calls carry their own URLs) |

## Controlled test switches (all server-side, all off unless set)

| Variable | Effect |
|---|---|
| `NAQAH_MANUAL_REPORT_CALLS=1` | Shows the owner's **Call {worker} now** on the dashboard. The farm comes from the owner's session (RLS) and the number from that farm's saved primary worker; nothing in the request chooses who is called. |
| `NAQAH_CALL_ALLOWLIST=+9665…` | Only these E.164 numbers can ring (scheduled, manual and owner calls). Unset = no extra limit. Set to anything invalid (e.g. `none-yet`) = nothing can ring. |
| `NAQAH_SCHEDULED_CALLS=1` | Lets `/api/cron/report-calls` dial. Without it the route answers `skipped: scheduled_calls_off` even with the right `CRON_SECRET`. |
| `NAQAH_CALL_OWNER=1` | After a saved report, calls the farm's `owner_phone` with the findings (paid). |

`GET /api/integrations/status` reports `outbound.configured`, `manualCalls`, `scheduledCalls` and the
number of allowlisted numbers (never the numbers or secrets).

### One controlled call

1. The owner signs in on the preview, finishes setup with the consenting worker's mobile (`+9665…`) as
   the worker NAQAH calls, and a call time.
2. Put exactly that number in `NAQAH_CALL_ALLOWLIST` and restart `next start` (server env is read at start).
3. Dashboard → **Call {worker} now**. NAQAH places one call; status shows on the dashboard every 5 s.
4. The worker answers the scripted questions (Twilio speech recognition, `ar-SA`; keypad works too).
5. The report appears on the dashboard; the run is `completed`. Unanswered → retried twice, 20 min apart.
6. Afterwards set the allowlist back to `none-yet` (or remove `NAQAH_MANUAL_REPORT_CALLS`).

## Report calls: NAQAH calls the worker

The worker no longer phones in to report. NAQAH calls the farm's primary worker at the owner's
schedule (`farms.call_day` / `call_time`, Asia/Riyadh): Basic once a week, Ultimate once a day.

1. **Scheduler.** Something outside the app calls `GET /api/cron/report-calls` every ~5 minutes with
   `Authorization: Bearer $CRON_SECRET`. It refuses every request while `CRON_SECRET` is unset, places
   nothing unless `NAQAH_VOICE_MODE=farm`, and answers `503 not_configured` with the missing variable
   names when Twilio or Supabase isn't set.
2. For each farm from `listScheduledFarmIds`, it claims the due slot or the due retry
   (`claimDueReportCall`) and saves that attempt **before** dialling, in one revision-checked write.
   A slot is called once (`report_call_runs` is unique per farm and occurrence), so two scheduler runs
   can't call twice. Slots more than an hour old are skipped.
3. It asks Twilio to place the call (`src/server/calls/twilio.ts`, `Record=false`, 30 s ring). The
   `Url` and `StatusCallback` carry a signed token with the farm, run and attempt. If Twilio refuses
   or can't be reached, the attempt is undone (not logged as unanswered) and retried in 20 minutes,
   for up to 3 hours.
4. **Answered:** Twilio posts to `/api/voice/outbound?s=…`. The signature must verify, and the farm
   and run come from the token, never from caller ID. The run is marked answered, its CallSid is stored
   on it, and the scripted questions run through `/api/voice/turn` exactly as before. The report saves
   with `completeWorkerReport(…, runId)`; the worker's camel count is kept as a proposal
   (`reports.herd_count_reported`), never the official count.
5. **Not answered** (`no-answer`, `busy`, `failed`, `canceled` at `/api/voice/outbound/status?s=…`):
   retry after 20 minutes, 2 retries, then the run is `missed` and the owner sees it on the dashboard.
   Each unanswered attempt is a `worker_report_missed` call.
6. **Answered then hung up before saving** (`completed` with the run still answered): the run ends
   `missed`; nothing is saved.
7. **The worker phones in.** A No Answer ticket is delivered first. If the worker missed this
   period's report call, their call takes the report. Otherwise NAQAH thanks them and says when it
   will call.
8. **Owner update call** (optional, paid): with `NAQAH_CALL_OWNER=1`, after a saved report NAQAH calls
   the farm's own `owner_phone` with the findings. Its final status records `owner_notification`
   (answered or missed). It never uses `NAQAH_OWNER_PHONE`. WhatsApp summaries stay sample-line only.

### Activate real worker calls

Each step needs the owner's approval. Do the inbound steps below first.

1. **Twilio number that can call Saudi mobiles.** Upgrade the account, buy a voice number, and enable
   Saudi Arabia in Voice geographic permissions. A Saudi caller ID needs a regulatory bundle (business
   registration or ID and a signed Letter of Authorization); a US number works for a first test.
2. **Server variables** (never `NEXT_PUBLIC_`):

   ```sh
   NAQAH_VOICE_MODE=farm
   NAQAH_PUBLIC_BASE_URL=https://<exact public origin>   # https only
   NAQAH_VOICE_SECRET=<random, at least 32 bytes>          # signs the call tokens
   TWILIO_ACCOUNT_SID=<AC...>
   TWILIO_AUTH_TOKEN=<primary auth token>
   TWILIO_PHONE_NUMBER=<+E.164 caller ID>
   SUPABASE_SECRET_KEY=<sb_secret_...>                     # or SUPABASE_SERVICE_ROLE_KEY
   NEXT_PUBLIC_SUPABASE_URL=https://ydsgmzxqjimwbamnksxe.supabase.co
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<sb_publishable_...>
   CRON_SECRET=<random>
   # optional, paid: NAQAH_CALL_OWNER=1
   ```
3. **Migration `0006_owner_flow.sql`** applied with the others, in the authorized activation phase.
4. **A scheduler every ~5 minutes.** Vercel Hobby cron runs once a day, which misses both the call
   time and the 20-minute retries. Use one of:
   - Vercel Pro cron on `/api/cron/report-calls` (Vercel sends `Authorization: Bearer $CRON_SECRET`).
   - Supabase `pg_cron` + `pg_net`:
     ```sql
     select cron.schedule('naqah-report-calls', '*/5 * * * *', $$
       select net.http_get('https://<origin>/api/cron/report-calls',
         headers := jsonb_build_object('Authorization', 'Bearer <CRON_SECRET>'))
     $$);
     ```
     Keep the secret in Vault rather than inline if the project uses it.
   - Any external scheduler that can send the header.
5. **Test farm.** In Settings, set the worker's number with the country code (`+9665…`) and a report
   time two or three minutes ahead. Check the scheduler by hand once:
   `curl -H "Authorization: Bearer $CRON_SECRET" https://<origin>/api/cron/report-calls` → `placed: 1`.
6. **Check:** the phone rings, the report saves, `select state, attempts, provider_call_id from
   report_call_runs` shows `completed`, and Twilio's log shows no recording. Let one call ring out to
   see the 20-minute retry.

Rollback: unset `CRON_SECRET` (the route then refuses everything) or `NAQAH_VOICE_MODE`, and remove
the scheduler job.

## How a real call works

`NAQAH_VOICE_MODE=farm` turns on the path below. Unset, the line runs the sample farm, says so to
the caller, and saves nothing. Farm mode never falls back to sample data: if a required variable
is missing, the caller hears that the line isn't configured.

1. Twilio posts to `/api/voice/inbound`. The signature must verify; `NAQAH_ALLOW_UNSIGNED_VOICE`
   has no effect here.
2. `findCaller` matches the number to one farm. Unknown, hidden, or ambiguous numbers hear a
   refusal and nothing is written. So does a farm with `setup_complete = false` or a missing
   worker or owner name.
3. The scripted engine runs on the farm loaded from Supabase. `voice_call_sessions` holds the
   call's position, so the questions stay fixed for the call and answers stay out of URLs.
4. On confirmation, `applyVoiceEvent` runs the rules on fresh state and saves in one transaction.
   The caller hears "saved" only after that returns `saved`.
5. A failed save is never reported as saved. The caller gets one retry, then is told it couldn't
   be confirmed. A repeated webhook gets its first reply and saves nothing twice.
6. `/api/voice/status` deletes the working row when the call ends. A hang-up saves nothing.

It is scripted, not conversational AI: `src/domain/conversation/engine.ts` asks fixed questions and
`src/server/voice/speech.ts` matches keywords. No model is called and nothing is billed for one.

## Blocked

These stop the first real call. None can be worked around with sample data.

| Dependency | Why | Owner |
|---|---|---|
| Application schema on `ydsgmzxqjimwbamnksxe` | The latest team report says the project exists with Auth test users but no application migrations (issue #6). Confirm access/history and obtain activation approval first; Task A does not query or change live data. | Project owner |
| `SUPABASE_SECRET_KEY` | Reported set in production/preview; still verify service-only scope and the intended activation environment without exposing it. Local readiness tests require no live key. | Project owner |
| Twilio credentials | None on this machine, and no Twilio tool is connected, so the account could not be checked. | Project owner |

Decisions needed from the owner:

- **Owner notification.** Not sent in farm mode. The existing summary goes to one number from the
  environment, which would send one farm's report to the wrong person, and nothing records whether
  the owner answered. It needs an outbound call that uses `farms.owner_phone` and a status webhook
  that sends `owner_notification`.
- **Owner inquiry.** Built and tested, off by default (`NAQAH_VOICE_OWNER_INQUIRY`). Caller ID can
  be spoofed and an inquiry reads farm data aloud. Decide whether a PIN is needed first.
- **A worker number on two farms** is refused for both. That is deliberate (open decision 4).

## Expected cost

Read from Twilio's pages on 2026-11-06. Confirm before buying.

| Item | Price | One 5-minute call |
|---|---|---|
| US local number | $1.15 a month | $1.15 |
| Inbound call | $0.0085 a minute | $0.04 |
| Speech recognition, about 12 answers | $0.02 per use | $0.24 |
| `<Say>` with Polly | Billing tier unconfirmed; Standard is listed at $0.0008 per 100 characters | about $0.02 |
| **Twilio total** | | **about $1.45** |
| Caller's carrier charge, Saudi mobile to a US number | Not published by Twilio | Check with the carrier |

No owner call or WhatsApp message is sent in farm mode.

Sources: [US pricing](https://www.twilio.com/en-us/voice/pricing/us),
[voice pricing](https://www.twilio.com/en-us/voice/pricing),
[Saudi pricing](https://www.twilio.com/en-us/voice/pricing/sa).

**A Saudi number is not the fast path.** Twilio's [Saudi guidelines](https://www.twilio.com/en-us/guidelines/sa/regulatory)
list toll-free +966800 numbers only, with a business registration or ID and a signed Letter of
Authorization. The lead time isn't stated. Use a US number for the first test.

**Use an upgraded account.** Twilio says trial calls are [restricted to the sign-up country](https://www.twilio.com/docs/usage/tutorials/how-to-use-your-free-trial-account),
so a call from Saudi may not connect, and a trial plays its own message first.

## Steps for one test call

Each step is the owner's to approve.

1. **Confirm the project.** Check that you can open `ydsgmzxqjimwbamnksxe`. Never apply this
   schema to any other project.
2. **Apply the schema only in a separately authorized activation phase.** Follow `supabase-preparation.md`.
   The complete order is `0001_init.sql`, `0002_backend_foundation.sql`, `0003_voice_call_sessions.sql`,
   `0004_owner_write_limits.sql`, `0005_custom_question_retry.sql`. An empty application's dry run must
   list all five; otherwise reconcile migration history first. Then run Security and Performance Advisors.
   Task A's readiness PR does not apply them or enable voice/account flags. Issue #6 remains an activation dependency.
3. **Get a public HTTPS address.** Either run the branch locally behind a tunnel, which needs no
   deployment, or use a deployment without Vercel Authentication. Twilio can't pass that login.
4. **Set the server variables** there, never in a `NEXT_PUBLIC_` name:

   ```sh
   NAQAH_VOICE_MODE=farm
   NEXT_PUBLIC_NAQAH_ACCOUNT_DATA=1      # build-time: rebuild after setting it
   NAQAH_PUBLIC_BASE_URL=https://<exact public origin>
   TWILIO_AUTH_TOKEN=<primary auth token>
   SUPABASE_SECRET_KEY=<sb_secret_...>
   NEXT_PUBLIC_SUPABASE_URL=https://ydsgmzxqjimwbamnksxe.supabase.co
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<sb_publishable_...>
   ```

   Leave `NAQAH_CALL_OWNER`, `WHATSAPP_TOKEN` and `NAQAH_VOICE_OWNER_INQUIRY` unset.
5. **Check it refuses strangers.** An unsigned post must return 403:

   ```sh
   curl -s -o /dev/null -w '%{http_code}\n' -X POST https://<origin>/api/voice/inbound -d 'From=%2B15550100'
   ```

6. **Create the test farm.** Sign in on the site and finish setup with
   the test phone as the worker. Use a different phone for the owner. It stays on Basic, so set a
   reporting window that covers the call, in Settings.

7. **Buy the number and point it here.** Upgrade the account, buy a US voice number, then under
   Voice Configuration set **A call comes in** to `https://<origin>/api/voice/inbound` and
   **Call status changes** to `https://<origin>/api/voice/status`, both HTTP POST. Leave recording
   off. Confirm the status field in the console; the pages read for this guide only describe
   status callbacks on `<Number>`, not on the phone number itself.
8. **Make the call** from the test phone. Expect the automated-assistant greeting, then the
   farm's questions. Answer by voice for at least two questions, to test Arabic recognition.
   Press 1 at the summary.
9. **Check the database.** The report must be there, with the right call:

   ```sql
   select r.at, c.provider_call_id, a.question_ar, a.answer, a.certainty
   from reports r
   join calls c on c.id = r.call_id
   join report_answers a on a.report_id = r.id
   order by r.at desc, a.sort_order;

   select count(*) from voice_call_sessions; -- 0 once the call has ended
   ```

10. **Check Twilio's call log** for webhook errors and confirm no recording exists.

11. **Check the dashboard.** Signed in as the owner, open Calls. The report must be there.

Pass: the call completes, one report matches what was said, the working row is gone, the Twilio log
is clean, and the owner sees the report.

Rollback: clear the number's webhook URLs, or unset `NAQAH_VOICE_MODE`. Then release the number to
stop the monthly charge. Test rows go with `delete from farms where id = '<id>'`, which removes
that farm's history.

## Known limits

- **Arabic speech recognition is untested on real audio.** It is the largest unknown. Twilio lists
  `ar-*` for its experimental models only, and `<Gather>` sets no `speechModel` today. Choices can
  fall back to the keypad; free-text answers can't.
- **Replies read in full.** A herd above nine camels can't be picked by keypad, and "all well"
  lists each camel in the summary. Fine for a test farm, not for a large herd.
- **Worker languages.** Arabic and English only. The other languages setup offers are spoken to
  in Arabic.
- **Sample names.** Engine copy still swaps sample names at render, so free text containing
  «أحمد» or "Abdullah" is swapped too, for example a task about another person with that name.
  Pass names into the engine to fix this.
- **Working rows.** If a call's final status callback is lost, the row and any partial draft stay
  until the next inbound call clears them. The row is service-only. Run the cleanup from the
  scheduler once one exists.
- **Quantity units.** Stored and spoken in English even on an Arabic call: «العلف: كافٍ (12 bags)».
- **Heat-day question.** Weather isn't stored on the server, so real calls don't ask it.
- **Instruction and task-verification calls.** The scheduler places report calls only. Owner
  instructions and scheduled task checks (`pending_worker_calls`) are not dialled yet.
- **Answering machines.** A voicemail that picks up counts as answered; the questions play to it and
  the run ends unsaved. Twilio `MachineDetection` is not enabled.
- **Owner update call.** It reads the findings and hangs up; owner instructions by phone after a
  real report aren't built. A voicemail counts as answered.
- **Scheduler size.** Farms are handled one after another in one request. Fine for a pilot; batch it
  before many farms share one schedule time.
- **Caller ID is not proof.** A valid signature shows the request came through Twilio, not who is
  calling. On report calls NAQAH places, the farm comes from the signed token instead. On a call the
  worker places, a spoofed worker number could file that farm's report, but only after that farm's
  report call was missed this period.

- **Phone numbers aren't verified.** See `supabase-backend.md`. Keep sign-up closed until decided.

## Testing it locally

No Twilio or Supabase account needed. Needs a throwaway Postgres over TCP and a PostgREST binary:

```sh
PGHOST=127.0.0.1 PGPORT=<port> PGUSER=postgres POSTGREST_BIN=<path> sh supabase/local-validation/run-voice.sh
```

Signed webhooks enter the real route handlers, then real `supabase-js`, PostgREST and all
migrations. Only Twilio is mocked. `npm test` covers the signature, routing and speech rules without
a database.
