import type { CallSession } from "@/domain/conversation/engine";
import type { Locale } from "@/domain/types";
import { voiceConfiguration } from "@/server/env";

/** The sample line answers real phones, so a caller must never think a real farm was updated. */
export const SAMPLE_CALL_NOTICE = {
  ar: "هذي مكالمة تجريبية على عزبة نموذجية، وما تنحفظ إجاباتها. في العزبة الحقيقية ناقة هي اللي تتصل في موعد التقرير. ",
  en: "This is a sample call on a demo farm. Your answers are not kept. On a real farm, NAQAH calls you at the report time. ",
} as const;
export const SAMPLE_CALL_ENDED = {
  ar: "انتهت المكالمة التجريبية. هذا تحديث نموذجي، وما وصل لأي عزبة حقيقية.",
  en: "The sample call is finished. This was a demo update and did not reach a real farm.",
} as const;

export function escapeXml(value: string): string {
  return value
    // Illegal in XML even when escaped, and one in a camel's name would fail the whole call.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function sayElement(text: string, locale: Locale): string {
  const config = voiceConfiguration();
  const language = locale === "ar" ? "arb" : "en-US";
  const voice = locale === "ar" ? config.arabicVoice : config.englishVoice;
  return `<Say voice="${escapeXml(voice)}" language="${language}">${escapeXml(text)}</Say>`;
}

/** The ranch is «عزبة» on the phone, whichever word the question was written with. */
export function spokenWording(text: string, locale: Locale): string {
  return locale === "ar" ? text.replace(/المزرعة/g, "العزبة").replace(/مزرعة/g, "عزبة") : text;
}

export function agentText(session: CallSession, locale: Locale): string {
  const turn = [...session.turns].reverse().find((item) => item.speaker === "agent");
  const original = turn?.text[locale] ?? (locale === "ar" ? "تفضل، وش تبي تقول؟" : "Go ahead.");
  const question = spokenWording(original, locale);
  if (session.inputMode === "number") return `${question} ${locale === "ar" ? "قل العدد، أو اكتبه ثم اضغط #." : "Say the number, or enter it then press #."}`;
  if (session.inputMode !== "choices" || !session.replies.length) return question;

  const choices = session.replies.map((reply, index) => {
    const label = reply.label[locale];
    return locale === "ar" ? `اضغط ${index + 1} لـ ${label}` : `Press ${index + 1} for ${label}`;
  });
  return `${question} ${choices.join(locale === "ar" ? "، " : ". ")}`;
}

export function twimlSay(text: string, locale: Locale, hangup = false): string {
  return `<Response>${sayElement(text, locale)}${hangup ? "<Hangup/>" : ""}</Response>`;
}

export function twimlGather(session: CallSession, locale: Locale, actionUrl: string, prefix = ""): string {
  const language = locale === "ar" ? "ar-SA" : "en-US";
  const text = `${prefix}${agentText(session, locale)}`;
  // A quantity needs several keys, so only a choice ends at the first press.
  const digits = session.inputMode === "choices" ? ' numDigits="1"' : ' finishOnKey="#"';
  const speechTimeout = session.inputMode === "choices" ? "auto" : "2";
  const prompt = sayElement(text, locale);
  const summary = session.step === "report_summary";
  return `<Response>${summary ? prompt : ""}<Gather input="speech dtmf" language="${language}" speechTimeout="${speechTimeout}" timeout="6"${digits} action="${escapeXml(actionUrl)}" method="POST" actionOnEmptyResult="true">${summary ? "" : prompt}</Gather></Response>`;
}

/** Hands the call to the bridge. When the stream closes, Twilio fetches `actionUrl`. */
export function twimlStream(actionUrl: string, streamUrl: string, ticket: string): string {
  return `<Response><Connect action="${escapeXml(actionUrl)}"><Stream url="${escapeXml(streamUrl)}"><Parameter name="ticket" value="${escapeXml(ticket)}"/></Stream></Connect></Response>`;
}

export function twimlGoodbye(locale: Locale, text?: string): string {
  const fallback = locale === "ar" ? "يعطيك العافية. مع السلامة." : "Thank you. Goodbye.";
  return twimlSay(text ?? fallback, locale, true);
}

export function twimlResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/xml; charset=utf-8", "Cache-Control": "no-store" },
  });
}
