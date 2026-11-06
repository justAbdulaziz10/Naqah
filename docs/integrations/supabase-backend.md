# Supabase backend foundation

Status: code and migrations only. **Nothing here has been applied to a Supabase project**, and
the app still runs on localStorage. No page or live voice route uses this code yet.

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

`apply_farm_changes` is the only function in `public`. It is SECURITY INVOKER and only
`service_role` can run it. `voice_events` has RLS on with no policy, so owners and anon can't reach it.

## Replacing localStorage

The investor demo must keep working, so localStorage stays as demo mode. Nothing is removed.

1. **Apply and verify.** Apply both migrations, then repeat the isolation checks with two real
   test owners.
2. **Add an account mode.** A signed-in owner gets `mode: "account"`. The store loads with
   `loadWorkspace` and keeps its current shape, so read-only pages don't change. Signed-out
   visitors stay in demo mode. Add this behind a flag, off by default.
3. **Move writes screen by screen.** `update(fn)` writes the whole document, so it can't be used
   in account mode. Setup, Settings and Herd call the owner actions, then refresh from the
   result. Show a real error when a save fails, and never show "Saved" before the server confirms.
4. **Keep simulation out of real farms.** The Call Lab and demo clock run domain actions in the
   browser. In account mode they must be hidden, or stay on a separate demo workspace.
5. **Import once, by choice.** On first sign-in, offer to bring over setup details and the herd.
   Do not import reports, calls or tickets: they are simulated, and must not become farm history.
   Sample farms need a marker first, because a demo workspace can't be told apart from a real one.
   `toDbId` makes a retried import land on the same rows. Keep the local copy until the import is
   confirmed.
6. **Show call results live.** Calls now change the farm while the dashboard is open. Refresh on
   focus and on an interval first; add Realtime only if that isn't enough.
7. **Connect the phone line.** See `voice-data-contract.md`.

Rollback at any step before 7: turn the flag off. The local data is untouched.

## Before going live

**Needs the project owner**
- [ ] Access to `ydsgmzxqjimwbamnksxe`. The connected Supabase account can't see it today.
- [ ] Apply `0001` and `0002` (steps in `supabase-preparation.md`; a dry run must now list both).
- [ ] Run Security and Performance Advisors and review the results.
- [ ] Set `SUPABASE_SECRET_KEY` (`sb_secret_…`) on the server only. Legacy `service_role` keys are
      being retired.
- [ ] Finish the OTP protections in `owner-auth.md` before enabling real login.

**Needs a decision**
- [ ] How a farm gets Ultimate. Owners can't set their plan, so every farm starts on Basic until
      billing or an admin step exists.
- [ ] What "Start over" means for a real farm. It clears reports, calls and tickets in demo mode,
      but owners can't delete those rows, and they are real history. Hide it in account mode, or
      decide how history is archived.
- [ ] Unregistered callers (open decision 4), and instructions during inquiry calls (6).
- [ ] Whether, and how often, an unconfirmed task is called about again. Today it gets one
      automatic call, then is asked about during the worker's own calls.
- [ ] How long `voice_events` is kept. It only needs to outlast webhook retries.
- [ ] Deleting an account: `farms` cascades, so it removes the farm's whole history.

**Needs building**
- [ ] Steps 2–7 above.
- [ ] Generate database types once the schema is applied, and replace `src/server/db/rows.ts`.
- [ ] A scheduler for retries and task checks. Vercel Hobby cron is too slow for 20-minute retries.
- [ ] Weather on the server: it is not stored, so the heat-day question needs a fresh forecast.
- [ ] Reject a worker phone that matches the owner's on the same farm, so setup can warn early.

## What has been verified

`sh supabase/local-validation/run-foundation.sh` on a throwaway Postgres 17 with stand-in
Supabase roles. It covers grants, RLS, cross-farm writes, rollback, both races, and real domain
flows saved and reloaded through both migrations. The older isolation suite reports one expected
failure, "no functions in public", which predates `apply_farm_changes`.

**Not verified:** real PostgREST behaviour (repository tests use a stub), real Supabase roles and
`auth.uid()`, advisors, and any live call. Run these against the real project before relying on them.

`supabase-preparation.md` predates this work: its `ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY`
names are out of date, use `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY`.
