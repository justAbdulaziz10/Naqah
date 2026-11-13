import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimitState } from "@/server/rate-limit";

const writes: string[] = [];
const reads: string[] = [];
const WRITE_METHODS = new Set(["insert", "update", "upsert", "delete", "rpc"]);

/** A Supabase client that answers every read with nothing and records any attempt to write. */
function fakeClient(): unknown {
  const chain = (table: string): unknown =>
    new Proxy(() => undefined, {
      get(_target, key) {
        if (key === "then") return (resolve: (value: unknown) => unknown) => resolve({ data: null, error: null });
        if (typeof key === "string" && WRITE_METHODS.has(key)) writes.push(`${table}.${key}`);
        return () => chain(table);
      },
      apply: () => chain(table),
    });
  return new Proxy({}, {
    get: (_target, key) => {
      if (key === "from") return (table: string) => { reads.push(table); return chain(table); };
      if (key === "rpc") return (name: string) => { writes.push(`rpc.${name}`); return chain("rpc"); };
      return undefined;
    },
  });
}

let owner: { id: string; email: string; email_confirmed_at: string } | null = { id: "owner-1", email: "owner@example.test", email_confirmed_at: "2026-01-01" };

vi.mock("server-only", () => ({}));
vi.mock("@/server/voice-lab/limit", () => ({ allowLabOpen: async () => true }));
vi.mock("@/lib/supabase/server", () => ({
  getOwner: async () => ({ user: owner, unavailable: false }),
  createClient: async () => fakeClient(),
}));

const { POST } = await import("./route");

const origin = "http://localhost:3640";
const post = (body: object, headers: Record<string, string> = {}) =>
  POST(new Request(`${origin}/api/voice-lab`, { method: "POST", headers: { origin, host: "localhost:3640", ...headers }, body: JSON.stringify(body) }));
const urls: { url: string; method: string }[] = [];

beforeEach(() => {
  resetRateLimitState();
  writes.length = 0;
  reads.length = 0;
  urls.length = 0;
  owner = { id: "owner-1", email: "owner@example.test", email_confirmed_at: "2026-01-01" };
  vi.stubEnv("NAQAH_VOICE_LAB", "1");
  vi.stubEnv("NAQAH_VOICE_LAB_OWNERS", "owner@example.test");
  vi.stubEnv("OPENAI_API_KEY", "sk-test-key");
  vi.stubEnv("NAQAH_VOICE_SECRET", "test-secret");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
  vi.stubEnv("SUPABASE_SECRET_KEY", "");
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL, init?: RequestInit) => {
    urls.push({ url: String(input), method: init?.method ?? "GET" });
    return new Response("v=0\r\nanswer", { status: 201, headers: { Location: "/v1/realtime/calls/rtc_test123" } });
  }));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

type Prompt = { question: string; topic: string; replies: { value: string; label: string }[]; isSummary: boolean; numberExpected: boolean };
const promptOf = (step: { output: string }) => JSON.parse(step.output) as Prompt;
const sessionSent = async () => {
  const call = vi.mocked(fetch).mock.calls.find(([, init]) => init?.body instanceof FormData);
  return JSON.parse((call![1]!.body as FormData).get("session") as string) as { tool_choice: string; instructions: string; tools: unknown[] };
};

/** Walks a report as the model would: every question comes from the last tool result. */
async function runCall() {
  const opened = await (await post({ op: "open", mode: "text", locale: "ar", sdp: "v=0\r\noffer" })).json();
  expect(opened.ok).toBe(true);
  let step = await (await post({ op: "tool", state: opened.state, name: "repeat_or_clarify", args: { reason: "asked_to_repeat" }, spoke: true, workerUtterance: "عيد السؤال" })).json();
  for (let turn = 0; turn < 80 && !step.view.isSummary; turn += 1) {
    const prompt = promptOf(step);
    const choice = prompt.numberExpected || !prompt.replies.length ? null : prompt.replies[0];
    const args = choice ? { value: choice.value, topic: prompt.topic } : { text: "5", topic: prompt.topic };
    step = await (await post({ op: "tool", state: step.state, name: "answer_question", args, spoke: true, workerUtterance: choice?.label ?? "5" })).json();
    expect(step.refused).toBeNull();
  }
  expect(step.view.isSummary).toBe(true);
  expect(step.summaryId).toBeTruthy();
  const saved = await (await post({ op: "tool", state: step.state, name: "confirm_report", args: { confirmed: true }, spoke: true, workerUtterance: "إيه احفظه", heardSummaryId: step.summaryId })).json();
  await post({ op: "close", state: opened.closeState });
  return { opened, saved };
}

