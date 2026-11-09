"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { CaretDown } from "@phosphor-icons/react";
import { Button, Card, CardBody, ConfirmDialog } from "@/components/ui";
import {
  EmergencySection,
  QuestionsFields,
  RanchFields,
  ReportModeField,
  ResourcesSection,
  SaveState,
  TeamFields,
  WhatMattersSection,
  hasOwnSetupData,
  type WorkspaceUpdate,
} from "@/components/setup";
import { ReportCallFields } from "@/components/schedule/ReportCallSection";
import { CallingStateNote } from "@/components/setup/CallingState";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { PlanChoice } from "@/components/setup/onboarding/PlanChoice";
import { RanchWeek } from "@/components/setup/onboarding/RanchWeek";
import { nowFor } from "@/domain/clock";
import { reportPlanHasContent } from "@/domain/rules";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/cn";
import { accountSync } from "@/store/account";
import { useIsAccount, useNow, useSaveStatus, useWorkspaceStore } from "@/store/workspace";

/** Jump targets clear the app's sticky header and the section nav (measured below). */
const anchor = "scroll-mt-[var(--settings-offset,9rem)]";

function PlanComparisonLoading() {
  return (
    <div aria-hidden="true" className="mt-3 min-h-[26rem] divide-y divide-stone/60 border-y border-stone/70">
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} className="flex min-h-16 items-center gap-4 px-3">
          <span className="h-3 w-1/3 rounded-sm bg-stone/45" />
          <span className="h-3 flex-1 rounded-sm bg-stone/30" />
          <span className="h-3 flex-1 rounded-sm bg-stone/30" />
        </div>
      ))}
    </div>
  );
}

function IntegrationsLoading() {
  return (
    <div aria-hidden="true" className="min-h-[36rem] space-y-3">
      <div className="h-7 w-40 rounded-sm bg-stone/45" />
      <div className="overflow-hidden rounded-[var(--radius-card)] border border-stone/70 bg-cream">
        {Array.from({ length: 5 }, (_, index) => (
          <div key={index} className="min-h-24 border-b border-stone/70 px-5 py-5 last:border-b-0">
            <div className="h-4 w-1/3 rounded-sm bg-stone/45" />
            <div className="mt-3 h-3 w-2/3 rounded-sm bg-stone/30" />
          </div>
        ))}
      </div>
    </div>
  );
}

const PlanComparison = dynamic(
  () => import("@/components/plans/PlanComparison").then((module) => module.PlanComparison),
  { loading: PlanComparisonLoading },
);

const IntegrationsSection = dynamic(
  () => import("@/components/integrations/IntegrationsSection").then((module) => module.IntegrationsSection),
  { loading: IntegrationsLoading },
);

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

