"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { Button, Card, CardBody, ConfirmDialog, Segmented } from "@/components/ui";
import {
  EmergencySection,
  QuestionsFields,
  RanchFields,
  ResourcesSection,
  SaveState,
  TeamFields,
  WhatMattersSection,
  hasOwnSetupData,
  type WorkspaceUpdate,
} from "@/components/setup";
import { IntegrationsSection } from "@/components/integrations/IntegrationsSection";
import { ReportCallFields } from "@/components/schedule/ReportCallSection";
import { useScheduledCallsOn } from "@/components/schedule/useScheduledCalls";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { PlanComparison } from "@/components/plans/PlanComparison";
import { PLAN_LIMITS } from "@/domain/catalog";
import type { Plan } from "@/domain/types";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/cn";
import { useIsAccount, useSaveStatus, useWorkspaceStore } from "@/store/workspace";

/** Jump targets clear the app's sticky header and the section nav (measured below). */
const anchor = "scroll-mt-[var(--settings-offset,9rem)]";

function GroupTitle({ id, title, lead }: { id: string; title: string; lead?: string }) {
  return (
    <div className="space-y-1">
      <h2 id={id} className="text-lg font-semibold text-espresso">{title}</h2>
      {lead ? <p className="text-sm text-muted">{lead}</p> : null}
    </div>
  );
}

/** An essential Settings section: the same field group the onboarding step shows, with its save state. */
function SettingsCard({ id, title, saved, children }: { id?: string; title: string; saved: boolean; children: ReactNode }) {
  const titleId = `${id ?? title}-title`;
  return (
    <Card id={id} aria-labelledby={titleId} role="region" className={anchor}>
      <div className="flex min-h-11 items-center justify-between gap-3 px-5 pt-5 sm:px-6">
        <h2 id={titleId} className="text-lg font-semibold text-espresso">{title}</h2>
        {saved ? <SaveState /> : null}
      </div>
      <CardBody>{children}</CardBody>
    </Card>
  );
}

/** Height of the app's sticky top bar, so the section nav can sit right under it. */
function useHeaderHeight() {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const header = document.querySelector<HTMLElement>("header.sticky");
    if (!header) return;
    const measure = () => setHeight(Math.round(header.getBoundingClientRect().height));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    return () => observer.disconnect();
  }, []);
  return height;
}

