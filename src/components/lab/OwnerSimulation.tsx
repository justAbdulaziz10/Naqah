"use client";

import { ArrowLeft } from "@phosphor-icons/react";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import type { Workspace } from "@/domain";
import { answer, hangUp, isReportScenario, start, type AnswerInput, type CallSession, type Scenario } from "@/domain/conversation/engine";
import { makePersonalizer, personalizeTree } from "@/domain/conversation/personalize";
import { reportCallBlock } from "@/domain/reportCalls";
import { useI18n } from "@/i18n/client";
import { useNow, useWorkspaceStore } from "@/store/workspace";
import { PhoneStage } from "./LabPhoneStage";

/**
 * A signed-in owner's practice call. The engine runs on a private copy of the ranch held in this
 * component's state: nothing is written to the store, so nothing reaches the account or the database,
 * and nothing is dialled. Leaving the page discards the copy.
 */
export function OwnerSimulation() {
  const { m: baseMessages, t: baseT, locale, href } = useI18n();
  const real = useWorkspaceStore((state) => state.workspace);
  const now = useNow();
  const [copy, setCopy] = useState<Workspace | null>(null);
  const [session, setSession] = useState<CallSession | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [reportsBefore, setReportsBefore] = useState(0);

  const ws = copy ?? real;
  const personalize = useMemo(() => makePersonalizer(ws), [ws]);
  const m = useMemo(() => ({ ...baseMessages, lab: personalizeTree(baseMessages.lab, personalize) }), [baseMessages, personalize]);
  const t = useCallback((value: { ar: string; en: string }) => personalize(baseT(value)), [baseT, personalize]);

  const begin = useCallback((scenario: Scenario, reportId?: string) => {
    // A report call starts from a fresh copy of the ranch; the owner's summary follows the practice report.
    const source = scenario === "report_call" ? real : copy ?? real;
    if (!source) return;
    const base: Workspace = structuredClone(source);
    if (scenario === "report_call") setReportsBefore(base.reports.length);
    const result = start(base, now, scenario, reportId ? { reportId } : {});
    setCopy(result.commit ? result.commit(base) : base);
    setSession(result.session);
    setStartedAt(Date.now());
  }, [copy, now, real]);

  const respond = useCallback((input: AnswerInput) => {
    if (!copy || !session) return;
    const result = answer(session, copy, now, input);
    setSession(result.session);
    if (result.commit) setCopy(result.commit(copy));
  }, [copy, now, session]);

  const finish = useCallback(() => {
    if (copy && session && !session.done) {
      const result = hangUp(session, copy, now);
      if (result.commit) setCopy(result.commit(copy));
    }
    setSession(null);
    setStartedAt(null);
  }, [copy, now, session]);

  const reset = useCallback(() => {
    setCopy(null);
    setSession(null);
    setStartedAt(null);
  }, []);

  if (!ws) return null;
  const s = baseMessages.app.simulate;
  const worker = ws.settings.worker.name.trim() || baseMessages.app.overview.unnamedWorker;
  const block = copy ? null : reportCallBlock(ws, now);
  const blockedReason = block === "no_worker_phone"
    ? m.lab.availability.noWorkerPhone
    : block === "no_questions"
      ? m.lab.availability.noQuestions
      : block === "already_reported"
        ? ws.settings.plan === "basic" ? m.lab.availability.weekComplete : m.lab.availability.dayComplete
        : null;
  const practiceReport = copy && copy.reports.length > reportsBefore ? copy.reports[copy.reports.length - 1] : null;

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-2">
        <Link href={href("/app")} className="inline-flex min-h-11 w-fit items-center gap-2 text-sm font-semibold text-brown underline decoration-stone underline-offset-4 hover:decoration-brown">
          <ArrowLeft size={16} className="rtl:-scale-x-100" aria-hidden />
          {s.back}
        </Link>
        <h1 className="text-[2rem] font-semibold leading-tight tracking-[-0.02em] text-espresso sm:text-[2.5rem]">{s.title}</h1>
        <p className="max-w-2xl leading-relaxed text-muted">{s.intro(worker)}</p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:items-start">
        <div className="min-w-0 space-y-4">
          <PhoneStage
            session={session}
            selected="report_call"
            ws={ws}
            timerStarted={startedAt}
            m={m}
            locale={locale}
            t={t}
            blockedReason={blockedReason}
            onStart={() => begin("report_call")}
            onAnswer={respond}
            onEnd={finish}
          />
          {session?.next && isReportScenario(session.scenario) ? (
            <Card className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <h2 className="font-bold">{m.lab.transition.title}</h2>
                <p className="mt-1 text-sm leading-relaxed text-muted">{m.lab.transition.detail}</p>
              </div>
              <Button className="min-h-11 shrink-0" onClick={() => begin("owner_notification", session.next?.reportId)}>
                {m.lab.transition.start}
              </Button>
            </Card>
          ) : null}
          <p role="status" className="text-sm text-muted">{s.notSaved}</p>
        </div>

        <Card className="p-5">
          <h2 className="font-bold">{s.wouldSave}</h2>
          {practiceReport && practiceReport.answers.length ? (
            <dl className="mt-3 divide-y divide-stone/70">
              {practiceReport.answers.map((item, index) => (
                <div key={`${item.questionId}-${index}`} className="py-2.5">
                  <dt className="text-sm text-muted">{t(item.question)}</dt>
                  <dd className="mt-0.5 font-semibold text-espresso">{item.answerText ? t(item.answerText) : item.answer}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="mt-2 text-sm text-muted">{s.noAnswers}</p>
          )}
          {copy && (!session || session.done) ? (
            <Button variant="secondary" className="mt-4 min-h-11" onClick={reset}>{s.again}</Button>
          ) : null}
        </Card>
      </div>
    </div>
  );
}
