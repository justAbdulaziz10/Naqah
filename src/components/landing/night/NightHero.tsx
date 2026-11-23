import { ArrowRight } from "@phosphor-icons/react/dist/ssr";
import type { CSSProperties } from "react";
import type { Locale } from "@/domain/types";
import { defineMessages } from "@/i18n/types";
import { EntryActions } from "../EntryActionsServer";
import { DuneScene } from "./DuneScene";
import "./hero.css";

const copy = defineMessages({
  en: {
    title: "Peace of mind, without the busyness",
    lead: "NAQAH calls your worker at the time you choose, keeps the facts, then calls you with only what matters.",
    scene: "Night over the dunes. One light at the ranch pulses each time NAQAH places its call.",
    tonight: {
      title: "Tonight at Al Safra Ranch",
      sample: "Illustrative sample",
      done: "Done",
      ahead: "Still to come",
      steps: [
        { time: "5:40 PM", title: "NAQAH calls Ahmed", detail: "Worker, on his ordinary phone" },
        { time: "5:44 PM", title: "The report is saved", detail: "Facts only, no recording" },
        { time: "7:00 PM", title: "NAQAH calls you", detail: "Only what matters" },
      ],
    },
  },
  ar: {
    title: "اطمئنان، دون انشغال",
    lead: "ناقة تتصل على عاملك في الوقت الذي تختاره، تحفظ الوقائع، ثم تتصل عليك بما يهمّ فقط.",
    scene: "ليل فوق الكثبان، وضوء واحد في العزبة ينبض كل ما اتصلت ناقة.",
    tonight: {
      title: "الليلة في عزبة الصفراء",
      sample: "مثال توضيحي",
      done: "تم",
      ahead: "لم يحن بعد",
      steps: [
        { time: "5:40 PM", title: "ناقة تتصل على أحمد", detail: "العامل، على جواله العادي" },
        { time: "5:44 PM", title: "حُفظ التقرير", detail: "وقائع فقط، بدون تسجيل" },
        { time: "7:00 PM", title: "ناقة تتصل عليك", detail: "بما يهمّ فقط" },
      ],
    },
  },
});

const quietLink =
  "inline-flex min-h-11 items-center font-semibold text-[var(--text)] underline decoration-[var(--line-strong)] decoration-1 underline-offset-[6px] transition-colors hover:decoration-[var(--gold-bright)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current";

function Arrow() {
  return <ArrowRight size={18} weight="bold" aria-hidden className="ms-2 rtl:-scale-x-100" />;
}

/** The sample evening as a vertical timeline on glass: a filled mark happened, a ring is still to come. */
function TonightCard({ c, className = "" }: { c: (typeof copy)["en"]["tonight"]; className?: string }) {
  const lastDone = 1; // The report is saved; the owner's call is still ahead.
  return (
    <aside className={`night-glass w-full max-w-sm p-5 sm:p-6 ${className}`} aria-label={c.title}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-base font-semibold text-[var(--text)]">{c.title}</h2>
        <span className="shrink-0 text-xs text-[var(--text-faint)]">{c.sample}</span>
      </div>
      <ol className="mt-5 grid gap-0">
        {c.steps.map((step, index) => {
          const done = index <= lastDone;
          const last = index === c.steps.length - 1;
          return (
            <li key={step.time} className="grid grid-cols-[4.25rem_1rem_minmax(0,1fr)] gap-x-3">
              <span className="ltr-nums pt-px text-sm tabular-nums text-[var(--text-muted)]">{step.time}</span>
              <span className="relative flex justify-center">
                <span
                  aria-hidden
                  className={`relative z-10 mt-1.5 size-2.5 rounded-full ${
                    index === 0
                      ? "night-hero-ember bg-[var(--ember)]"
                      : done
                        ? "bg-[var(--gold-bright)]"
                        : "border-2 border-[var(--gold-bright)] bg-transparent"
                  }`}
                />
                {!last ? <span aria-hidden className="absolute bottom-0 top-4 w-px bg-[var(--line-strong)]" /> : null}
              </span>
              <span className={`min-w-0 ${last ? "pb-0" : "pb-5"}`}>
                <span className="block text-[0.9375rem] font-semibold leading-6 text-[var(--text)]">{step.title}</span>
                <span className="block text-sm leading-6 text-[var(--text-muted)]">{step.detail}</span>
                <span className="sr-only">{done ? c.done : c.ahead}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </aside>
  );
}

/**
 * Arrival: the brand promise over a WebGL night at the ranch. The scene is decorative; the words and the
 * tonight card carry the meaning, so the page reads the same with the canvas off.
 */
export function NightHero({ locale }: { locale: Locale }) {
  const c = copy[locale];
  const delay = (ms: number) => ({ "--arrive-delay": `${ms}ms` }) as CSSProperties;

  return (
    <section aria-labelledby="landing-title" className="relative isolate">
      <div className="relative h-[62svh] min-h-[27rem] sm:h-[min(100svh,56rem)] sm:min-h-[36rem]">
        <DuneScene className="-z-10" />
        {/* A dark scrim under the title and along the ground, so text and the next section meet the scene quietly. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 bg-[linear-gradient(to_bottom,rgba(11,8,6,0.5)_0%,rgba(11,8,6,0.1)_30%,transparent_55%,var(--night-1)_100%)]"
        />
        <p className="sr-only">{c.scene}</p>

        <div className="night-frame relative flex h-full flex-col justify-end pb-10 pt-24 sm:pb-16 sm:pt-32 lg:justify-center lg:pb-20">
          <div className="lg:grid lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:items-end lg:gap-16">
            <div>
              <h1
                id="landing-title"
                className="night-display night-hero-arrive max-w-[12ch] text-[clamp(2.75rem,6.6vw,6.25rem)] text-[var(--text)] drop-shadow-[0_2px_24px_rgba(11,8,6,0.6)] lg:max-w-[13ch]"
              >
                {c.title}
              </h1>
              <p
                className="night-hero-arrive mt-6 max-w-[34rem] text-pretty text-lg leading-8 text-[var(--text-muted)] max-sm:hidden lg:mt-8 lg:text-xl lg:leading-9"
                style={delay(120)}
              >
                {c.lead}
              </p>
              <div className="night-hero-arrive mt-8 flex flex-wrap items-center gap-x-7 gap-y-3 max-sm:hidden" style={delay(220)}>
                <EntryActions primary={{ size: "lg", className: "night-cta" }} arrow={<Arrow />} demoClassName={quietLink} />
              </div>
            </div>
            {/* Desktop: the sample evening floats near the horizon, at the end side. */}
            <div className="night-hero-arrive hidden lg:flex lg:justify-end" style={delay(360)}>
              <TonightCard c={c.tonight} />
            </div>
          </div>
        </div>
      </div>

      {/* Phones and tablets: the sentence, the actions and the evening sit under the scene, in thumb reach. */}
      <div className="night-frame pt-6 lg:hidden">
        <p className="text-pretty text-lg leading-8 text-[var(--text-muted)] sm:hidden">{c.lead}</p>
        <div className="mt-6 flex flex-col items-stretch gap-2 sm:hidden">
          <EntryActions primary={{ size: "lg", className: "night-cta w-full" }} arrow={<Arrow />} demoClassName={`${quietLink} justify-center`} />
        </div>
        <div className="mt-8 flex sm:justify-center">
          <TonightCard c={c.tonight} className="sm:max-w-md" />
        </div>
      </div>
    </section>
  );
}
