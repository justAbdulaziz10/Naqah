/**
 * Minimal Twilio REST client for calls NAQAH places. Never pretends: without credentials it
 * returns `not_configured`, and any provider failure is `placed: false`. Recording is always off.
 */
import type { OutboundConfig } from "./config";
import { callTimeLimitSeconds, outboundConfig, SAUDI_MOBILE } from "./config";

export interface OutboundCallRequest {
  /** E.164 number to call. */
  to: string;
  /** TwiML to fetch when answered. Give `url` or `twiml`. */
  url?: string;
  twiml?: string;
  statusCallback: string;
  /** Seconds to ring before Twilio reports no-answer. */
  timeoutSeconds?: number;
  /** Twilio progress events to send to `statusCallback`; omitted, only the final status arrives. */
  statusEvents?: ("initiated" | "ringing" | "answered" | "completed")[];
}

export type OutboundCallResult =
  | { placed: true; sid: string }
  | { placed: false; reason: "not_configured" | "invalid_number" | "not_allowed" | "rejected" | "network_error"; status?: number; code?: number };

export interface OutboundCaller {
  provider?: "twilio";
  place(request: OutboundCallRequest): Promise<OutboundCallResult>;
}

const E164 = /^\+[1-9]\d{7,14}$/;
const CALL_SID = /^CA[0-9a-f]{32}$/i;

export function createTwilioCaller(config: OutboundConfig | null = outboundConfig(), fetchImpl: typeof fetch = fetch): OutboundCaller {
  return {
    provider: "twilio",
    async place(request) {
      if (!config) return { placed: false, reason: "not_configured" };
      if (!E164.test(request.to) || !SAUDI_MOBILE.test(request.to) || (!request.url && !request.twiml)) return { placed: false, reason: "invalid_number" };
      // Only the consenting numbers on the allowlist can ring; an empty allowlist rings nobody.
      if (!config.allowlist.includes(request.to)) {
        console.info("[NAQAH] outbound call refused: number is not on NAQAH_CALL_ALLOWLIST");
        return { placed: false, reason: "not_allowed" };
      }
      const body = new URLSearchParams({
        To: request.to,
        From: config.from,
        StatusCallback: request.statusCallback,
        StatusCallbackMethod: "POST",
        Timeout: String(request.timeoutSeconds ?? 30),
        // A hard ceiling on every call's length: Twilio ends the call when it is reached.
        TimeLimit: String(callTimeLimitSeconds()),
        Record: "false",
      });
      for (const event of request.statusEvents ?? []) body.append("StatusCallbackEvent", event);
      if (request.url) {
        body.set("Url", request.url);
        body.set("Method", "POST");
      } else {
        body.set("Twiml", request.twiml!);
      }
      const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(config.accountSid)}/Calls.json`;
      try {
        const response = await fetchImpl(endpoint, {
          method: "POST",
          headers: {
            Authorization: `Basic ${Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64")}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body,
          signal: AbortSignal.timeout(10_000),
          redirect: "error",
        });
        if (!response.ok) {
          console.info(`[NAQAH] Twilio outbound call refused (${response.status})`);
          const body = await response.json().catch(() => null) as { code?: unknown } | null;
          const code = typeof body?.code === "number" && Number.isSafeInteger(body.code) ? body.code : undefined;
          return { placed: false, reason: "rejected", status: response.status, ...(code === undefined ? {} : { code }) };
        }
        const sid = ((await response.json()) as { sid?: unknown }).sid;
        if (typeof sid !== "string" || !CALL_SID.test(sid)) return { placed: false, reason: "rejected", status: response.status };
        return { placed: true, sid };
      } catch {
        console.info("[NAQAH] Twilio outbound call failed (network error)");
        return { placed: false, reason: "network_error" };
      }
    },
  };
}

/** Test double: records every request and answers with the given result (a fresh CallSid by default). */
export function recordingCaller(result?: (request: OutboundCallRequest, index: number) => OutboundCallResult) {
  const requests: OutboundCallRequest[] = [];
  const caller: OutboundCaller = {
    async place(request) {
      requests.push(request);
      return result?.(request, requests.length - 1) ?? { placed: true, sid: `CA${String(requests.length).padStart(32, "0")}` };
    },
  };
  return { caller, requests };
}
