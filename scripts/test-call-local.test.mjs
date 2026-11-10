import { createServer } from "node:net";
import { describe, expect, it } from "vitest";
import {
  buildEnvironments, cleanBaseEnv, describeEnvironment, FORBIDDEN_LIVE, parseArgs, parseSecrets, portHolder, UsageError, validatePublicUrl,
} from "./test-call-local.mjs";

const SID = `AC${"a1".repeat(16)}`;
const secretsText = [
  "# comment", `TWILIO_ACCOUNT_SID=${SID}`, 'TWILIO_AUTH_TOKEN="real-token-value"', "export TWILIO_PHONE_NUMBER=+966110000000",
  "OPENAI_API_KEY='sk-real-value' # note", "NAQAH_VOICE_SECRET=voice-secret-value",
  "NEXT_PUBLIC_SUPABASE_URL=https://ydsgmzxqjimwbamnksxe.supabase.co", "SUPABASE_SECRET_KEY=hosted-secret", "CRON_SECRET=cron-value",
].join("\n");
const stack = { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54352", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "anon", SUPABASE_SECRET_KEY: "service" };
const liveArgs = ["--live", "--secrets", "/tmp/s", "--public-url", "https://tunnel.example.com", "--allow", "+966512345678"];

describe("test-call runner arguments", () => {
  it("defaults to mock and refuses live-only options there", () => {
    expect(parseArgs([]).mode).toBe("mock");
    expect(() => parseArgs(["--secrets", "/tmp/s"])).toThrow(/--live only/);
    expect(() => parseArgs(["--allow", "+966512345678"])).toThrow(/--live only/);
    expect(() => parseArgs(["--mock", "--live"])).toThrow(/either/);
    expect(() => parseArgs(["--nope"])).toThrow(UsageError);
  });

  it("requires secrets, a public URL and an allowed number for live", () => {
    expect(() => parseArgs(["--live", "--public-url", "https://a.example", "--allow", "+966512345678"])).toThrow(/--secrets/);
    expect(() => parseArgs(["--live", "--secrets", "/tmp/s", "--allow", "+966512345678"])).toThrow(/--public-url/);
    expect(() => parseArgs(["--live", "--secrets", "/tmp/s", "--public-url", "https://a.example"])).toThrow(/--allow/);
    expect(parseArgs(liveArgs)).toMatchObject({ mode: "live", publicUrl: "https://tunnel.example.com", allow: ["+966512345678"], bridgePort: 3300 });
  });

  it("accepts exact Saudi mobiles only", () => {
    for (const bad of ["+15555550101", "0512345678", "+96651234567", "+9665123456789", "+966412345678", "966512345678"]) {
      expect(() => parseArgs([...liveArgs.slice(0, 5), "--allow", bad])).toThrow(/Saudi/);
    }
    expect(parseArgs([...liveArgs, "--allow", "+966598765432,+966512345678"]).allow).toEqual(["+966512345678", "+966598765432"]);
  });

  it("only takes an https public origin Twilio can reach", () => {
    for (const bad of ["http://a.example", "https://a.example/x", "https://u:p@a.example", "https://a.example?x=1", "https://127.0.0.1", "https://localhost:3300", "nonsense"]) {
      expect(() => validatePublicUrl(bad)).toThrow(UsageError);
    }
    expect(validatePublicUrl("https://a.example/")).toBe("https://a.example");
  });

  it("validates --bridge-port and keeps it off the Next port", () => {
    expect(() => parseArgs([...liveArgs, "--bridge-port", "abc"])).toThrow(/port number/);
    expect(() => parseArgs([...liveArgs, "--bridge-port", "3301"])).toThrow(/Next/);
    expect(parseArgs([...liveArgs, "--bridge-port", "4400"]).bridgePort).toBe(4400);
  });
});

describe("test-call secrets file", () => {
  it("keeps only the five named variables", () => {
    const parsed = parseSecrets(secretsText);
    expect(Object.keys(parsed).sort()).toEqual(["NAQAH_VOICE_SECRET", "OPENAI_API_KEY", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_PHONE_NUMBER"]);
    expect(parsed.TWILIO_AUTH_TOKEN).toBe("real-token-value");
    expect(parsed.OPENAI_API_KEY).toBe("sk-real-value");
  });

  it("names a missing variable without quoting any value", () => {
    const text = secretsText.replace("voice-secret-value", "");
    expect(() => parseSecrets(text)).toThrow(/NAQAH_VOICE_SECRET/);
    try { parseSecrets(text); } catch (error) { expect(error.message).not.toMatch(/real-token-value|sk-real-value/); }
  });

  it("refuses the fake credentials and malformed Twilio values", () => {
    expect(() => parseSecrets(secretsText.replace(SID, `AC${"0".repeat(32)}`))).toThrow(/fake/);
    expect(() => parseSecrets(secretsText.replace("real-token-value", "local-test-auth-token"))).toThrow(/fake/);
    expect(() => parseSecrets(secretsText.replace(SID, "not-a-sid"))).toThrow(/TWILIO_ACCOUNT_SID/);
    expect(() => parseSecrets(secretsText.replace("+966110000000", "0110000000"))).toThrow(/TWILIO_PHONE_NUMBER/);
  });
});

describe("test-call environments", () => {
  const live = () => buildEnvironments(parseArgs(liveArgs), stack, parseSecrets(secretsText));
  const mock = (args = []) => buildEnvironments(parseArgs(args), stack);

  it("keeps transcript tracing off unless it is asked for", () => {
    expect(mock().next).not.toHaveProperty("NAQAH_CALL_TRACE_DIR");
    expect(mock().bridge).not.toHaveProperty("NAQAH_CALL_TRACE_DIR");
    expect(mock(["--trace-transcripts"]).next.NAQAH_CALL_TRACE_DIR).toMatch(/naqah-call-transcripts$/);
  });

  it("never enables scheduled, manual or owner calls in live mode", () => {
    const { next, bridge, build } = live();
    for (const name of FORBIDDEN_LIVE) {
      expect(next).not.toHaveProperty(name);
      expect(bridge).not.toHaveProperty(name);
      expect(build).not.toHaveProperty(name);
    }
  });

  it("sends live traffic to the real providers, with the database still local", () => {
    const { next, bridge, ports } = live();
    expect(ports).toEqual({ next: 3301, bridge: 3300 });
    expect(next.NEXT_PUBLIC_SUPABASE_URL).toBe("http://127.0.0.1:54352");
    expect(next.NAQAH_PUBLIC_BASE_URL).toBe("https://tunnel.example.com");
    expect(next.NAQAH_BRIDGE_PUBLIC_URL).toBe("wss://tunnel.example.com/voice-bridge/media");
    expect(bridge.NAQAH_BRIDGE_PUBLIC_URL).toBe("wss://tunnel.example.com/voice-bridge/media");
    expect(bridge.NAQAH_BRIDGE_UPSTREAM).toBe("http://127.0.0.1:3301");
    expect(next.NAQAH_CALL_ALLOWLIST).toBe("+966512345678");
    for (const env of [next, bridge]) {
      expect(env).not.toHaveProperty("NODE_OPTIONS");
      expect(env).not.toHaveProperty("NAQAH_TEST_OUTBOUND_GATEWAY");
      expect(env).not.toHaveProperty("NAQAH_REALTIME_URL");
    }
    expect(next).not.toHaveProperty("OPENAI_API_KEY");
    expect(bridge.OPENAI_API_KEY).toBe("sk-real-value");
    expect(bridge).not.toHaveProperty("TWILIO_ACCOUNT_SID");
  });

  it("refuses a Supabase URL that isn't loopback", () => {
    const hosted = { ...stack, NEXT_PUBLIC_SUPABASE_URL: "https://ydsgmzxqjimwbamnksxe.supabase.co" };
    expect(() => buildEnvironments(parseArgs([]), hosted)).toThrow(/non-loopback/);
    expect(() => buildEnvironments(parseArgs(liveArgs), hosted, parseSecrets(secretsText))).toThrow(/non-loopback/);
  });

  it("keeps mock calls on loopback with fake credentials", () => {
    const { next, bridge, ports } = mock();
    expect(ports).toEqual({ next: 3311, bridge: 3310 });
    expect(next.TWILIO_ACCOUNT_SID).toBe(`AC${"0".repeat(32)}`);
    expect(next.TWILIO_AUTH_TOKEN).toBe("local-test-auth-token");
    expect(next.NODE_OPTIONS).toContain("mock-outbound.mjs");
    expect(next.NAQAH_TEST_OUTBOUND_GATEWAY).toBe("http://127.0.0.1:3313/");
    expect(bridge.NODE_OPTIONS).toContain("loopback-guard.mjs");
    expect(bridge.NAQAH_REALTIME_URL).toBe("ws://127.0.0.1:3313/v1/realtime");
    for (const name of FORBIDDEN_LIVE) expect(next).not.toHaveProperty(name);
  });

  it("enables «اتصال حقيقي» in live mode only with --dashboard-call, for exactly one number", () => {
    expect(live().next).not.toHaveProperty("NAQAH_MANUAL_REPORT_CALLS");
    const { next } = buildEnvironments(parseArgs([...liveArgs, "--dashboard-call"]), stack, parseSecrets(secretsText));
    expect(next.NAQAH_MANUAL_REPORT_CALLS).toBe("1");
    for (const name of ["CRON_SECRET", "NAQAH_SCHEDULED_CALLS", "NAQAH_CALL_OWNER"]) expect(next).not.toHaveProperty(name);
    expect(next.NAQAH_CALL_ALLOWLIST).toBe("+966512345678");
    expect(() => parseArgs([...liveArgs, "--allow", "+966512345679", "--dashboard-call"])).toThrow(/exactly one/);
    expect(() => parseArgs(["--dashboard-call"])).toThrow(/live only/);
  });

  it("enables the manual report path only when the verifier asks, and never in live", () => {
    expect(mock(["--report-path"]).next.NAQAH_MANUAL_REPORT_CALLS).toBe("1");
    expect(() => parseArgs([...liveArgs, "--report-path"])).toThrow(/mock only/);
  });

  it("builds in account mode with the test-call UI on and no secrets in the build", () => {
    const { build } = live();
    expect(build.NEXT_PUBLIC_NAQAH_ACCOUNT_DATA).toBe("1");
    expect(build.NEXT_PUBLIC_NAQAH_TEST_CALL).toBe("1");
    for (const name of ["TWILIO_AUTH_TOKEN", "OPENAI_API_KEY", "NAQAH_VOICE_SECRET", "TWILIO_ACCOUNT_SID", "SUPABASE_SECRET_KEY"]) expect(build).not.toHaveProperty(name);
  });

  it("drops inherited provider and Supabase settings", () => {
    const clean = cleanBaseEnv({ PATH: "/bin", HOME: "/h", TWILIO_AUTH_TOKEN: "x", CRON_SECRET: "x", NAQAH_SCHEDULED_CALLS: "1", SUPABASE_SECRET_KEY: "x", NEXT_PUBLIC_SUPABASE_URL: "https://x", OPENAI_API_KEY: "x", NODE_OPTIONS: "--x" });
    expect(clean).toEqual({ PATH: "/bin", HOME: "/h" });
  });

  it("never prints a secret in the dry-run description", () => {
    const { next, bridge } = live();
    const printed = `${describeEnvironment("next", next)}\n${describeEnvironment("bridge", bridge)}`;
    for (const value of ["real-token-value", "sk-real-value", "voice-secret-value", SID]) expect(printed).not.toContain(value);
    expect(printed).toContain("TWILIO_AUTH_TOKEN=<set, hidden>");
    expect(printed).toContain("NAQAH_CALL_ALLOWLIST=+966512345678");
  });
});

describe("port check", () => {
  it("names the process holding a port, and reports a free port as free", async () => {
    const server = createServer();
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();
    expect(portHolder(port)).toMatch(new RegExp(`\\(pid ${process.pid}\\)`));
    await new Promise((resolve) => server.close(resolve));
    expect(portHolder(port)).toBeNull();
  });
});
