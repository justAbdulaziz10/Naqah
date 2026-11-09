# Report call schedule

Status: the schedule is saved (demo: browser; account: Supabase, migration `20261107213717_owner_flow`). Placing real calls needs Twilio
credentials and a scheduler: see `twilio-activation.md`.

## Product rule

NAQAH calls the worker. The worker does not call NAQAH to report.

| Plan | Report call | Owner chooses |
|---|---|---|
| Basic | one scheduled call per week | weekday + exact time |
| Ultimate | one scheduled call every day | exact time |

All times are Asia/Riyadh (UTC+3, no daylight saving).

## Frontend contract (implemented)

```ts
// src/domain/types.ts
export interface CallSchedule {
  /** Basic only: 0 = Sunday … 6 = Saturday (Asia/Riyadh). Ignored on Ultimate; null until chosen. */
  day: Weekday | null;
  /** "HH:MM", 24h, Asia/Riyadh. "" until chosen. */
  time: string;
}
// Settings.callSchedule?: CallSchedule | null   (optional: older workspaces lack it)
```

Pure helpers in `src/domain/schedule.ts`:

- `CALL_SCHEDULE_TIME_ZONE = "Asia/Riyadh"`.
- `isCompleteCallSchedule(plan, schedule)`: Basic needs a day and a time; Ultimate needs a time.
- `nextScheduledCall(now, plan, schedule): Date | null`. Basic: the next chosen weekday at the time,
  strictly after `now`. Ultimate: today at the time if it is still ahead, otherwise tomorrow.
  Returns `null` when the schedule is incomplete.

Cadence comes from `settings.plan` and is never stored. Switching plan keeps the time; a Basic
farm with no day chosen needs one again before the schedule is complete.

The UI is the "Report call" section in Settings: `src/components/schedule/ReportCallSection.tsx`.

## Where it is saved

- **Demo mode:** in the browser, through the zustand store (`naqah-workspace-v1` in localStorage).
- **Account mode:** `farms.call_day` / `farms.call_time` (migration 0006, applied live). The owner's edit goes through
  `ownerChanges` (`callSchedule` on the profile change) → `parseFarmProfile` → the owner's session under RLS.
  A half-typed time is not sent. `adopt()` keeps the local value while the owner is typing.

## Outbound calling (Twilio + scheduler, not built here)

- Compute the due time with `nextScheduledCall` from `src/domain/schedule.ts`. It is pure and uses
  Riyadh time; pass the server clock, never a client value.
- Place one call per occurrence. Record the occurrence so a re-run of the scheduler can't call twice.
- No answer: 3 attempts total, 20 minutes apart, then stop. No new No Answer Ticket. Owner calls are not redialed.
  (`RETRY_DELAY_MS`, `MAX_RETRIES` in `src/domain/clock.ts`, `resolveWorkerCallAttempt`).
- Vercel Hobby cron runs at most once a day, which can't hit an exact time or the 20-minute retry.
  Use Vercel Pro, Supabase `pg_cron` calling the route, or Twilio scheduling (AGENT.md §8.4).
- Disable Twilio recording, as for every NAQAH call.

## Open decisions

Not decided. Do not treat the suggestions as approved.

1. **Legacy Basic reporting window.** `settings.window` (`window_day`, `window_start`, `window_end`)
   is still used by onboarding, by `getCallSetupGaps` in `src/components/setup/CallSetupStatus.tsx`,
   by the Overview, Call Lab and calendar feed, and by the worker-inbound rules in `src/domain/rules.ts`.
   These files were left unchanged on purpose because other work owns them, so Settings still shows the
   old "Reporting schedule" card under the Report call card on Basic. Suggested follow-up: make
   `getCallSetupGaps` and those screens read `callSchedule` / `isCompleteCallSchedule`, give onboarding's
   schedule step the same day/time controls, then remove the legacy card from Settings and decide whether
   the window and the inbound report path are retired.
2. **Changing the time after today's call (Ultimate).** Proposal: the new time applies from the next
   occurrence only; never a second report call on the same day.
3. **Changing the day or time on Basic after this week's call.** Same question; the same proposal
   (next occurrence, at most one call per week) would keep the plan limit intact.
