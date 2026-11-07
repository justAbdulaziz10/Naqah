import { timingSafeEqual } from "node:crypto";
import { connection } from "next/server";
import { cronSecret, outboundCallMissing, outboundConfig } from "@/server/calls/config";
import { runReportCallScheduler } from "@/server/calls/scheduler";
import { createTwilioCaller } from "@/server/calls/twilio";
import { createServiceClient } from "@/server/db/service-client";
import { farmVoiceMissing, voiceMode } from "@/server/env";

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

function authorized(request: Request, secret: string): boolean {
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Places due report calls. Call it every ~5 minutes with `Authorization: Bearer $CRON_SECRET`
 * (Vercel Pro cron, Supabase pg_cron + pg_net, or any external scheduler). Refuses everything
 * while CRON_SECRET is unset, and never places a call unless farm mode and Twilio are configured.
 */
export async function GET(request: Request): Promise<Response> {
  await connection();
  const secret = cronSecret();
  if (!secret) return json({ ok: false, reason: "cron_secret_missing" }, 503);
  if (!authorized(request, secret)) return json({ ok: false, reason: "unauthorized" }, 401);
  if (voiceMode() !== "farm") return json({ ok: true, placed: 0, skipped: "sample_mode" });

  const missing = [...new Set([...farmVoiceMissing(), ...outboundCallMissing()])];
  const config = outboundConfig();
  const client = createServiceClient();
  if (missing.length || !config || !client) return json({ ok: false, placed: 0, reason: "not_configured", missing }, 503);

  try {
    const summary = await runReportCallScheduler(client, createTwilioCaller(config), { baseUrl: config.baseUrl, now: new Date() });
    return json({ ok: true, ...summary });
  } catch (error) {
    console.error(`[NAQAH] report call scheduler failed (${error instanceof Error ? error.name : "unknown"})`);
    return json({ ok: false, reason: "unavailable" }, 503);
  }
}
