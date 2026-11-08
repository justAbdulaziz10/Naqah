# Backend and calling verification

Verified locally on 2026-11-08 by `gpt-6.1-sol` (high reasoning effort), starting at `d56e16b`.
Worktree: `/Users/moha/.t3/worktrees/NAQAH/t3-641b784b`, branch `t3/verify-backend-calling`.

## Scope and safety

- No live Supabase access, real Twilio requests, calls, SMS, WhatsApp, deployment, push or merge.
- No other checkout's environment files were read. All credentials were locally generated or fake.
- PostgreSQL 17 ran on loopback port 54355, PostgREST on 54356, mock Auth on 54357,
  and the outbound transport mock on 54359. App ports: 3460–3464.
- Databases: `naqah_codex_stack`, `naqah_codex_voice`, `naqah_codex_account`, `naqah_codex_foundation`.
- Scheduled calling stayed unset in the production preview processes. No migration was added.
- Protected ports 3000, 3017, 3212, 3300 and 4040 were neither used nor stopped.
- Evidence is gitignored under `artifacts/qa-codex/`; screenshots were visually inspected.

## Results

- **Auth, all four onboarding steps, reload and RLS: PASS.** `verify-owner-flow.mjs` has 37 passing
  assertions; `verify-account.mjs` has 42. Real Postgres/PostgREST, mocked Auth, browser email login,
  persisted workers/primary/herd/schedule/questions, reload, sign-out/sign-in and direct cross-owner
  read/write refusals are covered. The owner stack suite adds two passing repository tests.
- **Workers, schedules, custom questions and allowances: PASS for the integrated product rules.**
  Basic weekly exact weekday/time and Ultimate daily time are persisted. The browser stops offering
  a sixth Basic question; a forged owner-action request rejects it; nine database tests cover the
  trigger, retries, concurrent inserts and isolation. The calling proof rejects a second Basic report
  call after the saved report, and an answered owner notification consumes the weekly owner allowance.
  **Not applicable to this revision:** the requested legacy From/To window. `AGENT.md` explicitly
  retires it in favor of outbound exact-time report calls; this verification did not restore it.
- **Manual outbound initiation: PASS.** `verify-calling.mjs` has 18 passing assertions. It clicks the
  actual Call now confirmation, tests a configured flag-off server and non-allowlisted fake number,
  then follows signed outbound turns through a saved report. The recording flag is false.
- **Voice integrity, retries and callbacks: PASS for implemented paths; incomplete for unattended
  instruction/task dialing.** Sixty real-database voice tests cover bad/missing signatures, inbound
  reports after missed calls, turns, atomic save failures, duplicate/concurrent delivery, callbacks,
  tenant isolation and unreachable database behavior. The browser proof records one owner notification
  and consumes its allowance once despite duplicate status delivery. Report status webhooks exercise
  no-answer, busy and failed, two 20-minute retries, then a missed report run. Separately, four persisted
  instruction attempts (initial + three 20-minute retries) create one No Answer ticket; signed inbound
  callback closes it without adding a report. This latter retry test invokes the service contract, not
  a nonexistent instruction-status webhook/scheduler. Real instruction and task-verification dialing
  remain unbuilt, as documented in `twilio-activation.md`.
- **Cron safety: PASS.** Missing/wrong bearer secrets refuse; the correct secret returns
  `scheduled_calls_off`, with no transport requests. Unit tests also cover an unset `CRON_SECRET`.
- **Dashboard report: PASS.** `owner-flow/report-{ar,en}-{375,1440}.png` shows the persisted report,
  accepted worker herd-count proposal, findings and resources in both languages and directions.
  All four sizes have no horizontal overflow; no uncaught browser errors were recorded.
- **Failure honesty: PASS.** A mocked Twilio 503 produces a clear UI failure and leaves no unanswered
  attempt; PostgREST 503 returns `unavailable` and shows retry rather than sample data; recovery reloads
  the farm. A revoked Auth session cannot save and redirects to login. The account proof aborts a save,
  retains the edit and retries once. Voice database tests cover unavailable DB, failed/partial writes,
  retry recovery and never claiming saved before the write succeeds.

## Confirmed fix

Concurrent deliveries of the final report confirmation previously saved one report but placed **two**
owner notification calls. The regression failed with two intercepted calls before the fix, then passed
with one afterwards. Notification now runs only for the request that wins the existing compare-and-swap
voice-session turn advance. No schema change is required. This is duplicate-delivery protection, not a
durable notification outbox or guaranteed delivery after a process crash.

