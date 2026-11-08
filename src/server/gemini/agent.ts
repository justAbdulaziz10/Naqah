import type { InstructionInput } from "@/domain/actions";
import { dayKey, fromRiyadh, HOUR, riyadhParts } from "@/domain/clock";
import type { ReportDraft } from "@/domain/findings";
import { ownerBriefing } from "@/domain/findings";
import { isHerdCount } from "@/domain/herd";
import { applicableQuestions, openTaskTickets, overdueScheduledTasks, reportDoneThisPeriod, routeWorkerInboundCall, taskTicketsEnabled } from "@/domain/rules";
import type { HealthStatus, Locale, ResourceKind, WorkerLanguage, Workspace } from "@/domain/types";
import { voiceStep, type VoiceEvent } from "@/server/voice/contract";
import { GeminiError, type GeminiClient, type GeminiFailure } from "./client";
import { GEMINI_TEXT_LANGUAGES } from "./languages";
import { parseInterpretation, type Interpretation, type ParsedFact, type ParsedInstruction } from "./schema";

export type AgentScenario = "worker_report" | "worker_callback" | "owner_notification" | "owner_inquiry";
type Stage = "collect" | "confirm_facts" | "contradiction" | "camel" | "summary" | "callback" | "instructions" | "inquiry" | "closed";

export interface DraftInstruction extends InstructionInput {
  workerText: string;
}

export interface AgentState {
  scenario: AgentScenario;
  stage: Stage;
  language: WorkerLanguage | Locale;
  draft: ReportDraft;
  asked: string[];
  clarify: Record<string, number>;
  pendingFacts: ParsedFact[];
  camelCandidate: { name: string; camelId: string; health: HealthStatus; note: string | null } | null;
  instructions: DraftInstruction[];
  focus: string | null;
  /** Answered NAQAH → worker report call this conversation belongs to. */
  reportCallId?: string;
  closed: boolean;
  outcome: "pending" | "saved" | "rejected" | "queued" | "unconfirmed" | "failed" | "uncertain" | "unchanged";
}

export interface AgentResult {
  workspace: Workspace;
  state: AgentState;
  say: string;
  /** The prompt that would be sent, when a model call was made. Never contains a phone number. */
  prompt?: string;
  failure?: GeminiFailure;
}

export type SaveResult =
  | { status: "saved" | "unchanged"; workspace: Workspace }
  | { status: "rejected"; workspace: Workspace; reason: string }
  | { status: "uncertain" };

export type SaveHandler = (workspace: Workspace, now: Date, event: VoiceEvent) => Promise<SaveResult>;

const INJECTION = /ignore (all |your |previous )?instructions|mark all tasks|create all tasks as completed/i;
const FALSE_CLAIM = /saved|notified|ticket created|task completed|calling him|calling her|تم حفظ|تم إنشاء|أبلغت/i;
const PREDICTION = /last until|how long|enough until|will it last|يكفي ل|حتى يوم/i;

const emptyDraft = (): ReportDraft => ({
  answers: [],
  camelUpdates: [],
  resourceUpdates: [],
  herdAccountedFor: null,
  taskConfirmations: [],
});

const speak = (language: AgentState["language"], en: string, ar: string) => (language === "ar" ? ar : en);

function tasksToAsk(ws: Workspace, now: Date) {
  if (!taskTicketsEnabled(ws)) return [];
  const overdue = new Set(overdueScheduledTasks(ws, now).map((task) => task.id));
  const seen = new Set<string>();
  return openTaskTickets(ws).filter((task) => {
    if (seen.has(task.id)) return false;
    if (task.scheduledFor !== null && !overdue.has(task.id)) return false;
    seen.add(task.id);
    return true;
  });
}

function questions(ws: Workspace, now: Date, scenario: AgentScenario = "worker_report") {
  const items: { id: string; en: string; ar: string }[] = [];
  if (scenario === "worker_callback") {
    for (const task of tasksToAsk(ws, now)) items.push({ id: `task:${task.id}`, en: `Did you finish: ${task.instruction}`, ar: `هل خلصت: ${task.instruction}` });
    return items;
  }
  for (const question of applicableQuestions(ws)) {
    if (question.id === "herd_count" && !isHerdCount(ws.settings.herdCount) && ws.camels.length === 0) continue;
    items.push({ id: question.id, en: question.text.en, ar: question.text.ar });
  }
  for (const question of ws.settings.customQuestions) items.push({ id: question.id, en: question.text, ar: question.text });
  if (scenario !== "owner_inquiry" && scenario !== "owner_notification") {
    for (const task of tasksToAsk(ws, now)) items.push({ id: `task:${task.id}`, en: `Did you finish: ${task.instruction}`, ar: `هل خلصت: ${task.instruction}` });
  }
  return items;
}

function nextQuestion(ws: Workspace, now: Date, state: AgentState) {
  return questions(ws, now, state.scenario).find((item) => !state.asked.includes(item.id)) ?? null;
}

function fold(value: string) {
  return value.trim().toLowerCase().replace(/[\u064B-\u065F]/g, "").replace(/ة/g, "ه").replace(/[أإآ]/g, "ا").replace(/[^a-z0-9\u0600-\u06FF]+/g, "");
}