/** The group currently under the section nav. */
function useCurrentGroup(ids: string[], offset: number) {
  const [current, setCurrent] = useState(ids[0]);
  const key = ids.join(",");
  useEffect(() => {
    const list = key.split(",");
    let frame = 0;
    const update = () => {
      frame = 0;
      const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
      let next = list[0];
      for (const id of list) {
        const element = document.getElementById(id);
        if (element && element.getBoundingClientRect().top <= offset + 24) next = id;
      }
      setCurrent(atBottom ? list[list.length - 1] : next);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [key, offset]);
  return current;
}

export default function SettingsPage() {
  const router = useRouter();
  const { locale, m, href } = useI18n();
  const s = m.setup.settings;
  const ws = useWorkspaceStore((state) => state.workspace);
  const startDemo = useWorkspaceStore((state) => state.startDemo);
  const reset = useWorkspaceStore((state) => state.reset);
  const account = useIsAccount();
  const scheduledCalls = useScheduledCallsOn();
  const saveFailed = useSaveStatus((state) => state.status === "failed") && !account; // The account banner covers it.
  const [edited, setEdited] = useState<string | null>(null);
  const [confirmingSample, setConfirmingSample] = useState(false);
  const headerHeight = useHeaderHeight();
  const navHeight = 52;
  const groups = [
    { id: "settings-ranch", label: s.groups.ranch },
    { id: "settings-report-call", label: s.groups.call },
    { id: "settings-more", label: s.more },
    { id: "connections", label: s.groups.connections },
    { id: "settings-account", label: account ? s.groups.account : s.groups.demo },
  ];
  const currentGroup = useCurrentGroup(groups.map((group) => group.id), headerHeight + navHeight);

  if (!ws) return null;

  /** Each section reports its own save state, and only after the owner has changed it. */
  const section = (name: string) => ({
    ws,
    showSaved: edited === name,
    onChange: (update: WorkspaceUpdate) => {
      useWorkspaceStore.getState().update(update);
      setEdited(name);
    },
  });
  const fields = (name: string) => ({ ws, onChange: section(name).onChange });
  const tooManyForBasic = ws.settings.customQuestions.length > PLAN_LIMITS.basic.customQuestions;
  const choosePlan = (plan: Plan) => {
    if (plan === ws.settings.plan || (plan === "basic" && tooManyForBasic)) return;
    section("demo").onChange((current) => ({ ...current, settings: { ...current.settings, plan } }));
  };

  return (
    <div
      className="max-w-3xl space-y-8 pb-8"
      style={{ "--settings-offset": `${headerHeight + navHeight + 16}px` } as CSSProperties}
    >
      <h1 className="mb-3! text-2xl font-bold tracking-tight text-espresso sm:text-[1.8rem]">{s.title}</h1>
        <nav
          aria-label={s.title}
          className="sticky z-20 -mx-4 overflow-x-auto border-b border-stone/60 bg-ivory px-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8"
          style={{ top: headerHeight }}
        >
          <ul className="flex gap-x-6 whitespace-nowrap">
            {groups.map((group) => {
              const current = group.id === currentGroup;
              return (
                <li key={group.id}>
                  <a
                    href={`#${group.id}`}
                    aria-current={current ? "location" : undefined}
                    className={cn(
                      "-mb-px inline-flex min-h-12 items-center border-b-2 text-sm font-semibold transition-colors focus-visible:rounded-sm focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brown",
                      current ? "border-brown text-espresso" : "border-transparent text-muted hover:text-espresso",
                    )}
                  >
                    {group.label}
                  </a>
                </li>
              );
            })}
          </ul>
        </nav>

      {saveFailed ? (
        <p role="alert" className="rounded-xl border border-danger bg-cream px-4 py-3 text-sm leading-relaxed text-danger">
          {m.setup.flow.notSaved}
        </p>
      ) : null}

      <div id="settings-ranch" className={cn(anchor, "space-y-5")}>
        <SettingsCard title={m.setup.ranch.title} saved={edited === "ranch"}>
          <RanchFields {...fields("ranch")} />
        </SettingsCard>
        <SettingsCard id="settings-team" title={m.setup.team.title} saved={edited === "team"}>
          <TeamFields {...fields("team")} />
        </SettingsCard>
      </div>

      <div id="settings-report-call" className={cn(anchor, "space-y-5")}>
        <SettingsCard title={m.setup.call.title} saved={edited === "call"}>
          <ReportCallFields {...fields("call")} />
          {account && scheduledCalls !== false ? null : (
            <p className="mt-4 text-sm leading-relaxed text-muted">{account ? m.setup.call.notConnected : m.setup.ready.demoCalls}</p>
          )}
        </SettingsCard>
        <SettingsCard id="settings-questions" title={m.setup.questions.title} saved={edited === "questions"}>
          <QuestionsFields {...fields("questions")} />
        </SettingsCard>
      </div>

      <section id="settings-more" aria-labelledby="settings-more-title" className={cn(anchor, "space-y-3")}>
        <GroupTitle id="settings-more-title" title={s.more} />
        <Card className="divide-y divide-stone/70 overflow-hidden">
          <ResourcesSection {...section("resources")} />
          <WhatMattersSection {...section("criteria")} />
          <EmergencySection {...section("emergencies")} />
        </Card>
      </section>

      <IntegrationsSection />

      {account ? (
        <section id="settings-account" aria-labelledby="settings-account-title" className={cn(anchor, "space-y-3")}>
          <GroupTitle id="settings-account-title" title={s.groups.account} />
          <Card>
            <CardBody className="space-y-6 pt-5">
              <div id="settings-plan" className={anchor}>
                <p className="text-sm text-muted">{s.plan}</p>
                <p className="mt-0.5 text-lg font-semibold text-espresso">{m.common.plans[ws.settings.plan]}</p>
                <PlanComparison current={ws.settings.plan} className="mt-4" />
              </div>
              <div className="border-t border-stone/70 pt-5"><div className="sm:w-56"><LogoutButton /></div></div>
            </CardBody>
          </Card>
        </section>
      ) : (
        <section id="settings-account" aria-labelledby="settings-account-title" className={cn(anchor, "space-y-3")}>
          <GroupTitle id="settings-account-title" title={s.demoTitle} lead={s.demoNote} />
          <Card>
            <CardBody className="space-y-5 pt-5">
              <div id="settings-plan" className={anchor}>
                <p className="mb-2 text-sm font-semibold text-espresso">{s.demoPlan}</p>
                <Segmented
                  value={ws.settings.plan}
                  onChange={choosePlan}
                  label={s.demoPlan}
                  className="[&>button]:min-h-11"
                  options={[
                    { value: "basic", label: m.common.plans.basic },
                    { value: "ultimate", label: m.common.plans.ultimate },
                  ]}
                />
                {tooManyForBasic && ws.settings.plan === "ultimate" ? <p className="mt-2 text-sm text-muted">{s.demoPlanBasicBlocked}</p> : null}
                <PlanComparison current={ws.settings.plan} className="mt-5" />
              </div>
              <div className="flex flex-wrap gap-3 border-t border-stone/70 pt-4">
                <Button variant="secondary" onClick={() => (hasOwnSetupData(ws) ? setConfirmingSample(true) : startDemo(locale, ws.settings.plan))}>
                  {s.loadSample}
                </Button>
                <Button
                  variant="ghost"
                  className="text-danger"
                  onClick={() => {
                    if (!window.confirm(m.common.demo.resetConfirm)) return;
                    reset();
                    router.push(href("/"));
                  }}
                >
                  {m.common.actions.reset}
                </Button>
              </div>
            </CardBody>
          </Card>
        </section>
      )}
      {confirmingSample ? (
        <ConfirmDialog
          title={m.common.demo.sampleConfirmTitle}
          body={m.common.demo.sampleConfirmFarm}
          confirmLabel={m.common.demo.sampleConfirmAction}
          cancelLabel={m.common.demo.sampleConfirmCancel}
          onConfirm={() => {
            startDemo(locale, ws.settings.plan);
            setConfirmingSample(false);
          }}
          onCancel={() => setConfirmingSample(false)}
        />
      ) : null}
    </div>
  );
}
