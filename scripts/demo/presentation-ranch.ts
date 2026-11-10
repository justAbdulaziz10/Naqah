/**
 * LOCAL DEMO ONLY. A fictional Ultimate ranch for presentations: «عزبة الوسم (عرض تجريبي)».
 * Settings are inserted as rows; the history (reports, findings, calls, tasks, events) goes through
 * the same diff and apply_farm_changes the voice service uses, so the Dashboard reads real rows.
 * Every call summary starts with «محاكاة ·» and the ranch name says it is a demo.
 */
import { PREDEFINED_QUESTIONS } from "@/domain/catalog";
import { atRiyadhTime, HOUR, MINUTE } from "@/domain/clock";
import { uid } from "@/domain/id";
import { createDemoWorkspace } from "@/domain/seed";
import type { CallLog, Camel, FarmReport, HealthStatus, ReportAnswer, Workspace } from "@/domain/types";

export const DEMO_RANCH_NAME = "عزبة الوسم (عرض تجريبي)";
const SIM = "محاكاة · ";

const CAMELS: [string, string, "female" | "male", number, HealthStatus, string | null][] = [
  ["وضحة", "WS-01", "female", 9, "watch", "تأكل أقل من المعتاد من يومين"],
  ["مزون", "WS-02", "female", 6, "sick", "إسهال وحرارة من أمس، معزولة"],
  ["هيا", "WS-03", "female", 7, "watch", "عرج خفيف في الرجل اليمنى"],
  ["شيخة", "WS-04", "female", 11, "healthy", null],
  ["نورة", "WS-05", "female", 5, "healthy", null],
  ["الجازي", "WS-06", "female", 8, "healthy", null],
  ["غالية", "WS-07", "female", 4, "healthy", null],
  ["ريم", "WS-08", "female", 3, "healthy", null],
  ["صيتة", "WS-09", "female", 10, "unknown", null],
  ["عنود", "WS-10", "female", 6, "healthy", null],
  ["مها", "WS-11", "female", 5, "healthy", null],
  ["دانة", "WS-12", "female", 2, "healthy", null],
  ["شهلا", "WS-13", "female", 12, "healthy", null],
  ["وجد", "WS-14", "female", 4, "healthy", null],
  ["لولوة", "WS-15", "female", 7, "healthy", null],
  ["بشاير", "WS-16", "female", 3, "healthy", null],
  ["سمحة", "WS-17", "female", 9, "healthy", null],
  ["طرفة", "WS-18", "female", 6, "unknown", null],
  ["الشامخ", "WS-19", "male", 8, "healthy", null],
  ["مشهور", "WS-20", "male", 5, "healthy", null],
];

const q = (id: string) => PREDEFINED_QUESTIONS.find((item) => item.id === id)!;
const answer = (id: string, text: string, certainty: ReportAnswer["certainty"] = "reported"): ReportAnswer =>
  ({ questionId: id, question: q(id).text, answer: text, certainty, followUp: false });

/** Settings only: what is inserted as rows before the history is applied. */
export function demoSettings(now: Date, options: { workerPhone?: string } = {}): Workspace {
  const ws = createDemoWorkspace("ar", "ultimate", now);
  const created = new Date(now.getTime() - 21 * 24 * HOUR).toISOString();
  ws.createdAt = created;
  ws.settings.owner = { name: "فهد العتيبي", phone: "+966500000201" };
  ws.settings.farm = { name: DEMO_RANCH_NAME, location: "الصمان، المنطقة الشرقية", coords: null };
  ws.settings.worker = { id: uid("wkr"), name: "أحمد", phone: options.workerPhone ?? "+966500000202", language: "ar" };
  ws.settings.otherWorkers = [];
  ws.settings.customQuestions = [
    { id: uid("cq"), text: "كم لتر حليب تقريباً اليوم؟", createdAt: created },
    { id: uid("cq"), text: "فيه أحد زار العزبة اليوم؟", createdAt: created },
  ];
  ws.settings.herdCount = 20;
  ws.settings.window = null;
  ws.settings.integrations = undefined;
  ws.camels = CAMELS.map(([name, tag, sex, ageYears]) => ({
    id: uid("cml"), name, tag, sex, ageYears, health: "unknown", healthNote: null, certainty: "unknown", updatedAt: null,
  }));
  ws.resources = ws.resources.map((r) => ({ ...r, present: true, level: "unknown", quantity: null, note: null, certainty: "unknown", updatedAt: null }));
  ws.reports = []; ws.calls = []; ws.taskTickets = []; ws.noAnswerTickets = []; ws.pendingWorkerCalls = []; ws.relays = []; ws.events = [];
  ws.lastUpdateAt = null; ws.ownerAllowanceUsedAt = null; ws.missedNotificationAt = null; ws.clockOffsetMs = 0; ws.weather = undefined;
  return ws;
}

