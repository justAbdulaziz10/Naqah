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
import { SettingsDemoDraft } from "./SettingsDemoDraft";
import { callSample, criteriaSample, emergenciesSample, questionsSample, ranchSample, resourcesSample, teamSample } from "./demo-samples";

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
  () => import("./SettingsConnections").then((module) => module.SettingsConnections),
  { loading: IntegrationsLoading },
);

/**
 * One Settings section: its title (with the save state once the owner has changed something) above its
 * surface. Matches the Connections section, so every group reads the same way.
 */
function SettingsSection({ id, title, status, actions, className, children }: { id?: string; title: string; status?: ReactNode; actions?: ReactNode; className?: string; children: ReactNode }) {
  const titleId = `${id ?? title}-title`;
  return (
    <section id={id} aria-labelledby={titleId} className={cn(anchor, "space-y-3", className)}>
      <div className="flex min-h-7 flex-wrap items-center justify-between gap-x-3">
        <h2 id={titleId} className="text-lg font-semibold text-espresso">{title}</h2>
        {actions ? <div className="flex flex-wrap items-center gap-3">{actions}{status}</div> : status}
      </div>
      {children}
    </section>
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

/**
 * Height of the app's sticky top bar, so the section nav can sit right under it, and the page's own
 * scroll padding, which a jump target's margin adds to (the margin below makes up the difference).
 */
function useStickyOffsets() {
  const [offsets, setOffsets] = useState({ header: 0, padding: 0 });
  useEffect(() => {
    const header = document.querySelector<HTMLElement>("header.sticky");
    const measure = () => {
      const padding = Number.parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
      const next = { header: header ? Math.round(header.getBoundingClientRect().height) : 0, padding: Math.round(padding) };
      setOffsets((current) => (current.header === next.header && current.padding === next.padding ? current : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(document.documentElement);
    if (header) observer.observe(header);
    return () => observer.disconnect();
  }, []);
  return offsets;
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
      const atBottom = Math.ceil(window.innerHeight + window.scrollY) >= document.documentElement.scrollHeight - 8;
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
  const [confirmingReset, setConfirmingReset] = useState(false);
  // The link the owner clicked while edits were still unsent; the dialog decides whether to follow it.
  const [leavingTo, setLeavingTo] = useState<string | null>(null);
  const [showPlanComparison, setShowPlanComparison] = useState(false);
  const { header: headerHeight, padding: scrollPadding } = useStickyOffsets();
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
      if (account && accountSync.unsentDrafts().length) {
        event.preventDefault();
        event.stopPropagation();
        setLeavingTo(url.pathname + url.search + url.hash);
      }
    };
    document.addEventListener("click", guard, true);
    return () => document.removeEventListener("click", guard, true);
  }, [account]);
  const currentGroup = useCurrentGroup(groups.map((group) => group.id), headerHeight + navHeight);
  const navRef = useRef<HTMLElement>(null);
  // Which side of the tab strip still has tabs hidden, so an edge fade can say so (RTL or LTR).
  const [hidden, setHidden] = useState({ start: false, end: false });
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const measure = () => {
      const max = nav.scrollWidth - nav.clientWidth;
      const position = Math.abs(nav.scrollLeft);
      setHidden({ start: position > 2, end: position < max - 2 });
    };
    measure();
    nav.addEventListener("scroll", measure, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(nav);
    return () => {
      nav.removeEventListener("scroll", measure);
      observer.disconnect();
    };
  }, []);
  // On a phone the tabs scroll sideways: keep the current one in view (either direction, RTL or LTR).
  useEffect(() => {
    const nav = navRef.current;
    const link = nav?.querySelector<HTMLElement>("[aria-current]");
    if (!nav || !link) return;
    const box = nav.getBoundingClientRect();
    const tab = link.getBoundingClientRect();
    const margin = 24;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let delta = 0;
    if (tab.left < box.left + margin) delta = tab.left - (box.left + margin);
    else if (tab.right > box.right - margin) delta = tab.right - (box.right - margin);
    if (delta) nav.scrollBy({ left: delta, behavior: reduced ? "auto" : "smooth" });
  }, [currentGroup]);

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
      className="naqah-page max-w-3xl space-y-10 pb-8"
      // A jump lands its title just under the section nav: the margin is what the scroll padding doesn't cover.
      style={{ "--settings-offset": `${headerHeight + navHeight + 16 - scrollPadding}px` } as CSSProperties}
    >
      <div className="mb-3!">
        <h1 className="text-[2rem] font-semibold leading-tight tracking-[-0.02em] text-espresso sm:text-[2.5rem] rtl:tracking-normal">{s.title}</h1>
        <p className="mt-1.5 text-[1.0625rem] text-muted">{s.lead}</p>
      </div>
      <div className="sticky z-20 !mt-4 -mx-4 border-b border-stone/60 bg-ivory sm:-mx-6 lg:-mx-8" style={{ top: headerHeight }}>
        <nav
          ref={navRef}
          aria-label={s.title}
          className="overflow-x-auto px-4 [scrollbar-width:none] sm:px-6 lg:px-8 [&::-webkit-scrollbar]:hidden"
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
        {/* Edge fades: there are more tabs that way. Logical sides, so they swap in RTL. */}
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-y-0 start-0 w-10 bg-linear-to-r from-ivory to-transparent transition-opacity duration-200 rtl:bg-linear-to-l motion-reduce:transition-none",
            hidden.start ? "opacity-100" : "opacity-0",
          )}
        />
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-y-0 end-0 w-12 bg-linear-to-l from-ivory to-transparent transition-opacity duration-200 rtl:bg-linear-to-r motion-reduce:transition-none",
            hidden.end ? "opacity-100" : "opacity-0",
          )}
        />
      </div>

      {saveFailed ? (
        <p role="alert" className="rounded-xl border border-danger bg-cream px-4 py-3 text-sm leading-relaxed text-danger">
          {m.setup.flow.notSaved}
        </p>
      ) : null}

      {/* The answer first: the week NAQAH keeps for this ranch, redrawn live as the call changes. */}
      <div id="settings-report-call" className={cn(anchor, "space-y-6")}>
        <SettingsDemoDraft {...fields("call")} sample={() => callSample}>
        {(draft, controls, preview) => <>
        <RanchWeek ws={draft.ws} />
        <SettingsSection title={m.setup.call.title} actions={controls} status={edited === "call" && !preview ? <SaveState /> : null}>
          <Card>
            <CardBody className="space-y-10 pt-5">
              <div id="settings-plan" className={anchor}>
                <PlanChoice {...draft} showRhythm={false} />
                <details className="group mt-3" onToggle={(event) => setShowPlanComparison(event.currentTarget.open)}>
                  <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-[0.9375rem] font-semibold text-brown underline decoration-sand underline-offset-4 hover:decoration-brown focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brown [&::-webkit-details-marker]:hidden">
                    {m.setup.plans.compare}
                    <CaretDown size={14} className="transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden />
                  </summary>
                  {showPlanComparison ? <PlanComparison current={ws.settings.plan} className="mt-3" /> : null}
                </details>
              </div>
              <div className="border-t border-stone/80 pt-8">
                <ReportCallFields {...draft} showSummary={false} />
                {!preview ? account ? <CallingStateNote ws={ws} className="mt-5" /> : <p className="mt-5 text-sm leading-relaxed text-muted">{m.setup.ready.demoCalls}</p> : null}
              </div>
            </CardBody>
          </Card>
        </SettingsSection>
        </>}
        </SettingsDemoDraft>
      </div>

      <SettingsDemoDraft {...fields("questions")} sample={questionsSample}>
      {(draft, controls, preview) =>
      <SettingsSection
        id="settings-questions"
        title={m.setup.questions.title}
        actions={controls}
        status={edited === "questions" && !preview && reportPlanHasContent(ws, now) ? <SaveState /> : null}
      >
        <Card>
          <CardBody className="space-y-8 pt-5">
            <ReportModeField {...draft} />
            <QuestionsFields {...draft} />
          </CardBody>
        </Card>
      </SettingsSection>
      }
      </SettingsDemoDraft>

      <div id="settings-ranch" className={cn(anchor, "space-y-10")}>
        <SettingsDemoDraft {...fields("ranch")} sample={() => ranchSample}>
        {(draft, controls, preview) =>
        <SettingsSection title={m.setup.ranch.title} actions={controls} status={edited === "ranch" && !preview ? <SaveState /> : null}>
          <Card>
            <CardBody className="pt-5">
              <RanchFields {...draft} confirmPhone />
            </CardBody>
          </Card>
        </SettingsSection>
        }
        </SettingsDemoDraft>
        <SettingsDemoDraft {...fields("team")} sample={() => teamSample}>
        {(draft, controls, preview) =>
        <SettingsSection id="settings-team" title={m.setup.team.title} actions={controls} status={edited === "team" && !preview ? <SaveState /> : null}>
          <Card>
            <CardBody className="pt-2">
              <TeamFields {...draft} confirmPhone />
            </CardBody>
          </Card>
        </SettingsSection>
        }
        </SettingsDemoDraft>
      </div>

      <SettingsSection id="settings-more" title={s.more}>
        <Card className="divide-y divide-stone/70 overflow-hidden">
          <SettingsDemoDraft {...fields("resources")} sample={() => resourcesSample}>
            {(draft, controls, preview) => <div className="space-y-2">{controls ? <div className="px-5 pt-4">{controls}</div> : null}<ResourcesSection {...draft} showSaved={!preview && edited === "resources"} /></div>}
          </SettingsDemoDraft>
          <SettingsDemoDraft {...fields("criteria")} sample={criteriaSample}>
            {(draft, controls, preview) => <div className="space-y-2">{controls ? <div className="px-5 pt-4">{controls}</div> : null}<WhatMattersSection {...draft} showSaved={!preview && edited === "criteria"} /></div>}
          </SettingsDemoDraft>
          <SettingsDemoDraft {...fields("emergencies")} sample={emergenciesSample}>
            {(draft, controls, preview) => <div className="space-y-2">{controls ? <div className="px-5 pt-4">{controls}</div> : null}<EmergencySection {...draft} showSaved={!preview && edited === "emergencies"} /></div>}
          </SettingsDemoDraft>
        </Card>
      </SettingsSection>

      <DeferredIntegrations />

      {account ? (
        <SettingsSection id="settings-account" title={s.groups.account}>
          <Card>
            <CardBody className="pt-5">
              <div className="sm:w-56"><LogoutButton /></div>
            </CardBody>
          </Card>
        </SettingsSection>
      ) : (
        <SettingsSection id="settings-account" title={s.demoTitle}>
          <Card>
            <CardBody className="space-y-4 pt-5">
              <p className="text-sm text-muted">{s.demoNote}</p>
              <div className="flex flex-wrap gap-3">
                <Button variant="secondary" onClick={() => (hasOwnSetupData(ws) ? setConfirmingSample(true) : startDemo(locale, ws.settings.plan))}>
                  {s.loadSample}
                </Button>
                <Button
                  variant="ghost"
                  className="text-danger"
                  onClick={() => setConfirmingReset(true)}
                >
                  {m.common.actions.reset}
                </Button>
              </div>
            </CardBody>
          </Card>
        </SettingsSection>
      )}
      {confirmingReset ? (
        <ConfirmDialog
          title={s.resetTitle}
          body={m.common.demo.resetConfirm}
          confirmLabel={s.resetAction}
          cancelLabel={s.resetCancel}
          onConfirm={() => {
            setConfirmingReset(false);
            reset();
            router.push(href("/"));
          }}
          onCancel={() => setConfirmingReset(false)}
        />
      ) : null}
      {leavingTo ? (
        <ConfirmDialog
          tone="primary"
          title={s.leaveTitle}
          body={m.account.leaveUnsaved}
          confirmLabel={s.leaveAnyway}
          cancelLabel={s.leaveStay}
          onConfirm={() => {
            const target = leavingTo;
            setLeavingTo(null);
            router.push(target);
          }}
          onCancel={() => setLeavingTo(null)}
        />
      ) : null}
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
