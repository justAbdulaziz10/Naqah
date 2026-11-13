/**
 * Scheduled owner calls: NAQAH calls the owner at the owner's own time, with or without a report.
 * Basic: one slot a week. Ultimate: one slot a day. 3 attempts, 20 minutes apart, then "missed".
 * Pure functions; the scheduler, Twilio's webhooks and the voice contract all go through them.
 */
import { pushEvent, recordOwnerNotification } from "./actions";
import { HOUR, MINUTE, REPORT_CALL_GRACE_MS, RETRY_DELAY_MS } from "./clock";
import { uid } from "./id";
import { REPORT_CALL_GIVE_UP_MS, reportCallIsLive, reportCallRuns } from "./reportCalls";
import { previousScheduledCall } from "./schedule";
import type { FarmReport, OwnerAttemptResult, OwnerCallRun, Workspace } from "./types";

export type { OwnerAttemptResult, OwnerCallRun } from "./types";

export const OWNER_CALL_ATTEMPTS = 3;

/** A deferred slot opens this long before its grace period ends, so a scheduler tick still lands inside it. */
const DEFER_MARGIN_MS = 10 * MINUTE;
/** Twilio doesn't retry a lost webhook. A call still "ringing" this long after it was placed is over. */
const RING_LOST_MS = 15 * MINUTE;
const ANSWERED_LOST_MS = HOUR;

const iso = (d: Date) => d.toISOString();

const isLive = (run: OwnerCallRun) => run.state === "calling" || run.state === "answered";
const isDue = (run: OwnerCallRun, now: Date) => run.state === "calling" && run.nextAttemptAt !== null && Date.parse(run.nextAttemptAt) <= now.getTime();
const isTooOld = (run: OwnerCallRun, now: Date) => now.getTime() - Date.parse(run.occurrence) > REPORT_CALL_GIVE_UP_MS;

/** An owner number NAQAH can dial: E.164 after removing spaces and dashes. */
export function dialableOwnerPhone(ws: Workspace): string | null {
  const phone = ws.settings.owner.phone.replace(/[\s-]/g, "");
  return /^\+[1-9]\d{7,14}$/.test(phone) ? phone : null;
}

/**
 * The newest saved report newer than the last one the owner actually heard, or null.
 * Only the latest run is kept, so what was heard comes from the call log.
 */
export function newestUnsummarizedReport(ws: Workspace): FarmReport | null {
  const heard = new Set(ws.calls.filter((call) => call.kind === "owner_notification" && call.outcome === "completed").map((call) => call.reportId));
  if (ws.ownerCallRun?.state === "completed") heard.add(ws.ownerCallRun.reportId);
  const reports = [...ws.reports].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const newest = reports.at(-1) ?? null;
  const lastHeard = reports.filter((report) => heard.has(report.id)).at(-1);
  if (!newest || !lastHeard) return newest;
  return Date.parse(newest.at) > Date.parse(lastHeard.at) ? newest : null;
}

/**
 * The owner slot to open now, or null. A worker report call still running defers it, so the owner
 * hears the truth after the worker's attempts end, but never past the grace period.
 */
export function dueOwnerCallSlot(ws: Workspace, now: Date): Date | null {
  if (!ws.setupComplete) return null;
  const slot = previousScheduledCall(now, ws.settings.plan, ws.settings.ownerCallSchedule);
  if (!slot) return null;
  const elapsed = now.getTime() - slot.getTime();
  if (elapsed > REPORT_CALL_GRACE_MS || ws.ownerCallRun?.occurrence === iso(slot)) return null;
  const mayDefer = elapsed < REPORT_CALL_GRACE_MS - DEFER_MARGIN_MS;
  return mayDefer && reportCallRuns(ws).some((run) => reportCallIsLive(run, now)) ? null : slot;
}

/** Ends a run with no attempts left. A phone that really rang counts as one missed notification. */
function finishMissed(ws: Workspace, now: Date, run: OwnerCallRun): Workspace {
  run.state = "missed";
  run.nextAttemptAt = null;
  const name = ws.settings.owner.name;
  const attempts = run.attempts.length;
  if (!run.attempts.some((attempt) => !attempt.placementUnknown)) {
    pushEvent(ws, now, "attention", attempts
      ? { ar: `لم تصل حالة مكالمة ${name} — توقفت المحاولات التلقائية`, en: `The call status for ${name} didn't arrive — automatic attempts stopped` }
      : run.trigger === "manual"
        ? { ar: `تعذر على ناقة الاتصال بـ${name} الآن`, en: `NAQAH couldn't place the call to ${name}` }
        : {
            ar: `تعذر على ناقة الاتصال بـ${name} في موعد مكالمته`,
            en: `NAQAH couldn't place the scheduled call to ${name}`,
          });
    return ws;
  }
  if (run.trigger === "manual") {
    pushEvent(ws, now, "attention", { ar: `ما اكتملت مكالمة ${name}`, en: `The call to ${name} didn't complete` });
    return recordOwnerNotification(ws, now, run.reportId, false);
  }
  pushEvent(ws, now, "attention", {
    ar: `ما اكتملت مكالمة ${name} بعد ${attempts} محاولات`,
    en: `The scheduled call to ${name} didn't complete after ${attempts} ${attempts === 1 ? "attempt" : "attempts"}`,
  });
  return recordOwnerNotification(ws, now, run.reportId, false, new Date(run.occurrence));
}

