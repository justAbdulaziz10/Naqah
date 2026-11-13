/**
 * NAQAH domain model.
 *
 * One owner → one farm → one primary reporting worker (plus optional registered workers). Everything the owner sees and
 * everything the AI voice agent does is derived from a single `Workspace`
 * document. Pure functions in `src/domain/*` transform it; the store in
 * `src/store/workspace.ts` persists it.
 *
 * Mirrors the SQL schema in `supabase/migrations/0001_init.sql`.
 * If you change a type here, update the schema and AGENT.md in the same PR.
 */

export type Locale = "ar" | "en";

/** Text stored for display in either UI language. */
export interface LocalizedText {
  ar: string;
  en: string;
}

export type Plan = "basic" | "ultimate";

/** Languages the AI can speak with the worker (owner chooses). */
export type WorkerLanguage = "ar" | "en" | "ur" | "hi" | "bn" | "fil";

/** How much we trust a recorded fact (agent identity spec §4.3). */
export type Certainty = "reported" | "approximate" | "unknown" | "verified";

export type ResourceKind =
  | "feed"
  | "water"
  | "fences"
  | "shelter"
  | "medicine";

export type Level = "good" | "medium" | "low" | "critical" | "unknown";

export type HealthStatus = "healthy" | "watch" | "sick" | "unknown";

export interface Owner {
  name: string;
  phone: string;
}

export interface FarmCoords {
  lat: number;
  lon: number;
}

export interface Farm {
  name: string;
  location: string;
  /** Optional GPS point for weather. Never required. */
  coords?: FarmCoords | null;
}

/** Owner-side contacts used by free deep links (WhatsApp wa.me). */
export interface Integrations {
  supplierName?: string;
  supplierPhone?: string;
}

/** Latest daily forecast for the farm (Open-Meteo). Stored so rules stay pure. */
export interface WeatherSnapshot {
  fetchedAt: string;
  /** Riyadh calendar date the forecast is for, YYYY-MM-DD. */
  date: string;
  maxTempC: number;
  minTempC: number | null;
  source: "open-meteo";
}

export interface Worker {
  /** Stable id for registered workers. The primary worker of older workspaces may lack one. */
  id?: string;
  name: string;
  /** Registered number. Used as an identification signal only, not proof. */
  phone: string;
  language: WorkerLanguage;
}

export interface Camel {
  id: string;
  name: string;
  /** Ear tag / brand identifier. */
  tag: string;
  sex: "female" | "male";
  ageYears: number | null;
  health: HealthStatus;
  healthNote: string | null;
  certainty: Certainty;
  updatedAt: string | null;
}

export interface Resource {
  kind: ResourceKind;
  /** Resources that are not present are skipped by the agent's questions. */
  present: boolean;
  level: Level;
  /** Optional rough quantity, e.g. "12 bags". Never presented as a precise stock count. */
  quantity: string | null;
  note: string | null;
  certainty: Certainty;
  updatedAt: string | null;
}

export type QuestionCategory =
  | "health"
  | "feed"
  | "water"
  | "fences"
  | "shelter"
  | "medicine"
  | "general";

/** How the agent interprets the answer to a predefined question. */
export type AnswerKind = "level" | "yesno" | "herd-health" | "text";

/** Prepared by the NAQAH team. Asked when applicable, unless the owner switches it off. Wording is a DRAFT. */
export interface PredefinedQuestion {
  id: string;
  category: QuestionCategory;
  /** Question applies only if this resource is present on the farm. */
  requires: ResourceKind | null;
  answerKind: AnswerKind;
  text: LocalizedText;
}

/** Written by the owner. Basic: max 5. Ultimate: unlimited. */
export interface CustomQuestion {
  id: string;
  text: string;
  createdAt: string;
}

/** How the worker gives the report. "worker_choice" lets them pick guided or open on each call. */
export type ReportMode = "worker_choice" | "guided" | "open";

/** One question in the owner's plan. `id` is a predefined id or a custom question id; array order is ask order. */
export interface QuestionPlanEntry {
  id: string;
  enabled: boolean;
  /** Required: answered, or marked unknown. Optional: the worker can skip it. */
  required: boolean;
}

export type CriterionKind =
  | "sick_camel"
  | "low_feed"
  | "low_water"
  | "fence_damage"
  | "missing_camel"
  | "medicine_low"
  | "custom";

/** Owner-configured "important information" rule. */
export interface Criterion {
  id: string;
  kind: CriterionKind;
  /** Only for kind === "custom": keyword(s) the agent listens for. */
  label: string | null;
  enabled: boolean;
}

export type EmergencyKind =
  | "injury"
  | "missing_camel"
  | "fire"
  | "predator"
  | "theft"
  | "death"
  | "custom";

/** Owner-configured. In an emergency the worker calls the owner DIRECTLY (not via AI). */
export interface EmergencyCategory {
  id: string;
  kind: EmergencyKind;
  label: string | null;
}

