import { getOwner, createClient } from "@/lib/supabase/server";
import { withTimeout } from "@/lib/supabase/timeout";
import type { Locale, Workspace } from "@/domain/types";
import { loadFarm } from "@/server/db/queries";
import { labWorkspace, openLabAgent, runLabTool } from "@/server/voice-lab/agent";
import { isVoiceLabOwner, voiceLabEnabled, voiceLabOpenAiKey, voiceLabSecret } from "@/server/voice-lab/config";
import { allowLabOpen } from "@/server/voice-lab/limit";
import { createLabCall, hangUpLabCall, LAB_MAX_SECONDS, LAB_MODEL, labPricing, labSession, type LabMode } from "@/server/voice-lab/openai";
import { LAB_TTL_MS, signLabState, verifyLabState, type LabSource, type LabState } from "@/server/voice-lab/state";
import { farmReady, sampleLabWorkspace } from "@/server/voice-lab/workspace";
import { MAX_JSON_BODY_BYTES, readBoundedJson } from "@/lib/http/body";
import { hasSameOrigin } from "@/lib/http/origin";
import type { VoiceLabErrorCode, VoiceLabFailureResponse, VoiceLabSuccessBody, VoiceLabSuccessResponse } from "@/server/voice-lab/api";

const NO_STORE = { "Cache-Control": "no-store" };
const MAX_SDP = 64 * 1024;
const FARM_TIMEOUT_MS = 8_000;
const fail = (error: VoiceLabErrorCode, status: number, extra: { provider?: string } = {}): Response => {
  const response = { ok: false, error, ...extra } satisfies VoiceLabFailureResponse;
  return Response.json(response, { status, headers: NO_STORE });
};
const done = (body?: VoiceLabSuccessBody): Response => {
  if (!body) {
    const response = { ok: true } satisfies VoiceLabSuccessResponse;
    return Response.json(response, { headers: NO_STORE });
  }
  const response = { ok: true, ...body } satisfies VoiceLabSuccessResponse;
  return Response.json(response, { headers: NO_STORE });
};

/** Read through the owner's own session and RLS. The service key is never involved. */
async function ownerFarm(ownerId: string): Promise<Workspace | null> {
  const client = await createClient();
  if (!client) return null;
  const loaded = await withTimeout(loadFarm(client, { owner_id: ownerId }), FARM_TIMEOUT_MS);
  return loaded && farmReady(loaded.workspace) ? loaded.workspace : null;
}

async function workspaceFor(ownerId: string, source: LabSource | null, locale: Locale, now: Date): Promise<{ ws: Workspace; source: LabSource } | null> {
  const farm = source === "sample" ? null : await ownerFarm(ownerId);
  if (source === "farm" && !farm) return null;
  return { ws: labWorkspace(farm ?? sampleLabWorkspace(locale, now), now), source: farm ? "farm" : "sample" };
}

export async function POST(request: Request): Promise<Response> {
  if (!voiceLabEnabled()) return fail("unavailable", 404);
  if (!hasSameOrigin(request)) return fail("forbidden", 403);

  const { user, unavailable } = await getOwner();
  if (!user) return fail(unavailable ? "auth_unavailable" : "unauthenticated", unavailable ? 503 : 401);
  if (!isVoiceLabOwner(user)) return fail("unavailable", 404);

  const parsed = await readBoundedJson(request, MAX_JSON_BODY_BYTES);
  if (!parsed.ok) return fail(parsed.status === 413 ? "payload_too_large" : "invalid_input", parsed.status);
  if (typeof parsed.value !== "object" || parsed.value === null || Array.isArray(parsed.value)) return fail("invalid_input", 400);
  const body = parsed.value as Record<string, unknown>;
  const apiKey = voiceLabOpenAiKey();
  const secret = voiceLabSecret();
  const now = new Date();

  try {
    if (body.op === "status") {
      const locale: Locale = body.locale === "en" ? "en" : "ar";
      const loaded = await workspaceFor(user.id, null, locale, now);
      if (!loaded) return fail("farm_unavailable", 503);
      return done({
        model: LAB_MODEL,
        configured: Boolean(apiKey && secret),
        source: loaded.source,
        ranch: loaded.ws.settings.farm.name,
        worker: loaded.ws.settings.worker.name,
        queue: openLabAgent(loaded.ws, now, locale).view.queue,
      });
    }
    if (!apiKey || !secret) return fail("not_configured", 503);

    if (body.op === "open") {
      const mode: LabMode | null = body.mode === "voice" || body.mode === "text" ? body.mode : null;
      const locale: Locale | null = body.locale === "ar" || body.locale === "en" ? body.locale : null;
      if (!mode || !locale || typeof body.sdp !== "string" || !body.sdp.startsWith("v=0") || body.sdp.length > MAX_SDP) return fail("invalid_input", 400);
      if (!(await allowLabOpen(user.id, now.getTime()))) return fail("rate_limited", 429);

      const loaded = await workspaceFor(user.id, null, locale, now);
      if (!loaded) return fail("farm_unavailable", 503);
      const agent = openLabAgent(loaded.ws, now, locale);
      const call = await createLabCall(apiKey, body.sdp, labSession(mode, locale, agent.instructions));
      if (!call.ok) return fail("provider_failed", call.status === 401 || call.status === 429 ? call.status : 502, { provider: call.code });

      const state: LabState = { u: user.id, c: call.callId, l: locale, src: loaded.source, exp: now.getTime() + LAB_TTL_MS, session: agent.session };
      return done({
        answer: call.answer,
        state: signLabState(state, secret),
        closeState: signLabState({ ...state, session: null }, secret),
        opening: agent.opening,
        repromptText: agent.repromptText,
        view: agent.view,
        source: loaded.source,
        model: LAB_MODEL,
        pricing: labPricing(),
        maxSeconds: LAB_MAX_SECONDS,
      });
    }

    const state = verifyLabState(body.state, secret, user.id, now.getTime());
    if (!state) return fail("session_expired", 410);

    if (body.op === "close") {
      await hangUpLabCall(apiKey, state.c);
      return done();
    }

    if (body.op === "tool") {
      if (typeof body.spoke !== "boolean") return fail("invalid_input", 400);
      if (!state.session) return fail("session_expired", 410);
      const loaded = await workspaceFor(user.id, state.src, state.l, now);
      if (!loaded) return fail("farm_unavailable", 503);
      const { workerUtterance, heardSummaryId } = body;
      if (workerUtterance !== undefined && (typeof workerUtterance !== "string" || workerUtterance.length > 1000 || /[\u0000-\u001f\u007f]/u.test(workerUtterance))) return fail("invalid_input", 400);
      if (heardSummaryId !== undefined && (typeof heardSummaryId !== "string" || heardSummaryId.length > 200)) return fail("invalid_input", 400);
      const result = runLabTool({ session: state.session, ws: loaded.ws, locale: state.l, name: body.name, args: body.args, spoke: body.spoke, workerUtterance, heardSummaryId, now });
      const { session, ...reply } = result;
      return done({ ...reply, state: signLabState({ ...state, session }, secret) });
    }

    return fail("invalid_input", 400);
  } catch (error) {
    console.error(`[NAQAH] voice lab failed (${error instanceof Error ? error.name : "unknown"})`);
    return fail("server_error", 500);
  }
}
