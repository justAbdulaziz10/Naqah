/**
 * Pure state transitions. Each takes a Workspace and returns a NEW Workspace.
 * The UI (Call Lab, dashboard) and — later — real telephony webhooks should go
 * through these functions so the rules live in exactly one place.
 */
import { undeliveredCalls } from "./alerts";
import { MAX_RETRIES, MINUTE, RETRY_DELAY_MS } from "./clock";
import { coveredTasks, dueTaskVerifications, dueWorkerCalls, openCoveredTasks, returnableReportRun } from "./rules";
import { coveredReportDraft, evaluateFindings, reportDraftIssue, type ReportDraft } from "./findings";
import { uid } from "./id";
import type {
  CallKind,
  CallLog,
  EventTone,
  FarmReport,
  LocalizedText,
  PendingWorkerCall,
  Workspace,
} from "./types";

const clone = (ws: Workspace): Workspace => structuredClone(ws);
const iso = (d: Date) => d.toISOString();

export const DEMO_CALL_RETENTION_LIMIT = 200;
export const DEMO_REPORT_RETENTION_LIMIT = 100;

/**
 * Bound the history saved by the browser demo. Account actions use the same transitions on the
 * server and must never apply this policy to database rows, so the store calls this explicitly
 * only for local demo workspaces.
 */
/** Arabic counts agree with their number: one, two, 3–10 (plural) and 11+ (singular). */
function arabicCount(count: number, one: string, two: string, few: string, many: string): string {
  if (count === 1) return one;
  if (count === 2) return two;
  const tens = count % 100;
  return tens >= 3 && tens <= 10 ? `${count} ${few}` : `${count} ${many}`;
}

export function retainDemoHistory(input: Workspace): Workspace {
  const protectedTicketIds = new Set([
    ...input.taskTickets.filter((ticket) => ticket.status === "open").map((ticket) => ticket.id),
    ...input.noAnswerTickets.filter((ticket) => ticket.status === "open").map((ticket) => ticket.id),
    ...input.pendingWorkerCalls
      .filter((call) => call.state === "pending" || call.state === "no_answer_ticket")
      .flatMap((call) => [call.taskTicketId, ...(call.coveredTaskIds ?? [])])
      .filter((id): id is string => id !== null),
  ]);

  const recentCalls = [...input.calls]
    .sort((left, right) => Date.parse(right.at) - Date.parse(left.at))
    .slice(0, DEMO_CALL_RETENTION_LIMIT);
  const protectedCalls = input.calls.filter((call) => call.ticketId !== null && protectedTicketIds.has(call.ticketId));
  const keptCallIds = new Set([...recentCalls, ...protectedCalls].map((call) => call.id));
  const protectedReportIds = new Set(protectedCalls.flatMap((call) => call.reportId ? [call.reportId] : []));

  const recentReports = [...input.reports]
    .sort((left, right) => Date.parse(right.at) - Date.parse(left.at))
    .slice(0, DEMO_REPORT_RETENTION_LIMIT);
  const keptReportIds = new Set([...recentReports.map((report) => report.id), ...protectedReportIds]);

  if (keptCallIds.size === input.calls.length && keptReportIds.size === input.reports.length) return input;
  return {
    ...input,
    calls: input.calls.filter((call) => keptCallIds.has(call.id)),
    reports: input.reports.filter((report) => keptReportIds.has(report.id)),
  };
}

/** @internal Shared with reportCalls.ts. */
export function pushEvent(ws: Workspace, at: Date, tone: EventTone, text: LocalizedText) {
  ws.events.push({ id: uid("evt"), at: iso(at), tone, text });
  if (ws.events.length > 200) ws.events.splice(0, ws.events.length - 200);
}

/** @internal Shared with reportCalls.ts. */
export function pushCall(ws: Workspace, call: Omit<CallLog, "id">): CallLog {
  const full = { id: uid("call"), ...call };
  ws.calls.push(full);
  return full;
}

// ───────────────────────── Worker reporting (Phases 2–3) ─────────────────────────

