"use client";

import { List, SpeakerHigh } from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import type { Plan } from "@/domain/types";
import { useI18n } from "@/i18n/client";
import { LocaleSwitcher } from "@/components/shell/LocaleSwitcher";
import { useWorkspaceStore } from "@/store/workspace";
import { buttonClass, type ButtonStyleProps } from "@/components/ui/Button";

type DemoActionProps = ButtonStyleProps & {
  children: ReactNode;
  plan?: Plan;
};

/** Starts the sample farm when needed, then opens the owner dashboard. */
export function DemoAction({ children, plan, ...style }: DemoActionProps) {
  const { locale, href } = useI18n();
  const router = useRouter();

  function start() {
    const state = useWorkspaceStore.getState();
    if (plan) {
      state.startDemo(locale, plan);
    } else if (!state.workspace?.setupComplete) {
      state.startDemo(locale);
    }
    router.push(href("/app"));
  }

  return (
    <button type="button" onClick={start} className={buttonClass(style)}>
      {children}
    </button>
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
          <div className="mt-1 border-t border-stone/70 pt-2">
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
      className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-gold underline-offset-4 transition hover:text-cream hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current"
    >
      <SpeakerHigh size={18} weight="regular" aria-hidden="true" />
      {speaking ? m.landing.owner.stop : m.landing.owner.listen}
    </button>
  );
}

/** What the owner hears: one quote, two outcomes. */
export function OwnerCall() {
  const { m, locale } = useI18n();
  const owner = m.landing.owner;
  const [quiet, setQuiet] = useState(false);
  const quote = quiet ? owner.quietQuote : owner.reviewQuote;
  const options = [
    { quiet: false, label: owner.review },
    { quiet: true, label: owner.quiet },
  ];

  return (
    <div>
      <div className="flex flex-wrap gap-x-6 gap-y-1 border-b border-cream/15">
        {options.map((option) => {
          const active = option.quiet === quiet;
          return (
            <button
              key={option.label}
              type="button"
              aria-pressed={active}
              onClick={() => setQuiet(option.quiet)}
              className={`-mb-px min-h-11 border-b-2 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current ${
                active ? "border-gold text-cream" : "border-transparent text-cream/55 hover:text-cream"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      <blockquote
        key={quote}
        aria-live="polite"
        className="motion-safe:animate-fade-up mt-8 text-[clamp(1.6rem,3.4vw,2.75rem)] font-medium leading-[1.3] tracking-[-0.015em] text-cream lg:min-h-[4em]"
      >
        {locale === "ar" ? `«${quote}»` : `“${quote}”`}
      </blockquote>
      <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2">
        <SpeechButton text={quote} />
        <p className="text-sm text-cream/70">{m.landing.example}</p>
      </div>
    </div>
  );
}