/** The same ranch with three weeks' worth of believable, consistent history. */
export function demoHistory(base: Workspace, now: Date, options: { endYesterday?: boolean } = {}): Workspace {
  const ws: Workspace = structuredClone(base);
  const worker = ws.settings.worker.name;
  const crit = (kind: string) => ws.settings.criteria.find((c) => c.kind === kind)!.id;
  const custom = ws.settings.customQuestions;
  const camel = (name: string) => ws.camels.find((c) => c.name === name)!;
  // The latest report is today's if today's 17:00 call is behind us, otherwise yesterday's.
  const todayCall = atRiyadhTime(now, 17, 0);
  // endYesterday leaves today without a report, so the ranch can still take today's real call.
  const latestDay = !options.endYesterday && todayCall.getTime() + 15 * MINUTE < now.getTime() ? 0 : -1;
  const day = (offset: number, h: number, m: number) => atRiyadhTime(now, h, m, latestDay + offset);
  const iso = (d: Date) => d.toISOString();

  const call = (c: Omit<CallLog, "id" | "summary"> & { summary: string }): CallLog => {
    const log: CallLog = { ...c, id: uid("call"), summary: { ar: SIM + c.summary, en: "Simulated · " + c.summary } };
    ws.calls.push(log);
    return log;
  };
  const report = (at: Date, answers: ReportAnswer[], findings: { kind: string; text: string }[], herd: number | null): FarmReport => {
    const reportId = uid("rep");
    const log = call({ kind: "worker_report", direction: "outbound", party: "worker", at: iso(at), outcome: "completed", attempt: 1,
      summary: findings.length ? `تحديث مكتمل — ${findings.length} ملاحظة مهمة` : "تحديث مكتمل — كل شي تمام", ticketId: null, reportId });
    const r: FarmReport = {
      id: reportId, at: iso(at), callId: log.id, mode: "guided", answers,
      findings: findings.map((f) => ({ id: uid("fnd"), criterionId: crit(f.kind), text: { ar: f.text, en: f.text } })),
      herdCountReported: herd,
    };
    ws.reports.push(r);
    ws.events.push({ id: uid("evt"), at: iso(at), tone: findings.length ? "attention" : "success", text: { ar: `${SIM}حُفظ تحديث العزبة من ${worker}`, en: `Simulated · Farm update saved from ${worker}` } });
    return r;
  };
  const briefed = (at: Date, reportId: string) => {
    call({ kind: "owner_notification", direction: "outbound", party: "owner", at: iso(at), outcome: "completed", attempt: null, summary: "أُبلغ المالك بالتحديث", ticketId: null, reportId });
    ws.events.push({ id: uid("evt"), at: iso(at), tone: "success", text: { ar: `${SIM}اتصلت ناقة بالمالك وأبلغته بالتحديث`, en: "Simulated · NAQAH briefed the owner" } });
  };

  // Day −3: first attempt unanswered, the retry 20 minutes later got the report. All well.
  call({ kind: "worker_report_missed", direction: "outbound", party: "worker", at: iso(day(-3, 17, 0)), outcome: "no_answer", attempt: 1, summary: `${worker} ما رد — نعيد بعد 20 دقيقة`, ticketId: null, reportId: null });
  const r3 = report(day(-3, 17, 22), [
    answer("herd_health", "الحلال كله بخير"), answer("herd_count", "20", "reported"), answer("feed_level", "كافٍ، قرابة 40 كيس", "approximate"),
    answer("water_level", "الخزان مليان"), answer("fences_condition", "سليم"), answer("medicine_stock", "كافي"),
    { questionId: custom[0].id, question: { ar: custom[0].text, en: custom[0].text }, answer: "قرابة 35 لتر", certainty: "approximate", followUp: false },
  ], [], 20);
  briefed(day(-3, 19, 0), r3.id);

  // Day −2: Haya limping. Water starting to drop.
  const r2 = report(day(-2, 17, 6), [
    answer("herd_health", "كلهم بخير بس هيا تعرج شوي"), answer("herd_count", "20"), answer("feed_level", "كافٍ، قرابة 34 كيس", "approximate"),
    answer("water_level", "نص الخزان"), answer("fences_condition", "سليم"), answer("medicine_stock", "كافي"),
    { questionId: custom[1].id, question: { ar: custom[1].text, en: custom[1].text }, answer: "جا المورد ونزّل علف", certainty: "reported", followUp: false },
  ], [], 20);
  briefed(day(-2, 19, 0), r2.id);
  // The owner asked for a water truck: delivered, done the next morning.
  const water = uid("tsk");
  ws.taskTickets.push({ id: water, instruction: "اطلب وايت ماء للخزان الكبير", createdAt: iso(day(-2, 19, 4)), scheduledFor: iso(day(-1, 10, 0)), status: "closed", closedAt: iso(day(-1, 10, 6)), closedVia: "worker_task_verification" });
  call({ kind: "worker_instruction", direction: "outbound", party: "worker", at: iso(day(-2, 19, 8)), outcome: "completed", attempt: 1, summary: "وصلت التعليمات: «اطلب وايت ماء للخزان الكبير»", ticketId: water, reportId: null });
  call({ kind: "worker_task_verification", direction: "outbound", party: "worker", at: iso(day(-1, 10, 6)), outcome: "completed", attempt: 1, summary: `أكّد ${worker}: الوايت وصل والخزان امتلأ`, ticketId: water, reportId: null });

  // Day −1: Wadha eating less, Mazoon unwell. Water refilled.
  const r1 = report(day(-1, 17, 4), [
    answer("herd_health", "مزون تعبانة فيها إسهال، ووضحة ما تاكل زين"), answer("herd_count", "20"), answer("feed_level", "متوسط، قرابة 28 كيس", "approximate"),
    answer("water_level", "مليان بعد الوايت"), answer("fences_condition", "سليم"), answer("medicine_stock", "كافي"),
  ], [{ kind: "sick_camel", text: "مزون مريضة — إسهال وحرارة" }], 20);
  briefed(day(-1, 19, 0), r1.id);
  const isolate = uid("tsk");
  ws.taskTickets.push({ id: isolate, instruction: "اعزل مزون واتصل على البيطري يشوفها بكرة الصبح", createdAt: iso(day(-1, 19, 5)), scheduledFor: iso(day(1, 9, 0)), status: "open", closedAt: null, closedVia: null });
  call({ kind: "worker_instruction", direction: "outbound", party: "worker", at: iso(day(-1, 19, 9)), outcome: "completed", attempt: 1, summary: "وصلت التعليمات: «اعزل مزون واتصل على البيطري يشوفها بكرة الصبح»", ticketId: isolate, reportId: null });

  // Latest: water low again (a pipe leaks), the east fence is cut, Mazoon still sick, two camels not seen.
  const r0 = report(day(0, 17, 6), [
    answer("herd_health", "مزون لسا تعبانة، ووضحة تحت الملاحظة، وهيا تعرج"), answer("herd_count", "18 شفتهم، صيتة وطرفة ما شفتهم اليوم"),
    answer("feed_level", "متوسط، قرابة 25 كيس", "approximate"), answer("water_level", "قليل، تحت الربع — فيه تسريب في الماسورة", "approximate"),
    answer("fences_condition", "الشبك الشرقي مقطوع جزء منه"), answer("medicine_stock", "كافي"),
    { questionId: custom[0].id, question: { ar: custom[0].text, en: custom[0].text }, answer: "قرابة 28 لتر", certainty: "approximate", followUp: false },
  ], [
    { kind: "sick_camel", text: "مزون لسا مريضة — إسهال وحرارة" },
    { kind: "low_water", text: "الماء قليل — تحت الربع وفيه تسريب" },
    { kind: "fence_damage", text: "الشبك الشرقي مقطوع جزء منه" },
  ], 18);
  const fence = uid("tsk");
  ws.taskTickets.push({ id: fence, instruction: "صلّح الشبك الشرقي قبل المغرب", createdAt: iso(day(0, 17, 30)), scheduledFor: null, status: "open", closedAt: null, closedVia: null });
  // Not delivered yet: the first try went unanswered, the next is due in 20 minutes.
  ws.pendingWorkerCalls.push({ id: uid("pwc"), purpose: "instruction", message: "صلّح الشبك الشرقي قبل المغرب", taskTicketId: fence, relayId: null,
    attempts: [{ at: iso(day(0, 17, 32)), answered: false }], nextAttemptAt: iso(day(0, 17, 52)), state: "pending" });
  call({ kind: "worker_instruction", direction: "outbound", party: "worker", at: iso(day(0, 17, 32)), outcome: "no_answer", attempt: 1, summary: `${worker} ما رد — بنعيد التعليمات بعد 20 دقيقة`, ticketId: fence, reportId: null });

  // Camels and resources as the latest report left them. Unknown stays unknown, never healthy.
  const latest = iso(day(0, 17, 6));
  for (const [name, , , , health, note] of CAMELS) {
    const c: Camel = camel(name);
    c.health = health;
    c.healthNote = note;
    c.certainty = health === "unknown" ? "unknown" : "reported";
    c.updatedAt = health === "unknown" ? iso(day(-1, 17, 4)) : latest;
  }
  ws.resources = ws.resources.map((r) => {
    const set = (level: Workspace["resources"][number]["level"], quantity: string | null, note: string | null, certainty: "reported" | "approximate" = "reported") =>
      ({ ...r, present: true, level, quantity, note, certainty, updatedAt: latest });
    switch (r.kind) {
      case "feed": return set("medium", "قرابة 25 كيس", null, "approximate");
      case "water": return set("low", "تحت الربع", "تسريب في الماسورة", "approximate");
      case "fences": return set("low", null, "الشبك الشرقي مقطوع جزء منه");
      case "shelter": return set("good", null, null);
      case "medicine": return set("good", null, null);
      default: return r;
    }
  });
  ws.lastUpdateAt = latest;
  return ws;
}