function sameCamel(registered: string, spoken: string) {
  const left = fold(registered);
  const right = fold(spoken);
  if (!left || !right) return false;
  if (left === right) return true;
  const variants = ["wadha", "wadhah", "wadhha", "وضحى", "وضحه", "وضحة"].map(fold);
  return variants.includes(left) && variants.includes(right);
}

function matchCamels(ws: Workspace, spoken: string) {
  return ws.camels.filter((camel) => sameCamel(camel.name, spoken));
}

function allowedQuestion(ws: Workspace, now: Date, id: string | null) {
  return id !== null && questions(ws, now).some((item) => item.id === id) || (id?.startsWith("task:") ?? false);
}

function numbersIn(text: string) {
  return text.match(/\d+/g) ?? [];
}

function scheduleOf(now: Date, item: ParsedInstruction): string | null | "past" | "unclear" {
  if (!item.schedule || item.schedule === "any_time") return null;
  let day = item.date;
  if (item.schedule === "later_today") day = dayKey(now);
  if (item.schedule === "tomorrow") day = dayKey(new Date(now.getTime() + 24 * HOUR));
  if (!day || !item.time || !/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^\d{2}:\d{2}$/.test(item.time)) return "unclear";
  const [year, month, date] = day.split("-").map(Number);
  const [hours, minutes] = item.time.split(":").map(Number);
  const parts = riyadhParts(fromRiyadh(year, month, date, 0, 0));
  if (parts.year !== year || parts.month !== month || parts.day !== date) return "unclear";
  const instant = fromRiyadh(year, month, date, hours, minutes);
  if (Number.isNaN(instant.getTime()) || instant.getTime() < now.getTime()) return "past";
  return instant.toISOString();
}

function baseState(scenario: AgentScenario, language: AgentState["language"]): AgentState {
  return {
    scenario,
    stage: "collect",
    language,
    draft: emptyDraft(),
    asked: [],
    clarify: {},
    pendingFacts: [],
    camelCandidate: null,
    instructions: [],
    focus: null,
    closed: false,
    outcome: "pending",
  };
}

function result(workspace: Workspace, state: AgentState, say: string, prompt?: string): AgentResult {
  return { workspace, state, say, ...(prompt ? { prompt } : {}) };
}

function fail(workspace: Workspace, state: AgentState): AgentResult {
  return result(workspace, { ...state, stage: "closed", closed: true, outcome: "failed" }, speak(state.language,
    "Sorry, I could not continue this call. Nothing new was saved.",
    "معليش، ما قدرت أكمل المكالمة. ما انحفظ شيء جديد.",
  ));
}

async function commit(workspace: Workspace, now: Date, event: VoiceEvent, save?: SaveHandler): Promise<SaveResult> {
  const handler = save ?? (async (current, at, item) => {
    const step = voiceStep(current, at, item);
    if (step.result.status === "rejected") return { status: "rejected" as const, workspace: step.ws, reason: step.result.reason };
    if (step.result.status === "unchanged") return { status: "unchanged" as const, workspace: step.ws };
    return { status: "saved" as const, workspace: step.ws };
  });
  try {
    return await handler(workspace, now, event);
  } catch {
    return { status: "uncertain" };
  }
}

function eventBase(eventId: string): Pick<VoiceEvent, "version" | "eventId" | "providerCallId"> {
  return { version: 1, eventId, providerCallId: "agent" };
}

function savedSnapshot(ws: Workspace) {
  const resources = ws.resources
    .filter((item) => item.present)
    .map((item) => `${item.kind}:${item.quantity ?? "-"}/${item.level}`)
    .join(", ");
  const camels = ws.camels.map((camel) => `${camel.name}:${camel.health}`).join(", ");
  return `Saved resources: ${resources || "none"}. Saved camels: ${camels || "none"}. Last update: ${ws.lastUpdateAt ?? "none"}.`;
}

function promptFor(ws: Workspace, now: Date, state: AgentState, transcript: string) {
  const tasks = tasksToAsk(ws, now).map((task, index) => `T${index + 1}: ${task.instruction}`);
  const asked = questions(ws, now, state.scenario).map((item) => item.id).join(", ");
  return [
    "You are NAQAH's automated farm assistant. Return one JSON object matching the response schema.",
    `Reply language: ${state.language}. Text languages: ${GEMINI_TEXT_LANGUAGES.join(",")}.`,
    "Extract every fact the speaker stated. One facts entry each. Omit anything not said.",
    "A bag or tank amount is quantity, not a level. تمام, fine, plenty, and sufficient are level good.",
    "ما أدري or I don't know is intent unknown, or a fact with unknown true.",
    "A changed amount is intent correction and replaces only that fact.",
    "herd_count is the number of camels the worker counted. Put it in herdCount. It does not change the owner's official count.",
    "A camel name must be one the speaker said. Use the registered spelling when it matches. Never invent a camel or a task id.",
    "taskDone is true only when the speaker explicitly finishes that T number. Unknown is not done.",
    "Set confirmation only when the stage is waiting for yes or no and the utterance is that answer. Otherwise omit it.",
    "On stage instructions, return one instructions entry per owner request and leave facts empty.",
    "On stage inquiry, answer only from the saved snapshot and return no instructions.",
    "Do not claim anything was saved, notified, or completed.",
    `Stage: ${state.stage}. Focus: ${state.focus ?? "none"}.`,
    `Questions: ${asked}.`,
    `Camels: ${ws.camels.map((camel) => camel.name).join(", ") || "none"}.`,
    `Open tasks: ${tasks.join(" | ") || "none"}.`,
    `Known resources: ${ws.resources.filter((item) => item.present).map((item) => item.kind).join(", ")}.`,
    savedSnapshot(ws),
    `Utterance: ${transcript.slice(0, 800)}`,
  ].join("\n");
}

