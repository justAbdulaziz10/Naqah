"use client";

import { CheckCircle, WarningCircle } from "@phosphor-icons/react";
import type { CSSProperties } from "react";
import { Sheet } from "@/components/ui";
import { SupplyGauges } from "@/components/visuals/SupplyGauges";
import type { FarmReport, Workspace } from "@/domain";
import { useI18n } from "@/i18n/client";
import { ReportAnswers } from "./ReportAnswers";

const full = { weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit" } as const;

/**
 * One report in full, one step away from the list: what NAQAH flagged, the supplies as they stood
 * after this call, and every answer in order: NAQAH's questions, then the owner's own.
 */
export function ReportSheet({ ws, report, worker, onClose }: { ws: Workspace; report: FarmReport; worker: string; onClose: () => void }) {
  const { m, t, fmt } = useI18n();
  const c = m.app.calls;
  const custom = new Set(ws.settings.customQuestions.map((question) => question.id));
  const naqahAnswers = report.answers.filter((answer) => !custom.has(answer.questionId));
  const ownerAnswers = report.answers.filter((answer) => custom.has(answer.questionId));
  // Supplies are kept as they stand now, so they belong to a report only when this call set them.
  const supplies = ws.resources.filter((resource) => resource.present && resource.updatedAt === report.at);

  return (
    <Sheet
      title={m.app.overview.reportTitle(worker)}
      description={<time className="ltr-nums" dateTime={report.at}>{fmt.dateTime(report.at, full)}</time>}
      closeLabel={m.common.actions.close}
      onClose={onClose}
      footer={<p className="text-[0.8125rem] leading-relaxed text-muted">{c.note}</p>}
    >
      <section aria-labelledby="sheet-findings">
        <h3 id="sheet-findings" className="text-sm font-semibold text-muted">{c.findings}</h3>
        {report.findings.length ? (
          <ul className="naqah-stagger mt-3 space-y-2">
            {report.findings.map((finding, index) => (
              <li key={finding.id} style={{ "--i": index } as CSSProperties} className="flex items-start gap-3 rounded-2xl bg-warn-soft/60 px-4 py-3 leading-relaxed text-espresso">
                <WarningCircle size={20} weight="fill" className="mt-0.5 shrink-0 text-warn" aria-hidden />
                <span className="font-medium">{t(finding.text)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 flex items-center gap-2.5 text-espresso">
            <CheckCircle size={20} weight="fill" className="shrink-0 text-ok" aria-hidden />
            {c.noFindings}
          </p>
        )}
      </section>

      {supplies.length ? (
        <section aria-labelledby="sheet-supplies" className="mt-8">
          <h3 id="sheet-supplies" className="text-sm font-semibold text-muted">{m.app.overview.resources}</h3>
          <SupplyGauges resources={supplies} columns={2} className="mt-4" />
        </section>
      ) : null}

      {ownerAnswers.length ? (
        <section aria-labelledby="sheet-yours" className="mt-8">
          <h3 id="sheet-yours" className="text-sm font-semibold text-muted">{m.app.overview.answers}</h3>
          <div className="mt-3"><ReportAnswers answers={ownerAnswers} /></div>
        </section>
      ) : null}

      <section aria-labelledby="sheet-naqah" className="mt-8">
        <h3 id="sheet-naqah" className="text-sm font-semibold text-muted">{c.naqahQuestions}</h3>
        <div className="mt-3">{naqahAnswers.length ? <ReportAnswers answers={naqahAnswers} /> : <p className="text-sm text-muted">{c.noAnswers}</p>}</div>
      </section>
    </Sheet>
  );
}