export function completeWorkerReport(
  input: Workspace,
  now: Date,
  draft: ReportDraft,
  /** The NAQAH → worker report call this conversation belongs to. Omit for a worker returning a missed call. */
  reportCallId?: string | null,
): { ws: Workspace; report: FarmReport } {
  const issue = reportDraftIssue(draft);
  if (issue) throw new Error(`Invalid report draft: ${issue}`);
  draft = coveredReportDraft(draft);
  const ws = clone(input);
  const at = iso(now);
  const run = reportCallId ? ws.reportCalls?.find((r) => r.id === reportCallId) : undefined;

  for (const u of draft.camelUpdates) {
    const c = ws.camels.find((x) => x.id === u.camelId);
    if (!c) continue;
    Object.assign(c, { health: u.health, healthNote: u.note, certainty: u.certainty, updatedAt: at });
  }
  // Camels not mentioned are reported as fine by the herd-health answer only when the
  // worker said so; the conversation engine adds explicit updates for that case.

  for (const u of draft.resourceUpdates) {
    const r = ws.resources.find((x) => x.kind === u.kind);
    if (!r || !r.present) continue;
    Object.assign(r, { level: u.level, quantity: u.quantity, note: u.note, certainty: u.certainty, updatedAt: at });
  }

  // Basic has no tasks to confirm, whatever a draft carries.
  const confirmations = ws.settings.plan === "ultimate" ? draft.taskConfirmations : [];
  for (const t of confirmations) {
    const ticket = ws.taskTickets.find((x) => x.id === t.taskId && x.status === "open");
    if (ticket && t.done) {
      Object.assign(ticket, { status: "closed", closedAt: at, closedVia: "worker_report" as CallKind });
      stopVerificationRetries(ws, ticket.id);
    }
  }

  const findings = evaluateFindings(input, draft);
  const call = pushCall(ws, {
    kind: "worker_report",
    direction: run ? "outbound" : "inbound",
    party: "worker",
    at,
    outcome: "completed",
    attempt: run ? run.attempts.length || null : null,
    summary: findings.length
      ? { ar: `تحديث مكتمل — ${arabicCount(findings.length, "ملاحظة مهمة واحدة", "ملاحظتين مهمتين", "ملاحظات مهمة", "ملاحظة مهمة")}`, en: `Update completed — ${findings.length} important ${findings.length === 1 ? "finding" : "findings"}` }
      : { ar: "تحديث مكتمل — لا ملاحظات مهمة", en: "Update completed — nothing important flagged" },
    ticketId: null,
    reportId: null,
  });
  const report: FarmReport = { id: uid("rep"), at, callId: call.id, answers: draft.answers, findings };
  if (draft.mode !== undefined) report.mode = draft.mode;
  if (draft.coverage !== undefined) report.coverage = structuredClone(draft.coverage);
  if (draft.herdCount !== undefined && draft.herdCount !== null) report.herdCountReported = draft.herdCount;
  call.reportId = report.id;
  // The report is in, whichever way it arrived: no open report call should ring again, and a missed
  // run the worker is returning is answered by this report.
  const returned = run ? undefined : returnableReportRun(ws, new Date(at));
  for (const r of ws.reportCalls ?? []) {
    if (r !== run && r !== returned && r.state !== "calling" && r.state !== "answered") continue;
    Object.assign(r, { state: "completed", nextAttemptAt: null, reportId: report.id });
  }
  ws.reports.push(report);
  ws.lastUpdateAt = at;

  pushEvent(ws, now, "success", {
    ar: `حُفظ تحديث العزبة من ${ws.settings.worker.name} (${arabicCount(draft.answers.length, "إجابة واحدة", "إجابتين", "إجابات", "إجابة")})`,
    en: `Farm update saved from ${ws.settings.worker.name} (${draft.answers.length} answers)`,
  });
  const closed = confirmations.filter((t) => t.done).length;
  if (closed)
    pushEvent(ws, now, "success", {
      ar: `أُغلقت ${closed} مهمة بعد تأكيد العامل`,
      en: `${closed} task ${closed === 1 ? "ticket" : "tickets"} closed after the worker confirmed`,
    });
  if (findings.length)
    pushEvent(ws, now, "attention", {
      ar: `رُصدت ${arabicCount(findings.length, "ملاحظة واحدة تطابق", "ملاحظتين تطابقان", "ملاحظات تطابق", "ملاحظة تطابق")} معايير المالك`,
      en: `${findings.length} ${findings.length === 1 ? "finding matches" : "findings match"} the owner's criteria`,
    });
  return { ws, report };
}

