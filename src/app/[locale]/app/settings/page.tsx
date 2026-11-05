"use client";

import { ArrowUpRight } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Button, ButtonLink, Card, CardBody, CardHeader, ConfirmDialog } from "@/components/ui";
import {
  CallSetupStatus,
  EmergencySection,
  OwnerFarmSection,
  PlanSection,
  QuestionsSection,
  ResourcesSection,
  ScheduleSection,
  WhatMattersSection,
  WorkerSection,
  hasOwnSetupData,
  type WorkspaceUpdate,
} from "@/components/setup";
import { IntegrationsSection } from "@/components/integrations/IntegrationsSection";
import type { Plan } from "@/domain/types";
import { useI18n } from "@/i18n/client";
import { useSaveStatus, useWorkspaceStore } from "@/store/workspace";

/** Clears the sticky header and demo row when a link jumps to a section. */
const anchor = "scroll-mt-32";

function GroupTitle({ id, children }: { id: string; children: ReactNode }) {
  return <h2 id={id} className={`${anchor} pt-4 text-xl font-semibold text-espresso`}>{children}</h2>;
}

export default function SettingsPage() {
  const router = useRouter();
  const { locale, m, href } = useI18n();
  const ws = useWorkspaceStore((state) => state.workspace);
  const startDemo = useWorkspaceStore((state) => state.startDemo);
  const reset = useWorkspaceStore((state) => state.reset);
  const saveFailed = useSaveStatus((state) => state.status === "failed");
  const [editedSection, setEditedSection] = useState<string | null>(null);
  const [pendingSample, setPendingSample] = useState<Plan | null>(null);

  if (!ws) return null;

  const onBasicWindowRequired = () => {
    requestAnimationFrame(() => document.getElementById("settings-schedule")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  /** Each section reports its own save state, and only after the owner has changed it. */
  const section = (name: string) => ({
    ws,
    showSaved: editedSection === name,
    onChange: (update: WorkspaceUpdate) => {
      useWorkspaceStore.getState().update(update);
      setEditedSection(name);
    },
  });
  const loadSample = (plan: Plan) => {
    if (hasOwnSetupData(ws)) setPendingSample(plan);
    else startDemo(locale, plan);
  };
  const groups = [
    { id: "settings-farm", label: m.onboarding.settingsGroups.farm },
    { id: "settings-calls", label: m.onboarding.settingsGroups.calls },
    { id: "settings-connections", label: m.onboarding.settingsGroups.connections },
    { id: "settings-demo", label: m.onboarding.settingsGroups.demo },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-espresso">{m.onboarding.settingsTitle}</h1>
        <nav aria-label={m.onboarding.settingsTitle} className="mt-2 flex flex-wrap gap-x-5">
          {groups.map((group) => (
            <a key={group.id} href={`#${group.id}`} className="inline-flex min-h-11 items-center font-semibold text-brown underline decoration-stone underline-offset-4 hover:decoration-brown">
              {group.label}
            </a>
          ))}
        </nav>
      </div>

      {saveFailed ? (
        <p role="alert" className="sticky top-24 z-20 rounded-xl border border-danger bg-cream px-4 py-3 text-sm leading-relaxed text-danger lg:top-20">
          {m.onboarding.wizard.notSavedNotice}
        </p>
      ) : null}

      <CallSetupStatus ws={ws} />

      <GroupTitle id="settings-farm">{m.onboarding.settingsGroups.farm}</GroupTitle>
      <PlanSection {...section("plan")} onBasicWindowRequired={onBasicWindowRequired} />
      <OwnerFarmSection {...section("ownerFarm")} />

      <Card>
        <CardHeader title={m.onboarding.sectionTitles.herd} />
        <CardBody className="flex flex-wrap items-center justify-between gap-3">
          <ButtonLink href={href("/app/herd")} variant="secondary">
            {m.onboarding.editHerdInSettings}
            <ArrowUpRight size={18} className="rtl:-scale-x-100" aria-hidden />
          </ButtonLink>
        </CardBody>
      </Card>

      <ResourcesSection {...section("resources")} />

      <GroupTitle id="settings-calls">{m.onboarding.settingsGroups.calls}</GroupTitle>
      <div id="settings-worker" className={anchor}><WorkerSection {...section("worker")} /></div>
      <div id="settings-questions" className={anchor}><QuestionsSection {...section("questions")} /></div>
      <div id="settings-criteria" className={anchor}><WhatMattersSection {...section("criteria")} /></div>
      <div id="settings-emergencies" className={anchor}><EmergencySection {...section("emergencies")} /></div>
      {ws.settings.plan === "basic" ? (
        <div id="settings-schedule" className={anchor}>
          <ScheduleSection {...section("schedule")} />
        </div>
      ) : null}

      <div id="settings-connections" className={anchor}><IntegrationsSection /></div>

      <GroupTitle id="settings-demo">{m.onboarding.settingsGroups.demo}</GroupTitle>
      <Card>
        <CardHeader title={m.onboarding.demoControls} />
        <CardBody className="space-y-4">
          <div className="flex flex-wrap gap-3">
            <Button variant="secondary" onClick={() => loadSample("basic")}>
              {m.onboarding.loadSampleBasic}
            </Button>
            <Button variant="secondary" onClick={() => loadSample("ultimate")}>
              {m.onboarding.loadSampleUltimate}
            </Button>
          </div>
          <Button
            variant="danger"
            onClick={() => {
              if (!window.confirm(m.common.demo.resetConfirm)) return;
              reset();
              router.push(href("/"));
            }}
          >
            {m.common.actions.reset}
          </Button>
          <p className="text-sm text-muted">{m.onboarding.browserStorage}</p>
        </CardBody>
      </Card>
      {pendingSample ? (
        <ConfirmDialog
          title={m.common.demo.sampleConfirmTitle}
          body={m.common.demo.sampleConfirmFarm}
          confirmLabel={m.common.demo.sampleConfirmAction}
          cancelLabel={m.common.demo.sampleConfirmCancel}
          onConfirm={() => {
            startDemo(locale, pendingSample);
            setPendingSample(null);
          }}
          onCancel={() => setPendingSample(null)}
        />
      ) : null}
    </div>
  );
}
