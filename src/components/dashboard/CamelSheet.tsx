"use client";

import { PencilSimple } from "@phosphor-icons/react";
import Link from "next/link";
import { Button, Sheet } from "@/components/ui";
import type { Camel, Workspace } from "@/domain";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/cn";
import { useNow } from "@/store/workspace";
import { CertaintyBadge, HealthBadge } from "./DashboardPrimitives";
import { mentions } from "./matters";

interface Moment {
  key: string;
  at: string;
  title: string;
  text: string;
  waiting?: boolean;
  href?: string;
}

const when = { weekday: "short", day: "numeric", month: "short", hour: undefined, minute: undefined } as const;

/**
 * One camel, one step away from the herd list: its health as last recorded and by whom, its
 * details, and everything the records say about it by name: report findings and the owner's tasks,
 * newest first. Records hold no link to a camel, so this matches whole names for display only.
 */
export function CamelSheet({ ws, camel, onClose, onEdit }: { ws: Workspace; camel: Camel; onClose: () => void; onEdit: () => void }) {
  const { m, t, fmt, href } = useI18n();
  const h = m.app.herd;
  const now = useNow();
  const about = (text: string) => mentions(text, camel.name);
  const moments: Moment[] = [
    ...ws.reports.flatMap((report) =>
      report.findings
        .filter((finding) => about(finding.text.ar) || about(finding.text.en))
        .map((finding) => ({ key: finding.id, at: report.at, title: h.inReport, text: t(finding.text) })),
    ),
    ...(ws.settings.plan === "ultimate" ? ws.taskTickets : [])
      .filter((ticket) => about(ticket.instruction))
      .map((ticket) => ({
        key: ticket.id,
        at: ticket.createdAt,
        title: ticket.status === "open" ? h.taskOpen : h.taskDone,
        text: ticket.instruction,
        waiting: ticket.status === "open",
        href: `${href("/app/tickets")}#task-${ticket.id}`,
      })),
  ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const details = [
    camel.sex === "female" ? h.female : h.male,
    camel.ageYears === null ? h.ageUnknown : h.ageYears(fmt.number(camel.ageYears)),
  ];

  return (
    <Sheet
      title={camel.name}
      description={<>{details.join(" · ")}{camel.tag ? <> · <bdi className="ltr-nums">{camel.tag}</bdi></> : null}</>}
      closeLabel={m.common.actions.close}
      onClose={onClose}
      footer={
        <Button variant="secondary" className="w-full sm:w-auto" onClick={onEdit}>
          <PencilSimple size={17} aria-hidden />
          {h.editDetails}
        </Button>
      }
    >
      <section aria-label={h.health} className="rounded-2xl border border-stone/70 bg-ivory/60 px-5 py-4">
        <div className="text-lg"><HealthBadge health={camel.health} /></div>
        {camel.healthNote ? <p className="mt-1.5 text-lg font-medium leading-relaxed text-espresso">{camel.healthNote}</p> : null}
        <p className="mt-2 flex flex-wrap gap-x-2 text-[0.8125rem] text-muted">
          <CertaintyBadge certainty={camel.certainty} />
          <span aria-hidden>·</span>
          <span>{camel.updatedAt ? h.updated(fmt.relative(camel.updatedAt, now)) : h.neverUpdated}</span>
        </p>
      </section>

      <section aria-labelledby="camel-history" className="mt-8">
        <h3 id="camel-history" className="text-sm font-semibold text-muted">{h.history}</h3>
        {moments.length ? (
          <ol className="mt-4">
            {moments.map((moment, index) => (
              <li key={moment.key} className="relative ps-7 pb-6 last:pb-0">
                {index < moments.length - 1 ? <span aria-hidden className="absolute bottom-0 start-[5px] top-4 border-s-2 border-stone" /> : null}
                <span aria-hidden className={cn("absolute start-0 top-1.5 size-3 rounded-full", moment.waiting ? "border-2 border-brown bg-cream" : "bg-brown")} />
                <p className="text-[0.8125rem] text-muted">
                  <time className="ltr-nums" dateTime={moment.at}>{fmt.dateTime(moment.at, when)}</time> · {moment.title}
                </p>
                <p className="mt-0.5 leading-relaxed text-espresso">
                  {moment.href ? <Link href={moment.href} className="underline decoration-stone underline-offset-4 hover:decoration-brown">{moment.text}</Link> : moment.text}
                </p>
              </li>
            ))}
          </ol>
        ) : <p className="mt-3 text-muted">{h.noHistory(camel.name)}</p>}
      </section>
    </Sheet>
  );
}
