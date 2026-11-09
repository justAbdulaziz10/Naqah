import { CERTAINTY_LABELS, HEALTH_LABELS, RESOURCE_LABELS, levelLabel } from "../catalog";
import { recordOwnerInquiry, rejectOwnerInquiry } from "../actions";
import { openTaskTickets, routeOwnerInboundCall } from "../rules";
import type { LocalizedText, Workspace } from "../types";

import { copy, reply, blank, ask, say, commitTo, workerTurn, atRiyadh } from './shared';
import type { CallSession, EngineResult, AnswerInput } from './shared';

export function startOwnerInquiry(ws: Workspace, now: Date): EngineResult {
  const route = routeOwnerInboundCall(ws, now);
  const session = blank("owner_inquiry", now);
  if (route.kind === "rejected") {
    const text = copy(
      "I’m sorry, the Basic plan’s owner call has already been used this week. The latest details are available on the website.",
      "عذراً، مكالمة المالك الأسبوعية في الباقة الأساسية استُخدمت. تقدر تراجع آخر التفاصيل في الموقع.",
    );
    return { session: say(session, text, now, true), commit: commitTo(rejectOwnerInquiry(ws, now)) };
  }
  const next = {
    ...session,
    data: { ...session.data, inquiryTopics: [] },
  };
  return {
    session: askInquiryTopics(
      say(next, copy("Hello Abdullah. What would you like to check?", "هلا عبدالله. وش تحب تعرف عنه؟"), now),
      now,
    ),
    commit: commitTo(recordOwnerInquiry(ws, now, route.mode)),
  };
}

const TOPICS = [
  { value: "herd", label: copy("Herd status", "حالة الحلال") },
  { value: "resources", label: copy("Feed and water", "العلف والماء") },
  { value: "tasks", label: copy("Open tasks", "المهام المفتوحة") },
  { value: "last_update", label: copy("Last update", "آخر تحديث") },
];

function askInquiryTopics(session: CallSession, now: Date): CallSession {
  const selected = new Set(session.data.inquiryTopics ?? []);
  const choices = TOPICS
    .filter((topic) => !selected.has(topic.value))
    .map((topic) => ({ id: topic.value, value: topic.value, label: topic.label }));
  choices.push(reply("inquiry_done", "No, thanks", "لا، شكراً"));
  return ask(
    session,
    copy("What else would you like to know?", "وش بعد تحب تعرف؟"),
    now,
    "inquiry_topics",
    choices,
  );
}

