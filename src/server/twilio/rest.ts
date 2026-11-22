import type { Locale } from "@/domain/types";
import { callAllowlist } from "@/server/calls/config";
import { createTwilioCaller } from "@/server/calls/twilio";
import { summaryCredentials } from "@/server/env";
import { sayElement } from "@/server/voice/twiml";

export async function callOwnerWithSummary(text: string, locale: Locale): Promise<boolean> {
  const config = summaryCredentials().ownerCall;
  if (!config.enabled || !config.accountSid || !config.authToken || !config.from || !config.to) return false;
  if (typeof fetch !== "function") return false;

  const spokenSummary = text.length <= 600 ? text : `${text.slice(0, 599).trimEnd()}…`;
  const twiml = `<Response>${sayElement(spokenSummary, locale)}</Response>`;
  if (twiml.length >= 4_000) return false;
  const caller = createTwilioCaller({ ...config, allowlist: callAllowlist() });
  // The env number may be written with spaces; compare it in the same form as the allowlist.
  return (await caller.place({ to: config.to.replace(/[\s-]/g, ""), twiml, statusCallback: "" })).placed;
}
