"use client";

import { Check } from "@phosphor-icons/react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/cn";
import { EstatePhoto } from "./EstatePhoto";
import { AnswerCall } from "./LandingActions";

const seq = (i: number) => ({ "--i": i }) as CSSProperties;

/* ─── The four pictures of the evening, built from the product's own parts ─── */

function CallingVisual() {
  const { m } = useI18n();
  const { call, calling } = m.landing;
  return (
    <div className="w-full max-w-[32rem] border border-stone bg-cream">
      <div className="flex items-center gap-3 border-b border-stone px-5 py-4">
        <span aria-hidden className="naqah-ring relative size-2.5 rounded-full bg-ok" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold leading-tight">{calling.title}</p>
          <p className="text-[0.875rem] text-muted">{calling.role}</p>
        </div>
        <span className="ltr-nums text-[0.875rem] tabular-nums text-muted">17:40</span>
      </div>
      <ol className="grid gap-2.5 p-5">
        {call.lines.map((line, index) => {
          const naqah = line.who === "naqah";
          return (
            <li
              key={line.text}
              style={seq(index)}
              className={cn(
                "naqah-seq max-w-[88%] px-4 py-2.5 text-[0.9375rem] leading-relaxed",
                naqah ? "justify-self-start bg-sand-soft/70" : "justify-self-end bg-espresso text-cream",
              )}
            >
              <span className={cn("block text-[0.8125rem] font-semibold", naqah ? "text-brown" : "text-sand")}>
                {naqah ? call.naqah : call.worker}
              </span>
              {line.text}
            </li>
          );
        })}
      </ol>
      <div className="flex items-center justify-between gap-3 border-t border-stone px-5 py-3 text-[0.875rem] text-muted">
        <span>{calling.question}</span>
        <span aria-hidden className="naqah-voice flex h-4 items-center gap-[3px]">
          {[0.5, 0.9, 0.6, 1, 0.7].map((h, i) => (
            <span key={i} className="w-[3px] rounded-full bg-brown" style={{ height: `${h * 100}%`, ...seq(i) }} />
          ))}
        </span>
      </div>
    </div>
  );
}

function ReportVisual() {
  const { m } = useI18n();
  const { call, report, preview } = m.landing;
  return (
    <div className="relative w-full max-w-[30rem] bg-cream p-6 sm:p-9">
      <div className="flex items-baseline justify-between gap-4">
        <p className="text-xl font-semibold">{report.title}</p>
        <p className="text-[0.875rem] text-muted">{preview.ranch}</p>
      </div>
      <dl className="mt-6 grid gap-0">
        {call.facts.map((fact, index) => (
          <div key={fact.label} style={seq(index)} className="naqah-seq grid grid-cols-[6.5rem_1fr] gap-3 border-t border-stone py-4">
            <dt className="font-semibold text-brown">{fact.label}</dt>
            <dd>
              <span className="block leading-snug">{fact.value}</span>
              <span className="mt-1 flex flex-wrap items-center gap-x-3 text-[0.875rem]">
                <span className="text-muted">{fact.certainty}</span>
                <span className="inline-flex items-center gap-1.5 font-semibold text-warn">
                  <span aria-hidden className="size-1.5 rounded-full bg-warn" />
                  {report.forYou}
                </span>
              </span>
            </dd>
          </div>
        ))}
      </dl>
      <p style={seq(2)} className="naqah-seq border-t border-stone pt-4 text-[0.875rem] leading-relaxed text-muted">{call.kept}</p>
      <p className="naqah-stamp absolute -top-4 end-6 inline-flex items-center gap-2 bg-ok px-3.5 py-2 text-[0.875rem] font-semibold text-cream">
        <Check size={16} weight="bold" aria-hidden />
        <span className="ltr-nums">{report.saved}</span>
      </p>
    </div>
  );
}

function OwnerVisual() {
  const { m } = useI18n();
  const { owner, call, example, story } = m.landing;
  return (
    <div className="w-full max-w-[28rem] border border-gold/40 bg-espresso p-6 text-cream sm:p-8">
      <p className="flex items-center gap-3 text-[0.9375rem] text-sand">
        <span aria-hidden className="naqah-ring relative size-3 rounded-full bg-gold" />
        <span className="ltr-nums tabular-nums">{story.steps[2].time}</span>
      </p>
      <p className="mt-3 text-2xl font-semibold leading-snug">{owner.caller}</p>
      <AnswerCall />
      <p className="mt-5 text-[0.875rem] text-cream/70">
        {call.label}. {example}
      </p>
    </div>
  );
}

