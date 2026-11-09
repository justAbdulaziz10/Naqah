import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as afterRoute } from "@/app/api/voice/realtime/after/route";
import { POST as sessionRoute } from "@/app/api/voice/realtime/session/route";
import { POST as toolRoute } from "@/app/api/voice/realtime/tool/route";
import { reportSummaryId, type CallSession } from "@/domain/conversation/engine";
import { createDemoWorkspace } from "@/domain/seed";
import type { Workspace } from "@/domain/types";
import { signCallToken } from "@/server/calls/token";
import { twilioRequestSignature } from "@/server/twilio/signature";
import { answerFarmCall, answerOwnerCall, ownerCallStatus } from "../farm-call";
import { mapSpeechToInput } from "../speech";
import { forgetCallWorkspace } from "./call-workspace";
import { isVerifiedConfirmation } from "./confirmation";
import { bridgeSignature } from "./internal";
import { realtimeOf } from "./state";
import { signRealtimeTicket, verifyRealtimeTicket, TICKET_CLAIM_MS } from "./ticket";

const mock = vi.hoisted(() => ({ client: vi.fn(), load: vi.fn(), save: vi.fn(), farm: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/server/db/service-client", () => ({ createServiceClient: mock.client }));
vi.mock("@/server/db/queries", async (original) => ({ ...(await original<typeof import("@/server/db/queries")>()), loadFarm: mock.load }));
vi.mock("@/server/db/service-repository", async (original) => ({
  ...(await original<typeof import("@/server/db/service-repository")>()),
  runFarmAction: mock.farm, findReportCallRun: vi.fn().mockResolvedValue(null), recordedOutcome: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/server/voice/contract", async (original) => ({ ...(await original<typeof import("@/server/voice/contract")>()), applyVoiceEvent: mock.save }));

const SECRET = "unit-test-secret-of-at-least-32-bytes-long";
const TWILIO = "unit-test-twilio-token";
const BASE = "https://naqah.test";
const BRIDGE = "wss://bridge.naqah.test/voice-bridge/media";
const CALL = `CA${"c".repeat(32)}`;
const FARM = "00000000-0000-4000-8000-000000000001";
const RUN = "00000000-0000-4000-8000-000000000003";
const NOW = new Date("2026-11-08T14:00:00Z");
const TOMORROW_AT_SIX = "2026-11-09T18:00:00+03:00";

/** One voice_call_sessions row, with the filters that decide who wins a race applied for real. */
function fakeClient() {
  const store: { row: Record<string, unknown> | null } = { row: null };
  const read = (row: Record<string, unknown>, path: string) =>
    path.split(/->>?/).reduce<unknown>((value, key) => (value as Record<string, unknown> | undefined)?.[key], row);
  const builder = () => {
    const filters: ((row: Record<string, unknown>) => boolean)[] = [];
    let patch: Record<string, unknown> | null = null;
    const matching = () => (store.row && filters.every((filter) => filter(store.row!)) ? store.row : null);
    const query = {
      select: () => query,
      update: (values: Record<string, unknown>) => { patch = values; return query; },
      delete: () => query,
      lt: () => query,
      upsert: async (row: Record<string, unknown>) => {
        store.row ??= JSON.parse(JSON.stringify({ seq: 0, misses: 0, ...row }));
        return { error: null };
      },
      eq: (key: string, value: unknown) => { filters.push((row) => read(row, key) === value); return query; },
      is: (key: string, value: unknown) => { filters.push((row) => (read(row, key) ?? null) === value); return query; },
      maybeSingle: async () => {
        const found = matching();
        if (found && patch) store.row = JSON.parse(JSON.stringify({ ...found, ...patch }));
        return { data: found ? JSON.parse(JSON.stringify(store.row)) : null, error: null };
      },
      then: (resolve: (value: { error: null }) => void) => resolve({ error: null }),
    };
    return query;
  };
  return { client: { from: builder } as unknown as SupabaseClient, store };
}

const ownerFarm = (plan: "basic" | "ultimate" = "ultimate"): Workspace => ({
  ...createDemoWorkspace("ar", plan, NOW),
  ownerCallRun: { id: RUN, occurrence: NOW.toISOString(), reportId: null, attempts: [{ at: NOW.toISOString(), result: "pending" }], nextAttemptAt: null, state: "calling" },
});

const token = () => ({ k: "owner" as const, f: FARM, o: RUN, r: "", n: 1, l: "ar" as const, t: NOW.getTime() });
const ticketIn = (xml: string) => /name="ticket" value="([^"]+)"/.exec(xml)![1];

function signed(path: string, body: unknown, at = Date.now()) {
  const raw = JSON.stringify(body);
  return new Request(`${BASE}${path}`, {
    method: "POST",
    headers: { "x-naqah-bridge-timestamp": String(at), "x-naqah-bridge-signature": bridgeSignature(String(at), raw, SECRET) },
    body: raw,
  });
}

function twilio(path: string, fields: Record<string, string>) {
  const url = `${BASE}${path}`;
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Twilio-Signature": twilioRequestSignature(url, fields, TWILIO) },
    body: new URLSearchParams(fields),
  });
}

let db: ReturnType<typeof fakeClient>;
let farm: Workspace;
let toolCounter = 0;
const row = () => db.store.row as unknown as { seq: number; misses: number; last_response: string; party: string; session: CallSession & { realtime: { closed: boolean; instructions?: string; recent: unknown[] } } };
const answerCall = () => answerOwnerCall(db.client, { token: token(), callSid: CALL, now: new Date() });

async function open() {
  const ticket = ticketIn(await answerCall());
  const response = await sessionRoute(signed("/api/voice/realtime/session", { ticket, callSid: CALL }));
  expect(response.status).toBe(200);
  return { ticket, opened: await response.json() };
}

async function tool(ticket: string, name: string, args: unknown, heard: string, extra: Record<string, unknown> = {}) {
  toolCounter += 1;
  const response = await toolRoute(signed("/api/voice/realtime/tool", { ticket, callSid: CALL, toolCallId: `call_${toolCounter}`, name, args, userSpokeSinceLastTool: true, workerUtterance: heard, ...extra }));
  const result = response.status === 200 ? await response.json() : null;
  return { status: response.status, result, output: result ? JSON.parse(result.output) : null };
}

const reviewId = () => reportSummaryId(row().session, "ar");
const events = () => mock.save.mock.calls.map((call) => call[3] as { type: string; eventId: string; items?: { message: string; actionable: boolean; scheduledFor: string | null }[]; result?: string; runId?: string; attempt?: number });
const proposal = (message: string, kind: "task" | "information", due: string | null, evidence = message) => ({ message, kind, due, evidence });

const SAID_ONE = "قل له يصلح السياج الشرقي بأي وقت";

async function atReview(ticket: string) {
  const step = await tool(ticket, "propose_instructions", { items: [proposal("يصلح السياج الشرقي", "task", "any_time", "يصلح السياج الشرقي بأي وقت")] }, SAID_ONE);
  expect(step.output.status).toBe("ok");
  expect(row().session.step).toBe("instruction_review");
  return step;
}

beforeEach(() => {
  forgetCallWorkspace(CALL);
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  vi.stubEnv("NAQAH_VOICE_MODE", "farm");
  vi.stubEnv("NAQAH_VOICE_ENGINE", "realtime");
  vi.stubEnv("NAQAH_BRIDGE_PUBLIC_URL", BRIDGE);
  vi.stubEnv("NAQAH_VOICE_SECRET", SECRET);
  vi.stubEnv("NAQAH_PUBLIC_BASE_URL", BASE);
  vi.stubEnv("TWILIO_AUTH_TOKEN", TWILIO);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "test-only");
  vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_test");
  db = fakeClient();
  farm = ownerFarm();
  mock.client.mockReturnValue(db.client);
  mock.load.mockImplementation(async () => ({ workspace: farm }));
  mock.farm.mockImplementation(async (_client: unknown, _farm: unknown, action: (ws: Workspace) => { ws: Workspace; result: unknown }) => {
    const applied = action(farm);
    farm = applied.ws;
    return { status: "applied", result: applied.result };
  });
  mock.save.mockResolvedValue({ status: "saved" });
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("opening an owner session", () => {
  it("streams with the owner's tools, and keeps the scripted reply on the row", async () => {
    const { opened } = await open();
    expect(opened.tools.map((entry: { name: string }) => entry.name)).toEqual(["propose_instructions", "no_instructions", "confirm_instructions", "correct_instruction", "remove_instruction", "repeat_or_clarify", "end_call"]);
    expect(row().party).toBe("owner");
    expect(row().session.data.ownerRunId).toBe(RUN);
    expect(row().last_response).toContain("<Gather");
    expect(opened.instructions).toContain("riyadhNow");
  });

  it("is scripted when realtime isn't configured", async () => {
    vi.stubEnv("NAQAH_VOICE_ENGINE", "");
    const xml = await answerCall();
    expect(xml).toContain("<Gather");
    expect(xml).not.toContain("<Connect");
    expect(row().session).not.toHaveProperty("realtime");
  });

  it("never opens a stream for a Basic owner, and never asks for instructions", async () => {
    farm = ownerFarm("basic");
    const xml = await answerCall();
    expect(xml).not.toContain("<Connect");
    expect(xml).not.toContain("<Gather");
    expect(xml).toContain("<Redirect");
    expect(xml).not.toMatch(/تعليمات/);
    expect(db.store.row).toBeNull();
  });

  it("refuses a worker's ticket for this owner's row", async () => {
    const ticket = ticketIn(await answerCall());
    const claims = verifyRealtimeTicket(ticket, SECRET, Date.now(), TICKET_CLAIM_MS)!;
    const worker = signRealtimeTicket({ sid: claims.sid, f: claims.f, r: RUN, l: claims.l, j: claims.j, t: claims.t }, SECRET);
    const response = await sessionRoute(signed("/api/voice/realtime/session", { ticket: worker, callSid: CALL }));
    expect(response.status).not.toBe(200);
  });
});

describe("no instructions", () => {
  it("completes the attempt and writes nothing else", async () => {
    const { ticket } = await open();
    const step = await tool(ticket, "no_instructions", {}, "لا ما عندي شي");
    expect(step.result.end).toBe("hangup");
    expect(events().map((event) => event.type)).toEqual(["owner_call_attempt"]);
    expect(events()[0]).toMatchObject({ runId: RUN, attempt: 1, result: "completed", eventId: `${CALL}:owner-attempt` });
  });

  it("refuses when the owner's words say yes", async () => {
    const { ticket } = await open();
    const step = await tool(ticket, "no_instructions", {}, "إيه");
    expect(step.output.error).toBe("answer_conflicts_with_words");
    expect(events()).toEqual([]);
  });
});

describe("proposing", () => {
  it("moves to the words when the owner only said yes", async () => {
    const { ticket } = await open();
    const step = await tool(ticket, "propose_instructions", { items: [] }, "إيه");
    expect(step.output.status).toBe("ok");
    expect(row().session.step).toBe("instruction_text");
  });

  it("refuses evidence that isn't in the transcript, and moves nothing", async () => {
    const { ticket } = await open();
    const step = await tool(ticket, "propose_instructions", { items: [proposal("يصلح السياج", "task", "any_time")] }, "قل له يسقي الحلال");
    expect(step.output.status).toBe("invalid");
    expect(step.output.error).toBe("instructions_not_supported");
    expect(row().session.step).toBe("instruction_yesno");
    expect(events()).toEqual([]);
  });

  it("refuses the whole list when one item is unsupported", async () => {
    const { ticket } = await open();
    const step = await tool(ticket, "propose_instructions", { items: [proposal("يصلح السياج", "task", null), proposal("يبيع القعود", "task", null)] }, "قل له يصلح السياج");
    expect(step.output.error).toBe("instructions_not_supported");
    expect(row().session.data.pendingInstructions).toBeUndefined();
  });

  it("falls back to the script after three refusals, and saves nothing", async () => {
    const { ticket } = await open();
    await tool(ticket, "propose_instructions", { items: [proposal("زور", "task", null)] }, "كلام ثاني تماما");
    await tool(ticket, "propose_instructions", { items: [proposal("زور", "task", null)] }, "كلام ثاني تماما");
    const third = await tool(ticket, "propose_instructions", { items: [proposal("زور", "task", null)] }, "كلام ثاني تماما");
    expect(third.result.end).toBe("fallback");
    expect(row().session.realtime.closed).toBe(true);
    expect(events()).toEqual([]);
  });

  it("keeps the owner's words when the model reworded them, and their «لا» when it dropped it", async () => {
    const { ticket } = await open();
    await tool(ticket, "propose_instructions", { items: [
      proposal("ابنِ سوراً جديداً حول المزرعة", "task", "any_time", "يصلح السياج الشرقي بأي وقت"),
      proposal("تسقي الحلال بكرة", "information", null, "تسقي الحلال بكرة"),
    ] }, "يصلح السياج الشرقي بأي وقت، ولا تسقي الحلال بكرة");
    const items = row().session.data.pendingInstructions!;
    expect(items[0].message).toBe("يصلح السياج الشرقي بأي وقت");
    expect(items[1].message).toContain("ولا تسقي الحلال");
  });

  it("drops a due the owner never gave, and asks", async () => {
    const { ticket } = await open();
    const step = await tool(ticket, "propose_instructions", { items: [proposal("يصلح السياج", "task", TOMORROW_AT_SIX)] }, "قل له يصلح السياج");
    expect(row().session.step).toBe("instruction_schedule");
    expect(step.result.sayText).toContain("يصلح السياج");
  });

  it("takes a time the owner said, then the answer to when", async () => {
    const { ticket } = await open();
    await tool(ticket, "propose_instructions", { items: [proposal("يصلح السياج", "task", null)] }, "قل له يصلح السياج");
    expect(row().session.step).toBe("instruction_schedule");
    const refused = await tool(ticket, "correct_instruction", { index: 0, due: TOMORROW_AT_SIX }, "ماشي");
    expect(refused.output.error).toBe("due_not_supported");
    const step = await tool(ticket, "correct_instruction", { index: 0, due: TOMORROW_AT_SIX }, "بكرة الساعة ستة");
    expect(step.output.status).toBe("ok");
    expect(row().session.step).toBe("instruction_review");
    expect(row().session.data.pendingInstructions![0].scheduledFor).toBe(new Date(TOMORROW_AT_SIX).toISOString());
  });
});

describe("the review", () => {
  it("is a server-spoken summary the owner must hear in full", async () => {
    const { ticket } = await open();
    const { result } = await atReview(ticket);
    expect(result.summaryText).toContain("فهمتها مهمة");
    expect(result.summaryText).toContain("يصلح السياج");
    expect(result.summaryId).toBe(reviewId());
    expect(result.awaitingConfirmation).toBe(true);
    expect(result.sayText).toBeUndefined();
  });

  it("refuses a stale heardSummaryId, and falls back on the second failure", async () => {
    const { ticket } = await open();
    await atReview(ticket);
    const first = await tool(ticket, "confirm_instructions", { confirmed: true }, "إيه احفظها", { heardSummaryId: "stale" });
    expect(first.output.error).toBe("summary_not_finished");
    const second = await tool(ticket, "confirm_instructions", { confirmed: true }, "إيه احفظها", { heardSummaryId: "stale" });
    expect(second.result.end).toBe("fallback");
    expect(events()).toEqual([]);
  });

  it("refuses unclear words even with the right id", async () => {
    const { ticket } = await open();
    await atReview(ticket);
    const step = await tool(ticket, "confirm_instructions", { confirmed: true }, "يمكن", { heardSummaryId: reviewId() });
    expect(step.output.error).toBe("owner_has_not_confirmed");
    expect(events()).toEqual([]);
  });

  it("saves one batch keyed to the run, then completes the attempt", async () => {
    const { ticket } = await open();
    await atReview(ticket);
    const step = await tool(ticket, "confirm_instructions", { confirmed: true }, "إيه احفظها", { heardSummaryId: reviewId() });
    expect(step.result.end).toBe("hangup");
    expect(step.output.status).toBe("saved");
    expect(events().map((event) => event.type)).toEqual(["owner_instruction", "owner_call_attempt"]);
    expect(events()[0].eventId).toBe(`owner-instructions:${RUN}`);
    expect(events()[0].items).toEqual([{ message: "يصلح السياج الشرقي", actionable: true, scheduledFor: null }]);
    expect(events()[1]).toMatchObject({ runId: RUN, result: "completed" });
  });

  it("applies a double confirm once", async () => {
    const { ticket } = await open();
    await atReview(ticket);
    const id = reviewId();
    const first = await tool(ticket, "confirm_instructions", { confirmed: true }, "إيه احفظها", { heardSummaryId: id });
    const replay = await toolRoute(signed("/api/voice/realtime/tool", { ticket, callSid: CALL, toolCallId: `call_${toolCounter}`, name: "confirm_instructions", args: { confirmed: true }, userSpokeSinceLastTool: true, workerUtterance: "إيه احفظها", heardSummaryId: id }));
    expect(await replay.json()).toEqual(first.result);
    const later = await tool(ticket, "confirm_instructions", { confirmed: true }, "إيه احفظها", { heardSummaryId: id });
    expect(later.result.end).toBe("hangup");
    expect(events().filter((event) => event.type === "owner_instruction")).toHaveLength(1);
  });

  it("does not claim a save the contract didn't make", async () => {
    mock.save.mockResolvedValue({ status: "unchanged" });
    const { ticket } = await open();
    await atReview(ticket);
    const step = await tool(ticket, "confirm_instructions", { confirmed: true }, "إيه احفظها", { heardSummaryId: reviewId() });
    expect(step.result.goodbye).toContain("انحفظت قبل");
  });

  it("makes a correction re-read everything, so the old id no longer confirms", async () => {
    const { ticket } = await open();
    await atReview(ticket);
    const heardBefore = reviewId();
    const fixed = await tool(ticket, "correct_instruction", { index: 0, kind: "information" }, "هذي معلومة بس");
    expect(fixed.result.summaryText).toContain("فهمتها معلومة فقط");
    expect(fixed.result.summaryId).not.toBe(heardBefore);
    const stale = await tool(ticket, "confirm_instructions", { confirmed: true }, "إيه", { heardSummaryId: heardBefore });
    expect(stale.output.error).toBe("summary_not_finished");
    const saved = await tool(ticket, "confirm_instructions", { confirmed: true }, "إيه", { heardSummaryId: reviewId() });
    expect(saved.output.status).toBe("saved");
    expect(events()[0].items![0].actionable).toBe(false);
  });

  it("appends at the list, re-reads all of it, refuses the old id, and saves one batch", async () => {
    const { ticket } = await open();
    await atReview(ticket);
    const heardBefore = reviewId();
    const added = await tool(ticket, "propose_instructions", { items: [proposal("الضيوف يجون الجمعة", "information", null)] }, "وقل له الضيوف يجون الجمعة");
    expect(row().session.step).toBe("instruction_review");
    expect(row().session.data.pendingInstructions!.map((item) => item.message)).toEqual(["يصلح السياج الشرقي", "الضيوف يجون الجمعة"]);
    expect(added.result.summaryText).toContain("يصلح السياج الشرقي");
    expect(added.result.summaryText).toContain("الضيوف يجون الجمعة");
    expect(added.result.summaryId).not.toBe(heardBefore);
    const stale = await tool(ticket, "confirm_instructions", { confirmed: true }, "إيه", { heardSummaryId: heardBefore });
    expect(stale.output.error).toBe("summary_not_finished");
    const saved = await tool(ticket, "confirm_instructions", { confirmed: true }, "إيه", { heardSummaryId: reviewId() });
    expect(saved.output.status).toBe("saved");
    const batches = events().filter((event) => event.items);
    expect(batches).toHaveLength(1);
    expect(batches[0].items).toHaveLength(2);
  });

  it("removes one by its index, re-reads the rest, and refuses the old id", async () => {
    const { ticket } = await open();
    await atReview(ticket);
    await tool(ticket, "propose_instructions", { items: [proposal("الضيوف يجون الجمعة", "information", null)] }, "وقل له الضيوف يجون الجمعة");
    const heardBefore = reviewId();
    const removed = await tool(ticket, "remove_instruction", { index: 0 }, "شيل السياج");
    expect(row().session.step).toBe("instruction_review");
    expect(row().session.data.pendingInstructions!.map((item) => item.message)).toEqual(["الضيوف يجون الجمعة"]);
    expect(removed.result.summaryText).not.toContain("السياج");
    expect(removed.result.summaryId).not.toBe(heardBefore);
    const stale = await tool(ticket, "confirm_instructions", { confirmed: true }, "إيه", { heardSummaryId: heardBefore });
    expect(stale.output.error).toBe("summary_not_finished");
  });

  it("asks afresh when the last one is removed, and saves nothing", async () => {
    const { ticket } = await open();
    await atReview(ticket);
    await tool(ticket, "remove_instruction", { index: 0 }, "شيلها");
    expect(row().session.step).toBe("instruction_yesno");
    expect(row().session.data.pendingInstructions).toEqual([]);
    const none = await tool(ticket, "no_instructions", {}, "لا ما عندي شي");
    expect(none.result.end).toBe("hangup");
    expect(events().filter((event) => event.items)).toEqual([]);
  });

  it("refuses an index outside the list", async () => {
    const { ticket } = await open();
    await atReview(ticket);
    const outside = await tool(ticket, "remove_instruction", { index: 3 }, "شيل الثالثة");
    expect(outside.output.error).toBe("value_not_allowed");
    expect(row().session.data.pendingInstructions).toHaveLength(1);
  });

  it("refuses new words the owner didn't say", async () => {
    const { ticket } = await open();
    await atReview(ticket);
    const step = await tool(ticket, "correct_instruction", { index: 0, message: "يبيع القعود" }, "لا غيرها");
    expect(step.output.error).toBe("message_not_supported");
    expect(row().session.data.pendingInstructions![0].message).toBe("يصلح السياج الشرقي");
  });

  it("refuses a correction to an index that doesn't exist", async () => {
    const { ticket } = await open();
    await atReview(ticket);
    const step = await tool(ticket, "correct_instruction", { index: 4, kind: "information" }, "الخامسة معلومة");
    expect(step.output.error).toBe("value_not_allowed");
  });

  it("saves nothing when the owner cancels, and that still answers the call", async () => {
    const { ticket } = await open();
    await atReview(ticket);
    const step = await tool(ticket, "end_call", { reason: "owner_ended" }, "ألغها");
    expect(step.result.end).toBe("hangup");
    expect(events().map((event) => event.type)).toEqual(["owner_call_attempt"]);
  });

  it("leaves the attempt open when the call cannot continue", async () => {
    const { ticket } = await open();
    await atReview(ticket);
    const step = await tool(ticket, "end_call", { reason: "cannot_continue" }, "");
    expect(step.result.end).toBe("hangup");
    expect(events()).toEqual([]);
    expect(step.result.goodbye).toContain("ما انحفظ");
  });
});

describe("falling back to the script", () => {
  const after = () => afterRoute(twilio(`/api/voice/realtime/after?s=${encodeURIComponent(signCallToken(token(), SECRET))}`, { CallSid: CALL, From: "+966500000000" }));
  const say = (speech: string, digits: string | null = null) => answerFarmCall(db.client, { callSid: CALL, seq: row().seq, speech, digits, now: new Date() });

  it("resumes the review from where it was, and saves only on a clear yes", async () => {
    const { ticket } = await open();
    await atReview(ticket);
    const xml = await (await after()).text();
    expect(xml).toContain("<Gather");
    expect(xml.indexOf("<Say")).toBeLessThan(xml.indexOf("<Gather"));
    expect(row().session.realtime.closed).toBe(true);
    const late = await tool(ticket, "confirm_instructions", { confirmed: true }, "إيه", { heardSummaryId: reviewId() });
    expect(late.result.end).toBe("fallback");
    expect(events()).toEqual([]);

    await say("يمكن");
    expect(events()).toEqual([]);
    const done = await say("إيه احفظها");
    expect(done).toContain("<Hangup/>");
    expect(events().map((event) => event.type)).toEqual(["owner_instruction", "owner_call_attempt"]);
  });

  it("captures the words by script and asks the owner the kind", async () => {
    const { ticket } = await open();
    await tool(ticket, "propose_instructions", { items: [] }, "إيه");
    await after();
    await say("قل له يسقي الحلال");
    expect(row().session.step).toBe("instruction_kind");
    await say("", "2");
    await say("لا خلاص");
    expect(row().session.step).toBe("instruction_review");
    expect(row().session.turns.at(-1)?.text.ar).toContain("حددتها معلومة فقط");
    await say("", "1");
    expect(events().map((event) => event.type)).toEqual(["owner_instruction", "owner_call_attempt"]);
    expect(events()[0].items).toEqual([{ message: "قل له يسقي الحلال", actionable: false, scheduledFor: null }]);
  });

  it("saves nothing when the owner hangs up mid-review, and the attempt counts as interrupted", async () => {
    const { ticket } = await open();
    await atReview(ticket);
    expect(realtimeOf(row().session)?.closed).toBe(false);
    await ownerCallStatus(db.client, { token: token(), callSid: CALL, status: "completed", now: new Date() });
    expect(events().map((event) => event.type)).toEqual(["owner_call_attempt"]);
    expect(events()[0]).toMatchObject({ result: "interrupted", runId: RUN, eventId: `${CALL}:owner-attempt` });
  });
});

describe("what the owner says at the review", () => {
  const session = {
    step: "instruction_review", inputMode: "choices", data: {}, turns: [],
    replies: ["instructions_confirm", "instructions_correct", "instructions_cancel"].map((value) => ({ id: value, value, label: { ar: value, en: value } })),
  } as unknown as CallSession;

  it.each([
    ["إيه احفظها", "instructions_confirm"],
    ["yes", "instructions_confirm"],
    ["ألغها", "instructions_cancel"],
    ["لا تحفظها", "instructions_cancel"],
    ["don't save them", "instructions_cancel"],
    ["عدل وحدة", "instructions_correct"],
    ["لا", "instructions_correct"],
    ["change the second one", "instructions_correct"],
    ["يمكن", undefined],
    ["إيه بس لا", undefined],
  ])("reads %s as %s", (speech, expected) => {
    expect(mapSpeechToInput(session, speech, null, "ar")?.value).toBe(expected);
  });

  it("only a clear yes counts as verified, on this step", () => {
    expect(isVerifiedConfirmation("إيه احفظها", session, "ar")).toBe(true);
    expect(isVerifiedConfirmation("وش قلت؟", session, "ar")).toBe(false);
    expect(isVerifiedConfirmation("إيه احفظها", { ...session, step: "instruction_yesno" }, "ar")).toBe(false);
  });

  it("reads a position when picking one to change", () => {
    const pick = { ...session, step: "instruction_correct_pick", replies: [...["correct:0", "correct:1"], "back_to_review"].map((value) => ({ id: value, value, label: { ar: value, en: value } })) } as unknown as CallSession;
    expect(mapSpeechToInput(pick, "الثانية", null, "ar")?.value).toBe("correct:1");
    expect(mapSpeechToInput(pick, "first", null, "en")?.value).toBe("correct:0");
    expect(mapSpeechToInput(pick, "ارجع", null, "ar")?.value).toBe("back_to_review");
  });

  it("reads a spoken number of days as a date", () => {
    const date = { ...session, step: "instruction_date", inputMode: "text", replies: [{ id: "any_time", value: "any_time", label: { ar: "في أي وقت", en: "Any time" } }] } as unknown as CallSession;
    expect(mapSpeechToInput(date, "بعد عشرة أيام", null, "ar")?.text).toBe("in 10 days");
  });
});
