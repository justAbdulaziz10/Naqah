import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { POST as inbound } from "@/app/api/voice/inbound/route";
import { POST as turn } from "@/app/api/voice/turn/route";
import { GET as status } from "@/app/api/integrations/status/route";
import { POST as voiceStatus } from "@/app/api/voice/status/route";
import { replayVoiceState } from "./conversation";
import { signVoiceState, verifyVoiceState, VOICE_MISS_VALUE } from "./state";
import { twilioRequestSignature } from "@/server/twilio/signature";
import * as voiceConversation from "./conversation";

vi.mock("server-only", () => ({}));
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, connection: vi.fn(async () => {}) };
});

const envNames = [
  "NAQAH_VOICE_MODE", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY", "NAQAH_PUBLIC_BASE_URL",
  "NAQAH_VOICE_SECRET", "NAQAH_WORKER_PHONE", "NAQAH_OWNER_PHONE", "NAQAH_VOICE_LOCALE",
  "NAQAH_VOICE_ARABIC_VOICE", "NAQAH_VOICE_ENGLISH_VOICE", "TWILIO_AUTH_TOKEN", "TWILIO_ACCOUNT_SID",
  "TWILIO_PHONE_NUMBER", "NAQAH_CALL_OWNER", "NEXT_PUBLIC_NAQAH_PHONE_NUMBER", "WHATSAPP_PHONE_NUMBER_ID",
  "WHATSAPP_TOKEN", "NAQAH_OWNER_WHATSAPP", "WHATSAPP_TEMPLATE_NAME", "WHATSAPP_TEMPLATE_LANGUAGE",
  "NEXT_PUBLIC_NAQAH_BUILD_COMMIT",
];

function request(url: string, fields: Record<string, string> = {}) {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields),
  });
}

function signedRequest(url: string, fields: Record<string, string>, signatureUrl = url, forwarded = false) {
  const headers = new Headers({ "Content-Type": "application/x-www-form-urlencoded" });
  headers.set("X-Twilio-Signature", twilioRequestSignature(signatureUrl, fields, "route-test-token"));
  if (forwarded) {
    headers.set("x-forwarded-proto", "https, http");
    headers.set("x-forwarded-host", "naqah.test, internal:3000");
  }
  return new Request(url, { method: "POST", headers, body: new URLSearchParams(fields) });
}

