import { execFile, execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { createServer, type Server } from "node:http";
import { promisify } from "node:util";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const run = promisify(execFile);
const token = "local-only-preflight-test-token";
const recipients = ["+15555550101", "+15555550102"];
const base = "http://127.0.0.1:3498";
const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const digest = createHmac("sha256", token).update(JSON.stringify(recipients)).digest("hex");
let server: Server;
let buildCommit: string;
let probe: Record<string, unknown>;
let requests: string[];

async function preflight(overrides: Record<string, string | undefined> = {}) {
  try {
    const result = await run(process.execPath, ["scripts/preflight-call.mjs", "--base", base, "--expect", recipients.join(","), "--locale", "ar"], {
      env: {
        ...process.env, TWILIO_AUTH_TOKEN: token, NAQAH_PUBLIC_BASE_URL: base,
        NAQAH_CALL_ALLOWLIST: recipients.join(","), NAQAH_SCHEDULED_CALLS: "0",
        NAQAH_VOICE_MODE: "farm", NAQAH_VOICE_LOCALE: "ar", ...overrides,
      },
    });
    return { code: 0, stdout: result.stdout };
  } catch (error) {
    const result = error as { code: number; stdout: string };
    return { code: result.code, stdout: result.stdout };
  }
}

describe("read-only preflight CLI", () => {
  beforeAll(async () => {
    server = createServer(async (request, response) => {
      requests.push(request.url!);
      response.setHeader("Content-Type", "application/json");
      if (request.url === "/api/integrations/status") {
        response.end(JSON.stringify({ version: { commit: buildCommit }, voice: { mode: "farm", configured: true, signatureValidation: true } }));
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = new URLSearchParams(Buffer.concat(chunks).toString());
      const signature = createHmac("sha1", token).update(`${base}${request.url}Preflight${body.get("Preflight")}`).digest("base64");
      if (request.headers["x-twilio-signature"] !== signature) {
        response.writeHead(403).end("{}");
        return;
      }
      response.end(JSON.stringify(probe));
    });
    await new Promise<void>((resolve) => server.listen(3498, "127.0.0.1", resolve));
  });
  afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });
  beforeEach(() => {
    buildCommit = commit;
    requests = [];
    probe = { preflight: true, mode: "farm", locale: "ar", scheduledCalls: false, recording: false, transcription: false, allowlistValid: true, allowlistDigest: digest };
  });
  it("checks only inert app probes and prints no token or phone numbers", async () => {
    const result = await preflight();
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("READY for owner review only");
    expect(result.stdout).not.toContain(token);
    for (const recipient of recipients) expect(result.stdout).not.toContain(recipient);
    expect(requests).toEqual([
      "/api/integrations/status",
      ...["inbound", "outbound", "turn"].flatMap((route) => Array(3).fill(`/api/voice/${route}?preflight=1`)),
    ]);
  });
  it("fails a stale build", async () => {
    buildCommit = "stale";
    expect((await preflight()).code).toBe(1);
  });
  it.each(["scheduledCalls", "recording", "transcription"])("fails server %s being on", async (setting) => {
    probe[setting] = true;
    expect((await preflight()).code).toBe(1);
  });
  it.each([{ locale: "en" }, { mode: "sample" }, { allowlistDigest: "different" }, { allowlistValid: false }])("fails an unsafe server configuration %j", async (settings) => {
    Object.assign(probe, settings);
    expect((await preflight()).code).toBe(1);
  });
  it.each([
    { NAQAH_CALL_ALLOWLIST: "" }, { NAQAH_CALL_ALLOWLIST: `${recipients.join(",")},+15555550103` },
    { NAQAH_CALL_ALLOWLIST: `${recipients.join(",")},invalid` }, { NAQAH_SCHEDULED_CALLS: "1" },
    { NAQAH_VOICE_MODE: "sample" }, { NAQAH_PUBLIC_BASE_URL: "https://wrong.test" }, { TWILIO_AUTH_TOKEN: "" },
  ])("fails local misconfiguration without sending a request %j", async (settings) => {
    expect((await preflight(settings)).code).toBe(1);
    expect(requests).toHaveLength(0);
  });
});