function safeModelReply(state: AgentState, reply: string) {
  if ((state.language === "ar" || state.language === "en") || !reply || FALSE_CLAIM.test(reply)) return null;
  return reply;
}

function askNext(ws: Workspace, now: Date, state: AgentState, prefix = ""): AgentResult {
  const question = nextQuestion(ws, now, state);
  if (!question) {
    if (state.scenario === "worker_callback") {
      return result(ws, { ...state, stage: "closed", closed: true, outcome: state.outcome === "pending" ? "saved" : state.outcome }, prefix + speak(state.language,
        "This call did not create a farm update.",
        "هذه المكالمة لم تنشئ تحديثاً للمزرعة.",
      ));
    }
    const summary = summarize(ws, state);
    return result(ws, { ...state, stage: "summary", focus: "summary" }, prefix + speak(state.language,
      `Here is the summary: ${summary}. Confirm and save this update?`,
      `هذا ملخص التحديث: ${summary}. أحفظه؟`,
    ));
  }
  return result(ws, { ...state, stage: "collect", focus: question.id }, prefix + speak(state.language, question.en, question.ar));
}

function summarize(ws: Workspace, state: AgentState) {
  const parts = state.draft.answers.map((answer) => `${answer.questionId}: ${answer.answer} (${answer.certainty})`);
  for (const camel of state.draft.camelUpdates) {
    const name = ws.camels.find((item) => item.id === camel.camelId)?.name ?? "unspecified";
    parts.push(`${name}: ${camel.health}`);
  }
  for (const resource of state.draft.resourceUpdates) {
    parts.push(`${resource.kind}: ${resource.level}${resource.quantity ? ` ${resource.quantity}` : ""}`);
  }
  for (const task of state.draft.taskConfirmations) {
    const instruction = ws.taskTickets.find((item) => item.id === task.taskId)?.instruction ?? task.taskId;
    parts.push(`${instruction}: ${task.done ? "finished" : "still open"}`);
  }
  return parts.length ? parts.join("; ") : "no additional farm facts";
}

function markAsked(state: AgentState, id: string) {
  if (!state.asked.includes(id)) state.asked.push(id);
}

function resourceOf(fact: ParsedFact): ResourceKind | null {
  if (fact.resource) return fact.resource;
  const id = fact.questionId ?? "";
  return (["feed", "water", "fences", "shelter", "medicine"] as const).find((kind) => id.startsWith(kind)) ?? null;
}

function applyHeldFacts(ws: Workspace, now: Date, state: AgentState) {
  for (const fact of state.pendingFacts) {
    if (fact.camelName) continue;
    applyFact(ws, now, state, fact);
  }
  state.pendingFacts = [];
}

function applyFact(ws: Workspace, now: Date, state: AgentState, fact: ParsedFact) {
  const resource = resourceOf(fact);
  if (fact.taskIndex && fact.explicit && fact.taskDone !== null && !fact.unknown) {
    const task = tasksToAsk(ws, now)[fact.taskIndex - 1];
    if (!task) return;
    const index = state.draft.taskConfirmations.findIndex((item) => item.taskId === task.id);
    const row = { taskId: task.id, done: fact.taskDone };
    if (index >= 0) state.draft.taskConfirmations[index] = row;
    else state.draft.taskConfirmations.push(row);
    markAsked(state, `task:${task.id}`);
    return;
  }
  const questionId = allowedQuestion(ws, now, fact.questionId) ? fact.questionId! : state.focus;
  if (!questionId || questionId.startsWith("task:")) return;
  if (fact.unknown) {
    state.draft.answers.push({
      questionId,
      question: { en: questionId, ar: questionId },
      answer: "I don't know",
      certainty: "unknown",
      followUp: false,
    });
    markAsked(state, questionId);
    return;
  }
  if (resource) {
    const current = state.draft.resourceUpdates.find((item) => item.kind === resource);
    const level = fact.level ?? current?.level ?? "unknown";
    const quantity = fact.quantity ?? current?.quantity ?? null;
    const update = { kind: resource, level, quantity, note: fact.text || null, certainty: "reported" as const };
    if (current) Object.assign(current, update);
    else state.draft.resourceUpdates.push(update);
    const catalogId = questions(ws, now, state.scenario).find((item) => item.id.includes(resource))?.id ?? `${resource}_level`;
    const resourceQuestion = fact.questionId && allowedQuestion(ws, now, fact.questionId) && fact.questionId.includes(resource) ? fact.questionId : catalogId;
    state.draft.answers = state.draft.answers.filter((answer) => answer.questionId !== resourceQuestion && answer.questionId !== catalogId);
    state.draft.answers.push({
      questionId: resourceQuestion,
      question: { en: resource, ar: resource },
      answer: [level, quantity].filter(Boolean).join(" "),
      certainty: "reported",
      followUp: false,
    });
    markAsked(state, resourceQuestion);
    markAsked(state, catalogId);
    return;
  }
  if (questionId === "herd_count") {
    const count = isHerdCount(fact.herdCount) ? fact.herdCount : null;
    const official = isHerdCount(ws.settings.herdCount) ? ws.settings.herdCount : ws.camels.length || null;
    state.draft.herdCount = fact.unknown ? null : count;
    state.draft.herdAccountedFor = fact.unknown || count === null || official === null ? null : count >= official;
  }
  state.draft.answers = state.draft.answers.filter((answer) => answer.questionId !== questionId);
  state.draft.answers.push({
    questionId,
    question: { en: questionId, ar: questionId },
    answer: fact.text || "reported",
    certainty: "reported",
    followUp: false,
  });
  markAsked(state, questionId);
}