/**
 * wait_for_call: the worker called in without a report call to return; NAQAH calls them at the scheduled time.
 * outside_window / no_window are RETIRED (old worker-calls-in window) and kept only for stored history.
 */
export type RejectReason = "wait_for_call" | "weekly_done" | "daily_done" | "outside_window" | "no_window";

export function rejectWorkerReport(input: Workspace, now: Date, reason: RejectReason): Workspace {
  const ws = clone(input);
  const text: Record<RejectReason, LocalizedText> = {
    wait_for_call: { ar: "ناقة تتصل بالعامل في موعد التقرير", en: "NAQAH calls the worker at the report time" },
    outside_window: { ar: "خارج نافذة التقرير الأسبوعية", en: "Outside the weekly reporting window" },
    weekly_done: { ar: "تقرير هذا الأسبوع مكتمل", en: "This week's report is already complete" },
    daily_done: { ar: "تقرير اليوم مكتمل", en: "Today's report is already complete" },
    no_window: { ar: "لم تُحدَّد نافذة التقرير", en: "No reporting window configured" },
  };
  pushCall(ws, {
    kind: "worker_report_rejected",
    direction: "inbound",
    party: "worker",
    at: iso(now),
    outcome: "rejected",
    attempt: null,
    summary: text[reason],
    ticketId: null,
    reportId: null,
  });
  pushEvent(ws, now, "neutral", {
    ar: `لم يُقبل اتصال التقرير: ${text[reason].ar}`,
    en: `Report call not accepted: ${text[reason].en}`,
  });
  return ws;
}

// ───────────────────────── Owner calls (Phases 4–5) ─────────────────────────

/** `reportId` null: the call told the owner that no verified report has arrived. */
export function recordOwnerNotification(input: Workspace, now: Date, reportId: string | null, answered: boolean, occurrence: Date = now): Workspace {
  const ws = clone(input);
  pushCall(ws, {
    kind: "owner_notification",
    direction: "outbound",
    party: "owner",
    at: iso(now),
    outcome: answered ? "completed" : "no_answer",
    attempt: null,
    summary: answered
      ? reportId
        ? { ar: "أُبلغ المالك بالتحديث", en: "Owner briefed on the update" }
        : { ar: "أُبلغ المالك أنه ما وصل تقرير مؤكد", en: "Owner told that no verified report has arrived" }
      : reportId
        ? { ar: "مكالمة فائتة — تشير إلى وصول تحديث", en: "Missed call — signals that an update arrived" }
        : { ar: "مكالمة فائتة — ما وصل تقرير مؤكد", en: "Missed call — no verified report has arrived" },
    ticketId: null,
    reportId,
  });
  if (answered) {
    if (ws.settings.plan === "basic") ws.ownerAllowanceUsedAt = iso(now);
    pushEvent(ws, now, "success", reportId
      ? { ar: "اتصلت ناقة بالمالك وأبلغته بالتحديث", en: "NAQAH called the owner with the update" }
      : { ar: "اتصلت ناقة بالمالك وأبلغته أنه ما وصل تقرير مؤكد", en: "NAQAH called the owner to say no verified report has arrived" });
  } else {
    ws.missedNotificationAt = iso(occurrence);
    pushEvent(ws, now, "neutral", {
      ar: "لم يرد المالك — يظهر له اتصال فائت ويمكنه مراجعة الموقع",
      en: "Owner didn't answer — a missed call shows, and the website has the details",
    });
  }
  return ws;
}

