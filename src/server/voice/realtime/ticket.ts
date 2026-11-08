/**
 * The ticket that lets the bridge open one realtime call. Signed for its own purpose, so a call
 * token can never pass as a ticket or the other way round. Single use is enforced on the session
 * row (see state.ts): this module only proves who issued it and what it is bound to.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Locale } from "@/domain/types";

export interface RealtimeTicket {
  sid: string;
  f: string;
  r: string;
  l: Locale;
  /** Matches the id stored on the session row. */
  j: string;
  t: number;
}

const PURPOSE = "naqah-realtime-ticket:";
/** Twilio connects the stream within moments of the answer webhook. */
export const TICKET_CLAIM_MS = 2 * 60 * 1000;
/** The claimed ticket keeps authorising tool calls for the length of the call, and no longer. */
export const REALTIME_MAX_SECONDS = 600;
export const TICKET_CALL_MS = TICKET_CLAIM_MS + (REALTIME_MAX_SECONDS + 60) * 1000;

const CALL_SID = /^CA[0-9a-f]{32}$/i;
const ID = /^[\w-]{1,64}$/;

function sign(payload: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(PURPOSE + payload).digest();
}

export function signRealtimeTicket(ticket: RealtimeTicket, secret: string): string {
  const payload = Buffer.from(JSON.stringify(ticket), "utf8").toString("base64url");
  return `${payload}.${sign(payload, secret).toString("base64url")}`;
}

export function verifyRealtimeTicket(value: unknown, secret: string, now: number, maxAgeMs: number): RealtimeTicket | null {
  if (typeof value !== "string" || !secret || value.length > 2_000) return null;
  const [payload, signature, extra] = value.split(".");
  if (!payload || !signature || extra !== undefined) return null;
  const expected = sign(payload, secret);
  const provided = Buffer.from(signature, "base64url");
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;
  try {
    const ticket = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<RealtimeTicket>;
    if (typeof ticket.sid !== "string" || !CALL_SID.test(ticket.sid)) return null;
    if (typeof ticket.f !== "string" || !ID.test(ticket.f) || typeof ticket.r !== "string" || !ID.test(ticket.r)) return null;
    if ((ticket.l !== "ar" && ticket.l !== "en") || typeof ticket.j !== "string" || !ID.test(ticket.j)) return null;
    if (!Number.isSafeInteger(ticket.t) || now - ticket.t! > maxAgeMs || ticket.t! > now + 60_000) return null;
    return ticket as RealtimeTicket;
  } catch {
    return null;
  }
}
