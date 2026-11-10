import { createHmac } from "node:crypto";
import { callAllowlist, scheduledCallsEnabled } from "@/server/calls/config";
import { voiceLocale, voiceMode } from "@/server/env";

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
