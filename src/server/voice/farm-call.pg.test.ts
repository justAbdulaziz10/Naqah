import { execFileSync } from "node:child_process";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { createServer, request as httpRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createClient } from "@supabase/supabase-js";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as inbound } from "@/app/api/voice/inbound/route";
import { POST as voiceStatus } from "@/app/api/voice/status/route";
import { POST as turn } from "@/app/api/voice/turn/route";
import { POST as outbound } from "@/app/api/voice/outbound/route";
import { POST as outboundStatus } from "@/app/api/voice/outbound/status/route";
import { runReportCallScheduler } from "@/server/calls/scheduler";
import { recordingCaller, type OutboundCallResult } from "@/server/calls/twilio";
import { createServiceClient } from "@/server/db/service-client";
import { loadFarm } from "@/server/db/queries";
import { advanceVoiceSession, readVoiceSession } from "@/server/db/voice-sessions";
import { twilioRequestSignature } from "@/server/twilio/signature";
import { applyVoiceEvent } from "@/server/voice/contract";

vi.mock("server-only", () => ({}));

/**
 * LOCAL ONLY, through supabase/local-validation/run-voice.sh. Twilio is mocked by signing requests
 * with a test token; everything after the route handler is real, including PostgREST. Skipped
 * without NAQAH_TEST_POSTGREST.
 */
const database = process.env.NAQAH_TEST_DB;
const rest = process.env.NAQAH_TEST_POSTGREST;
const jwtSecret = process.env.NAQAH_TEST_JWT_SECRET ?? "";
const BASE = "https://naqah.test";
const TOKEN = "voice-test-auth-token";
// Sunday 09:00 in Riyadh.
const SUNDAY = new Date("2026-11-08T06:00:00.000Z");

function sql(query: string): string {
  return execFileSync("psql", ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-d", database!], {
    input: query, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}
const q = (value: string) => `'${value.replaceAll("'", "''")}'`;
const count = (query: string) => Number(sql(`select count(*) from ${query}`));

function jwt(claims: object): string {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const body = `${part({ alg: "HS256", typ: "JWT" })}.${part({ exp: 4_102_444_800, ...claims })}`;
  return `${body}.${createHmac("sha256", jwtSecret).update(body).digest("base64url")}`;
}

const phone = () => `+9665${String(10_000_000 + Math.floor(Math.random() * 89_999_999))}`;
const sid = () => `CA${randomBytes(16).toString("hex")}`;

interface Farm { id: string; ownerId: string; worker: string; owner: string; camels: string[] }

function seedFarm(options: {
  plan?: "basic" | "ultimate"; worker?: string; owner?: string; custom?: string[]; setup?: boolean;
  workerName?: string; camels?: string[]; window?: [number, string, string]; resources?: string[]; language?: string;
  /** NAQAH calls for the report; a worker only reports by phoning in after missing that call. Default true. */
  missedReportCall?: boolean; callTime?: string; callDay?: number;
} = {}): Farm {
  const ownerId = randomUUID();
  const worker = options.worker ?? phone();
  const owner = options.owner ?? phone();
  const plan = options.plan ?? "ultimate";
  const window = options.window;
  sql(`insert into auth.users values (${q(ownerId)})`);
  const id = sql(`insert into farms (owner_id, plan, setup_complete, owner_name, owner_phone, name, location, window_day, window_start, window_end)
    values (${q(ownerId)}, ${q(plan)}, ${options.setup ?? true}, 'Salem', ${q(owner)}, 'Test farm', 'Qassim',
    ${window ? window[0] : "null"}, ${window ? q(window[1]) : "null"}, ${window ? q(window[2]) : "null"}) returning id`).split("\n")[0];
  sql(`insert into workers (farm_id, name, phone, language) values (${q(id)}, ${q(options.workerName ?? "Yousef")}, ${q(worker)}, ${q(options.language ?? "en")})`);
  const all = sql(`select unnest(enum_range(null::resource_kind))`).split("\n");
  for (const kind of all) {
    const present = (options.resources ?? ["feed"]).includes(kind);
    sql(`insert into resources (farm_id, kind, present) values (${q(id)}, ${q(kind)}, ${present})`);
  }
  sql(`insert into criteria (farm_id, kind, enabled) values (${q(id)}, 'low_feed', true), (${q(id)}, 'sick_camel', true)`);
  const camels = (options.camels ?? ["Noura"]).map((name) =>
    sql(`insert into camels (farm_id, name, tag) values (${q(id)}, ${q(name)}, 'T1') returning id`).split("\n")[0]);
  (options.custom ?? []).forEach((text, index) => {
    sql(`insert into custom_questions (farm_id, text, sort_order) values (${q(id)}, ${q(text)}, ${index})`);
  });
  if (options.callTime) {
    sql(`update farms set call_time = ${q(options.callTime)}, call_day = ${options.callDay ?? "null"} where id = ${q(id)}`);
  }
  if (options.missedReportCall ?? true) {
    // This morning's report call rang out three times, so the worker may phone in with the report.
    const tries = ["05:00", "05:20", "05:40"].map((at) => ({ at: `2026-11-08T${at}:00.000Z`, result: "no_answer" }));
    sql(`insert into report_call_runs (farm_id, occurrence, trigger, attempts, state)
      values (${q(id)}, '2026-11-08T05:00:00Z', 'schedule', ${q(JSON.stringify(tries))}::jsonb, 'missed')`);
  }
  return { id, ownerId, worker, owner, camels };
}

function hook(path: string, fields: Record<string, string>, token = TOKEN): Request {
  const url = `${BASE}${path}`;
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Twilio-Signature": twilioRequestSignature(url, fields, token) },
    body: new URLSearchParams(fields),
  });
}

const decode = (text: string) => text.replaceAll("&apos;", "'").replaceAll("&quot;", '"').replaceAll("&gt;", ">").replaceAll("&lt;", "<").replaceAll("&amp;", "&");
const said = (xml: string) => decode(xml.match(/<Say\b[^>]*>([\s\S]*?)<\/Say>/)?.[1] ?? "");
const nextPath = (xml: string) => {
  const raw = xml.match(/<Gather\b[^>]*\baction="([^"]+)"/)?.[1];
  return raw ? decode(raw) : null;
};

