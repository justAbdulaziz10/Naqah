/**
 * Settings for calls NAQAH places itself (report calls to the worker, update calls to the owner).
 * Names only are reported as missing, so the result is safe to log.
 */
import { readFileSync } from "node:fs";

const value = (name: string) => process.env[name]?.trim() ?? "";

export interface OutboundConfig {
  accountSid: string;
  authToken: string;
  from: string;
  /** Public HTTPS origin Twilio fetches the call's TwiML and status callback from. */
  baseUrl: string;
  /** NAQAH dials only these Saudi mobiles, whatever a farm has saved. Empty → nothing is dialled. */
  allowlist: string[];
}

/** A Saudi mobile in E.164: +9665 and eight digits. NAQAH places calls to nothing else. */
export const SAUDI_MOBILE = /^\+9665\d{8}$/;

/**
 * NAQAH_CALL_ALLOWLIST: comma-separated Saudi mobiles. Strict: unset, empty or without one valid
 * number, nothing can be dialled, so a missing or mistyped setting fails closed.
 */
export function callAllowlist(): string[] {
  const file = approvedNumbersFile();
  const raw = file === null ? value("NAQAH_CALL_ALLOWLIST") : readApproved(file);
  return raw.split(/[,\n]/).map((item) => item.replace(/[\s-]/g, "")).filter((item) => SAUDI_MOBILE.test(item));
}

/**
 * Local test runs only: NAQAH_CALL_ALLOWLIST_FILE names a file of approved numbers in the OS temp directory, read
 * on every call, so approving a number needs no restart. Never on Vercel; any other path is ignored. An unreadable
 * file approves nothing.
 */
function approvedNumbersFile(): string | null {
  const file = value("NAQAH_CALL_ALLOWLIST_FILE");
  if (!file || process.env.VERCEL !== undefined) return null;
  return /^\/(?:tmp|private\/tmp|var\/folders)\/[\w./-]+$/.test(file) && !file.includes("..") ? file : null;
}

function readApproved(file: string): string {
  try {
    return readFileSync(file, "utf8").slice(0, 4096);
  } catch {
    return "";
  }
}

/** The longest any call NAQAH places may last. NAQAH_CALL_TIME_LIMIT_SECONDS can only lower it. */
export const MAX_CALL_SECONDS = 300;

export function callTimeLimitSeconds(): number {
  const configured = Number(value("NAQAH_CALL_TIME_LIMIT_SECONDS"));
  return Number.isInteger(configured) && configured >= 10 && configured < MAX_CALL_SECONDS ? configured : MAX_CALL_SECONDS;
}

/** «اتصال حقيقي»: at most this many placed calls per ranch, per window. */
export const CALL_NOW_LIMITS = [
  { window: "hour", limit: 3, seconds: 3600 },
  { window: "day", limit: 10, seconds: 86400 },
] as const;

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
