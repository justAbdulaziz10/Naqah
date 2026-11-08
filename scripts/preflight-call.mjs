#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const option = (name) => {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? "" : process.argv[index + 1] ?? "";
};
let failures = 0;
const check = (name, passed) => {
  console.log(`${passed ? "PASS" : "FAIL"} ${name}`);
  if (!passed) failures += 1;
};
const env = (name) => process.env[name]?.trim() ?? "";
const numbers = (raw) => raw.split(",").map((item) => item.trim()).sort();
const validNumbers = (items) => items.length > 0 && items.every((item) => /^\+[1-9]\d{7,14}$/.test(item)) && new Set(items).size === items.length;
const request = (url, init) => fetch(url, { ...init, redirect: "manual", signal: AbortSignal.timeout(10_000) });

try {
  const base = new URL(option("base"));
  const expected = numbers(option("expect"));
  const locale = option("locale");
  if (base.username || base.password || base.search || base.hash || base.pathname !== "/" ||
    !(base.protocol === "https:" || (base.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname))) ||
    !validNumbers(expected) || !["ar", "en"].includes(locale)) {
    throw new Error("usage");
  }
  const configured = new URL(env("NAQAH_PUBLIC_BASE_URL"));
  check("public origin matches local configuration", configured.origin === base.origin && configured.pathname === "/" && !configured.search && !configured.hash && !configured.username && !configured.password);
  const token = env("TWILIO_AUTH_TOKEN");
  check("signature token available locally", Boolean(token));
  const local = numbers(env("NAQAH_CALL_ALLOWLIST"));
  check("local allowlist exactly matches expected recipients", validNumbers(local) && JSON.stringify(local) === JSON.stringify(expected));
  check("local scheduled calls are off", env("NAQAH_SCHEDULED_CALLS") !== "1");
  check("local farm mode and locale match", env("NAQAH_VOICE_MODE") === "farm" && env("NAQAH_VOICE_LOCALE") === locale);
  if (failures) throw new Error("configuration");

  const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const response = await request(new URL("/api/integrations/status", base));
  const status = response.status === 200 ? await response.json() : null;
  check("running build matches current commit", status?.version?.commit === commit);
  check("server farm voice is configured and signature validation is on", status?.voice?.mode === "farm" && status?.voice?.configured === true && status?.voice?.signatureValidation === true);
  const digest = createHmac("sha256", token).update(JSON.stringify(expected)).digest("hex");
  for (const path of ["/api/voice/inbound", "/api/voice/outbound", "/api/voice/turn"]) {
    const url = new URL(`${path}?preflight=1`, base);
    const body = new URLSearchParams({ Preflight: "1" });
    const headers = { "Content-Type": "application/x-www-form-urlencoded" };
    check(`${path}: unsigned probe rejected`, (await request(url, { method: "POST", headers, body })).status === 403);
    const wrong = createHmac("sha1", `${token}:invalid`).update(`${url}Preflight1`).digest("base64");
    check(`${path}: invalid signature rejected`, (await request(url, { method: "POST", headers: { ...headers, "X-Twilio-Signature": wrong }, body })).status === 403);
    const signature = createHmac("sha1", token).update(`${url}Preflight1`).digest("base64");
    const signed = await request(url, { method: "POST", headers: { ...headers, "X-Twilio-Signature": signature }, body });
    const probe = signed.status === 200 && signed.headers.get("content-type")?.includes("application/json") ? await signed.json() : null;
    check(`${path}: signed read-only probe validated`, probe?.preflight === true);
    check(`${path}: server allowlist exactly matches expected recipients`, probe?.allowlistValid === true && probe?.allowlistDigest === digest);
    check(`${path}: server scheduled calls, recording and stored transcription are off`, probe?.scheduledCalls === false && probe?.recording === false && probe?.transcription === false);
    check(`${path}: server farm mode and locale match`, probe?.mode === "farm" && probe?.locale === locale);
  }
} catch {
  check("preflight completed (check arguments, env, build and reachability)", false);
}
console.log(failures ? `NOT READY: ${failures} check(s) failed. No call placed.` : "READY for owner review only. No call placed; no Twilio API or messaging requests made.");
process.exitCode = failures ? 1 : 0;
