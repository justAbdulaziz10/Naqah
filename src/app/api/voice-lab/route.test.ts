import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  writes.length = 0;
  reads.length = 0;
  urls.length = 0;
  owner = { id: "owner-1", email: "owner@example.test", email_confirmed_at: "2026-01-01" };
  vi.stubEnv("NAQAH_VOICE_LAB", "1");
  vi.stubEnv("NAQAH_VOICE_LAB_OWNERS", "owner@example.test");
  vi.stubEnv("OPENAI_API_KEY", "sk-test-key");
  vi.stubEnv("NAQAH_VOICE_SECRET", "test-secret");
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL, init?: RequestInit) => {
    urls.push({ url: String(input), method: init?.method ?? "GET" });
    return new Response("v=0\r\nanswer", { status: 201, headers: { Location: "/v1/realtime/calls/rtc_test123" } });
  }));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function runCall() {
  const opened = await (await post({ op: "open", mode: "text", locale: "ar", sdp: "v=0\r\noffer" })).json();
  expect(opened.ok).toBe(true);
  let state: string = opened.state;
  let view = opened.view;
  for (let turn = 0; turn < 80 && !view.isSummary; turn += 1) {
    const step = await (await post({ op: "tool", state, name: "answer_question", args: { text: "5" }, spoke: true })).json();
    let next = step;
    if (step.refused) {
      const replies = JSON.parse(step.output).replies as string[] | undefined;
      next = await (await post({ op: "tool", state: step.state, name: "answer_question", args: { value: replies?.[0] ?? "unknown" }, spoke: true })).json();
    }
    state = next.state;
    view = next.view;
  }
  expect(view.isSummary).toBe(true);
  const saved = await (await post({ op: "tool", state, name: "confirm_report", args: { confirmed: true }, spoke: true, workerUtterance: "إيه احفظه", heardSummary: true })).json();
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

  it("checks the worker's words on the way through, including when there are none", async () => {
    const opened = await (await post({ op: "open", mode: "text", locale: "ar", sdp: "v=0\r\noffer" })).json();
    const answer = async (heard: string) => (await post({ op: "tool", state: opened.state, name: "answer_question", args: { value: "yes" }, spoke: true, heard })).json();
    for (const [heard, refused] of [["العلف زين", "answer_off_topic"], ["", "answer_unclear"], ["   ", "answer_unclear"]]) {
      const reply = await answer(heard);
      expect(reply.refused).toBe(refused);
      expect(reply.view.facts).toEqual([]);
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

  it("does not hang up with another owner's token, or take the hang-up token as a call", async () => {
    const opened = await (await post({ op: "open", mode: "text", locale: "ar", sdp: "v=0\r\noffer" })).json();
    expect((await post({ op: "tool", state: opened.closeState, name: "end_call", args: { reason: "worker_ended" }, spoke: true })).status).toBe(410);
    urls.length = 0;
    owner = { id: "owner-2", email: "owner@example.test", email_confirmed_at: "2026-01-01" };
    expect((await post({ op: "close", state: opened.closeState })).status).toBe(410);
    expect(urls).toEqual([]);
  });
});