function inquiryTopicAnswer(ws: Workspace, topic: string): LocalizedText {
  const reports = ws.reports;
  const latest = reports[reports.length - 1];
  if (topic === "herd") {
    const lines = ws.camels.slice(0, 4).map((camel) => {
      if (!camel.updatedAt) return { en: camel.name + ": no saved update.", ar: camel.name + ": ما فيه تحديث محفوظ." };
      const atEn = atRiyadh(new Date(camel.updatedAt), "en", true);
      const atAr = atRiyadh(new Date(camel.updatedAt), "ar", true);
      const health = HEALTH_LABELS[camel.health];
      const certainty = CERTAINTY_LABELS[camel.certainty];
      return {
        en: "As of " + atEn + ", " + camel.name + " was " + health.en.toLowerCase() + " (" + certainty.en.toLowerCase() + ").",
        ar: "حتى " + atAr + "، كانت " + camel.name + " " + health.ar + " (" + certainty.ar + ").",
      };
    });
    if (!lines.length && latest) {
      return copy(
        "As of " + atRiyadh(new Date(latest.at), "en", true) + ", Ahmed’s last report is stored on the website.",
        "في " + atRiyadh(new Date(latest.at), "ar", true) + " وصل آخر تقرير من أحمد، وتفاصيله محفوظة في الموقع.",
      );
    }
    if (!lines.length) return copy("No herd update has been saved yet.", "ما انحفظ تحديث للحلال إلى الآن.");
    return copy(lines.map((line) => line.en).join(" "), lines.map((line) => line.ar).join(" "));
  }
  if (topic === "resources") {
    const resources = ws.resources.filter((item) => item.present && (item.kind === "feed" || item.kind === "water"));
    if (!resources.length) return copy("Feed and water details are not set up.", "تفاصيل العلف والماء غير موجودة.");
    const lines = resources.map((item) => {
      if (!item.updatedAt) {
        return {
          en: RESOURCE_LABELS[item.kind].en + ": no report has been saved.",
          ar: RESOURCE_LABELS[item.kind].ar + ": ما وصل عنها تقرير.",
        };
      }
      const level = levelLabel(item.kind, item.level);
      const certainty = CERTAINTY_LABELS[item.certainty];
      const quantity = item.quantity ? " (" + item.quantity + ")" : "";
      return {
        en: "As of " + atRiyadh(new Date(item.updatedAt), "en", true) + ", " + RESOURCE_LABELS[item.kind].en + " was " + level.en.toLowerCase() + quantity + " (" + certainty.en.toLowerCase() + ").",
        ar: "حتى " + atRiyadh(new Date(item.updatedAt), "ar", true) + "، كان " + RESOURCE_LABELS[item.kind].ar + " " + level.ar + quantity + " (" + certainty.ar + ").",
      };
    });
    return copy(lines.map((line) => line.en).join(" "), lines.map((line) => line.ar).join(" "));
  }
  if (topic === "tasks") {
    const tasks = openTaskTickets(ws);
    if (!tasks.length) return copy("There are no open task tickets.", "ما فيه تذاكر مهام مفتوحة.");
    const lines = tasks.map((task) => ({
      en: "Opened " + atRiyadh(new Date(task.createdAt), "en", true) + ": " + task.instruction + " (still open).",
      ar: "فُتحت " + atRiyadh(new Date(task.createdAt), "ar", true) + ": " + task.instruction + " (ما زالت مفتوحة).",
    }));
    return copy(lines.map((line) => line.en).join(" "), lines.map((line) => line.ar).join(" "));
  }
  if (!latest) return copy("No farm update has been saved yet.", "ما انحفظ تحديث للعزبة إلى الآن.");
  const answers = latest.answers.slice(0, 3);
  const dateEn = atRiyadh(new Date(latest.at), "en", true);
  const dateAr = atRiyadh(new Date(latest.at), "ar", true);
  if (!answers.length) {
    return copy(
      "The last farm update was saved " + dateEn + ". Its full details are on the website.",
      "آخر تحديث للعزبة انحفظ " + dateAr + ". تفاصيله كاملة موجودة في الموقع.",
    );
  }
  const lines = answers.map((answer) => {
    const certainty = CERTAINTY_LABELS[answer.certainty];
    return {
      en: "Ahmed reported “" + (answer.answerText?.en ?? answer.answer) + "” (" + certainty.en.toLowerCase() + ").",
      ar: "أفاد أحمد: «" + (answer.answerText?.ar ?? answer.answer) + "» (" + certainty.ar + ").",
    };
  });
  return copy(
    "As of " + dateEn + ", " + lines.map((line) => line.en).join(" "),
    "بحسب تقرير " + dateAr + "، " + lines.map((line) => line.ar).join(" "),
  );
}

export function handleOwnerInquiry(session: CallSession, ws: Workspace, now: Date, input: AnswerInput): EngineResult {
  const current = workerTurn(session, input, now);
  if (session.step !== "inquiry_topics") return { session: current.session };
  if (current.value === "inquiry_done") {
    return {
      session: say(current.session, copy("Thank you. No tasks were created during this inquiry.", "شكراً لك. ما أنشأنا أي مهام خلال هذا الاستفسار."), now, true),
    };
  }
  const topic = TOPICS.find((item) => item.value === current.value);
  if (!topic) return { session: askInquiryTopics(current.session, now) };
  const topics = [...new Set([...(session.data.inquiryTopics ?? []), topic.value])];
  const answered = {
    ...current.session,
    data: { ...current.session.data, inquiryTopics: topics },
  };
  return {
    session: askInquiryTopics(
      say(answered, inquiryTopicAnswer(ws, topic.value), now),
      now,
    ),
  };
}
