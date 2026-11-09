/**
 * Signed state in the URLs of calls NAQAH places. Caller ID is not trusted for outbound calls:
 * the farm, run and attempt come from this token, which only the server can sign.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Locale } from "@/domain/types";

export type CallToken =
  /** A report call to the worker: farm, run (DB id), attempt number. */
  | { k: "report"; f: string; r: string; n: number; l: Locale; t: number }
  /** The owner's update call about a saved report. */
  | { k: "owner"; f: string; r: string; l: Locale; t: number }
  /** An instruction or verification call to the worker. `p` is the pending call id. */
  | { k: "worker"; f: string; p: string; n: number; l: Locale; t: number };

/** Long enough for ringing plus a full call and its final status callback. */
export const CALL_TOKEN_MAX_AGE_MS = 3 * 60 * 60 * 1000;
const PURPOSE = "naqah-call:";

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(PURPOSE + payload).digest("base64url");
}

export function signCallToken(token: CallToken, secret = process.env.NAQAH_VOICE_SECRET?.trim()): string {
  if (!secret) throw new Error("NAQAH_VOICE_SECRET is required to sign call tokens");
  const payload = Buffer.from(JSON.stringify(token), "utf8").toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function verifyCallToken(
  value: string | null | undefined,
  secret = process.env.NAQAH_VOICE_SECRET?.trim(),
  now = Date.now(),
): CallToken | null {
  if (!value || !secret || value.length > 2_000) return null;
  const [payload, signature, extra] = value.split(".");
  if (!payload || !signature || extra !== undefined) return null;
  const expected = Buffer.from(sign(payload, secret));
  const provided = Buffer.from(signature);
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) return null;
  try {
    const token = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<CallToken> & { n?: unknown };
    if ((token.k !== "report" && token.k !== "owner" && token.k !== "worker") || typeof token.f !== "string" || !UUID.test(token.f)) return null;
    if (token.l !== "ar" && token.l !== "en") return null;
    if (token.k === "worker") {
      const pending = (token as { p?: unknown }).p;
      if (typeof pending !== "string" || !UUID.test(pending)) return null;
      if (typeof token.n !== "number" || !Number.isInteger(token.n) || token.n < 1 || token.n > 3) return null;
    } else {
      const run = (token as { r?: unknown }).r;
      if (typeof run !== "string" || !UUID.test(run)) return null;
    }
    if (token.k === "report" && (typeof token.n !== "number" || !Number.isInteger(token.n) || token.n < 1 || token.n > 10)) return null;
    if (!Number.isSafeInteger(token.t) || now - token.t! > CALL_TOKEN_MAX_AGE_MS || token.t! > now + 60_000) return null;
    return token as CallToken;
  } catch {
    return null;
  }
}
