"use client";

import { CheckCircle, Circle, WarningCircle } from "@phosphor-icons/react";
import Link from "next/link";
import type { ReactNode } from "react";
import { ButtonLink } from "@/components/ui";
import { CertaintyBadge, ConditionLabel, HealthBadge, ResourceMeter, isConditionResource } from "@/components/dashboard/DashboardPrimitives";
import { MessageWorkerLink, OrderSupplierLink } from "@/components/integrations/WhatsAppActions";
import { EMERGENCY_LABELS, RESOURCE_LABELS, levelLabel } from "@/domain";
import type { Camel, EventTone, Workspace } from "@/domain";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/cn";

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

function HerdRoster({ ws, now }: { ws: Workspace; now: Date }) {
  const { m, fmt, href } = useI18n();
  const app = m.app;
  const count = (health: Camel["health"]) => ws.camels.filter((camel) => camel.health === health).length;
  const parts: [number, string][] = [
    [count("healthy"), app.overview.healthy],
    [count("watch"), app.overview.watch],
    [count("sick"), app.overview.sick],
    [count("unknown"), app.overview.unknown],
  ];
  const roster = [...ws.camels].sort((a, b) => concern[a.health] - concern[b.health]).slice(0, ROSTER_LIMIT);
  const hidden = ws.camels.length - roster.length;
  const newest = ws.camels.map((camel) => camel.updatedAt).filter((at): at is string => Boolean(at)).sort().at(-1);
  const reported = ws.camels.some((camel) => camel.certainty === "reported" || camel.certainty === "approximate");

  return (
    <LedgerSection
      id="ledger-herd"
      title={app.herd.title}
      className="border-stone/70 max-lg:border-t lg:col-span-7"
      note={ws.camels.length ? (
        <>
          <span className="whitespace-nowrap">{app.herd.count(fmt.number(ws.camels.length))}</span>
          {parts.filter(([value]) => value > 0).map(([value, label]) => (
            <span key={label}><span aria-hidden> · </span><span className="whitespace-nowrap"><span className="ltr-nums">{fmt.number(value)}</span> {label}</span></span>
          ))}
          {reported && newest ? <span className="block">{app.labels.reported}<span aria-hidden> · </span>{app.overview.updated(fmt.relative(newest, now))}</span> : null}
        </>
      ) : undefined}
      action={ws.camels.length ? <SectionLink href={href("/app/herd")}>{app.overview.viewHerd}</SectionLink> : undefined}
    >
      {roster.length ? (
        <ul className="grid gap-x-8 sm:grid-cols-2">
          {roster.map((camel) => (
            <li key={camel.id} className="flex min-h-12 items-center justify-between gap-3 border-b border-stone/70">
              <span className="min-w-0 truncate font-semibold text-espresso">{camel.name}</span>
              <HealthBadge health={camel.health} />
            </li>
          ))}
        </ul>
      ) : <ButtonLink href={href("/app/herd")} variant="secondary">{app.overview.addCamels}</ButtonLink>}
      {hidden > 0 ? <p className="mt-3 text-sm text-muted">{app.overview.moreCamels(fmt.number(hidden))}</p> : null}
    </LedgerSection>
  );
}

function ResourcesSection({ ws, now }: { ws: Workspace; now: Date }) {
  const { m, t, fmt } = useI18n();
  const app = m.app;
  const present = ws.resources.filter((resource) => resource.present);
  const absent = ws.resources.filter((resource) => !resource.present);
  const newest = present.map((resource) => resource.updatedAt).filter((at): at is string => Boolean(at)).sort().at(-1);

  return (
    <LedgerSection
      id="ledger-resources"
      title={app.overview.resources}
      note={newest ? <>{app.labels.reported}<span aria-hidden> · </span>{app.overview.updated(fmt.relative(newest, now))}</> : undefined}
      className="border-t border-stone/70 lg:col-span-5 lg:border-s lg:border-t-0"
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

function EventMarker({ tone }: { tone: EventTone }) {
  const Icon = tone === "success" ? CheckCircle : tone === "attention" || tone === "danger" ? WarningCircle : Circle;
  const className = tone === "success" ? "text-ok" : tone === "attention" ? "text-warn" : tone === "danger" ? "text-danger" : "text-muted";
  return <Icon size={18} weight="fill" className={className} aria-hidden />;
}

function ActivitySection({ ws, now }: { ws: Workspace; now: Date }) {
  const { m, t, fmt, href } = useI18n();
  const events = [...ws.events].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 4);
  return (
    <LedgerSection
      id="ledger-activity"
      title={m.app.overview.activity}
      className="border-t border-stone/70 lg:col-span-7"
      action={<SectionLink href={href("/app/calls")}>{m.app.overview.viewCalls}</SectionLink>}
    >
      <ul>
        {events.map((event) => (
          <li key={event.id} className="flex items-start gap-3 py-2 first:pt-0">
            <span className="mt-1"><EventMarker tone={event.tone} /></span>
            <p className="min-w-0 flex-1 leading-relaxed text-espresso">{t(event.text)}</p>
            <span className="shrink-0 pt-0.5 text-[0.8125rem] text-muted">{fmt.relative(event.at, now)}</span>
          </li>
        ))}
      </ul>
    </LedgerSection>
  );
}

function WorkerSection({ ws, worker, allowance, wide }: { ws: Workspace; worker: string; allowance: ReactNode; wide: boolean }) {
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
      className={cn("border-stone/70 max-lg:order-first lg:border-t", wide ? "lg:col-span-12" : "lg:col-span-5 lg:border-s")}
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
export function EstateLedger({ ws, worker, now, hasReport, allowance }: {
  ws: Workspace;
  worker: string;
  now: Date;
  hasReport: boolean;
  allowance: ReactNode;
}) {
  const showActivity = hasReport && ws.events.length > 0;
  return (
    <div className="grid overflow-hidden rounded-[var(--radius-card)] border border-stone/70 bg-cream lg:grid-cols-12">
      <HerdRoster ws={ws} now={now} />
      {hasReport ? <ResourcesSection ws={ws} now={now} /> : null}
      {showActivity ? <ActivitySection ws={ws} now={now} /> : null}
      <WorkerSection ws={ws} worker={worker} allowance={allowance} wide={hasReport && !showActivity} />
    </div>
  );
}

