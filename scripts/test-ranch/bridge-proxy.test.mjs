// Tests for the proxy's route boundary, upstream identity, body/signature preservation, and log redaction.
import http from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createBridgeProxy, isAllowedRequest, normalizedAllowedPath, parseOrigin, upstreamOptions } from "./bridge-proxy.mjs";
import { reserveLoopbackPorts } from "./ports.mjs";

const ports = await reserveLoopbackPorts(4);
const [UPSTREAM_PORT, PROXY_PORT, ERROR_PROXY_PORT, DEAD_UPSTREAM_PORT] = ports.ports;
await ports.close();
const requests = [];
const lines = [];
let upstream;
let proxy;
let errorProxy;

beforeAll(async () => {
  upstream = http.createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      requests.push({ method: request.method, url: request.url, headers: request.headers, body: Buffer.concat(chunks).toString("utf8") });
        if (request.url?.startsWith("/api/voice/outbound?hang=1")) return;
        if (request.url?.startsWith("/api/voice/outbound?redirect=1")) {
          response.writeHead(302, { location: "https://outside.invalid/never-follow" }).end("redirect");
        } else response.writeHead(200, { "content-type": "text/plain" }).end("ok");
    });
  });
  await new Promise((resolve) => upstream.listen(UPSTREAM_PORT, "127.0.0.1", resolve));
  proxy = createBridgeProxy({
    previewOrigin: `http://127.0.0.1:${UPSTREAM_PORT}`, bypassSecret: "local-only-bypass",
    port: PROXY_PORT, upstreamTimeoutMs: 100, logger: (line) => lines.push(line),
  });
  await new Promise((resolve) => proxy.once("listening", resolve));
  errorProxy = createBridgeProxy({
    previewOrigin: `http://127.0.0.1:${DEAD_UPSTREAM_PORT}`, bypassSecret: "local-only-bypass",
    port: ERROR_PROXY_PORT, logger: (line) => lines.push(line),
  });
  await new Promise((resolve) => errorProxy.once("listening", resolve));
});

afterAll(async () => {
  await Promise.all([proxy, errorProxy, upstream].map((server) => server ? new Promise((resolve) => server.close(resolve)) : Promise.resolve()));
});

