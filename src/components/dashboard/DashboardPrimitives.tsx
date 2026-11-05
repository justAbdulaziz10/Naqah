import type { ReactNode } from "react";
import { CamelMark } from "@/components/brand/CamelMark";
import { CERTAINTY_LABELS, HEALTH_LABELS, MAX_RETRIES, RESOURCE_LABELS, levelLabel } from "@/domain";
import type { CallOutcome, Certainty, HealthStatus, Level, ResourceKind, Workspace, NoAnswerTicket } from "@/domain";
import { useI18n } from "@/i18n/client";

const healthText: Record<HealthStatus, string> = {
  healthy: "text-ok",
  watch: "text-warn",
  sick: "text-danger",
  unknown: "text-muted",
};

const outcomeText: Record<CallOutcome, string> = {
  completed: "text-ok",
  no_answer: "text-warn",
  rejected: "text-muted",
};

/** Health is a coloured dot and a word; not a pill. */
export function HealthBadge({ health }: { health: HealthStatus }) {
  const { t } = useI18n();
  return (
    <span className={`inline-flex items-center gap-1.5 text-sm font-semibold ${healthText[health]}`}>
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      {t(HEALTH_LABELS[health])}
    </span>
  );
}

/** Certainty is provenance metadata, so it reads as quiet text beside the fact. */
export function CertaintyBadge({ certainty }: { certainty: Certainty }) {
  const { t } = useI18n();
  return (
    <span className={`text-[0.8125rem] ${certainty === "verified" ? "font-semibold text-ok" : "text-muted"}`}>
      {t(CERTAINTY_LABELS[certainty])}
    </span>
  );
}

export function OutcomeBadge({ outcome }: { outcome: CallOutcome }) {
  const { m } = useI18n();
  const labels = {
    completed: m.app.calls.completed,
    no_answer: m.app.calls.noAnswer,
    rejected: m.app.calls.rejected,
  };
  return <span className={`text-sm font-semibold ${outcomeText[outcome]}`}>{labels[outcome]}</span>;
}

const meterTone: Record<Exclude<Level, "unknown">, string> = {
  good: "bg-ok",
  medium: "bg-brown",
  low: "bg-warn",
  critical: "bg-danger",
};

/** Stock is an amount, so "about half" fills half. */
const stockFill: Record<Exclude<Level, "unknown">, number> = { good: 4, medium: 2, low: 1, critical: 1 };

const conditionText: Record<Level, string> = {
  good: "text-ok",
  medium: "text-warn",
  low: "text-warn",
  critical: "text-danger",
  unknown: "text-muted",
};

/** Fences and shelter are a condition, not an amount, so they read as a word and never a gauge. */
export const isConditionResource = (kind: ResourceKind) => kind === "fences" || kind === "shelter";

export function ConditionLabel({ kind, level }: { kind: ResourceKind; level: Level }) {
  const { t } = useI18n();
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 text-sm font-semibold ${conditionText[level]}`}>
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      {t(levelLabel(kind, level))}
    </span>
  );
}

export function ResourceMeter({ kind, level }: { kind: ResourceKind; level: Level }) {
  const { t } = useI18n();
  return (
    <span
      className="inline-flex w-24 shrink-0 gap-1"
      role="img"
      aria-label={`${t(RESOURCE_LABELS[kind])}: ${t(levelLabel(kind, level))}`}
    >
      {Array.from({ length: 4 }, (_, index) => (
        <span
          key={index}
          aria-hidden
          className={
            level === "unknown"
              ? "h-2.5 flex-1 rounded-sm border border-dashed border-stone bg-ivory"
              : `h-2.5 flex-1 rounded-sm ${index < stockFill[level] ? meterTone[level] : "bg-stone/50"}`
          }
        />
      ))}
    </span>
  );
}

export function EmptyState({
  title,
  body,
  action,
  camel = false,
}: {
  title: string;
  body?: string;
  action?: ReactNode;
  camel?: boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
      {camel ? <CamelMark className="mb-2 h-10 w-auto" /> : null}
      <p className="font-semibold text-espresso">{title}</p>
      {body ? <p className="max-w-md text-sm text-muted">{body}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function noAnswerAttemptInfo(ws: Workspace, ticket: NoAnswerTicket) {
  const matching = ws.pendingWorkerCalls
    .filter(
      (call) =>
        call.state === "no_answer_ticket" &&
        call.purpose === ticket.purpose &&
        call.taskTicketId === ticket.taskTicketId &&
        call.message === ticket.message,
    )
    .sort((a, b) => {
      const aAt = a.attempts.at(-1)?.at ?? "";
      const bAt = b.attempts.at(-1)?.at ?? "";
      return Math.abs(Date.parse(aAt) - Date.parse(ticket.createdAt)) - Math.abs(Date.parse(bAt) - Date.parse(ticket.createdAt));
    })[0];

  if (matching?.attempts.length) {
    const lastAttempt = matching.attempts.at(-1)?.at;
    return { count: matching.attempts.length, lastAttemptAt: lastAttempt ?? ticket.createdAt };
  }

  const kind = ticket.purpose === "instruction" ? "worker_instruction" : "worker_task_verification";
  const attempts = ws.calls.filter(
    (call) =>
      call.kind === kind &&
      call.outcome === "no_answer" &&
      call.ticketId === ticket.taskTicketId &&
      Date.parse(call.at) <= Date.parse(ticket.createdAt),
  );
  return { count: attempts.length || MAX_RETRIES + 1, lastAttemptAt: attempts.at(-1)?.at ?? ticket.createdAt };
}
