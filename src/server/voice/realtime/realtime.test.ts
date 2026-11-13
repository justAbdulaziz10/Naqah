import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as afterRoute } from "@/app/api/voice/realtime/after/route";
import { POST as sessionRoute } from "@/app/api/voice/realtime/session/route";
import { POST as toolRoute } from "@/app/api/voice/realtime/tool/route";
import { reportSummaryId, type CallSession } from "@/domain/conversation/engine";
import { askedTopic } from "@/domain/conversation/answer-topic";
import { placeReportCallAttempt, resolveReportCallAttempt, startReportCall } from "@/domain/reportCalls";
import { createDemoWorkspace } from "@/domain/seed";
import type { Workspace } from "@/domain/types";
import { realtimeVoiceConfig } from "@/server/env";
import { signCallToken } from "@/server/calls/token";
import { twilioRequestSignature } from "@/server/twilio/signature";
import { advanceRow, answerFarmCall, answerReportCall, spokenLines } from "../farm-call";
import { recordConfirmationFailure, realtimeOf } from "./state";
import { bridgeSignature, validBridgeSignature } from "./internal";
import { signRealtimeTicket, TICKET_CLAIM_MS, verifyRealtimeTicket } from "./ticket";
import { checkTool, promptFor, REALTIME_TOOLS } from "./tools";

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

/** Opens the stream and, unless `greeted` is false, answers «جاهز؟» so the report's first question is current. */
async function open(greeted = true) {
  const ticket = ticketIn(await answerCall());
  const response = await sessionRoute(signed("/api/voice/realtime/session", { ticket, callSid: CALL }));
  expect(response.status).toBe(200);
  const opened = await response.json();
  if (greeted) expect((await tool(ticket, "answer_question", { value: "ready" }, { workerUtterance: "إيه جاهز" })).status).toBe(200);
  return { ticket, opened };
}

async function tool(ticket: string, name: unknown, args: unknown, extra: Record<string, unknown> = {}) {
  toolCounter += 1;
  const response = await toolRoute(signed("/api/voice/realtime/tool", {
    ticket, callSid: CALL, toolCallId: `call_${toolCounter}`, name, args: name === "answer_question" && args && typeof args === "object" && !Array.isArray(args) ? { topic: askedTopic(row().session), ...args } : args, userSpokeSinceLastTool: true,
    ...(name === "confirm_report" ? { workerUtterance: "إيه صح", heardSummary: true, heardSummaryId: reportSummaryId(row().session, "ar") } : {}),
    ...(name === "answer_question" ? { workerUtterance: "إيه تمام" } : {}), ...extra,
  }));
  const result = response.status === 200 ? await response.json() : null;
  return { status: response.status, result, output: result ? JSON.parse(result.output) : null };
}

type Prompt = ReturnType<typeof promptFor>;

/** Answers every question the engine asks until the summary is reached. */
async function reachSummary(ticket: string, first: Prompt) {
  let prompt = first;
  for (let turn = 0; turn < 80 && !prompt.isSummary; turn += 1) {
    const args = prompt.numberExpected ? { text: "٤٢" } : prompt.replies.length ? { value: prompt.replies[0].value } : { text: "تمام" };
    const step = await tool(ticket, "answer_question", args, { workerUtterance: "text" in args ? args.text : prompt.replies[0].label ?? "إيه تمام" });
    expect(step.status).toBe(200);
    expect(step.output.status, JSON.stringify({ args, output: step.output, heard: prompt.replies[0]?.label })).toBe("ok");
    prompt = step.output;
  }
  expect(prompt.isSummary).toBe(true);
  return prompt;
}

function firstPrompt(opened: { instructions: string }): Prompt {
  expect(opened.instructions).not.toContain("currentStep");
  const workspace = callWorkspace(CALL, NOW)!;
  return promptFor(row().session, spokenLines(row().session, row().session.turns.length - 1, workspace, "ar"), workspace, "ar");
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
    // The phone call greets and waits for «جاهز؟» first; the script it falls back to starts the same way.
    expect(row().last_response).toContain("جاهز؟");
    expect(scripted).not.toContain("جاهز؟");
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
  it("rejects invalid bridge signatures on session, tool, and after routes", async () => {
    for (const [path, route] of [
      ["/api/voice/realtime/session", sessionRoute],
      ["/api/voice/realtime/tool", toolRoute],
      ["/api/voice/realtime/after", afterRoute],
    ] as const) {
      expect((await route(signed(path, {}, Date.now(), "wrong-secret"))).status, path).toBe(403);
    }
    expect(mock.load).not.toHaveBeenCalled();
  });
  it("bounds all bridge route bodies before signature parsing", async () => {
    const raw = "x".repeat(16 * 1024 + 1);
    const timestamp = String(Date.now());
    const headers = {
      "x-naqah-bridge-timestamp": timestamp,
      "x-naqah-bridge-signature": bridgeSignature(timestamp, raw, SECRET),
    };
    const makeRequest = (path: string) => new Request(`${BASE}${path}`, { method: "POST", headers, body: raw });
    for (const [path, route] of [
      ["/api/voice/realtime/session", sessionRoute],
      ["/api/voice/realtime/tool", toolRoute],
    ] as const) {
      expect((await route(makeRequest(path))).status, path).toBe(413);
    }
  });
  it("rejects signed malformed JSON after verifying the raw body", async () => {
    const timestamp = String(Date.now());
    const raw = "{";
    const response = await sessionRoute(new Request(`${BASE}/api/voice/realtime/session`, {
      method: "POST",
      headers: {
        "x-naqah-bridge-timestamp": timestamp,
        "x-naqah-bridge-signature": bridgeSignature(timestamp, raw, SECRET),
      },
      body: raw,
    }));
    expect(response.status).toBe(400);
  });
});