function applyCamel(state: AgentState, camel: NonNullable<AgentState["camelCandidate"]>) {
  const index = state.draft.camelUpdates.findIndex((item) => item.camelId === camel.camelId);
  const row = { camelId: camel.camelId, health: camel.health, note: camel.note, certainty: "reported" as const };
  if (index >= 0) state.draft.camelUpdates[index] = row;
  else state.draft.camelUpdates.push(row);
  if (camel.health === "sick" || camel.health === "watch") {
    state.draft.answers = state.draft.answers.filter((answer) => answer.questionId !== "herd_health");
    state.draft.answers.push({
      questionId: "herd_health",
      question: { en: "herd_health", ar: "herd_health" },
      answer: `${camel.name} is ${camel.health}`,
      certainty: "reported",
      followUp: false,
    });
  }
  markAsked(state, "herd_health");
}

function spokenConfirmation(transcript: string): "yes" | "no" | null {
  const text = transcript.trim().replace(/[.!?؟]/g, "").replace(/\s+/g, " ");
  if (/^(yes|yeah|yep|ok|okay|correct|نعم|اي|إي|ايوه|أيوه|ايه|صحيح)$/i.test(text)) return "yes";
  if (/^(no|nope|لا|لأ|لاء)$/i.test(text)) return "no";
  return null;
}