describe("POST /api/voice-lab", () => {
  it("runs a whole confirmed report with no database write and no request but OpenAI's", async () => {
    const { saved, opened } = await runCall();
    expect(JSON.parse(saved.output).status).toBe("saved");
    expect(saved.view.verdict).toEqual({ kind: "would_save" });
    expect(writes).toEqual([]);
    expect(urls.length).toBeGreaterThan(1);
    for (const { url } of urls) expect(url.startsWith("https://api.openai.com/v1/realtime/calls")).toBe(true);
    expect(JSON.stringify(opened)).not.toContain("sk-test-key");
  });

  it("gives the model the real call's session: every tool, tools required, the first step", async () => {
    const opened = await (await post({ op: "open", mode: "voice", locale: "ar", sdp: "v=0\r\noffer" })).json();
    const session = await sessionSent();
    expect(session.tool_choice).toBe("required");
    expect(session.tools.length).toBe(9);
    expect(session.instructions).toContain('"firstStep"');
    expect(opened.repromptText).toBeTruthy();
    expect(opened.view.mode).toBe("guided");
  });

  it("signs only the agent's latest line, as a real call stores it", async () => {
    const opened = await (await post({ op: "open", mode: "text", locale: "ar", sdp: "v=0\r\noffer" })).json();
    const step = await (await post({ op: "tool", state: opened.state, name: "answer_question", args: { value: "yes", topic: "herd" }, spoke: true, workerUtterance: "كلها بخير" })).json();
    expect(step.refused).toBeNull();
    const signed = JSON.parse(Buffer.from(step.state.split(".")[0], "base64url").toString()) as { session: { turns: unknown[] } };
    expect(signed.session.turns).toHaveLength(1);
  });

  it("checks the worker's words on the way through, including when there are none", async () => {
    const opened = await (await post({ op: "open", mode: "text", locale: "ar", sdp: "v=0\r\noffer" })).json();
    const answer = async (workerUtterance: string) => (await post({ op: "tool", state: opened.state, name: "answer_question", args: { value: "yes", topic: opened.view.step === "report_question" ? "herd" : "other" }, spoke: true, workerUtterance })).json();
    for (const [words, refused, silent] of [["العلف زين", "answer_off_topic", undefined], ["", "noise", true], ["   ", "noise", true]] as const) {
      const reply = await answer(words);
      expect(reply.refused).toBe(refused);
      expect(reply.silent).toBe(silent);
      expect(reply.view.facts).toHaveLength(silent ? 0 : 1);
    }
    expect(writes).toEqual([]);
  });

  it("is a 404 when the Lab is switched off or the owner isn't listed", async () => {
    vi.stubEnv("NAQAH_VOICE_LAB", "");
    expect((await post({ op: "status" })).status).toBe(404);
    vi.stubEnv("NAQAH_VOICE_LAB", "1");
    owner = { id: "x", email: "stranger@example.test", email_confirmed_at: "2026-01-01" };
    expect((await post({ op: "status" })).status).toBe(404);
  });

  it("refuses signed-out and cross-site requests, with no OpenAI call", async () => {
    expect((await post({ op: "open" }, { origin: "https://evil.test" })).status).toBe(403);
    owner = null;
    expect((await post({ op: "open", mode: "text", locale: "ar", sdp: "v=0" })).status).toBe(401);
    expect(urls).toEqual([]);
  });

  it("bounds JSON before parsing and rejects malformed JSON", async () => {
    const oversized = await POST(new Request(`${origin}/api/voice-lab`, {
      method: "POST",
      headers: { origin, host: "localhost:3640", "content-type": "application/json" },
      body: JSON.stringify({ op: "open", sdp: "x".repeat(70_000) }),
    }));
    expect(oversized.status).toBe(413);
    expect(await oversized.json()).toEqual({ ok: false, error: "payload_too_large" });
    const malformed = await POST(new Request(`${origin}/api/voice-lab`, {
      method: "POST", headers: { origin, host: "localhost:3640" }, body: "{",
    }));
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({ ok: false, error: "invalid_input" });
    expect(urls).toEqual([]);
  });

  it("does not hang up with another owner's token, or take the hang-up token as a call", async () => {
    const opened = await (await post({ op: "open", mode: "text", locale: "ar", sdp: "v=0\r\noffer" })).json();
    expect((await post({ op: "tool", state: opened.closeState, name: "end_call", args: { reason: "worker_ended" }, spoke: true })).status).toBe(410);
    urls.length = 0;
    owner = { id: "owner-2", email: "owner@example.test", email_confirmed_at: "2026-01-01" };
    expect((await post({ op: "close", state: opened.closeState })).status).toBe(410);
    expect(urls).toEqual([]);
  });
});
