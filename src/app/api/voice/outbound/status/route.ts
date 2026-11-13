import { verifyCallToken } from "@/server/calls/token";
import { voiceMode } from "@/server/env";
import { logCallProgress } from "@/server/voice/diagnostics";
import { gateOutboundAnswer, reportCallStatus } from "@/server/voice/farm-call";
import { twimlResponse } from "@/server/voice/twiml";
import { farmWebhook } from "@/server/voice/farm-webhook";
import { testCallsEnabled } from "@/server/calls/test-call-config";
import { recordTestCallProgress } from "@/server/calls/test-call-store";

const empty = (status: number) => new Response(null, { status, headers: { "Cache-Control": "no-store" } });

/** Final status of a report call: unanswered → retry or missed; answered and hung up → ended unsaved. */
export async function POST(request: Request): Promise<Response> {
  if (voiceMode() !== "farm") return empty(204);
  const hook = await farmWebhook(request);
  if (hook instanceof Response) return hook;
  const token = verifyCallToken(new URL(request.url).searchParams.get("s"));
  if (token?.k !== "report") return empty(403);
  const now = new Date();
  const status = hook.form.get("CallStatus") ?? "";
  logCallProgress({ callSid: hook.callSid, status, sequence: hook.form.get("SequenceNumber"), timestamp: hook.form.get("Timestamp"), sip: hook.form.get("SipResponseCode") }, now);
  try {
    if (new URL(request.url).searchParams.get("amd") === "1") return twimlResponse(await gateOutboundAnswer(hook.client, { token, callSid: hook.callSid, answeredBy: hook.form.get("AnsweredBy"), now }));
    await reportCallStatus(hook.client, { token, callSid: hook.callSid, status, now });
    return empty(204);
  } catch (error) {
    console.error(`[NAQAH] report call status failed (${error instanceof Error ? error.name : "unknown"})`);
    // Twilio does not retry status callbacks; the run stays as it was and the next scheduler pass sees it.
    return empty(503);
  } finally {
    if (testCallsEnabled()) {
      try { await recordTestCallProgress(hook.client, token.r, token.f, status, now); }
      catch { console.error("[NAQAH] test call status storage failed"); }
    }
  }
}
