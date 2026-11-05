"use client";

import { ArrowUpRight } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { Button, ButtonLink, Card, CardBody, CardHeader } from "@/components/ui";
import {
  OwnerFarmSection,
  PlanSection,
  QuestionsSection,
  ResourcesSection,
  ScheduleSection,
  WhatMattersSection,
  WorkerSection,
  type WorkspaceUpdate,
} from "@/components/setup";
import { IntegrationsSection } from "@/components/integrations/IntegrationsSection";
import { useI18n } from "@/i18n/client";
import { useWorkspaceStore } from "@/store/workspace";

export default function SettingsPage() {
  const router = useRouter();
  const { locale, m, href } = useI18n();
  const ws = useWorkspaceStore((state) => state.workspace);
  const startDemo = useWorkspaceStore((state) => state.startDemo);
  const reset = useWorkspaceStore((state) => state.reset);

  if (!ws) return null;

  const onBasicWindowRequired = () => {
    document.getElementById("settings-schedule")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const onChange = (update: WorkspaceUpdate) => {
    useWorkspaceStore.getState().update(update);
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-espresso">{m.onboarding.settingsTitle}</h1>
      </div>

      <PlanSection ws={ws} onChange={onChange} showSaved onBasicWindowRequired={onBasicWindowRequired} />
      <OwnerFarmSection ws={ws} onChange={onChange} showSaved />

      <Card>
        <CardHeader title={m.onboarding.sectionTitles.herd} />
        <CardBody className="flex flex-wrap items-center justify-between gap-3">
          <ButtonLink href={href("/app/herd")} variant="secondary">
            {m.onboarding.editHerdInSettings}
            <ArrowUpRight size={18} className="rtl:-scale-x-100" aria-hidden />
          </ButtonLink>
        </CardBody>
      </Card>

      <WorkerSection ws={ws} onChange={onChange} showSaved />
      <ResourcesSection ws={ws} onChange={onChange} showSaved />
      <WhatMattersSection ws={ws} onChange={onChange} showSaved />
      <QuestionsSection ws={ws} onChange={onChange} showSaved />
      <div id="settings-schedule" className="scroll-mt-24">
        <ScheduleSection ws={ws} onChange={onChange} showSaved />
      </div>

      <IntegrationsSection />

      <Card>
        <CardHeader title={m.onboarding.demoControls} />
        <CardBody className="space-y-4">
          <div className="flex flex-wrap gap-3">
            <Button variant="secondary" onClick={() => startDemo(locale, "basic")}>
              {m.onboarding.loadSampleBasic}
            </Button>
            <Button variant="secondary" onClick={() => startDemo(locale, "ultimate")}>
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
    </div>
  );
}