/**
 * Scheduler step for one farm: settle a lost attempt, else the due retry, else the due slot,
 * recorded as a placed attempt before anything is dialled. Saved through a revision-checked
 * write, so two schedulers running at once can't both claim it.
 */
export function claimDueOwnerCall(
  input: Workspace,
  now: Date,
): { ws: Workspace; claim: { runId: string; attempt: number; phone: string; reportId: string | null } | null } {
  const current = input.ownerCallRun ?? null;
  const last = current?.attempts.at(-1);
  if (current && last?.result === "pending") {
    const age = now.getTime() - Date.parse(last.at);
    if ((current.state === "calling" && age >= RING_LOST_MS) || (current.state === "answered" && age >= ANSWERED_LOST_MS)) {
      const result = current.state === "answered" ? "interrupted" : "unanswered";
      return { ws: resolveOwnerCallAttempt(input, now, current.id, current.attempts.length, result, current.state === "calling"), claim: null };
    }
  }
  // A retry left waiting while the scheduler was down must not ring hours later for an old slot.
  if (current && isDue(current, now) && isTooOld(current, now)) {
    const ws = structuredClone(input);
    return { ws: finishMissed(ws, now, ws.ownerCallRun!), claim: null };
  }
  const phone = dialableOwnerPhone(input);
  if (!phone) return { ws: input, claim: null };
  if (current && isLive(current) && !isDue(current, now)) return { ws: input, claim: null };

  const ws = structuredClone(input);
  if (!current || !isLive(current)) {
    const slot = dueOwnerCallSlot(input, now);
    if (!slot) return { ws: input, claim: null };
    ws.ownerCallRun = { id: uid("ocr"), occurrence: iso(slot), reportId: null, attempts: [], nextAttemptAt: iso(now), state: "calling" };
    pushEvent(ws, now, "neutral", {
      ar: `حان موعد المكالمة — ناقة تتصل بـ${ws.settings.owner.name}`,
      en: `Owner call time — NAQAH is calling ${ws.settings.owner.name}`,
    });
  }
  const run = ws.ownerCallRun!;
  run.reportId = newestUnsummarizedReport(input)?.id ?? null;
  run.attempts.push({ at: iso(now), result: "pending" });
  run.nextAttemptAt = null;
  return { ws, claim: { runId: run.id, attempt: run.attempts.length, phone, reportId: run.reportId } };
}

/** The provider refused or never got the call: not an attempt. Tried again until the slot is too old. */
export function abandonOwnerCallAttempt(input: Workspace, now: Date, runId: string, attempt: number): Workspace {
  const current = input.ownerCallRun;
  if (!current || current.id !== runId || current.state !== "calling" || current.attempts.length !== attempt || current.attempts[attempt - 1].result !== "pending") {
    return input;
  }
  const ws = structuredClone(input);
  const run = ws.ownerCallRun!;
  run.attempts.pop();
  // A manual demo call authorized one call: nothing retries it.
  if (run.trigger === "manual" || isTooOld(run, now)) return finishMissed(ws, now, run);
  run.nextAttemptAt = new Date(now.getTime() + RETRY_DELAY_MS).toISOString();
  pushEvent(ws, now, "attention", {
    ar: `تعذر على ناقة الاتصال بـ${ws.settings.owner.name} — تحاول مرة ثانية بعد ${RETRY_DELAY_MS / MINUTE} دقيقة`,
    en: `NAQAH couldn't place the call to ${ws.settings.owner.name} — it will try again in ${RETRY_DELAY_MS / MINUTE} minutes`,
  });
  return ws;
}

/** The owner picked up. Idempotent: a repeated webhook changes nothing. */
export function markOwnerCallAnswered(input: Workspace, _now: Date, runId: string): Workspace {
  const current = input.ownerCallRun;
  if (!current || current.id !== runId || current.state !== "calling" || current.attempts.at(-1)?.result !== "pending") return input;
  const ws = structuredClone(input);
  ws.ownerCallRun!.state = "answered";
  return ws;
}

/**
 * How one attempt ended. Only a pending attempt can change, so a repeated or late webhook does
 * nothing and a completion is never downgraded. Interrupted counts as unsuccessful.
 */
