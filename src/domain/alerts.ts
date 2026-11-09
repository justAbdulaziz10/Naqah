/**
 * Read models for what the owner should act on. Alerts and instructions are views over reports,
 * tickets and relays: they have no storage of their own, so they can never disagree with them.
 */
import { overdueScheduledTasks } from "./rules";
import type { LocalizedText, PendingWorkerCall, Workspace } from "./types";

export type FarmAlert =
  | { kind: "finding"; id: string; at: string; text: LocalizedText }
  | { kind: "undelivered"; id: string; at: string; message: string }
  | { kind: "overdue_task"; id: string; at: string; message: string };

export type FarmInstruction =
  | { kind: "relay"; id: string; at: string; message: string; status: "pending" | "delivered" }
  | { kind: "task"; id: string; at: string; message: string; status: "open" | "closed"; scheduledFor: string | null };

/** A worker call NAQAH gave up on after its attempts. What it carried never reached the worker. */
export interface UndeliveredCall {
  id: string;
  purpose: PendingWorkerCall["purpose"];
  message: string;
  attempts: number;
  lastAttemptAt: string;
  /** The tasks it carried that are still open. */
  taskIds: string[];
  relayId: string | null;
}

const lastAttemptTime = (call: PendingWorkerCall) => Date.parse(call.attempts.at(-1)?.at ?? "");
const callTaskIds = (call: PendingWorkerCall) => call.coveredTaskIds ?? (call.taskTicketId ? [call.taskTicketId] : []);

/**
 * Exhausted worker calls that still matter, newest first. `no_answer_ticket` is only the stored name
 * for an exhausted call. Old rows are read here too: a No Answer Ticket the worker closed by calling
 * back means the message arrived. Ultimate only, because Basic has no instructions or tasks.
 */
export function undeliveredCalls(ws: Workspace): UndeliveredCall[] {
  if (ws.settings.plan !== "ultimate") return [];
  const openTasks = new Set(ws.taskTickets.filter((task) => task.status === "open").map((task) => task.id));
  const closedByCallback = (call: PendingWorkerCall) =>
    (ws.noAnswerTickets ?? []).some(
      (ticket) =>
        ticket.status === "closed" &&
        ticket.purpose === call.purpose &&
        ticket.taskTicketId === call.taskTicketId &&
        ticket.message === call.message &&
        Date.parse(ticket.createdAt) === lastAttemptTime(call),
    );
  const supersededBy = (call: PendingWorkerCall, taskIds: string[]) =>
    ws.pendingWorkerCalls.some(
      (later) =>
        later.id !== call.id &&
        later.purpose === call.purpose &&
        later.state !== "no_answer_ticket" &&
        (!later.attempts.length || lastAttemptTime(later) > lastAttemptTime(call)) &&
        callTaskIds(later).some((id) => taskIds.includes(id)),
    );

  return ws.pendingWorkerCalls
    .filter((call) => call.state === "no_answer_ticket" && call.attempts.length > 0 && !closedByCallback(call))
    .flatMap((call) => {
      const linked = callTaskIds(call);
      const taskIds = linked.filter((id) => openTasks.has(id));
      if (linked.length && !taskIds.length) return [];
      if (call.relayId && ws.relays.find((relay) => relay.id === call.relayId)?.delivered !== false) return [];
      if (supersededBy(call, taskIds)) return [];
      return [{
        id: call.id,
        purpose: call.purpose,
        message: call.message,
        attempts: call.attempts.length,
        lastAttemptAt: call.attempts.at(-1)!.at,
        taskIds,
        relayId: call.relayId,
      }];
    })
    .sort((a, b) => Date.parse(b.lastAttemptAt) - Date.parse(a.lastAttemptAt));
}

const newestFirst = <T extends { at: string }>(items: T[]) =>
  items.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

export function farmAlerts(ws: Workspace, now: Date): FarmAlert[] {
  const latest = ws.reports.at(-1);
  return newestFirst<FarmAlert>([
    ...(latest?.findings ?? []).map((f) => ({ kind: "finding" as const, id: f.id, at: latest!.at, text: f.text })),
    ...undeliveredCalls(ws).map((call) => ({ kind: "undelivered" as const, id: call.id, at: call.lastAttemptAt, message: call.message })),
    ...overdueScheduledTasks(ws, now).map((t) => ({
      kind: "overdue_task" as const,
      id: t.id,
      at: t.scheduledFor ?? t.createdAt,
      message: t.instruction,
    })),
  ]);
}

export function farmInstructions(ws: Workspace): FarmInstruction[] {
  return newestFirst<FarmInstruction>([
    ...ws.relays.map((r) => ({
      kind: "relay" as const,
      id: r.id,
      at: r.at,
      message: r.message,
      status: r.delivered ? ("delivered" as const) : ("pending" as const),
    })),
    ...ws.taskTickets.map((t) => ({
      kind: "task" as const,
      id: t.id,
      at: t.createdAt,
      message: t.instruction,
      status: t.status,
      scheduledFor: t.scheduledFor,
    })),
  ]);
}
