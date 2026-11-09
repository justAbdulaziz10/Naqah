import { createHmac, timingSafeEqual } from "node:crypto";
import type { LabSession } from "./answer-guards";
import type { Locale } from "@/domain/types";

export const LAB_TTL_MS = 30 * 60 * 1000;

export type LabSource = "farm" | "sample";

/** The call's position travels with the browser, signed, so a Lab session needs no database row. */
export interface LabState {
  /** The signed-in owner. A token from another account is refused. */
  u: string;
  /** OpenAI's id for this call, so only its own session can hang it up. */
  c: string;
  l: Locale;
  src: LabSource;
  exp: number;
  /** Null on the hang-up token, which must stay small enough for a keepalive request. */
  session: LabSession | null;
}

const keyFor = (secret: string) => createHmac("sha256", secret).update("naqah-voice-lab").digest();
const sign = (body: string, secret: string) => createHmac("sha256", keyFor(secret)).update(body).digest("base64url");

export function signLabState(state: LabState, secret: string): string {
  const body = Buffer.from(JSON.stringify(state)).toString("base64url");
  return `${body}.${sign(body, secret)}`;
}

export function verifyLabState(token: unknown, secret: string, ownerId: string, nowMs: number): LabState | null {
  if (typeof token !== "string") return null;
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra !== undefined) return null;
  const expected = Buffer.from(sign(body, secret));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const state = JSON.parse(Buffer.from(body, "base64url").toString()) as LabState;
    return state.u === ownerId && state.exp > nowMs ? state : null;
  } catch {
    return null;
  }
}
