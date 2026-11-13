# Supabase backend foundation

Status: built and tested locally. **Nothing here has been applied to a Supabase project.** Until
`NEXT_PUBLIC_NAQAH_ACCOUNT_DATA=1` is set, everyone stays on the browser demo. The voice routes use
this code only when `NAQAH_VOICE_MODE=farm`; see `twilio-activation.md`.

Target project: `ydsgmzxqjimwbamnksxe`. Never apply this to any other project.

## How it fits together

| Who writes | Path | Protection |
|---|---|---|
| Owner (website) | `src/server/farm/actions.ts` → `src/server/db/owner-repository.ts` | Validated session, RLS, column grants |
| Voice service, schedulers | `src/server/voice/contract.ts` → `runFarmAction` → `apply_farm_changes` | Secret key, service_role only, one transaction |

All business rules stay in `src/domain`. The server loads a `Workspace`, runs the pure action,
and `diffWorkspace` turns the result into one change set. So rules run the same in the Call Lab
and on a real call, and SQL only stores the result.

- **Owners, farms, workers, camels:** owner CRUD. Plan and bookkeeping are never owner-writable.
- **Reports:** written only by calls. Answers and findings are saved with the report.
- **Alerts:** a read model (`src/domain/alerts.ts`) over findings, open No Answer tickets and
  overdue tasks. There is no alerts table, so alerts can't disagree with their source.
- **Instructions:** a read model over relays and task tickets. They are created during calls;
  a website instruction form is not an approved feature.

## Schema review

`0001_init.sql` held up: RLS on every table, explicit grants (which the Data API now requires),
private helpers, same-farm foreign keys. `0002_backend_foundation.sql` closes what it missed:

| Gap | Effect without the fix | Fix |
|---|---|---|
| Domain ids are not UUIDs (`tsk_ab12…`) | No domain-created row could be saved | `toDbId`: stable UUID per farm |
| A callback logs a No Answer ticket in `CallLog.ticketId` | Foreign key failure | `calls.no_answer_ticket_id` |
| The heat-day finding has no criterion row | Foreign key failure | `findings.source` |
| `calls` and `reports` reference each other | They could not be inserted together | Deferrable foreign keys, checked before the function returns |
| No atomic multi-table write | A failed save could leave half a report | `apply_farm_changes` |
| No concurrency control | Two calls could both pass the "one report" rule | `farms.revision`, retry on fresh state |
| Webhook retries | A retried report would be refused as a second report | `voice_events` returns the first answer |
| Free-text phones, no index | Inbound calls could not be matched | E.164 checks and indexes |
| Unindexed foreign keys | Slow deletes, advisor warnings | Indexes on all of them |

`0003_voice_call_sessions.sql` adds the working state of a live call, deleted when the call ends.
Replaying the engine from the farm can't work on a real call: a callback or a Basic inquiry changes
the farm mid-call. It holds the dialogue position and the structured draft, never a transcript.

`apply_farm_changes` is the only function in `public`. It is SECURITY INVOKER and only
`service_role` can run it. `voice_events` and `voice_call_sessions` have RLS on with no policy, so
owners and anon can't reach them.

## Account mode

With the flag on, `AccountBoundary` wraps `/app` and `/start` and decides whose farm renders:

| Visitor | Gets |
|---|---|
| Signed out | The browser demo, unchanged |
| Signed in | Their farm from Supabase, created on first entry |
| Signed in, Supabase unreachable | An error with a retry, never the demo |

Screens still call `update(fn)`. In account mode `src/store/accountSync.ts` diffs the document
against the last server copy (`src/lib/account/changes.ts`), and sends only owner-writable fields to
`POST /api/account`, which runs the same validated owner actions. So a screen can't write a report
or ticket, and a sample can't replace a farm: a document with another `createdAt` is refused.

- **Not a Server Action.** Next queues those behind navigation and drops one in flight when the page
  changes, so the save that finishes setup would hang.
