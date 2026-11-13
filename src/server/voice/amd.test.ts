import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as reportStatus } from "@/app/api/voice/outbound/status/route";
import { POST as ownerStatus } from "@/app/api/voice/owner/status/route";
import { POST as workerStatus } from "@/app/api/voice/worker/status/route";
import { startReportCall, placeReportCallAttempt, resolveReportCallAttempt } from "@/domain/reportCalls";
import { createDemoWorkspace } from "@/domain/seed";
import type { Workspace } from "@/domain/types";
import { signCallToken, type CallToken } from "@/server/calls/token";
import { twilioRequestSignature } from "@/server/twilio/signature";
import { resolveSilentReportCall } from "./farm-call";
import { voiceStep, type VoiceEvent } from "./contract";

const db = vi.hoisted(() => ({ ws: null as unknown as Workspace, events: [] as VoiceEvent[], seen: new Set<string>(), bound: true, row: null as unknown }));
vi.mock("server-only", () => ({}));
vi.mock("@/server/db/service-client", () => ({ createServiceClient: () => ({}) }));
vi.mock("@/server/db/voice-sessions", () => ({
  readVoiceSession: async () => db.row, deleteVoiceSession: async () => { db.row = null; },
}));
vi.mock("@/server/calls/reliability", () => ({ recordCallFailure: async () => {} }));
vi.mock("@/server/db/service-repository", () => ({
  findReportCallRun: async () => db.bound ? { farmId: "11111111-1111-4111-8111-111111111111", runId: "22222222-2222-4222-8222-222222222222" } : null,
  runFarmAction: async (_client: unknown, _farm: string, action: (ws: Workspace) => { ws: Workspace; result: unknown }) => {
    const next = action(db.ws);
    db.ws = next.ws;
    return { status: "saved", result: next.result };
  },
}));
vi.mock("./contract", async (original) => ({
  ...await original<typeof import("./contract")>(),
  applyVoiceEvent: async (_client: unknown, _farm: string, _context: unknown, event: VoiceEvent, now: Date) => {
    if (db.seen.has(event.eventId)) return { status: "unchanged" };
    db.seen.add(event.eventId);
    db.events.push(event);
    const next = voiceStep(db.ws, now, event);
    db.ws = next.ws;
    return next.result;
  },
}));

const FARM = "11111111-1111-4111-8111-111111111111";
const RUN = "22222222-2222-4222-8222-222222222222";
const SID = `CA${"a".repeat(32)}`;
const NOW = new Date("2026-11-13T15:00:00Z");
const SECRET = "offline-amd-secret";
const client = {} as SupabaseClient;
const token = (): Extract<CallToken, { k: "report" }> => ({ k: "report", f: FARM, r: RUN, n: 1, l: "ar", t: NOW.getTime() });
const run = () => db.ws.reportCalls![0];

