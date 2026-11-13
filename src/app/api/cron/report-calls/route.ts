import { timingSafeEqual } from "node:crypto";
import { connection } from "next/server";
import { cronSecret, outboundCallMissing, outboundConfig, scheduledCallsEnabled } from "@/server/calls/config";
import { runReportCallScheduler } from "@/server/calls/scheduler";
import { createTwilioCaller } from "@/server/calls/twilio";
import { createServiceClient } from "@/server/db/service-client";
import { farmVoiceMissing, voiceMode } from "@/server/env";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Vercel Hobby's ceiling without Fluid compute; the pg_cron caller stops waiting after 55 s. */
export const maxDuration = 60;

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

function authorized(request: Request, secret: string): boolean {
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Best effort: one row per job in `scheduler_heartbeats` (service key only) shows the trigger is alive.
 * Never fails the run, so a deployment ahead of its migration still dials.
 */
async function heartbeat(client: SupabaseClient, outcome: string, summary: Record<string, number> = {}): Promise<void> {
  try {
    const { error } = await client
      .from("scheduler_heartbeats")
      .upsert({ job: "report-calls", last_run_at: new Date().toISOString(), outcome, summary });
    if (error) console.warn("[NAQAH] scheduler heartbeat not saved");
  } catch {
    console.warn("[NAQAH] scheduler heartbeat not saved");
  }
}

/**
 * Places due report calls. Call it every ~5 minutes with `Authorization: Bearer $CRON_SECRET`
 * (Vercel Pro cron, Supabase pg_cron + pg_net, or any external scheduler). Refuses everything
 * while CRON_SECRET is unset, and never places a call unless farm mode, NAQAH_SCHEDULED_CALLS=1
 * and Twilio are all configured.
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
  // Unattended calls cost money and reach real people: a separate switch, off by default.
  if (!scheduledCallsEnabled()) {
    await heartbeat(client, "scheduled_calls_off");
    return json({ ok: true, placed: 0, skipped: "scheduled_calls_off" });
  }

  try {
    const summary = await runReportCallScheduler(client, createTwilioCaller(config), { baseUrl: config.baseUrl, now: new Date() });
    // Counts only: no farm ids, phone numbers or names leave the route.
    const counts = { farms: summary.farms, placed: summary.placed, failed: summary.failed, errors: summary.errors };
    await heartbeat(client, "ran", counts);
    return json({ ok: true, ...counts });
  } catch (error) {
    console.error(`[NAQAH] report call scheduler failed (${error instanceof Error ? error.name : "unknown"})`);
    await heartbeat(client, "unavailable");
    return json({ ok: false, reason: "unavailable" }, 503);
  }
}
