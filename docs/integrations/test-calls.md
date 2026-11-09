# Manual Test AI Call (server)

This is a paid, admin-only test tool, separate from scheduled calls and the owner's normal
Call now. It reuses the existing outbound report call, realtime Stream, bridge and report-save
path. It does not enable either `NAQAH_MANUAL_REPORT_CALLS` or `NAQAH_SCHEDULED_CALLS`.

## Gates

- `NAQAH_TEST_CALLS` must be exactly `1`; otherwise both methods return 404 without querying auth.
- `NAQAH_TEST_CALL_ADMINS` lists user IDs or confirmed email addresses, comma-separated.
  Signing in without an entry returns the same 404. Signed-out requests return 401 when enabled.
- The admin's own farm must have a service-managed row in `test_call_ranches`. No request can
  select a different farm. Owners cannot read or write the tool's tables directly.
- Farm voice mode, realtime voice configuration, outbound configuration and farm storage
  credentials must be configured. `NAQAH_CALL_ALLOWLIST` must contain the destination;
  unlike normal outbound calls, an absent or empty allowlist refuses all test calls.

Only Saudi mobiles are accepted: `+9665XXXXXXXX`, `9665XXXXXXXX`, `05XXXXXXXX` or `5XXXXXXXX`,
optionally containing spaces and dashes. The API normalizes to E.164 and never persists the full
destination in the test audit. The audit and API show only `+9665******XX`.

## HTTP contract

`GET /api/test-call` returns readiness, blockers and the current admin's latest call.
`POST /api/test-call` requires same origin, a JSON body of at most 2048 bytes, a UUID `requestId`,
`phone`, `confirmedCharge: true` and `consentConfirmed: true`. Shared response and view types
are in `src/server/calls/test-call-api.ts` and can be imported by client code.

A repeated request ID returns the original audit without dialing. Concurrent active calls are
rejected by a database-wide partial unique index. Limits reserve 3 calls/hour and 10/day per
actor, plus 20/day globally through the existing shared limiter. A request that never places a
call releases every reserved slot. A provider refusal is a successful HTTP response containing
the failed call view, with a safe failure category rather than provider details.

## Exactly what gets cleared

After acquiring the active audit row and before opening the report run, the service invokes
`reset_test_call_ranch(testCallId)`. This service-only, transactional RPC joins that row to its
actor-owned farm and the explicit marker and locks all three. It refuses an unmarked farm or
an actor/farm mismatch, even for a service caller.

For that one marked farm only, it:

- Snapshots linked runs' report-saved truth into historical test audits.
- Deletes old voice sessions, report-call runs and reports. Report answers and findings cascade
  with their reports; existing report references are nulled by the existing foreign keys.
- Clears `farms.last_update_at` and increments its revision, invalidating stale farm writes.

It preserves `test_calls` history, farm settings, worker numbers, calls, events, tasks, herd and
resources. Historical audit `run_id` references become null on run deletion. Existing call/event
history is not used by the report-period guard; that guard reads reports, and the active guard
reads report-call runs. The existing diff path cannot delete, so clearing uses this narrow RPC
rather than extending ordinary farm persistence with general-purpose deletion.

## Completion and isolation

The audit receives its run ID before dialing, so callbacks cannot beat linking. Status writes
are conditional on earlier states, so delayed ringing/answer/final callbacks cannot regress a
finished call. Every final status closes an active test run with no retry. Active audits older
than 15 minutes are failed as `timed_out` and their runs closed before reads or new placements.
Reads expire only the requesting actor's calls; global stale-slot cleanup happens only after a
new placement passes its ranch, allowlist and configuration gates.
Report-saved truth is read from the linked run's `report_id`; the snapshot is used only once a
later reset deletes that run.

While the feature is enabled, marked ranches never get owner update calls, even with
`NAQAH_CALL_OWNER=1`. Farm voice handling already bypasses the sample WhatsApp-summary path.
With the switch off, the owner-call and callback paths do not query the new tables.

All validation uses fake providers and loopback PostgreSQL/PostgREST. The focused database test
requires `NAQAH_TEST_DB=naqah_testcall`, `PGHOST=127.0.0.1`, `PGPORT=54910` and
`NAQAH_TEST_POSTGREST=http://127.0.0.1:54911`, with the local stack gateway on 54912. Run database
files with `--no-file-parallelism`. No live provider or hosted database is needed.