- **Saved means saved.** The screen shows saved only after the server answers. A failure shows a
  banner, keeps the edit, and retries. Closing the page with unsaved edits warns first.
- **Half-typed values** (a partial phone number) stay on screen and aren't sent.
- **Calls appear live.** The farm reloads on focus and every 30 seconds, never over unsaved edits.
- **localStorage stays the demo's.** A real farm is never written there.
- **Hidden on a real farm:** Call Lab, demo clock and notice, sample data, Start over.

Not imported: setup details typed into the browser before signing up. The owner enters them again.
Sample farms need a marker before that can be offered, because a demo can't be told apart from a
real draft.

Rollback: unset the flag and rebuild. Local data is untouched, and saved farm data stays in Supabase.

## Before going live

**Needs the project owner**
- [ ] Access to `ydsgmzxqjimwbamnksxe`. The connected Supabase account can't see it today.
- [ ] Apply `0001`–`0004` (steps in `supabase-preparation.md`; a dry run must list all four).
- [ ] Set `NEXT_PUBLIC_NAQAH_ACCOUNT_DATA=1` and rebuild, after the migrations are applied.
- [ ] Run Security and Performance Advisors and review the results.
- [ ] Set `SUPABASE_SECRET_KEY` (`sb_secret_…`) on the server only. Legacy `service_role` keys are
      being retired.
- [ ] Finish the OTP protections in `owner-auth.md` before enabling real login.

**Needs a decision**
- [ ] How a farm gets Ultimate. Owners can't set their plan, so every farm starts on Basic until
      billing or an admin step exists.
- [ ] Verifying phone numbers. Nothing proves a number belongs to the farm that saved it, so
      any signed-up owner can save another farm's worker number. `findCaller` then refuses both
      farms, which blocks that worker's calls; an unclaimed number can be squatted. Fine for a
      closed test, not for open sign-up. Needs service-only verified columns, and `findCaller`
      matching verified numbers only.
- [ ] Unregistered callers (open decision 4), and instructions during inquiry calls (6).
- [ ] Whether, and how often, an unconfirmed task is called about again. Today it gets one
      automatic call, then is asked about during the worker's own calls.
- [ ] How long `voice_events` is kept. It only needs to outlast webhook retries.
- [ ] Deleting an account: `farms` cascades, so it removes the farm's whole history.

**Needs building**
- [ ] Account deletion as a service-side step. `0004` removed owners' direct delete on `farms`.
- [ ] Generate database types once the schema is applied, and replace `src/server/db/rows.ts`.
- [ ] A scheduler for retries and task checks. Vercel Hobby cron is too slow for 20-minute retries.
- [ ] Weather on the server: it is not stored, so the heat-day question needs a fresh forecast.
- [ ] Reject a worker phone that matches the owner's on the same farm, so setup can warn early.

## What has been verified

`sh supabase/local-validation/run-foundation.sh` on a throwaway Postgres 17 with stand-in
Supabase roles. It covers grants, RLS, cross-farm writes, rollback, both races, and real domain
flows saved and reloaded through both migrations. The older isolation suite reports one expected
failure, "no functions in public", which predates `apply_farm_changes`.

`scripts/verify-account.mjs` drives a real browser against `run-stack.sh`: real migrations and
PostgREST, stand-in Auth. It covers setup, saving, refresh, sign-out and sign-in, a failed save,
two owners, Basic and Ultimate, Arabic and English, a mocked call reaching the dashboard, and the
demo staying separate.

`sh supabase/local-validation/run-voice.sh` runs mocked, signed Twilio webhooks through the route
handlers, `supabase-js`, a real PostgREST and all migrations.

**Not verified:** real Supabase roles and `auth.uid()` (the stand-ins imitate them), the platform's
API gateway, real sign-up and OTP against this data path, advisors, and any live call. Run these against the real project before relying on them.

`supabase-preparation.md` predates this work: its `ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY`
names are out of date, use `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY`.