The verification harness also needed updates for email-first login, exact accessible worker labels,
12-hour localized time text, localhost cookies, four-step setup, read-only plans, missed-report return
eligibility, save completion and a scheduled rather than manual retry fixture. Those changes do not
change product rules. No confirmed bug in frontend-owned files remains from this run.

## Checks and evidence

- `npm ci`: success; npm reports eight moderate dependency advisories (not changed in this task).
- `npm test`: 764 passed; 79 database-dependent tests skipped in this invocation and run separately.
- `run-voice.sh`: 60 passed. `run-account.sh`: 9 passed.
- `owner-flow.stack.test.ts`: 2 passed. Foundation domain round trip: 8 passed.
- `verify-owner-flow.mjs`: 37 passed. `verify-account.mjs`: 42 passed. `verify-calling.mjs`: 18 passed.
- `verify-naqah.mjs voice --locale ar` and `--locale en`: both passed, 16 turns each; tampering rejected.
  These are explicitly sample-line proofs, not claims that a farm report was saved.
- `npm run typecheck`, `npm run lint`, `NEXT_PUBLIC_NAQAH_ACCOUNT_DATA=1 npm run build`: passed.
- The extra foundation runner retains its documented legacy `no functions in public` expected failure:
  `apply_farm_changes` intentionally exists and is service-only. Its revision/event race errors are
  expected assertions. Its eight domain round-trip tests pass.
- Logs are in `artifacts/qa-codex/{owner-flow,account,calling,voice-pg,account-pg,foundation,owner-stack,npm-test,typecheck,lint,build}.log`.
- The pre-fix notification regression is retained in `artifacts/qa-codex/voice-regression-before.log`.

## Reproducing the additional calling proof

Start `run-stack.sh` with the loopback ports and disposable DB above. Source only its generated local
`stack.env`, then build with the account flag. Start a second `mock-gateway.mjs` on port 54359 pointing
to the same local PostgREST; this instance receives intercepted outbound requests only.

For the manual preview, use fake `TWILIO_ACCOUNT_SID=AC00000000000000000000000000000000`,
`TWILIO_AUTH_TOKEN=local-test-auth-token`, `TWILIO_PHONE_NUMBER=+15555550100`,
`NAQAH_CALL_ALLOWLIST=+15555550101,+15555550102`, `NAQAH_MANUAL_REPORT_CALLS=1`,
`NAQAH_CALL_OWNER=1`, `NAQAH_VOICE_MODE=farm`, `NAQAH_VOICE_LOCALE=en`,
`NAQAH_VOICE_SECRET=local-only-codex-verification-secret`, `CRON_SECRET=local-only-cron-secret`,
and `NAQAH_TEST_OUTBOUND_GATEWAY=http://127.0.0.1:54359`. The transport preload rejects non-loopback
fetches and accepts only fake credentials; the mock endpoint accepts only the two fake recipient numbers.

```sh
NAQAH_PUBLIC_BASE_URL=https://localhost:3463 node --import ./supabase/local-validation/mock-outbound.mjs ./node_modules/next/dist/bin/next start -p 3463
```

Start a second configured preview on 3464 with the manual flag omitted and matching public origin.
The HTTPS public origins are used only for generated/signed callback URLs; the verifier transports
requests to HTTP localhost and signs the corresponding HTTPS URL. No TLS tunnel or public exposure is used.

```sh
PGHOST=127.0.0.1 PGPORT=54355 PGUSER=postgres node scripts/verify-calling.mjs
```

Run this proof alone: it briefly injects PostgREST failures in the local gateway and clears them in
`finally`. Do not run other browser proofs during that injection.

## Readiness and approvals

The code is locally ready for **one explicitly owner-authorized, supervised scripted report-call test
after the fix is integrated**, not unattended operation or a production launch. Before any real attempt,
the owner must approve the consenting recipient and cost, verify the intended live configuration and
schema, and keep scheduled calls off. Arabic audio recognition, carrier delivery, actual Twilio status
behavior, and the real platform Auth/RLS gateway were not tested here. No live migration approval is
requested for this change. Instruction/task dialing and the discrepancy with the retired-window brief
need product/lead resolution rather than silent backend changes.
