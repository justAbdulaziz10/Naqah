/**
 * Read models for what the owner should act on. Alerts and instructions are views over reports,
 * tickets and relays: they have no storage of their own, so they can never disagree with them.
 */
import { openNoAnswerTickets, overdueScheduledTasks } from "./rules";
import type { LocalizedText, Workspace } from "./types";

export type FarmAlert =
  | { kind: "finding"; id: string; at: string; text: LocalizedText }
  | { kind: "no_answer"; id: string; at: string; message: string }
  | { kind: "overdue_task"; id: string; at: string; message: string };

export type FarmInstruction =
  | { kind: "relay"; id: string; at: string; message: string; status: "pending" | "delivered" }
  | { kind: "task"; id: string; at: string; message: string; status: "open" | "closed"; scheduledFor: string | null };

const newestFirst = <T extends { at: string }>(items: T[]) =>
  items.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

export function farmAlerts(ws: Workspace, now: Date): FarmAlert[] {
  const latest = ws.reports.at(-1);
  return newestFirst<FarmAlert>([
    ...(latest?.findings ?? []).map((f) => ({ kind: "finding" as const, id: f.id, at: latest!.at, text: f.text })),
    ...openNoAnswerTickets(ws).map((t) => ({ kind: "no_answer" as const, id: t.id, at: t.createdAt, message: t.message })),
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
