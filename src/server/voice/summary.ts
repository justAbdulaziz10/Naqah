import { after } from "next/server";
import type { FarmReport, Locale } from "@/domain/types";
import { summaryCredentials } from "@/server/env";
import { callOwnerWithSummary } from "@/server/twilio/rest";
import { sendWhatsAppText } from "@/server/whatsapp/cloud";

export function buildOwnerSummary(report: FarmReport, locale: Locale): string {
  const findings = report.findings.map((finding) => finding.text[locale]);
  const facts = report.answers.map((item) => {
    const question = item.question[locale];
    const answer = item.answerText?.[locale] ?? item.answer;
    return `${question}: ${answer}`;
  });
  const lines = [locale === "ar" ? "حُفظ تحديث المزرعة." : "Farm update saved."];
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

async function sendOwnerSummary(report: FarmReport, locale: Locale): Promise<void> {
  const text = buildOwnerSummary(report, locale);
  const config = summaryCredentials();
  const tasks: Promise<unknown>[] = [];
  if (config.whatsapp.token && config.whatsapp.phoneNumberId && config.whatsapp.recipient) {
    tasks.push(sendWhatsAppText(config.whatsapp.recipient, text));
  }
  if (config.ownerCall.enabled) tasks.push(callOwnerWithSummary(text, locale));
  await Promise.allSettled(tasks);
}

export async function scheduleOwnerSummary(report: FarmReport, locale: Locale): Promise<void> {
  const task = () => sendOwnerSummary(report, locale);
  try {
    after(task);
    return;
  } catch {
    // Direct Route Handler calls and non-Next hosts have no Next request scope.
  }
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      task(),
      new Promise<void>((resolve) => {
        timeout = setTimeout(resolve, 4_000);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