export function resolveOwnerCallAttempt(
  input: Workspace,
  now: Date,
  runId: string,
  attempt: number,
  result: Exclude<OwnerAttemptResult, "pending">,
  placementUnknown = false,
): Workspace {
  const current = input.ownerCallRun;
  if (!current || current.id !== runId || current.attempts.length !== attempt || current.attempts[attempt - 1].result !== "pending") return input;
  const ws = structuredClone(input);
  const run = ws.ownerCallRun!;
  run.attempts[attempt - 1].result = result;
  if (placementUnknown) run.attempts[attempt - 1].placementUnknown = true;
  run.nextAttemptAt = null;
  if (result === "completed") {
    run.state = "completed";
    return recordOwnerNotification(ws, now, run.reportId, true);
  }
  // A manual demo call authorized one call. Only scheduled runs retry unattended.
  if (attempt >= OWNER_CALL_ATTEMPTS || run.trigger === "manual") return finishMissed(ws, now, run);
  run.state = "calling";
  run.nextAttemptAt = new Date(now.getTime() + RETRY_DELAY_MS).toISOString();
  pushEvent(ws, now, "neutral", placementUnknown
    ? {
        ar: `لم تصل حالة مكالمة ${ws.settings.owner.name} — ناقة تعيد المحاولة بعد ${RETRY_DELAY_MS / MINUTE} دقيقة (${attempt}/${OWNER_CALL_ATTEMPTS})`,
        en: `The call status for ${ws.settings.owner.name} didn't arrive — NAQAH will try again in ${RETRY_DELAY_MS / MINUTE} minutes (${attempt}/${OWNER_CALL_ATTEMPTS})`,
      }
    : result === "interrupted"
    ? {
        ar: `انقطعت مكالمة ${ws.settings.owner.name} — ناقة تعيد الاتصال بعد ${RETRY_DELAY_MS / MINUTE} دقيقة (${attempt}/${OWNER_CALL_ATTEMPTS})`,
        en: `The call to ${ws.settings.owner.name} ended early — NAQAH will try again in ${RETRY_DELAY_MS / MINUTE} minutes (${attempt}/${OWNER_CALL_ATTEMPTS})`,
      }
    : {
        ar: `لم يرد ${ws.settings.owner.name} — ناقة تعيد الاتصال بعد ${RETRY_DELAY_MS / MINUTE} دقيقة (${attempt}/${OWNER_CALL_ATTEMPTS})`,
        en: `${ws.settings.owner.name} didn't answer — NAQAH will try again in ${RETRY_DELAY_MS / MINUTE} minutes (${attempt}/${OWNER_CALL_ATTEMPTS})`,
      });
  return ws;
}

export type OwnerCallNowBlock = "setup_incomplete" | "no_owner_phone" | "call_live";

/** A worker report call still running (ringing, connected or waiting for its retry), or an owner call ringing or connected. */
export function anyCallLive(ws: Workspace, now: Date): boolean {
  if (reportCallRuns(ws).some((run) => reportCallIsLive(run, now))) return true;
  const last = ws.ownerCallRun?.attempts.at(-1);
  if (!ws.ownerCallRun || last?.result !== "pending") return false;
  return now.getTime() - Date.parse(last.at) < (ws.ownerCallRun.state === "answered" ? ANSWERED_LOST_MS : RING_LOST_MS);
}

/**
 * LOCAL DEMO ONLY: the owner asks NAQAH to call them now, from the Dashboard. Opens a manual owner run for the
 * newest report the owner hasn't heard (or the "no new report" briefing), recorded as a placed attempt before
 * anything is dialled, exactly like a scheduled slot. One attempt: a manual run never retries. It never touches
 * report call runs or the worker. A run left waiting for a scheduled retry is replaced: the owner asked for this one.
 */
export function openOwnerCallNow(
  input: Workspace,
  now: Date,
): { ws: Workspace; claim: { runId: string; attempt: number; phone: string; reportId: string | null } | null; blocked: OwnerCallNowBlock | null } {
  if (!input.setupComplete) return { ws: input, claim: null, blocked: "setup_incomplete" };
  const phone = dialableOwnerPhone(input);
  if (!phone) return { ws: input, claim: null, blocked: "no_owner_phone" };
  if (anyCallLive(input, now)) return { ws: input, claim: null, blocked: "call_live" };
  let base = input;
  // A pending attempt whose webhook was lost is settled first, as the scheduler would.
  const lost = input.ownerCallRun;
  if (lost && lost.attempts.at(-1)?.result === "pending") {
    base = resolveOwnerCallAttempt(input, now, lost.id, lost.attempts.length, lost.state === "answered" ? "interrupted" : "unanswered", lost.state !== "answered");
  }
  const ws = structuredClone(base);
  const run: OwnerCallRun = {
    id: uid("ocr"),
    occurrence: iso(now),
    reportId: newestUnsummarizedReport(base)?.id ?? null,
    attempts: [{ at: iso(now), result: "pending" }],
    nextAttemptAt: null,
    state: "calling",
    trigger: "manual",
  };
  ws.ownerCallRun = run;
  pushEvent(ws, now, "neutral", {
    ar: `طلبت مكالمة المالك الآن — ناقة تتصل بـ${ws.settings.owner.name}`,
    en: `You asked for the owner call now — NAQAH is calling ${ws.settings.owner.name}`,
  });
  return { ws, claim: { runId: run.id, attempt: 1, phone, reportId: run.reportId }, blocked: null };
}