/** 0 = Sunday … 6 = Saturday (Asia/Riyadh). */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/**
 * RETIRED. The old Basic worker-calls-in window. NAQAH now calls the worker at `CallSchedule`.
 * Kept only so stored data and the existing DB columns still load; no rule or screen reads it.
 */
export interface ReportingWindow {
  day: Weekday;
  /** "HH:MM", 24h, Asia/Riyadh */
  start: string;
  end: string;
}

/**
 * When NAQAH calls the worker for the farm report. Basic: once a week on `day` at `time`.
 * Ultimate: every day at `time` (`day` is ignored). Not yet stored in Supabase: see docs/integrations/call-schedule.md.
 */
export interface CallSchedule {
  /** Basic only. null until the owner chooses a day. */
  day: Weekday | null;
  /** "HH:MM", 24h, Asia/Riyadh. "" until the owner chooses a time. */
  time: string;
}

export interface ReportAnswer {
  questionId: string;
  question: LocalizedText;
  /** What the worker said, in plain words. */
  answer: string;
  /** Same answer in both UI languages when it was a fixed choice (free text stays only in `answer`). */
  answerText?: LocalizedText;
  certainty: Certainty;
  /** True when the AI asked it as a contextual follow-up (does not count toward Basic's 5). */
  followUp: boolean;
}

export interface Finding {
  id: string;
  criterionId: string;
  text: LocalizedText;
}

export interface FarmReport {
  id: string;
  at: string;
  callId: string;
  mode?: "guided" | "open";
  coverage?: { questionId: string; status: "reported" | "unknown" | "not_reported" }[];
  answers: ReportAnswer[];
  findings: Finding[];
  /**
   * Camels the worker counted on this call, if asked. A proposal only: the official
   * `settings.herdCount` changes only when the owner accepts it.
   */
  herdCountReported?: number | null;
}

export type CallKind =
  | "worker_report" // regular farm update (NAQAH → worker on schedule, or the worker returning a missed report call)
  | "worker_report_rejected" // worker → AI, not returning a report call / limit used
  | "worker_report_missed" // NAQAH → worker, report call unanswered (one log per attempt)
  | "worker_callback" // worker → AI, returning a missed AI call (No Answer Ticket)
  | "worker_instruction" // AI → worker, delivering owner's instruction / task
  | "worker_task_verification" // AI → worker, at a task's scheduled time
  | "owner_notification" // AI → owner, after a successful update
  | "owner_inquiry" // owner → AI
  | "owner_inquiry_rejected"; // owner → AI, Basic weekly allowance used

export type CallOutcome = "completed" | "no_answer" | "rejected";

export interface CallLog {
  id: string;
  kind: CallKind;
  /** Structured marker for a Basic owner callback after a missed notification. */
  reason?: "missed_notification_callback";
  direction: "inbound" | "outbound";
  party: "worker" | "owner";
  at: string;
  outcome: CallOutcome;
  /** 1 = initial attempt, 2..4 = retries (worker outbound calls). */
  attempt: number | null;
  summary: LocalizedText;
  ticketId: string | null;
  reportId: string | null;
}

export interface TaskTicket {
  id: string;
  /** The owner's instruction, in the owner's words. */
  instruction: string;
  createdAt: string;
  /** null = "any time" (no separate verification call; asked during later interactions). */
  scheduledFor: string | null;
  status: "open" | "closed";
  closedAt: string | null;
  /** Set when the worker explicitly confirmed completion. */
  closedVia: CallKind | null;
}

export interface NoAnswerTicket {
  id: string;
  createdAt: string;
  purpose: "instruction" | "task_verification";
  /** What the worker missed. */
  message: string;
  taskTicketId: string | null;
  status: "open" | "closed";
  closedAt: string | null;
}

/**
 * An AI → worker call that may need retries
 * (3 attempts total, 20 minutes apart, then stop; no new No Answer Ticket).
 */
export interface PendingWorkerCall {
  id: string;
  purpose: "instruction" | "task_verification";
  message: string;
  taskTicketId: string | null;
  relayId: string | null;
  attempts: { at: string; answered: boolean }[];
  /** When the next attempt is due; null when finished. */
  nextAttemptAt: string | null;
  state: "pending" | "delivered" | "no_answer_ticket";
  dialClaimedAt?: string | null;
  /** Attempts already used when the owner asked for another try; only later attempts count toward the three. */
  retryBase?: number;
  /** Task C's approved conversation batch/event identity; optional for legacy calls. */
  batchId?: string;
  /** Ordered Task C associations. Absent preserves legacy storage; [] means no grouped tasks. */
  coveredTaskIds?: string[];
}

/** Result of one placed report-call attempt. "pending" while the phone is ringing. */
export type ReportCallAttemptResult = "pending" | "answered" | "no_answer";

