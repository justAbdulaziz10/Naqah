# Supabase backend foundation

Status (2026-11-08): migrations **0001–0005, `20261107213717_owner_flow`, and `20261108000000_pending_worker_call_tasks` are applied** to the live project `ydsgmzxqjimwbamnksxe`. 0001–0005 were
verified to match these files exactly (normalized statement hashes). Owner flow is recorded live as `20261107213717`, and its repository filename matches. The grouped task-link migration was applied after a dry run listed it alone. Account mode is still opt-in: until the exact
build-time `NEXT_PUBLIC_NAQAH_ACCOUNT_DATA=1` is set, everyone stays on the browser demo and `/api/account` returns
404. The voice routes use this code only when `NAQAH_VOICE_MODE=farm`; see `twilio-activation.md`.

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

`0004_owner_write_limits.sql` removes owners' farm deletion privilege and enforces field length/shape checks.
`0005_custom_question_retry.sql` corrects the BEFORE INSERT limit for `ON CONFLICT(id)` retries: count other
question ids within the same farm, under the existing farm-row lock. Repeating the fifth question succeeds;
a distinct sixth is refused. Invoker security, immutable parents, grants and RLS are unchanged.
`20261107213717_owner_flow.sql` is the owner flow: `farms.call_day/call_time` (NAQAH calls the worker; Basic weekly, Ultimate
daily, Asia/Riyadh), `farms.herd_count` + `herd_count_reviewed_at` (official count; a worker's count is a proposal kept
on `reports.herd_count_reported`), several workers per farm (Basic 3, Ultimate 10, trigger `workers_limit`; the one
NAQAH calls is `farms.primary_worker_id`, cleared if that worker is deleted), `report_call_runs` (one row per
scheduled slot, unique `(farm_id, occurrence)`, service-written, owner-readable), the `worker_report_missed` call
kind, and `apply_farm_changes` saving those rows. The retired reporting window columns stay so old rows load.
The complete sequence is **0001 → 0002 → 0003 → 0004 → 0005 → 20261107213717 → 20261108000000**; do not edit old migrations to absorb fixes.

`20261108000000_pending_worker_call_tasks.sql` keeps one worker call linked to multiple Task Tickets through
`pending_worker_call_tasks`. The original `task_ticket_id` remains for compatibility with older call rows and writers.
The hosted migration history and resulting schema, RLS and grants were verified after application.

The plan-selection feature adds `20261108010000_initial_plan_selection.sql`. It records an owner's first Basic or
Ultimate choice in `farms.plan_selected_at` through `select_initial_plan`, before creating a new farm or continuing
an incomplete legacy farm. Existing unmarked farms are left unchanged until their owner confirms. This migration is
not yet part of the hosted migration history; do not deploy this feature with account mode enabled until it has
passed local verification and the hosted preflight/application steps.

