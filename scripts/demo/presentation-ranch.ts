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
import type { CallKind, CallLog, Camel, CriterionKind, FarmReport, HealthStatus, NoAnswerTicket, ReportAnswer, TaskTicket, Workspace } from "@/domain/types";

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
    { id: uid("cq"), text: "فيه شي ثاني تبي تبلغ عنه؟", createdAt: created },
  ];
  // The demo's short daily call: herd, feed, water, anything broken, anything else. The two older questions stay
  // for the history's answers but are no longer asked. Real ranches keep their own plan.
  ws.settings.questionPlan = [
    ...["herd_health", "feed_level", "water_level", "fences_condition"].map((id) => ({ id, enabled: true, required: true })),
    { id: ws.settings.customQuestions[2].id, enabled: true, required: true },
    ...["herd_count", "shelter_condition", "medicine_stock"].map((id) => ({ id, enabled: false, required: true })),
    ...ws.settings.customQuestions.slice(0, 2).map((question) => ({ id: question.id, enabled: false, required: true })),
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
  const worker = base.settings.worker.name;
  const crit = (kind: string) => ws.settings.criteria.find((c) => c.kind === kind)!.id;
  const camel = (name: string) => ws.camels.find((c) => c.name === name)!;
  // The latest report is today's if today's 17:00 call is behind us, otherwise yesterday's.
  const todayCall = atRiyadhTime(now, 17, 0);
  // endYesterday leaves today without a report, so the ranch can still take today's real call.
  const latestDay = !options.endYesterday && todayCall.getTime() + 15 * MINUTE < now.getTime() ? 0 : -1;
  const day = (offset: number, h: number, m: number) => atRiyadhTime(now, h, m, latestDay + offset);
  const iso = (d: Date) => d.toISOString();
  // The weeks before: the same rows enrich-presentation.mjs adds to an existing ranch.
  const ws = addEarlierHistory(base, day(-3, 12, 0), { notBefore: new Date(base.createdAt) });
  const custom = ws.settings.customQuestions;

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
  report(day(0, 17, 6), [
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

/* ─────────────────── the weeks before ─────────────────── */

type Words = [ar: string, en: string];
interface EarlierDay {
  /** Days before the first day already on record. */
  k: number;
  /** When the report was saved (Riyadh). */
  at: [number, number];
  herd: string;
  count: number;
  feed: string;
  water: string;
  fences: string;
  medicine?: string;
  milk: string;
  visitors?: string;
  findings?: [CriterionKind, ...Words][];
  /** Unanswered report-call attempts before the worker called back with the report. */
  missedFirst?: boolean;
  /** Unanswered owner-briefing attempts before the owner picked up. */
  briefingRetries?: number;
}

const EARLIER: EarlierDay[] = [
  { k: 16, at: [17, 5], herd: "الحلال كله بخير الحمد لله", count: 20, feed: "زين، قرابة 38 كيس", water: "الخزان مليان", fences: "سليم", medicine: "كافي", milk: "قرابة 36 لتر", visitors: "لا، ما جا أحد" },
  { k: 15, at: [17, 3], herd: "كلهم بخير", count: 20, feed: "قرابة 36 كيس", water: "مليان", fences: "سليم", medicine: "كافي", milk: "قرابة 37 لتر" },
  { k: 14, at: [17, 8], herd: "كلهم بخير بس الجازي ما شفتها العصر", count: 19, feed: "قرابة 33 كيس", water: "مليان", fences: "سليم", medicine: "كافي", milk: "قرابة 34 لتر",
    findings: [["missing_camel", "الجازي ما رجعت مع الحلال — العدد 19 من 20", "Al-Jazi did not come back with the herd — 19 of 20 counted"]] },
  { k: 13, at: [17, 6], herd: "لقينا الجازي عند البير الشمالي، كلهم بخير، وغالية فيها كحة خفيفة", count: 20, feed: "قرابة 31 كيس", water: "مليان", fences: "سليم", medicine: "كافي", milk: "قرابة 35 لتر", visitors: "لا" },
  { k: 12, at: [17, 4], herd: "غالية الكحة زادت وخشمها يسيل، ومزون فيها جرح بسيط في رقبتها من السلك", count: 20, feed: "قرابة 28 كيس", water: "مليان", fences: "فيه سلك بارز عند الزريبة", medicine: "كافي", milk: "قرابة 33 لتر",
    findings: [
      ["sick_camel", "غالية فيها كحة وسيلان من الخشم", "Ghalia has a cough and a runny nose"],
      ["sick_camel", "مزون فيها جرح بسيط في الرقبة من سلك الزريبة", "Mazoon has a small neck wound from the pen wire"],
    ] },
  { k: 11, at: [17, 5], herd: "غالية أحسن بعد الإبرة، ومزون الجرح نعقمه كل يوم", count: 20, feed: "قرابة 26 كيس", water: "نازل للنص، المضخة واقفة من الظهر", fences: "قصّينا السلك، سليم", medicine: "كافي", milk: "قرابة 33 لتر", visitors: "جا البيطري العصر",
    findings: [["low_water", "الماء نازل للنص — المضخة واقفة من الظهر", "Water down to half — the pump stopped at noon"]] },
  { k: 10, at: [17, 4], herd: "كلهم بخير، وغالية الكحة خفت", count: 20, feed: "قرابة 23 كيس", water: "المضخة اشتغلت بعد ما جا الفني، الخزان يتعبى", fences: "سليم", medicine: "قليل، باقي إبرتين مضاد", milk: "قرابة 34 لتر", visitors: "جا فني المضخة الصبح" },
  { k: 9, at: [17, 5], herd: "كلهم بخير، وجرح مزون طاب", count: 20, feed: "قليل، قرابة 20 كيس تكفي أسبوع", water: "مليان", fences: "سليم", medicine: "كافي بعد ما اشترينا", milk: "قرابة 36 لتر",
    findings: [["low_feed", "العلف قليل — قرابة 20 كيس تكفي أسبوع", "Feed is low — about 20 bags, roughly a week"]] },
  { k: 8, at: [17, 3], herd: "كلهم بخير", count: 20, feed: "زين، قرابة 60 كيس بعد ما وصل الطلب", water: "مليان", fences: "سليم", medicine: "كافي", milk: "قرابة 37 لتر", visitors: "جا المورد ونزّل العلف" },
  { k: 7, at: [17, 6], herd: "كلهم بخير بس وضحة ما تاكل زين اليوم", count: 20, feed: "قرابة 58 كيس", water: "مليان", fences: "سليم", medicine: "كافي", milk: "قرابة 36 لتر" },
  { k: 6, at: [18, 25], herd: "كلهم بخير، ووضحة رجعت تاكل شوي", count: 20, feed: "قرابة 55 كيس", water: "مليان", fences: "سليم", medicine: "كافي", milk: "قرابة 35 لتر", missedFirst: true },
  { k: 5, at: [17, 4], herd: "كلهم بخير، ووضحة رجعت تاكل زين", count: 20, feed: "قرابة 52 كيس", water: "مليان", fences: "سليم", medicine: "كافي", milk: "قرابة 37 لتر", visitors: "لا", briefingRetries: 1 },
  { k: 4, at: [17, 5], herd: "كلهم بخير", count: 20, feed: "قرابة 50 كيس", water: "مليان", fences: "سليم", medicine: "كافي", milk: "قرابة 36 لتر" },
  { k: 3, at: [17, 7], herd: "كلهم بخير، رعوا زين في الشمالي", count: 20, feed: "قرابة 47 كيس", water: "مليان", fences: "فيه فتحة صغيرة في الشبك الغربي", medicine: "كافي", milk: "قرابة 38 لتر",
    findings: [["fence_damage", "فتحة صغيرة في الشبك الغربي", "A small gap in the west fence"]] },
  { k: 2, at: [17, 5], herd: "كلهم بخير، وهيا تمشي ثقيل شوي", count: 20, feed: "قرابة 45 كيس", water: "مليان", fences: "سكّرنا الفتحة، سليم", medicine: "كافي", milk: "قرابة 36 لتر" },
  { k: 1, at: [17, 4], herd: "كلهم بخير", count: 20, feed: "قرابة 42 كيس", water: "مليان", fences: "سليم", medicine: "كافي", milk: "قرابة 37 لتر" },
];

/** The owner's instructions over those weeks and how each one was delivered and confirmed. */
interface EarlierTask {
  key: string;
  k: number;
  at: [number, number];
  instruction: string;
  /** Scheduled check: days after `k` and the Riyadh time. null = any time (asked on a later call). */
  scheduled: [days: number, h: number, m: number] | null;
  /** Unanswered instruction attempts before delivery; 3 = all missed, a No Answer ticket, then the worker called back. */
  deliveryMisses?: number;
  /** Unanswered check attempts before the worker confirmed. */
  checkMisses?: number;
  /** When the worker confirmed it: days after `k`, Riyadh time, and on which call. */
  closed: [days: number, h: number, m: number, via: CallKind];
  confirmed: Words;
}

const TASKS: EarlierTask[] = [
  { key: "jazi", k: 14, at: [19, 3], instruction: "دوّر على الجازي الليلة، وإذا ما لقيتها كلمني", scheduled: null,
    closed: [1, 17, 6, "worker_report"], confirmed: ["أكّد أحمد: لقى الجازي عند البير الشمالي", "Ahmed confirmed: Al-Jazi was found by the north well"] },
  { key: "vet", k: 12, at: [19, 4], instruction: "خل البيطري يشوف غالية بكرة العصر", scheduled: [1, 16, 0],
    closed: [1, 16, 2, "worker_task_verification"], confirmed: ["أكّد أحمد: البيطري شاف غالية وعطاها إبرة", "Ahmed confirmed: the vet saw Ghalia and gave her an injection"] },
  { key: "wound", k: 12, at: [19, 5], instruction: "عقّم جرح مزون كل يوم وقصّ السلك البارز", scheduled: null,
    closed: [3, 17, 5, "worker_report"], confirmed: ["أكّد أحمد: جرح مزون طاب والسلك انقص", "Ahmed confirmed: Mazoon's wound has healed and the wire is cut"] },
  { key: "pump", k: 11, at: [19, 3], instruction: "صلّح المضخة أو جيب الفني بكرة الصبح", scheduled: null, deliveryMisses: 2,
    closed: [1, 17, 4, "worker_report"], confirmed: ["أكّد أحمد: الفني صلّح المضخة", "Ahmed confirmed: the technician fixed the pump"] },
  { key: "medicine", k: 10, at: [19, 4], instruction: "اشترِ علبة مضاد ومطهر جروح من الصيدلية البيطرية", scheduled: [1, 12, 0], checkMisses: 1,
    closed: [1, 12, 21, "worker_task_verification"], confirmed: ["أكّد أحمد: اشترى المضاد والمطهر", "Ahmed confirmed: he bought the antibiotic and the disinfectant"] },
  { key: "feed", k: 9, at: [19, 3], instruction: "اطلب 40 كيس علف من المورد، يوصل بكرة قبل الظهر", scheduled: [1, 11, 30],
    closed: [1, 11, 32, "worker_task_verification"], confirmed: ["أكّد أحمد: وصل 40 كيس علف", "Ahmed confirmed: 40 bags of feed arrived"] },
  { key: "move", k: 4, at: [19, 4], instruction: "طلّع الحلال للمرعى الشمالي بكرة الصبح بدري", scheduled: [1, 7, 0], deliveryMisses: 3,
    closed: [1, 7, 1, "worker_task_verification"], confirmed: ["أكّد أحمد: طلّع الحلال للمرعى الشمالي", "Ahmed confirmed: the herd went out to the north pasture"] },
  { key: "gap", k: 3, at: [19, 3], instruction: "سكّر فتحة الشبك الغربي", scheduled: null,
    closed: [1, 17, 5, "worker_report"], confirmed: ["أكّد أحمد: الفتحة تسكّرت", "Ahmed confirmed: the gap is closed"] },
];

/** The owner calling NAQAH to ask (Ultimate: any time). */
const INQUIRIES: { k: number; at: [number, number]; summary: Words }[] = [
  { k: 9, at: [21, 10], summary: ["سأل المالك عن طلب العلف — أحمد استلم التعليمات", "The owner asked about the feed order — Ahmed has the instruction"] },
  { k: 1, at: [20, 40], summary: ["سأل المالك عن هيا — آخر تقرير يقول تمشي ثقيل شوي", "The owner asked about Haya — the last report says she walks a little stiffly"] },
];

/**
 * LOCAL DEMO ONLY. Sixteen days of history before `firstDay` (any time on the first day already on record):
 * daily reports with their findings, the owner's briefings, instructions with retries, a missed report call the
 * worker returned, a No Answer ticket closed by a callback, tasks confirmed and closed, and two owner inquiries.
 * Camels, resources, settings and `lastUpdateAt` are never touched, so today's state stays as it is.
 * Every id is a fixed name, so the seed and scripts/demo/enrich-presentation.mjs write the same rows for a ranch.
 * Anything before `notBefore` (the ranch's creation) is left out.
 */
export function addEarlierHistory(base: Workspace, firstDay: Date, options: { notBefore?: Date } = {}): Workspace {
  const ws: Workspace = structuredClone(base);
  const worker = ws.settings.worker.name;
  const at = (k: number, h: number, m: number) => atRiyadhTime(firstDay, h, m, -k).toISOString();
  const crit = (kind: CriterionKind) => {
    const found = ws.settings.criteria.find((c) => c.kind === kind);
    if (!found) throw new Error(`The ranch has no ${kind} criterion`);
    return found.id;
  };
  const customByText = (text: string) => ws.settings.customQuestions.find((question) => question.text === text);
  const sim = (words: Words) => ({ ar: SIM + words[0], en: "Simulated · " + words[1] });
  const calls: CallLog[] = [];
  const call = (id: string, c: Omit<CallLog, "id" | "summary">, summary: Words) => calls.push({ ...c, id, summary: sim(summary) });
  const reports: FarmReport[] = [];
  const events: Workspace["events"] = [];
  const event = (id: string, when: string, tone: Workspace["events"][number]["tone"], text: Words) => events.push({ id, at: when, tone, text: sim(text) });
  const tasks: TaskTicket[] = [];
  const noAnswer: NoAnswerTicket[] = [];

  for (const d of EARLIER) {
    const id = (part: string) => `hist-${d.k}-${part}`;
    const when = at(d.k, d.at[0], d.at[1]);
    if (d.missedFirst) {
      for (const attempt of [1, 2, 3]) {
        const last = attempt === 3;
        call(id(`missed-${attempt}`), { kind: "worker_report_missed", direction: "outbound", party: "worker", at: at(d.k, 17, (attempt - 1) * 20), outcome: "no_answer", attempt, ticketId: null, reportId: null },
          last ? [`${worker} ما رد بعد 3 محاولات — فات تقرير اليوم`, `${worker} didn't answer after 3 tries — today's report call was missed`] : [`${worker} ما رد — نعيد بعد 20 دقيقة`, `${worker} didn't answer — trying again in 20 minutes`]);
      }
      event(id("missed-event"), at(d.k, 17, 40), "attention", [`${worker} ما رد على مكالمة التقرير`, `${worker} missed the report call`]);
    }
    const answers: ReportAnswer[] = [
      answer("herd_health", d.herd),
      answer("herd_count", String(d.count)),
      answer("feed_level", d.feed, "approximate"),
      answer("water_level", d.water),
      answer("fences_condition", d.fences),
      ...(d.medicine ? [answer("medicine_stock", d.medicine)] : []),
    ];
    for (const [text, value, certainty] of [["كم لتر حليب تقريباً اليوم؟", d.milk, "approximate"], ["فيه أحد زار العزبة اليوم؟", d.visitors, "reported"]] as const) {
      const question = customByText(text);
      if (question && value) answers.push({ questionId: question.id, question: { ar: question.text, en: question.text }, answer: value, certainty, followUp: false });
    }
    const findings = (d.findings ?? []).map(([kind, ar, en], index) => ({ id: id(`finding-${index}`), criterionId: crit(kind), text: { ar, en } }));
    const callId = id("report-call");
    call(callId, { kind: "worker_report", direction: d.missedFirst ? "inbound" : "outbound", party: "worker", at: when, outcome: "completed", attempt: d.missedFirst ? null : 1, ticketId: null, reportId: id("report") },
      d.missedFirst
        ? [`رجع ${worker} الاتصال وعطى التقرير — كان مع الحلال في المرعى`, `${worker} called back with the report — he was out with the herd`]
        : findings.length ? [`تحديث مكتمل — ${findings.length} ملاحظة مهمة`, `Update complete — ${findings.length} important ${findings.length === 1 ? "note" : "notes"}`] : ["تحديث مكتمل — كل شي تمام", "Update complete — all well"]);
    reports.push({ id: id("report"), at: when, callId, mode: "guided", answers, findings, herdCountReported: d.count });
    event(id("report-event"), when, findings.length ? "attention" : "success", [`حُفظ تحديث العزبة من ${worker}`, `Farm update saved from ${worker}`]);

    const retries = d.briefingRetries ?? 0;
    for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
      const answered = attempt === retries + 1;
      call(id(`briefing-${attempt}`), { kind: "owner_notification", direction: "outbound", party: "owner", at: at(d.k, 19, (attempt - 1) * 20), outcome: answered ? "completed" : "no_answer", attempt: retries ? attempt : null, ticketId: null, reportId: id("report") },
        answered ? ["أُبلغ المالك بالتحديث", "The owner was briefed on the update"] : ["المالك ما رد — نعيد بعد 20 دقيقة", "The owner didn't answer — trying again in 20 minutes"]);
    }
    event(id("briefing-event"), at(d.k, 19, retries * 20), "success", ["اتصلت ناقة بالمالك وأبلغته بالتحديث", "NAQAH briefed the owner"]);
  }

  for (const task of TASKS) {
    const id = (part: string) => `hist-task-${task.key}${part ? `-${part}` : ""}`;
    const created = at(task.k, task.at[0], task.at[1]);
    const [closeDays, closeH, closeM, via] = task.closed;
    const closedAt = at(task.k - closeDays, closeH, closeM);
    tasks.push({ id: id(""), instruction: task.instruction, createdAt: created,
      scheduledFor: task.scheduled ? at(task.k - task.scheduled[0], task.scheduled[1], task.scheduled[2]) : null,
      status: "closed", closedAt, closedVia: via });

    const misses = task.deliveryMisses ?? 0;
    const tries = Math.min(misses + 1, 3);
    for (let attempt = 1; attempt <= tries; attempt += 1) {
      const answered = attempt > misses;
      const last = attempt === 3 && !answered;
      call(id(`deliver-${attempt}`), { kind: "worker_instruction", direction: "outbound", party: "worker", at: at(task.k, 19, 6 + (attempt - 1) * 20), outcome: answered ? "completed" : "no_answer", attempt, ticketId: id(""), reportId: null },
        answered ? [`وصلت التعليمات: «${task.instruction}»`, `Instruction delivered: “${task.instruction}”`]
          : last ? [`${worker} ما رد بعد 3 محاولات — ننتظر يرجع الاتصال`, `${worker} didn't answer after 3 tries — waiting for him to call back`]
            : [`${worker} ما رد — بنعيد التعليمات بعد 20 دقيقة`, `${worker} didn't answer — trying the instruction again in 20 minutes`]);
    }
    if (misses >= 3) {
      const ticket = id("no-answer");
      const opened = at(task.k, 19, 46);
      const returned = at(task.k, 21, 12);
      noAnswer.push({ id: ticket, createdAt: opened, purpose: "instruction", message: task.instruction, taskTicketId: id(""), status: "closed", closedAt: returned });
      event(id("no-answer-event"), opened, "attention", [`${worker} ما رد على التعليمات بعد 3 محاولات`, `${worker} missed the instruction after 3 tries`]);
      call(id("callback"), { kind: "worker_callback", direction: "inbound", party: "worker", at: returned, outcome: "completed", attempt: null, ticketId: ticket, reportId: null },
        [`رجع ${worker} الاتصال ووصلته التعليمات`, `${worker} returned the missed call and got the instruction`]);
      event(id("callback-event"), returned, "success", [`رجع ${worker} الاتصال ووصلته التعليمات`, `${worker} called back and got the instruction`]);
    }

    if (via === "worker_task_verification") {
      const checks = (task.checkMisses ?? 0) + 1;
      for (let attempt = 1; attempt <= checks; attempt += 1) {
        const answered = attempt === checks;
        call(id(`check-${attempt}`), { kind: "worker_task_verification", direction: "outbound", party: "worker", at: answered ? closedAt : at(task.k - closeDays, closeH, closeM - 21 * (checks - attempt)), outcome: answered ? "completed" : "no_answer", attempt, ticketId: id(""), reportId: null },
          answered ? task.confirmed : [`${worker} ما رد — نعيد بعد 20 دقيقة`, `${worker} didn't answer — trying again in 20 minutes`]);
      }
    }
    event(id("closed-event"), closedAt, "success", task.confirmed);
  }

  for (const [index, inquiry] of INQUIRIES.entries()) {
    call(`hist-inquiry-${index}`, { kind: "owner_inquiry", direction: "inbound", party: "owner", at: at(inquiry.k, inquiry.at[0], inquiry.at[1]), outcome: "completed", attempt: null, ticketId: null, reportId: null }, inquiry.summary);
  }

  // Only what happened after the ranch was created; a call about a left-out task is left out with it.
  const from = options.notBefore?.getTime() ?? -Infinity;
  const kept = <T extends { at?: string; createdAt?: string }>(item: T) => Date.parse(item.at ?? item.createdAt ?? "") >= from;
  const keptTasks = new Set(tasks.filter(kept).map((task) => task.id));
  const keptTickets = new Set(noAnswer.filter((ticket) => kept(ticket) && (!ticket.taskTicketId || keptTasks.has(ticket.taskTicketId))).map((ticket) => ticket.id));
  ws.reports.push(...reports.filter(kept));
  ws.taskTickets.push(...tasks.filter((task) => keptTasks.has(task.id)));
  ws.noAnswerTickets.push(...noAnswer.filter((ticket) => keptTickets.has(ticket.id)));
  ws.calls.push(...calls.filter((c) => kept(c) && (!c.ticketId || keptTasks.has(c.ticketId) || keptTickets.has(c.ticketId))));
  ws.events.push(...events.filter(kept));
  return ws;
}

