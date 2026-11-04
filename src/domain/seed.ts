/**
 * Workspace factories: an empty workspace for onboarding, and a realistic
 * sample farm for the investor demo ("Explore the demo").
 */
import { RESOURCE_KINDS } from "./catalog";
import { atRiyadhTime, HOUR, MINUTE, nextWindowStart } from "./clock";
import { uid } from "./id";
import type { Camel, Criterion, EmergencyCategory, Locale, Plan, Resource, Workspace } from "./types";

export function defaultCriteria(): Criterion[] {
  return (["sick_camel", "missing_camel", "low_feed", "low_water", "fence_damage", "medicine_low"] as const).map((kind) => ({
    id: uid("crt"),
    kind,
    label: null,
    enabled: kind !== "medicine_low",
  }));
}

export function defaultEmergencies(): EmergencyCategory[] {
  return (["injury", "missing_camel", "fire", "death"] as const).map((kind) => ({ id: uid("emg"), kind, label: null }));
}

function emptyResources(present: boolean): Resource[] {
  return RESOURCE_KINDS.map((kind) => ({
    kind,
    present: present && kind !== "shelter",
    level: "unknown",
    quantity: null,
    note: null,
    certainty: "unknown",
    updatedAt: null,
  }));
}

export function createEmptyWorkspace(plan: Plan = "ultimate"): Workspace {
  return {
    version: 1,
    setupComplete: false,
    createdAt: new Date().toISOString(),
    settings: {
      plan,
      owner: { name: "", phone: "" },
      farm: { name: "", location: "" },
      worker: { name: "", phone: "", language: "ar" },
      customQuestions: [],
      criteria: defaultCriteria(),
      emergencies: defaultEmergencies(),
      // Basic: the owner must choose day + start + end explicitly (no default duration is assumed).
      window: null,
    },
    camels: [],
    resources: emptyResources(true),
    lastUpdateAt: null,
    reports: [],
    calls: [],
    taskTickets: [],
    noAnswerTickets: [],
    pendingWorkerCalls: [],
    relays: [],
    events: [],
    clockOffsetMs: 0,
    ownerAllowanceUsedAt: null,
    missedNotificationAt: null,
  };
}

const CAMELS: Record<Locale, [string, string, Camel["sex"], number][]> = {
  ar: [
    ["وضحة", "SA-0141", "female", 7],
    ["شعلة", "SA-0142", "female", 5],
    ["مزنة", "SA-0157", "female", 9],
    ["الحمرا", "SA-0163", "female", 4],
    ["غيمة", "SA-0178", "female", 6],
    ["ريم", "SA-0180", "female", 3],
    ["هدّاج", "SA-0102", "male", 11],
    ["فاتنة", "SA-0191", "female", 2],
  ],
  en: [
    ["Wadha", "SA-0141", "female", 7],
    ["Shaala", "SA-0142", "female", 5],
    ["Mozna", "SA-0157", "female", 9],
    ["Hamra", "SA-0163", "female", 4],
    ["Ghaima", "SA-0178", "female", 6],
    ["Reem", "SA-0180", "female", 3],
    ["Haddaj", "SA-0102", "male", 11],
    ["Fatinah", "SA-0191", "female", 2],
  ],
};

/**
 * Sample farm with one prior report (yesterday, end of workday), so every
 * screen has real-looking content before the investor runs a call.
 */
