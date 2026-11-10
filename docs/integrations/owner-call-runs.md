# Owner call runs and the scheduler trigger

NAQAH calls the owner at the owner's own time, whether or not a report arrived. Nothing here is switched on by this code.

## Behaviour

| Rule | What happens |
|---|---|
| Cadence | Basic: one slot a week. Ultimate: one slot a day. From `ownerCallSchedule`, Asia/Riyadh. |
| Opening | Within 60 minutes of the slot, once per occurrence. |
| Worker call still running | The owner's slot waits, up to 50 minutes after its time. It then opens anyway, so a 5-minute scheduler still reaches the owner inside the hour. |
| Report spoken | At each attempt: the newest saved report newer than the last one the owner actually heard. None: a truthful no-report call. |
| Attempts | 3, 20 minutes apart. Interrupted counts as unsuccessful. Exhausted: `missed`, one missed notification, one event. |
| Provider refused | Not an attempt. Tried again in 20 minutes, until 3 hours after the slot. |
| Lost webhook | Ringing with no webhook after 15 minutes counts as unanswered. Answered with no final status after 1 hour counts as interrupted. |
| Basic completion | The summary played to the end: `<Say>`, then `<Redirect>` to `POST /api/voice/owner/heard`. |
| Ultimate completion | The conversation reached its end: instructions saved, declined or cancelled. A failed save or a dropped line isn't completion. |
| Twilio final status | `busy`, `no-answer`, `failed`, `canceled`: unanswered. `completed` without a recorded completion: interrupted. Same event id as the completion, so a completion is never downgraded. |

Code: `src/domain/ownerCalls.ts`, `src/domain/ownerSummary.ts`, `src/server/calls/owner-call.ts`, `src/server/voice/farm-call.ts`.

## What must be true before a call is placed

1. Migration `20261110090000_mvp_owner_runs.sql` is applied. Until then `farms.owner_call_run` is absent, the scheduler finds nothing to claim for owners, and no owner call is placed.
2. `NAQAH_VOICE_MODE=farm`, Twilio and `CRON_SECRET` are configured.
3. `NAQAH_SCHEDULED_CALLS=1` lets the route dial anything.
4. `NAQAH_CALL_OWNER=1` lets it dial owners. Both are off by default.
5. Something calls the route every ~5 minutes.

Apply the migration before deploying this code, or at least before setting `NAQAH_CALL_OWNER=1`. The old `owner_summary_*` columns stay and are no longer used.

## Scheduler trigger (not applied)

`GET /api/cron/report-calls` with `Authorization: Bearer $CRON_SECRET`. Vercel Hobby cron runs at most once a day, so it can't serve the 20-minute retries.

- **Supabase `pg_cron` + `pg_net`:** run `docs/integrations/scheduler-trigger.sql` by hand. It keeps the URL and secret in Vault. It is deliberately outside `supabase/migrations/`, so `db push` never applies it.
- **Local:** `CRON_SECRET=... node scripts/run-scheduler-local.mjs --base http://127.0.0.1:3000`. Add `--every 300` to keep running. It refuses any server that isn't on this machine.

A farm that fails is counted in `errors` and the next farm still runs. Overlapping runs are safe: a claim is saved under a revision check before dialling.

## Local tests

`sh supabase/local-validation/run-owner-runs.sh` runs every migration on a throwaway Postgres on port 54500, then the owner-run and round-trip tests.