export function recordOwnerInquiry(
  input: Workspace,
  now: Date,
  mode: "unlimited" | "weekly" | "missed_callback",
): Workspace {
  const ws = clone(input);
  pushCall(ws, {
    kind: "owner_inquiry",
    ...(mode === "missed_callback" ? { reason: "missed_notification_callback" as const } : {}),
    direction: "inbound",
    party: "owner",
    at: iso(now),
    outcome: "completed",
    attempt: null,
    summary:
      mode === "missed_callback"
        ? { ar: "اتصال المالك بعد إشعار فائت", en: "Owner called back after a missed notification" }
        : { ar: "استفسار المالك عن حالة العزبة", en: "Owner asked about the farm" },
    ticketId: null,
    reportId: null,
  });
  if (ws.settings.plan === "basic") {
    ws.ownerAllowanceUsedAt = iso(now);
    if (mode === "missed_callback") ws.missedNotificationAt = null;
  }
  pushEvent(ws, now, "neutral", {
    ar: "أجاب المساعد المالك بآخر معلومات محفوظة وتوقيتها",
    en: "The agent answered the owner with the latest stored information and its time",
  });
  return ws;
}

export function rejectOwnerInquiry(input: Workspace, now: Date): Workspace {
  const ws = clone(input);
  pushCall(ws, {
    kind: "owner_inquiry_rejected",
    direction: "inbound",
    party: "owner",
    at: iso(now),
    outcome: "rejected",
    attempt: null,
    summary: { ar: "استُخدم رصيد مكالمة هذا الأسبوع", en: "This week's owner call is already used" },
    ticketId: null,
    reportId: null,
  });
  pushEvent(ws, now, "neutral", {
    ar: "باقة أساسية: مكالمة المالك الأسبوعية مستخدمة",
    en: "Basic plan: the weekly owner call is already used",
  });
  return ws;
}

// ───────────────────────── Owner instructions (Phase 6) ─────────────────────────

export interface InstructionInput {
  message: string;
  /** Does the request require the worker to perform an action? */
  actionable: boolean;
  /** Ultimate only: ISO time, or null for "any time". */
  scheduledFor: string | null;
}

/**
 * Basic: relay without a ticket. Ultimate + actionable: OPEN Task Ticket.
 * Information-only: no ticket. In all cases an immediate AI → worker call is triggered.
 */
export function submitOwnerInstruction(
  input: Workspace,
  now: Date,
  instr: InstructionInput,
): { ws: Workspace; pendingCallId: string | null; taskId: string | null } {
  if (input.settings.plan !== "ultimate") return { ws: clone(input), pendingCallId: null, taskId: null };
  const ws = clone(input);
  const at = iso(now);
  let taskId: string | null = null;
  let relayId: string | null = null;

  if (ws.settings.plan === "ultimate" && instr.actionable) {
    taskId = uid("tsk");
    ws.taskTickets.push({
      id: taskId,
      instruction: instr.message,
      createdAt: at,
      scheduledFor: instr.scheduledFor,
      status: "open",
      closedAt: null,
      closedVia: null,
    });
    pushEvent(ws, now, "attention", {
      ar: `فُتحت مهمة جديدة: «${instr.message}»`,
      en: `Task ticket opened: “${instr.message}”`,
    });
  } else {
    relayId = uid("rly");
    ws.relays.push({ id: relayId, at, message: instr.message, delivered: false });
    pushEvent(ws, now, "neutral", {
      ar: `رسالة المالك ستُنقل للعامل بدون تذكرة: «${instr.message}»`,
      en: `Owner's message will be relayed without a ticket: “${instr.message}”`,
    });
  }

  const pending: PendingWorkerCall = {
    id: uid("pwc"),
    purpose: "instruction",
    message: instr.message,
    taskTicketId: taskId,
    relayId,
    attempts: [],
    nextAttemptAt: at,
    state: "pending",
  };
  ws.pendingWorkerCalls.push(pending);
  return { ws, pendingCallId: pending.id, taskId };
}

/**
 * Approved instructions from one owner conversation.
 * Each Ultimate actionable item gets its own Task Ticket. Information is relayed on the same call.
 * Basic does not collect instructions and creates nothing.
 * All of them go out on one worker call, and a repeated batchId changes nothing.
 */
