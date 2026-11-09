/** The bridge's calls into Next: signed over the raw body, within a minute of now. */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/server/db/service-client";
import { realtimeVoiceConfig } from "@/server/env";
import { readBoundedText } from "@/lib/http/body";

const MAX_SKEW_MS = 60_000;
const MAX_BODY_BYTES = 16 * 1024;

function internalKey(secret: string): Buffer {
  return createHmac("sha256", secret).update("naqah-bridge-internal").digest();
}

export function bridgeSignature(timestamp: string, rawBody: string, secret: string): string {
  return createHmac("sha256", internalKey(secret)).update(`${timestamp}.${rawBody}`).digest("hex");
}

export function validBridgeSignature(timestamp: string | null, signature: string | null, rawBody: string, secret: string, now: number): boolean {
  if (!timestamp || !signature || !/^\d{1,16}$/.test(timestamp) || !/^[0-9a-f]{64}$/i.test(signature)) return false;
  if (Math.abs(now - Number(timestamp)) > MAX_SKEW_MS) return false;
  const expected = Buffer.from(bridgeSignature(timestamp, rawBody, secret), "hex");
  const provided = Buffer.from(signature, "hex");
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}

export interface BridgeRequest {
  client: SupabaseClient;
  body: Record<string, unknown>;
  secret: string;
  now: Date;
}

/** Every bridge route starts here. Nothing is parsed until the signature has passed. */
export async function bridgeRequest(request: Request): Promise<BridgeRequest | Response> {
  const config = realtimeVoiceConfig();
  if (!config) return new Response(null, { status: 404 });
  const bounded = await readBoundedText(request, MAX_BODY_BYTES);
  if (!bounded.ok) return new Response(null, { status: bounded.status });
  const raw = bounded.text;
  const now = new Date();
  const verified = validBridgeSignature(request.headers.get("x-naqah-bridge-timestamp"), request.headers.get("x-naqah-bridge-signature"), raw, config.secret, now.getTime());
  if (!verified) return new Response(null, { status: 403 });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response(null, { status: 400 });
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) return new Response(null, { status: 400 });
  const client = createServiceClient();
  if (!client) return new Response(null, { status: 503 });
  return { client, body: body as Record<string, unknown>, secret: config.secret, now };
}