function webhook(party: "report" | "owner" | "worker", answeredBy: string, signed = true, gate = true) {
  const path = party === "report" ? "outbound" : party;
  const claim: CallToken = party === "owner" ? { ...token(), k: "owner", o: RUN } : party === "worker" ? { ...token(), k: "worker", p: RUN } : token();
  const url = `https://naqah.test/api/voice/${path}/status?s=${encodeURIComponent(signCallToken(claim))}${gate ? "&amd=1" : ""}`;
  const fields = { CallSid: SID, CallStatus: gate ? "in-progress" : "completed", AnsweredBy: answeredBy };
  return new Request(url, {
    method: "POST", body: new URLSearchParams(fields),
    headers: { "Content-Type": "application/x-www-form-urlencoded", ...(signed ? { "X-Twilio-Signature": twilioRequestSignature(url, fields, "mock-twilio") } : {}) },
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  for (const [name, value] of Object.entries({ NAQAH_VOICE_MODE: "farm", TWILIO_AUTH_TOKEN: "mock-twilio", NAQAH_PUBLIC_BASE_URL: "https://naqah.test", NAQAH_VOICE_SECRET: SECRET, NEXT_PUBLIC_SUPABASE_URL: "https://unused.test", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "mock", SUPABASE_SECRET_KEY: "mock", NAQAH_TEST_CALLS: "0" })) vi.stubEnv(name, value);
  const opened = startReportCall(createDemoWorkspace("ar", "ultimate", NOW), NOW, "schedule");
  db.ws = placeReportCallAttempt(opened.ws, NOW, opened.run!.id).ws;
  run().id = RUN;
  db.events = [];
  db.seen = new Set();
  db.row = null;
  db.bound = true;
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("signed synchronous AMD gates", () => {
  it.each(["machine_start", "machine_end_beep", "machine_end_silence", "machine_end_other", "fax"])("hangs up on %s without starting or answering the report", async (answer) => {
    for (const repeat of [1, 2]) {
      const response = await reportStatus(webhook("report", answer));
      expect(response.status, String(repeat)).toBe(200);
      expect(await response.text()).toBe("<Response><Hangup/></Response>");
    }
    await reportStatus(webhook("report", "", true, false));
    expect(run()).toMatchObject({ state: "calling", nextAttemptAt: "2026-11-13T15:20:00.000Z", attempts: [{ result: "no_answer" }] });
    expect(db.events.some((event) => event.type === "report_call_attempt" && event.answered)).toBe(false);
  });

  it.each(["human", "unknown"])("lets %s proceed through the normal signed answer URL", async (answer) => {
    const response = await reportStatus(webhook("report", answer));
    expect(await response.text()).toContain('<Redirect method="POST">/api/voice/outbound?s=');
    expect(run().attempts[0].result).toBe("pending");
    expect(db.events).toEqual([]);
  });

  it.each([["report", reportStatus], ["owner", ownerStatus], ["worker", workerStatus]] as const)("verifies the Twilio signature on the %s gate", async (party, route) => {
    expect((await route(webhook(party, "machine_start", false))).status).toBe(403);
    const tampered = webhook(party, "human");
    const body = (await tampered.text()).replace("human", "machine_start");
    expect((await route(new Request(tampered.url, { method: "POST", headers: tampered.headers, body }))).status).toBe(403);
    expect(db.events).toEqual([]);
  });

  it.each([["owner", ownerStatus, "owner_call_attempt"], ["worker", workerStatus, "worker_call_attempt"]] as const)("classifies %s machines as unanswered", async (party, route, type) => {
    const response = await route(webhook(party, "fax"));
    expect(await response.text()).toBe("<Response><Hangup/></Response>");
    expect(db.events[0]).toMatchObject(party === "owner" ? { type, result: "unanswered" } : { type, answered: false, completed: false });
  });
});

describe("signed silence outcome plumbing", () => {
  const ticket = () => ({ sid: SID, f: FARM, r: RUN, j: "test-jti", l: "ar" as const, t: NOW.getTime() });

  it("reclassifies an answered silent call once, even after the final completed callback", async () => {
    db.ws = resolveReportCallAttempt(db.ws, NOW, RUN, true).ws;
    await reportStatus(webhook("report", "", true, false));
    await resolveSilentReportCall(client, ticket(), NOW);
    const first = structuredClone(run());
    await resolveSilentReportCall(client, ticket(), new Date(NOW.getTime() + 60_000));
    expect(run()).toEqual(first);
    expect(run()).toMatchObject({ state: "calling", attempts: [{ result: "no_answer" }], nextAttemptAt: "2026-11-13T15:20:00.000Z" });
  });

  it("never resolves a newer attempt or an unbound call from an old notice", async () => {
    run().attempts[0].at = new Date(NOW.getTime() + 1).toISOString();
    await resolveSilentReportCall(client, ticket(), NOW);
    expect(run().attempts[0].result).toBe("pending");
    run().attempts[0].at = NOW.toISOString();
    db.bound = false;
    await resolveSilentReportCall(client, ticket(), NOW);
    expect(run().attempts[0].result).toBe("pending");
  });
});