function PreviewVisual() {
  const { m } = useI18n();
  const { preview, call, example } = m.landing;
  return (
    <div className="w-full max-w-[36rem] overflow-hidden border border-stone bg-ivory">
      <div className="flex items-center gap-2 border-b border-stone bg-cream px-4 py-2.5">
        <span aria-hidden className="flex gap-1.5">
          <span className="size-2 rounded-full bg-stone" />
          <span className="size-2 rounded-full bg-stone" />
          <span className="size-2 rounded-full bg-stone" />
        </span>
        <span className="mx-auto text-[0.8125rem] text-muted">{preview.address}</span>
      </div>
      <div className="naqah-seq bg-espresso px-5 py-5 text-cream" style={seq(0)}>
        <p className="text-xl font-semibold">{preview.ranch}</p>
        <p className="mt-1 text-[0.875rem] text-cream/75">{preview.updated}</p>
      </div>
      <div className="grid gap-5 p-5 sm:grid-cols-[1.15fr_1fr]">
        <div style={seq(1)} className="naqah-seq">
          <p className="text-[0.875rem] font-semibold text-muted">{preview.needs}</p>
          <ul className="mt-2 grid gap-2">
            {call.facts.map((fact) => (
              <li key={fact.label} className="flex items-start gap-2.5 border-s-2 border-warn bg-cream px-3 py-2 text-[0.9375rem] leading-snug">
                <span>
                  <span className="font-semibold">{fact.label}</span> · {fact.value}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div style={seq(2)} className="naqah-seq">
          <p className="text-[0.875rem] font-semibold text-muted">{preview.herd}</p>
          <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1.5 text-[0.9375rem]">
            {preview.herdNames.map((name, index) => (
              <li key={name} className="inline-flex items-center gap-1.5">
                <span aria-hidden className={cn("size-2 rounded-full", index === 0 ? "border-2 border-warn bg-cream" : "bg-ok")} />
                {name}
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div style={seq(3)} className="naqah-seq flex items-center justify-between gap-3 border-t border-stone px-5 py-3 text-[0.875rem]">
        <span className="inline-flex items-center gap-2">
          <span aria-hidden className="size-2.5 rounded-full border-2 border-brown" />
          <span className="text-muted">{preview.next}</span>
          <span className="ltr-nums font-semibold">{preview.nextValue}</span>
        </span>
        <span className="text-muted">{example}</span>
      </div>
    </div>
  );
}

const VISUALS = [CallingVisual, ReportVisual, OwnerVisual, PreviewVisual];

/** What a screen reader hears for each picture that is only drawn. The owner's call is a real control. */
function useSummaries(): (string | null)[] {
  const { m } = useI18n();
  const { call, report, preview } = m.landing;
  return [
    call.lines.map((line) => `${line.who === "naqah" ? call.naqah : call.worker}: ${line.text}`).join(" "),
    `${report.title}, ${report.saved}. ${call.facts.map((f) => `${f.label}: ${f.value}, ${f.certainty}`).join(". ")}. ${call.kept}`,
    null,
    preview.summary,
  ];
}

/* ─── The sequence ─── */

/**
 * The evening as a scroll-led sequence. On wide screens the steps scroll past a sticky stage that
 * shows each step's picture as it reaches the middle of the screen; the time line above the stage
 * jumps between steps. On phones every step carries its own picture inline. Without a script the
 * first picture stays on the stage and every step still reads in full.
 */
export function CallStory() {
  const { m, locale } = useI18n();
  const { story } = m.landing;
  const summaries = useSummaries();
  const [active, setActive] = useState(0);
  const [seen, setSeen] = useState<boolean[]>(() => story.steps.map(() => false));
  const stepRefs = useRef<(HTMLLIElement | null)[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);
  // The stage's photograph loads as the story comes near, never alongside the hero.
  const [near, setNear] = useState(false);
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) {
        setNear(true);
        observer.disconnect();
      }
    }, { rootMargin: "0px" });
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const steps = stepRefs.current.filter((el): el is HTMLLIElement => Boolean(el));
    const centre = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActive(Number((entry.target as HTMLElement).dataset.step));
        }
      },
      { rootMargin: "-48% 0px -48% 0px" },
    );
    const inline = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const index = Number((entry.target as HTMLElement).dataset.step);
          setSeen((current) => (current[index] ? current : current.map((value, i) => (i === index ? true : value))));
          inline.unobserve(entry.target);
        }
      },
      { threshold: 0.35 },
    );
    for (const step of steps) {
      centre.observe(step);
      inline.observe(step);
    }
    return () => {
      centre.disconnect();
      inline.disconnect();
    };
  }, []);

  function jump(index: number) {
    const target = stepRefs.current[index];
    if (!target) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
    setActive(index);
  }

  return (
    <div ref={rootRef} className="grid gap-y-16 lg:grid-cols-12 lg:gap-x-12">
      <ol className="grid gap-16 lg:col-span-5 lg:gap-0">
        {story.steps.map((step, index) => {
          const Visual = VISUALS[index];
          const summary = summaries[index];
          return (
            <li
              key={step.title}
              ref={(el) => {
                stepRefs.current[index] = el;
              }}
              data-step={index}
              aria-current={active === index ? "step" : undefined}
              className="naqah-step lg:flex lg:min-h-[58svh] lg:flex-col lg:justify-center"
            >
              <p className="naqah-step-time flex items-center gap-3 text-[0.9375rem] text-muted">
                <span
                  aria-hidden
                  className={cn("naqah-step-mark size-3 rounded-full", index < 2 ? "bg-brown" : index === 2 ? "border-2 border-gold bg-gold" : "border-2 border-brown")}
                />
                <span className="ltr-nums tabular-nums">{step.time || story.anyTime}</span>
              </p>
              <h3 className="mt-3 max-w-[18ch] text-balance text-[clamp(1.625rem,2.6vw,2.375rem)] font-semibold leading-[1.15] [html[lang=ar]_&]:leading-[1.35]">
                {step.title}
              </h3>
              <p className="mt-3 max-w-[30rem] text-lg leading-8 text-espresso">{step.body}</p>
              {summary ? <p className="sr-only">{summary}</p> : null}
              {/* Phones and tablets: the picture follows its step. */}
              <div
                data-on={seen[index] ? "" : undefined}
                aria-hidden={summary ? true : undefined}
                data-ui
                className="mt-8 flex justify-center bg-sand-soft/60 px-4 py-8 sm:px-8 lg:hidden"
              >
                <Visual />
              </div>
            </li>
          );
        })}
      </ol>

      {/* Wide screens: one stage that changes with the step in the middle of the screen. */}
      <div className="hidden lg:col-span-7 lg:block">
        <div data-ui className="sticky top-24 isolate flex h-[min(46rem,calc(100svh-8rem))] flex-col overflow-hidden bg-espresso">
          {/* The ranch behind the paperwork, darkened so the pieces read. */}
          <div aria-hidden className="absolute inset-0 -z-10">
            {near ? <EstatePhoto id="evening" locale={locale} sizes="(min-width: 1024px) 56vw, 1px" ground="bg-brown-deep" className="h-full w-full" /> : <div className="h-full w-full bg-brown-deep" />}
            <div className="absolute inset-0 bg-espresso/70" />
          </div>
          <nav aria-label={story.progress} className="px-8 pt-7 text-cream">
            <ol className="relative grid grid-cols-4">
              <span aria-hidden className="absolute inset-x-[12.5%] top-[5px] h-0.5 bg-cream/25" />
              <span
                aria-hidden
                className="naqah-progress absolute start-[12.5%] top-[5px] h-0.5 bg-gold"
                style={{ width: `${(active / (story.steps.length - 1)) * 75}%` }}
              />
              {story.steps.map((step, index) => (
                <li key={step.title} className="relative flex justify-center">
                  <button
                    type="button"
                    onClick={() => jump(index)}
                    aria-current={active === index ? "step" : undefined}
                    className="group flex min-h-11 flex-col items-center gap-2 px-2 text-[0.8125rem] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cream"
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "size-3 rounded-full border-2 transition-[background-color,border-color,scale] duration-300 group-hover:scale-125",
                        index <= active ? "border-gold bg-gold" : "border-cream/50 bg-espresso",
                        index === active && "scale-125",
                      )}
                    />
                    <span className={cn("ltr-nums tabular-nums transition-colors", index === active ? "font-semibold text-cream" : "text-cream/65 group-hover:text-cream")}>
                      {step.time || story.anyTime}
                    </span>
                    <span className="sr-only">{step.title}</span>
                  </button>
                </li>
              ))}
            </ol>
          </nav>
          <div className="relative flex-1">
            {VISUALS.map((Visual, index) => (
              <div
                key={index}
                data-on={active === index ? "" : undefined}
                aria-hidden={summaries[index] ? true : undefined}
                className="naqah-layer absolute inset-0 flex items-center justify-center p-8"
              >
                <Visual />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