Local proof without Docker: `supabase/local-validation/run-foundation.sh` (0002 + 0006 checks, isolation, races,
domain round trip including a report call) and `run-stack.sh` (Postgres + PostgREST + mock Auth) with
`src/server/farm/owner-flow.stack.test.ts` (an owner's setup saved and reloaded under RLS).

`apply_farm_changes` is the only function in `public`. It is SECURITY INVOKER and only
`service_role` can run it. `voice_events` and `voice_call_sessions` have RLS on with no policy, so
owners and anon can't reach them.

## Account mode

With the flag on, `AccountBoundary` wraps `/app` and `/start` and decides whose farm renders:

| Visitor | Gets |
|---|---|
| Signed out | The browser demo, unchanged |
| Signed in, plan not confirmed | The explicit Basic/Ultimate selection gate; no farm is created until Continue |
| Signed in, plan confirmed | Their farm from Supabase; a new farm is created on confirmation |
| Signed in, Supabase unreachable | An error with a retry, never the demo |

Screens still call `update(fn)`. In account mode `src/store/accountSync.ts` diffs the document
against the last server copy (`src/lib/account/changes.ts`), and sends only owner-writable fields to
`POST /api/account`, which runs the same validated owner actions. So a screen can't write a report
or ticket, and a sample can't replace a farm: account documents must retain the server-supplied
`farmId` and `ownerId`. Timestamps describe creation time and are never account/farm identity.

- **Not a Server Action.** Next queues those behind navigation and drops one in flight when the page
  changes, so the save that finishes setup would hang.
- **Saved means saved.** The screen shows saved only after the server answers. A failure shows a
  banner, keeps the edit, and retries. Closing the page with unsaved edits warns first.
- **Account switches discard old edits.** Entry loads the current farm before flushing. A conflict clears
  the old base and pending retry before reopening, and generation checks ignore obsolete save/load/open
  results. Same-owner entry still flushes setup edits; ordinary network failures keep their retry behavior.
- **Stable identity at both boundaries.** Open/load/save workspaces carry the repository's farm UUID and
  the validated session's owner ID. Saves compare the client UUID to the farm loaded through that owner's
  session-bound repository/RLS; the client UUID never selects or authorizes access to a farm. A timestamp,
  even one equal to the current farm's `createdAt`, cannot satisfy the save precondition.
- **Cross-tab Auth changes.** AccountBoundary subscribes to SDK auth events, immediately clears the old
  workspace/base/timer on an owner change, and queues a reopen outside the SDK callback. Requests check a
  local session identity hint before and after I/O, plus the server-returned owner and local auth/generation
  versions. Old results cannot be adopted even before a broadcast arrives. A local one-second poll and
  focus/visibility checks cover cookie-only server callbacks which do not emit an SDK broadcast. Same-owner
  token refresh keeps pending edits. Subscriptions and timers are cleaned up on unmount; multiple boundaries
  share one observer. These browser hints reject stale UI data; only server getOwner()/RLS authorize access.
- **Half-typed values** (a partial phone number) stay on screen and aren't sent.
- **Calls appear live.** The farm reloads on focus and every 30 seconds, never over unsaved edits.
- **localStorage stays the demo's.** A real farm is never written there.
- **Hidden on a real farm:** Call Lab, demo clock and notice, sample data, Start over.

Not imported: setup details typed into the browser before signing up. The owner enters them again.
Sample farms need a marker before that can be offered, because a demo can't be told apart from a
real draft.

### Same-owner concurrency limitation (Sourcery review)

Saves within one tab remain serialized by `while (saving)`; an adversarial test queues four flushes behind
an in-flight save, changes the pending value, and verifies one concurrent save and the newest snapshot.
The review's suggested overlapping-flush race was not reproduced, so the existing loop is retained.

Different tabs of the **same** owner editing the same field still have last-write-wins behavior. The service
revision is not an owner-edit CAS token and owner mutations are independent writes. Adding a revision read/check
outside an atomic write would introduce a TOCTOU race rather than solve this. Atomic owner batch writes and a
same-field conflict policy need a separately reviewed change; no revision/migration shortcut is introduced here.

### Exact flag contract and rollback

There is one flag, `NEXT_PUBLIC_NAQAH_ACCOUNT_DATA`, not a second `NAQAH_ACCOUNT_DATA` variable.
Only the exact string `1` enables it. Unset, empty, `0`, `true`, or whitespace disable it. Next inlines this
public flag at build time, including server references, so changing deployment settings alone is insufficient.

The route checks it before origin/body/action handling; disabled requests return JSON 404 with `Cache-Control:
no-store`. Independently callable exports in `src/server/farm/actions.ts` gate through `asOwner` (and the
`openAccount` early return), producing `unavailable` before session validation or repository creation. Enabled
requests retain same-origin checks, validated session ownership, RLS and no-store responses.

Rollback: unset the flag, rebuild and replace the active deployment. Old deployments/requests already in flight
are not cancelled by changing a setting. Saved farm data remains in Supabase; local demo storage is untouched.
This app-level gate does **not** revoke Supabase Auth sessions, remove Data API/RLS grants, stop direct Supabase
requests or disable `NAQAH_VOICE_MODE=farm`/service jobs. Those require separately authorized operational steps.

## Before going live

**Needs the project owner**
- [x] Confirm owner access to the existing `ydsgmzxqjimwbamnksxe` and inspect its actual migration history.
- [ ] Review/merge the readiness PR separately, then obtain explicit activation authorization (issue #6 stays open).
- [x] Apply `0001`–`0005` in order, then the reviewed owner-flow and grouped task-link migrations; remote history matches local files.
- [ ] Set `NEXT_PUBLIC_NAQAH_ACCOUNT_DATA=1` and rebuild, after the migrations are applied.
- [ ] Run Security and Performance Advisors and review the results.
- [ ] Verify `SUPABASE_SECRET_KEY` (`sb_secret_…`) only for the service/voice path; owner CRUD uses session/RLS.
- [ ] Finish the OTP protections in `owner-auth.md` before enabling real login.

**Needs a decision**
- [ ] Post-setup plan changes and upgrades. Owners select Basic or Ultimate once before initial setup;
      there is no billing, charge, or plan-change flow after confirmation.
- [ ] Verifying phone numbers. Nothing proves a number belongs to the farm that saved it, so
      any signed-up owner can save another farm's worker number. `findCaller` then refuses both
      farms, which blocks that worker's calls; an unclaimed number can be squatted. Fine for a
      closed test, not for open sign-up. Needs service-only verified columns, and `findCaller`
      matching verified numbers only.
      Seen on live (2026-11-08): two QA farms saved the same worker number. It affects inbound
      routing only (`findCaller` treats the caller as unknown); outbound report calls still go to
      each farm's own stored number. Decision: no global unique index on `workers.phone` for now.
      Until verification exists, consider telling the owner when a saved number is already
      registered elsewhere, without revealing the other farm.
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
flows saved and reloaded through the full migration sequence. The older isolation suite reports one expected
failure, "no functions in public", which predates `apply_farm_changes`.

`sh supabase/local-validation/run-account.sh` applies all five migrations on loopback-only disposable Postgres
and runs `custom-question.pg.test.ts`: lost-response fifth-question retry, genuine sixth rejection, owner/anon
isolation, same-farm immutable parents, Ultimate/downgrade, multi-row rollback and concurrent insert/retry/downgrade.
The same fifth-question test fails with `23514` on 0001–0004 before 0005. Unit regressions separately verify
flag-off makes no account/repository calls and owner changes cannot loop or adopt stale save results.
`npm run typecheck` generates Next route helpers with `next typegen` before `tsc --noEmit`, including fresh checkouts.

`scripts/verify-account.mjs` drives a real browser against `run-stack.sh`: real migrations and
PostgREST, stand-in Auth. It covers setup, saving, refresh, sign-out and sign-in, a failed save,
two owners, Basic and Ultimate, Arabic and English, a mocked call reaching the dashboard, and the
demo staying separate.

`sh supabase/local-validation/run-voice.sh` runs mocked, signed Twilio webhooks through the route
handlers, `supabase-js`, a real PostgREST and all migrations.

**Not verified:** real Supabase roles and `auth.uid()` (the stand-ins imitate them), the platform's
API gateway, real sign-up and OTP against this data path, advisors, and any live call. Run these against the real project before relying on them.

Current environment names and manual activation steps are maintained in `supabase-preparation.md` and `.env.example`.