function spokenUnknown(transcript: string) {
  const text = transcript.trim().replace(/[.!?؟]/g, "");
  return /^(ما أدري|ما ادري|مدري|I don't know|I dont know)$/i.test(text);
}

function awaitingConfirmation(state: AgentState) {
  return state.stage === "camel" || state.stage === "confirm_facts" || state.stage === "contradiction" || state.stage === "summary" || state.stage === "callback" || (state.scenario === "owner_notification" && state.focus === "approval");
}

function mergeFacts(current: ParsedFact[], updates: ParsedFact[]) {
  const pending = [...current];
  for (const update of updates) {
    const index = pending.findIndex((fact) =>
      (update.resource && fact.resource === update.resource) ||
      (update.questionId && fact.questionId === update.questionId) ||
      (update.camelName && fact.camelName));
    if (index >= 0) pending[index] = update;
    else pending.push(update);
  }
  return pending;
}

function factsNeedHold(facts: ParsedFact[]) {
  return facts.length > 1 || facts.some((fact) => fact.camelName || fact.allOthersHealthy);
}

function contradictory(facts: ParsedFact[]) {
  const sick = facts.some((fact) => fact.health === "sick" || fact.health === "watch");
  const allWell = facts.some((fact) => fact.allOthersHealthy || /all (camels|healthy)|كل الحلال/.test(fact.text));
  return sick && allWell;
}

export function openAgentCall(workspace: Workspace, now: Date, scenario: AgentScenario, locale: Locale = "ar", reportCallId?: string): AgentResult {
  if (scenario === "owner_inquiry") {
    const state = baseState(scenario, locale);
    const step = voiceStep(workspace, now, { ...eventBase(`agent:inquiry:${dayKey(now)}`), type: "owner_inquiry" });
    if (step.result.status === "rejected") {
      return result(step.ws, { ...state, stage: "closed", closed: true, outcome: "rejected" }, speak(locale,
        "The Basic plan’s owner call has already been used this week. The latest details are on the website.",
        "مكالمة المالك لهذا الأسبوع استُخدمت. آخر التفاصيل في الموقع.",
      ));
    }
    return result(step.ws, { ...state, stage: "inquiry" }, speak(locale,
      "This is NAQAH, an automated assistant. What would you like to know from the last saved update?",
      "أنا ناقة، مساعد آلي. وش تبي تعرف من آخر تحديث محفوظ؟",
    ));
  }
  if (scenario === "owner_notification") {
    const findings = workspace.reports.at(-1)?.findings ?? [];
    const briefing = ownerBriefing(findings);
    const state = baseState(scenario, locale);
    return result(workspace, { ...state, stage: "instructions" }, `${briefing[locale]} ${speak(locale,
      "You can give instructions for the worker, then approve the final list.",
      "تقدر تعطي تعليمات للعامل، ثم تعتمد القائمة النهائية.",
    )}`);
  }

  const route = routeWorkerInboundCall(workspace, now);
  const language = workspace.settings.worker.language;
  const state = baseState(route.kind === "callback" ? "worker_callback" : scenario, language);
  if (reportCallId) {
    const run = workspace.reportCalls?.find((item) => item.id === reportCallId);
    if (!run || run.state !== "answered") {
      return result(workspace, { ...state, stage: "closed", closed: true, outcome: "rejected" }, speak(language,
        "This report call is no longer active.",
        "مكالمة التقرير هذه انتهت.",
      ));
    }
    if (reportDoneThisPeriod(workspace, now)) {
      const done = workspace.settings.plan === "basic"
        ? ["We have already received this week’s update.", "وصلنا تحديث هذا الأسبوع."]
        : ["We have already received today’s update.", "وصلنا تحديث اليوم."];
      return result(workspace, { ...state, stage: "closed", closed: true, outcome: "rejected" }, speak(language, done[0], done[1]));
    }
    return askNext(workspace, now, { ...state, reportCallId }, speak(language, "This is NAQAH, an automated assistant, calling for the farm report. ", "أنا ناقة، مساعد آلي، أتصل عشان تقرير العزبة. "));
  }
  if (route.kind === "callback") {
    const messages = workspace.noAnswerTickets.filter((ticket) => ticket.status === "open").map((ticket) => ticket.message).join(" ");
    return result(workspace, { ...state, stage: "callback" }, speak(language,
      `This is NAQAH, an automated assistant. You missed this message: ${messages} This call is not a farm update.`,
      `أنا ناقة، مساعد آلي. فاتتك هذه الرسالة: ${messages} هذه المكالمة ليست تحديثاً للمزرعة.`,
    ));
  }
  if (route.kind === "rejected") {
    const step = voiceStep(workspace, now, { ...eventBase(`agent:report-refused:${dayKey(now)}`), type: "worker_report", draft: emptyDraft(), refusedAtStart: true });
    const reason = route.reason === "weekly_done"
      ? ["We have already received this week’s update.", "وصلنا تحديث هذا الأسبوع."]
      : route.reason === "daily_done"
        ? ["We have already received today’s update.", "وصلنا تحديث اليوم."]
        : ["NAQAH calls at the scheduled report time. This call is not the report.", "ناقة تتصل في موعد التقرير. هذه المكالمة ليست التقرير."];
    return result(step.ws, { ...state, stage: "closed", closed: true, outcome: "rejected" }, speak(language, reason[0], reason[1]));
  }
  const opened = askNext(workspace, now, state, speak(language, "This is NAQAH, an automated assistant. ", "أنا ناقة، مساعد آلي. "));
  return opened;
}

async function interpret(client: GeminiClient, prompt: string): Promise<Interpretation> {
  let raw: string;
  try {
    raw = await client.generate(prompt);
  } catch (error) {
    throw error instanceof GeminiError ? error : new GeminiError("unavailable");
  }
  try {
    return parseInterpretation(raw);
  } catch {
    throw new GeminiError("invalid");
  }
}

function inquiryAnswer(ws: Workspace, transcript: string, modelReply: string, language: AgentState["language"]) {
  const feed = ws.resources.find((item) => item.kind === "feed");
  const when = ws.lastUpdateAt ?? ws.reports.at(-1)?.at ?? null;
  const knownNumbers = [feed?.quantity ?? "", ...ws.resources.map((item) => item.quantity ?? "")].join(" ");
  const invented = (modelReply.match(/\d+/g) ?? []).some((value) => value && !knownNumbers.includes(value));
  if (PREDICTION.test(transcript) || invented) {
    return speak(language,
      `I cannot determine that. The last reported feed was ${feed?.quantity ?? "not recorded"}${when ? ` at ${when}` : ""}. There is no reliable consumption estimate.`,
      `ما أقدر أحدد ذلك. آخر كمية علف مذكورة: ${feed?.quantity ?? "غير مسجلة"}${when ? ` في ${when}` : ""}. ما فيه تقدير استهلاك موثوق.`,
    );
  }
  const lines = ws.resources.filter((item) => item.present).map((item) => `${item.kind}: ${item.quantity ?? item.level}`);
  return speak(language,
    `Last saved update${when ? ` at ${when}` : ""}: ${lines.join(", ") || "nothing recorded"}. I will not add anything that was not reported.`,
    `آخر تحديث محفوظ${when ? ` في ${when}` : ""}: ${lines.join("، ") || "لا يوجد"}. ما أضيف شيئاً لم يُذكر.`,
  );
}

export async function agentTurn(
  workspace: Workspace,
  now: Date,
  state: AgentState,
  transcript: string,
  client: GeminiClient,
  save?: SaveHandler,
): Promise<AgentResult> {
  if (state.closed) return result(workspace, state, speak(state.language, "This call is finished.", "انتهت المكالمة."));
  const prompt = promptFor(workspace, now, state, transcript);
  const spoken = spokenConfirmation(transcript);
  let understood: Interpretation;
  if (spoken && awaitingConfirmation(state)) {
    understood = { intent: "confirm", facts: [], instructions: [], confirmation: spoken, reply: "" };
  } else if (spokenUnknown(transcript) && (state.stage === "collect" || state.focus?.startsWith("task:"))) {
    understood = { intent: "unknown", facts: [], instructions: [], confirmation: "unknown", reply: "" };
  } else {
    try {
      understood = await interpret(client, prompt);
    } catch (error) {
      const failure = error instanceof GeminiError ? error : new GeminiError("unavailable");
      return { ...fail(workspace, state), prompt, failure: failure.code };
    }
  }
  const injected = INJECTION.test(transcript) || understood.intent === "unauthorized";
  if (injected) {
    return { ...askNext(workspace, now, state, speak(state.language, "I can only record what you report. ", "أسجل ما تقوله فقط. ")), prompt };
  }

  if (state.stage === "inquiry") {
    if (understood.instructions.length || understood.intent === "instruction") {
      return result(workspace, state, speak(state.language,
        "Instructions are taken on the update call, not on this inquiry.",
        "التعليمات تُؤخذ في مكالمة التحديث، وليس في هذا الاستفسار.",
      ), prompt);
    }
    return result(workspace, { ...state, stage: "closed", closed: true, outcome: "unchanged" }, inquiryAnswer(workspace, transcript, understood.reply, state.language), prompt);
  }

  if (state.stage === "callback") {
    if (understood.confirmation !== "yes") {
      const count = (state.clarify.callback ?? 0) + 1;
      if (count > 2) return result(workspace, { ...state, stage: "closed", closed: true, outcome: "unconfirmed" }, speak(state.language, "I did not get a clear confirmation, so I changed nothing.", "ما وصلني تأكيد واضح، وما غيّرت شيئاً."), prompt);
      return result(workspace, { ...state, clarify: { ...state.clarify, callback: count } }, speak(state.language, "Please say clearly that you received the message.", "قل بوضوح إن الرسالة وصلتك."), prompt);
    }
    const saved = await commit(workspace, now, { ...eventBase(`agent:callback:${dayKey(now)}`), type: "worker_callback" }, save);
    if (saved.status === "uncertain") return result(workspace, { ...state, outcome: "uncertain" }, speak(state.language, "I could not confirm whether the callback was recorded.", "ما قدرت أتأكد هل سُجل الاتصال."), prompt);
    const next = saved.status === "rejected" ? workspace : saved.workspace;
    const followed = askNext(next, now, { ...state, scenario: "worker_callback", clarify: {} }, speak(state.language, "The missed message is recorded. ", "سُجلت الرسالة الفائتة. "));
    return { ...followed, prompt };
  }

  if (state.stage === "camel" && state.camelCandidate) {
    if (understood.confirmation === "yes") {
      const draft = structuredClone(state.draft);
      const next = { ...state, draft, camelCandidate: null };
      applyCamel(next, state.camelCandidate);
      applyHeldFacts(workspace, now, next);
      return { ...askNext(workspace, now, next), prompt };
    }
    if (understood.confirmation === "no") {
      const draft = structuredClone(state.draft);
      draft.answers.push({
        questionId: "herd_health",
        question: { en: "herd_health", ar: "herd_health" },
        answer: "A camel needs attention (unspecified)",
        certainty: "reported",
        followUp: false,
      });
      const next = { ...state, draft, camelCandidate: null };
      markAsked(next, "herd_health");
      applyHeldFacts(workspace, now, next);
      return { ...askNext(workspace, now, next), prompt };
    }
    if (understood.intent === "correction" && understood.facts.length) {
      return result(workspace, { ...state, pendingFacts: mergeFacts(state.pendingFacts, understood.facts) }, speak(state.language,
        `I heard ${understood.facts.map((fact) => fact.text || fact.quantity || fact.resource).filter(Boolean).join(", ")}. Is that right?`,
        `سمعت: ${understood.facts.map((fact) => fact.text || fact.quantity || fact.resource).filter(Boolean).join("، ")}. صحيح؟`,
      ), prompt);
    }
  }

  if (state.stage === "contradiction" || state.stage === "confirm_facts") {
    if (understood.intent === "correction" && understood.facts.length) {
      const pendingFacts = mergeFacts(state.pendingFacts, understood.facts);
      return result(workspace, { ...state, stage: "confirm_facts", pendingFacts }, speak(state.language,
        `I heard ${understood.facts.map((fact) => fact.text || fact.quantity || fact.resource).filter(Boolean).join(", ")}. Is that right?`,
        `سمعت: ${understood.facts.map((fact) => fact.text || fact.quantity || fact.resource).filter(Boolean).join("، ")}. صحيح؟`,
      ), prompt);
    }
    if (understood.confirmation !== "yes") {
      return result(workspace, { ...state, stage: "collect", pendingFacts: [] }, speak(state.language, "Let's leave that unconfirmed. Please say it again.", "نترك هذا بدون تأكيد. أعده لو سمحت."), prompt);
    }
    const draft = structuredClone(state.draft);
    const next: AgentState = { ...state, draft, stage: "collect", pendingFacts: [] };
    const sick = state.pendingFacts.find((fact) => fact.camelName && (fact.health === "sick" || fact.health === "watch"));
    if (state.stage === "contradiction" && sick) {
      const matches = matchCamels(workspace, sick.camelName!);
      if (matches.length === 1) {
        next.camelCandidate = { name: matches[0].name, camelId: matches[0].id, health: sick.health!, note: sick.text || null };
        next.stage = "camel";
        return result(workspace, next, speak(state.language, `Do you mean ${matches[0].name}?`, `تقصد ${matches[0].name}؟`), prompt);
      }
    }
    for (const fact of state.pendingFacts) applyFact(workspace, now, next, fact);
    const persisted = await persistCallbackTasks(workspace, now, state, next, save);
    return { ...askNext(persisted, now, next), prompt };
  }

  if (state.stage === "summary") {
    if (understood.confirmation !== "yes") {
      const count = (state.clarify.summary ?? 0) + 1;
      if (understood.confirmation === "no") return { ...askNext(workspace, now, { ...state, stage: "collect", focus: null }), prompt };
      if (count > 2) return result(workspace, { ...state, stage: "closed", closed: true, outcome: "unconfirmed" }, speak(state.language, "I did not save the update, because it was not confirmed.", "ما حفظت التحديث، لأنه ما تأكد."), prompt);
      return result(workspace, { ...state, clarify: { ...state.clarify, summary: count } }, speak(state.language, "Please confirm the summary with a clear yes, or say what to change.", "أكد الملخص بنعم واضحة، أو قل ما الذي يتغير."), prompt);
    }
    const saved = await commit(workspace, now, {
      ...eventBase(`agent:report:${state.reportCallId ?? dayKey(now)}`),
      type: "worker_report",
      draft: state.draft,
      ...(state.reportCallId ? { reportCallId: state.reportCallId } : {}),
    }, save);
    if (saved.status === "uncertain") return result(workspace, { ...state, outcome: "uncertain" }, speak(state.language, "I could not confirm whether the update was saved.", "ما قدرت أتأكد هل حُفظ التحديث."), prompt);
    if (saved.status === "rejected") return result(saved.workspace, { ...state, stage: "closed", closed: true, outcome: "rejected" }, speak(state.language, "The update was not saved.", "ما انحفظ التحديث."), prompt);
    return result(saved.workspace, { ...state, stage: "closed", closed: true, outcome: saved.status }, speak(state.language, "Saved, thank you. The update is ready for the owner. The call to him has not started.", "تم حفظ التحديث، شكراً لك. التحديث جاهز للمالك، ومكالمته لم تبدأ بعد."), prompt);
  }

  if (state.scenario === "owner_notification") {
    return instructionTurn(workspace, now, state, understood, prompt, save);
  }

  if (understood.intent === "unclear" || (!understood.facts.length && understood.intent !== "unknown" && understood.confirmation === null)) {
    const key = state.focus ?? "turn";
    const count = (state.clarify[key] ?? 0) + 1;
    if (count > 2 && state.focus && !state.focus.startsWith("task:")) {
      const next = structuredClone(state);
      applyFact(workspace, now, next, { questionId: state.focus, resource: null, level: null, quantity: null, camelName: null, health: null, taskIndex: null, taskDone: null, explicit: false, unknown: true, text: "", allOthersHealthy: false, herdCount: null });
      next.clarify = { ...state.clarify, [key]: count };
      return { ...askNext(workspace, now, next), prompt };
    }
    return result(workspace, { ...state, clarify: { ...state.clarify, [key]: count } }, speak(state.language, "I didn't catch that. Please say it again.", "ما فهمت. أعد الإجابة."), prompt);
  }

  if (understood.intent === "unknown" || understood.confirmation === "unknown") {
    if (state.focus?.startsWith("task:")) {
      const next = { ...state, asked: state.asked.includes(state.focus) ? state.asked : [...state.asked, state.focus] };
      return { ...askNext(workspace, now, next), prompt };
    }
    const next = structuredClone(state);
    if (state.focus) applyFact(workspace, now, next, { questionId: state.focus, resource: null, level: null, quantity: null, camelName: null, health: null, taskIndex: null, taskDone: null, explicit: false, unknown: true, text: "I don't know", allOthersHealthy: false, herdCount: null });
    return { ...askNext(workspace, now, next), prompt };
  }

  const facts = understood.facts.filter((fact) => !(fact.taskDone === true && !fact.explicit));
  if (contradictory(facts)) {
    return result(workspace, { ...state, stage: "contradiction", pendingFacts: facts }, speak(state.language,
      "Do you mean the other camels are healthy, and one camel is sick?",
      "تقصد أن بقية الحلال بخير، وناقة واحدة مريضة؟",
    ), prompt);
  }
  const named = facts.find((fact) => fact.camelName);
  if (named?.camelName) {
    const matches = matchCamels(workspace, named.camelName);
    if (matches.length > 1) {
      return result(workspace, state, speak(state.language, "Which registered camel did you mean?", "أي ناقة مسجلة تقصد؟"), prompt);
    }
    if (matches.length !== 1) {
      const draft = structuredClone(state.draft);
      draft.answers.push({
        questionId: "herd_health",
        question: { en: "herd_health", ar: "herd_health" },
        answer: "A camel needs attention (unspecified)",
        certainty: "reported",
        followUp: false,
      });
      const next = { ...state, draft };
      markAsked(next, "herd_health");
      return { ...askNext(workspace, now, next, speak(state.language, "I could not match that camel, so I left the name unset. ", "ما تطابق الاسم مع ناقة مسجلة، وتركته بدون اسم. ")), prompt };
    }
    return result(workspace, {
      ...state,
      stage: "camel",
      pendingFacts: facts,
      camelCandidate: { name: matches[0].name, camelId: matches[0].id, health: named.health ?? "watch", note: named.text || null },
    }, speak(state.language, `Did you mean ${matches[0].name}?`, `تقصد ${matches[0].name}؟`), prompt);
  }
  if (understood.intent === "correction" || factsNeedHold(facts)) {
    return result(workspace, { ...state, stage: "confirm_facts", pendingFacts: facts }, speak(state.language,
      `I heard ${facts.map((fact) => fact.text || fact.quantity || fact.resource).filter(Boolean).join(", ")}. Is that right?`,
      `سمعت: ${facts.map((fact) => fact.text || fact.quantity || fact.resource).filter(Boolean).join("، ")}. صحيح؟`,
    ), prompt);
  }
  const next = structuredClone(state);
  for (const fact of facts) applyFact(workspace, now, next, fact);
  const persisted = await persistCallbackTasks(workspace, now, state, next, save);
  const reply = safeModelReply(state, understood.reply);
  const asked = askNext(persisted, now, next);
  return reply ? { ...asked, say: reply, prompt } : { ...asked, prompt };
}

async function instructionTurn(
  workspace: Workspace,
  now: Date,
  state: AgentState,
  understood: Interpretation,
  prompt: string,
  save?: SaveHandler,
): Promise<AgentResult> {
  let instructions = [...state.instructions];
  for (const item of understood.instructions) {
    if (item.remove) {
      instructions = instructions.filter((current) => !current.message.includes(item.text) && !item.text.includes(current.message));
      continue;
    }
    const when = scheduleOf(now, item);
    if (when === "past" || when === "unclear") {
      return result(workspace, { ...state, instructions }, speak(state.language, "That date or time is not usable. Please give a future date and time.", "هذا التاريخ أو الوقت غير مناسب. أعط تاريخاً ووقتاً في المستقبل."), prompt);
    }
    instructions.push({ message: item.text, actionable: item.actionable, scheduledFor: when, workerText: item.workerText });
  }
  if (understood.confirmation === "yes" && instructions.length && (state.focus === "approval" || understood.instructions.length === 0)) {
    for (const item of instructions) {
      if (item.workerText && numbersIn(item.message).some((value) => !item.workerText.includes(value))) {
        return result(workspace, { ...state, instructions }, speak(state.language, "The translation dropped a number. Please confirm the exact amount before I queue it.", "الترجمة أسقطت رقماً. أكد الكمية قبل أن أضعها في الانتظار."), prompt);
      }
    }
    const items = instructions.map((item) => ({ message: item.message, actionable: item.actionable, scheduledFor: item.scheduledFor }));
    const delivery = instructions.map((item) => item.workerText || item.message).join("\n");
    const event: VoiceEvent = {
      ...eventBase(`agent:${items.map((item) => item.message).join("|").slice(0, 80)}`),
      type: "owner_instruction",
      message: delivery,
      actionable: items.some((item) => item.actionable),
      scheduledFor: null,
      items,
      deliveryMessage: delivery,
    };
    const saved = await commit(workspace, now, event, save);
    if (saved.status === "uncertain") return result(workspace, { ...state, outcome: "uncertain" }, speak(state.language, "I could not confirm whether the instructions were queued.", "ما قدرت أتأكد هل وُضعت التعليمات في الانتظار."), prompt);
    if (saved.status !== "saved" && saved.status !== "unchanged") return result(saved.workspace, { ...state, stage: "closed", closed: true, outcome: "rejected" }, speak(state.language, "The instructions were not queued.", "ما دخلت التعليمات في الانتظار."), prompt);
    const calls = saved.workspace.pendingWorkerCalls.filter((call) => call.purpose === "instruction" && call.batchId === event.eventId);
    return result(saved.workspace, { ...state, stage: "closed", closed: true, outcome: "queued" }, speak(state.language,
      `The instructions are queued for the worker in ${calls.length} call. The call has not started.`,
      `التعليمات في انتظار العامل ضمن مكالمة واحدة. المكالمة لم تبدأ.`,
    ), prompt);
  }

  if (!instructions.length) {
    return result(workspace, { ...state, instructions, focus: null }, speak(state.language, "There are no instructions waiting for approval.", "ما فيه تعليمات بانتظار الاعتماد."), prompt);
  }
  const list = instructions.map((item) => `${item.message}${item.scheduledFor ? ` (${item.scheduledFor})` : " (any time)"}`).join("; ");
  return result(workspace, { ...state, instructions, focus: "approval" }, speak(state.language,
    `Final list: ${list}. Approve these instructions?`,
    `القائمة النهائية: ${list}. تعتمد هذه التعليمات؟`,
  ), prompt);
}

async function persistCallbackTasks(
  workspace: Workspace,
  now: Date,
  before: AgentState,
  after: AgentState,
  save?: SaveHandler,
): Promise<Workspace> {
  if (after.scenario !== "worker_callback") return workspace;
  let current = workspace;
  for (const task of after.draft.taskConfirmations) {
    const previous = before.draft.taskConfirmations.find((item) => item.taskId === task.taskId);
    if (previous && previous.done === task.done) continue;
    const saved = await commit(current, now, {
      ...eventBase(`agent:task:${task.taskId}:${task.done}`),
      type: "task_confirmation",
      taskId: task.taskId,
      done: task.done,
      via: "worker_callback",
    }, save);
    if (saved.status !== "uncertain") current = saved.workspace;
  }
  return current;
}
