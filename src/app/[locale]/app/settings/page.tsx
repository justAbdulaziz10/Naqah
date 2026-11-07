"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Button, Card, CardBody, CardHeader, ConfirmDialog, Segmented } from "@/components/ui";
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
import { LogoutButton } from "@/components/auth/LogoutButton";
import { PLAN_LIMITS } from "@/domain/catalog";
import type { Plan } from "@/domain/types";
import { useI18n } from "@/i18n/client";
import { useIsAccount, useSaveStatus, useWorkspaceStore } from "@/store/workspace";

/** Clears the sticky header and demo row when a link jumps to a section. */
const anchor = "scroll-mt-32";

function GroupTitle({ id, title, lead }: { id: string; title: string; lead?: string }) {
  return (
    <div id={id} className={`${anchor} pt-6`}>
      <h2 className="text-xl font-semibold text-espresso">{title}</h2>
      {lead ? <p className="mt-1 text-muted">{lead}</p> : null}
    </div>
  );
}

/** A Settings section: the same field group the onboarding step shows, in a card with its save state. */
function SettingsCard({ id, title, saved, children }: { id?: string; title: string; saved: boolean; children: ReactNode }) {
  return (
    <Card id={id} className={anchor}>
      <CardHeader title={title} action={saved ? <SaveState /> : undefined} />
      <CardBody>{children}</CardBody>
    </Card>
  );
}

export default function SettingsPage() {
  const router = useRouter();
  const { locale, m, href } = useI18n();
  const s = m.setup.settings;
  const ws = useWorkspaceStore((state) => state.workspace);
  const startDemo = useWorkspaceStore((state) => state.startDemo);
  const reset = useWorkspaceStore((state) => state.reset);
  const account = useIsAccount();
  const saveFailed = useSaveStatus((state) => state.status === "failed") && !account; // The account banner covers it.
  const [edited, setEdited] = useState<string | null>(null);
  const [confirmingSample, setConfirmingSample] = useState(false);

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
  const groups = [
    { id: "settings-ranch", label: s.groups.ranch },
    { id: "settings-report-call", label: s.groups.call },
    { id: "settings-more", label: s.groups.more },
    { id: "connections", label: s.groups.connections },
    { id: "settings-account", label: account ? s.groups.account : s.groups.demo },
  ];

  return (
    <div className="space-y-5 pb-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-espresso">{s.title}</h1>
        <nav aria-label={s.title} className="mt-2 flex flex-wrap gap-x-5">
          {groups.map((group) => (
            <a key={group.id} href={`#${group.id}`} className="inline-flex min-h-11 items-center font-semibold text-brown underline decoration-stone underline-offset-4 hover:decoration-brown">
              {group.label}
            </a>
          ))}
        </nav>
      </div>

      {saveFailed ? (
        <p role="alert" className="sticky top-24 z-20 rounded-xl border border-danger bg-cream px-4 py-3 text-sm leading-relaxed text-danger lg:top-20">
          {m.setup.flow.notSaved}
        </p>
      ) : null}

      <SettingsCard id="settings-ranch" title={m.setup.ranch.title} saved={edited === "ranch"}>
        <RanchFields {...fields("ranch")} />
      </SettingsCard>
      <SettingsCard id="settings-team" title={m.setup.team.title} saved={edited === "team"}>
        <TeamFields {...fields("team")} />
      </SettingsCard>
      <SettingsCard id="settings-report-call" title={m.setup.call.title} saved={edited === "call"}>
        <ReportCallFields {...fields("call")} />
        <p className="mt-4 text-sm leading-relaxed text-muted">{account ? m.setup.call.notConnected : m.setup.ready.demoCalls}</p>
      </SettingsCard>
      <SettingsCard id="settings-questions" title={m.setup.questions.title} saved={edited === "questions"}>
        <QuestionsFields {...fields("questions")} />
      </SettingsCard>

      <GroupTitle id="settings-more" title={s.more} lead={s.moreLead} />
      <ResourcesSection {...section("resources")} />
      <div id="settings-criteria" className={anchor}><WhatMattersSection {...section("criteria")} /></div>
      <div id="settings-emergencies" className={anchor}><EmergencySection {...section("emergencies")} /></div>

      <IntegrationsSection />

      {account ? (
        <>
          <GroupTitle id="settings-account" title={s.groups.account} />
          <Card>
            <CardBody className="space-y-5">
              <div>
                <p className="text-sm text-muted">{s.plan}</p>
                <p className="mt-0.5 text-lg font-semibold text-espresso">{m.common.plans[ws.settings.plan]}</p>
                <p className="mt-1 text-sm text-muted">{s.planNote}</p>
              </div>
              <div className="max-w-xs"><LogoutButton /></div>
            </CardBody>
          </Card>
        </>
      ) : (
        <>
          <GroupTitle id="settings-account" title={s.demoTitle} lead={s.demoNote} />
          <Card>
            <CardBody className="space-y-5">
              <div>
                <p className="mb-2 text-sm font-semibold text-espresso">{s.demoPlan}</p>
                <Segmented
                  value={ws.settings.plan}
                  onChange={choosePlan}
                  label={s.demoPlan}
                  options={[
                    { value: "basic", label: m.common.plans.basic },
                    { value: "ultimate", label: m.common.plans.ultimate },
                  ]}
                />
                {tooManyForBasic && ws.settings.plan === "ultimate" ? <p className="mt-2 text-sm text-muted">{s.demoPlanBasicBlocked}</p> : null}
              </div>
              <div className="flex flex-wrap gap-3">
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
        </>
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
