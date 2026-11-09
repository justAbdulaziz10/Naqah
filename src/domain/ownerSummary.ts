/**
 * What NAQAH tells the owner on the scheduled call. Built only from saved data, so nothing here
 * can claim more than the worker reported, and old data is never presented as new.
 */
import { PREDEFINED_QUESTIONS, RESOURCE_LABELS, WEEKDAY_LABELS } from "./catalog";
import { riyadhParts } from "./clock";
import { latestReportCall } from "./reportCalls";
import type { FarmReport, LocalizedText, ReportAnswer, Workspace } from "./types";

const MONTHS: LocalizedText[] = [
  { ar: "يناير", en: "January" }, { ar: "فبراير", en: "February" }, { ar: "مارس", en: "March" },
  { ar: "أبريل", en: "April" }, { ar: "مايو", en: "May" }, { ar: "يونيو", en: "June" },
  { ar: "يوليو", en: "July" }, { ar: "أغسطس", en: "August" }, { ar: "سبتمبر", en: "September" },
  { ar: "أكتوبر", en: "October" }, { ar: "نوفمبر", en: "November" }, { ar: "ديسمبر", en: "December" },
];

const QUESTION_LABELS: Record<string, LocalizedText> = {
  herd_health: { ar: "حالة الحلال", en: "Herd health" },
  herd_count: { ar: "عدد الحلال", en: "Herd count" },
};

/** "today at 5:05 PM": the instant in Riyadh, relative to the call. */
function spokenWhen(at: string, now: Date): LocalizedText {
  const date = new Date(at);
  const p = riyadhParts(date);
  const today = riyadhParts(now);
  const days = Math.round((Date.UTC(today.year, today.month - 1, today.day) - Date.UTC(p.year, p.month - 1, p.day)) / 86_400_000);
  const clock = `${p.hours % 12 || 12}:${String(p.minutes).padStart(2, "0")}`;
  const time = { ar: `الساعة ${clock} ${p.hours < 12 ? "صباحًا" : "مساءً"}`, en: `at ${clock} ${p.hours < 12 ? "AM" : "PM"}` };
  if (days === 0) return { ar: `اليوم ${time.ar}`, en: `today ${time.en}` };
  if (days === 1) return { ar: `أمس ${time.ar}`, en: `yesterday ${time.en}` };
  if (days > 1 && days < 7) return { ar: `يوم ${WEEKDAY_LABELS[p.weekday].ar} ${time.ar}`, en: `on ${WEEKDAY_LABELS[p.weekday].en} ${time.en}` };
  return { ar: `يوم ${p.day} ${MONTHS[p.month - 1].ar} ${time.ar}`, en: `on ${p.day} ${MONTHS[p.month - 1].en} ${time.en}` };
}

function questionLabel(questionId: string): LocalizedText | null {
  if (QUESTION_LABELS[questionId]) return QUESTION_LABELS[questionId];
  const kind = PREDEFINED_QUESTIONS.find((question) => question.id === questionId)?.requires;
  return kind ? RESOURCE_LABELS[kind] : null;
}

function detail(item: ReportAnswer): LocalizedText {
  const label = questionLabel(item.questionId) ?? item.question;
  const value = item.answerText ?? { ar: item.answer, en: item.answer };
  const hedge = item.certainty === "approximate"
    ? { ar: "، تقريبًا", en: ", approximately" }
    : item.certainty === "unknown" ? { ar: "، غير مؤكد", en: ", not certain" } : { ar: "", en: "" };
  return { ar: `${label.ar}: ${value.ar}${hedge.ar}`, en: `${label.en}: ${value.en}${hedge.en}` };
}

/** Questions the worker did not cover. An "unknown" with an answer is already read out as a detail. */
function notReported(ws: Workspace, report: FarmReport): LocalizedText[] {
  const answered = new Set(report.answers.map((item) => item.questionId));
  return (report.coverage ?? []).flatMap((entry) => {
    if (entry.status === "reported" || answered.has(entry.questionId)) return [];
    const custom = ws.settings.customQuestions.find((question) => question.id === entry.questionId)?.text;
    const label = questionLabel(entry.questionId) ?? (custom ? { ar: custom, en: custom } : null);
    return label ? [label] : [];
  });
}

