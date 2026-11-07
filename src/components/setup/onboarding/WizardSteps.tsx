"use client";

import { PencilSimple } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { ReportCallFields, useCallSentence } from "@/components/schedule/ReportCallSection";
import type { Workspace } from "@/domain/types";
import { allWorkers } from "@/domain/workers";
import { useI18n } from "@/i18n/client";
import { useIsAccount } from "@/store/workspace";
import { getCallSetupGaps } from "../CallSetupStatus";
import { QuestionsFields } from "../fields/QuestionsFields";
import { RanchFields } from "../fields/RanchFields";
import { TeamFields } from "../fields/TeamFields";
import { phoneNeedsFixing } from "../phone";
import type { SetupFieldsProps } from "../types";
import { FieldGroup } from "./WizardParts";

/** The owner's four setup steps. Settings shows the same field groups. */
export const WIZARD_STEPS = ["ranch", "team", "call", "ready"] as const;
export type WizardStepKey = (typeof WIZARD_STEPS)[number];

/** Something typed that can't be used yet. Blank is fine: every detail can be finished later. */
export function stepNeedsFixing(key: WizardStepKey, ws: Workspace): boolean {
  if (key === "ranch") return phoneNeedsFixing(ws.settings.owner.phone);
  if (key === "team") return allWorkers(ws.settings).some((worker) => phoneNeedsFixing(worker.phone));
  return false;
}

export function RanchStep(props: SetupFieldsProps) {
  return <RanchFields {...props} />;
}

export function TeamStep(props: SetupFieldsProps) {
  return <TeamFields {...props} />;
}

export function CallStep(props: SetupFieldsProps) {
  const { m } = useI18n();
  return (
    <div className="space-y-12">
      <ReportCallFields {...props} />
      <FieldGroup title={m.setup.questions.title}>
        <QuestionsFields {...props} />
      </FieldGroup>
    </div>
  );
}

/* ─── Ready ────────────────────────────────────────────────────────────── */

function SummaryRow({ label, step, onEdit, children }: { label: string; step?: WizardStepKey; onEdit: (step: WizardStepKey) => void; children: ReactNode }) {
  const { m } = useI18n();
  return (
    <div className="grid grid-cols-[1fr_auto] items-start gap-x-4 gap-y-1 py-4 sm:grid-cols-[10rem_1fr_auto]">
      <dt className="text-[0.9375rem] font-medium text-muted sm:pt-0.5">{label}</dt>
      <dd className="col-span-2 row-start-2 min-w-0 text-[1.0625rem] leading-relaxed text-espresso sm:col-span-1 sm:col-start-2 sm:row-start-1">
        {children}
      </dd>
      {step ? (
        <dd className="col-start-2 row-start-1 sm:col-start-3">
          <button
            type="button"
            onClick={() => onEdit(step)}
            aria-label={m.setup.ready.edit(label)}
            className="-my-2 inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-[0.9375rem] font-semibold text-brown transition hover:bg-espresso/5"
          >
            <PencilSimple size={16} aria-hidden />
            {m.common.actions.edit}
          </button>
        </dd>
      ) : null}
    </div>
  );
}

export function ReadyStep({ ws, onEdit }: { ws: Workspace; onEdit: (step: WizardStepKey) => void }) {
  const { m, fmt } = useI18n();
  const account = useIsAccount();
  const r = m.setup.ready;
  const call = useCallSentence(ws);
  const { owner, farm, plan, worker, herdCount, customQuestions } = ws.settings;
  const workers = allWorkers(ws.settings).filter((item) => item.name.trim() || item.phone.trim());
  const gaps = getCallSetupGaps(ws);
  const notSet = <span className="text-muted">{r.notSet}</span>;
  const person = (name: string, phone: string) =>
    name || phone ? (
      <>
        {name || notSet}
        {phone ? <> · <bdi className="ltr-nums">{phone}</bdi></> : null}
        {phoneNeedsFixing(phone) ? <span className="block text-[0.9375rem] text-danger">{r.checkNumber}</span> : null}
      </>
    ) : notSet;

  return (
    <div className="space-y-8">
      <dl className="divide-y divide-stone/80 border-y border-stone/80">
        <SummaryRow label={r.ranch} step="ranch" onEdit={onEdit}>
          {farm.name.trim() || notSet}
          {farm.location ? <span className="text-muted"> · {farm.location}</span> : null}
        </SummaryRow>
        <SummaryRow label={r.owner} step="ranch" onEdit={onEdit}>{person(owner.name.trim(), owner.phone.trim())}</SummaryRow>
        <SummaryRow label={r.workers} step="team" onEdit={onEdit}>
          {workers.length > 1
            ? r.workersValue(workers.length, worker.name.trim() || m.setup.call.workerFallback)
            : person(worker.name.trim(), worker.phone.trim())}
        </SummaryRow>
        <SummaryRow label={r.herd} step="team" onEdit={onEdit}>
          {herdCount === null || herdCount === undefined ? notSet : r.camels(fmt.number(herdCount))}
        </SummaryRow>
        <SummaryRow label={r.call} step="call" onEdit={onEdit}>{call ? call.sentence : notSet}</SummaryRow>
        <SummaryRow label={r.questions} step="call" onEdit={onEdit}>{r.questionsValue(customQuestions.length)}</SummaryRow>
        <SummaryRow label={r.plan} onEdit={onEdit}>{m.common.plans[plan]}</SummaryRow>
      </dl>

      {gaps.length ? (
        <section aria-labelledby="ready-missing">
          <h2 id="ready-missing" className="text-[1.0625rem] font-bold text-espresso">{r.missingTitle}</h2>
          <ul className="mt-2 list-disc space-y-1 ps-6 text-[1.0625rem] text-espresso">
            {gaps.map((gap) => <li key={gap}>{r.missing[gap]}</li>)}
          </ul>
        </section>
      ) : null}
      <p className="text-[0.9375rem] leading-relaxed text-muted">{account ? m.setup.call.notConnected : r.demoCalls}</p>
    </div>
  );
}