export function submitOwnerInstructionBatch(
  input: Workspace,
  now: Date,
  instructions: InstructionInput[],
  batchId: string,
  deliveryMessage?: string,
): { ws: Workspace; pendingCallId: string | null; taskIds: string[]; created: boolean } {
  if (input.settings.plan !== "ultimate") {
    return { ws: clone(input), pendingCallId: null, taskIds: [], created: false };
  }
  const existing = input.pendingWorkerCalls.find((call) => call.batchId === batchId);
  if (existing) {
    return { ws: clone(input), pendingCallId: existing.id, taskIds: existing.coveredTaskIds ?? [], created: false };
  }
  if (!batchId.trim() || instructions.length === 0 || instructions.some((item) => !item.message.trim())) {
    return { ws: clone(input), pendingCallId: null, taskIds: [], created: false };
  }

  const ws = clone(input);
  const at = iso(now);
  const taskIds: string[] = [];
  const relayed: string[] = [];
  for (const instr of instructions) {
    if (ws.settings.plan === "ultimate" && instr.actionable) {
      const taskId = uid("tsk");
      taskIds.push(taskId);
      ws.taskTickets.push({
        id: taskId,
        instruction: instr.message,
        createdAt: at,
        scheduledFor: instr.scheduledFor,
        status: "open",
        closedAt: null,
        closedVia: null,
      });
      pushEvent(ws, now, "attention", {
        ar: `فُتحت مهمة جديدة: «${instr.message}»`,
        en: `Task ticket opened: “${instr.message}”`,
      });
    } else {
      relayed.push(instr.message);
    }
  }

  let relayId: string | null = null;
  if (relayed.length) {
    relayId = uid("rly");
    ws.relays.push({ id: relayId, at, message: relayed.join("\n"), delivered: false });
    pushEvent(ws, now, "neutral", {
      ar: "رسالة المالك ستُنقل للعامل بدون تذكرة",
      en: "Owner's message will be relayed without a ticket",
    });
  }

  const pending: PendingWorkerCall = {
    id: uid("pwc"),
    purpose: "instruction",
    message: deliveryMessage?.trim() || instructions.map((item) => item.message).join("\n"),
    taskTicketId: taskIds.length === 1 ? taskIds[0] : null,
    relayId,
    attempts: [],
    nextAttemptAt: at,
    state: "pending",
    batchId,
    coveredTaskIds: taskIds,
  };
  ws.pendingWorkerCalls.push(pending);
  return { ws, pendingCallId: pending.id, taskIds, created: true };
}

/**
 * Phase 7/8: at a task's scheduled time the AI calls the worker to verify completion.
 * Tasks due at the same moment share one call. A task joins only before that call is first
 * dialled; one whose instruction arrived later gets its own call, with its own three attempts.
 * A repeated start returns the task's call and does not add another. Basic has no verification.
 */
export function startTaskVerification(input: Workspace, now: Date, taskId: string): { ws: Workspace; pendingCallId: string | null } {
  if (input.settings.plan !== "ultimate") return { ws: clone(input), pendingCallId: null };
  const existing = input.pendingWorkerCalls.find(
    (call) => call.purpose === "task_verification" && coveredTasks(call).includes(taskId),
  );
  if (existing) return { ws: clone(input), pendingCallId: existing.id };
  const ws = clone(input);
  const task = ws.taskTickets.find((t) => t.id === taskId);
  const dueAt = (id: string) => {
    const scheduledFor = ws.taskTickets.find((t) => t.id === id)?.scheduledFor;
    return scheduledFor ? Date.parse(scheduledFor) : null;
  };
  const group = ws.pendingWorkerCalls.find(
    (call) =>
      call.purpose === "task_verification" &&
      call.state === "pending" &&
      call.attempts.length === 0 &&
      call.nextAttemptAt !== null &&
      Date.parse(call.nextAttemptAt) <= now.getTime() &&
      dueAt(taskId) !== null &&
      coveredTasks(call).some((id) => dueAt(id) === dueAt(taskId)),
  );
  if (group) {
    group.coveredTaskIds = [...coveredTasks(group), taskId];
    group.taskTicketId = null;
    group.message = `${group.message}\n${task?.instruction ?? ""}`;
    return { ws, pendingCallId: group.id };
  }
  const pending: PendingWorkerCall = {
    id: uid("pwc"),
    purpose: "task_verification",
    message: task?.instruction ?? "",
    taskTicketId: taskId,
    relayId: null,
    attempts: [],
    nextAttemptAt: iso(now),
    state: "pending",
    coveredTaskIds: [taskId],
  };
  ws.pendingWorkerCalls.push(pending);
  return { ws, pendingCallId: pending.id };
}

