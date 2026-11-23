// Tests that env-file preflight probes stay signed, read-only, and free of recipient values on argv.
import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { runPreflight } from "./preflight.mjs";

const TOKEN = "local-test-signature-token";
const SECRET = "local-test-bridge-secret";
const ALLOWLIST = "+966500000101,+966500000102";
const RANCH = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const digest = createHmac("sha256", TOKEN).update(JSON.stringify(ALLOWLIST.split(",").sort())).digest("hex");
const env = {
  PREVIEW_ORIGIN: "http://127.0.0.1:55587", NAQAH_TEST_RANCH_ID: RANCH,
  TWILIO_AUTH_TOKEN: TOKEN, NAQAH_VOICE_SECRET: SECRET, NAQAH_CALL_ALLOWLIST: ALLOWLIST,
  NAQAH_VOICE_MODE: "farm", NAQAH_VOICE_LOCALE: "ar", VERCEL_AUTOMATION_BYPASS_SECRET: "local-bypass",
};

describe("local no-call preflight", () => {
  it("checks unsigned, invalid, and valid signatures in sequence without number arguments", async () => {
    const calls = [];
    const fetchImpl = vi.fn(async (url, options) => {
      calls.push({ url: url.toString(), options });
      const signed = options.headers["x-twilio-signature"];
      if (!signed) return new Response(null, { status: 403 });
      const valid = signed === createHmac("sha1", TOKEN).update(`${url}Preflight1`).digest("base64");
      if (!valid) return new Response(null, { status: 403 });
      return Response.json({ preflight: true, allowlistValid: true, scheduledCalls: false, recording: false, transcription: false, allowlistDigest: digest, mode: "farm", locale: "ar" });
    });
    const report = [];
    const result = await runPreflight({ env, local: true, fetchImpl, report: (line) => report.push(line) });
    expect(calls).toHaveLength(9);
    expect(calls.map(({ options }) => options.redirect)).toEqual(Array(9).fill("manual"));
    expect(calls[0].url).toContain("/api/voice/inbound?preflight=1");
    expect(calls[1].options.headers["x-twilio-signature"]).toBeTruthy();
    expect(calls.every(({ options }) => !options.headers["x-vercel-protection-bypass"])).toBe(true);
    expect(report).toHaveLength(18);
    expect(result).toMatchObject({ failed: 0, passed: 18 });
    expect(JSON.stringify(report)).not.toContain(ALLOWLIST);
    expect(JSON.stringify(report)).not.toContain(TOKEN);
  });

  it("optionally checks the report-call-now bridge path through the loopback proxy", async () => {
    const fetchImpl = vi.fn(async (url, options) => {
      if (url.toString().includes("55586")) return new Response(null, { status: 200 });
      const signature = options.headers["x-twilio-signature"];
      if (!signature) return new Response(null, { status: 403 });
      const valid = signature === createHmac("sha1", TOKEN).update(`${url}Preflight1`).digest("base64");
      return valid ? Response.json({ preflight: true, allowlistValid: true, scheduledCalls: false, recording: false, transcription: false, allowlistDigest: digest, mode: "farm", locale: "ar" }) : new Response(null, { status: 403 });
    });
    const result = await runPreflight({ env, local: true, proxyOrigin: "http://127.0.0.1:55586", fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(10);
    expect(fetchImpl.mock.calls.at(-1)[0].pathname).toBe("/api/report-call-now");
    expect(fetchImpl.mock.calls.at(-1)[1].method).toBe("POST");
    expect(fetchImpl.mock.calls.at(-1)[1].headers["x-naqah-bridge-signature"]).toMatch(/^[0-9a-f]{64}$/);
    expect(fetchImpl.mock.calls.at(-1)[1].headers["x-vercel-protection-bypass"]).toBeUndefined();
    expect(result.failed).toBe(0);
  });

  it("sends the bypass only to a preview origin and never to ngrok", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 403 }));
    await runPreflight({ env, origin: "https://preview.example.vercel.app", fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(9);
    expect(fetchImpl.mock.calls.every(([, options]) => options.headers["x-vercel-protection-bypass"] === "local-bypass")).toBe(true);

    fetchImpl.mockClear();
    await runPreflight({ env, origin: "https://naqah.ngrok-free.app", fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(9);
    expect(fetchImpl.mock.calls.every(([, options]) => options.headers["x-vercel-protection-bypass"] === undefined)).toBe(true);
  });

  it("refuses absent scope or an external HTTP origin before sending requests", async () => {
    const fetchImpl = vi.fn();
    await expect(runPreflight({ env: { ...env, NAQAH_TEST_RANCH_ID: "" }, fetchImpl })).rejects.toThrow();
    await expect(runPreflight({ env: { ...env, NAQAH_TEST_RANCH_ID: "aaaaaaaa-aaaa-4aaa-0aaa-aaaaaaaaaaaa" }, fetchImpl })).rejects.toThrow();
    await expect(runPreflight({ env, origin: "http://preview.example.test", local: true, fetchImpl })).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
