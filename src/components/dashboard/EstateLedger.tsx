"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ButtonLink } from "@/components/ui";
import { CertaintyBadge, ConditionLabel, HealthBadge, ResourceMeter, isConditionResource } from "@/components/dashboard/DashboardPrimitives";
import { MessageWorkerLink, OrderSupplierLink } from "@/components/integrations/WhatsAppActions";
import { EMERGENCY_LABELS, RESOURCE_LABELS, levelLabel } from "@/domain";
import type { Camel, FarmReport, Workspace } from "@/domain";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/cn";
import { ReportAnswers } from "./ReportAnswers";

const ROSTER_LIMIT = 8;
const concern: Record<Camel["health"], number> = { sick: 0, watch: 1, unknown: 2, healthy: 3 };

const levelText = { good: "text-ok", medium: "text-espresso", low: "text-warn", critical: "text-danger", unknown: "text-muted" } as const;

function LedgerSection({ id, title, note, action, className, children }: {
  id: string;
  title: string;
  note?: ReactNode;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className={cn("min-w-0 px-5 py-5 sm:px-8 sm:py-6", className)}>
      <div className="flex min-h-11 items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={id} className="text-lg font-semibold leading-snug text-espresso">{title}</h2>
          {note ? <p className="mt-0.5 text-sm leading-relaxed text-muted">{note}</p> : null}
        </div>
        {action}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function SectionLink({ href, children }: { href: string; children: ReactNode }) {
  return <ButtonLink href={href} variant="ghost" size="sm" className="-me-3 min-h-11 text-brown">{children}</ButtonLink>;
}

function HerdRoster({ ws, hasReport }: { ws: Workspace; hasReport: boolean }) {
  const { m, fmt, href } = useI18n();
  const app = m.app;
  const count = (health: Camel["health"]) => ws.camels.filter((camel) => camel.health === health).length;
  // Healthy is the quiet default, so the line names only what isn't.
  const parts: [number, string][] = [
    [count("watch"), app.overview.watch],
    [count("sick"), app.overview.sick],
    [count("unknown"), app.overview.unknown],
  ];
  const roster = [...ws.camels].sort((a, b) => concern[a.health] - concern[b.health]).slice(0, ROSTER_LIMIT);
  const hidden = ws.camels.length - roster.length;
  // Before any report, "unknown" says nothing new: the herd is listed by name only.
  const showHealth = (camel: Camel) => hasReport || camel.health !== "unknown";

  return (
    <LedgerSection
      id="ledger-herd"
      title={app.herd.title}
      className="lg:col-span-7"
      note={ws.camels.length ? (
        <>
          <span className="whitespace-nowrap">{app.herd.count(fmt.number(ws.camels.length))}</span>
          {hasReport ? parts.filter(([value]) => value > 0).map(([value, label]) => (
            <span key={label}> <span className="whitespace-nowrap"><span aria-hidden>· </span><span className="ltr-nums">{fmt.number(value)}</span> {label}</span></span>
          )) : null}
        </>
      ) : undefined}
      action={ws.camels.length ? <SectionLink href={href("/app/herd")}>{app.overview.viewHerd}</SectionLink> : undefined}
    >
      {roster.length ? (
        <ul className="grid gap-x-8 sm:grid-cols-2">
          {roster.map((camel) => (
            <li key={camel.id} className="flex min-h-12 items-center justify-between gap-3 border-b border-stone/70">
              <Link href={`${href("/app/herd")}#camel-${camel.id}`} className="flex min-h-11 min-w-0 items-center font-semibold text-espresso underline decoration-transparent underline-offset-4 hover:decoration-brown">
                <span className="truncate">{camel.name}</span>
              </Link>
              {showHealth(camel) ? <HealthBadge health={camel.health} /> : null}
            </li>
          ))}
        </ul>
      ) : <ButtonLink href={href("/app/herd")} variant="secondary">{app.overview.addCamels}</ButtonLink>}
      {hidden > 0 ? <p className="mt-3 text-sm text-muted">{app.overview.moreCamels(fmt.number(hidden))}</p> : null}
    </LedgerSection>
  );
}

function ResourcesSection({ ws, alone }: { ws: Workspace; alone: boolean }) {
  const { m, t } = useI18n();
  const app = m.app;
  const present = ws.resources.filter((resource) => resource.present);
  const absent = ws.resources.filter((resource) => !resource.present);

  return (
    <LedgerSection
      id="ledger-resources"
      title={app.overview.resources}
      className={cn("border-t border-stone/70", alone ? "lg:col-span-12" : "lg:col-span-5 lg:border-s lg:border-t-0")}
    >
      <ul>
        {present.map((resource) => (
          <li key={resource.kind} className="flex min-h-12 items-center justify-between gap-3 border-b border-stone/70 py-1.5">
            <p className="flex min-w-0 flex-wrap items-baseline gap-x-2">
              <span className="font-semibold text-espresso">{t(RESOURCE_LABELS[resource.kind])}</span>
              {isConditionResource(resource.kind) ? null : <span className={`text-sm font-medium ${levelText[resource.level]}`}>{t(levelLabel(resource.kind, resource.level))}</span>}
              {resource.quantity ? <span className="text-sm text-muted">{resource.quantity}</span> : null}
              {resource.certainty !== "reported" ? <CertaintyBadge certainty={resource.certainty} /> : null}
            </p>
            {isConditionResource(resource.kind) ? <ConditionLabel kind={resource.kind} level={resource.level} /> : <ResourceMeter kind={resource.kind} level={resource.level} />}
          </li>
        ))}
      </ul>
      {absent.length ? <p className="mt-3 text-sm text-muted">{app.overview.absentResources(absent.map((resource) => t(RESOURCE_LABELS[resource.kind])).join("، "))}</p> : null}
      <OrderSupplierLink kinds={["feed", "water"]} />
    </LedgerSection>
  );
}

/** The owner's own questions, answered on the latest report call. NAQAH's questions show as herd and supplies. */
function AnswersSection({ ws, report }: { ws: Workspace; report: FarmReport }) {
  const { m, href } = useI18n();
  const custom = new Set(ws.settings.customQuestions.map((question) => question.id));
  const answers = report.answers.filter((answer) => custom.has(answer.questionId) && !answer.followUp);
  if (!answers.length) return null;
  return (
    <LedgerSection
      id="ledger-answers"
      title={m.app.overview.answers}
      className="border-t border-stone/70 lg:col-span-7"
      action={<SectionLink href={href("/app/calls")}>{m.app.overview.viewCalls}</SectionLink>}
    >
      <ReportAnswers answers={answers} />
    </LedgerSection>
  );
}

type Placement = "beside-herd" | "beside-answers" | "wide";
const placement: Record<Placement, string> = {
  "beside-herd": "lg:col-span-5 lg:border-s lg:border-t-0",
  "beside-answers": "lg:col-span-5 lg:border-s",
  wide: "lg:col-span-12",
};

function WorkerSection({ ws, worker, allowance, place }: { ws: Workspace; worker: string; allowance: ReactNode; place: Placement }) {
  const { m, t, href, locale } = useI18n();
  const app = m.app;
  const phone = ws.settings.worker.phone.trim();
  const categories = ws.settings.emergencies.map((category) =>
    category.kind === "custom" ? category.label || app.overview.unknown : t(EMERGENCY_LABELS[category.kind]),
  );
  return (
    <LedgerSection
      id="ledger-emergency"
      title={app.overview.emergency}
      note={app.overview.emergencyInstructions}
      className={cn("border-t border-stone/70", placement[place])}
    >
      <p className="flex flex-wrap items-baseline gap-x-3 font-semibold text-espresso">
        <span>{worker}</span>
        {phone ? <span className="ltr-nums font-medium text-muted">{phone}</span> : null}
      </p>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        {categories.length ? categories.join(locale === "ar" ? "، " : ", ") : app.overview.noEmergencyCategories}
      </p>
      <div className="mt-1 flex flex-wrap items-center gap-x-5">
        <MessageWorkerLink />
        <Link href={`${href("/app/settings")}#settings-emergencies`} className="inline-flex min-h-11 items-center text-brown underline decoration-stone underline-offset-4 hover:decoration-brown">{app.overview.setupEmergencies}</Link>
      </div>
      {allowance}
    </LedgerSection>
  );
}

/** Everything else about the estate, on one surface: hairlines divide it, not separate cards. */
export function EstateLedger({ ws, worker, hasReport, latestReport, allowance }: {
  ws: Workspace;
  worker: string;
  hasReport: boolean;
  latestReport: FarmReport | null;
  allowance: ReactNode;
}) {
  const custom = new Set(ws.settings.customQuestions.map((question) => question.id));
  const hasAnswers = Boolean(latestReport?.answers.some((answer) => custom.has(answer.questionId) && !answer.followUp));
  const herd = ws.camels.length > 0;
  return (
    <div className="naqah-rise grid overflow-hidden rounded-[var(--radius-card)] border border-stone/70 bg-cream lg:grid-cols-12 [&>section:first-child]:border-t-0">
      {herd ? <HerdRoster ws={ws} hasReport={hasReport} /> : null}
      {hasReport ? <ResourcesSection ws={ws} alone={!herd} /> : null}
      {latestReport && hasAnswers ? <AnswersSection ws={ws} report={latestReport} /> : null}
      <WorkerSection ws={ws} worker={worker} allowance={allowance} place={hasAnswers ? "beside-answers" : herd && !hasReport ? "beside-herd" : "wide"} />
    </div>
  );
}