function xmlText(xml: string, tag: string): string | null {
  const match = xml.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`));
  return match?.[1]?.replaceAll("&apos;", "'").replaceAll("&quot;", '"').replaceAll("&gt;", ">").replaceAll("&lt;", "<").replaceAll("&amp;", "&") ?? null;
}

function assertWellFormedTwiml(xml: string) {
  expect(xml.startsWith("<Response>")).toBe(true);
  expect(xml.endsWith("</Response>")).toBe(true);
  expect(xml.replace(/&(amp|lt|gt|quot|apos);/g, "")).not.toContain("&");
  const stack: string[] = [];
  for (const match of xml.matchAll(/<\/?([A-Za-z]+)(?:\s[^<>]*)?\s*\/?>/g)) {
    const token = match[0];
    const name = match[1];
    if (token.startsWith("</")) expect(stack.pop()).toBe(name);
    else if (!token.endsWith("/>")) stack.push(name);
  }
  expect(stack).toEqual([]);
  expect(xml).toContain("<Say");
}

function gatherActionRaw(xml: string): string | null {
  const raw = xml.match(/<Gather\b[^>]*\baction="([^"]+)"/)?.[1];
  return raw?.replaceAll("&quot;", '"').replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&") ?? null;
}

function gatherAction(xml: string): string | null {
  const raw = gatherActionRaw(xml);
  return raw ? new URL(raw, "https://naqah.test").toString() : null;
}

function scriptedSpeech(stateToken: string): string {
  const state = verifyVoiceState(stateToken, process.env.NAQAH_VOICE_SECRET);
  if (!state) throw new Error("Gather action did not carry valid signed state");
  const session = replayVoiceState(state).session;
  if (session.inputMode === "choices") return session.replies[0]?.label[state.l] ?? "نعم";
  if (session.inputMode === "number") return "12";
  if (session.inputMode === "time") return "17:15";
  if (session.inputMode === "text") return state.l === "ar" ? "ما فيه زوار" : "No visitors";
  throw new Error(`Unexpected input mode: ${session.inputMode}`);
}

async function driveCall(from: string, callSid: string, signed: boolean) {
  const inboundUrl = "https://naqah.test/api/voice/inbound";
  const inboundFields = { From: from, To: "+966500000000", CallSid: callSid };
  const started = await inbound(signed
    ? signedRequest(inboundUrl, inboundFields)
    : request(inboundUrl, inboundFields));
  let xml = await started.text();
  let action = gatherAction(xml);
  let turns = 0;
  while (action && turns < 40) {
    const token = new URL(action).searchParams.get("s");
    if (!token) throw new Error("Gather action did not contain signed state");
    const fields = { ...inboundFields, SpeechResult: scriptedSpeech(token) };
    const next = await turn(signed
      ? signedRequest(action, fields)
      : request(action, fields));
    xml = await next.text();
    turns += 1;
    action = gatherAction(xml);
  }
  return { xml, turns, completed: turns < 40 && xml.includes("<Hangup/>") };
}

describe("voice webhook routes", () => {
  beforeEach(() => {
    for (const name of envNames) vi.stubEnv(name, "");
    vi.stubEnv("NAQAH_VOICE_SECRET", "route-test-secret");
    vi.stubEnv("NAQAH_WORKER_PHONE", "+966 50 778 2190");
    vi.stubEnv("NAQAH_OWNER_PHONE", "+966 55 012 3344");
    vi.stubEnv("NAQAH_VOICE_LOCALE", "ar");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("replays the same seeded report with stable IDs, turns, and timestamps", () => {
    const state = { v: 1 as const, sc: "report_call" as const, l: "ar" as const, t: 1_798_900_000_000, a: [] };
    const first = replayVoiceState(state);
    const second = replayVoiceState(state);
    expect(first.session).toEqual(second.session);
    expect(first.workspace.createdAt).toBe(new Date(state.t).toISOString());
    expect(first.workspace.camels.map((camel) => camel.id)).toEqual(second.workspace.camels.map((camel) => camel.id));
    expect(first.workspace.reports.map((report) => report.at)).toEqual(second.workspace.reports.map((report) => report.at));
  });

  it("keeps completed report, call, and event IDs and times stable across a full replay", () => {
    const base = { v: 1 as const, sc: "report_call" as const, l: "en" as const, t: Date.parse("2026-11-05T10:00:00.000Z"), a: [] as { value?: string; text?: string }[] };
    let inputs: { value?: string; text?: string }[] = [];
    let replay = replayVoiceState(base);
    for (let turnNumber = 0; !replay.session.done && turnNumber < 40; turnNumber += 1) {
      if (replay.session.inputMode === "choices") inputs = [...inputs, { value: replay.session.replies[0].value }];
      else if (replay.session.inputMode === "number") inputs = [...inputs, { text: "12" }];
      else if (replay.session.inputMode === "time") inputs = [...inputs, { text: "17:15" }];
      else if (replay.session.inputMode === "text") inputs = [...inputs, { text: "No visitors" }];
      else throw new Error(`unexpected engine input mode: ${replay.session.inputMode}`);
      replay = replayVoiceState({ ...base, a: inputs });
    }
    expect(replay.session.done).toBe(true);
    const replayed = replayVoiceState({ ...base, a: inputs });
    expect(replayed.session).toEqual(replay.session);
    expect(replayed.workspace.reports).toEqual(replay.workspace.reports);
    expect(replayed.workspace.calls).toEqual(replay.workspace.calls);
    expect(replayed.workspace.events).toEqual(replay.workspace.events);
    expect(replay.workspace.reports.at(-1)?.at).toBe(new Date(base.t).toISOString());
  });

  it("simulates a full worker report through the route handlers and saves the report", async () => {
    const started = await inbound(request("https://naqah.test/api/voice/inbound", { From: "+966507782190", To: "+966500000000" }));
    let xml = await started.text();
    assertWellFormedTwiml(xml);
    let action = gatherAction(xml);
    expect(action).not.toBeNull();
    const firstAction = action!;
    let turns = 0;
    let completed = false;

    while (action && turns < 40) {
      const actionUrl = new URL(action);
      const token = actionUrl.searchParams.get("s");
      expect(token).toBeTruthy();
      const speech = scriptedSpeech(token!);
      const response = await turn(request(action, { SpeechResult: speech }));
      xml = await response.text();
      assertWellFormedTwiml(xml);
      turns += 1;
      action = gatherAction(xml);
      if (!action) {
        completed = xml.includes("<Hangup/>") && /التجريبية|sample call/i.test(xmlText(xml, "Say") ?? "");
        break;
      }
    }

    expect(turns).toBeLessThan(40);
    expect(completed).toBe(true);

    const tampered = new URL(firstAction);
    const token = tampered.searchParams.get("s")!;
    tampered.searchParams.set("s", `${token[0] === "A" ? "B" : "A"}${token.slice(1)}`);
    const rejected = await turn(request(tampered.toString(), { SpeechResult: "نعم" }));
    const rejectedXml = await rejected.text();
    assertWellFormedTwiml(rejectedXml);
    expect(rejectedXml).toContain("<Hangup/>");
    expect(gatherAction(rejectedXml)).toBeNull();
  });

  it("reprompts then moves an unmapped spoken answer to unknown without ending the report", async () => {
    const started = await inbound(request("https://naqah.test/api/voice/inbound", { From: "+966507782190" }));
    const initialXml = await started.text();
    const firstAction = gatherAction(initialXml)!;
    const missedOnce = await turn(request(firstAction, { SpeechResult: "unrecognized words" }));
    const firstRetryXml = await missedOnce.text();
    expect(xmlText(firstRetryXml, "Say")).toContain("ما وضحت لي الإجابة");
    const secondAction = gatherAction(firstRetryXml)!;
    const missedTwice = await turn(request(secondAction, { SpeechResult: "still unrecognized" }));
    const secondRetryXml = await missedTwice.text();
    expect(xmlText(secondRetryXml, "Say")).not.toContain("ما وضحت لي الإجابة");
    const nextAction = gatherAction(secondRetryXml)!;
    const nextState = verifyVoiceState(new URL(nextAction).searchParams.get("s"), process.env.NAQAH_VOICE_SECRET)!;
    expect(nextState.a.slice(-2)).toEqual([{ value: VOICE_MISS_VALUE }, { value: "unknown" }]);
  });

  it("repeats a question after a second miss without an unknown reply, then hangs up", async () => {
    let response = await inbound(request("https://naqah.test/api/voice/inbound", { From: "+966507782190" }));
    let xml = await response.text();
    let action = gatherAction(xml);
    for (let count = 0; action && count < 40; count += 1) {
      const state = verifyVoiceState(new URL(action).searchParams.get("s"), process.env.NAQAH_VOICE_SECRET)!;
      if (replayVoiceState(state).session.step === "report_summary") break;
      response = await turn(request(action, { SpeechResult: scriptedSpeech(new URL(action).searchParams.get("s")!) }));
      xml = await response.text();
      action = gatherAction(xml);
    }
    expect(action).not.toBeNull();
    const summaryState = verifyVoiceState(new URL(action!).searchParams.get("s"), process.env.NAQAH_VOICE_SECRET)!;
    expect(replayVoiceState(summaryState).session.step).toBe("report_summary");

    response = await turn(request(action!, { SpeechResult: "" }));
    xml = await response.text();
    expect(xmlText(xml, "Say")).toContain("ما وضحت لي الإجابة");
    action = gatherAction(xml);
    response = await turn(request(action!, { SpeechResult: "" }));
    xml = await response.text();
    expect(xmlText(xml, "Say")).toContain("نعيد السؤال مرة أخيرة");
    action = gatherAction(xml);
    expect(action).not.toBeNull();
    response = await turn(request(action!, { SpeechResult: "" }));
    xml = await response.text();
    expect(xml).toContain("<Hangup/>");
    expect(xmlText(xml, "Say")).toContain("ما قدرت أفهم إجابتك");
  });

  it("returns a polite disabled message with no configuration and reports false status", async () => {
    vi.stubEnv("NAQAH_VOICE_SECRET", "");
    vi.stubEnv("NAQAH_WORKER_PHONE", "");
    const response = await inbound(request("https://naqah.test/api/voice/inbound", { From: "+966507782190" }));
    const xml = await response.text();
    expect(response.status).toBe(200);
    assertWellFormedTwiml(xml);
    expect(xmlText(xml, "Say")).toContain("خط الاتصال مو مفعّل");
    expect(await (await status()).json()).toMatchObject({ ok: true, voice: { configured: false, number: null }, whatsapp: { configured: false }, ownerCall: { configured: false } });
  });

  it("returns 403 for missing or invalid signatures on inbound and turns", async () => {
    vi.stubEnv("TWILIO_AUTH_TOKEN", "route-test-token");
    const inboundUrl = "https://naqah.test/api/voice/inbound";
    const fields = { From: "+966507782190", CallSid: "CA-signature-check" };
    expect((await inbound(request(inboundUrl, fields))).status).toBe(403);
    const state = signVoiceState({ v: 1, sc: "report_call", l: "ar", t: Date.now(), a: [] });
    const action = `https://naqah.test/api/voice/turn?s=${encodeURIComponent(state)}`;
    expect((await turn(request(action, { SpeechResult: "نعم", CallSid: "CA-signature-check" }))).status).toBe(403);
    const bad = new Request(inboundUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Twilio-Signature": "bad" },
      body: new URLSearchParams(fields),
    });
    expect((await inbound(bad)).status).toBe(403);
    const badTurn = new Request(action, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Twilio-Signature": "bad" },
      body: new URLSearchParams({ SpeechResult: "نعم", CallSid: "CA-signature-check" }),
    });
    expect((await turn(badTurn)).status).toBe(403);
  });

  it("returns 413 for oversized sample-line inbound and turn forms", async () => {
    const inboundResponse = await inbound(new Request("https://naqah.test/api/voice/inbound", {
      method: "POST", headers: { "content-length": String(32 * 1024 + 1) }, body: "x",
    }));
    const turnResponse = await turn(new Request("https://naqah.test/api/voice/turn", {
      method: "POST", headers: { "content-length": String(32 * 1024 + 1) }, body: "x",
    }));
    expect(inboundResponse.status).toBe(413);
    expect(turnResponse.status).toBe(413);
  });

  it("accepts signatures for relative action URLs resolved through forwarded public headers", async () => {
    vi.stubEnv("TWILIO_AUTH_TOKEN", "route-test-token");
    const publicInbound = "https://naqah.test/api/voice/inbound";
    const internalInbound = "http://internal:3000/api/voice/inbound";
    const fields = { From: "+966507782190", CallSid: "CA-forwarded" };
    const started = await inbound(signedRequest(internalInbound, fields, publicInbound, true));
    const xml = await started.text();
    expect(started.status).toBe(200);
    const relative = gatherActionRaw(xml);
    expect(relative).toMatch(/^\/api\/voice\/turn\?s=/);
    const publicAction = new URL(relative!, "https://naqah.test").toString();
    const internalAction = new URL(relative!, "http://internal:3000").toString();
    const token = new URL(publicAction).searchParams.get("s")!;
    const turnFields = { ...fields, SpeechResult: scriptedSpeech(token) };
    const response = await turn(signedRequest(internalAction, turnFields, publicAction, true));
    expect(response.status).toBe(200);
    expect(gatherActionRaw(await response.text())).toMatch(/^\/api\/voice\/turn\?s=/);
  });

  it("binds signed conversation state to its inbound CallSid", async () => {
    vi.stubEnv("TWILIO_AUTH_TOKEN", "route-test-token");
    const inboundUrl = "https://naqah.test/api/voice/inbound";
    const fields = { From: "+966507782190", CallSid: "CA-original" };
    const started = await inbound(signedRequest(inboundUrl, fields));
    const action = gatherAction(await started.text())!;
    const mismatched = { ...fields, CallSid: "CA-different", SpeechResult: "نعم" };
    const response = await turn(signedRequest(action, mismatched));
    expect(response.status).toBe(403);
    expect(gatherActionRaw(await response.text())).toBeNull();
  });

  it("dispatches each signed worker report once, skips owner inquiry, and never dispatches unsigned reports", async () => {
    vi.stubEnv("TWILIO_AUTH_TOKEN", "route-test-token");
    vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "phone-id");
    vi.stubEnv("WHATSAPP_TOKEN", "wa-test-token");
    vi.stubEnv("NAQAH_OWNER_WHATSAPP", "+966550123344");
    vi.stubEnv("NAQAH_CALL_OWNER", "1");
    vi.stubEnv("TWILIO_ACCOUNT_SID", "AC-test");
    vi.stubEnv("TWILIO_PHONE_NUMBER", "+966500000000");
    const fetchMock = vi.fn(async (...args: [string | URL, RequestInit?]) => {
      void args;
      return new Response(null, { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const worker = await driveCall("+966507782190", "CA-worker-report", true);
    expect(worker.completed).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const whatsappCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes("graph.facebook.com"));
    const ownerCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes("api.twilio.com"));
    expect(whatsappCalls).toHaveLength(1);
    expect(ownerCalls).toHaveLength(1);
    const ownerBody = new URLSearchParams(String((ownerCalls[0] as unknown as [string, RequestInit])[1].body));
    expect(ownerBody.get("Twiml")!.length).toBeLessThan(4_000);

    fetchMock.mockClear();
    const ownerInquiry = await driveCall("+966550123344", "CA-owner-inquiry", true);
    expect(ownerInquiry.completed).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();

    vi.stubEnv("TWILIO_AUTH_TOKEN", "");
    const skipped = vi.spyOn(console, "info").mockImplementation(() => {});
    const unsignedWorker = await driveCall("+966507782190", "CA-unsigned-worker", false);
    expect(unsignedWorker.completed).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(skipped.mock.calls.filter(([line]) => line === "owner summary skipped: unsigned webhook")).toHaveLength(1);
  });

  it("does not crash or call the owner when owner-call credentials are partial", async () => {
    vi.stubEnv("TWILIO_AUTH_TOKEN", "route-test-token");
    vi.stubEnv("NAQAH_OWNER_PHONE", "");
    vi.stubEnv("NAQAH_CALL_OWNER", "1");
    vi.stubEnv("TWILIO_ACCOUNT_SID", "AC-test");
    vi.stubEnv("TWILIO_PHONE_NUMBER", "+966500000000");
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await driveCall("+966507782190", "CA-no-owner", true);
    expect(result.completed).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    { vercel: "production", node: "test" },
    { vercel: "preview", node: "production" },
  ])("refuses unsigned live voice in production with the configured-line response", async ({ vercel, node }) => {
    vi.stubEnv("TWILIO_AUTH_TOKEN", "");
    vi.stubEnv("VERCEL_ENV", vercel);
    vi.stubEnv("NODE_ENV", node);
    vi.stubEnv("NAQAH_ALLOW_UNSIGNED_VOICE", "0");
    const response = await inbound(request("https://naqah.test/api/voice/inbound", { From: "+966507782190" }));
    const xml = await response.text();
    expect(response.status).toBe(200);
    expect(xmlText(xml, "Say")).toContain("خط الاتصال مو مفعّل");
    expect(gatherActionRaw(xml)).toBeNull();
  });

  it("refuses unsigned voice even when the legacy override is set in production", async () => {
    vi.stubEnv("TWILIO_AUTH_TOKEN", "");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("NAQAH_ALLOW_UNSIGNED_VOICE", "1");
    const response = await inbound(request("https://naqah.test/api/voice/inbound", { From: "+966507782190" }));
    expect(response.status).toBe(200);
    const xml = await response.text();
    expect(xmlText(xml, "Say")).toContain("خط الاتصال مو مفعّل");
    expect(gatherActionRaw(xml)).toBeNull();
  });

  it("returns goodbye TwiML and logs only the error name when engine replay throws", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(voiceConversation, "replayVoiceState").mockImplementationOnce(() => { throw new TypeError("sensitive provider detail"); });
    const response = await inbound(request("https://naqah.test/api/voice/inbound", { From: "+966507782190" }));
    const xml = await response.text();
    expect(response.status).toBe(200);
    expect(xml).toContain("<Hangup/>");
    expect(log).toHaveBeenCalledWith("TypeError");
    expect(log.mock.calls.flat().join(" ")).not.toContain("sensitive provider detail");
  });

  it("catches turn replay errors and returns a 200 goodbye without logging the message", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(voiceConversation, "replayVoiceState").mockImplementationOnce(() => { throw new RangeError("private answer content"); });
    const state = signVoiceState({ v: 1, sc: "report_call", l: "en", t: Date.now(), a: [] });
    const response = await turn(request(`https://naqah.test/api/voice/turn?s=${encodeURIComponent(state)}`, { SpeechResult: "answer" }));
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("<Hangup/>");
    expect(log).toHaveBeenCalledWith("RangeError");
    expect(log.mock.calls.flat().join(" ")).not.toContain("private answer content");
  });

  it.each([
    { paidEnv: { WHATSAPP_TOKEN: "dry-run-token" } },
    { paidEnv: { NAQAH_CALL_OWNER: "1" } },
  ])("makes the voice verifier stop before any request when its default dry-run sees paid settings", ({ paidEnv }) => {
    const result = spawnSync(process.execPath, [
      "scripts/verify-naqah.mjs", "voice", "--worker-phone", "+966507782190",
    ], {
      cwd: process.cwd(),
      env: { PATH: process.env.PATH ?? "", NODE_ENV: "test", ...paidEnv },
      encoding: "utf8",
    });
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      dryRun: true,
      reason: expect.stringContaining("dry-run refuses"),
    });
  });

  it("lets --allow-paid bypass the dry-run guard without starting a report when no worker is supplied", () => {
    const result = spawnSync(process.execPath, ["scripts/verify-naqah.mjs", "voice", "--allow-paid"], {
      cwd: process.cwd(),
      env: { PATH: process.env.PATH ?? "", NODE_ENV: "test", WHATSAPP_TOKEN: "dry-run-token" },
      encoding: "utf8",
    });
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout).reason).toBe("set --worker-phone or NAQAH_WORKER_PHONE to a registered caller ID");
  });

  it("reports a full build commit only, never arbitrary environment text", async () => {
    vi.stubEnv("NEXT_PUBLIC_NAQAH_BUILD_COMMIT", "a".repeat(40));
    expect((await (await status()).json()).version.commit).toBe("a".repeat(40));
    vi.stubEnv("NEXT_PUBLIC_NAQAH_BUILD_COMMIT", "not-a-commit-or-a-secret");
    expect((await (await status()).json()).version.commit).toBeNull();
  });

  it("reports whether Twilio signature validation is enabled without exposing the token", async () => {
    vi.stubEnv("TWILIO_AUTH_TOKEN", "secret-value");
    const payload = await (await status()).json();
    expect(payload.voice.signatureValidation).toBe(true);
    expect(JSON.stringify(payload)).not.toContain("secret-value");
    vi.stubEnv("TWILIO_AUTH_TOKEN", "");
    expect((await (await status()).json()).voice.signatureValidation).toBe(false);
  });

  it("reports the sample line as sample, and farm mode without paid summaries", async () => {
    vi.stubEnv("NAQAH_VOICE_SECRET", "secret-value-at-least-32-bytes-long");
    vi.stubEnv("NAQAH_WORKER_PHONE", "+966500000000");
    vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "1");
    vi.stubEnv("WHATSAPP_TOKEN", "t");
    vi.stubEnv("NAQAH_OWNER_WHATSAPP", "966500000000");
    const sample = await (await status()).json();
    expect(sample.voice).toMatchObject({ mode: "sample", configured: true });
    expect(sample.whatsapp.configured).toBe(true);
    vi.stubEnv("NAQAH_VOICE_MODE", "farm");
    const farm = await (await status()).json();
    expect(farm.voice).toMatchObject({ mode: "farm", configured: false });
    expect(farm.whatsapp.configured).toBe(false);
  });

  it("returns 204 to the Twilio status callback", async () => {
    const response = await voiceStatus(request("https://naqah.test/api/voice/status"));
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
  });
});
