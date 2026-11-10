import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { claimDueWorkerCall } from "@/domain/actions";
import { createEmptyWorkspace } from "@/domain/seed";
import type { Workspace } from "@/domain/types";
import type { VoiceSessionRow } from "@/server/db/voice-sessions";
import type { VoiceEvent, VoiceContext } from "./contract";
import { eventAllowed, voiceStep } from "./contract";
import { answerFarmCall, answerWorkerCall, workerCallStatus } from "./farm-call";

/** One farm and one call in memory; saves run the real contract rules, once per event id. */
const db = vi.hoisted(() => ({ ws: null as unknown as Workspace, row: null as VoiceSessionRow | null, events: [] as { type: string; eventId: string }[], seen: new Set<string>() }));
vi.mock("server-only", () => ({}));
vi.mock("@/server/db/voice-sessions", async (original) => ({
  ...(await original<typeof import("@/server/db/voice-sessions")>()),
  readVoiceSession: async () => db.row,
  createVoiceSession: async (_client: unknown, row: VoiceSessionRow) => { db.row = { ...row, seq: 0, misses: 0 }; return db.row; },
  advanceVoiceSession: async (_client: unknown, _sid: string, seq: number, next: Partial<VoiceSessionRow>) => { db.row = { ...db.row!, ...next, seq: seq + 1 }; return db.row; },
  deleteVoiceSession: async () => { db.row = null; },
  deleteStaleVoiceSessions: async () => {},
}));
vi.mock("@/server/db/queries", async (original) => ({
  ...(await original<typeof import("@/server/db/queries")>()), loadFarm: async () => ({ workspace: db.ws }),
}));
vi.mock("./contract", async (original) => {
  const actual = await original<typeof import("./contract")>();
  return {
    ...actual,
    applyVoiceEvent: async (_client: unknown, _farm: string, context: VoiceContext, event: VoiceEvent, now: Date) => {
      if (!eventAllowed(context, event)) return { status: "rejected", reason: "not_allowed" };
      if (db.seen.has(event.eventId)) return { status: "unchanged" };
      db.seen.add(event.eventId);
      db.events.push({ type: event.type, eventId: event.eventId });
      const step = voiceStep(db.ws, now, event);
      db.ws = step.ws;
      return step.result;
    },
  };
});

const client = {} as SupabaseClient;
const FARM = "99999999-9999-4999-8999-999999999999";
const T1 = "11111111-1111-4111-8111-111111111111";
const T2 = "22222222-2222-4222-8222-222222222222";
const CALL = "33333333-3333-4333-8333-333333333333";
const now = new Date("2026-11-08T15:00:00.000Z");
const sid = (n: number) => `CA${String(n).repeat(32)}`;
const spoken = (twiml: string) => [...twiml.matchAll(/<Say\b[^>]*>([\s\S]*?)<\/Say>/g)].map((m) => m[1]).join(" ");

function farmWithTasks() {
  const ws = createEmptyWorkspace("ultimate");
  ws.setupComplete = true;
  ws.settings.worker.name = "Ahmed";
  ws.settings.owner.name = "Abdullah";
  ws.settings.worker.language = "en";
  for (const id of [T1, T2]) {
    ws.taskTickets.push({ id, instruction: id === T1 ? "Fix the gate" : "Refill the trough", createdAt: now.toISOString(), scheduledFor: now.toISOString(), status: "open", closedAt: null, closedVia: null });
  }
  return ws;
}

function claim() {
  const claimed = claimDueWorkerCall(db.ws, now);
  db.ws = {
    ...claimed.ws,
    pendingWorkerCalls: claimed.ws.pendingWorkerCalls.map((call) => (call.id === claimed.pendingCallId ? { ...call, id: CALL } : call)),
  };
  return { k: "worker" as const, f: FARM, p: CALL, n: claimed.attempt, l: "en" as const, t: now.getTime() };
}

const call = () => db.ws.pendingWorkerCalls.find((item) => item.id === CALL)!;
const taskStatus = (id: string) => db.ws.taskTickets.find((task) => task.id === id)?.status;
const say = (callSid: string, seq: number, digits: string, at = now) => answerFarmCall(client, { callSid, seq, speech: "", digits, confidence: null, now: at });

beforeEach(() => {
  db.row = null;
  db.events = [];
  db.seen = new Set();
  db.ws = farmWithTasks();
});

