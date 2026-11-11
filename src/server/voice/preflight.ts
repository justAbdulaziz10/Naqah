import { createHmac } from "node:crypto";
import { callAllowlist, scheduledCallsEnabled } from "@/server/calls/config";
import { voiceLocale, voiceMode } from "@/server/env";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dialableWorkerPhone, reportCallIsLive } from "@/domain/reportCalls";
import { loadFarm, requireFarm } from "@/server/db/queries";
import { callTimeLimitSeconds, outboundConfig, SAUDI_MOBILE } from "@/server/calls/config";
import { callFailureMessages, cleanStaleReportCalls, type CallFailure } from "@/server/calls/reliability";
import { bridgeSignature } from "@/server/voice/realtime/internal";

export async function freeCallPreflight(client: SupabaseClient, farmId: string, fetchImpl: typeof fetch = fetch) {
  const checks: { name: string; passed: boolean; reason: CallFailure }[] = [];
  const check = (name: string, passed: boolean, reason: CallFailure) => checks.push({ name, passed, reason });
  const config = outboundConfig();
  if (!config) return { ready: false, checks: [{ name: "configuration", passed: false, reason: "configuration" as const }], message: callFailureMessages.configuration };
  await cleanStaleReportCalls(client, farmId, new Date());
  const { workspace } = requireFarm(await loadFarm(client, { id: farmId }));
  const worker = dialableWorkerPhone(workspace);
  check("worker_allowlisted", Boolean(worker && SAUDI_MOBILE.test(worker) && config.allowlist.includes(worker)), "not_allowed");
  check("no_active_run", !(workspace.reportCalls ?? []).some((run) => reportCallIsLive(run, new Date())), "in_progress");
  const get = async (url: string | URL, headers?: Record<string, string>) => {
    try {
      const response = await fetchImpl(url, { headers, redirect: "error", signal: AbortSignal.timeout(4_000), cache: "no-store" });
      if (!response.ok) { await response.body?.cancel(); return null; }
      return await response.json();
    } catch { return null; }
  };
  let bridgeUrl: URL | null = null;
  try {
    bridgeUrl = new URL(process.env.NAQAH_BRIDGE_PUBLIC_URL ?? "");
    if (bridgeUrl.protocol !== "wss:" || bridgeUrl.pathname !== "/voice-bridge/media" || bridgeUrl.search || bridgeUrl.hash || bridgeUrl.username || bridgeUrl.password) bridgeUrl = null;
  } catch {}
  const publicMatches = Boolean(bridgeUrl && `https://${bridgeUrl.host}` === config.baseUrl);
  check("public_bridge_url", publicMatches, "bridge_url");
  const authorization = { Authorization: `Basic ${Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64")}` };
  const accountBase = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(config.accountSid)}`;
  const bridgeProviderCheck = async () => {
    if (!publicMatches) return null;
    try {
      const body = JSON.stringify({ preflight: true });
      const timestamp = Date.now().toString();
      const response = await fetchImpl(new URL("/voice-bridge/preflight", config.baseUrl), {
        method: "POST", body, headers: { "Content-Type": "application/json", "x-naqah-bridge-timestamp": timestamp, "x-naqah-bridge-signature": bridgeSignature(timestamp, body, process.env.NAQAH_VOICE_SECRET!.trim()) },
        signal: AbortSignal.timeout(6_000), redirect: "error", cache: "no-store",
      });
      if (!response.ok) { await response.body?.cancel(); return null; }
      return await response.json();
    } catch { return null; }
  };
  const [account, numbers, models, health] = await Promise.all([
    get(`${accountBase}.json`, authorization),
    get(`${accountBase}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(config.from)}&PageSize=20`, authorization),
    bridgeProviderCheck(),
    publicMatches ? get(new URL("/voice-bridge/health", config.baseUrl)) : null,
  ]);
  check("twilio_account", account?.sid === config.accountSid && account?.status === "active", "twilio_auth");
  check("twilio_voice_number", Array.isArray(numbers?.incoming_phone_numbers) && numbers.incoming_phone_numbers.some((number: { phone_number?: string; capabilities?: { voice?: boolean } }) => number.phone_number === config.from && number.capabilities?.voice === true), "from_number");
  check("bridge_health", health?.ok === true, "bridge_unreachable");
  check("bridge_configuration", health?.publicUrl === bridgeUrl?.href && health?.maxCallSeconds === callTimeLimitSeconds(), "bridge_url");
  check("openai_key", models?.openaiKeyValid === true, "openai_auth");
  // A key can list models with no credit left; only an opened realtime session shows a call can start.
  check("openai_realtime", models?.realtimeReady === true, models?.realtimeError === "credit_balance_exhausted" || models?.realtimeError === "insufficient_quota" ? "openai_quota" : "openai_auth");
  const failed = checks.find((entry) => !entry.passed);
  return { ready: !failed, checks, message: failed ? callFailureMessages[failed.reason] : null };
}

export function preflightResponse(): Response {
  const raw = process.env.NAQAH_CALL_ALLOWLIST?.trim() ?? "";
  const allowlist = callAllowlist();
  return Response.json({
    preflight: true,
    mode: voiceMode(),
    locale: voiceLocale(),
    scheduledCalls: scheduledCallsEnabled(),
    recording: false,
    transcription: false,
    allowlistValid: Boolean(raw) && raw.split(",").every((item) => /^\+[1-9]\d{7,14}$/.test(item.trim())),
    allowlistDigest: createHmac("sha256", process.env.TWILIO_AUTH_TOKEN!.trim())
      .update(JSON.stringify(allowlist.slice().sort())).digest("hex"),
  }, { headers: { "Cache-Control": "no-store" } });
}
