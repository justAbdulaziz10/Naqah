import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as afterRoute } from "@/app/api/voice/realtime/after/route";
import { POST as sessionRoute } from "@/app/api/voice/realtime/session/route";
import { POST as toolRoute } from "@/app/api/voice/realtime/tool/route";
import type { CallSession } from "@/domain/conversation/engine";
import { placeReportCallAttempt, resolveReportCallAttempt, startReportCall } from "@/domain/reportCalls";
import { createDemoWorkspace } from "@/domain/seed";
import type { Workspace } from "@/domain/types";
import { realtimeVoiceConfig } from "@/server/env";
import { signCallToken } from "@/server/calls/token";
import { twilioRequestSignature } from "@/server/twilio/signature";
import { advanceRow, answerFarmCall, answerReportCall } from "../farm-call";
import { recordConfirmationFailure, realtimeOf } from "./state";
import { bridgeSignature, validBridgeSignature } from "./internal";
import { signRealtimeTicket, TICKET_CLAIM_MS, verifyRealtimeTicket } from "./ticket";
import { checkTool, REALTIME_TOOLS } from "./tools";

const mock = vi.hoisted(() => ({ client: vi.fn(), load: vi.fn(), save: vi.fn(), find: vi.fn(), recorded: vi.fn(), owner: vi.fn(), after: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/server/db/service-client", () => ({ createServiceClient: mock.client }));
import { callWorkspace, forgetCallWorkspace } from "./call-workspace";

vi.mock("@/server/db/queries", async (original) => ({ ...(await original<typeof import("@/server/db/queries")>()), loadFarm: mock.load }));
vi.mock("@/server/db/service-repository", async (original) => ({
  ...(await original<typeof import("@/server/db/service-repository")>()), findReportCallRun: mock.find, recordedOutcome: mock.recorded,
}));
vi.mock("@/server/calls/owner-call", () => ({ callOwnerAfterReport: mock.owner }));
vi.mock("@/server/calls/after", () => ({ afterResponse: mock.after }));
vi.mock("@/server/voice/contract", async (original) => ({ ...(await original<typeof import("@/server/voice/contract")>()), applyVoiceEvent: mock.save }));

const SECRET = "unit-test-secret-of-at-least-32-bytes-long";
const TWILIO = "unit-test-twilio-token";
const BASE = "https://naqah.test";
const BRIDGE = "wss://bridge.naqah.test/voice-bridge/media";
const CALL = `CA${"a".repeat(32)}`;
const OTHER_CALL = `CA${"b".repeat(32)}`;
const FARM = "00000000-0000-4000-8000-000000000001";
const RUN = "00000000-0000-4000-8000-000000000002";
const NOW = new Date("2026-11-08T11:04:58Z");

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

function answeredFarm(): Workspace {
  const opened = startReportCall(createDemoWorkspace("ar", "ultimate", NOW), NOW, "manual");
  const placed = placeReportCallAttempt(opened.ws, NOW, opened.run!.id).ws;
  const answered = resolveReportCallAttempt(placed, NOW, opened.run!.id, true).ws;
  // The contract takes database ids, and the demo farm's aren't.
  const ids = [...answered.camels, ...answered.taskTickets].map((item) => item.id);
  const json = ids.reduce((text, id, index) => text.replaceAll(id, `00000000-0000-4000-8000-${String(index + 100).padStart(12, "0")}`), JSON.stringify(answered));
  return JSON.parse(json.replaceAll(opened.run!.id, RUN)) as Workspace;
}

const token = () => ({ k: "report" as const, f: FARM, r: RUN, n: 1, l: "ar" as const, t: NOW.getTime() });
const ticketIn = (xml: string) => /name="ticket" value="([^"]+)"/.exec(xml)![1];

function signed(path: string, body: unknown, at = Date.now(), secret = SECRET) {
  const raw = JSON.stringify(body);
  return new Request(`${BASE}${path}`, {
    method: "POST",
    headers: { "x-naqah-bridge-timestamp": String(at), "x-naqah-bridge-signature": bridgeSignature(String(at), raw, secret) },
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
let toolCounter = 0;
const row = () => db.store.row as unknown as { seq: number; misses: number; last_response: string; session: CallSession & { realtime: { recent: unknown[]; closed: boolean; claimedAt: string | null; instructions?: string } } };

async function answerCall() {
  return answerReportCall(db.client, { token: token(), callSid: CALL, now: new Date() });
}

async function open() {
  const ticket = ticketIn(await answerCall());
  const response = await sessionRoute(signed("/api/voice/realtime/session", { ticket, callSid: CALL }));
  expect(response.status).toBe(200);
  return { ticket, opened: await response.json() };
}

async function tool(ticket: string, name: unknown, args: unknown, extra: Record<string, unknown> = {}) {
  toolCounter += 1;
  const response = await toolRoute(signed("/api/voice/realtime/tool", {
    ticket, callSid: CALL, toolCallId: `call_${toolCounter}`, name, args, userSpokeSinceLastTool: true,
    ...(name === "confirm_report" ? { workerUtterance: "إيه صح", heardSummary: true } : {}),
    ...(name === "answer_question" ? { workerUtterance: "إيه تمام" } : {}), ...extra,
  }));
  const result = response.status === 200 ? await response.json() : null;
  return { status: response.status, result, output: result ? JSON.parse(result.output) : null };
}

type Prompt = { value?: string; replies: { value: string }[]; textAllowed: boolean; numberExpected: boolean; isSummary: boolean };

/** Answers every question the engine asks until the summary is reached. */
async function reachSummary(ticket: string, first: Prompt) {
  let prompt = first;
  for (let turn = 0; turn < 80 && !prompt.isSummary; turn += 1) {
    const args = prompt.numberExpected ? { text: "٤٢" } : prompt.replies.length ? { value: prompt.replies[0].value } : { text: "تمام" };
    const step = await tool(ticket, "answer_question", args);
    expect(step.status).toBe(200);
    expect(step.output.status).toBe("ok");
    prompt = step.output;
  }
  expect(prompt.isSummary).toBe(true);
  return prompt;
}

function firstPrompt(opened: { instructions: string }): Prompt {
  return JSON.parse(/<call_data>([\s\S]*)<\/call_data>/.exec(opened.instructions)![1]).currentStep;
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
  mock.client.mockReturnValue(db.client);
  mock.load.mockResolvedValue({ workspace: answeredFarm() });
  mock.save.mockResolvedValue({ status: "saved" });
  mock.find.mockResolvedValue(null);
  mock.recorded.mockResolvedValue(null);
  mock.owner.mockResolvedValue(null);
  mock.after.mockImplementation((work: () => Promise<void>) => work());
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("configuration", () => {
  it.each([
    ["NAQAH_VOICE_ENGINE", ""],
    ["NAQAH_VOICE_ENGINE", "scripted"],
    ["NAQAH_VOICE_MODE", "sample"],
    ["NAQAH_BRIDGE_PUBLIC_URL", ""],
    ["NAQAH_BRIDGE_PUBLIC_URL", "https://bridge.naqah.test/media"],
    ["NAQAH_BRIDGE_PUBLIC_URL", "not a url"],
    ["NAQAH_BRIDGE_PUBLIC_URL", `${BRIDGE}?x=1`],
    ["NAQAH_VOICE_SECRET", ""],
  ])("is off with %s=%s", (name, value) => {
    vi.stubEnv(name, value);
    expect(realtimeVoiceConfig()).toBeNull();
  });

  it("is off when the flag is off: the call is the scripted one, byte for byte", async () => {
    vi.stubEnv("NAQAH_VOICE_ENGINE", "");
    const xml = await answerCall();
    expect(xml).toContain("<Gather");
    expect(xml).not.toContain("<Connect");
    expect(xml).toBe(row().last_response);
    expect(row().session).not.toHaveProperty("realtime");

    const scripted = xml;
    db = fakeClient();
    vi.stubEnv("NAQAH_VOICE_ENGINE", "realtime");
    const streamed = await answerCall();
    expect(streamed).toContain("<Connect");
    expect(row().last_response).toBe(scripted);
  });

  it("keeps the bridge routes closed when off", async () => {
    vi.stubEnv("NAQAH_VOICE_ENGINE", "");
    expect((await sessionRoute(signed("/api/voice/realtime/session", {}))).status).toBe(404);
    expect((await toolRoute(signed("/api/voice/realtime/tool", {}))).status).toBe(404);
  });
});

describe("answering the call", () => {
  it("returns a connect verb with escaped attributes and a signed after URL", async () => {
    const xml = await answerCall();
    expect(xml).toMatch(/^<Response><Connect action="https:\/\/naqah\.test\/api\/voice\/realtime\/after\?s=[^"]+"><Stream url="wss:\/\/bridge\.naqah\.test\/voice-bridge\/media"><Parameter name="ticket" value="[^"]+"\/><\/Stream><\/Connect><\/Response>$/);
  });

  it("never opens a second stream for a duplicate answer webhook", async () => {
    expect(await answerCall()).toContain("<Connect");
    const repeat = await answerCall();
    expect(repeat).toContain("<Gather");
    expect(repeat).not.toContain("<Connect");
  });

  it("opens only one stream when answer webhooks arrive concurrently", async () => {
    const responses = await Promise.all([answerCall(), answerCall()]);
    expect(responses.filter((response) => response.includes("<Connect"))).toHaveLength(1);
    expect(responses.filter((response) => response.includes("<Gather"))).toHaveLength(1);
  });

  it("reuses only the committed answered workspace and keeps session startup database-light", async () => {
    mock.save.mockImplementationOnce(async (_client, _farm, _context, _event, _now, onAppliedWorkspace) => {
      expect(db.store.row).toBeNull();
      onAppliedWorkspace(answeredFarm());
      return { status: "saved" };
    });
    const ticketValue = ticketIn(await answerCall());
    expect(mock.load).not.toHaveBeenCalled();
    const response = await sessionRoute(signed("/api/voice/realtime/session", { ticket: ticketValue, callSid: CALL }));
    expect(response.status).toBe(200);
    expect(mock.load).not.toHaveBeenCalled();
    expect(row().session.realtime.claimedAt).toBeTruthy();
  });

  it("loads fresh state when the answered event was replayed without a committed snapshot", async () => {
    mock.save.mockResolvedValueOnce({ status: "unchanged" });
    expect(await answerCall()).toContain("<Connect");
    expect(mock.load).toHaveBeenCalledTimes(1);
  });

  it("defers stale cleanup and ignores its failure without losing the stream", async () => {
    let cleanup: (() => Promise<void>) | undefined;
    mock.after.mockImplementationOnce(async (work: () => Promise<void>) => { cleanup = work; });
    expect(await answerCall()).toContain("<Connect");
    expect(cleanup).toBeTypeOf("function");
    db.client.from = () => { throw new Error("cleanup failed"); };
    await expect(cleanup!()).resolves.toBeUndefined();
  });
});

describe("ticket", () => {
  const ticket = { sid: CALL, f: FARM, r: RUN, l: "ar" as const, j: "abc", t: NOW.getTime() };
  it("round trips", () => expect(verifyRealtimeTicket(signRealtimeTicket(ticket, SECRET), SECRET, NOW.getTime(), TICKET_CLAIM_MS)).toEqual(ticket));
  it("rejects a forgery, a call token and a tampered payload", () => {
    const good = signRealtimeTicket(ticket, SECRET);
    const [payload, signature] = good.split(".");
    expect(verifyRealtimeTicket(signRealtimeTicket(ticket, "another-secret"), SECRET, NOW.getTime(), TICKET_CLAIM_MS)).toBeNull();
    expect(verifyRealtimeTicket(signCallToken(token(), SECRET), SECRET, NOW.getTime(), TICKET_CLAIM_MS)).toBeNull();
    expect(verifyRealtimeTicket(`${payload}x.${signature}`, SECRET, NOW.getTime(), TICKET_CLAIM_MS)).toBeNull();
    expect(verifyRealtimeTicket(`${good}.x`, SECRET, NOW.getTime(), TICKET_CLAIM_MS)).toBeNull();
    expect(verifyRealtimeTicket(123, SECRET, NOW.getTime(), TICKET_CLAIM_MS)).toBeNull();
  });
  it("expires", () => {
    expect(verifyRealtimeTicket(signRealtimeTicket(ticket, SECRET), SECRET, NOW.getTime() + TICKET_CLAIM_MS + 1, TICKET_CLAIM_MS)).toBeNull();
  });

  it("is refused on a mismatched call, a bad signature, after expiry, and on reuse", async () => {
    const ticketValue = ticketIn(await answerCall());
    expect((await sessionRoute(signed("/api/voice/realtime/session", { ticket: ticketValue, callSid: OTHER_CALL }))).status).toBe(403);
    expect((await sessionRoute(signed("/api/voice/realtime/session", { ticket: "x.y", callSid: CALL }))).status).toBe(403);

    expect((await sessionRoute(signed("/api/voice/realtime/session", { ticket: ticketValue, callSid: CALL }))).status).toBe(200);
    expect((await sessionRoute(signed("/api/voice/realtime/session", { ticket: ticketValue, callSid: CALL }))).status).toBe(403);
  });

  it("allows only one concurrent claim of prepared instructions", async () => {
    const ticketValue = ticketIn(await answerCall());
    const responses = await Promise.all([1, 2].map(() => sessionRoute(signed("/api/voice/realtime/session", { ticket: ticketValue, callSid: CALL }))));
    expect(responses.map((response) => response.status).sort()).toEqual([200, 403]);
  });

  it("is refused once expired, and a late claim changes nothing", async () => {
    const ticketValue = ticketIn(await answerCall());
    vi.setSystemTime(NOW.getTime() + TICKET_CLAIM_MS + 1000);
    expect((await sessionRoute(signed("/api/voice/realtime/session", { ticket: ticketValue, callSid: CALL }))).status).toBe(403);
    expect(row().session.realtime.claimedAt).toBeNull();
  });

  it("is refused when bound to another farm or run", async () => {
    const stored = ticketIn(await answerCall());
    const { j } = JSON.parse(Buffer.from(stored.split(".")[0], "base64url").toString());
    for (const change of [{ f: "00000000-0000-4000-8000-000000000009" }, { r: "00000000-0000-4000-8000-000000000009" }, { l: "en" as const }]) {
      const forged = signRealtimeTicket({ sid: CALL, f: FARM, r: RUN, l: "ar", j, t: Date.now(), ...change }, SECRET);
      expect((await sessionRoute(signed("/api/voice/realtime/session", { ticket: forged, callSid: CALL }))).status).toBe(403);
    }
    expect(row().session.realtime.claimedAt).toBeNull();
  });

  it("does not spend the ticket when the farm can't be loaded", async () => {
    const ticketValue = ticketIn(await answerCall());
    delete row().session.realtime.instructions;
    forgetCallWorkspace(CALL);
    mock.load.mockRejectedValueOnce(new Error("down"));
    expect((await sessionRoute(signed("/api/voice/realtime/session", { ticket: ticketValue, callSid: CALL }))).status).toBe(503);
    expect((await sessionRoute(signed("/api/voice/realtime/session", { ticket: ticketValue, callSid: CALL }))).status).toBe(200);
  });

  it("claims a prepared session without reloading the farm", async () => {
    const ticketValue = ticketIn(await answerCall());
    mock.load.mockClear();
    expect((await sessionRoute(signed("/api/voice/realtime/session", { ticket: ticketValue, callSid: CALL }))).status).toBe(200);
    expect(mock.load).not.toHaveBeenCalled();
  });

  it("rebuilds instructions after the scripted position changes", async () => {
    const ticketValue = ticketIn(await answerCall());
    row().seq = 1;
    row().session.realtime.instructions = "obsolete";
    forgetCallWorkspace(CALL);
    mock.load.mockClear();
    const response = await sessionRoute(signed("/api/voice/realtime/session", { ticket: ticketValue, callSid: CALL }));
    expect(response.status).toBe(200);
    expect((await response.json()).instructions).not.toBe("obsolete");
    expect(mock.load).toHaveBeenCalledTimes(1);
  });
});

describe("internal signature", () => {
  const body = '{"a":1}';
  const at = NOW.getTime();
  const good = bridgeSignature(String(at), body, SECRET);
  it("accepts the exact body within the window", () => expect(validBridgeSignature(String(at), good, body, SECRET, at + 59_000)).toBe(true));
  it.each([
    ["changed body", String(at), good, '{"a":2}', at],
    ["too old", String(at), good, body, at + 61_000],
    ["too new", String(at), good, body, at - 61_000],
    ["not hex", String(at), "z".repeat(64), body, at],
    ["short", String(at), good.slice(0, 20), body, at],
    ["missing", null, null, body, at],
  ])("rejects %s", (_name, timestamp, signature, raw, now) => {
    expect(validBridgeSignature(timestamp as string | null, signature as string | null, raw as string, SECRET, now as number)).toBe(false);
  });
  it("refuses an unsigned or stale route call before reading the farm", async () => {
    const request = new Request(`${BASE}/api/voice/realtime/session`, { method: "POST", body: "{}" });
    expect((await sessionRoute(request)).status).toBe(403);
    expect((await sessionRoute(signed("/api/voice/realtime/session", {}, Date.now() - 120_000))).status).toBe(403);
    expect((await sessionRoute(signed("/api/voice/realtime/session", {}, Date.now(), "wrong-secret"))).status).toBe(403);
    expect(mock.load).not.toHaveBeenCalled();
  });
});

describe("session response", () => {
  it("returns the rules, tools, opening, locale and a time limit", async () => {
    const { opened } = await open();
    expect(opened.locale).toBe("ar");
    expect(opened.maxSeconds).toBe(600);
    expect(opened.tools.map((item: { name: string }) => item.name)).toEqual(REALTIME_TOOLS.map((item) => item.name));
    expect(opened.opening).toContain("مساعد ناقة الآلي");
    expect(opened.instructions).toContain("بيانات");
    expect(opened.instructions).not.toMatch(/تسجيل|record/i);
    expect(firstPrompt(opened).replies.length).toBeGreaterThan(0);
  });
  it("writes English rules for an English worker", async () => {
    const workspace = answeredFarm();
    workspace.settings.worker.language = "en";
    mock.load.mockResolvedValue({ workspace });
    const { opened } = await open();
    expect(opened.locale).toBe("en");
    expect(opened.instructions).toContain("automated assistant");
    expect(opened.instructions).not.toContain("عزبة دايم");
  });
});

describe("tool validation", () => {
  const session = {
    scenario: "report_call", step: "report_question", inputMode: "choices", done: false, startedAt: NOW.toISOString(), notices: [], turns: [],
    replies: [{ id: "yes", value: "yes", label: { ar: "إيه", en: "Yes" } }, { id: "unknown", value: "unknown", label: { ar: "ما أدري", en: "I do not know" } }],
    data: {}, draft: { answers: [], camelUpdates: [], resourceUpdates: [], herdAccountedFor: null, taskConfirmations: [] },
  } as unknown as CallSession;
  const check = (name: unknown, args: unknown, spoke = true, current = session) => checkTool(name, args, spoke, current, "ar");
  const summary = { ...session, step: "report_summary" };

  it.each([
    ["unknown tool", "delete_farm", {}],
    ["non-string name", 7, {}],
    ["array args", "answer_question", ["yes"]],
    ["null args", "answer_question", null],
    ["no answer", "answer_question", {}],
    ["both keys", "answer_question", { value: "yes", text: "yes" }],
    ["extra field", "answer_question", { value: "yes", note: "x" }],
    ["unlisted value", "answer_question", { value: "maybe" }],
    ["inherited value name", "answer_question", { value: "__proto__" }],
    ["long value", "answer_question", { value: "y".repeat(65) }],
    ["number value", "answer_question", { value: 1 }],
    ["text on a choice", "answer_question", { text: "yes" }],
    ["confirm away from the summary", "confirm_report", { confirmed: true }],
    ["end with a bad reason", "end_call", { reason: "because" }],
    ["end with extra field", "end_call", { reason: "worker_ended", save: true }],
  ])("rejects %s", (_name, name, args) => {
    expect(check(name, args).ok).toBe(false);
  });

  it("takes only a listed value on a choice", () => {
    expect(check("answer_question", { value: "yes" })).toEqual({ ok: true, action: { kind: "answer", input: { value: "yes" } } });
  });

  it("reads Arabic-Indic digits and spoken numbers, and refuses anything else", () => {
    const number = { ...session, inputMode: "number" as const };
    expect(check("answer_question", { text: "٤٢" }, true, number)).toEqual({ ok: true, action: { kind: "answer", input: { text: "42" } } });
    expect(check("answer_question", { text: "ثلاثة" }, true, number)).toEqual({ ok: true, action: { kind: "answer", input: { text: "3" } } });
    expect(check("answer_question", { text: "ما أدري" }, true, number)).toEqual({ ok: true, action: { kind: "answer", input: { value: "unknown" } } });
    expect(check("answer_question", { text: "شوية" }, true, number)).toEqual({ ok: false, error: "number_not_understood" });
    expect(check("answer_question", { text: "x".repeat(301) }, true, { ...session, inputMode: "text" as const })).toEqual({ ok: false, error: "invalid_text" });
    expect(check("answer_question", { text: "bad\u0007" }, true, { ...session, inputMode: "text" as const })).toEqual({ ok: false, error: "invalid_text" });
  });

  it("keeps saving out of answer_question, even with the summary's own value", () => {
    expect(check("answer_question", { value: "confirm_save" }, true, { ...summary, replies: [{ id: "confirm_save", value: "confirm_save", label: { ar: "حفظ", en: "Save" } }] })).toEqual({ ok: false, error: "use_confirm_report" });
  });

  it("needs a boolean to confirm, and the worker's speech to confirm true", () => {
    expect(check("confirm_report", { confirmed: "yes" }, true, summary).ok).toBe(false);
    expect(check("confirm_report", { confirmed: true, extra: 1 }, true, summary).ok).toBe(false);
    expect(check("confirm_report", { confirmed: true }, false, summary)).toEqual({ ok: false, error: "worker_has_not_confirmed" });
    expect(check("confirm_report", { confirmed: false }, false, summary)).toEqual({ ok: true, action: { kind: "confirm", confirmed: false } });
    expect(check("confirm_report", { confirmed: true }, true, summary)).toEqual({ ok: true, action: { kind: "confirm", confirmed: true } });
  });
});

describe("tool calls on a live call", () => {
  it("refuses an answer without a fresh committed worker turn", async () => {
    const { ticket, opened } = await open();
    const before = JSON.stringify(row());
    const result = await tool(ticket, "answer_question", { value: firstPrompt(opened).replies[0].value }, { userSpokeSinceLastTool: false });
    expect(result.output.error).toBe("worker_has_not_answered");
    expect(JSON.stringify(row())).toBe(before);
  });
  it("refuses an invalid call without moving the call", async () => {
    const { ticket } = await open();
    const before = row().seq;
    const refused = await tool(ticket, "answer_question", { value: "nope" });
    expect(refused.output).toMatchObject({ status: "invalid", error: "value_not_allowed" });
    expect(refused.output.replies.length).toBeGreaterThan(0);
    expect(refused.result.end).toBeNull();
    expect(row().seq).toBe(before);
    expect(mock.load).toHaveBeenCalledTimes(1);
  });

  it("refuses a ticket that was never claimed, or from another call", async () => {
    const ticket = ticketIn(await answerCall());
    expect((await tool(ticket, "answer_question", { value: "yes" })).status).toBe(403);
    expect((await tool(ticket, "answer_question", { value: "yes" }, { callSid: OTHER_CALL })).status).toBe(403);
    expect((await tool("bad.ticket", "answer_question", { value: "yes" })).status).toBe(403);
  });

  it("rejects a malformed envelope", async () => {
    const { ticket } = await open();
    expect((await tool(ticket, "answer_question", {}, { toolCallId: "has spaces" })).status).toBe(400);
    expect((await tool(ticket, "answer_question", {}, { userSpokeSinceLastTool: "yes" })).status).toBe(400);
  });

  it.each([
    ["العلف زين", "answer_off_topic"],
    ["الجو حار اليوم", "answer_unclear"],
    ["", "answer_unclear"],
  ])("does not let %s answer the herd-health question", async (workerUtterance, error) => {
    const { ticket } = await open();
    const seq = row().seq;
    const result = await tool(ticket, "answer_question", { value: "yes" }, { workerUtterance });
    expect(result.result.awaitingConfirmation).toBe(false);
    expect(result.output).toMatchObject({ status: "invalid", error });
    expect(row().seq).toBe(seq);
    expect(row().session.draft.camelUpdates).toHaveLength(0);
  });

  it("applies a repeated toolCallId once, and returns its first result", async () => {
    const { ticket, opened } = await open();
    const value = firstPrompt(opened).replies[0].value;
    const body = { ticket, callSid: CALL, toolCallId: "call_same", name: "answer_question", args: { value }, userSpokeSinceLastTool: true, workerUtterance: "إيه تمام" };
    const first = await (await toolRoute(signed("/api/voice/realtime/tool", body))).json();
    const seq = row().seq;
    const second = await (await toolRoute(signed("/api/voice/realtime/tool", body))).json();
    expect(second).toEqual(first);
    expect(row().seq).toBe(seq);
  });

  it("keeps the scripted Gather current after each step", async () => {
    const { ticket, opened } = await open();
    await tool(ticket, "answer_question", { value: firstPrompt(opened).replies[0].value });
    expect(row().last_response).toContain("<Gather");
    expect(row().last_response).toContain(`/api/voice/turn?n=${row().seq}`);
  });

  it("gives the model only the question, replies and summary, personalised", async () => {
    const workspace = answeredFarm();
    workspace.settings.worker.name = "سالم";
    workspace.settings.customQuestions = [];
    mock.load.mockResolvedValue({ workspace });
    const { opened, ticket } = await open();
    expect(opened.opening).toContain("سالم");
    expect(opened.opening).not.toContain("أحمد");
    const summary = await reachSummary(ticket, firstPrompt(opened));
    expect(summary).toMatchObject({ isSummary: true, summary: expect.stringContaining("أحفظه") });
    expect(summary.replies.map((item) => item.value)).toEqual(["confirm_save", "end_without_save"]);
  });

  it("can't confirm without the worker speaking, and won't save at the summary without confirm_report", async () => {
    const { ticket, opened } = await open();
    await reachSummary(ticket, firstPrompt(opened));
    const seq = row().seq;

    const blocked = await tool(ticket, "confirm_report", { confirmed: true }, { userSpokeSinceLastTool: false });
    expect(blocked.output).toMatchObject({ status: "invalid", error: "worker_has_not_confirmed" });
    expect(blocked.result.awaitingConfirmation).toBe(true);
    const viaAnswer = await tool(ticket, "answer_question", { value: "confirm_save" });
    expect(viaAnswer.output.error).toBe("use_confirm_report");
    expect(row().seq).toBe(seq);
    expect(mock.save.mock.calls.filter((call) => call[3].type === "worker_report")).toHaveLength(0);
  });

  it("saves one correctly mapped report, tells the owner once, and claims saved only then", async () => {
    const { ticket, opened } = await open();
    await reachSummary(ticket, firstPrompt(opened));
    const done = await tool(ticket, "confirm_report", { confirmed: true });

    expect(done.result).toMatchObject({ end: "hangup", awaitingConfirmation: false });
    expect(done.output.status).toBe("saved");
    expect(done.result.goodbye).toContain("تم حفظ");
    const reports = mock.save.mock.calls.filter((call) => call[3].type === "worker_report");
    expect(reports).toHaveLength(1);
    const [, farmId, context, event] = reports[0];
    expect(farmId).toBe(FARM);
    expect(context).toEqual({ party: "worker" });
    expect(event).toMatchObject({ eventId: `${CALL}:report`, providerCallId: CALL, reportCallId: RUN });
    expect(event.draft.answers.length).toBeGreaterThan(0);
    expect(event.draft.camelUpdates.length).toBeGreaterThan(0);
    expect(mock.owner).toHaveBeenCalledTimes(1);
    expect(mock.owner).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ farmId: FARM, reportCallId: RUN }));

    // A finished call keeps no facts: only the closing result and goodbye.
    expect(row().session.done).toBe(true);
    expect(row().session.draft.answers).toEqual([]);
    expect(row().session.realtime.recent).toHaveLength(1);
    expect(row().last_response).toContain("<Hangup/>");
  });

  it("does not claim saved when the report is refused", async () => {
    const { ticket, opened } = await open();
    await reachSummary(ticket, firstPrompt(opened));
    mock.save.mockResolvedValueOnce({ status: "rejected", reason: "call_not_active" });
    const done = await tool(ticket, "confirm_report", { confirmed: true });
    expect(done.output.status).toBe("not_saved");
    expect(done.result.goodbye).toContain("ما انحفظ");
    expect(mock.owner).not.toHaveBeenCalled();
  });

  it("confirmed false ends the call the scripted way, without a report", async () => {
    const { ticket, opened } = await open();
    await reachSummary(ticket, firstPrompt(opened));
    const done = await tool(ticket, "confirm_report", { confirmed: false }, { userSpokeSinceLastTool: false });
    expect(done.output.status).toBe("ended_without_saving");
    expect(done.result.end).toBe("hangup");
    expect(done.result.goodbye).toContain("ما انحفظ");
    expect(mock.save.mock.calls.filter((call) => call[3].type === "worker_report")).toHaveLength(0);
    expect(mock.save.mock.calls.at(-1)![3]).toMatchObject({ type: "report_call_ended", eventId: `${CALL}:ended`, reportCallId: RUN });
    expect(mock.owner).not.toHaveBeenCalled();
  });

  it("ends a call early without saving anything", async () => {
    const { ticket } = await open();
    const saves = mock.save.mock.calls.length;
    const done = await tool(ticket, "end_call", { reason: "worker_ended" });
    expect(done.output.status).toBe("ended_without_saving");
    expect(done.result.goodbye).toContain("ما انحفظ");
    expect(mock.save.mock.calls).toHaveLength(saves);
    expect(row().session.done).toBe(true);
  });

  it("falls back on a database failure, without claiming a save", async () => {
    const { ticket, opened } = await open();
    forgetCallWorkspace(CALL);
    mock.load.mockRejectedValueOnce(new Error("down"));
    const seq = row().seq;
    const failed = await tool(ticket, "answer_question", { value: firstPrompt(opened).replies[0].value });
    expect(failed.result).toMatchObject({ end: "fallback", goodbye: null });
    expect(failed.result.output).not.toMatch(/"status":"saved"/);
    expect(row().seq).toBe(seq);
  });

  it("falls back where the scripted call would retry a save, and keeps the summary for it", async () => {
    const { ticket, opened } = await open();
    await reachSummary(ticket, firstPrompt(opened));
    mock.save.mockRejectedValueOnce(new Error("down"));
    const failed = await tool(ticket, "confirm_report", { confirmed: true });
    expect(failed.result.end).toBe("fallback");
    expect(failed.output.status).toBe("error");
    expect(row().misses).toBe(1);
    expect(row().session.done).toBe(false);
    expect(row().session.step).toBe("report_summary");
    expect(row().last_response).toContain("ما قدرت أتأكد من الحفظ");
    expect(mock.owner).not.toHaveBeenCalled();
  });

  it("uses honest wording when a save fails for good", async () => {
    const { ticket, opened } = await open();
    await reachSummary(ticket, firstPrompt(opened));
    mock.save.mockRejectedValue(new Error("down"));
    expect((await tool(ticket, "confirm_report", { confirmed: true })).result.end).toBe("fallback");
    const failed = await tool(ticket, "confirm_report", { confirmed: true });
    expect(failed.output.status).toBe("save_failed");
    expect(failed.result.end).toBe("hangup");
    expect(failed.result.goodbye).toContain("ما قدرت أتأكد");
  });

  it("logs no answers, numbers or transcripts", async () => {
    const info = vi.spyOn(console, "info");
    const { ticket } = await open();
    await tool(ticket, "answer_question", { value: "secret-value" });
    const logged = info.mock.calls.flat().join(" ");
    expect(logged).not.toContain("secret-value");
    expect(logged).not.toContain(CALL);
  });
});

describe("verified realtime confirmation", () => {
  it.each(["", "ضجيج", "لا", "إيه بس العلف غلط", "صح لكن", "yes but change the feed", "لا تحفظه", "إيه لا", "صح مو صحيح", "yes if the owner agrees", "إيه إذا وافق المالك", "yes maybe", "صح يمكن", "he said yes", "قال صح", "is that correct?", "صح؟"])("refuses %j without changing the engine or saving", async (workerUtterance) => {
    const { ticket, opened } = await open();
    await reachSummary(ticket, firstPrompt(opened));
    const before = JSON.stringify({ data: row().session.data, seq: row().seq, misses: row().misses, turns: row().session.turns });
    const result = await tool(ticket, "confirm_report", { confirmed: true }, { workerUtterance });
    expect(result.output.error).toBe("worker_has_not_confirmed");
    expect(result.output.message).toContain("confirm clearly");
    expect(result.result.end).toBeNull();
    expect(JSON.stringify({ data: row().session.data, seq: row().seq, misses: row().misses, turns: row().session.turns })).toBe(before);
    expect(mock.save.mock.calls.filter((call) => call[3].type === "worker_report")).toHaveLength(0);
  });

  it.each(["ماهو صحيح", "مهوب صحيح", "ماهي صحيحة"])("refuses a joined negation: %s", async (workerUtterance) => {
    const { ticket, opened } = await open();
    await reachSummary(ticket, firstPrompt(opened));
    const result = await tool(ticket, "confirm_report", { confirmed: true }, { workerUtterance });
    expect(result.output.error).toBe("worker_has_not_confirmed");
    expect(result.result.summaryText).toBeUndefined();
    expect(mock.save.mock.calls.filter((call) => call[3].type === "worker_report")).toHaveLength(0);
  });

  it.each([undefined, false])("requires affirmative playback evidence (%j)", async (heardSummary) => {
    const { ticket, opened } = await open();
    await reachSummary(ticket, firstPrompt(opened));
    const result = await tool(ticket, "confirm_report", { confirmed: true }, { heardSummary });
    expect(result.output.error).toBe("summary_not_finished");
    expect(result.output.summary).toContain("أحفظه");
    expect(result.result.summaryText).toContain("أحفظه");
    expect(mock.save.mock.calls.filter((call) => call[3].type === "worker_report")).toHaveLength(0);
    const confirmed = await tool(ticket, "confirm_report", { confirmed: true });
    expect(confirmed.output.status).toBe("saved");
    expect(mock.save.mock.calls.filter((call) => call[3].type === "worker_report")).toHaveLength(1);
  });

  it("falls back after two unique failures, replays retries, and the script can still confirm by keypad", async () => {
    const { ticket, opened } = await open();
    await reachSummary(ticket, firstPrompt(opened));
    const first = await tool(ticket, "confirm_report", { confirmed: true }, { workerUtterance: undefined });
    const firstId = `call_${toolCounter}`;
    const repeat = await tool(ticket, "confirm_report", { confirmed: true }, { toolCallId: firstId, workerUtterance: "yes" });
    expect(repeat.result).toEqual(first.result);
    const second = await tool(ticket, "confirm_report", { confirmed: true }, { workerUtterance: "لا" });
    expect(second.result).toMatchObject({ end: "fallback", goodbye: null });
    expect(row().session.done).toBe(false);
    expect(row().session.step).toBe("report_summary");
    expect(row().session.realtime.closed).toBe(true);
    expect((await tool(ticket, "confirm_report", { confirmed: true })).result.end).toBe("fallback");
    expect(mock.save.mock.calls.filter((call) => call[3].type === "worker_report")).toHaveLength(0);
    const xml = await answerFarmCall(db.client, { callSid: CALL, seq: row().seq, speech: "", digits: "1", confidence: null, now: new Date() });
    expect(xml).toContain("تم حفظ");
    expect(mock.save.mock.calls.filter((call) => call[3].type === "worker_report")).toHaveLength(1);
  });

  it.each(["yes if the owner agrees", "he said yes", "قال صح", "صح؟"])("keeps the same confirmation gate after scripted fallback: %s", async (speech) => {
    const { ticket, opened } = await open();
    await reachSummary(ticket, firstPrompt(opened));
    await tool(ticket, "confirm_report", { confirmed: true }, { workerUtterance: "لا" });
    await tool(ticket, "confirm_report", { confirmed: true }, { workerUtterance: "لا" });
    expect(row().session.realtime.closed).toBe(true);
    const response = await answerFarmCall(db.client, { callSid: CALL, seq: row().seq, speech, digits: null, now: new Date() });
    expect(response).toContain("<Gather");
    expect(row().session.step).toBe("report_summary");
    expect(mock.save.mock.calls.filter((call) => call[3].type === "worker_report")).toHaveLength(0);
  });

  it.each(["إيه", "صح", "تمام", "احفظه", "إيه صح", "نعم صحيح", "تمام احفظه", "yes", "yes save it", "that is correct", "إيه تمام", "تأكيد وحفظ", "confirm and save"])("accepts the existing parser's clear confirmation %s exactly once", async (workerUtterance) => {
    const { ticket, opened } = await open();
    await reachSummary(ticket, firstPrompt(opened));
    const result = await tool(ticket, "confirm_report", { confirmed: true }, { workerUtterance });
    expect(result.output.status).toBe("saved");
    await tool(ticket, "confirm_report", { confirmed: true }, { workerUtterance });
    expect(mock.save.mock.calls.filter((call) => call[3].type === "worker_report")).toHaveLength(1);
  });

  it("bounds and validates the additive fields", async () => {
    const { ticket } = await open();
    for (const extra of [{ workerUtterance: "a".repeat(1001) }, { workerUtterance: 1 }, { workerUtterance: "yes\n" }, { heardSummary: "yes" }]) {
      expect((await tool(ticket, "confirm_report", { confirmed: true }, extra)).status).toBe(400);
    }
  });

  it("never persists or logs the worker transcript, including failures", async () => {
    const info = vi.spyOn(console, "info");
    const { ticket, opened } = await open();
    await reachSummary(ticket, firstPrompt(opened));
    const workerUtterance = "إيه بس العلف غلط secret-transcript-canary";
    await tool(ticket, "confirm_report", { confirmed: true }, { workerUtterance });
    expect(JSON.stringify(db.store)).not.toContain(workerUtterance);
    expect(JSON.stringify(info.mock.calls)).not.toContain(workerUtterance);
    expect(JSON.stringify(mock.save.mock.calls)).not.toContain(workerUtterance);
  });
});

describe("per-call farm", () => {
  it("loads the farm at most once for a whole call, and forgets it when the call ends", async () => {
    const { ticket, opened } = await open();
    mock.load.mockClear();
    await reachSummary(ticket, firstPrompt(opened));
    expect(mock.load.mock.calls.length).toBeLessThanOrEqual(1);
    await tool(ticket, "confirm_report", { confirmed: true });
    mock.load.mockClear();
    expect(callWorkspace(CALL, new Date())).toBeNull();
  });
});

describe("after the stream", () => {
  const afterUrl = () => `/api/voice/realtime/after?s=${encodeURIComponent(signCallToken(token(), SECRET))}`;

  it("blocks an in-flight confirmation after fallback while the farm load is pending", async () => {
    const { ticket, opened } = await open();
    await reachSummary(ticket, firstPrompt(opened));
    forgetCallWorkspace(CALL);
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    mock.load.mockImplementationOnce(async () => { entered(); await gate; return { workspace: answeredFarm() }; });
    const pending = tool(ticket, "confirm_report", { confirmed: true });
    await started;
    const seq = row().seq;
    expect(await (await afterRoute(twilio(afterUrl(), { CallSid: CALL }))).text()).toContain("<Gather");
    release();
    expect((await pending).result.end).toBe("fallback");
    expect(row().seq).toBe(seq);
    expect(row().session.realtime.closed).toBe(true);
    expect(mock.save.mock.calls.filter((call) => call[3].type === "worker_report")).toHaveLength(0);
  });

  it("atomically fences late row and realtime-metadata writes even if seq has not moved", async () => {
    await open();
    const stale = JSON.parse(JSON.stringify(db.store.row)) as import("@/server/db/voice-sessions").VoiceSessionRow;
    const realtime = realtimeOf(stale.session)!;
    await afterRoute(twilio(afterUrl(), { CallSid: CALL }));
    const before = JSON.stringify(row());
    expect(await advanceRow(db.client, stale, stale.session, 0, "late", undefined, true)).toBeNull();
    expect(await recordConfirmationFailure(db.client, stale, { ...realtime, confirmationFailures: 1 })).toBeNull();
    expect(JSON.stringify(row())).toBe(before);
  });

  it("replays the honest goodbye if save failure ended the session before playback", async () => {
    const { ticket, opened } = await open();
    await reachSummary(ticket, firstPrompt(opened));
    mock.save.mockRejectedValue(new Error("down"));
    await tool(ticket, "confirm_report", { confirmed: true });
    expect((await tool(ticket, "confirm_report", { confirmed: true })).output.status).toBe("save_failed");
    const xml = await (await afterRoute(twilio(afterUrl(), { CallSid: CALL }))).text();
    expect(xml).toBe(row().last_response);
    expect(xml).toContain("فضلاً اتصل مرة ثانية");
    expect(xml).toContain("<Say");
  });

  it("replays the not-saved goodbye rather than hanging up silently", async () => {
    const { ticket } = await open();
    await tool(ticket, "end_call", { reason: "worker_ended" });
    const xml = await (await afterRoute(twilio(afterUrl(), { CallSid: CALL }))).text();
    expect(xml).toBe(row().last_response);
    expect(xml).toContain("ما انحفظ");
  });

  it("resumes the scripted Gather at the current question, and blocks late tool calls", async () => {
    const { ticket, opened } = await open();
    await tool(ticket, "answer_question", { value: firstPrompt(opened).replies[0].value });
    const current = row().last_response;
    const response = await afterRoute(twilio(afterUrl(), { CallSid: CALL }));
    expect(await response.text()).toBe(current);
    expect(current).toContain("<Gather");
    expect(row().session.realtime.closed).toBe(true);

    const seq = row().seq;
    const late = await tool(ticket, "answer_question", { value: "yes" });
    expect(late.result.end).toBe("fallback");
    expect(row().seq).toBe(seq);

    // The script takes over on the same row, at the numbered turn.
    const xml = await answerFarmCall(db.client, { callSid: CALL, seq, speech: "", digits: null, confidence: null, now: new Date() });
    expect(xml).toContain("<Gather");
    expect(row().seq).toBe(seq + 1);
  });

  it("repeats the same reply for a repeated webhook", async () => {
    await open();
    const first = await (await afterRoute(twilio(afterUrl(), { CallSid: CALL }))).text();
    expect(await (await afterRoute(twilio(afterUrl(), { CallSid: CALL }))).text()).toBe(first);
  });

  it("hangs up on a finished call without repeating the bridge's goodbye", async () => {
    const { ticket, opened } = await open();
    await reachSummary(ticket, firstPrompt(opened));
    await tool(ticket, "confirm_report", { confirmed: true });
    const xml = await (await afterRoute(twilio(afterUrl(), { CallSid: CALL }))).text();
    expect(xml).toBe("<Response><Hangup/></Response>");
  });

  it("refuses a bad signature or token, and hangs up on another farm's call", async () => {
    await open();
    const url = `${BASE}${afterUrl()}`;
    const bad = new Request(url, { method: "POST", headers: { "X-Twilio-Signature": "wrong" }, body: new URLSearchParams({ CallSid: CALL }) });
    expect((await afterRoute(bad)).status).toBe(403);
    expect((await afterRoute(twilio("/api/voice/realtime/after?s=nope", { CallSid: CALL }))).status).toBe(403);
    const other = encodeURIComponent(signCallToken({ ...token(), f: "00000000-0000-4000-8000-000000000009" }, SECRET));
    expect(await (await afterRoute(twilio(`/api/voice/realtime/after?s=${other}`, { CallSid: CALL }))).text()).toContain("<Hangup/>");
  });
});