export function createDemoWorkspace(locale: Locale, plan: Plan = "ultimate", realNow = new Date()): Workspace {
  const ws = createEmptyWorkspace(plan);
  const ar = locale === "ar";
  const yesterday = atRiyadhTime(realNow, 17, 40, -1);
  const y = yesterday.toISOString();

  ws.setupComplete = true;
  ws.settings.owner = { name: ar ? "عبدالله الدوسري" : "Abdullah Al-Dosari", phone: "+966 55 012 3344" };
  ws.settings.farm = { name: ar ? "عزبة الصفراء" : "Al Safra Ranch", location: ar ? "الخرج، منطقة الرياض" : "Al-Kharj, Riyadh Region" };
  ws.settings.worker = { name: ar ? "أحمد" : "Ahmed", phone: "+966 50 778 2190", language: ar ? "ar" : "en" };
  ws.settings.customQuestions = [
    {
      id: uid("cq"),
      text: ar ? "هل حلبت النوق اليوم؟ وكم تقريباً؟" : "Were the camels milked today? Roughly how much?",
      createdAt: y,
    },
    {
      id: uid("cq"),
      text: ar ? "هل زار المزرعة أحد غريب؟" : "Did any visitors come to the farm?",
      createdAt: y,
    },
  ];
  if (plan === "basic") {
    // Next Thursday window, 17:00–18:00 Riyadh.
    ws.settings.window = { day: 4, start: "17:00", end: "18:00" };
  }

  ws.camels = CAMELS[locale].map(([name, tag, sex, age]) => ({
    id: uid("cml"),
    name,
    tag,
    sex,
    ageYears: age,
    health: "healthy",
    healthNote: null,
    certainty: "reported",
    updatedAt: y,
  }));
  const wadha = ws.camels[0];
  wadha.health = "watch";
  wadha.healthNote = ar ? "تأكل أقل من المعتاد منذ يومين" : "Eating less than usual for two days";

  ws.resources = ws.resources.map((r) => {
    const base = { ...r, present: r.kind !== "shelter", certainty: "reported" as const, updatedAt: y };
    switch (r.kind) {
      case "feed":
        return { ...base, level: "medium" as const, quantity: ar ? "قرابة ٢٠ كيس" : "about 20 bags", certainty: "approximate" as const };
      case "water":
        return { ...base, level: "good" as const };
      case "fences":
        return { ...base, level: "good" as const };
      case "medicine":
        return { ...base, level: "medium" as const };
      default:
        return { ...base, present: false, updatedAt: null, certainty: "unknown" as const };
    }
  });

  const callId = uid("call");
  const reportId = uid("rep");
  ws.reports.push({
    id: reportId,
    at: y,
    callId,
    answers: [],
    findings: [
      {
        id: uid("fnd"),
        criterionId: ws.settings.criteria[0].id,
        text: {
          ar: "وضحة تحت الملاحظة — تأكل أقل من المعتاد منذ يومين",
          en: "Wadha is under watch — eating less than usual for two days",
        },
      },
    ],
  });
  ws.lastUpdateAt = y;
  ws.calls.push(
    {
      id: callId,
      kind: "worker_report",
      direction: "inbound",
      party: "worker",
      at: y,
      outcome: "completed",
      attempt: null,
      summary: { ar: "تحديث مكتمل — 1 ملاحظة مهمة", en: "Update completed — 1 important finding(s)" },
      ticketId: null,
      reportId,
    },
    {
      id: uid("call"),
      kind: "owner_notification",
      direction: "outbound",
      party: "owner",
      at: new Date(yesterday.getTime() + 2 * MINUTE).toISOString(),
      outcome: "completed",
      attempt: null,
      summary: { ar: "أُبلغ المالك بالتحديث", en: "Owner briefed on the update" },
      ticketId: null,
      reportId,
    },
  );

  if (plan === "ultimate") {
    const t1 = uid("tsk");
    ws.taskTickets.push(
      {
        id: t1,
        instruction: ar ? "انقل وضحة للحظيرة المظللة وراقب أكلها" : "Move Wadha to the shaded pen and watch her eating",
        createdAt: new Date(yesterday.getTime() + 4 * MINUTE).toISOString(),
        scheduledFor: null,
        status: "open",
        closedAt: null,
        closedVia: null,
      },
      {
        id: uid("tsk"),
        instruction: ar ? "اطلب ٣٠ كيس علف من المورد" : "Order 30 bags of feed from the supplier",
        createdAt: new Date(yesterday.getTime() - 26 * HOUR).toISOString(),
        scheduledFor: new Date(yesterday.getTime() - 20 * HOUR).toISOString(),
        status: "closed",
        closedAt: new Date(yesterday.getTime() - 19 * HOUR).toISOString(),
        closedVia: "worker_task_verification",
      },
    );
    ws.calls.push({
      id: uid("call"),
      kind: "worker_instruction",
      direction: "outbound",
      party: "worker",
      at: new Date(yesterday.getTime() + 5 * MINUTE).toISOString(),
      outcome: "completed",
      attempt: 1,
      summary: ar
        ? { ar: "وصلت التعليمات للعامل: «انقل وضحة للحظيرة المظللة وراقب أكلها»", en: "Instruction delivered: “انقل وضحة للحظيرة المظللة وراقب أكلها”" }
        : { ar: "وصلت التعليمات للعامل: «Move Wadha to the shaded pen and watch her eating»", en: "Instruction delivered: “Move Wadha to the shaded pen and watch her eating”" },
      ticketId: t1,
      reportId: null,
    });
  }

  ws.events.push(
    {
      id: uid("evt"),
      at: y,
      tone: "success",
      text: { ar: `حُفظ تحديث المزرعة من ${ws.settings.worker.name}`, en: `Farm update saved from ${ws.settings.worker.name}` },
    },
    {
      id: uid("evt"),
      at: new Date(yesterday.getTime() + 2 * MINUTE).toISOString(),
      tone: "success",
      text: { ar: "اتصل المساعد بالمالك وأبلغه بالتحديث", en: "The agent called the owner with the update" },
    },
  );

  // Basic demo: start the clock 5 minutes into the next weekly window so a report call works
  // immediately, and move the sample report to last week's window.
  if (plan === "basic" && ws.settings.window) {
    const start = nextWindowStart(realNow, ws.settings.window);
    ws.clockOffsetMs = start.getTime() + 5 * MINUTE - realNow.getTime();
    const shift = start.getTime() - 7 * 24 * HOUR + 12 * MINUTE - yesterday.getTime();
    const move = (v: string) => new Date(new Date(v).getTime() + shift).toISOString();
    ws.reports[0].at = move(ws.reports[0].at);
    ws.lastUpdateAt = ws.reports[0].at;
    for (const c of ws.calls) c.at = move(c.at);
    for (const e of ws.events) e.at = move(e.at);
    for (const c of ws.camels) if (c.updatedAt) c.updatedAt = move(c.updatedAt);
    for (const r of ws.resources) if (r.updatedAt) r.updatedAt = move(r.updatedAt);
    for (const q of ws.settings.customQuestions) q.createdAt = move(q.createdAt);
  }
  return ws;
}
