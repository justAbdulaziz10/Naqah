"use client";

import { useCallback, useEffect } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { answer, hangUp, isReportScenario, start, type AnswerInput, type Scenario } from "@/domain/conversation/engine";
import type { Workspace } from "@/domain";
import { useI18n } from "@/i18n/client";
import { useWorkspaceStore } from "@/store/workspace";
import { EmergencyPanel } from "./LabInsidePanel";
import { PhoneStage } from "./LabPhoneStage";
import { useLabCall, type PickerScenario } from "./labStore";

export interface LabLaunch {
  scenario: PickerScenario;
  now: Date;
}

export function LabSimulator({ ws, now, m, locale, t, blockedReason, launch, onLaunchHandled }: {
  ws: Workspace;
  now: Date;
  m: ReturnType<typeof useI18n>["m"];
  locale: "ar" | "en";
  t: (value: { ar: string; en: string }) => string;
  blockedReason: string | null;
  launch: LabLaunch | null;
  onLaunchHandled: () => void;
}) {
  const lab = useLabCall();
  const update = useWorkspaceStore((state) => state.update);
  const session = lab.session && lab.workspaceKey === ws.createdAt ? lab.session : null;
  const selected = lab.selected;
  const { callStartedAt } = lab;
  const patch = lab.patch;

  const setSession = useCallback((value: typeof session) => {
    patch({ session: value, workspaceKey: useWorkspaceStore.getState().workspace?.createdAt ?? null });
  }, [patch]);

  const begin = useCallback((scenario: Scenario, at: Date = now, reportId?: string) => {
    const current = useWorkspaceStore.getState().workspace;
    if (!current) return;
    patch({ baseline: current.events.map((event) => event.id) });
    const result = start(current, at, scenario, reportId ? { reportId } : {});
    setSession(result.session);
    patch({ callStartedAt: Date.now() });
    if (result.commit) update(() => result.commit!(current));
  }, [now, patch, setSession, update]);

  useEffect(() => {
    if (!launch) return;
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      begin(launch.scenario, launch.now);
      onLaunchHandled();
    });
    return () => { active = false; };
  }, [begin, launch, onLaunchHandled]);

  const respond = useCallback((input: AnswerInput) => {
    const current = useWorkspaceStore.getState().workspace;
    if (!current || !session) return;
    const result = answer(session, current, now, input);
    setSession(result.session);
    if (result.commit) update(() => result.commit!(current));
  }, [now, session, setSession, update]);

  const finish = useCallback(() => {
    const current = useWorkspaceStore.getState().workspace;
    if (current && session && !session.done) {
      const result = hangUp(session, current, now);
      if (result.commit) update(() => result.commit!(current));
    }
    setSession(null);
    patch({ callStartedAt: null });
  }, [now, patch, session, setSession, update]);

  const isEmergency = session ? session.scenario === "emergency" : selected === "emergency";

  return (
    <div className="min-w-0 space-y-4">
      {isEmergency ? (
        <>
          <EmergencyPanel ws={ws} m={m} t={t} />
          {!session ? <Button size="lg" className="w-full" disabled={Boolean(blockedReason)} onClick={() => begin(selected)}>{m.lab.phone.start}</Button> : null}
        </>
      ) : (
        <PhoneStage
          session={session}
          selected={selected}
          ws={ws}
          timerStarted={callStartedAt}
          m={m}
          locale={locale}
          t={t}
          blockedReason={blockedReason}
          onStart={() => begin(selected)}
          onAnswer={respond}
          onEnd={finish}
        />
      )}
      {session?.next && isReportScenario(session.scenario) ? (
        <Card className="flex flex-col gap-3 border-brown/30 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h2 className="font-bold">{m.lab.transition.title}</h2>
            <p className="mt-1 text-sm leading-relaxed text-muted">{m.lab.transition.detail}</p>
          </div>
          <Button className="min-h-11 shrink-0" onClick={() => begin("owner_notification", now, session.next?.reportId)}>
            {m.lab.transition.start}
          </Button>
        </Card>
      ) : session?.scenario === "owner_notification" && session.done && ws.pendingWorkerCalls.some((call) => call.state === "pending") ? (
        <Card className="flex flex-col gap-3 border-brown/30 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h2 className="font-bold">{m.lab.toWorker.title}</h2>
            <p className="mt-1 text-sm leading-relaxed text-muted">{m.lab.toWorker.detail}</p>
          </div>
          <Button
            className="min-h-11 shrink-0"
            onClick={() => {
              patch({ selected: "worker_outbound" });
              begin("worker_outbound", now);
            }}
          >
            {m.lab.toWorker.start}
          </Button>
        </Card>
      ) : null}
      {isEmergency && session ? <Button variant="secondary" className="min-h-11" onClick={finish}>{m.lab.phone.cancel}</Button> : null}
    </div>
  );
}