class Call {
  readonly sid = sid();
  xml = "";
  path: string | null = null;
  constructor(readonly from: string) {}
  async start() {
    const response = await inbound(hook("/api/voice/inbound", { CallSid: this.sid, From: this.from, To: "+15550100" }));
    expect(response.status).toBe(200);
    this.xml = await response.text();
    this.path = nextPath(this.xml);
    return this;
  }
  async post(fields: Record<string, string>) {
    return turn(hook(this.path!, { CallSid: this.sid, From: this.from, ...fields }));
  }
  async say(speech: string) {
    return this.step({ SpeechResult: speech });
  }
  async press(digits: string) {
    return this.step({ Digits: digits });
  }
  private async step(fields: Record<string, string>) {
    const response = await this.post(fields);
    expect(response.status).toBe(200);
    this.xml = await response.text();
    this.path = nextPath(this.xml);
    return this;
  }
  get text() { return said(this.xml); }
  get ended() { return this.xml.includes("<Hangup/>"); }
  /** The options are only read out on request, so a choice shows in the Gather, not in the words. */
  get choices() { return this.xml.includes('numDigits="1"'); }
  async finish(status = "completed") {
    return voiceStatus(hook("/api/voice/status", { CallSid: this.sid, CallStatus: status }));
  }
}

/** Answers a one-camel, feed-only farm up to the confirmation question. */
async function answerToSummary(call: Call) {
  for (let turns = 0; turns < 15 && !call.text.includes("Confirm and save"); turns++) {
    if (/how many camels/i.test(call.text)) await call.say("one");
    else if (call.choices) await call.press("1");
    else await call.say("Nothing new to report");
  }
  expect(call.text).toContain("Confirm and save");
  return call;
}

