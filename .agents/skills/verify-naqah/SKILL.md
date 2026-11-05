---
name: verify-naqah
description: Launch, drive and prove the NAQAH investor demo (Next.js web app, Arabic/English, mobile + desktop). Use after any change to pages, the Call Lab engine, the setup wizard, the store or i18n, before claiming it works, and to check the live Vercel site.
---

# verify-naqah

NAQAH is a web app; everything runs in the browser (state = `localStorage["naqah-workspace-v1"]`). Nothing dials,
records, bills or emails, so every drive here is safe. The only outward side effect in this repo is deploying:
pushing `main` triggers a Vercel **production** deploy (https://naqah.vercel.app) — push only when the user asked.

All commands run from the repo root. Each prints JSON and exits nonzero with `"ok": false` and a `reason`.

## Launch
```bash
node scripts/verify-naqah.mjs launch            # npm run build, then next start on :3210, records pid in .verify-naqah.json
node scripts/verify-naqah.mjs launch --no-build # reuse the current .next build
```
Fresh worktree: run `npm ci` first (`launch` otherwise fails with `next: command not found`).
Ready signal: `"ok": true` with `pid` and `buildId`. It refuses if the port already answers (someone else's server);
pass `--port 3211` for a second, independent run. Always verify a **production** build — two real bugs (store stuck
on hydration, prerender `new Date()`) never appeared under `next dev`.

## Doctor
```bash
node scripts/verify-naqah.mjs doctor
```
Read-only: `/en` answers 200, the pid we launched is alive, `.next/BUILD_ID` still matches the launch (rebuilt since?
relaunch), cached Playwright Chromium is present. Run before the first drive and after anything surprising.

## Drive
| Command | Proves (asserted, not printed) |
|---|---|
| `call-lab [--locale ar]` | sample farm → worker report saved with a sick-camel finding → owner call opens a task ticket and queues a worker call → 4 missed attempts (20-min skips) → No Answer ticket, transcript says so → worker calls back: ticket closed, no new report; no page errors |
| `features [--locale ar]` | "Try Basic" «جرّب الأساسية» → `/app` on Basic; language switch keeps the path; settings "Load sample Ultimate farm"; herd "Add camel" +1; clock +20 min; owner inquiry logs a call; emergency shows the direct-call card and saves nothing; settings "Reset demo" clears the workspace |
| `voice [--locale ar]` | signed Twilio webhooks: worker report saved in ≤40 turns, tampered state rejected (see features/phone.md for env) |
| `wizard [--locale ar]` | onboarding with "Fill sample data": 9 steps, lands on `/app`, `setupComplete: true` |
| `screens` | 32 full-page screenshots (ar/en × 375/1440 × 8 pages), no horizontal overflow, no console errors |

Against the live site: add `--base https://naqah.vercel.app` (doctor then only checks the URL answers).
Feature details, handles and gotchas: [features/README.md](features/README.md).

## Evidence
`artifacts/verify/<feature>/<timestamp>/` (git-ignored): screenshots per step and `transcript.json` (replies chosen +
check results). Look at the screenshots before claiming a visual result — `screens` passing only means no overflow
or errors; a page stuck on the loading camel also "passes" the overflow check.

## Cleanup
```bash
node scripts/verify-naqah.mjs stop   # kills only the pid recorded by launch; evidence stays
```
Never `pkill next` — the user often has `npm run dev` on :3000.

## Proven
2026-11-05: launch → doctor → call-lab (en, ar) → wizard → screens all ok. Break test: commenting out
`ws.reports.push(report)` in `src/domain/actions.ts` made `call-lab` fail with `report saved: 1 → 1`.
2026-11-05 (maintenance): launch → doctor → call-lab, features (en, ar) → wizard (en, ar) → screens all ok. Added
`features` and the callback step; `driveCall` now stops only after three quiet polls (one slow reply had ended the
retry chain after the third skip).
2026-11-05 (merge of the maintenance branch onto the integrations work): call-lab (en, ar) and features (en, ar)
ok after updating the landing CTA selector to the redesigned copy ("Try Basic" «جرّب الأساسية»).