describe("bridge proxy", () => {
  it("only allows POST voice routes and the POST report-call preflight", () => {
    expect(isAllowedRequest("POST", "/api/voice/outbound/status?s=opaque-token")).toBe(true);
    expect(isAllowedRequest("POST", "/api/voice/realtime/tool?x=1")).toBe(true);
    expect(isAllowedRequest("POST", "/api/report-call-now")).toBe(true);
    expect(isAllowedRequest("GET", "/api/voice/inbound")).toBe(false);
    expect(isAllowedRequest("GET", "/api/cron/report-calls")).toBe(false);
    expect(isAllowedRequest("POST", "/api/report-call-now/extra")).toBe(false);
    expect(isAllowedRequest("POST", "/api/voice/../cron/report-calls")).toBe(false);
    expect(isAllowedRequest("POST", "/api/voice/unlisted/number-12345678")).toBe(false);
    expect(normalizedAllowedPath("POST", "/api/voice/./outbound?s=opaque")).toBe("/api/voice/outbound?s=opaque");
  });

  it("pins Host and TLS SNI to the preview origin", () => {
    const target = parseOrigin("https://preview.example.test");
    const options = upstreamOptions(target, { method: "POST", url: "/api/voice/outbound?s=opaque", headers: { host: "attacker.invalid", "x-forwarded-host": "attacker.invalid", "x-twilio-signature": "signed" } }, "bypass");
    expect(options.hostname).toBe("preview.example.test");
    expect(options.servername).toBe("preview.example.test");
    expect(options.headers.host).toBe("preview.example.test");
    expect(options.headers["x-vercel-protection-bypass"]).toBe("bypass");
    expect(options.headers["x-forwarded-host"]).toBeUndefined();
    expect(options.headers["x-twilio-signature"]).toBe("signed");
    expect(options.path).toBe("/api/voice/outbound?s=opaque");
  });

  it("preserves method/path/query/body/signature while replacing bypass and forwarding headers", async () => {
    requests.length = 0;
    const signature = "twilio-signature-local";
    const body = "CallSid=CA00000000000000000000000000000001&SpeechResult=hello";
    const response = await fetch(`http://127.0.0.1:${PROXY_PORT}/api/voice/outbound/status?s=opaque-token`, {
      method: "POST", body, redirect: "manual",
      headers: {
        "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": signature,
        "x-vercel-protection-bypass": "attacker-value", "x-forwarded-host": "attacker.invalid",
        "x-forwarded-proto": "http", forwarded: "for=192.0.2.1", "x-real-ip": "192.0.2.1",
      },
    });
    expect(response.status).toBe(200);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ method: "POST", url: "/api/voice/outbound/status?s=opaque-token", body });
    expect(requests[0].headers.host).toBe(`127.0.0.1:${UPSTREAM_PORT}`);
    expect(requests[0].headers["x-twilio-signature"]).toBe(signature);
    expect(requests[0].headers["x-vercel-protection-bypass"]).toBe("local-only-bypass");
    for (const name of ["x-forwarded-host", "x-forwarded-proto", "forwarded", "x-real-ip"]) expect(requests[0].headers[name]).toBeUndefined();
    expect(lines.at(-1)).toMatch(/^POST \/api\/voice\/outbound\/status 200 \d+ms$/);
    expect(lines.at(-1)).not.toContain("opaque-token");
    expect(lines.at(-1)).not.toContain(body);
    expect(lines.at(-1)).not.toContain("local-only-bypass");
  });

  it("forwards the normalized path it allowed", async () => {
    requests.length = 0;
    await new Promise((resolve, reject) => {
      const request = http.request({ hostname: "127.0.0.1", port: PROXY_PORT, method: "POST", path: "/api/voice/./outbound?normalized=1" }, (response) => {
        response.resume();
        response.once("end", resolve);
      });
      request.once("error", reject);
      request.end("body");
    });
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe("/api/voice/outbound?normalized=1");
  });

  it("returns 404 for non-allowlisted routes and does not follow upstream redirects", async () => {
    requests.length = 0;
    const denied = await fetch(`http://127.0.0.1:${PROXY_PORT}/api/cron/report-calls`, { method: "POST" });
    expect(denied.status).toBe(404);
    expect(requests).toHaveLength(0);
    const response = await fetch(`http://127.0.0.1:${PROXY_PORT}/api/voice/outbound?redirect=1`, { method: "POST", redirect: "manual" });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://outside.invalid/never-follow");
    expect(requests).toHaveLength(1);
  });

  it("refuses non-loopback HTTP origins", () => {
    expect(() => parseOrigin("http://preview.example.test", { local: true })).toThrow();
    expect(() => parseOrigin("https://preview.example.test/path")).toThrow();
    expect(() => createBridgeProxy({ previewOrigin: "https://preview.example.test", bypassSecret: "local", port: 3399 })).toThrow(/55500–55599/);
  });

  it("returns 502 on an upstream timeout or connection error", async () => {
    const timeout = await fetch(`http://127.0.0.1:${PROXY_PORT}/api/voice/outbound?hang=1`, { method: "POST", body: "wait" });
    expect(timeout.status).toBe(502);
    await timeout.body?.cancel();
    const unavailable = await fetch(`http://127.0.0.1:${ERROR_PROXY_PORT}/api/voice/outbound`, { method: "POST" });
    expect(unavailable.status).toBe(502);
    await unavailable.body?.cancel();
    expect(lines.slice(-2).every((line) => line.endsWith(" 502 ") || / 502 \d+ms$/.test(line))).toBe(true);
  });
});