describe.skipIf(!rest)("a real call on a real farm", () => {
  let proxy: Server;
  let proxyUrl: string;

  beforeAll(async () => {
    // supabase-js calls /rest/v1 on the platform; bare PostgREST serves the same API at the root.
    const target = new URL(rest!);
    proxy = createServer((req, res) => {
      const forward = httpRequest(
        { host: target.hostname, port: target.port, method: req.method, path: (req.url ?? "").replace(/^\/rest\/v1/, ""), headers: req.headers },
        (upstream) => {
          res.writeHead(upstream.statusCode ?? 502, upstream.headers);
          upstream.pipe(res);
        },
      );
      req.pipe(forward);
    });
    await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
    proxyUrl = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise((resolve) => proxy?.close(resolve));
  });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"], now: SUNDAY });
    vi.stubEnv("NAQAH_VOICE_MODE", "farm");
    vi.stubEnv("TWILIO_AUTH_TOKEN", TOKEN);
    vi.stubEnv("NAQAH_PUBLIC_BASE_URL", BASE);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", proxyUrl);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", jwt({ role: "anon" }));
    vi.stubEnv("SUPABASE_SECRET_KEY", jwt({ role: "service_role" }));
    vi.stubEnv("NAQAH_VOICE_LOCALE", "en");
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  const ownerView = (farm: Farm) => createClient(proxyUrl, jwt({ role: "authenticated", sub: farm.ownerId }), { auth: { persistSession: false } });

  describe("the milestone", () => {
    it("takes a call from the worker to a report the owner can load under RLS", async () => {
      const farm = seedFarm({ custom: ["Any visitors today?"] });
      const call = await new Call(farm.worker).start();
      expect(call.text).toContain("automated assistant");
      expect(call.text).toContain("Yousef");
      expect(call.text).not.toContain("Ahmed");

      await answerToSummary(call);
      await call.press("1");
      expect(call.text).toContain("saved");
      expect(call.text).not.toMatch(/calling|Abdullah/);
      expect(call.ended).toBe(true);

      expect(sql(`select provider_call_id from calls where farm_id = ${q(farm.id)} and kind = 'worker_report'`)).toBe(call.sid);
      const loaded = await loadFarm(ownerView(farm), { owner_id: farm.ownerId });
      const report = loaded!.workspace.reports[0];
      expect(loaded!.workspace.lastUpdateAt).not.toBeNull();
      expect(report.answers.map((a) => a.questionId)).toContain("feed_level");
      expect(report.answers.some((a) => a.question.en === "Any visitors today?" && a.answer === "Nothing new to report")).toBe(true);
    });

    it("asks this farm's questions and skips resources it doesn't have", async () => {
      const farm = seedFarm({ resources: ["water"], custom: ["Did the vet come?"] });
      const call = await new Call(farm.worker).start();
      const asked: string[] = [call.text];
      for (let turns = 0; turns < 15 && !call.text.includes("Confirm and save"); turns++) {
        if (call.choices) await call.press("1");
        else await call.say("No");
        asked.push(call.text);
      }
      const script = asked.join(" ");
      expect(script).toContain("Did the vet come?");
      expect(script).toMatch(/water/i);
      expect(script).not.toMatch(/feed/i);
    });

    it("saves a real number from the keypad, not its first digit", async () => {
      const farm = seedFarm();
      const call = await new Call(farm.worker).start();
      for (let turns = 0; turns < 8 && call.choices; turns++) await call.press("1");
      expect(call.xml).toContain('finishOnKey="#"');
      expect(call.text).toContain("then press #");
      await call.press("12");
      expect((await readVoiceSession(createServiceClient()!, call.sid))!.session.draft.herdCount).toBe(12);
    });

    it.each([
      ["ar", "عشرين", "20"], ["ar", "ثلاثين كيس", "30"], ["ar", "مية وخمسين لتر", "150"],
      ["ar", "تقريبا عشرة", "10"], ["ar", "٤٠", "40"],
      ["en", "thirty bags", "30"], ["en", "one hundred and fifty litres", "150"],
    ])("persists %s worker speech «%s» as an approximate quantity, with no extra question", async (language, speech, quantity) => {
      const farm = seedFarm({ language });
      const call = await new Call(farm.worker).start();
      let spoke = false;
      for (let turns = 0; turns < 25 && !call.ended; turns += 1) {
        const row = await readVoiceSession(createServiceClient()!, call.sid);
        expect(row).not.toBeNull();
        const current = row!.session;
        if (current.step === "report_summary") {
          expect(spoke).toBe(true);
          expect(count(`reports where farm_id = ${q(farm.id)}`)).toBe(0);
          await call.say(language === "ar" ? "تمام" : "yes");
        } else if (current.data.currentQuestionId === "feed_level") {
          await call.say(speech);
          const after = (await readVoiceSession(createServiceClient()!, call.sid))!.session;
          expect(after.data.currentQuestionId).not.toBe("feed_level");
          expect(after.draft.resourceUpdates.at(-1)).toMatchObject({ kind: "feed", level: "unknown", certainty: "approximate" });
          spoke = true;
        } else if (current.inputMode === "number") await call.say(language === "ar" ? "واحد" : "one");
        else await call.press("1");
      }
      expect(call.text).toMatch(/Your update is saved|تم حفظ التحديث/);
      expect(sql(`select quantity || ':' || certainty from resources where farm_id = ${q(farm.id)} and kind = 'feed'`)).toBe(`${quantity} ${language === "ar" ? "كيس" : "bags"}:approximate`);
    });

    it("clears a call whose end was never reported, on the next inbound call", async () => {
      const farm = seedFarm();
      const lost = await new Call(farm.worker).start();
      vi.setSystemTime(new Date(SUNDAY.getTime() + 3 * 60 * 60 * 1000));
      await new Call(farm.worker).start();
      expect(count(`voice_call_sessions where call_sid = ${q(lost.sid)}`)).toBe(0);
    });

    it("keeps answers out of URLs and removes working state when the call ends", async () => {
      const farm = seedFarm({ custom: ["Any visitors today?"] });
      const call = await answerToSummary(await new Call(farm.worker).start());
      expect(call.path).toMatch(/^\/api\/voice\/turn\?n=\d+$/);
      expect(JSON.parse(sql(`select session -> 'turns' from voice_call_sessions where call_sid = ${q(call.sid)}`))).toHaveLength(1);
      await call.press("1");
      expect((await call.finish()).status).toBe(204);
      expect(count(`voice_call_sessions where call_sid = ${q(call.sid)}`)).toBe(0);
    });
  });

  describe("webhook trust", () => {
    it("keeps signed preflight probes inert even with an active CallSid", async () => {
      const farm = seedFarm();
      const call = await new Call(farm.worker).start();
      const before = await readVoiceSession(createServiceClient()!, call.sid);
      for (const [path, handler] of [["inbound", inbound], ["turn", turn], ["outbound", outbound]] as const) {
        const response = await handler(hook(`/api/voice/${path}?preflight=1`, { CallSid: call.sid, From: farm.worker, Digits: "1" }));
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ preflight: true });
      }
      expect(await readVoiceSession(createServiceClient()!, call.sid)).toEqual(before);
      expect(count(`reports where farm_id = ${q(farm.id)}`)).toBe(0);
      expect(count(`calls where farm_id = ${q(farm.id)}`)).toBe(0);
    });
    it("rejects a bad or missing signature and writes nothing", async () => {
      const farm = seedFarm();
      const fields = { CallSid: sid(), From: farm.worker };
      const forged = await inbound(hook("/api/voice/inbound", fields, "wrong-token"));
      expect(forged.status).toBe(403);
      const unsigned = await inbound(new Request(`${BASE}/api/voice/inbound`, {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields),
      }));
      expect(unsigned.status).toBe(403);
      expect(count(`voice_call_sessions where farm_id = ${q(farm.id)}`)).toBe(0);
    });
    it("rejects a signed request whose body was changed", async () => {
      const farm = seedFarm();
      const call = await answerToSummary(await new Call(farm.worker).start());
      const signed = hook(call.path!, { CallSid: call.sid, Digits: "2" });
      const tampered = new Request(signed.url, { method: "POST", headers: signed.headers, body: new URLSearchParams({ CallSid: call.sid, Digits: "1" }) });
      expect((await turn(tampered)).status).toBe(403);
      expect(count(`reports where farm_id = ${q(farm.id)}`)).toBe(0);
    });
    it("refuses a forged status callback, so a live call keeps its state", async () => {
      const farm = seedFarm();
      const call = await new Call(farm.worker).start();
      const forged = await voiceStatus(hook("/api/voice/status", { CallSid: call.sid, CallStatus: "completed" }, "wrong-token"));
      expect(forged.status).toBe(403);
      expect(count(`voice_call_sessions where call_sid = ${q(call.sid)}`)).toBe(1);
    });
    it("never falls back to the sample farm when the secret key is missing", async () => {
      const farm = seedFarm();
      vi.stubEnv("SUPABASE_SECRET_KEY", "");
      vi.stubEnv("NAQAH_VOICE_SECRET", "a-sample-line-secret-of-at-least-32-bytes");
      vi.stubEnv("NAQAH_WORKER_PHONE", farm.worker);
      const xml = await (await inbound(hook("/api/voice/inbound", { CallSid: sid(), From: farm.worker }))).text();
      expect(said(xml)).toContain("not configured");
      expect(nextPath(xml)).toBeNull();
    });
  });

  describe("who is calling", () => {
    const refused = async (from: string) => {
      const call = await new Call(from).start();
      expect(call.ended).toBe(true);
      expect(call.path).toBeNull();
      expect(count(`voice_call_sessions where call_sid = ${q(call.sid)}`)).toBe(0);
      return call;
    };
    it("refuses an unknown number", async () => {
      expect((await refused(phone())).text).toContain("not registered");
    });
    it("refuses a hidden caller ID", async () => {
      await refused("anonymous");
      await refused("");
    });
    it("refuses a number registered on two farms and writes to neither", async () => {
      const shared = phone();
      const one = seedFarm({ worker: shared });
      const two = seedFarm({ worker: shared });
      await refused(shared);
      expect(count(`calls where farm_id in (${q(one.id)}, ${q(two.id)})`)).toBe(0);
    });
    it("refuses a number that is one farm's worker and another's owner", async () => {
      const shared = phone();
      seedFarm({ worker: shared });
      seedFarm({ owner: shared });
      await refused(shared);
    });
    it("refuses a farm whose setup isn't finished", async () => {
      const farm = seedFarm({ setup: false });
      expect((await refused(farm.worker)).text).toContain("setup");
    });
    it("won't speak the sample names when the worker has no name", async () => {
      const farm = seedFarm({ workerName: "" });
      const call = await refused(farm.worker);
      expect(call.text).not.toContain("Ahmed");
    });
  });

  describe("retries and duplicate webhooks", () => {
    it("answers a repeated first webhook with the same reply and one session", async () => {
      const farm = seedFarm();
      const call = await new Call(farm.worker).start();
      const again = await (await inbound(hook("/api/voice/inbound", { CallSid: call.sid, From: farm.worker }))).text();
      expect(again).toBe(call.xml);
      expect(count(`voice_call_sessions where call_sid = ${q(call.sid)}`)).toBe(1);
    });
    it("repeats a turn's reply without counting the answer twice", async () => {
      const farm = seedFarm();
      const call = await new Call(farm.worker).start();
      const path = call.path!;
      await call.press("1");
      const first = call.xml;
      const repeat = await (await turn(hook(path, { CallSid: call.sid, From: farm.worker, Digits: "1" }))).text();
      expect(repeat).toBe(first);
      expect(Number(sql(`select seq from voice_call_sessions where call_sid = ${q(call.sid)}`))).toBe(1);
    });
    it("lets only one webhook move a turn on, so a late one can't overwrite it", async () => {
      const farm = seedFarm();
      const call = await new Call(farm.worker).start();
      await call.press("1");
      const service = createClient(proxyUrl, jwt({ role: "service_role" }), { auth: { persistSession: false } });
      const current = await readVoiceSession(service, call.sid);
      const late = await advanceVoiceSession(service, call.sid, 0, { session: current!.session, misses: 0, last_response: "late" });
      expect(late).toBeNull();
      expect((await readVoiceSession(service, call.sid))!.last_response).toBe(call.xml);
    });
    it("saves one report when the confirming webhook repeats", async () => {
      const farm = seedFarm();
      const call = await answerToSummary(await new Call(farm.worker).start());
      const path = call.path!;
      await call.press("1");
      const repeat = await (await turn(hook(path, { CallSid: call.sid, From: farm.worker, Digits: "1" }))).text();
      expect(said(repeat)).toContain("saved");
      expect(count(`reports where farm_id = ${q(farm.id)}`)).toBe(1);
    });
    it("saves one report when the confirming webhook arrives twice at once", async () => {
      const farm = seedFarm();
      const call = await answerToSummary(await new Call(farm.worker).start());
      const fields = { CallSid: call.sid, From: farm.worker, Digits: "1" };
      const replies = await Promise.all([turn(hook(call.path!, fields)), turn(hook(call.path!, fields))]);
      for (const reply of replies) expect(said(await reply.text())).toContain("saved");
      expect(count(`reports where farm_id = ${q(farm.id)}`)).toBe(1);
      expect(count(`calls where farm_id = ${q(farm.id)} and kind = 'worker_report'`)).toBe(1);
      expect(count(`voice_events where farm_id = ${q(farm.id)}`)).toBe(1);
    });
    it("saves one report when confirmation webhooks arrive concurrently, and leaves the owner's call to the scheduler", async () => {
      const farm = seedFarm({ owner: "+15555550102" });
      sql(`update farms set owner_call_time = '00:00', owner_call_day = null where id = ${q(farm.id)}`);
      vi.stubEnv("NAQAH_CALL_OWNER", "1");
      vi.stubEnv("TWILIO_ACCOUNT_SID", `AC${"0".repeat(32)}`);
      vi.stubEnv("TWILIO_PHONE_NUMBER", "+15555550100");
      vi.stubEnv("NAQAH_VOICE_SECRET", "local-only-notification-regression-secret");
      vi.stubEnv("NAQAH_CALL_ALLOWLIST", farm.owner);
      const originalFetch = globalThis.fetch;
      const notifications = vi.fn(async () => Response.json({ sid: sid() }, { status: 201 }));
      vi.spyOn(globalThis, "fetch").mockImplementation((input, options) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        if (url.origin === "https://api.twilio.com") return notifications();
        if (url.hostname !== "127.0.0.1") throw new Error("Non-loopback fetch blocked");
        return originalFetch(input, options);
      });
      const call = await answerToSummary(await new Call(farm.worker).start());
      const fields = { CallSid: call.sid, From: farm.worker, Digits: "1" };
      const replies = await Promise.all([turn(hook(call.path!, fields)), turn(hook(call.path!, fields))]);
      for (const reply of replies) expect(said(await reply.text())).toContain("saved");
      expect(count(`reports where farm_id = ${q(farm.id)}`)).toBe(1);
      expect(notifications).not.toHaveBeenCalled();
    });
    it("records a refused call once however often the webhook repeats", async () => {
      const farm = seedFarm();
      const first = await answerToSummary(await new Call(farm.worker).start());
      await first.press("1");
      const fields = { CallSid: sid(), From: farm.worker };
      await inbound(hook("/api/voice/inbound", fields));
      const again = await (await inbound(hook("/api/voice/inbound", fields))).text();
      expect(said(again)).toContain("already received");
      expect(count(`calls where farm_id = ${q(farm.id)} and kind = 'worker_report_rejected'`)).toBe(1);
    });
  });

  describe("domain rules on the real path", () => {
    it("refuses a second report the same day", async () => {
      const farm = seedFarm();
      await (await answerToSummary(await new Call(farm.worker).start())).press("1");
      const second = await new Call(farm.worker).start();
      expect(second.text).toContain("already received");
      expect(second.ended).toBe(true);
      expect(count(`reports where farm_id = ${q(farm.id)}`)).toBe(1);
    });
    it("says so when another call saved the report during this one", async () => {
      const farm = seedFarm();
      const first = await answerToSummary(await new Call(farm.worker).start());
      const second = await answerToSummary(await new Call(farm.worker).start());
      await first.press("1");
      await second.press("1");
      expect(second.text).toContain("wasn't saved");
      expect(count(`reports where farm_id = ${q(farm.id)}`)).toBe(1);
    });
    it("tells a worker who phones in without a missed report call when NAQAH will call", async () => {
      const farm = seedFarm({ plan: "basic", missedReportCall: false, callTime: "17:00", callDay: 4 });
      const call = await new Call(farm.worker).start();
      expect(call.text).toContain("NAQAH will call you for the report");
      expect(call.text).toContain("Thu");
      expect(call.ended).toBe(true);
      expect(count(`calls where farm_id = ${q(farm.id)} and kind = 'worker_report_rejected'`)).toBe(1);
      expect(count(`reports where farm_id = ${q(farm.id)}`)).toBe(0);
    });
    it("keeps a call's questions fixed when the owner edits them mid-call", async () => {
      const farm = seedFarm({ custom: ["Old question?"] });
      const call = await new Call(farm.worker).start();
      sql(`update custom_questions set text = 'New question?' where farm_id = ${q(farm.id)}`);
      await answerToSummary(call);
      await call.press("1");
      expect(sql(`select count(*) from report_answers a join reports r on r.id = a.report_id where r.farm_id = ${q(farm.id)} and a.question_en = 'Old question?'`)).toBe("1");
    });
    it("saves a long herd answer the engine really produces", async () => {
      const farm = seedFarm({ camels: ["Noura", "Shaha", "Hamda"] });
      const note = "The left front leg is swollen and she has not been eating since yesterday morning ".repeat(3).trim();
      const call = await new Call(farm.worker).start();
      await call.press("2");
      for (let camel = 0; camel < 3; camel++) {
        await call.press("1");
        await call.press("3");
        await call.say(note);
        await call.press("1");
        if (camel < 2) await call.press("1");
      }
      await call.press("2");
      await answerToSummary(call);
      await call.press("1");
      expect(call.text).toContain("Your update is saved");
      expect(Number(sql(`select max(length(a.answer)) from report_answers a join reports r on r.id = a.report_id where r.farm_id = ${q(farm.id)}`))).toBeGreaterThan(500);
    });
    it("keeps a concern when the worker can't say which camel", async () => {
      const farm = seedFarm();
      const call = await new Call(farm.worker).start();
      await call.press("2");
      await call.say("I don't know");
      await answerToSummary(call);
      expect(call.text).toContain("A camel needs attention (unspecified)");
      await call.press("1");
      expect(count(`findings f join reports r on r.id = f.report_id where r.farm_id = ${q(farm.id)}`)).toBe(1);
    });
    it("says a missed call is the reason when one opens during the report", async () => {
      const farm = seedFarm();
      const call = await answerToSummary(await new Call(farm.worker).start());
      sql(`insert into no_answer_tickets (farm_id, purpose, message) values (${q(farm.id)}, 'instruction', 'Move the herd')`);
      await call.press("1");
      expect(call.text).toContain("missed call");
      expect(count(`reports where farm_id = ${q(farm.id)}`)).toBe(0);
    });
    it("saves nothing when the worker declines or hangs up", async () => {
      const farm = seedFarm();
      const declined = await answerToSummary(await new Call(farm.worker).start());
      await declined.press("3");
      expect(declined.text).toContain("not saved");
      const dropped = await answerToSummary(await new Call(farm.worker).start());
      await dropped.finish();
      expect(count(`reports where farm_id = ${q(farm.id)}`)).toBe(0);
    });
    it("records «ما أدري» as unknown whichever way the recogniser spells it", async () => {
      const farm = seedFarm({ custom: ["شي جديد؟"], language: "ar", workerName: "يوسف" });
      const call = await new Call(farm.worker).start();
      for (let turns = 0; turns < 15 && !call.text.includes("شي جديد"); turns++) await call.press("1");
      await call.say("ما ادري");
      for (let turns = 0; turns < 5 && !call.text.includes("أحفظه"); turns++) await call.press("1");
      await call.press("1");
      expect(sql(`select a.certainty from report_answers a join reports r on r.id = a.report_id where r.farm_id = ${q(farm.id)} and a.question_ar = 'شي جديد؟'`)).toBe("unknown");
    });
  });

  describe("task outcomes", () => {
    const task = (farm: Farm, instruction: string, scheduled = "null") =>
      sql(`insert into task_tickets (farm_id, instruction, scheduled_for) values (${q(farm.id)}, ${q(instruction)}, ${scheduled}) returning id`).split("\n")[0];
    const status = (id: string) => sql(`select status || ':' || coalesce(closed_via::text, '-') from task_tickets where id = ${q(id)}`);

    async function reportWithTask(farm: Farm, press: string) {
      const call = await new Call(farm.worker).start();
      for (let turns = 0; turns < 15 && !call.text.includes("Did you finish"); turns++) {
        if (/how many camels/i.test(call.text)) await call.say("one");
        else await call.press("1");
      }
      await call.press(press);
      await answerToSummary(call);
      await call.press("1");
      return call;
    }
    it("closes a task only when the worker says it's done", async () => {
      const farm = seedFarm();
      const id = task(farm, "Fix the gate");
      await reportWithTask(farm, "1");
      expect(status(id)).toBe("closed:worker_report");
    });
    it("keeps a task open on not yet", async () => {
      const farm = seedFarm();
      const id = task(farm, "Fix the gate");
      await reportWithTask(farm, "2");
      expect(status(id)).toBe("open:-");
    });
    it("keeps a task open on I don't know", async () => {
      const farm = seedFarm();
      const id = task(farm, "Fix the gate");
      await reportWithTask(farm, "3");
      expect(status(id)).toBe("open:-");
    });
    it("reads the task outcome back before the worker confirms", async () => {
      const farm = seedFarm();
      task(farm, "Fix the gate");
      const call = await new Call(farm.worker).start();
      for (let turns = 0; turns < 15 && !call.text.includes("Did you finish"); turns++) {
        if (/how many camels/i.test(call.text)) await call.say("one");
        else await call.press("1");
      }
      await call.say("it's not done");
      await answerToSummary(call);
      expect(call.text).toContain("Task: Fix the gate: Not yet");
    });
    it("keeps a task open when the report isn't saved", async () => {
      const farm = seedFarm();
      const id = task(farm, "Fix the gate");
      const call = await new Call(farm.worker).start();
      for (let turns = 0; turns < 15 && !call.text.includes("Did you finish"); turns++) {
        if (/how many camels/i.test(call.text)) await call.say("one");
        else await call.press("1");
      }
      await call.press("1");
      await answerToSummary(call);
      await call.press("2");
      expect(status(id)).toBe("open:-");
    });

    describe("a returned missed call", () => {
      it("persists three 20-minute instruction retries, creates one ticket and closes it on callback", async () => {
        const farm = seedFarm();
        const pending = sql(`insert into pending_worker_calls (farm_id, purpose, message, next_attempt_at)
          values (${q(farm.id)}, 'instruction', 'Move the herd', ${q(SUNDAY.toISOString())}) returning id`).split("\n")[0];
        const client = createServiceClient()!;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const now = new Date(SUNDAY.getTime() + attempt * 20 * 60_000);
          vi.setSystemTime(now);
          const event = { version: 1 as const, eventId: `${pending}:${attempt}`, providerCallId: sid(), type: "worker_call_attempt" as const, pendingCallId: pending, answered: false };
          expect((await applyVoiceEvent(client, farm.id, { party: "system" }, event, now)).status).toBe("saved");
          await applyVoiceEvent(client, farm.id, { party: "system" }, event, now);
          expect(count(`worker_call_attempts where pending_call_id = ${q(pending)}`)).toBe(attempt + 1);
          if (attempt < 2) {
            expect(sql(`select extract(epoch from next_attempt_at)::bigint from pending_worker_calls where id = ${q(pending)}`)).toBe(String((now.getTime() + 20 * 60_000) / 1000));
          }
          expect(count(`no_answer_tickets where farm_id = ${q(farm.id)}`)).toBe(0);
        }
        expect(sql(`select next_attempt_at is null from pending_worker_calls where id = ${q(pending)}`)).toBe("t");
        expect(count(`reports where farm_id = ${q(farm.id)}`)).toBe(0);
      });
      function missedCall(farm: Farm, overdue?: string) {
        const ticket = sql(`insert into no_answer_tickets (farm_id, purpose, message) values (${q(farm.id)}, 'instruction', 'Move the herd') returning id`).split("\n")[0];
        return { ticket, taskId: overdue ? task(farm, overdue, `${q("2026-11-07T06:00:00.000Z")}`) : null };
      }
      it("delivers the message, closes the ticket and is not a report", async () => {
        const farm = seedFarm();
        const { ticket } = missedCall(farm);
        const call = await new Call(farm.worker).start();
        expect(call.text).toContain("Move the herd");
        await call.press("1");
        expect(call.ended).toBe(true);
        expect(call.text).toContain("did not create a farm update");
        expect(sql(`select status from no_answer_tickets where id = ${q(ticket)}`)).toBe("closed");
        expect(count(`reports where farm_id = ${q(farm.id)}`)).toBe(0);
        expect(count(`calls where farm_id = ${q(farm.id)} and kind = 'worker_callback'`)).toBe(1);
      });
      it("survives its mid-call save, then closes an overdue task", async () => {
        const farm = seedFarm();
        const { taskId } = missedCall(farm, "Fix the gate");
        const call = await new Call(farm.worker).start();
        await call.press("1");
        expect(call.text).toContain("Fix the gate");
        await call.press("1");
        expect(status(taskId!)).toBe("closed:worker_callback");
      });
      it("leaves the ticket open if the worker hangs up before acknowledging", async () => {
        const farm = seedFarm();
        const { ticket } = missedCall(farm);
        await (await new Call(farm.worker).start()).finish();
        expect(sql(`select status from no_answer_tickets where id = ${q(ticket)}`)).toBe("open");
      });
    });
  });

  describe("NAQAH calls the worker", () => {
    beforeEach(() => {
      vi.stubEnv("NAQAH_VOICE_SECRET", "local-test-voice-secret-at-least-32-bytes");
    });
    const run = (farm: Farm) => sql(`select state || ' ' || jsonb_array_length(attempts) || ' ' || coalesce(provider_call_id, '-') from report_call_runs where farm_id = ${q(farm.id)}`);
    const schedule = (result?: (index: number) => OutboundCallResult) => {
      const recording = recordingCaller(result ? (_request, index) => result(index) : undefined);
      const pass = () => runReportCallScheduler(createServiceClient()!, recording.caller, { baseUrl: BASE, now: new Date() });
      return { ...recording, pass };
    };
    const pathOf = (url: string) => url.slice(BASE.length);
    const status = (url: string, callSid: string, CallStatus: string) => outboundStatus(hook(pathOf(url), { CallSid: callSid, CallStatus }));
    const later = (minutes: number) => vi.setSystemTime(new Date(SUNDAY.getTime() + minutes * 60_000));

    it("calls at the scheduled time, takes the report on that call, and keeps the count as a proposal", async () => {
      const farm = seedFarm({ missedReportCall: false, callTime: "09:00" });
      const scheduler = schedule();
      expect(await scheduler.pass()).toMatchObject({ placed: 1, failed: 0, errors: 0 });
      expect((await scheduler.pass()).placed).toBe(0);
      expect(scheduler.requests).toHaveLength(1);
      expect(scheduler.requests[0].to).toBe(farm.worker);
      expect(run(farm)).toBe("calling 1 -");

      const call = new Call(farm.worker);
      const answered = await outbound(hook(pathOf(scheduler.requests[0].url!), { CallSid: call.sid, CallStatus: "in-progress" }));
      call.xml = await answered.text();
      call.path = nextPath(call.xml);
      expect(call.text).toContain("calling for the farm report");
      expect(run(farm)).toBe(`answered 1 ${call.sid}`);

      await answerToSummary(call);
      expect(call.text).toContain("1 camel");
      await call.press("1");
      expect(call.text).toContain("Your update is saved");
      expect(sql(`select herd_count_reported from reports where farm_id = ${q(farm.id)}`)).toBe("1");
      expect(sql(`select herd_count is null from farms where id = ${q(farm.id)}`)).toBe("t");
      expect(run(farm)).toBe(`completed 1 ${call.sid}`);
      expect(sql(`select direction from calls where farm_id = ${q(farm.id)} and kind = 'worker_report'`)).toBe("outbound");

      expect((await status(scheduler.requests[0].statusCallback, call.sid, "completed")).status).toBe(204);
      expect(run(farm)).toBe(`completed 1 ${call.sid}`);
      expect(count(`voice_call_sessions where call_sid = ${q(call.sid)}`)).toBe(0);
    });

    it("retries twice 20 minutes apart, then marks the call missed, and the worker can call back with the report", async () => {
      const farm = seedFarm({ missedReportCall: false, callTime: "09:00" });
      const scheduler = schedule();
      const sids = [sid(), sid(), sid()];
      for (const [index, outcome] of (["no-answer", "busy", "no-answer"] as const).entries()) {
        later(index * 20);
        expect((await scheduler.pass()).placed).toBe(1);
        await status(scheduler.requests[index].statusCallback, sids[index], outcome);
        if (index < 2) {
          later(index * 20 + 19);
          expect((await scheduler.pass()).placed).toBe(0);
        }
      }
      // Each attempt's CallSid replaces the last, so the run names the latest call.
      expect(run(farm)).toBe(`missed 3 ${sids[2]}`);
      expect(count(`calls where farm_id = ${q(farm.id)} and kind = 'worker_report_missed'`)).toBe(3);
      // A repeated status callback changes nothing.
      await status(scheduler.requests[2].statusCallback, sids[2], "no-answer");
      expect(count(`calls where farm_id = ${q(farm.id)} and kind = 'worker_report_missed'`)).toBe(3);
      later(90);
      expect((await scheduler.pass()).placed).toBe(0);

      const returned = await new Call(farm.worker).start();
      expect(returned.text).toContain("report call you missed");
      await (await answerToSummary(returned)).press("1");
      expect(returned.text).toContain("Your update is saved");
      expect(count(`reports where farm_id = ${q(farm.id)}`)).toBe(1);
    });

    it("retries a scheduled call the worker hung up on mid-report", async () => {
      const farm = seedFarm({ missedReportCall: false, callTime: "09:00" });
      const scheduler = schedule();
      await scheduler.pass();
      const call = new Call(farm.worker);
      await outbound(hook(pathOf(scheduler.requests[0].url!), { CallSid: call.sid }));
      await status(scheduler.requests[0].statusCallback, call.sid, "completed");
      expect(run(farm)).toBe(`calling 1 ${call.sid}`);
      expect(count(`reports where farm_id = ${q(farm.id)}`)).toBe(0);
    });

    it("undoes a call Twilio never placed instead of logging it as unanswered", async () => {
      const farm = seedFarm({ missedReportCall: false, callTime: "09:00" });
      const scheduler = schedule(() => ({ placed: false, reason: "rejected", status: 400 }));
      expect(await scheduler.pass()).toMatchObject({ placed: 0, failed: 1 });
      expect(run(farm)).toBe("calling 0 -");
      expect(count(`calls where farm_id = ${q(farm.id)}`)).toBe(0);
    });

    it("refuses a forged token and a CallSid that belongs to another run", async () => {
      const farm = seedFarm({ missedReportCall: false, callTime: "09:00" });
      const scheduler = schedule();
      await scheduler.pass();
      const url = pathOf(scheduler.requests[0].url!);
      const forged = url.replace(/s=([A-Za-z0-9_-])/, (_m, first: string) => `s=${first === "A" ? "B" : "A"}`);
      expect((await outbound(hook(forged, { CallSid: sid() }))).status).toBe(403);
      expect((await outbound(hook(url, { CallSid: sid() }, "wrong-token"))).status).toBe(403);
      expect(run(farm)).toBe("calling 1 -");

      const other = seedFarm({ missedReportCall: false, callTime: "09:00" });
      const second = schedule();
      await second.pass();
      const callSid = sid();
      await outbound(hook(url, { CallSid: callSid }));
      const replayed = await outbound(hook(pathOf(second.requests.find((request) => request.to === other.worker)!.url!), { CallSid: callSid }));
      const replayedXml = await replayed.text();
      expect(replayedXml).toContain("<Hangup/>");
      expect(said(replayedXml)).not.toContain("farm report");
      expect(run(other)).toBe("calling 1 -");
    });
  });

  describe("failures", () => {
    const blockSaves = () => sql("revoke execute on function public.apply_farm_changes(uuid, bigint, jsonb, text, jsonb) from service_role");
    const allowSaves = () => sql("grant execute on function public.apply_farm_changes(uuid, bigint, jsonb, text, jsonb) to service_role");
    afterEach(allowSaves);

    it("never says saved when the save fails, and a retry on the same call can recover", async () => {
      const farm = seedFarm();
      const call = await answerToSummary(await new Call(farm.worker).start());
      blockSaves();
      await call.press("1");
      expect(call.text).toContain("couldn't confirm the save");
      expect(call.text).not.toMatch(/nothing|not saved/i);
      expect(call.ended).toBe(false);
      allowSaves();
      await call.press("1");
      expect(call.text).toContain("Your update is saved");
      expect(count(`reports where farm_id = ${q(farm.id)}`)).toBe(1);
    });
    it("ends honestly when the retry fails too", async () => {
      const farm = seedFarm();
      const call = await answerToSummary(await new Call(farm.worker).start());
      blockSaves();
      await call.press("1");
      await call.press("1");
      expect(call.ended).toBe(true);
      expect(call.text).toContain("couldn't confirm");
      expect(call.text).not.toContain("Your update is saved");
      expect(count(`reports where farm_id = ${q(farm.id)}`)).toBe(0);
    });
    it("saves nothing partial when a row breaks mid-transaction", async () => {
      const farm = seedFarm();
      const call = await answerToSummary(await new Call(farm.worker).start());
      sql("alter table report_answers add constraint voice_test_break check (sort_order < 0) not valid");
      try {
        await call.press("1");
      } finally {
        sql("alter table report_answers drop constraint voice_test_break");
      }
      expect(call.text).not.toContain("Your update is saved");
      expect(count(`reports where farm_id = ${q(farm.id)}`)).toBe(0);
      expect(count(`calls where farm_id = ${q(farm.id)}`)).toBe(0);
      expect(count(`voice_events where farm_id = ${q(farm.id)}`)).toBe(0);
      expect(sql(`select revision from farms where id = ${q(farm.id)}`)).toBe("0");
    });
    it("gives a clear ending to a caller who stays silent, and never confirms for them", async () => {
      const farm = seedFarm();
      const call = await answerToSummary(await new Call(farm.worker).start());
      await call.say("");
      await call.say("");
      await call.say("");
      expect(call.ended).toBe(true);
      expect(call.text).toContain("couldn't understand");
      expect(count(`reports where farm_id = ${q(farm.id)}`)).toBe(0);
    });
    it("won't tell the worker a report is unsaved if the first attempt landed after all", async () => {
      const farm = seedFarm();
      const call = await answerToSummary(await new Call(farm.worker).start());
      blockSaves();
      await call.press("1");
      allowSaves();
      // The reply was lost but the save committed.
      sql(`insert into voice_events (farm_id, event_id, outcome) values (${q(farm.id)}, ${q(`${call.sid}:report`)}, '{"status":"saved"}')`);
      await call.press("2");
      expect(call.text).toContain("Your update is saved");
    });
    it("keeps no facts in the working row once the call is finished", async () => {
      const farm = seedFarm({ custom: ["Any visitors today?"] });
      const call = await answerToSummary(await new Call(farm.worker).start());
      await call.press("1");
      const row = sql(`select session::text || last_response from voice_call_sessions where call_sid = ${q(call.sid)}`);
      expect(row).not.toContain("Nothing new to report");
    });
    it("hangs up on a turn for a call it doesn't know", async () => {
      const xml = await (await turn(hook("/api/voice/turn?n=0", { CallSid: sid(), From: phone(), Digits: "1" }))).text();
      expect(xml).toContain("<Hangup/>");
    });
    it("tells the caller when the database can't be reached", async () => {
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:9");
      const call = await new Call(phone()).start();
      expect(call.text).toContain("couldn't confirm");
      expect(call.ended).toBe(true);
    }, 16_000);
  });

  describe("farm isolation", () => {
    it("writes one farm's call to that farm only", async () => {
      const one = seedFarm();
      const two = seedFarm();
      await (await answerToSummary(await new Call(one.worker).start())).press("1");
      expect(count(`reports where farm_id = ${q(one.id)}`)).toBe(1);
      expect(count(`reports where farm_id = ${q(two.id)}`)).toBe(0);
      expect(count(`calls where farm_id = ${q(two.id)}`)).toBe(0);
      expect(sql(`select revision from farms where id = ${q(two.id)}`)).toBe("0");
    });
    it("keeps calls running at once apart", async () => {
      const one = seedFarm({ custom: ["Question for farm one?"] });
      const two = seedFarm({ custom: ["Question for farm two?"] });
      const [a, b] = await Promise.all([new Call(one.worker).start(), new Call(two.worker).start()]);
      await Promise.all([answerToSummary(a), answerToSummary(b)]);
      await Promise.all([a.press("1"), b.press("1")]);
      const questions = (farm: Farm) => sql(`select a.question_en from report_answers a join reports r on r.id = a.report_id where r.farm_id = ${q(farm.id)}`);
      expect(questions(one)).toContain("farm one");
      expect(questions(one)).not.toContain("farm two");
      expect(questions(two)).toContain("farm two");
    });
    it("lets an owner load only their own reports", async () => {
      const one = seedFarm();
      const two = seedFarm();
      await (await answerToSummary(await new Call(one.worker).start())).press("1");
      const stranger = ownerView(two);
      const { data } = await stranger.from("reports").select("id").eq("farm_id", one.id);
      expect(data).toEqual([]);
      expect(await loadFarm(stranger, { owner_id: one.ownerId })).toBeNull();
      // The check above means nothing unless the owner really can see their own rows.
      expect((await ownerView(one).from("reports").select("id").eq("farm_id", one.id)).data).toHaveLength(1);
    });
    it("hides working call state from owners and anonymous visitors", async () => {
      const farm = seedFarm();
      await new Call(farm.worker).start();
      const anon = createClient(proxyUrl, jwt({ role: "anon" }), { auth: { persistSession: false } });
      for (const client of [ownerView(farm), anon]) {
        const { data, error } = await client.from("voice_call_sessions").select("*");
        expect(data).toBeNull();
        expect(error?.code).toBe("42501");
      }
    });
    it("stops an owner from writing a report or calling the save function", async () => {
      const farm = seedFarm();
      const owner = ownerView(farm);
      const direct = await owner.from("reports").insert({ farm_id: farm.id, at: SUNDAY.toISOString() });
      expect(direct.error).not.toBeNull();
      const rpc = await owner.rpc("apply_farm_changes", { p_farm_id: farm.id, p_expected_revision: 0, p_changes: {} });
      expect(rpc.error?.code).toBe("42501");
    });
  });

  describe("owner line", () => {
    it("stays closed and reads nothing out", async () => {
      const farm = seedFarm();
      const call = await new Call(farm.owner).start();
      expect(call.ended).toBe(true);
      expect(call.text).toContain("NAQAH calls you at the time you chose");
      expect(count(`calls where farm_id = ${q(farm.id)}`)).toBe(0);
    });
  });
});