describe("a real verification call", () => {
  it("asks each task, saves each answer, and delivers on the last one", async () => {
    const token = claim();
    expect(spoken(await answerWorkerCall(client, { token, callSid: sid(1), now }))).toContain("Fix the gate");
    expect(spoken(await say(sid(1), 0, "1"))).toContain("Refill the trough");
    expect(taskStatus(T1)).toBe("closed");
    expect(call().state).toBe("pending");
    await say(sid(1), 1, "2");
    expect(call()).toMatchObject({ state: "delivered", attempts: [{ answered: true }] });
    expect(taskStatus(T2)).toBe("open");
    expect(db.events.map((event) => event.type)).toEqual(["task_confirmation", "worker_call_attempt"]);
    expect(db.row?.session.done).toBe(true);
    // Twilio's final status repeats the conversation's event id, so it records nothing more.
    await workerCallStatus(client, { token, callSid: sid(1), status: "completed", now });
    expect(call()).toMatchObject({ state: "delivered" });
    expect(call().attempts).toHaveLength(1);
  });

  it("counts a hang-up as interrupted, keeps the answer, and retries only what is open", async () => {
    const token = claim();
    await answerWorkerCall(client, { token, callSid: sid(1), now });
    await say(sid(1), 0, "1");
    await workerCallStatus(client, { token, callSid: sid(1), status: "completed", now });
    expect(call()).toMatchObject({ state: "pending", attempts: [{ answered: true }] });
    expect(taskStatus(T1)).toBe("closed");

    const retryAt = new Date(now.getTime() + 20 * 60_000);
    const next = { ...token, n: 2, t: retryAt.getTime() };
    const opening = spoken(await answerWorkerCall(client, { token: next, callSid: sid(2), now: retryAt }));
    expect(opening).toContain("Refill the trough");
    expect(opening).not.toContain("Fix the gate");
    await say(sid(2), 0, "2", retryAt);
    expect(call().state).toBe("delivered");
    expect(call().attempts).toHaveLength(2);
  });

  it("does not deliver when the worker doesn't know, and says so honestly", async () => {
    const token = claim();
    await answerWorkerCall(client, { token, callSid: sid(1), now });
    await say(sid(1), 0, "3");
    const last = spoken(await say(sid(1), 1, "1"));
    expect(last).toContain("call again in 20 minutes");
    expect(taskStatus(T1)).toBe("open");
    expect(taskStatus(T2)).toBe("closed");
    expect(call()).toMatchObject({ state: "pending", attempts: [{ answered: true }] });
  });

  it("ignores an answered webhook for a stale attempt, and a late status for it", async () => {
    const token = claim();
    await workerCallStatus(client, { token: { ...token, n: 2 }, callSid: sid(9), status: "no-answer", now });
    expect(call().attempts).toEqual([]);
    expect(await answerWorkerCall(client, { token: { ...token, n: 2 }, callSid: sid(9), now })).toContain("<Hangup/>");
  });

  it("treats a call nobody picked up as unanswered", async () => {
    const token = claim();
    await workerCallStatus(client, { token, callSid: sid(1), status: "no-answer", now });
    expect(call()).toMatchObject({ state: "pending", attempts: [{ answered: false }] });
  });

  it("hangs up on a Basic farm left with an old call", async () => {
    const token = claim();
    db.ws = { ...db.ws, settings: { ...db.ws.settings, plan: "basic" } };
    expect(await answerWorkerCall(client, { token, callSid: sid(1), now })).toContain("<Hangup/>");
  });
});

describe("a real instruction call", () => {
  beforeEach(() => {
    db.ws.taskTickets = [];
    db.ws.pendingWorkerCalls.push({ id: "pwc_1", purpose: "instruction", message: "Move Wadha to the shade", taskTicketId: null, relayId: null, attempts: [], nextAttemptAt: now.toISOString(), state: "pending" });
  });

  it("speaks the message, and delivers on the worker's receipt", async () => {
    const token = claim();
    const opening = spoken(await answerWorkerCall(client, { token, callSid: sid(1), now }));
    expect(opening).toContain("Move Wadha to the shade");
    expect(opening).not.toContain("no more worker calls");
    const last = await answerFarmCall(client, { callSid: sid(1), seq: 0, speech: "yes I heard them", digits: null, confidence: "0.9", now });
    expect(spoken(last)).not.toContain("no more worker calls");
    expect(call()).toMatchObject({ state: "delivered", attempts: [{ answered: true }] });
  });

  it("is interrupted when the call ends before the receipt, then exhausts without a ticket", async () => {
    let token = claim();
    await answerWorkerCall(client, { token, callSid: sid(1), now });
    await workerCallStatus(client, { token, callSid: sid(1), status: "completed", now });
    expect(call()).toMatchObject({ state: "pending", attempts: [{ answered: true }] });
    for (const [index, status] of ["no-answer", "completed"].entries()) {
      const at = new Date(now.getTime() + (index + 1) * 20 * 60_000);
      token = { ...token, n: index + 2, t: at.getTime() };
      await workerCallStatus(client, { token, callSid: sid(index + 2), status, now: at });
    }
    expect(call()).toMatchObject({ state: "no_answer_ticket", nextAttemptAt: null });
    expect(db.ws.noAnswerTickets).toEqual([]);
  });
});
