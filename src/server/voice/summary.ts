import type { FarmReport, Locale } from "@/domain/types";
import { afterResponse } from "@/server/calls/after";
import { summaryCredentials } from "@/server/env";
import { callOwnerWithSummary } from "@/server/twilio/rest";
import { sendWhatsAppText } from "@/server/whatsapp/cloud";

/** Only the sample line sends these, so they must not read as a saved farm update. */
const SAMPLE_HEADLINE = {
  ar: "تحديث تجريبي من المزرعة النموذجية، ولم يُحفظ لمزرعة حقيقية.",
  en: "Sample update from the demo farm. It was not saved to a real farm.",
} as const;
/** A real farm's update call. Short: the details are on the website. */
const FARM_HEADLINE = {
  ar: "تحديث جديد من ناقة عن مزرعتك. التفاصيل كاملة في الموقع.",
  en: "A new update from NAQAH about your farm. Full details are on the website.",
} as const;

export function buildOwnerSummary(report: FarmReport, locale: Locale): string {
  const findings = report.findings.map((finding) => finding.text[locale]);
  const facts = report.answers.map((item) => {
    const question = item.question[locale];
    const answer = item.answerText?.[locale] ?? item.answer;
    return `${question}: ${answer}`;
  });
  const lines: string[] = [SAMPLE_HEADLINE[locale]];
  if (findings.length) {
    lines.push(locale === "ar" ? "ملاحظات مهمة:" : "Important findings:");
    lines.push(...findings.map((finding) => `• ${finding}`));
  }
  if (facts.length) {
    lines.push(locale === "ar" ? "أبرز المعلومات:" : "Key facts:");
    lines.push(...facts.map((fact) => `• ${fact}`));
  }
  return lines.join("\n").slice(0, 4_000);
}

export function buildOwnerCallSummary(report: FarmReport, locale: Locale, source: "sample" | "farm" = "sample"): string {
  const findings = report.findings.map((finding) => finding.text[locale]);
  const lines: string[] = [(source === "farm" ? FARM_HEADLINE : SAMPLE_HEADLINE)[locale]];
  if (findings.length) {
    lines.push(locale === "ar" ? "أهم الملاحظات:" : "Important findings:");
    lines.push(...findings.map((finding) => `• ${finding}`));
  }
  const summary = lines.join(" ");
  return summary.length <= 600 ? summary : `${summary.slice(0, 599).trimEnd()}…`;
}

async function sendOwnerSummary(report: FarmReport, locale: Locale): Promise<void> {
  const text = buildOwnerSummary(report, locale);
  const config = summaryCredentials();
  const tasks: Promise<unknown>[] = [];
  if (config.whatsapp.token && config.whatsapp.phoneNumberId && config.whatsapp.recipient) {
    tasks.push(sendWhatsAppText(config.whatsapp.recipient, text));
  }
  if (config.ownerCall.enabled) tasks.push(callOwnerWithSummary(buildOwnerCallSummary(report, locale), locale));
  await Promise.allSettled(tasks);
}

export async function scheduleOwnerSummary(report: FarmReport, locale: Locale): Promise<void> {
  await afterResponse(() => sendOwnerSummary(report, locale));
}
