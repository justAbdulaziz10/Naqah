#!/usr/bin/env node
// LOCAL OPERATOR TOOLING. Runs signed, no-call voice probes from env files without phone data on argv.
import { createHmac } from "node:crypto";
import { pathToFileURL } from "node:url";
import { readEnvFile } from "./env-file.mjs";
import { internalHeaders } from "../../services/voice-bridge/security.mjs";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
const ROUTES = ["/api/voice/inbound", "/api/voice/outbound", "/api/voice/turn"];
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function originFrom(raw, local) {
  let url;
  try { url = new URL(raw); } catch { throw new Error("invalid_origin"); }
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash ||
      (url.protocol !== "https:" && !(local && url.protocol === "http:" && LOOPBACK.has(url.hostname)))) throw new Error("invalid_origin");
  return url;
}

function twilioSignature(url, body, token) {
  const form = new URLSearchParams(body);
  const suffix = [...form.keys()].sort().map((key) => key + form.get(key)).join("");
  return createHmac("sha1", token).update(url + suffix, "utf8").digest("base64");
}

function validAllowlist(raw) {
  const values = raw.split(",").map((item) => item.trim());
  return values.length > 0 && values.every((item) => /^\+9665\d{8}$/.test(item)) && new Set(values).size === values.length;
}

function isNgrokHost(hostname) {
  return /(^|\.)ngrok(?:-free)?\.(?:app|io|dev|com)$/i.test(hostname);
}

function protectionHeaders(url, secret) {
  if (!secret || LOOPBACK.has(url.hostname) || isNgrokHost(url.hostname)) return {};
  return { "x-vercel-protection-bypass": secret };
}

export async function runPreflight({ env, origin, proxyOrigin, local = false, fetchImpl = fetch, report = () => {} }) {
  const expected = (env.NAQAH_CALL_ALLOWLIST ?? "").split(",").map((item) => item.trim()).sort();
  const authToken = env.TWILIO_AUTH_TOKEN?.trim() ?? "";
  const bridgeSecret = env.NAQAH_VOICE_SECRET?.trim() ?? "";
  const ranchId = env.NAQAH_TEST_RANCH_ID ?? "";
  if (!validAllowlist(env.NAQAH_CALL_ALLOWLIST ?? "") || !authToken || !bridgeSecret || !ID.test(ranchId) ||
      env.NAQAH_VOICE_MODE !== "farm" || !["ar", "en"].includes(env.NAQAH_VOICE_LOCALE ?? "")) throw new Error("preflight_configuration_invalid");
  const target = originFrom(origin ?? env.PREVIEW_ORIGIN ?? "", local);
  const access = env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();
  const baseHeaders = protectionHeaders(target, access);
  const checks = [];
  const check = (name, ok) => { checks.push({ name, ok: Boolean(ok) }); report(`${ok ? "PASS" : "FAIL"} ${name}`); };

  for (const path of ROUTES) {
    const url = new URL(`${path}?preflight=1`, target);
    const body = new URLSearchParams({ Preflight: "1" }).toString();
    const headers = { ...baseHeaders, "content-type": "application/x-www-form-urlencoded" };
    const request = (signature) => fetchImpl(url, {
      method: "POST", headers: signature ? { ...headers, "x-twilio-signature": signature } : headers,
      body, redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(10_000),
    });
    const unsigned = await request(null);
    check(`${path}: unsigned refused`, unsigned.status === 403);
    await unsigned.body?.cancel();
    const wrong = createHmac("sha1", `${authToken}:invalid`).update(`${url}Preflight1`).digest("base64");
    const forged = await request(wrong);
    check(`${path}: invalid signature refused`, forged.status === 403);
    await forged.body?.cancel();
    const signed = await request(twilioSignature(url.toString(), body, authToken));
    let payload = null;
    if (signed.status === 200 && signed.headers.get("content-type")?.includes("application/json")) payload = await signed.json();
    else await signed.body?.cancel();
    check(`${path}: signed read-only probe`, payload?.preflight === true);
    check(`${path}: allowlist and call gates`, payload?.allowlistValid === true && payload?.scheduledCalls === false && payload?.recording === false && payload?.transcription === false);
    const digest = createHmac("sha256", authToken).update(JSON.stringify(expected)).digest("hex");
    check(`${path}: allowlist digest`, payload?.allowlistDigest === digest);
    check(`${path}: farm voice mode and locale`, payload?.mode === env.NAQAH_VOICE_MODE && payload?.locale === env.NAQAH_VOICE_LOCALE);
  }

  if (proxyOrigin) {
    const proxy = originFrom(proxyOrigin, true);
    if (!LOOPBACK.has(proxy.hostname)) throw new Error("proxy_must_be_loopback");
    const body = JSON.stringify({ farmId: ranchId });
    const response = await fetchImpl(new URL("/api/report-call-now", proxy), {
      method: "POST", headers: { ...protectionHeaders(proxy, access), "content-type": "application/json", ...internalHeaders(body, bridgeSecret) },
      body, redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(10_000),
    });
    check("bridge proxy preflight route is reachable without placing a call", response.status === 200);
    await response.body?.cancel();
  }

  return { passed: checks.filter((entry) => entry.ok).length, failed: checks.filter((entry) => !entry.ok).length, checks };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    const envPath = args.find((arg) => !arg.startsWith("--"));
    const option = (name) => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
    if (!envPath) throw new Error("arguments_missing");
    const env = readEnvFile(envPath);
    const result = await runPreflight({ env, origin: option("--origin"), proxyOrigin: option("--proxy-origin"), local: args.includes("--local"), report: (line) => process.stdout.write(`${line}\n`) });
    if (result.failed) process.exitCode = 1;
  } catch {
    process.stderr.write("preflight refused or failed; no call was placed\n");
    process.exitCode = 2;
  }
}
