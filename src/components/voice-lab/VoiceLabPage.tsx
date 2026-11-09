"use client";

import { Flask, Keyboard, Microphone } from "@phosphor-icons/react";
import { lazy, Suspense, useEffect, useState } from "react";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Segmented } from "@/components/ui/Segmented";
import type { Locale } from "@/domain/types";
import { useI18n } from "@/i18n/client";
import { voiceLabRequest, type LabAccess, type LabMode, type LabStatus } from "./voiceLabProtocol";

type Copy = ReturnType<typeof useI18n>["m"]["voiceLab"];

const VoiceLabSession = lazy(() => import("./VoiceLabSession").then((module) => ({ default: module.VoiceLabSession })));

export function VoiceLabPage() {
  const { m, href, locale: pageLocale } = useI18n();
  const copy = m.voiceLab;
  const [agentLocale, setAgentLocale] = useState<Locale>("ar");
  const [chosenMode, setChosenMode] = useState<LabMode>("voice");
  const [access, setAccess] = useState<LabAccess>("loading");
  const [status, setStatus] = useState<LabStatus | null>(null);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    let active = true;
    void voiceLabRequest("status", { op: "status", locale: agentLocale }).then(({ status: responseStatus, data }) => {
      if (!active) return;
      if (responseStatus === 401) { setAccess("signed_out"); return; }
      if (responseStatus === 404) { setAccess("private"); return; }
      if (data?.ok && data.operation === "status") {
        setStatus(data.status);
        setAccess("ready");
        return;
      }
      setAccess("error");
    }).catch(() => {
      if (active) setAccess("error");
    });
    return () => { active = false; };
  }, [agentLocale]);

  if (access !== "ready" || !status) {
    const gate =
      access === "private" ? { title: copy.private.title, body: copy.private.body }
      : access === "signed_out" ? { title: copy.signedOut.title, body: copy.signedOut.body }
      : access === "error" ? { title: copy.title, body: copy.loadFailed }
      : { title: copy.title, body: copy.loading };
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center sm:px-6">
        <h1 className="text-2xl font-bold">{gate.title}</h1>
        <p className="mt-2 text-muted" role={access === "loading" ? "status" : undefined}>{gate.body}</p>
        {access === "signed_out" ? <ButtonLink href={href("/login")} className="mt-6">{copy.signedOut.action}</ButtonLink> : null}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 pb-16 pt-6 sm:px-6 lg:pt-10">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">{copy.title}</h1>
        <p className="mt-1 text-muted">{copy.subtitle}</p>
      </header>
      <p className="sticky top-14 z-20 mt-4 flex flex-wrap items-center gap-x-2 gap-y-0.5 border-y-2 border-dashed border-brown/60 bg-ivory py-2.5 text-sm lg:top-0">
        <Flask size={18} weight="fill" aria-hidden className="text-brown" />
        <strong className="font-bold text-brown">{copy.testMode}</strong>
        <span className="text-espresso">{copy.testModeDetail}</span>
      </p>
      {started ? (
        <Suspense fallback={<div className="mt-6 min-h-40 rounded-2xl border border-stone/70 bg-cream" role="status" aria-label={copy.loading} />}>
          <VoiceLabSession copy={copy} status={status} mode={chosenMode} agentLocale={agentLocale} pageLocale={pageLocale} onExit={() => setStarted(false)} />
        </Suspense>
      ) : (
        <div className="mt-6 max-w-3xl">
          <Setup copy={copy} status={status} mode={chosenMode} setMode={setChosenMode} locale={agentLocale} setLocale={setAgentLocale} onStart={() => setStarted(true)} />
        </div>
      )}
    </div>
  );
}

function Setup({ copy, status, mode, setMode, locale, setLocale, onStart }: {
  copy: Copy;
  status: LabStatus;
  mode: LabMode;
  setMode: (mode: LabMode) => void;
  locale: Locale;
  setLocale: (locale: Locale) => void;
  onStart: () => void;
}) {
  return (
    <Card className="p-6 sm:p-8">
      <div className="flex flex-wrap gap-x-8 gap-y-4">
        <div>
          <p className="text-sm font-semibold text-muted">{copy.setup.mode}</p>
          <Segmented className="mt-2" label={copy.setup.mode} value={mode} onChange={setMode} options={[
            { value: "voice", label: <span className="inline-flex items-center gap-2"><Microphone size={18} aria-hidden />{copy.setup.voice}</span> },
            { value: "text", label: <span className="inline-flex items-center gap-2"><Keyboard size={18} aria-hidden />{copy.setup.text}</span> },
          ]} />
        </div>
        <div>
          <p className="text-sm font-semibold text-muted">{copy.setup.language}</p>
          <Segmented className="mt-2" label={copy.setup.language} value={locale} onChange={setLocale} options={[
            { value: "ar", label: copy.setup.arabic },
            { value: "en", label: copy.setup.english },
          ]} />
        </div>
      </div>

      <div className="mt-8">
        <Button size="lg" onClick={onStart} disabled={!status.configured}>
          {mode === "voice" ? <Microphone size={20} weight="fill" aria-hidden /> : <Keyboard size={20} aria-hidden />}
          {mode === "voice" ? copy.setup.startVoice : copy.setup.startText}
        </Button>
        <p className="mt-2 text-sm text-muted">{status.configured ? (mode === "voice" ? copy.setup.voiceHint : copy.setup.textHint) : copy.notConfigured}</p>
      </div>

      <dl className="mt-8 space-y-1 border-t border-stone/70 pt-4 text-sm">
        <div className="flex flex-wrap gap-x-2"><dt className="text-muted">{status.source === "farm" ? copy.setup.ranchReal : copy.setup.ranchSample}</dt>{status.ranch ? <dd className="font-semibold">{status.ranch}</dd> : null}</div>
        {status.worker ? <div className="flex flex-wrap gap-x-2"><dt className="text-muted">{copy.setup.worker}</dt><dd className="font-semibold">{status.worker}</dd></div> : null}
      </dl>
    </Card>
  );
}
