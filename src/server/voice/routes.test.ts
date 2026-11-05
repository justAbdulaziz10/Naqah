import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as inbound } from "@/app/api/voice/inbound/route";
import { POST as turn } from "@/app/api/voice/turn/route";
import { GET as status } from "@/app/api/integrations/status/route";
import { POST as voiceStatus } from "@/app/api/voice/status/route";
import { replayVoiceState } from "./conversation";
import { verifyVoiceState, VOICE_MISS_VALUE } from "./state";

vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, connection: vi.fn(async () => {}) };
});

const envNames = [
  "NAQAH_VOICE_SECRET", "NAQAH_WORKER_PHONE", "NAQAH_OWNER_PHONE", "NAQAH_VOICE_LOCALE",
  "NAQAH_VOICE_ARABIC_VOICE", "NAQAH_VOICE_ENGLISH_VOICE", "TWILIO_AUTH_TOKEN", "TWILIO_ACCOUNT_SID",
  "TWILIO_PHONE_NUMBER", "NAQAH_CALL_OWNER", "NEXT_PUBLIC_NAQAH_PHONE_NUMBER", "WHATSAPP_PHONE_NUMBER_ID",
  "WHATSAPP_TOKEN", "NAQAH_OWNER_WHATSAPP", "WHATSAPP_TEMPLATE_NAME", "WHATSAPP_TEMPLATE_LANGUAGE",
];

function request(url: string, fields: Record<string, string> = {}) {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields),
  });
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

function gatherAction(xml: string): string | null {
  const raw = xml.match(/<Gather\b[^>]*\baction="([^"]+)"/)?.[1];
  return raw?.replaceAll("&quot;", '"').replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&") ?? null;
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
    const state = { v: 1 as const, sc: "worker_report" as const, l: "ar" as const, t: 1_798_900_000_000, a: [] };
    const first = replayVoiceState(state);
    const second = replayVoiceState(state);
    expect(first.session).toEqual(second.session);
    expect(first.workspace.createdAt).toBe(new Date(state.t).toISOString());
    expect(first.workspace.camels.map((camel) => camel.id)).toEqual(second.workspace.camels.map((camel) => camel.id));
    expect(first.workspace.reports.map((report) => report.at)).toEqual(second.workspace.reports.map((report) => report.at));
  });

  it("keeps completed report, call, and event IDs and times stable across a full replay", () => {
    const base = { v: 1 as const, sc: "worker_report" as const, l: "en" as const, t: Date.parse("2026-11-05T10:00:00.000Z"), a: [] as { value?: string; text?: string }[] };
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
        completed = xml.includes("<Hangup/>") && /حفظ|saved/i.test(xmlText(xml, "Say") ?? "");
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

  it("reprompts once, then selects the unknown reply when a second answer misses", async () => {
    const started = await inbound(request("https://naqah.test/api/voice/inbound", { From: "+966507782190" }));
    const initialXml = await started.text();
    const firstAction = gatherAction(initialXml)!;
    const missedOnce = await turn(request(firstAction, { SpeechResult: "unrecognized words" }));
    const firstRetryXml = await missedOnce.text();
    expect(xmlText(firstRetryXml, "Say")).toContain("ما فهمت عليك");
    const secondAction = gatherAction(firstRetryXml)!;
    const missedTwice = await turn(request(secondAction, { SpeechResult: "still unrecognized" }));
    const secondRetryXml = await missedTwice.text();
    expect(xmlText(secondRetryXml, "Say")).not.toContain("ما فهمت عليك");
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
    expect(xmlText(xml, "Say")).toContain("ما فهمت عليك");
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
    expect(xmlText(xml, "Say")).toContain("خط الاتصال غير مفعّل");
    expect(await (await status()).json()).toMatchObject({ ok: true, voice: { configured: false, number: null }, whatsapp: { configured: false }, ownerCall: { configured: false } });
  });

  it("returns 204 to the Twilio status callback", async () => {
    const response = await voiceStatus();
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
  });
});