const WORKER_DIAL_LOCK_MS = 2 * 60 * 60 * 1000;
const WORKER_PLACEMENT_UNKNOWN_MS = 15 * MINUTE;

/**
 * Start due verifications, then reserve the next due worker call so a second scheduler pass cannot dial it.
 * The reservation is not an attempt. Twilio's status callback or an expired claim records it.
 */
export function claimDueWorkerCall(input: Workspace, now: Date): { ws: Workspace; pendingCallId: string | null; attempt: number } {
  let ws = clone(input);
  for (const call of input.pendingWorkerCalls) {
    if (call.state !== "pending" || !call.dialClaimedAt || !call.nextAttemptAt || Date.parse(call.nextAttemptAt) > now.getTime()) continue;
    ws = resolveWorkerCallAttempt(ws, now, call.id, "unanswered").ws;
  }
  for (const task of dueTaskVerifications(ws, now)) ws = startTaskVerification(ws, now, task.id).ws;
  // The worker's phone is one line: a second call now would ring busy and waste one of its three attempts.
  const onTheLine = (ws.reportCalls ?? []).some((run) => run.state === "answered" || (run.state === "calling" && run.attempts.at(-1)?.result === "pending"));
  if (onTheLine) return { ws, pendingCallId: null, attempt: 0 };
  const call = dueWorkerCalls(ws, now)[0];
  if (!call) return { ws, pendingCallId: null, attempt: 0 };
  call.dialClaimedAt = iso(now);
  call.nextAttemptAt = new Date(now.getTime() + WORKER_DIAL_LOCK_MS).toISOString();
  return { ws, pendingCallId: call.id, attempt: call.attempts.length + 1 };
}

export function markWorkerCallPlacementUnknown(input: Workspace, pendingCallId: string, attempt: number, now: Date): Workspace {
  const current = input.pendingWorkerCalls.find((call) => call.id === pendingCallId);
  if (current?.state !== "pending" || Date.parse(current.dialClaimedAt ?? "") !== now.getTime() || current.attempts.length + 1 !== attempt) return input;
  const ws = clone(input);
  ws.pendingWorkerCalls.find((call) => call.id === pendingCallId)!.nextAttemptAt = new Date(now.getTime() + WORKER_PLACEMENT_UNKNOWN_MS).toISOString();
  return ws;
}

/** Release a reservation when the provider never placed the call. */
export function releaseWorkerCallClaim(input: Workspace, pendingCallId: string, now: Date): Workspace {
  const ws = clone(input);
  const call = ws.pendingWorkerCalls.find((item) => item.id === pendingCallId && item.state === "pending");
  if (!call) return ws;
  if (call.dialClaimedAt) call.dialClaimedAt = null;
  // The attempt never happened, so it isn't counted, but the provider isn't asked again on the very next tick.
  call.nextAttemptAt = new Date(now.getTime() + RETRY_DELAY_MS).toISOString();
  pushEvent(ws, now, "attention", {
    ar: `تعذر على ناقة الاتصال بـ${ws.settings.worker.name} — تحاول مرة ثانية بعد ${RETRY_DELAY_MS / MINUTE} دقيقة`,
    en: `NAQAH couldn't place the call to ${ws.settings.worker.name} — it will try again in ${RETRY_DELAY_MS / MINUTE} minutes`,
  });
  return ws;
}

/**
 * The owner asks NAQAH to try an undelivered call again. The same call goes back in the queue, with
 * its message and tasks, so nothing is created twice and pressing it twice changes nothing.
 */
export function retryUndeliveredCall(input: Workspace, now: Date, pendingCallId: string): Workspace {
  if (!undeliveredCalls(input).some((call) => call.id === pendingCallId)) return input;
  const ws = clone(input);
  const call = ws.pendingWorkerCalls.find((item) => item.id === pendingCallId)!;
  call.state = "pending";
  call.retryBase = call.attempts.length;
  call.nextAttemptAt = iso(now);
  pushEvent(ws, now, "neutral", {
    ar: `بتحاول ناقة توصل التعليمات لـ${ws.settings.worker.name} مرة ثانية`,
    en: `NAQAH will try again to reach ${ws.settings.worker.name}`,
  });
  return ws;
}

