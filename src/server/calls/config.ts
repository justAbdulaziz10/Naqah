/**
 * Settings for calls NAQAH places itself (report calls to the worker, update calls to the owner).
 * Names only are reported as missing, so the result is safe to log.
 */
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";

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

/** A UK mobile in E.164: +447 and nine digits. */
export const UK_MOBILE = /^\+447\d{9}$/;

/**
 * LOCAL DEMO ONLY: a UK mobile may be dialled too, when the runner sets NAQAH_DEMO_UK_NUMBERS=1 (--allow-uk-numbers)
 * and the number is in the local approved list. A UK phone answers NAQAH's UK caller ID as a domestic call, which
 * Saudi carriers were filtering as spam (11 Nov). Never on Vercel; Saudi mobiles are unaffected.
 */
export const demoUkNumbers = () => value("NAQAH_DEMO_UK_NUMBERS") === "1" && approvedNumbersFile() !== null;

/** A number NAQAH may dial at all: a Saudi mobile, or on the local demo with UK numbers on, a UK mobile. */
export const isDialableNumber = (number: string) => SAUDI_MOBILE.test(number) || (UK_MOBILE.test(number) && demoUkNumbers());

/**
 * NAQAH_CALL_ALLOWLIST: comma-separated Saudi mobiles. Strict: unset, empty or without one valid
 * number, nothing can be dialled, so a missing or mistyped setting fails closed.
 */
export function callAllowlist(): string[] {
  const file = approvedNumbersFile();
  const raw = file === null ? value("NAQAH_CALL_ALLOWLIST") : readApproved(file);
  return raw.split(/[,\n]/).map((item) => item.replace(/[\s-]/g, "")).filter((item) => isDialableNumber(item));
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

/**
 * LOCAL DEMO ONLY: farms (ids in NAQAH_DEMO_REPEAT_FARMS, set by the local runner for the presentation ranch) that
 * may take another manual report call after this period's report is in. Never on Vercel; every other ranch keeps
 * one report a period.
 */
export function demoRepeatReports(farmId: string): boolean {
  if (process.env.VERCEL !== undefined || !approvedNumbersFile()) return false;
  return value("NAQAH_DEMO_REPEAT_FARMS").split(",").map((id) => id.trim()).filter(Boolean).includes(farmId);
}

/**
 * LOCAL DEMO ONLY, until the presentation: the presentation ranch's «اتصال حقيقي» skips the 3-an-hour / 10-a-day
 * limit when the runner sets NAQAH_DEMO_NO_CALL_LIMIT=1 (--no-demo-call-limit). Approved numbers, one call at a time
 * and the call length cap still apply. Never on Vercel; every other ranch keeps the limit.
 */
export const demoNoCallLimit = (farmId: string) => value("NAQAH_DEMO_NO_CALL_LIMIT") === "1" && demoRepeatReports(farmId);

/**
 * LOCAL DEMO ONLY: the presentation ranch's owner may ask NAQAH to call them now from the Dashboard («العامل / المالك»),
 * when the runner sets NAQAH_DEMO_OWNER_CALL=1 (--owner-call-now). Never on Vercel; scheduled owner calls
 * (NAQAH_CALL_OWNER) stay off. Approved numbers, one call at a time and the call length cap still apply.
 */
export const demoOwnerCallNow = (farmId: string) => value("NAQAH_DEMO_OWNER_CALL") === "1" && demoRepeatReports(farmId);
export const demoOwnerCallNowEnabled = () => value("NAQAH_DEMO_OWNER_CALL") === "1" && process.env.VERCEL === undefined && approvedNumbersFile() !== null;

/** Local demo: the owner approves a worker number in Settings, with the recipient's agreement, instead of a developer. */
export const ownerApprovesTestNumbers = () => value("NAQAH_OWNER_APPROVES_TEST_NUMBERS") === "1" && approvedNumbersFile() !== null;

/** At most this many different numbers can be approved on one computer: a cost and abuse limit. */
export const MAX_APPROVED_NUMBERS = 5;

export type ApproveResult = { ok: true; number: string } | { ok: false; reason: "not_local" | "invalid_number" | "limit" };

/**
 * Adds one Saudi mobile to the local approved list, with an audit line of who agreed and when. Only where the local
 * runner turned it on; never on Vercel. The call itself still goes through the allowlist, rate limits and time cap.
 */
export function approveTestNumber(raw: string, audit: { farmId: string; ownerId: string; at: Date }): ApproveResult {
  const file = approvedNumbersFile();
  if (!file || value("NAQAH_OWNER_APPROVES_TEST_NUMBERS") !== "1") return { ok: false, reason: "not_local" };
  const number = raw.replace(/[\s-]/g, "");
  if (!isDialableNumber(number)) return { ok: false, reason: "invalid_number" };
  const current = callAllowlist();
  if (!current.includes(number)) {
    if (current.length >= MAX_APPROVED_NUMBERS) return { ok: false, reason: "limit" };
    writeFileSync(file, [...current, number].join("\n") + "\n", { mode: 0o600 });
  }
  try {
    appendFileSync(file.replace(/\.txt$/, "") + ".audit.jsonl", JSON.stringify({ at: audit.at.toISOString(), farm: audit.farmId, owner: audit.ownerId, number: number.slice(0, 6) + "•••••" + number.slice(-3), consent: true }) + "\n", { mode: 0o600 });
  } catch { /* the audit line never blocks the owner's own number */ }
  return { ok: true, number };
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
