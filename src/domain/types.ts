/**
 * NAQAH domain model.
 *
 * One owner → one farm → one worker (MVP scope). Everything the owner sees and
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

export interface Farm {
  name: string;
  location: string;
}

export interface Worker {
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

/** Prepared by the NAQAH team. Mandatory when applicable. Wording is a DRAFT. */
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

/** Basic only. Owner sets start AND end explicitly — no default duration is assumed. */
export interface ReportingWindow {
  day: Weekday;
  /** "HH:MM", 24h, Asia/Riyadh */
  start: string;
  end: string;
}

export interface ReportAnswer {
  questionId: string;
  question: LocalizedText;
  /** What the worker said, in plain words. */
  answer: string;
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
  answers: ReportAnswer[];
  findings: Finding[];
}

export type CallKind =
  | "worker_report" // worker → AI, regular farm update
  | "worker_report_rejected" // worker → AI, outside window / limit used
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
 * (initial attempt + up to 3 retries, 20 minutes apart, then a No Answer Ticket).
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
  worker: Worker;
  customQuestions: CustomQuestion[];
  criteria: Criterion[];
  emergencies: EmergencyCategory[];
  /** Basic only. */
  window: ReportingWindow | null;
}

export interface Workspace {
  version: 1;
  /** False until onboarding is confirmed. */
  setupComplete: boolean;
  createdAt: string;
  settings: Settings;
  camels: Camel[];
  resources: Resource[];
  /** Time of the latest successful farm update. */
  lastUpdateAt: string | null;
  reports: FarmReport[];
  calls: CallLog[];
  taskTickets: TaskTicket[];
  noAnswerTickets: NoAnswerTicket[];
  pendingWorkerCalls: PendingWorkerCall[];
  relays: Relay[];
  events: PlatformEvent[];
  /** Simulated clock for the investor demo: now = real now + offset. */
  clockOffsetMs: number;
  /**
   * Basic: the owner's one call this week. Set when an answered notification or an
   * owner inquiry consumes it. Week = Sunday 00:00 → Saturday 23:59 Riyadh.
   */
  ownerAllowanceUsedAt: string | null;
  /** Basic: a missed notification allows ONE owner callback. */
  missedNotificationAt: string | null;
}
