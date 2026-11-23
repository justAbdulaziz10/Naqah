#!/usr/bin/env node
// LOCAL OPERATOR TOOLING. Loopback-only proxy that adds Vercel protection at the header boundary.
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import { pathToFileURL } from "node:url";
import { envFromArgs } from "./env-file.mjs";

const HOP_HEADERS = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"]);
const STRIP_HEADERS = /^(?:forwarded|x-forwarded.*|x-real-ip|x-client-ip|x-original-forwarded-for|x-vercel-protection-bypass|x-vercel-set-bypass-cookie)$/i;
const VOICE_PATHS = new Set([
  "/api/voice/inbound", "/api/voice/outbound", "/api/voice/outbound/status", "/api/voice/owner",
  "/api/voice/owner/heard", "/api/voice/owner/status", "/api/voice/worker", "/api/voice/worker/status",
  "/api/voice/status", "/api/voice/turn", "/api/voice/realtime/session", "/api/voice/realtime/tool",
  "/api/voice/realtime/after", "/api/voice/realtime/closed",
]);

export function parseOrigin(raw, { local = false } = {}) {
  let origin;
  try { origin = new URL(raw); } catch { throw new Error("Invalid preview origin"); }
  const loopback = origin.hostname === "localhost" || origin.hostname === "[::1]" || /^127(?:\.\d{1,3}){3}$/.test(origin.hostname);
  if (!(["https:", "http:"].includes(origin.protocol)) || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash ||
      (origin.protocol === "http:" && !(local && loopback))) throw new Error("Preview origin must be HTTPS (or local loopback HTTP)");
  return origin;
}

export function normalizedAllowedPath(method, rawUrl) {
  let parsed;
  try { parsed = new URL(rawUrl, "http://loopback.invalid"); } catch { return null; }
  if (parsed.origin !== "http://loopback.invalid" || parsed.pathname.includes("\\") || method !== "POST") return null;
  if (!VOICE_PATHS.has(parsed.pathname) && parsed.pathname !== "/api/report-call-now") return null;
  return `${parsed.pathname}${parsed.search}`;
}

export function isAllowedRequest(method, rawUrl) {
  return normalizedAllowedPath(method, rawUrl) !== null;
}

export function upstreamOptions(origin, request, bypassSecret, normalizedPath = request.url) {
  const headers = {};
  for (const [name, value] of Object.entries(request.headers)) {
    const lower = name.toLowerCase();
    if (lower === "host" || HOP_HEADERS.has(lower) || STRIP_HEADERS.test(lower) || value === undefined) continue;
    headers[lower] = value;
  }
  headers.host = origin.host;
  headers["x-vercel-protection-bypass"] = bypassSecret;
  return {
    protocol: origin.protocol,
    hostname: origin.hostname,
    port: origin.port || undefined,
    servername: origin.protocol === "https:" && !isIP(origin.hostname) ? origin.hostname : undefined,
    method: request.method,
    path: normalizedPath,
    headers,
  };
}

function safeResponseHeaders(headers) {
  const result = {};
  for (const [name, value] of Object.entries(headers)) {
    if (!HOP_HEADERS.has(name.toLowerCase()) && value !== undefined) result[name] = value;
  }
  return result;
}

export function createBridgeProxy({ previewOrigin, bypassSecret, port = 55555, upstreamTimeoutMs = 15_000, logger = (line) => process.stdout.write(`${line}\n`), requestFactory } = {}) {
  const origin = previewOrigin instanceof URL ? previewOrigin : parseOrigin(previewOrigin, { local: true });
  if (!bypassSecret) throw new Error("Protection bypass secret is required");
  if (!Number.isInteger(port) || port < 55500 || port > 55599) throw new Error("Proxy port must be in 55500–55599");
  const requestFor = requestFactory ?? ((target, options, callback) =>
    (target.protocol === "https:" ? https : http).request({ ...options }, callback));

  const server = http.createServer((incoming, outgoing) => {
    const start = performance.now();
    let path = "/";
    try { path = new URL(incoming.url ?? "/", "http://loopback.invalid").pathname; } catch { /* logged as the safe fallback */ }
    let logged = false;
    const finishLog = (status) => {
      if (logged) return;
      logged = true;
      logger(`${incoming.method ?? "UNKNOWN"} ${path} ${status} ${Math.max(0, Math.round(performance.now() - start))}ms`);
    };
    const forwardedPath = normalizedAllowedPath(incoming.method ?? "", incoming.url ?? "");
    if (forwardedPath === null) {
      incoming.resume();
      outgoing.writeHead(404, { "content-length": "0", "cache-control": "no-store" }).end();
      finishLog(404);
      return;
    }

    const upstream = requestFor(origin, upstreamOptions(origin, incoming, bypassSecret, forwardedPath), (response) => {
      outgoing.writeHead(response.statusCode ?? 502, safeResponseHeaders(response.headers));
      response.pipe(outgoing);
      response.once("end", () => finishLog(response.statusCode ?? 502));
      response.once("error", () => {
        if (outgoing.headersSent) outgoing.destroy();
        else outgoing.writeHead(502, { "content-length": "0", "cache-control": "no-store" }).end();
        finishLog(502);
      });
    });
    upstream.once("error", () => {
      if (!outgoing.destroyed) {
        if (!outgoing.headersSent) outgoing.writeHead(502, { "content-length": "0", "cache-control": "no-store" });
        outgoing.end();
      }
      finishLog(502);
    });
    upstream.setTimeout(upstreamTimeoutMs, () => upstream.destroy(new Error("upstream_timeout")));
    incoming.once("error", () => upstream.destroy());
    outgoing.once("close", () => { if (!outgoing.writableFinished) upstream.destroy(); });
    outgoing.once("error", () => { upstream.destroy(); finishLog(502); });
    incoming.pipe(upstream);
  });
  server.listen(port, "127.0.0.1");
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const env = envFromArgs(process.argv.slice(2));
    const origin = parseOrigin(env.PREVIEW_ORIGIN ?? "", { local: true });
    const port = Number(env.PORT || "55555");
    if (!Number.isInteger(port) || port < 55500 || port > 55599) throw new Error("Invalid loopback port");
    const server = createBridgeProxy({ previewOrigin: origin, bypassSecret: env.VERCEL_AUTOMATION_BYPASS_SECRET, port });
    server.once("listening", () => process.stdout.write(`Bridge proxy listening on 127.0.0.1:${port}\n`));
    for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close(() => process.exit(0)));
  } catch {
    process.stderr.write("bridge-proxy configuration invalid\n");
    process.exitCode = 2;
  }
}
