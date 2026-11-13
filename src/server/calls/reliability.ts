import type { SupabaseClient } from "@supabase/supabase-js";
import { endReportCallWithoutReport, resolveReportCallAttempt } from "@/domain/reportCalls";
import type { LocalizedText, Workspace } from "@/domain/types";
import { toDbId } from "@/server/db/ids";
import { runFarmAction } from "@/server/db/service-repository";
import { MAX_CALL_SECONDS } from "./config";

export const CALL_STALE_MS = (MAX_CALL_SECONDS + 150) * 1000;

export const callFailureMessages = {
  configuration: { ar: "إعدادات الاتصال ناقصة. شغّل فحص الاتصال قبل المحاولة.", en: "Calling is not fully configured. Run the call preflight before trying again." },
  twilio_auth: { ar: "تعذّر التحقق من حساب Twilio. راجع بيانات الدخول وحالة الحساب.", en: "Twilio account verification failed. Check its credentials and account status." },
  from_number: { ar: "رقم الاتصال غير موجود في حساب Twilio أو لا يدعم الصوت. راجع الرقم.", en: "The calling number is missing from this Twilio account or is not voice-capable. Check the number." },
  openai_auth: { ar: "تعذّر التحقق من مفتاح OpenAI. راجع المفتاح وصلاحياته.", en: "OpenAI key verification failed. Check the key and its permissions." },
  bridge_unreachable: { ar: "جسر الصوت غير متاح. شغّل الجسر والنفق العام ثم افحص الاتصال.", en: "The voice bridge is unreachable. Start the bridge and public tunnel, then run preflight." },
  bridge_url: { ar: "عنوان النفق لا يطابق إعدادات جسر الصوت. حدّث العنوان وأعد تشغيل الخدمات.", en: "The public tunnel does not match the voice bridge configuration. Update the URL and restart the services." },
  not_allowed: { ar: "رقم العامل غير موجود في قائمة الأرقام المسموح بها. راجع الرقم والقائمة.", en: "The worker number is not allowlisted. Check the saved number and allowed recipients." },
  in_progress: { ar: "هناك مكالمة قائمة. انتظر نهايتها؛ لن نعيد الاتصال تلقائيًا.", en: "A call is already active. Wait for it to finish; manual calls never redial automatically." },
  timed_out: { ar: "انتهت مهلة المكالمة دون وصول حالتها النهائية. افحص النفق وسجل Twilio قبل المحاولة مجددًا.", en: "The call deadline passed without a final status. Check the tunnel and Twilio call log before trying again." },
  bridge_disconnected: { ar: "انقطع جسر الصوت. افحص سجل الجسر والنفق؛ إذا لم يُحفظ التقرير، انتظر نهاية المكالمة قبل المحاولة.", en: "The voice bridge disconnected. Check the bridge and tunnel logs; if no report was saved, wait for the call to end before trying again." },
  busy: { ar: "خط العامل مشغول. لم يُحفظ تقرير ولن نعيد الاتصال تلقائيًا.", en: "The worker's line was busy. No report was saved and no automatic redial is scheduled." },
  no_answer: { ar: "لم يرد العامل. تأكد من توفره قبل طلب مكالمة أخرى.", en: "The worker did not answer. Check they are available before requesting another call." },
  not_saved: { ar: "انتهت المكالمة دون حفظ تقرير. تأكد من تأكيد العامل لملخص التقرير في المكالمة التالية.", en: "The call ended without saving a report. The worker must confirm the report summary on the next call." },
  provider_rejected: { ar: "رفض Twilio المكالمة. راجع صلاحية الرقم ودعم الاتصال بالسعودية في حساب Twilio.", en: "Twilio refused the call. Check the number and Saudi calling permissions in the Twilio account." },
  placement_unknown: { ar: "لم يصل تأكيد من Twilio. قد تكون المكالمة بدأت؛ افحص سجل Twilio وانتظر قبل أي محاولة أخرى.", en: "Twilio did not confirm placement. The call may have started; check the Twilio log and wait before trying again." },
} satisfies Record<string, LocalizedText>;

export type CallFailure = keyof typeof callFailureMessages;

export function callDiagnostic(workspace: Workspace, farmId: string, runId: string): LocalizedText | null {
  return workspace.events.find((event) => event.id === toDbId(farmId, `voice-failure:${toDbId(farmId, runId)}`))?.text ?? null;
}

export function withCallDiagnostic(workspace: Workspace, farmId: string, runId: string, reason: CallFailure, now: Date): Workspace {
  const run = workspace.reportCalls?.find((entry) => toDbId(farmId, entry.id) === toDbId(farmId, runId));
  if (!run || run.reportId) return workspace;
  if (callDiagnostic(workspace, farmId, runId)) return workspace;
  const ws = structuredClone(workspace);
  const id = toDbId(farmId, `voice-failure:${toDbId(farmId, runId)}`);
  ws.events.push({ id, at: now.toISOString(), tone: "attention", text: callFailureMessages[reason] });
  return ws;
}

export function expireReportRuns(workspace: Workspace, farmId: string, now: Date): Workspace {
  let ws = workspace;
  for (const run of workspace.reportCalls ?? []) {
    if (!["calling", "answered"].includes(run.state) || run.nextAttemptAt !== null) continue;
    const started = Date.parse(run.attempts.at(-1)?.at ?? run.occurrence);
    if (!Number.isFinite(started) || now.getTime() - started < CALL_STALE_MS) continue;
    ws = run.state === "answered" ? endReportCallWithoutReport(ws, now, run.id) : resolveReportCallAttempt(ws, now, run.id, false).ws;
    ws = withCallDiagnostic(ws, farmId, run.id, "timed_out", now);
  }
  return ws;
}

export async function recordCallFailure(client: SupabaseClient, farmId: string, runId: string, reason: CallFailure, now: Date): Promise<void> {
  await runFarmAction(client, farmId, (workspace) => {
    let ws = withCallDiagnostic(workspace, farmId, runId, reason, now);
    const run = ws.reportCalls?.find((entry) => toDbId(farmId, entry.id) === toDbId(farmId, runId));
    const text = callDiagnostic(ws, farmId, runId);
    if (run?.state === "missed" && text) {
      ws = structuredClone(ws);
      const logId = toDbId(farmId, `voice-failure-log:${toDbId(farmId, runId)}`);
      const existing = ws.calls.find((call) => call.id === logId || (call.kind === "worker_report_missed" && call.at === now.toISOString()));
      if (existing) existing.summary = text;
      else ws.calls.push({ id: logId, kind: "worker_report", party: "worker", direction: "outbound", at: now.toISOString(), outcome: "rejected", attempt: run.attempts.length || null, summary: text, ticketId: null, reportId: null });
    }
    return { ws, result: null };
  });
}

export async function cleanStaleReportCalls(client: SupabaseClient, farmId: string, now: Date): Promise<void> {
  await runFarmAction(client, farmId, (ws) => ({ ws: expireReportRuns(ws, farmId, now), result: null }));
  const { error } = await client.from("voice_call_sessions").delete().eq("farm_id", farmId).lt("created_at", new Date(now.getTime() - CALL_STALE_MS).toISOString());
  if (error) throw new Error("Voice session cleanup failed");
}