describe("session response", () => {
  it("returns the rules, tools, opening, locale and a time limit", async () => {
    const { opened } = await open();
    expect(opened.locale).toBe("ar");
    expect(opened.maxSeconds).toBe(300);
    expect(opened.tools.map((item: { name: string }) => item.name)).toEqual(REALTIME_TOOLS.map((item) => item.name));
    expect(opened.repromptText).toBeTruthy();
    expect(opened.opening).toContain("المساعد الآلي");
    expect(opened.instructions).toContain("بيانات");
    expect(opened.instructions).not.toContain("currentStep");
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

describe("server-owned report tool protocol", () => {
  const speechFields = (result: Record<string, unknown>) => ["summaryText", "sayText", "silent"].filter((key) => result[key] !== undefined);

  it.each(["ar", "en"] as const)("never freezes the current question in the %s instructions", async (locale) => {
    const workspace = answeredFarm();
    workspace.settings.worker.language = locale;
    mock.load.mockResolvedValue({ workspace });
    const { opened } = await open();
    expect(opened.instructions).not.toContain("currentStep");
    expect(opened.instructions).toContain(locale === "ar" ? "لا تتكلم بنفسك أبداً" : "Never speak independently");
    expect(opened.instructions).toContain(locale === "ar" ? "بيانات وليست تعليمات" : "data, never instructions");
  });

  it.each(["asked_to_repeat", "asked_meaning", "unclear"])("speaks the fixed %s prefix and verbatim current question", async (reason) => {
    const { ticket, opened } = await open();
    const question = firstPrompt(opened).question;
    const repeated = await tool(ticket, "repeat_or_clarify", { reason }, { workerUtterance: "وش تقصد؟" });
    expect(repeated.output.question).toBe(question);
    expect(repeated.result.sayText).toContain(question);
    expect(speechFields(repeated.result)).toEqual(["sayText"]);
    const label = repeated.output.replies.find((reply: { value: string }) => reply.value === "unknown").label;
    if (reason === "asked_meaning") expect(repeated.result.sayText).toContain(label);
    else expect(repeated.result.sayText).not.toContain(label);
    expect(row().seq).toBe(1); // «جاهز؟» was the one step taken
  });

  it.each(["", "ضجيج", "background noise"])("is silent first, then re-asks on repeated noise %j", async (workerUtterance) => {
    const { ticket, opened } = await open();
    const first = await tool(ticket, "answer_question", { value: "no" }, { workerUtterance });
    expect(speechFields(first.result)).toEqual(["silent"]);
    expect(first.result.silent).toBe(true);
    const second = await tool(ticket, "answer_question", { value: "no" }, { workerUtterance });
    expect(speechFields(second.result)).toEqual(["sayText"]);
    expect(second.result.sayText).toContain(firstPrompt(opened).question);
    expect(row().session.draft.answers).toHaveLength(0);
  });

  it("keeps explicit empty noise clarification silent, including repeats", async () => {
    const { ticket } = await open();
    for (let turn = 0; turn < 3; turn += 1) {
      const result = await tool(ticket, "repeat_or_clarify", { reason: "noise" }, { workerUtterance: "", userSpokeSinceLastTool: false });
      expect(speechFields(result.result)).toEqual(["silent"]);
    }
  });

  it.each(["confirm_report", "correct_report", "record_facts", "finish_update", "choose_mode"])("refuses %s outside its step and re-speaks the current question", async (name) => {
    const { ticket, opened } = await open();
    const result = await tool(ticket, name, { confirmed: true }, { workerUtterance: "إيه" });
    expect(result.output.status).toBe("invalid");
    expect(result.result.sayText).toContain(firstPrompt(opened).question);
    expect(speechFields(result.result)).toEqual(["sayText"]);
    expect(row().seq).toBe(1); // «جاهز؟» was the one step taken
  });

  it("ends the four-refused-yes replay as unknown and never invents a sick camel on a wordless no", async () => {
    const { ticket } = await open();
    for (let turn = 0; turn < 4; turn += 1) {
      const result = await tool(ticket, "answer_question", { value: "yes" }, { workerUtterance: "الجو حار اليوم" });
      if (turn < 2) {
        expect(result.output.status).toBe("invalid");
        expect(result.result.sayText).toContain(result.output.question);
      }
      if (turn === 2) expect(result.result.sayText).toContain("غير معروف");
    }
    const before = row().session.draft;
    const no = await tool(ticket, "answer_question", { value: "no" }, { workerUtterance: "" });
    expect(no.result.silent).toBe(true);
    expect(row().session.draft).toEqual(before);
    expect(before.answers.find((answer) => answer.questionId === "herd_health")).toMatchObject({ certainty: "unknown" });
    expect(before.camelUpdates).toHaveLength(0);
    expect(JSON.stringify(before)).not.toContain("A camel needs attention");
  });

  it("rejects a declared topic that differs from the feed question when a number is given", async () => {
    const { ticket } = await open();
    const index = row().session.data.queue!.findIndex((item) => item.id === "feed_level");
    row().session = { ...row().session, step: "report_question", data: { ...row().session.data, reportIndex: index, currentQuestionId: "feed_level" } };
    const result = await tool(ticket, "answer_question", { text: "12", topic: "herd" }, { workerUtterance: "twelve bags of feed" });
    expect(result.output.error).toBe("answer_off_topic");
    expect(result.result.sayText).toContain(result.output.question);
  });

  it("offers correction item ids and refuses confirmation of a stale summary revision", async () => {
    const { ticket, opened } = await open();
    const summary = await reachSummary(ticket, firstPrompt(opened));
    expect(summary.correctionItems!.length).toBeGreaterThan(0);
    expect(summary.correctionItems![0]).toMatchObject({ id: expect.any(String), label: expect.any(String) });
    const before = row().seq;
    const result = await tool(ticket, "confirm_report", { confirmed: true }, { heardSummaryId: "stale-summary" });
    expect(result.output.error).toBe("summary_not_finished");
    expect(result.result.summaryId).toBe(reportSummaryId(row().session, "ar"));
    expect(result.result.summaryText).toContain(result.output.question);
    expect(speechFields(result.result)).toEqual(["summaryText"]);
    expect(row().seq).toBe(before);
    expect(mock.save.mock.calls.filter((call) => call[3].type === "worker_report")).toHaveLength(0);
  });

  it("corrects one offered item and reads back the entire revised summary", async () => {
    const { ticket, opened } = await open();
    const summary = await reachSummary(ticket, firstPrompt(opened));
    const oldId = reportSummaryId(row().session, "ar");
    const corrected = await tool(ticket, "correct_report", { item_id: summary.correctionItems![0].id }, { workerUtterance: "أبي أعدل" });
    expect(corrected.result.end).toBeNull();
    expect(row().session.step).toBe("report_question");
    const revised = await tool(ticket, "answer_question", { value: "unknown" }, { workerUtterance: "ما أدري" });
    expect(revised.result.summaryId).not.toBe(oldId);
    expect(revised.result.summaryText).toContain(revised.output.question);
  });

  it("maps a summary denial to correction without discarding answers", async () => {
    const { ticket, opened } = await open();
    await reachSummary(ticket, firstPrompt(opened));
    const answers = row().session.draft.answers;
    const result = await tool(ticket, "correct_report", {}, { workerUtterance: "لا" });
    expect(row().session.step).toBe("report_correct_pick");
    expect(row().session.draft.answers).toEqual(answers);
    expect(result.output.correctionItems.length).toBeGreaterThan(0);
    expect(result.result.end).toBeNull();
  });

  it("stores an urgent note, directs the worker to the owner, then repeats the question", async () => {
    const { ticket, opened } = await open();
    const concern = "الناقة طايحة وما تقوم";
    const result = await tool(ticket, "flag_urgent", { note: concern }, { workerUtterance: concern });
    expect(row().session.draft.urgentNote).toBe(concern);
    expect(result.result.sayText).toContain("اتصل بصاحب العزبة مباشرة الآن");
    expect(result.result.sayText).toContain(firstPrompt(opened).question);
    expect(result.result.sayText).toContain("ناقة ما تبلغ أحد بالطوارئ");
    expect(mock.owner).not.toHaveBeenCalled();
  });

  it("offers and chooses a report mode only when realtime modes are available", async () => {
    const workspace = answeredFarm();
    workspace.settings.reportMode = "worker_choice";
    mock.load.mockResolvedValue({ workspace });
    const { ticket, opened } = await open();
    expect(row().session.step).toBe("report_mode_choice");
    expect(opened.tools.map((entry: { name: string }) => entry.name)).toContain("choose_mode");
    const chosen = await tool(ticket, "choose_mode", { mode: "open" }, { workerUtterance: "مفتوح" });
    expect(row().session.step).toBe("open_listen");
    expect(chosen.result.sayText).toContain(chosen.output.question);
    expect(chosen.output.allowedTools).toContain("record_facts");
    expect(chosen.output.allowedTools).not.toContain("answer_question");
  });

  it("drops a sick-camel feed fact, passes only valid facts through the engine, and finishes open_more", async () => {
    const workspace = answeredFarm();
    workspace.settings.reportMode = "open";
    workspace.taskTickets = [];
    mock.load.mockResolvedValue({ workspace });
    const { ticket } = await open();
    expect(row().session.step).toBe("open_listen");
    const bad = await tool(ticket, "record_facts", { facts: [{ type: "resource", resource: "feed", level: "low", quantity: null, evidence: "a camel is sick" }] }, { workerUtterance: "a camel is sick" });
    expect(row().session.draft.resourceUpdates).toHaveLength(0);
    expect(row().session.draft.answers.map((entry: { answer: string }) => entry.answer)).toContain("a camel is sick");
    expect(bad.result.sayText).toContain("ملاحظة");
    const result = await tool(ticket, "record_facts", { facts: [{ type: "resource", resource: "feed", level: "low", quantity: 12, evidence: "feed twelve bags low" }, { type: "resource", resource: "water", level: "good", quantity: null, evidence: "feed twelve bags low" }] }, { workerUtterance: "feed twelve bags low" });
    expect(result.output.status).toBe("ok");
    expect(row().session.draft.resourceUpdates).toEqual([expect.objectContaining({ kind: "feed", level: "low" })]);
    expect(row().session.step).toBe("open_more");
    const done = await tool(ticket, "finish_update", {}, { workerUtterance: "بس" });
    expect(row().session.step).toBe("report_summary");
    expect(speechFields(done.result)).toEqual(["summaryText"]);
    expect(done.result.summaryText).toContain("12");
  });

  it("resumes an open call by guided script when the realtime stream fails", async () => {
    const workspace = answeredFarm();
    workspace.settings.reportMode = "open";
    mock.load.mockResolvedValue({ workspace });
    await open();
    expect(row().session.step).toBe("open_listen");
    const response = await afterRoute(twilio(`/api/voice/realtime/after?s=${encodeURIComponent(signCallToken(token(), SECRET))}`, { CallSid: CALL }));
    expect(await response.text()).toContain("بنكمل المكالمة بالأزرار");
    expect(row().session.step).toBe("report_question");
    expect(row().session.data.reportMode).toBe("guided");
  });

  it("falls back to guided questions from the mode choice, so the script never waits on free speech", async () => {
    const workspace = answeredFarm();
    workspace.settings.reportMode = "worker_choice";
    mock.load.mockResolvedValue({ workspace });
    await open();
    expect(row().session.step).toBe("report_mode_choice");
    await afterRoute(twilio(`/api/voice/realtime/after?s=${encodeURIComponent(signCallToken(token(), SECRET))}`, { CallSid: CALL }));
    expect(row().session.step).toBe("report_question");
    expect(row().session.data.reportMode).toBe("guided");
  });

  it("keeps an unidentified camel as a note when the stream fails during clarification", async () => {
    const workspace = answeredFarm();
    workspace.settings.reportMode = "open";
    workspace.taskTickets = [];
    mock.load.mockResolvedValue({ workspace });
    await open();
    row().session = {
      ...row().session, step: "open_clarify", inputMode: "choices", replies: [{ id: "unknown", value: "unknown", label: { ar: "ما أدري", en: "I don't know" } }],
      data: { ...row().session.data, openClarify: [{ status: "sick", note: null }] },
    };
    await afterRoute(twilio(`/api/voice/realtime/after?s=${encodeURIComponent(signCallToken(token(), SECRET))}`, { CallSid: CALL }));
    expect(row().session.step).not.toMatch(/^open_/);
    expect(row().session.draft.camelUpdates).toHaveLength(0);
    expect(JSON.stringify(row().session.draft.answers)).toContain("A camel needs attention (unspecified)");
  });

  it("never records a quantity under the wrong topic after repeated refusals", async () => {
    const { ticket } = await open();
    const index = row().session.data.queue!.findIndex((item) => item.id === "feed_level");
    row().session = { ...row().session, step: "report_question", data: { ...row().session.data, reportIndex: index, currentQuestionId: "feed_level" } };
    for (let turn = 0; turn < 3; turn += 1) await tool(ticket, "answer_question", { text: "12", topic: "herd" }, { workerUtterance: "twelve bags of feed" });
    expect(row().session.draft.resourceUpdates.filter((update) => update.quantity !== null)).toHaveLength(0);
  });

  it("drops a fact whose evidence changes the number the worker said", async () => {
    const workspace = answeredFarm();
    workspace.settings.reportMode = "open";
    mock.load.mockResolvedValue({ workspace });
    const { ticket } = await open();
    const heard = "we have twenty camels in the herd today";
    const result = await tool(ticket, "record_facts", { facts: [{ type: "herd_count", count: 30, evidence: "we have thirty camels in the herd today" }] }, { workerUtterance: heard });
    expect(row().session.draft.herdCount).toBeUndefined();
    expect(result.output.status).toBe("ok");
    expect(row().session.draft.answers.map((entry: { answer: string }) => entry.answer)).toEqual([heard]);
  });

  it("reprompts the opening with the farm's own names, not the engine's sample names", async () => {
    const workspace = answeredFarm();
    workspace.settings.worker.name = "سالم";
    workspace.settings.reportMode = "open";
    mock.load.mockResolvedValue({ workspace });
    const ticket = ticketIn(await answerCall());
    row().session = { ...row().session, turns: [{ ...row().session.turns.at(-1)!, text: { ar: "هلا أحمد، تفضل", en: "Hello Ahmed" } }] };
    const opened = await (await sessionRoute(signed("/api/voice/realtime/session", { ticket, callSid: CALL }))).json();
    expect(opened.repromptText).toContain("سالم");
    expect(opened.repromptText).not.toContain("أحمد");
  });
});

describe("tool validation", () => {
  const session = {
    scenario: "report_call", step: "report_question", inputMode: "choices", done: false, startedAt: NOW.toISOString(), notices: [], turns: [],
    replies: [{ id: "yes", value: "yes", label: { ar: "إيه", en: "Yes" } }, { id: "unknown", value: "unknown", label: { ar: "ما أدري", en: "I do not know" } }],
    data: {}, draft: { answers: [], camelUpdates: [], resourceUpdates: [], herdAccountedFor: null, taskConfirmations: [] },
  } as unknown as CallSession;
  const check = (name: unknown, args: unknown, spoke = true, current = session) => checkTool(name, name === "answer_question" && args && typeof args === "object" && !Array.isArray(args) ? { topic: askedTopic(current), ...args } : args, spoke, current, "ar");
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
    ["unreadable text on a choice", "answer_question", { text: "كاسييا", topic: "herd" }],
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
    const before = row().seq;
    const result = await tool(ticket, "answer_question", { value: firstPrompt(opened).replies[0].value }, { userSpokeSinceLastTool: false });
    expect(result.output.error).toBe("worker_has_not_answered");
    expect(row().seq).toBe(before);
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
  ])("does not let %s answer the herd-health question", async (workerUtterance, error) => {
    const { ticket } = await open();
    const step = row().session.step;
    const result = await tool(ticket, "answer_question", { value: "yes" }, { workerUtterance });
    expect(result.result.awaitingConfirmation).toBe(false);
    expect(result.output).toMatchObject({ status: "invalid", error });
    expect(row().session.step).toBe(step);
    expect(row().session.draft.camelUpdates).toHaveLength(0);
    if (error === "answer_off_topic") expect(row().session.draft.answers.map((entry: { answer: string }) => entry.answer)).toEqual([workerUtterance]);
  });

  it.each([
    "تمام الحمد لله بس في واحدة تعبانة.",
    "تمام الحمد لله الحلال بس إنه في واحدة تعبانة.",
    "كلهم تمام، ألا في وحدة تعبانه.",
  ])("takes the real call's answer «%s» the first time and asks which camel", async (workerUtterance) => {
    const { ticket } = await open();
    const result = await tool(ticket, "answer_question", { value: "no", topic: "herd" }, { workerUtterance });
    expect(result.output.status).toBe("ok");
    expect(row().session.step).toBe("health_pick");
    expect(result.result.sayText).toContain("أي ناقة");
  });

  it("refuses rather than flipping a model's no when the worker said none is sick", async () => {
    const { ticket } = await open();
    const result = await tool(ticket, "answer_question", { value: "no" }, { workerUtterance: "لا ما فيه مريض" });
    expect(result.output).toMatchObject({ status: "invalid", error: "answer_conflicts_with_words" });
    expect(row().session.step).not.toBe("health_pick");
    expect(row().session.draft.camelUpdates).toHaveLength(0);
  });

  it("applies a repeated toolCallId once, and returns its first result", async () => {
    const { ticket, opened } = await open();
    const value = firstPrompt(opened).replies[0].value;
    const body = { ticket, callSid: CALL, toolCallId: "call_same", name: "answer_question", args: { value, topic: askedTopic(row().session) }, userSpokeSinceLastTool: true, workerUtterance: "إيه تمام" };
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
    expect(summary.replies.map((item) => item.value)).toEqual(["confirm_save", "correct", "end_without_save"]);
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

  it("saves one correctly mapped report, leaves the owner call to the scheduler, and claims saved only then", async () => {
    const { ticket, opened } = await open();
    await reachSummary(ticket, firstPrompt(opened));
    const done = await tool(ticket, "confirm_report", { confirmed: true });

    expect(done.result).toMatchObject({ end: "hangup", awaitingConfirmation: false });
    expect(done.output.status).toBe("saved");
    expect(done.result.goodbye).toBe("انحفظ التحديث. يعطيك العافية، مع السلامة.");
    const reports = mock.save.mock.calls.filter((call) => call[3].type === "worker_report");
    expect(reports).toHaveLength(1);
    const [, farmId, context, event] = reports[0];
    expect(farmId).toBe(FARM);
    expect(context).toEqual({ party: "worker" });
    expect(event).toMatchObject({ eventId: `${CALL}:report`, providerCallId: CALL, reportCallId: RUN });
    expect(event.draft.answers.length).toBeGreaterThan(0);
    expect(event.draft.camelUpdates.length).toBeGreaterThan(0);
    expect(mock.owner).not.toHaveBeenCalled();

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

  it("confirmed false offers correction without discarding the report", async () => {
    const { ticket, opened } = await open();
    await reachSummary(ticket, firstPrompt(opened));
    const done = await tool(ticket, "confirm_report", { confirmed: false }, { workerUtterance: "لا، فيه غلط" });
    expect(done.output.status).toBe("ok");
    expect(done.result.end).toBeNull();
    expect(row().session.step).toBe("report_correct_pick");
    expect(mock.save.mock.calls.filter((call) => call[3].type === "worker_report")).toHaveLength(0);
    expect(mock.save.mock.calls.filter((call) => call[3].type === "report_call_ended")).toHaveLength(0);
    expect(mock.owner).not.toHaveBeenCalled();
  });

  it("ends a call early without saving anything", async () => {
    const { ticket } = await open();
    const saves = mock.save.mock.calls.length;
    const done = await tool(ticket, "end_call", { reason: "worker_ended" }, { workerUtterance: "مع السلامة" });
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

describe("the worker's own words decide", () => {
  async function reachQuestion(ticket: string, first: Prompt, questionId: string) {
    let prompt = first;
    for (let turn = 0; turn < 80 && row().session.data.currentQuestionId !== questionId; turn += 1) {
      const args = prompt.numberExpected ? { text: "٤٢" } : prompt.replies.length ? { value: prompt.replies[0].value } : { text: "تمام" };
      const step = await tool(ticket, "answer_question", args, { workerUtterance: "text" in args ? args.text : prompt.replies[0].label ?? "إيه تمام" });
      expect(step.output.status).toBe("ok");
      prompt = step.output;
    }
    expect(row().session.data.currentQuestionId).toBe(questionId);
    return prompt;
  }

  it("keeps the call going on end_call without words asking to stop", async () => {
    const { ticket } = await open();
    const silent = await tool(ticket, "end_call", { reason: "worker_ended" }, { workerUtterance: "" });
    expect(silent.result).toMatchObject({ end: null, silent: true });
    const words = await tool(ticket, "end_call", { reason: "worker_ended" }, { workerUtterance: "العلف زين" });
    expect(words.result.end).toBeNull();
    expect(words.output.error).toBe("worker_has_not_asked_to_stop");
    expect(words.result.sayText).toBeTruthy();
    expect(row().session.done).toBe(false);
  });

  it.each(["مع السلامة", "وقف", "ما ابي اكمل", "مشغول", "stop", "goodbye"])("ends the call on «%s»", async (workerUtterance) => {
    const { ticket } = await open();
    const done = await tool(ticket, "end_call", { reason: "worker_ended" }, { workerUtterance });
    expect(done.result.end).toBe("hangup");
    expect(row().session.done).toBe(true);
  });

  it("re-asks on a garbled transcript and records nothing", async () => {
    const { ticket, opened } = await open();
    await reachQuestion(ticket, firstPrompt(opened), "feed_level");
    const before = row().session.draft.answers.length;
    const garbled = await tool(ticket, "answer_question", { value: "good" }, { workerUtterance: "أقدراشgba" });
    expect(garbled.output.error).toBe("answer_unclear");
    expect(garbled.result.sayText).toBeTruthy();
    expect(row().session.data.currentQuestionId).toBe("feed_level");
    expect(row().session.draft.answers).toHaveLength(before);
  });

  it("re-asks when the words don't map to the chosen level", async () => {
    const { ticket, opened } = await open();
    await reachQuestion(ticket, firstPrompt(opened), "water_level");
    const result = await tool(ticket, "answer_question", { value: "good" }, { workerUtterance: "كاسييا" });
    expect(result.output.error).toBe("answer_unclear");
    expect(row().session.data.currentQuestionId).toBe("water_level");
    expect(row().session.draft.resourceUpdates.some((update: { kind: string }) => update.kind === "water")).toBe(false);
  });

  it("re-asks on a garbled answer to a custom question", async () => {
    const farm = answeredFarm();
    farm.settings.customQuestions = [{ id: "custom-1", text: "وش سويت اليوم؟", createdAt: NOW.toISOString() }];
    mock.load.mockResolvedValue({ workspace: farm });
    const { ticket, opened } = await open();
    await reachQuestion(ticket, firstPrompt(opened), "custom-1");
    const result = await tool(ticket, "answer_question", { text: "damarja." }, { workerUtterance: "damarja." });
    expect(result.output.error).toBe("answer_unclear");
    expect(row().session.data.currentQuestionId).toBe("custom-1");
    expect(row().session.draft.answers.some((item: { questionId: string }) => item.questionId === "custom-1")).toBe(false);
  });

  it("saves from the keypad only after the current summary was heard", async () => {
    const { ticket, opened } = await open();
    await reachSummary(ticket, firstPrompt(opened));
    const keypad = { workerUtterance: undefined, keypad: true, heardSummary: true };
    const stale = await tool(ticket, "keypad_confirm", {}, { ...keypad, heardSummaryId: "0:stale" });
    expect(stale.output.error).toBe("summary_not_finished");
    expect(mock.save.mock.calls.filter((call) => call[3].type === "worker_report")).toHaveLength(0);
    const saved = await tool(ticket, "keypad_confirm", {}, { ...keypad, heardSummaryId: reportSummaryId(row().session, "ar") });
    expect(saved.output.status).toBe("saved");
    expect(saved.result).toMatchObject({ end: "hangup", goodbye: "انحفظ التحديث. يعطيك العافية، مع السلامة." });
    expect(mock.save.mock.calls.filter((call) => call[3].type === "worker_report")).toHaveLength(1);
  });
});

describe("verified realtime confirmation", () => {
  it.each(["", "ضجيج", "لا", "إيه بس العلف غلط", "صح لكن", "yes but change the feed", "لا تحفظه", "إيه لا", "صح مو صحيح", "yes if the owner agrees", "إيه إذا وافق المالك", "yes maybe", "ب، احفض", "إيه والله مدري", "صح يمكن", "he said yes", "قال صح", "is that correct?", "صح؟"])("refuses %j without changing the engine or saving", async (workerUtterance) => {
    const { ticket, opened } = await open();
    await reachSummary(ticket, firstPrompt(opened));
    const before = JSON.stringify({ data: row().session.data, seq: row().seq, misses: row().misses, turns: row().session.turns });
    const result = await tool(ticket, "confirm_report", { confirmed: true }, { workerUtterance });
    expect(result.output.error).toBe("worker_has_not_confirmed");
    expect(result.result.sayText).toBe("ما سمعتك زين. أحفظه؟ قل إيه، أو اضغط واحد.");
    expect(result.result.summaryText).toBeUndefined();
    expect(result.result.end).toBeNull();
    expect(JSON.stringify({ data: row().session.data, seq: row().seq, misses: row().misses, turns: row().session.turns })).toBe(before);
    expect(mock.save.mock.calls.filter((call) => call[3].type === "worker_report")).toHaveLength(0);
  });

  it.each(["ماهو صحيح", "مهوب صحيح", "ماهي صحيحة"])("refuses a joined negation: %s", async (workerUtterance) => {
    const { ticket, opened } = await open();
    await reachSummary(ticket, firstPrompt(opened));
    const result = await tool(ticket, "confirm_report", { confirmed: true }, { workerUtterance });
    expect(result.output.error).toBe("worker_has_not_confirmed");
    expect(result.result.sayText).toBe("ما سمعتك زين. أحفظه؟ قل إيه، أو اضغط واحد.");
    expect(mock.save.mock.calls.filter((call) => call[3].type === "worker_report")).toHaveLength(0);
  });

  it.each([undefined, false])("requires affirmative playback evidence (%j)", async (heardSummary) => {
    const { ticket, opened } = await open();
    await reachSummary(ticket, firstPrompt(opened));
    const result = await tool(ticket, "confirm_report", { confirmed: true }, { heardSummary, heardSummaryId: undefined });
    expect(result.output.error).toBe("summary_not_finished");
    expect(result.output.summary).toContain("أحفظه");
    expect(result.result.summaryText).toContain("أحفظه");
    expect(mock.save.mock.calls.filter((call) => call[3].type === "worker_report")).toHaveLength(0);
    const confirmed = await tool(ticket, "confirm_report", { confirmed: true });
    expect(confirmed.output.status).toBe("saved");
    expect(mock.save.mock.calls.filter((call) => call[3].type === "worker_report")).toHaveLength(1);
  });

  it("falls back at the third unique failure, replays retries, and the script can still confirm by keypad", async () => {
    const { ticket, opened } = await open();
    await reachSummary(ticket, firstPrompt(opened));
    const first = await tool(ticket, "confirm_report", { confirmed: true }, { workerUtterance: undefined });
    const firstId = `call_${toolCounter}`;
    const repeat = await tool(ticket, "confirm_report", { confirmed: true }, { toolCallId: firstId, workerUtterance: "yes" });
    expect(repeat.result).toEqual(first.result);
    const second = await tool(ticket, "confirm_report", { confirmed: true }, { workerUtterance: "لا" });
    expect(second.result).toMatchObject({ end: null, sayText: "ما سمعتك زين. أحفظه؟ قل إيه، أو اضغط واحد." });
    expect(row().session.realtime.closed).toBe(false);
    const third = await tool(ticket, "confirm_report", { confirmed: true }, { workerUtterance: "لا" });
    expect(third.result).toMatchObject({ end: "fallback", goodbye: null });
    expect(row().session.done).toBe(false);
    expect(row().session.step).toBe("report_summary");
    expect(row().session.realtime.closed).toBe(true);
    expect((await tool(ticket, "confirm_report", { confirmed: true })).result.end).toBe("fallback");
    expect(mock.save.mock.calls.filter((call) => call[3].type === "worker_report")).toHaveLength(0);
    const xml = await answerFarmCall(db.client, { callSid: CALL, seq: row().seq, speech: "", digits: "1", confidence: null, now: new Date() });
    expect(xml).toContain("انحفظ التحديث. يعطيك العافية، مع السلامة.");
    expect(mock.save.mock.calls.filter((call) => call[3].type === "worker_report")).toHaveLength(1);
  });

  it.each(["yes if the owner agrees", "he said yes", "قال صح", "صح؟"])("keeps the same confirmation gate after scripted fallback: %s", async (speech) => {
    const { ticket, opened } = await open();
    await reachSummary(ticket, firstPrompt(opened));
    for (let failure = 0; failure < 3; failure += 1) await tool(ticket, "confirm_report", { confirmed: true }, { workerUtterance: "لا" });
    expect(row().session.realtime.closed).toBe(true);
    const response = await answerFarmCall(db.client, { callSid: CALL, seq: row().seq, speech, digits: null, now: new Date() });
    expect(response).toContain("<Gather");
    expect(row().session.step).toBe("report_summary");
    expect(mock.save.mock.calls.filter((call) => call[3].type === "worker_report")).toHaveLength(0);
  });

  it.each(["إيه", "صح", "تمام", "احفظ", "احفظه", "إيه صح", "نعم صحيح", "تمام احفظه", "yes", "yes save it", "that is correct", "إيه تمام", "تأكيد وحفظ", "confirm and save", "إيه صح، احفظه.", "إيه، صح.", "تمام، احفظه", "حفظ", "اعتمد"])("accepts the existing parser's clear confirmation %s exactly once", async (workerUtterance) => {
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
    expect(row().seq).toBe(seq + 1);
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
    await tool(ticket, "end_call", { reason: "worker_ended" }, { workerUtterance: "مع السلامة" });
    const xml = await (await afterRoute(twilio(afterUrl(), { CallSid: CALL }))).text();
    expect(xml).toBe(row().last_response);
    expect(xml).toContain("ما انحفظ");
  });

  it("resumes the scripted Gather at the current question, and blocks late tool calls", async () => {
    const { ticket, opened } = await open();
    await tool(ticket, "answer_question", { value: firstPrompt(opened).replies[0].value });
    const current = row().last_response;
    const response = await afterRoute(twilio(afterUrl(), { CallSid: CALL }));
    const fallback = await response.text();
    expect(fallback).toContain("بنكمل المكالمة بالأزرار");
    expect(fallback).toBe(row().last_response);
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
    const saved = await tool(ticket, "confirm_report", { confirmed: true });
    expect(saved.result).toMatchObject({ end: "hangup", goodbye: "انحفظ التحديث. يعطيك العافية، مع السلامة." });
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

describe("the natural call (local presentation style)", () => {
  type Queue = NonNullable<CallSession["data"]["queue"]>;
  const handOver = (queue: Queue, herd: number) => queue.map((item) => {
    if (item.kind === "custom") return { question_id: item.id, text: "ما فيه شي جديد" };
    if (item.kind === "predefined" && item.answerKind === "herd-health") return { question_id: item.id, value: "yes" };
    if (item.id === "herd_count") return { question_id: item.id, number: herd };
    if (item.kind === "predefined" && item.answerKind === "level") return { question_id: item.id, value: "good" };
    return { question_id: item.id, value: "yes" };
  });

  beforeEach(() => vi.stubEnv("NAQAH_VOICE_STYLE", "natural"));

  async function openNatural() {
    const ticket = ticketIn(await answerCall());
    const response = await sessionRoute(signed("/api/voice/realtime/session", { ticket, callSid: CALL }));
    expect(response.status).toBe(200);
    return { ticket, opened: await response.json() };
  }

  it("opens one natural conversation: own words, four tools, no keypad", async () => {
    const { opened } = await openNatural();
    expect(opened.style).toBe("natural");
    expect(opened.opening).toMatch(/^هلا والله يا .+، معك ناقة، المساعد الآلي/);
    expect(opened.opening).toContain("بشّر، كيف الحلال اليوم؟");
    expect(opened.tools.map((item: { name: string }) => item.name)).toEqual(["submit_report", "confirm_report", "flag_urgent", "end_call"]);
    expect(opened.instructions).toContain("لا تعيد سؤال انجاوب");
  });

  it("hands over the report once, reads the engine's summary, saves on a spoken yes and says goodbye", async () => {
    const { ticket } = await openNatural();
    const base = realtimeOf(row().session)!.naturalBase!;
    const farm = answeredFarm();
    const submitted = await tool(ticket, "submit_report", { answers: handOver(base.data.queue ?? [], farm.settings.herdCount ?? farm.camels.length) }, { workerUtterance: "إيه هذا كل شي" });
    expect(submitted.status).toBe(200);
    expect(submitted.result.summaryText).toMatch(/^هذا اللي فهمته: .*\. أحفظه؟$/u);
    expect(submitted.result.repromptText).toBe("أحفظه؟");
    expect(submitted.result.summaryId).toBe(reportSummaryId(row().session, "ar"));
    expect(mock.save).not.toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything(), expect.objectContaining({ type: "worker_report" }), expect.anything());
    const saved = await tool(ticket, "confirm_report", { confirmed: true }, { workerUtterance: "إيه احفظه", heardSummary: true, heardSummaryId: submitted.result.summaryId });
    expect(saved.output.status).toBe("saved");
    expect(saved.result.end).toBe("hangup");
    expect(saved.result.goodbye).toBe("انحفظ، الله يعطيك العافية. مع السلامة.");
  });

  async function readSummary(ticket: string) {
    const base = realtimeOf(row().session)!.naturalBase!;
    const farm = answeredFarm();
    return tool(ticket, "submit_report", { answers: handOver(base.data.queue ?? [], farm.settings.herdCount ?? farm.camels.length) }, { workerUtterance: "هذا كل شي" });
  }

  it("saves once on a casual Saudi yes the transcriber garbled, as on the 11 Nov call", async () => {
    const { ticket } = await openNatural();
    const submitted = await readSummary(ticket);
    const saved = await tool(ticket, "confirm_report", { confirmed: true }, { workerUtterance: "كل شيء تمام. لا تتعدى لأحفظك.", heardSummary: true, heardSummaryId: submitted.result.summaryId });
    expect(saved.output.status).toBe("saved");
    expect(saved.result.end).toBe("hangup");
    expect(mock.save.mock.calls.filter((call) => call[3]?.type === "worker_report")).toHaveLength(1);
  });

  it("after three unclear replies says nothing was saved and hangs up, never a connection problem", async () => {
    const { ticket } = await openNatural();
    const submitted = await readSummary(ticket);
    let last;
    for (let turn = 0; turn < 3; turn += 1) last = await tool(ticket, "confirm_report", { confirmed: true }, { workerUtterance: "كل شيء نام", heardSummary: true, heardSummaryId: submitted.result.summaryId });
    expect(last!.output.status).toBe("ended_without_saving");
    expect(last!.result.goodbye).toContain("ما انحفظ التحديث");
    expect(last!.result.end).toBe("hangup");
    expect(mock.save.mock.calls.some((call) => call[3]?.type === "worker_report")).toBe(false);
    const after = await (await afterRoute(twilio(`/api/voice/realtime/after?s=${encodeURIComponent(signCallToken(token(), SECRET))}`, { CallSid: CALL }))).text();
    expect(after).not.toContain("معليش");
  });

  it("a save that fails asks once more, then ends honestly, never blaming the connection", async () => {
    const { ticket } = await openNatural();
    const submitted = await readSummary(ticket);
    mock.save.mockImplementation(async (_client: unknown, _farm: unknown, _party: unknown, event: { type?: string }) => {
      if (event?.type === "worker_report") throw new Error("database unavailable");
      return { status: "saved" };
    });
    const heard = { heardSummary: true, heardSummaryId: submitted.result.summaryId };
    const first = await tool(ticket, "confirm_report", { confirmed: true }, { workerUtterance: "إيه احفظه", ...heard });
    expect(first.output.status).toBe("save_not_confirmed");
    expect(first.result.continue).toBe(true);
    expect(first.result.end).toBeNull();
    const second = await tool(ticket, "confirm_report", { confirmed: true }, { workerUtterance: "إيه احفظه", ...heard });
    expect(second.output.status).toBe("save_failed");
    expect(second.result.end).toBe("hangup");
    expect(second.result.goodbye).toContain("ما قدرت أتأكد من حفظ شيء");
    expect(second.result.goodbye).not.toContain("الاتصال");
  });

  it("asks the model to get missing answers instead of saving a partial report", async () => {
    const { ticket } = await openNatural();
    const result = await tool(ticket, "submit_report", { answers: [] }, { workerUtterance: "خلاص" });
    expect(result.output).toMatchObject({ status: "invalid", error: "questions_not_answered" });
    expect(result.result.continue).toBe(true);
    expect(result.result.summaryText).toBeUndefined();
  });

  it("checks a count the worker's words don't back once, then accepts the next hand-over after their reply", async () => {
    const { ticket } = await openNatural();
    const base = realtimeOf(row().session)!.naturalBase!;
    const farm = answeredFarm();
    const herd = farm.settings.herdCount ?? farm.camels.length;
    expect(base.data.queue?.some((item) => item.id === "herd_count")).toBe(true);
    const args = { answers: handOver(base.data.queue ?? [], herd) };
    const said = ["الحمد لله كلهم بخير", "ما فيه شي جديد"];
    const checked = await tool(ticket, "submit_report", args, { workerUtterance: "ما فيه شي جديد", workerTranscripts: said });
    expect(checked.output).toMatchObject({ status: "check", items: [{ question_id: "herd_count", reason: "number_not_heard" }] });
    expect(checked.output.say).toBe(`${herd} راس، صح؟`);
    expect(checked.result.continue).toBe(true);
    expect(checked.result.summaryText).toBeUndefined();
    // Handed over again before the worker answered: still the same check, never the summary.
    const early = await tool(ticket, "submit_report", args, { userSpokeSinceLastTool: false, workerTranscripts: said });
    expect(early.output.status).toBe("check");
    const confirmed = await tool(ticket, "submit_report", args, { workerUtterance: "إيه صح", workerTranscripts: [...said, "إيه صح"] });
    expect(confirmed.result.summaryText).toContain(`${herd} من الحلال`);
    expect(realtimeOf(row().session)!.checkedAnswers).toEqual(["herd_count:number"]);
  });

  it("doesn't check a correction after the summary: it is read back in full instead", async () => {
    const { ticket } = await openNatural();
    const base = realtimeOf(row().session)!.naturalBase!;
    const farm = answeredFarm();
    const herd = farm.settings.herdCount ?? farm.camels.length;
    await readSummary(ticket);
    const corrected = await tool(ticket, "submit_report", { answers: handOver(base.data.queue ?? [], herd + 3) }, { workerUtterance: "لا العدد غلط", workerTranscripts: ["ما فيه شي جديد", "لا العدد غلط"] });
    expect(corrected.result.summaryText).toContain(`${herd + 3} من الحلال`);
  });

  it("never reads the same summary twice: an identical hand-over is 'unchanged', and the first summary still saves", async () => {
    const { ticket } = await openNatural();
    const submitted = await readSummary(ticket);
    const id = submitted.result.summaryId;
    const again = await readSummary(ticket);
    expect(again.output.status).toBe("unchanged");
    expect(again.output.message).toContain("Nothing changed. If the worker agreed, call confirm_report; otherwise ask briefly what to change.");
    expect(again.result).toMatchObject({ continue: true, end: null });
    expect(again.result.summaryText).toBeUndefined();
    expect(again.result.sayText).toBeUndefined();
    expect(reportSummaryId(row().session, "ar")).toBe(id);
    const saved = await tool(ticket, "confirm_report", { confirmed: true }, { workerUtterance: "تمام", heardSummary: true, heardSummaryId: id });
    expect(saved.output.status).toBe("saved");
    expect(mock.save.mock.calls.filter((call) => call[3]?.type === "worker_report")).toHaveLength(1);
  });

  it("a hand-over that changes an answer is read in full once, and only its new summary can be confirmed", async () => {
    const { ticket } = await openNatural();
    const base = realtimeOf(row().session)!.naturalBase!;
    const herd = answeredFarm().settings.herdCount ?? answeredFarm().camels.length;
    const first = await readSummary(ticket);
    const changed = await tool(ticket, "submit_report", { answers: handOver(base.data.queue ?? [], herd + 2) }, { workerUtterance: "لا العدد غلط", workerTranscripts: ["لا العدد غلط"] });
    expect(changed.result.summaryText).toContain(`${herd + 2} من الحلال`);
    expect(changed.result.summaryId).not.toBe(first.result.summaryId);
    const stale = await tool(ticket, "confirm_report", { confirmed: true }, { workerUtterance: "تمام", heardSummary: true, heardSummaryId: first.result.summaryId });
    expect(stale.output.status).not.toBe("saved");
    const saved = await tool(ticket, "confirm_report", { confirmed: true }, { workerUtterance: "تمام", heardSummary: true, heardSummaryId: changed.result.summaryId });
    expect(saved.output.status).toBe("saved");
  });

  /**
   * Call b8fd64 (11 Nov), its ending as the new rules take it. Then: a 24-second summary the worker talked over twice at
   * its question-sounding «فيه شي ثاني تبي تبلغ عنه» line, so it was read three times. Now the summary is short, has no
   * question before «أحفظه؟», and is read once; «لا شكرا… احفظ» and «لا» ask what to change; «أحفظ» saves, once.
   */
  it("call b8fd64's ending: one summary read, «لا» asks what to change, «أحفظ» saves once", async () => {
    const { ticket } = await openNatural();
    const submitted = await readSummary(ticket);
    const heard = { heardSummary: true, heardSummaryId: submitted.result.summaryId };
    expect(submitted.result.summaryText).not.toMatch(/فيه شي ثاني|ولا تبي تعدل/u);
    expect(submitted.result.summaryText.match(/[?؟]/gu)).toEqual(["؟"]);
    expect(submitted.result.summaryText).toMatch(/أحفظه؟$/u);
    const reads = [submitted.result.summaryText];
    const steps = [
      await tool(ticket, "confirm_report", { confirmed: true }, { workerUtterance: "لا شكرا احفظ.", ...heard }),
      await readSummary(ticket),
      await tool(ticket, "confirm_report", { confirmed: true }, { workerUtterance: "لا", ...heard }),
      await tool(ticket, "confirm_report", { confirmed: true }, { workerUtterance: "أحفظ.", ...heard }),
    ];
    for (const step of steps) if (step.result.summaryText) reads.push(step.result.summaryText);
    expect(reads).toHaveLength(1);
    expect(JSON.parse(steps[0].result.output).say).toContain("وش تبي نعدل؟");
    expect(steps[1].output.status).toBe("unchanged");
    expect(JSON.parse(steps[2].result.output).say).toContain("وش تبي نعدل؟");
    expect(steps[3].output.status).toBe("saved");
    expect(steps[3].result.goodbye).toBe("انحفظ، الله يعطيك العافية. مع السلامة.");
    expect(mock.save.mock.calls.filter((call) => call[3]?.type === "worker_report")).toHaveLength(1);
  });

  it("accepts the worker's transcripts only as a short list of plain strings", async () => {
    const { ticket } = await openNatural();
    const send = (workerTranscripts: unknown) => tool(ticket, "submit_report", { answers: [] }, { workerTranscripts });
    expect((await send(["إيه", "عشرين"])).status).toBe(200);
    for (const bad of ["عشرين", [1], ["a\u0007"], ["x".repeat(1001)], Array.from({ length: 41 }, () => "إيه")]) expect((await send(bad)).status).toBe(400);
  });

  it("never confirms on a keypad press", async () => {
    const { ticket } = await openNatural();
    const pressed = await tool(ticket, "keypad_confirm", {}, { keypad: true });
    expect(pressed.status).not.toBe(200);
  });

  it("ends with a short apology, no keypad script, if the stream drops", async () => {
    await openNatural();
    const response = await afterRoute(twilio(`/api/voice/realtime/after?s=${encodeURIComponent(signCallToken(token(), SECRET))}`, { CallSid: CALL }));
    const xml = await response.text();
    expect(xml).toContain("معليش");
    expect(xml).not.toContain("<Gather");
    expect(xml).toContain("<Hangup");
  });

  it.each(["normal", "silence"])("does not replay a goodbye after the bridge closed for %s", async (reason) => {
    await openNatural();
    Object.assign(row().session, { bridgeCloseReason: reason });
    const request = () => twilio(`/api/voice/realtime/after?s=${encodeURIComponent(signCallToken(token(), SECRET))}`, { CallSid: CALL });
    expect(await (await afterRoute(request())).text()).toBe("<Response><Hangup/></Response>");
    expect(await (await afterRoute(request())).text()).toBe("<Response><Hangup/></Response>");
  });
});
