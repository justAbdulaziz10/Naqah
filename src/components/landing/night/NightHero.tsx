import { ArrowRight } from "@phosphor-icons/react/dist/ssr";
import type { CSSProperties } from "react";
import type { Locale } from "@/domain/types";
import { getMessages } from "@/i18n/messages";
import { EntryActions } from "../EntryActionsServer";
import { NaqahMark3D } from "./NaqahMark3D";
import "./hero.css";

const quietLink =
  "inline-flex min-h-11 items-center font-semibold text-[var(--text)] underline decoration-[var(--line-strong)] decoration-1 underline-offset-[6px] transition-colors hover:decoration-[var(--gold-bright)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current";

function Arrow() {
  return <ArrowRight size={18} weight="bold" aria-hidden className="ms-2 rtl:-scale-x-100" />;
}

/** Arrival: the brand promise beside ناقة herself, the camel mark standing in three dimensions. */
export function NightHero({ locale }: { locale: Locale }) {
  const c = getMessages(locale).landing.night.hero;
  const delay = (ms: number) => ({ "--arrive-delay": `${ms}ms` }) as CSSProperties;

  return (
    <section aria-labelledby="landing-title" className="relative isolate overflow-x-clip pb-16 pt-28 sm:pb-20 sm:pt-32 lg:flex lg:min-h-[min(100svh,58rem)] lg:items-center lg:pb-24 lg:pt-32">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_50%_0%,rgba(210,170,120,0.14),transparent_60%)]"
      />
      <div className="night-frame grid items-center gap-14 lg:grid-cols-12 lg:gap-8">
        <div className="lg:col-span-6">
          <h1 id="landing-title" className="night-display night-hero-arrive max-w-[12ch] text-[clamp(2.75rem,6vw,5.75rem)] text-[var(--text)]">
            {c.title}
          </h1>
          <p className="night-hero-arrive mt-6 max-w-[32rem] text-pretty text-lg leading-8 text-[var(--text-muted)] lg:mt-8 lg:text-xl lg:leading-9" style={delay(100)}>
            {c.lead}
          </p>
          <div className="night-hero-arrive mt-8 flex flex-col items-stretch gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-7 sm:gap-y-3" style={delay(180)}>
            <EntryActions primary={{ size: "lg", className: "night-cta max-sm:w-full" }} arrow={<Arrow />} demoClassName={`${quietLink} max-sm:justify-center`} />
          </div>
        </div>
        <div className="mx-auto w-full max-w-[22rem] px-4 sm:max-w-[30rem] lg:col-span-6 lg:max-w-none lg:px-6">
          <NaqahMark3D />
        </div>
      </div>
    </section>
  );
}