export type AttemptOutcome = "delivered" | "retry_scheduled" | "no_answer_ticket";

/**
 * How a worker call ended.
 * Picking up is not delivery. `interrupted` means the worker answered and the call ended
 * before the instructions were confirmed or the verification question was answered.
 */
export type WorkerAttemptResult = "unanswered" | "interrupted" | "delivered";

/**
 * Record one AI → worker call attempt.
 * An unsuccessful attempt, including a hang-up before the required outcome, waits 20 minutes.
 * The third unsuccessful attempt stops. No new No Answer Ticket is created.
 * Open tasks and undelivered instructions stay as they are.
 * The stored state name `no_answer_ticket` is the existing database value for an exhausted call.
 * It does not insert a ticket.
 */
export function resolveWorkerCallAttempt(
  input: Workspace,
  now: Date,
  pendingCallId: string,
  result: WorkerAttemptResult,
): { ws: Workspace; outcome: AttemptOutcome } {
  const ws = clone(input);
  const call = ws.pendingWorkerCalls.find((c) => c.id === pendingCallId);
  if (!call || call.state !== "pending") return { ws, outcome: "delivered" };
  if (call.dialClaimedAt) call.dialClaimedAt = null;
  const at = iso(now);
  const answered = result !== "unanswered";
  call.attempts.push({ at, answered });
  const attempt = call.attempts.length;
  const kind: CallKind = call.purpose === "instruction" ? "worker_instruction" : "worker_task_verification";

  if (result === "delivered") {
    call.state = "delivered";
    call.nextAttemptAt = null;
    if (call.relayId) {
      const relay = ws.relays.find((r) => r.id === call.relayId);
      if (relay) relay.delivered = true;
    }
    pushCall(ws, {
      kind,
      direction: "outbound",
      party: "worker",
      at,
      outcome: "completed",
      attempt,
      summary:
        call.purpose === "instruction"
          ? { ar: `وصلت التعليمات للعامل: «${call.message}»`, en: `Instruction delivered: “${call.message}”` }
          : { ar: `سُئل العامل عن المهمة: «${call.message}»`, en: `Worker asked about the task: “${call.message}”` },
      ticketId: call.taskTicketId,
      reportId: null,
    });
    pushEvent(ws, now, "success", {
      ar: call.purpose === "instruction" ? "رد العامل ووصلته التعليمات" : "رد العامل على مكالمة التحقق",
      en: call.purpose === "instruction" ? "Worker answered and received the instruction" : "Worker answered the verification call",
    });
    return { ws, outcome: "delivered" };
  }

  pushCall(ws, {
    kind,
    direction: "outbound",
    party: "worker",
    at,
    outcome: "no_answer",
    attempt,
    summary: result === "interrupted"
      ? { ar: `انقطع الاتصال قبل اكتمال التسليم (المحاولة ${attempt})`, en: `The call ended before delivery was confirmed (attempt ${attempt})` }
      : { ar: `لم يرد العامل (المحاولة ${attempt})`, en: `Worker didn't answer (attempt ${attempt})` },
    ticketId: call.taskTicketId,
    reportId: null,
  });

  const inRound = attempt - (call.retryBase ?? 0);
  if (inRound <= MAX_RETRIES) {
    call.nextAttemptAt = new Date(now.getTime() + RETRY_DELAY_MS).toISOString();
    pushEvent(ws, now, "neutral", result === "interrupted"
      ? {
          ar: `انقطع الاتصال — إعادة المحاولة بعد ${RETRY_DELAY_MS / MINUTE} دقيقة (${inRound}/${MAX_RETRIES + 1})`,
          en: `The call ended early — retrying in ${RETRY_DELAY_MS / MINUTE} minutes (${inRound}/${MAX_RETRIES + 1})`,
        }
      : {
          ar: `لم يرد العامل — إعادة المحاولة بعد ${RETRY_DELAY_MS / MINUTE} دقيقة (${inRound}/${MAX_RETRIES + 1})`,
          en: `Worker didn't answer — retrying in ${RETRY_DELAY_MS / MINUTE} minutes (${inRound}/${MAX_RETRIES + 1})`,
        });
    return { ws, outcome: "retry_scheduled" };
  }

  call.state = "no_answer_ticket";
  call.nextAttemptAt = null;
  pushEvent(ws, now, "attention", {
    ar: "توقفت إعادة الاتصال بعد ٣ محاولات. التعليمات لم تصل، والمهام المفتوحة تبقى مفتوحة.",
    en: "Automatic calls stopped after 3 attempts. Instructions were not delivered, and open tasks stay open.",
  });
  return { ws, outcome: "no_answer_ticket" };
}

