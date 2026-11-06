"use client";

import { CircleNotch, List, SpeakerHigh } from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore, useTransition, type ReactNode } from "react";
import { hasOwnSetupData } from "@/components/setup/draft";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import type { Plan } from "@/domain/types";
import { useI18n } from "@/i18n/client";
import { LocaleSwitcher } from "@/components/shell/LocaleSwitcher";
import { useWorkspaceStore } from "@/store/workspace";
import { buttonClass, type ButtonStyleProps } from "@/components/ui/Button";

type DemoActionProps = ButtonStyleProps & {
  children: ReactNode;
  plan?: Plan;
};

/** Starts the sample farm when needed, then opens the owner dashboard. Disabled while it opens. */
export function DemoAction({ children, plan, ...style }: DemoActionProps) {
  const { locale, href, m } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);

  function open() {
    const state = useWorkspaceStore.getState();
    if (plan) {
      state.startDemo(locale, plan);
    } else if (!state.workspace?.setupComplete) {
      state.startDemo(locale);
    }
    startTransition(() => router.push(href("/app")));
  }

  function start() {
    if (pending) return;
    const { workspace } = useWorkspaceStore.getState();
    const replacesWorkspace = Boolean(plan) || !workspace?.setupComplete;
    if (replacesWorkspace && hasOwnSetupData(workspace)) setConfirming(true);
    else open();
  }

  return (
    <>
      <button type="button" onClick={start} disabled={pending} aria-busy={pending} className={buttonClass(style)}>
        {pending ? (
          <>
            <CircleNotch size={18} className="motion-safe:animate-spin" aria-hidden="true" />
            {m.landing.pending}
          </>
        ) : (
          children
        )}
      </button>
      {confirming ? (
        <ConfirmDialog
          title={m.common.demo.sampleConfirmTitle}
          body={m.common.demo.sampleConfirmFarm}
          confirmLabel={m.common.demo.sampleConfirmAction}
          cancelLabel={m.common.demo.sampleConfirmCancel}
          onConfirm={() => {
            setConfirming(false);
            open();
          }}
          onCancel={() => setConfirming(false)}
        />
      ) : null}
    </>
  );
}

/** Compact mobile navigation; the native disclosure keeps keyboard behavior simple. */
export function MobileNavigation({
  links,
  menuLabel,
  menuTitle,
}: {
  links: { href: string; label: string }[];
  menuLabel: string;
  menuTitle: string;
}) {
  return (
    <div className="flex items-center lg:hidden">
      <details className="group relative">
        <summary
          aria-label={menuLabel}
          className="inline-flex size-11 cursor-pointer list-none items-center justify-center rounded-full border border-stone text-espresso transition hover:bg-espresso/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current [&::-webkit-details-marker]:hidden"
        >
          <List size={20} weight="regular" aria-hidden="true" />
        </summary>
        <nav
          aria-label={menuTitle}
          className="absolute end-0 top-[calc(100%+0.75rem)] z-50 grid w-[min(20rem,calc(100vw-2rem))] gap-1 rounded-2xl border border-stone bg-cream p-3 text-start shadow-lift"
        >
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={(event) => event.currentTarget.closest("details")?.removeAttribute("open")}
              className="flex min-h-11 items-center rounded-xl px-3.5 text-sm font-semibold text-espresso transition hover:bg-ivory focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current"
            >
              {link.label}
            </Link>
          ))}
          <div className="mt-1 pt-1">
            <LocaleSwitcher className="min-h-11 w-full justify-start rounded-xl px-3.5" />
          </div>
        </nav>
      </details>
    </div>
  );
}

/** Uses the browser voice only when the speech synthesis API is available. */
export function SpeechButton({ text }: { text: string }) {
  const { locale, m } = useI18n();
  const available = useSyncExternalStore(
    () => () => undefined,
    () => "speechSynthesis" in window && "SpeechSynthesisUtterance" in window,
    () => false,
  );
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => {
    return () => {
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    };
  }, []);

  function toggleSpeech() {
    if (!available) return;
    if (speaking) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = locale === "ar" ? "ar-SA" : "en-US";
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(utterance);
    setSpeaking(true);
  }

  if (!available) return null;
  return (
    <button
      type="button"
      aria-pressed={speaking}
      onClick={toggleSpeech}
      className="inline-flex min-h-11 items-center gap-2 text-[0.9375rem] font-semibold text-sand underline-offset-4 transition hover:text-cream hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current"
    >
      <SpeakerHigh size={18} weight="regular" aria-hidden="true" />
      {speaking ? m.landing.owner.stop : m.landing.owner.listen}
    </button>
  );
}

/**
 * The live thing on the page: the owner's phone rings, the visitor answers it and hears what NAQAH
 * would say, either way the report went. A native disclosure, so it works from the keyboard and
 * without a script.
 */
export function AnswerCall() {
  const { m, locale } = useI18n();
  const owner = m.landing.owner;
  const [quiet, setQuiet] = useState(false);
  const quote = quiet ? owner.quietQuote : owner.reviewQuote;
  const options = [
    { quiet: false, label: owner.review },
    { quiet: true, label: owner.quiet },
  ];

  return (
    <details className="group mt-6">
      <summary className="flex min-h-13 cursor-pointer list-none items-center justify-center gap-3 rounded-full bg-gold px-7 font-semibold text-espresso transition-[background-color,transform] duration-200 hover:bg-sand active:scale-[0.98] group-open:bg-transparent group-open:text-cream group-open:underline group-open:underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cream [&::-webkit-details-marker]:hidden">
        <span className="naqah-ring relative size-2 rounded-full bg-espresso group-open:hidden" aria-hidden="true" />
        <span className="group-open:hidden">{owner.answer}</span>
        <span className="hidden group-open:inline">{owner.hangUp}</span>
      </summary>
      <div className="motion-safe:animate-fade-up pt-5">
        <div role="group" className="flex flex-wrap gap-x-5">
          {options.map((option) => (
            <button
              key={option.label}
              type="button"
              aria-pressed={option.quiet === quiet}
              onClick={() => setQuiet(option.quiet)}
              className="min-h-11 text-[0.9375rem] font-semibold text-cream/70 underline-offset-[6px] transition-colors hover:text-cream aria-pressed:text-cream aria-pressed:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current"
            >
              {option.label}
            </button>
          ))}
        </div>
        <blockquote key={quote} aria-live="polite" className="motion-safe:animate-fade-up mt-3 text-xl leading-[1.55] text-cream lg:min-h-[6.2em]">
          {locale === "ar" ? `«${quote}»` : `“${quote}”`}
        </blockquote>
        <SpeechButton text={quote} />
      </div>
    </details>
  );
}
