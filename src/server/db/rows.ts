import type {
  CallKind, CallOutcome, Camel, Certainty, CriterionKind, EmergencyKind, EventTone, HealthStatus, Level,
  Plan, ResourceKind, WorkerLanguage,
} from "@/domain/types";

/**
 * Hand-written from supabase/migrations. Replace with `supabase gen types` output once the
 * schema is applied to the project.
 */
export interface FarmRow {
  id: string;
  owner_id: string;
  plan: Plan;
  setup_complete: boolean;
  owner_name: string;
  owner_phone: string;
  name: string;
  location: string;
  latitude: number | null;
  longitude: number | null;
  supplier_name: string;
  supplier_phone: string;
  window_day: number | null;
  window_start: string | null;
  window_end: string | null;
  last_update_at: string | null;
  owner_allowance_used_at: string | null;
  missed_notification_at: string | null;
  created_at: string;
  revision: number;
}
export interface WorkerRow { farm_id: string; name: string; phone: string; language: WorkerLanguage }
export interface CamelRow {
  id: string;
  farm_id: string;
  name: string;
  tag: string;
  sex: Camel["sex"];
  age_years: number | null;
  health: HealthStatus;
  health_note: string | null;
  certainty: Certainty;
  updated_at: string | null;
}
export interface ResourceRow {
  farm_id: string;
  kind: ResourceKind;
  present: boolean;
  level: Level;
  quantity: string | null;
  note: string | null;
  certainty: Certainty;
  updated_at: string | null;
}
export interface CustomQuestionRow { id: string; farm_id: string; text: string; sort_order: number; created_at: string }
export interface CriterionRow { id: string; farm_id: string; kind: CriterionKind; label: string | null; enabled: boolean }
export interface EmergencyRow { id: string; farm_id: string; kind: EmergencyKind; label: string | null }
export interface ReportAnswerRow {
  report_id: string;
  question_id: string;
  question_ar: string;
  question_en: string;
  answer: string;
  answer_ar: string | null;
  answer_en: string | null;
  certainty: Certainty;
  follow_up: boolean;
  sort_order: number;
}
export interface FindingRow {
  id: string;
  report_id: string;
  criterion_id: string | null;
  source: string | null;
  text_ar: string;
  text_en: string;
}
export interface ReportRow { id: string; farm_id: string; call_id: string | null; at: string }
export interface ReportWithFacts extends ReportRow { report_answers: ReportAnswerRow[]; findings: FindingRow[] }
export interface CallRow {
  id: string;
  farm_id: string;
  kind: CallKind;
  direction: "inbound" | "outbound";
  party: "worker" | "owner";
  at: string;
  outcome: CallOutcome;
  attempt: number | null;
  summary_ar: string;
  summary_en: string;
  provider_call_id: string | null;
  task_ticket_id: string | null;
  report_id: string | null;
  no_answer_ticket_id: string | null;
}
export interface TaskTicketRow {
  id: string;
  farm_id: string;
  instruction: string;
  created_at: string;
  scheduled_for: string | null;
  status: "open" | "closed";
  closed_at: string | null;
  closed_via: CallKind | null;
}
export interface NoAnswerTicketRow {
  id: string;
  farm_id: string;
  created_at: string;
  purpose: "instruction" | "task_verification";
  message: string;
  task_ticket_id: string | null;
  status: "open" | "closed";
  closed_at: string | null;
}
export interface PendingWorkerCallRow {
  id: string;
  farm_id: string;
  purpose: "instruction" | "task_verification";
  message: string;
  task_ticket_id: string | null;
  relay_id: string | null;
  next_attempt_at: string | null;
  state: "pending" | "delivered" | "no_answer_ticket";
}
export interface WorkerCallAttemptRow { pending_call_id: string; at: string; answered: boolean }
export interface PendingCallWithAttempts extends PendingWorkerCallRow { worker_call_attempts: WorkerCallAttemptRow[] }
export interface RelayRow { id: string; farm_id: string; at: string; message: string; delivered: boolean }
export interface EventRow { id: string; farm_id: string; at: string; tone: EventTone; text_ar: string; text_en: string }

export interface FarmRows {
  farm: FarmRow;
  worker: WorkerRow | null;
  camels: CamelRow[];
  resources: ResourceRow[];
  customQuestions: CustomQuestionRow[];
  criteria: CriterionRow[];
  emergencies: EmergencyRow[];
  reports: ReportWithFacts[];
  calls: CallRow[];
  taskTickets: TaskTicketRow[];
  noAnswerTickets: NoAnswerTicketRow[];
  pendingWorkerCalls: PendingCallWithAttempts[];
  relays: RelayRow[];
  events: EventRow[];
}
