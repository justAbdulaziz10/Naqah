import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { claimDueOwnerCall } from "@/domain/ownerCalls";
import { createEmptyWorkspace } from "@/domain/seed";
import type { Plan, Workspace } from "@/domain/types";
import { signCallToken, verifyCallToken, type CallToken } from "@/server/calls/token";
import type { VoiceSessionRow } from "@/server/db/voice-sessions";
import { answerFarmCall, answerOwnerCall, ownerCallHeard, ownerCallStatus } from "./farm-call";

/** One farm in memory. Events are recorded by id, like voice_events: a repeat returns the first answer. */
const store = vi.hoisted(() => ({
  ws: null as unknown as Workspace,
  events: new Map<string, unknown>(),
  sessions: new Map<string, unknown>(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/server/db/queries", async (original) => ({
  ...(await original<typeof import("@/server/db/queries")>()),
  loadFarm: async () => ({ workspace: store.ws, revision: 1, farmId: FARM }),
}));
vi.mock("@/server/db/service-repository", async (original) => ({
  ...(await original<typeof import("@/server/db/service-repository")>()),
  runFarmAction: async (_client: unknown, _farm: string, action: (ws: Workspace) => { ws: Workspace; result: unknown }, options: { eventId?: string } = {}) => {
    if (options.eventId && store.events.has(options.eventId)) return { status: "replayed", result: store.events.get(options.eventId) };
    const { ws, result } = action(structuredClone(store.ws));
    store.ws = ws;
    if (options.eventId) store.events.set(options.eventId, result);
    return { status: "saved", result };
  },
}));
vi.mock("@/server/db/voice-sessions", () => ({
  readVoiceSession: async (_client: unknown, sid: string) => store.sessions.get(sid) ?? null,
  createVoiceSession: async (_client: unknown, row: Omit<VoiceSessionRow, "seq" | "misses">) => {
    const saved = { seq: 0, misses: 0, ...row };
    store.sessions.set(row.call_sid, saved);
    return saved;
  },
  advanceVoiceSession: async (_client: unknown, sid: string, seq: number, next: object) => {
    const saved = { ...(store.sessions.get(sid) as object), ...next, seq: seq + 1 };
    store.sessions.set(sid, saved);
    return saved;
  },
  deleteVoiceSession: async (_client: unknown, sid: string) => { store.sessions.delete(sid); },
  deleteStaleVoiceSessions: async () => {},
}));

const FARM = "11111111-1111-4111-8111-111111111111";
const RUN = "22222222-2222-4222-8222-222222222222";
const REPORT = "33333333-3333-4333-8333-333333333333";
const SECRET = "unit-test-voice-secret-at-least-32-bytes";
const CALL = `CA${"a".repeat(32)}`;
const client = {} as SupabaseClient;
const now = new Date("2026-11-12T15:00:00.000Z"); // Thursday 18:00 Riyadh
const later = new Date(now.getTime() + 60_000);

type OwnerToken = Extract<CallToken, { k: "owner" }>;
const token = (over: Partial<OwnerToken> = {}): OwnerToken => ({ k: "owner", f: FARM, o: RUN, r: REPORT, n: 1, l: "en", t: now.getTime(), ...over });

function ring(plan: Plan, reports = true) {
  const ws = createEmptyWorkspace(plan);
  ws.setupComplete = true;
  ws.settings.owner = { name: "Abdullah", phone: "+966550123344" };
  ws.settings.worker = { ...ws.settings.worker, name: "Ahmed", phone: "+966501234567" };
  ws.settings.ownerCallSchedule = { day: 4, time: "18:00" };
  ws.ownerCallRun = null;
  if (reports) ws.reports = [{ id: REPORT, at: "2026-11-12T14:05:00.000Z", callId: "c", findings: [], answers: [] }];
  const { ws: claimed } = claimDueOwnerCall(ws, now);
  claimed.ownerCallRun!.id = RUN;
  store.ws = claimed;
}

const run = () => store.ws.ownerCallRun!;
const notifications = () => store.ws.calls.filter((call) => call.kind === "owner_notification");

beforeEach(() => {
  vi.stubEnv("NAQAH_VOICE_SECRET", SECRET);
  vi.stubEnv("NAQAH_VOICE_LOCALE", "en");
  store.events.clear();
  store.sessions.clear();
});
afterEach(() => vi.unstubAllEnvs());

describe("Basic: the summary played to the end", () => {
  it("marks the call answered, speaks the summary, then redirects", async () => {
    ring("basic");
    const xml = await answerOwnerCall(client, { token: token(), callSid: CALL, now });
    expect(run().state).toBe("answered");
    expect(xml).toContain("Ahmed reported today at 5:05 PM.");
    expect(xml).toContain("That&apos;s all I have.");
    expect(xml).toMatch(/<Redirect method="POST">\/api\/voice\/owner\/heard\?s=/);
    expect(xml).not.toContain("<Hangup/>");
    const signed = decodeURIComponent(xml.match(/heard\?s=([^<]+)</)![1].replaceAll("&amp;", "&"));
    expect(verifyCallToken(signed, SECRET, now.getTime())).toEqual(token());
    expect(run().attempts[0].result).toBe("pending");
  });

  it("completes only when Twilio reaches the redirect, and hangs up", async () => {
    ring("basic");
    await answerOwnerCall(client, { token: token(), callSid: CALL, now });
    expect(await ownerCallHeard(client, { token: token(), callSid: CALL, now: later })).toBe("<Response><Hangup/></Response>");
    expect(run()).toMatchObject({ state: "completed", nextAttemptAt: null });
    expect(notifications()).toHaveLength(1);
  });

  it("does not downgrade a completion when the final status arrives", async () => {
    ring("basic");
    await answerOwnerCall(client, { token: token(), callSid: CALL, now });
    await ownerCallHeard(client, { token: token(), callSid: CALL, now: later });
    await ownerCallStatus(client, { token: token(), callSid: CALL, status: "completed", now: later });
    expect(run()).toMatchObject({ state: "completed" });
    expect(run().attempts[0].result).toBe("completed");
    expect(notifications()).toHaveLength(1);
  });

  it("counts a hang-up during the summary as interrupted", async () => {
    ring("basic");
    await answerOwnerCall(client, { token: token(), callSid: CALL, now });
    await ownerCallStatus(client, { token: token(), callSid: CALL, status: "completed", now: later });
    expect(run().attempts[0].result).toBe("interrupted");
    expect(run().state).toBe("calling");
    expect(notifications()).toHaveLength(0);
  });

  it("tells the truth when there is no report", async () => {
    ring("basic", false);
    const xml = await answerOwnerCall(client, { token: token({ r: "" }), callSid: CALL, now });
    expect(xml).toContain("No verified report has arrived from Ahmed yet.");
    await ownerCallHeard(client, { token: token({ r: "" }), callSid: CALL, now: later });
    expect(notifications()).toEqual([expect.objectContaining({ outcome: "completed", reportId: null })]);
  });

  it("repeating the answer webhook changes nothing", async () => {
    ring("basic");
    const first = await answerOwnerCall(client, { token: token(), callSid: CALL, now });
    expect(await answerOwnerCall(client, { token: token(), callSid: CALL, now })).toBe(first);
    expect(run().attempts).toHaveLength(1);
  });
});

describe("Twilio's final status", () => {
  it.each(["busy", "no-answer", "failed", "canceled"])("treats %s as unanswered", async (status) => {
    ring("basic");
    await ownerCallStatus(client, { token: token(), callSid: CALL, status, now: later });
    expect(run().attempts[0].result).toBe("unanswered");
    expect(run().nextAttemptAt).toBe(new Date(later.getTime() + 20 * 60_000).toISOString());
  });

  it("ignores a status that isn't final", async () => {
    ring("basic");
    await ownerCallStatus(client, { token: token(), callSid: CALL, status: "ringing", now: later });
    expect(run().attempts[0].result).toBe("pending");
  });

  it("applies a repeated status once", async () => {
    ring("basic");
    await ownerCallStatus(client, { token: token(), callSid: CALL, status: "no-answer", now: later });
    const after = JSON.stringify(store.ws);
    await ownerCallStatus(client, { token: token(), callSid: CALL, status: "no-answer", now: later });
    expect(JSON.stringify(store.ws)).toBe(after);
  });
});

describe("a call that doesn't match the run", () => {
  it.each([[{ o: "44444444-4444-4444-8444-444444444444" }], [{ n: 2 }]])("says goodbye to a stale token %j", async (over) => {
    ring("basic");
    expect(await answerOwnerCall(client, { token: token(over), callSid: CALL, now })).toContain("<Hangup/>");
    expect(store.sessions.size).toBe(0);
  });
});

describe("Ultimate: completion needs the instructions step", () => {
  const turn = (digits: string | null, seq: number) => answerFarmCall(client, { callSid: CALL, seq, speech: "", digits, now: later });

  it("speaks the grounded summary, then asks for instructions, and isn't complete yet", async () => {
    ring("ultimate");
    const xml = await answerOwnerCall(client, { token: token(), callSid: CALL, now });
    expect(xml).toContain("Ahmed reported today at 5:05 PM.");
    expect(xml).toContain("Do you have any instructions");
    expect(run().state).toBe("answered");
  });

  it("completes when the owner declines instructions", async () => {
    ring("ultimate");
    await answerOwnerCall(client, { token: token(), callSid: CALL, now });
    await turn("2", 0);
    expect(run()).toMatchObject({ state: "completed" });
    expect(notifications()).toHaveLength(1);
    await ownerCallStatus(client, { token: token(), callSid: CALL, status: "completed", now: later });
    expect(run().attempts[0].result).toBe("completed");
    expect(store.sessions.size).toBe(0);
  });

  it("counts silence until the line drops as interrupted", async () => {
    ring("ultimate");
    await answerOwnerCall(client, { token: token(), callSid: CALL, now });
    await turn(null, 0);
    await turn(null, 1);
    await turn(null, 2);
    expect(run().state).toBe("answered");
    await ownerCallStatus(client, { token: token(), callSid: CALL, status: "completed", now: later });
    expect(run().attempts[0].result).toBe("interrupted");
    expect(run().state).toBe("calling");
  });

  it("offers instructions on a no-report call too, and saves no report id", async () => {
    ring("ultimate", false);
    const xml = await answerOwnerCall(client, { token: token({ r: "" }), callSid: CALL, now });
    expect(xml).toContain("No verified report has arrived");
    expect(xml).toContain("Do you have any instructions");
  });
});

describe("the signed token", () => {
  it("refuses a token signed with another secret", () => {
    expect(verifyCallToken(signCallToken(token(), "another-secret-another-secret-123"), SECRET, now.getTime())).toBeNull();
  });
});