/** A call with no open task left has nothing to verify, so its retries stop. */
function stopVerificationRetries(ws: Workspace, taskId: string) {
  for (const call of ws.pendingWorkerCalls) {
    if (call.purpose !== "task_verification" || call.state !== "pending" || !coveredTasks(call).includes(taskId)) continue;
    if (openCoveredTasks(ws, call).length === 0) Object.assign(call, { state: "delivered", nextAttemptAt: null });
  }
}

/** Phase 8: only an explicit confirmation closes a Task Ticket. Deadlines never close it. */
export function confirmTask(input: Workspace, now: Date, taskId: string, done: boolean, via: CallKind): Workspace {
  const ws = clone(input);
  const t = ws.taskTickets.find((x) => x.id === taskId);
  if (!t || t.status !== "open" || ws.settings.plan !== "ultimate") return ws;
  if (done) {
    Object.assign(t, { status: "closed", closedAt: iso(now), closedVia: via });
    stopVerificationRetries(ws, t.id);
    pushEvent(ws, now, "success", {
      ar: `أكد العامل إنجاز المهمة — نُقلت للسجل: «${t.instruction}»`,
      en: `Worker confirmed the task — moved to History: “${t.instruction}”`,
    });
  } else {
    pushEvent(ws, now, "neutral", {
      ar: `المهمة لم تكتمل بعد — تبقى مفتوحة: «${t.instruction}»`,
      en: `Task not done yet — it stays open: “${t.instruction}”`,
    });
  }
  return ws;
}

/**
 * Phase 9: the worker returns a missed AI call. Always answered, even outside
 * Basic's window. Delivers what was missed and closes the No Answer Ticket(s).
 * Does NOT update farm information or consume a reporting update.
 */
export function completeWorkerCallback(input: Workspace, now: Date): Workspace {
  const ws = clone(input);
  const at = iso(now);
  const open = ws.noAnswerTickets.filter((t) => t.status === "open");
  if (!open.length) return ws;
  for (const t of open) {
    Object.assign(t, { status: "closed", closedAt: at });
    for (const c of ws.pendingWorkerCalls) {
      if (c.state === "no_answer_ticket" && c.message === t.message && c.relayId) {
        const relay = ws.relays.find((r) => r.id === c.relayId);
        if (relay) relay.delivered = true;
      }
    }
  }
  pushCall(ws, {
    kind: "worker_callback",
    direction: "inbound",
    party: "worker",
    at,
    outcome: "completed",
    attempt: null,
    summary: { ar: `اتصل العامل ووصلته ${open.length} رسالة فائتة`, en: `Worker called back; ${open.length} missed message(s) delivered` },
    ticketId: open[0]?.id ?? null,
    reportId: null,
  });
  pushEvent(ws, now, "success", {
    ar: "أُغلقت تذكرة عدم الرد بعد اتصال العامل",
    en: "No Answer Ticket closed after the worker called back",
  });
  return ws;
}

// ───────────────────────── Demo clock ─────────────────────────

export function advanceClock(input: Workspace, ms: number): Workspace {
  return { ...input, clockOffsetMs: input.clockOffsetMs + ms };
}

export function setClockTo(input: Workspace, target: Date, realNow = Date.now()): Workspace {
  return { ...input, clockOffsetMs: target.getTime() - realNow };
}
