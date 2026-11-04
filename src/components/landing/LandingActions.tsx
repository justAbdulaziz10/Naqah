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
          className="inline-flex size-11 cursor-pointer list-none items-center justify-center rounded-full border border-stone text-espresso transition hover:bg-espresso/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold [&::-webkit-details-marker]:hidden"
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
              className="flex min-h-11 items-center rounded-xl px-3.5 text-sm font-semibold text-espresso transition hover:bg-ivory focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
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
      className="inline-flex min-h-11 items-center gap-2 rounded-full border border-cream/25 px-4 text-sm font-semibold text-cream transition hover:bg-cream/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
    >
      <SpeakerHigh size={18} weight="regular" aria-hidden="true" />
      {speaking ? m.landing.ownerCall.stop : m.landing.ownerCall.listen}
    </button>
  );
}