/**
 * One scheduled (or owner-triggered) report call: NAQAH → primary worker.
 * Initial attempt + up to 2 retries, 20 minutes apart, then "missed".
 * `occurrence` is unique per farm, so a re-run scheduler can never call twice for the same slot.
 */
export interface ReportCallRun {
  id: string;
  /** ISO time of the scheduled slot, or of the owner's "Call now" press. */
  occurrence: string;
  trigger: "schedule" | "manual";
  attempts: { at: string; result: ReportCallAttemptResult }[];
  /** When the next attempt should be placed; null while ringing or when finished. */
  nextAttemptAt: string | null;
  /** calling: attempts remain · answered: the worker picked up · completed: report saved · missed: no answer after retries. */
  state: "calling" | "answered" | "completed" | "missed";
  reportId: string | null;
}

/** Result of one placed owner-call attempt. "pending" while the phone rings or the call runs. */
export type OwnerAttemptResult = "pending" | "unanswered" | "interrupted" | "completed";

/**
 * One scheduled NAQAH → owner call: 3 attempts, 20 minutes apart, then "missed".
 * Only the current or latest run is kept; the call log is the history.
 */
export interface OwnerCallRun {
  id: string;
  /** ISO time of the owner's scheduled slot. */
  occurrence: string;
  /** The report summarized on this run. null: the owner is told no verified report has arrived. */
  reportId: string | null;
  attempts: { at: string; result: OwnerAttemptResult; placementUnknown?: boolean }[];
  /** When the next attempt should be placed; null while ringing or when finished. */
  nextAttemptAt: string | null;
  state: "calling" | "answered" | "completed" | "missed";
  /** LOCAL DEMO ONLY: opened from the Dashboard, not the schedule. One attempt, never retried. Absent: scheduled. */
  trigger?: "manual";
}

/** A message relayed to the worker (Basic relays without a ticket). */
export interface Relay {
  id: string;
  at: string;
  message: string;
  delivered: boolean;
}

export type EventTone = "neutral" | "success" | "attention" | "danger";

/** Platform activity feed. What NAQAH did, in plain words. */
export interface PlatformEvent {
  id: string;
  at: string;
  tone: EventTone;
  text: LocalizedText;
}

export interface Settings {
  plan: Plan;
  owner: Owner;
  farm: Farm;
  /** The primary reporting worker: the one NAQAH calls for the report. */
  worker: Worker;
  /** Other registered workers. Primary + others ≤ PLAN_LIMITS[plan].workers. Optional: older workspaces lack it. */
  otherWorkers?: Worker[];
  /** Official camel count. Owner-controlled; a worker's count is only a proposal. null = not entered. */
  herdCount?: number | null;
  /** Reports at or before this time have had their reported count reviewed by the owner. */
  herdCountReviewedAt?: string | null;
  customQuestions: CustomQuestion[];
  /** Older stored demo workspaces lack it: read as "guided". */
  reportMode: ReportMode;
  /** What the call asks and in what order. Empty, or missing on older stored demo workspaces: everything on and required, in today's order. */
  questionPlan: QuestionPlanEntry[];
  criteria: Criterion[];
  emergencies: EmergencyCategory[];
  /** RETIRED worker-calls-in window. Never read by rules or screens; kept for stored data. */
  window: ReportingWindow | null;
  /** NAQAH → worker report call time. Optional: older workspaces lack it. */
  callSchedule?: CallSchedule | null;
  /** When NAQAH calls the owner with the saved report. Separate from the worker's report time. */
  ownerCallSchedule?: CallSchedule | null;
  integrations?: Integrations;
}

export interface Workspace {
  version: 1;
  /** True once the owner finishes or skips the guided setup; call readiness is tracked separately. */
  setupComplete: boolean;
  createdAt: string;
  settings: Settings;
  camels: Camel[];
  resources: Resource[];
  /** Time of the latest successful farm update. */
  lastUpdateAt: string | null;
  reports: FarmReport[];
  /** The current or latest scheduled owner call. Undefined until a farm's store can hold it. */
  ownerCallRun?: OwnerCallRun | null;
  calls: CallLog[];
  taskTickets: TaskTicket[];
  noAnswerTickets: NoAnswerTicket[];
  pendingWorkerCalls: PendingWorkerCall[];
  /** Scheduled report calls NAQAH placed (or is placing). Optional: older workspaces lack it. */
  reportCalls?: ReportCallRun[];
  relays: Relay[];
  events: PlatformEvent[];
  /** Simulated clock for the investor demo: now = real now + offset. */
  clockOffsetMs: number;
  /** Latest farm forecast, if the farm has coordinates. Optional: older workspaces lack it. */
  weather?: WeatherSnapshot | null;
  /**
   * Basic: the owner's one call this week. Set when an answered notification or an
   * owner inquiry consumes it. Week = Sunday 00:00 → Saturday 23:59 Riyadh.
   */
  ownerAllowanceUsedAt: string | null;
  /** Basic: a missed notification allows ONE owner callback. */
  missedNotificationAt: string | null;
}