/** Load the large connections panel shortly before it enters view; retain its jump target meanwhile. */
function DeferredIntegrations() {
  const target = useRef<HTMLDivElement>(null);
  const [requested, setRequested] = useState(false);
  useEffect(() => {
    if (requested || !target.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setRequested(true);
          observer.disconnect();
        }
      },
      { rootMargin: "480px 0px" },
    );
    observer.observe(target.current);
    return () => observer.disconnect();
  }, [requested]);

  return (
    <div
      ref={target}
      id={requested ? undefined : "connections"}
      className={anchor}
    >
      {requested ? <IntegrationsSection /> : <IntegrationsLoading />}
    </div>
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
    const layoutObserver = new ResizeObserver(onScroll);
    layoutObserver.observe(document.documentElement);
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    window.addEventListener("hashchange", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("hashchange", onScroll);
      layoutObserver.disconnect();
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
  const now = useNow();
  const saveFailed = useSaveStatus((state) => state.status === "failed") && !account; // The account banner covers it.
  const [edited, setEdited] = useState<string | null>(null);
  const [confirmingSample, setConfirmingSample] = useState(false);
  const [showPlanComparison, setShowPlanComparison] = useState(false);
  const headerHeight = useHeaderHeight();
  const navHeight = 52;
  const groups = [
    { id: "settings-report-call", label: s.groups.call },
    { id: "settings-questions", label: s.groups.questions },
    { id: "settings-ranch", label: s.groups.ranch },
    { id: "settings-more", label: s.more },
    { id: "connections", label: s.groups.connections },
    { id: "settings-account", label: account ? s.groups.account : s.groups.demo },
  ];
  // A call with nothing to ask can't be left behind. Other edits that can't be sent yet ask first
  // (a reload is covered by the account boundary).
  useEffect(() => {
    const guard = (event: MouseEvent) => {
      const link = (event.target as Element | null)?.closest?.("a[href]");
      if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
      const url = new URL((link as HTMLAnchorElement).href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return;
      const latest = useWorkspaceStore.getState().workspace;
      if (latest && !reportPlanHasContent(latest, nowFor(latest))) {
        event.preventDefault();
        event.stopPropagation();
        document.querySelector<HTMLElement>("#settings-questions [aria-invalid='true']")?.focus();
        return;
      }
      if (account && accountSync.unsentDrafts().length && !window.confirm(m.account.leaveUnsaved)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    document.addEventListener("click", guard, true);
    return () => document.removeEventListener("click", guard, true);
  }, [account, m.account.leaveUnsaved]);
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

  return (
    <div
      className="max-w-3xl space-y-8 pb-8"
      style={{ "--settings-offset": `${headerHeight + navHeight + 16}px` } as CSSProperties}
    >
      <div className="mb-3!">
        <h1 className="text-[2rem] font-semibold leading-tight tracking-[-0.02em] text-espresso sm:text-[2.5rem] rtl:tracking-normal">{s.title}</h1>
        <p className="mt-2 text-[1.0625rem] text-muted">{s.lead}</p>
      </div>
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

      {/* The answer first: the week NAQAH keeps for this ranch, redrawn live as the call changes. */}
      <div id="settings-report-call" className={cn(anchor, "space-y-5")}>
        <RanchWeek ws={ws} />
        <SettingsCard title={m.setup.call.title} saved={edited === "call"}>
          <div className="space-y-10">
            <div id="settings-plan" className={anchor}>
              <PlanChoice {...fields("call")} />
              <details className="group mt-3" onToggle={(event) => setShowPlanComparison(event.currentTarget.open)}>
                <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-[0.9375rem] font-semibold text-brown underline decoration-sand underline-offset-4 hover:decoration-brown [&::-webkit-details-marker]:hidden">
                  {m.setup.plans.compare}
                  <CaretDown size={14} className="transition-transform group-open:rotate-180" aria-hidden />
                </summary>
                {showPlanComparison ? <PlanComparison current={ws.settings.plan} className="mt-3" /> : null}
              </details>
            </div>
            <ReportCallFields {...fields("call")} />
          </div>
          {account ? <CallingStateNote ws={ws} className="mt-4" /> : <p className="mt-4 text-sm leading-relaxed text-muted">{m.setup.ready.demoCalls}</p>}
        </SettingsCard>
      </div>

      <SettingsCard id="settings-questions" title={m.setup.questions.title} saved={edited === "questions" && reportPlanHasContent(ws, now)}>
        <div className="space-y-8">
          <ReportModeField {...fields("questions")} />
          <QuestionsFields {...fields("questions")} />
        </div>
      </SettingsCard>

      <div id="settings-ranch" className={cn(anchor, "space-y-5")}>
        <SettingsCard title={m.setup.ranch.title} saved={edited === "ranch"}>
          <RanchFields {...fields("ranch")} />
        </SettingsCard>
        <SettingsCard id="settings-team" title={m.setup.team.title} saved={edited === "team"}>
          <TeamFields {...fields("team")} />
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

      <DeferredIntegrations />

      {account ? (
        <section id="settings-account" aria-labelledby="settings-account-title" className={cn(anchor, "space-y-3")}>
          <GroupTitle id="settings-account-title" title={s.groups.account} />
          <Card>
            <CardBody className="pt-5">
              <div className="sm:w-56"><LogoutButton /></div>
            </CardBody>
          </Card>
        </section>
      ) : (
        <section id="settings-account" aria-labelledby="settings-account-title" className={cn(anchor, "space-y-3")}>
          <GroupTitle id="settings-account-title" title={s.demoTitle} lead={s.demoNote} />
          <Card>
            <CardBody className="flex flex-wrap gap-3 pt-5">
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
