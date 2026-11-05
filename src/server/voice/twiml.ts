import type { CallSession } from "@/domain/conversation/engine";
import type { Locale } from "@/domain/types";
import { voiceConfiguration } from "@/server/env";

export function escapeXml(value: string): string {
  return value
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

export function agentText(session: CallSession, locale: Locale): string {
  const turn = [...session.turns].reverse().find((item) => item.speaker === "agent");
  const question = turn?.text[locale] ?? (locale === "ar" ? "تفضل، وش تبي تقول؟" : "Go ahead.");
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
  return `<Response>${sayElement(text, locale)}<Gather input="speech dtmf" language="${language}" speechTimeout="auto" timeout="6" numDigits="1" action="${escapeXml(actionUrl)}" method="POST" actionOnEmptyResult="true"></Gather></Response>`;
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
