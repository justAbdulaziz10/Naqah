import type { SupabaseClient } from "@supabase/supabase-js";
import { withTimeout } from "@/lib/supabase/timeout";
import { createServiceClient } from "@/server/db/service-client";
import { farmVoiceMissing, voiceLocale } from "@/server/env";
import { checkTwilioWebhookSignature } from "@/server/twilio/signature";
import { SAVE_FAILED } from "./farm-call";
import { twimlGoodbye, twimlResponse } from "./twiml";
import { preflightResponse } from "./preflight";

// Twilio stops waiting at 15 seconds, so the caller must hear an honest failure before that.
const WEBHOOK_LIMIT_MS = 12_000;
const CALL_SID = /^CA[0-9a-f]{32}$/i;

export type FarmWebhook = { client: SupabaseClient; form: URLSearchParams; callSid: string };

/**
 * Every farm webhook passes here first. Unlike the sample line, a missing token or client means
 * no call at all: farm mode never falls back to sample data or to unsigned requests.
 */
export async function farmWebhook(request: Request): Promise<FarmWebhook | Response> {
  const locale = voiceLocale();
  const client = createServiceClient();
  if (!client || farmVoiceMissing().length) {
    console.error("[NAQAH] farm voice is not configured");
    return twimlResponse(twimlGoodbye(locale, locale === "ar" ? "خط الاتصال غير مفعّل حالياً." : "The phone line is not configured yet."));
  }
  const form = new URLSearchParams(await request.text());
  if (!checkTwilioWebhookSignature(request, form).verified) return twimlResponse(twimlGoodbye(locale), 403);
  if (new URL(request.url).searchParams.get("preflight") === "1") return preflightResponse();
  const callSid = form.get("CallSid") ?? "";
  if (!CALL_SID.test(callSid)) return twimlResponse(twimlGoodbye(locale), 400);
  return { client, form, callSid };
}

/** A failure here never says "saved": the caller is told nothing could be confirmed. */
export async function farmResponse(work: Promise<string>): Promise<Response> {
  try {
    return twimlResponse(await withTimeout(work, WEBHOOK_LIMIT_MS));
  } catch (error) {
    console.error(`[NAQAH] voice webhook failed (${error instanceof Error ? error.name : "unknown"})`);
    const locale = voiceLocale();
    return twimlResponse(twimlGoodbye(locale, SAVE_FAILED[locale]));
  }
}
