import type { Locale } from "@/domain/types";
import { summaryCredentials } from "@/server/env";
import { sayElement } from "@/server/voice/twiml";

export async function callOwnerWithSummary(text: string, locale: Locale): Promise<boolean> {
  const config = summaryCredentials().ownerCall;
  if (!config.enabled || !config.accountSid || !config.authToken || !config.from || !config.to) return false;
  if (typeof fetch !== "function") return false;

  const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(config.accountSid)}/Calls.json`;
  const spokenSummary = text.length <= 600 ? text : `${text.slice(0, 599).trimEnd()}…`;
  const twiml = `<Response>${sayElement(spokenSummary, locale)}</Response>`;
  if (twiml.length >= 4_000) return false;
  const body = new URLSearchParams({ To: config.to, From: config.from, Twiml: twiml });
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
    console.info(`[NAQAH] Twilio owner summary ${response.ok ? "accepted" : `failed (${response.status})`}`);
    return response.ok;
  } catch {
    console.info("[NAQAH] Twilio owner summary failed (network error)");
    return false;
  }
}
