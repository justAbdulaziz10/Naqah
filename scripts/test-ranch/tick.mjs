#!/usr/bin/env node
// LOCAL OPERATOR TOOLING. Makes exactly one authenticated cron GET and appends counts-only evidence.
import { closeSync, mkdirSync, openSync, writeSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readEnvFile } from "./env-file.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_EVIDENCE_DIR = join(ROOT, ".realcall", "evidence");
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function validOrigin(raw, allowLocal) {
  let origin;
  try { origin = new URL(raw); } catch { throw new Error("invalid_origin"); }
  const loopback = origin.hostname === "localhost" || origin.hostname === "[::1]" || /^127(?:\.\d{1,3}){3}$/.test(origin.hostname);
  if (origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash ||
      (origin.protocol !== "https:" && !(allowLocal && origin.protocol === "http:" && loopback))) throw new Error("invalid_origin");
  return origin;
}

function isLoopback(hostname) {
  return hostname === "localhost" || hostname === "[::1]" || /^127(?:\.\d{1,3}){3}$/.test(hostname);
}

function isNgrokHost(hostname) {
  return /(^|\.)ngrok(?:-free)?\.(?:app|io|dev|com)$/i.test(hostname);
}

function appendEvidence(path, line) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const descriptor = openSync(path, "a", 0o600);
  try { writeSync(descriptor, `${line}\n`); } finally { closeSync(descriptor); }
}

export async function runTick({ env, origin, allowLocal = false, fetchImpl = fetch, evidencePath, now = new Date(), output = () => {} }) {
  if (!env.CRON_SECRET?.trim() || !ID.test(env.NAQAH_TEST_RANCH_ID ?? "")) throw new Error("operator_scope_missing");
  const target = validOrigin(origin ?? env.PREVIEW_ORIGIN ?? "", allowLocal);
  const mode = allowLocal && isLoopback(target.hostname) ? "local" : "preview";
  const headers = { authorization: `Bearer ${env.CRON_SECRET.trim()}` };
  if (env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim() && !isLoopback(target.hostname) && !isNgrokHost(target.hostname)) {
    headers["x-vercel-protection-bypass"] = env.VERCEL_AUTOMATION_BYPASS_SECRET.trim();
  }
  const configuredPhase = env.NAQAH_TEST_CALL_PHASE?.trim();
  const phase = ["report", "owner", "worker"].includes(configuredPhase) ? configuredPhase : "unset";
  let status = "no_response";
  let summary = { farms: "-", placed: "-", failed: "-", errors: "-" };
  try {
    const response = await fetchImpl(new URL("/api/cron/report-calls", target), {
      method: "GET", headers, redirect: "manual", signal: AbortSignal.timeout(30_000), cache: "no-store",
    });
    status = String(response.status);
    if (response.headers.get("content-type")?.includes("application/json")) {
      const body = await response.json();
      for (const key of Object.keys(summary)) {
        const value = body?.[key];
        if (Number.isInteger(value) && value >= 0) summary[key] = String(value);
      }
    } else await response.body?.cancel();
  } catch {
    // A single timeout or connection error is recorded without replaying a potentially accepted tick.
  }
  const line = `${now.toISOString()} deployment=${target.hostname} mode=${mode} status=${status} farms=${summary.farms} placed=${summary.placed} failed=${summary.failed} errors=${summary.errors} phase=${phase}`;
  const evidenceDir = env.NAQAH_EVIDENCE_DIR?.trim() || DEFAULT_EVIDENCE_DIR;
  const path = evidencePath ?? (mode === "local" ? join(evidenceDir, "rehearsal", "ticks.local.log") : join(evidenceDir, "ticks.log"));
  appendEvidence(path, line);
  output(line);
  return { status, ...summary, phase, deployment: target.hostname, mode, line };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const envPath = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
    const allowLocal = process.argv.includes("--local");
    if (!envPath) throw new Error("env_file_required");
    const env = { ...process.env, ...readEnvFile(envPath) };
    const origin = env.PREVIEW_ORIGIN;
    await runTick({ env, origin, allowLocal, output: (line) => process.stdout.write(`${line}\n`) });
  } catch {
    process.stderr.write("tick refused; no cron request was made\n");
    process.exitCode = 2;
  }
}