const workerName = (ws: Workspace): LocalizedText => {
  const name = ws.settings.worker.name.trim();
  return { ar: name || "العامل", en: name || "the worker" };
};

const joined = (items: LocalizedText[]): LocalizedText => ({ ar: items.map((item) => item.ar).join("، "), en: items.map((item) => item.en).join("; ") });

function reportSummary(ws: Workspace, report: FarmReport, now: Date): LocalizedText {
  const name = workerName(ws);
  const when = spokenWhen(report.at, now);
  const parts: LocalizedText[] = [{ ar: `وصل تقرير من ${name.ar} ${when.ar}.`, en: `${name.en} reported ${when.en}.` }];

  const details = report.answers.map(detail);
  if (report.herdCountReported != null && !report.answers.some((item) => item.questionId === "herd_count")) {
    details.push({ ar: `عدد الحلال بحسب العامل: ${report.herdCountReported}`, en: `Herd count, as reported: ${report.herdCountReported}` });
  }
  if (details.length) {
    const all = joined(details);
    parts.push({ ar: `اللي انسجل: ${all.ar}.`, en: `What was recorded: ${all.en}.` });
  }

  if (report.findings.length) {
    const all = joined(report.findings.map((finding) => finding.text));
    parts.push({ ar: `أهم الملاحظات: ${all.ar}.`, en: `What matters: ${all.en}.` });
  } else {
    parts.push({ ar: "ما فيه ملاحظات تطابق معاييرك في هذا التقرير.", en: "Nothing in this report matches your important-findings list." });
  }

  const missing = notReported(ws, report);
  if (missing.length) {
    const all = joined(missing);
    parts.push({ ar: `ما انذكر في التقرير: ${all.ar}.`, en: `Not reported: ${all.en}.` });
  }
  return { ar: parts.map((part) => part.ar).join(" "), en: parts.map((part) => part.en).join(" ") };
}

/** When the latest report call to the worker failed, if the latest run did not end in a report. */
function lastFailedWorkerCall(ws: Workspace): string | null {
  const run = latestReportCall(ws);
  if (!run || run.state === "completed" || run.state === "answered") return null;
  return run.attempts.filter((attempt) => attempt.result !== "pending").at(-1)?.at ?? null;
}

function noReportSummary(ws: Workspace, now: Date): LocalizedText {
  const name = workerName(ws);
  const last = [...ws.reports].sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).at(-1);
  const when = last ? spokenWhen(last.at, now) : null;
  const parts: LocalizedText[] = [when
    ? { ar: `ما وصلنا تقرير مؤكد جديد من ${name.ar} بعد آخر تقرير ${when.ar}.`, en: `No verified report has arrived from ${name.en} since the last one ${when.en}.` }
    : { ar: `ما وصلنا أي تقرير مؤكد من ${name.ar} إلى الآن.`, en: `No verified report has arrived from ${name.en} yet.` }];
  const failedAt = lastFailedWorkerCall(ws);
  if (failedAt) {
    const failed = spokenWhen(failedAt, now);
    parts.push({ ar: `آخر مكالمة لـ${name.ar} ما نجحت ${failed.ar}.`, en: `The last call to ${name.en} did not go through ${failed.en}.` });
  }
  parts.push({ ar: "ما عندي معلومات جديدة عن العزبة.", en: "I have no new information about the ranch." });
  return { ar: parts.map((part) => part.ar).join(" "), en: parts.map((part) => part.en).join(" ") };
}

export function ownerSummaryText(ws: Workspace, report: FarmReport | null, now: Date): LocalizedText {
  return report ? reportSummary(ws, report, now) : noReportSummary(ws, now);
}
