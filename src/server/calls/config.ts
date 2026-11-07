/**
 * Settings for calls NAQAH places itself (report calls to the worker, update calls to the owner).
 * Names only are reported as missing, so the result is safe to log.
 */
const value = (name: string) => process.env[name]?.trim() ?? "";

export interface OutboundConfig {
  accountSid: string;
  authToken: string;
  from: string;
  /** Public HTTPS origin Twilio fetches the call's TwiML and status callback from. */
  baseUrl: string;
  /** When set, NAQAH dials only these E.164 numbers, whatever a farm has saved. For controlled tests. */
  allowlist: string[] | null;
}

const E164 = /^\+[1-9]\d{7,14}$/;

/**
 * NAQAH_CALL_ALLOWLIST: comma-separated E.164 numbers. Unset → no extra limit (production).
 * Set but with no valid number → nothing can be dialled, so a typo fails closed.
 */
export function callAllowlist(): string[] | null {
  const raw = value("NAQAH_CALL_ALLOWLIST");
  if (!raw) return null;
  return raw.split(",").map((item) => item.replace(/[\s-]/g, "")).filter((item) => E164.test(item));
}

/** Unattended scheduled calls. Off unless NAQAH_SCHEDULED_CALLS=1, even when the cron secret is right. */
export const scheduledCallsEnabled = () => value("NAQAH_SCHEDULED_CALLS") === "1";

/** The owner's "Call now" for one controlled report call. Off unless NAQAH_MANUAL_REPORT_CALLS=1. */
export const manualCallsEnabled = () => value("NAQAH_MANUAL_REPORT_CALLS") === "1";

const REQUIRED = ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_PHONE_NUMBER", "NAQAH_PUBLIC_BASE_URL", "NAQAH_VOICE_SECRET"] as const;

export function outboundCallMissing(): string[] {
  const missing: string[] = REQUIRED.filter((name) => !value(name));
  if (value("NAQAH_PUBLIC_BASE_URL") && !publicOrigin()) missing.push("NAQAH_PUBLIC_BASE_URL (must be an https origin)");
  return missing;
}

function publicOrigin(): string | null {
  try {
    const url = new URL(value("NAQAH_PUBLIC_BASE_URL"));
    return url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

export function outboundConfig(): OutboundConfig | null {
  if (outboundCallMissing().length) return null;
  return {
    accountSid: value("TWILIO_ACCOUNT_SID"),
    authToken: value("TWILIO_AUTH_TOKEN"),
    from: value("TWILIO_PHONE_NUMBER"),
    baseUrl: publicOrigin()!,
    allowlist: callAllowlist(),
  };
}

/** The farm owner's update call after a saved report: paid, so off unless NAQAH_CALL_OWNER=1. */
export const ownerUpdateCallEnabled = () => value("NAQAH_CALL_OWNER") === "1";

/** Bearer secret for /api/cron/report-calls. Without it the route refuses every request. */
export const cronSecret = () => value("CRON_SECRET");
