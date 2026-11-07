# Report call schedule

Status: owner-facing setting only. NAQAH does not place report calls yet, and the screen says so.
Nothing in this document has been applied to Supabase or Twilio. The backend part is a proposal.

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

## Where it is saved today

- **Demo mode:** in the browser, through the zustand store (`naqah-workspace-v1` in localStorage).
- **Account mode** (`NEXT_PUBLIC_NAQAH_ACCOUNT_DATA=1`): not saved. `src/server/db/mappers.ts` does not
  read it, `parseFarmProfile` does not accept it, and `adopt()` in `src/store/accountSync.ts` replaces
  settings with the server copy, which would drop it. So the section disables its controls and says the
  call time can't be saved to the account yet.

Nothing is sent to Supabase and no call is placed in either mode.

## Proposed backend contract (Supabase)

A proposal for the next migration (`0006_…`). Not applied.

1. **Columns on `farms`:**
   ```sql
   call_day smallint null check (call_day between 0 and 6),  -- 0 = Sunday; Basic only
   call_time time null                                         -- Asia/Riyadh
   ```
   The time zone is fixed to Asia/Riyadh. Optionally store it as
   `call_time_zone text not null default 'Asia/Riyadh'`. Ultimate ignores `call_day` (or keeps it null);
   do not reject a saved day on plan change, since the time and day survive a switch in the UI.
2. **Grants:** owner-writable like `window_day` / `window_start`. Rows are already covered by the
   `farms_owner` policy; add `call_day, call_time` to the column-level `grant insert (…)` and
   `grant update (…) on farms to authenticated`.
3. **`src/server/db/rows.ts`:** add `call_day: number | null; call_time: string | null`.
4. **`src/server/db/mappers.ts`:** map to `settings.callSchedule`, trimming the time with `hhmm` like
   the window. Null day and null time → `null`.
5. **`src/server/farm/input.ts` `parseFarmProfile`:** accept `callSchedule`. `null` clears both
   columns. Day: integer 0–6 or null. Time: `HH:MM` or empty (empty → null).
6. **Change diff:** add a `callSchedule` entry next to `windowChange` in `ownerChanges`
   (`src/lib/account/changes.ts`), sent with the `profile` change and applied by
   `src/server/farm/changes.ts`.
7. **`adopt()` in `src/store/accountSync.ts`:** keep the local `callSchedule` while the owner is
   typing, the same way it keeps `window`.
8. **UI:** once 1–7 ship, remove the "can't be saved to your account yet" state in `ReportCallSection`.

## Outbound calling (Twilio + scheduler, not built here)

- Compute the due time with `nextScheduledCall` from `src/domain/schedule.ts`. It is pure and uses
  Riyadh time; pass the server clock, never a client value.
- Place one call per occurrence. Record the occurrence so a re-run of the scheduler can't call twice.
- No answer: reuse the existing retry rule, 20 minutes × 3 then a No Answer Ticket
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
