import { ArrowRight } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import type { CSSProperties } from "react";
import type { Locale, Plan } from "@/domain/types";
import { REPORT_CALL_RETRIES, RETRY_DELAY_MS } from "@/domain/clock";
import { MONTHLY_PLAN_PRICES_SAR, VAT_PERCENT } from "@/domain/pricing";
import { getStartedPath } from "@/components/entry/paths";
import { weekdayForms } from "@/components/visuals/weekdays";
import { formatNumber } from "@/i18n/format";
import { defineMessages } from "@/i18n/types";
import { TiltCard } from "./TiltCard";
import "./plans.css";

const retryMinutes = RETRY_DELAY_MS / 60_000;

/** Copy for the plans section. Facts follow AGENT.md §2; the two plans differ only in rhythm and instructions. */
const copy = defineMessages({
  en: {
    title: "Two plans, on your ranch’s rhythm",
    lead: "Choose how often you hear from your ranch. The rest is the same peace of mind.",
    pricing: (percent: number) => `Per ranch, per month, shown before and including ${percent}% VAT. Nothing is charged in the demo.`,
    currency: "SAR",
    beforeVat: "a month before VAT",
    includingVat: (percent: number, price: string) => `${price} including ${percent}% VAT`,
    both: (attempts: number, minutes: number) =>
      `On both plans: ${attempts} attempts, ${minutes} minutes apart. No recordings, facts only. In an emergency your worker calls you directly.`,
    details: "Compare every detail",
    caption: "Basic and Ultimate compared",
    feature: "What you get",
    sameOnBoth: "Same",
    notIncluded: "Not included",
    ring: {
      basic: "Basic week: one report call on the weekday you set, Thursday in this example, and one summary call to you at your own time.",
      ultimate: "Ultimate week: a report call every day at your time, and a summary call to you every day.",
      workerCall: "Report call",
      ownerCall: "Your summary call",
    },
    plans: {
      basic: {
        name: "Basic",
        rhythm: "Once a week, on the weekday and time you set.",
        start: "Start with Basic",
        items: [
          "One report call a week to your primary worker, on the weekday and time you set",
          "Up to 5 questions of your own, beside NAQAH’s",
          "Up to 3 registered workers",
          "One summary call to you a week, at your own time, placed even when no verified report came in",
        ],
      },
      ultimate: {
        name: "Ultimate",
        rhythm: "Every day, at the time you set.",
        start: "Start with Ultimate",
        items: [
          "One report call a day to your primary worker, at the time you set",
          "Unlimited questions of your own",
          "Up to 10 registered workers",
          "A summary call to you every day, then your spoken instructions: tasks become tickets that close only when the worker confirms",
          "Scheduled task checks, by call",
        ],
      },
    },
    rows: {
      report: { label: "Report call", basic: "Weekly, on your weekday and time", ultimate: "Daily, at your time" },
      questions: { label: "Your own questions", basic: "Up to 5", ultimate: "Unlimited" },
      workers: { label: "Registered workers", basic: "Up to 3", ultimate: "Up to 10" },
      summary: { label: "Summary call to you", basic: "Weekly, at your own time", ultimate: "Daily, at your own time" },
      instructions: { label: "Spoken instructions, tracked as tasks", basic: "", ultimate: "Included; a task closes only when the worker confirms" },
      checks: { label: "Scheduled task checks", basic: "", ultimate: "By call" },
      retries: { label: "Retries on every call", both: (attempts: number, minutes: number) => `${attempts} attempts, ${minutes} minutes apart` },
      recordings: { label: "Recordings", both: () => "None, facts only" },
      emergency: { label: "Emergency", both: () => "Your worker calls you directly" },
      price: { label: "Monthly price per ranch", value: (before: string, including: string) => `SAR ${before} before VAT, SAR ${including} including VAT` },
    },
  },
  ar: {
    title: "خطتان، على إيقاع عزبتك",
    lead: "اختر كم مرة تسمع من عزبتك. الباقي نفس الاطمئنان.",
    pricing: (percent: number) => `لكل عزبة، شهريًا، قبل الضريبة وشاملة ${percent}٪ ضريبة القيمة المضافة. العرض التجريبي ما يسحب أي مبلغ.`,
    currency: "ريال",
    beforeVat: "شهريًا قبل الضريبة",
    includingVat: (percent: number, price: string) => `${price} شامل ضريبة القيمة المضافة ${percent}٪`,
    both: (attempts: number, minutes: number) =>
      `في الخطتين: ${attempts} محاولات بينها ${minutes} دقيقة. بدون تسجيل، حقائق فقط. وفي الطوارئ عاملك يتصل عليك مباشرة.`,
    details: "قارن كل التفاصيل",
    caption: "مقارنة بين الأساسية والمتكاملة",
    feature: "اللي تحصل عليه",
    sameOnBoth: "نفس الشيء",
    notIncluded: "غير متوفرة",
    ring: {
      basic: "أسبوع الأساسية: مكالمة تقرير وحدة في اليوم اللي تحدده، هنا الخميس، ومكالمة ملخّص لك في وقتك.",
      ultimate: "أسبوع المتكاملة: مكالمة تقرير كل يوم في وقتك، ومكالمة ملخّص لك كل يوم.",
      workerCall: "مكالمة التقرير",
      ownerCall: "مكالمة الملخّص لك",
    },
    plans: {
      basic: {
        name: "الأساسية",
        rhythm: "مرة في الأسبوع، في اليوم والوقت اللي تحدده.",
        start: "ابدأ بالأساسية",
        items: [
          "مكالمة تقرير واحدة في الأسبوع على عاملك الأساسي، في اليوم والوقت اللي تحدده",
          "حتى 5 أسئلة من عندك، فوق أسئلة ناقة",
          "حتى 3 عمّال مسجّلين",
          "مكالمة ملخّص لك مرة في الأسبوع في وقتك، تتصل حتى لو ما وصل تقرير مؤكد",
        ],
      },
      ultimate: {
        name: "المتكاملة",
        rhythm: "كل يوم، في الوقت اللي تحدده.",
        start: "ابدأ بالمتكاملة",
        items: [
          "مكالمة تقرير كل يوم على عاملك الأساسي، في الوقت اللي تحدده",
          "أسئلتك بلا حد",
          "حتى 10 عمّال مسجّلين",
          "مكالمة ملخّص لك كل يوم، وبعدها تعليماتك بصوتك: المهام تصير تذاكر ما تنقفل إلا إذا أكّدها العامل",
          "متابعة المهام في وقتها، بمكالمة",
        ],
      },
    },
    rows: {
      report: { label: "مكالمة التقرير", basic: "أسبوعيًا، في يومك ووقتك", ultimate: "يوميًا، في وقتك" },
      questions: { label: "أسئلتك الخاصة", basic: "حتى 5", ultimate: "بلا حد" },
      workers: { label: "العمّال المسجّلين", basic: "حتى 3", ultimate: "حتى 10" },
      summary: { label: "مكالمة الملخّص لك", basic: "أسبوعيًا في وقتك", ultimate: "يوميًا في وقتك" },
      instructions: { label: "تعليماتك بصوتك، تتابعها ناقة كمهام", basic: "", ultimate: "متوفرة، وما تنقفل المهمة إلا بتأكيد العامل" },
      checks: { label: "متابعة المهام في وقتها", basic: "", ultimate: "بمكالمة" },
      retries: { label: "المحاولات في كل مكالمة", both: (attempts: number, minutes: number) => `${attempts} محاولات بينها ${minutes} دقيقة` },
      recordings: { label: "التسجيل", both: () => "لا شيء، حقائق فقط" },
      emergency: { label: "الطوارئ", both: () => "عاملك يتصل عليك مباشرة" },
      price: { label: "السعر الشهري لكل عزبة", value: (before: string, including: string) => `${before} ريال قبل الضريبة، ${including} ريال شامل الضريبة` },
    },
  },
});

const SAMPLE_WEEKDAY = 4; // Thursday, as in the sample ranch.

/**
 * The week as a tilted ring of seven nights. A lit night is a report call (ember); the Ultimate ring adds the
 * dashed inner ring: NAQAH calls the owner every evening. Letters stand upright above their night.
 */
function WeekRing({ plan, locale }: { plan: Plan; locale: Locale }) {
  const c = copy[locale];
  const longName = (index: number) =>
    new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" }).format(Date.UTC(2023, 0, 1 + index));
  const lit = (index: number) => plan === "ultimate" || index === SAMPLE_WEEKDAY;
  const spoken = `${c.ring[plan]} ${Array.from({ length: 7 }, (_, i) => `${longName(i)}: ${lit(i) ? c.ring.workerCall : "—"}`).join(". ")}`;
  return (
    <div role="img" aria-label={spoken} className="ring-stage mt-6">
      <div aria-hidden className="ring-plane">
        <span className="ring-track" />
        {plan === "ultimate" ? <span className="ring-inner" /> : null}
        <span className="ring-sweep" />
        {Array.from({ length: 7 }, (_, index) => {
          const on = lit(index);
          return (
            <span key={index} className="ring-night" style={{ "--a": `${(index * 360) / 7}deg` } as CSSProperties}>
              <span className="ring-dot" data-lit={on} />
              <span className="ring-pillar">
                <span className="ring-beam" data-lit={on} />
                <span className="ring-letter" data-lit={on}>
                  {weekdayForms(locale, index).narrow}
                </span>
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

function Price({ plan, locale }: { plan: Plan; locale: Locale }) {
  const c = copy[locale];
  const price = MONTHLY_PLAN_PRICES_SAR[plan];
  return (
    <p className="shrink-0 text-end">
      <span className="flex items-baseline justify-end gap-1.5">
        <span className="ltr-nums text-[2.25rem] font-semibold leading-none tracking-tight text-[var(--gold-bright)] sm:text-[2.5rem]">
          {formatNumber(price.beforeVat, locale)}
        </span>
        <span className="text-sm font-semibold text-[var(--text-muted)]">{c.currency}</span>
      </span>
      <span className="mt-1 block text-xs leading-5 text-[var(--text-faint)]">{c.beforeVat}</span>
      <span className="block text-xs leading-5 text-[var(--text-faint)]">
        {c.includingVat(VAT_PERCENT, formatNumber(price.includingVat, locale))}
      </span>
    </p>
  );
}

function PlanCard({ plan, locale }: { plan: Plan; locale: Locale }) {
  const c = copy[locale];
  const p = c.plans[plan];
  const daily = plan === "ultimate";
  return (
    <TiltCard
      labelledBy={`plan-${plan}`}
      className={daily ? "night-glass-strong p-6 sm:p-8" : "p-6 sm:p-8"}
      style={daily ? { borderColor: "rgba(216, 173, 108, 0.38)" } : undefined}
    >
      <div className="flex items-start justify-between gap-5">
        <div className="min-w-0">
          <h3 id={`plan-${plan}`} className="text-[1.75rem] font-semibold leading-tight sm:text-[2rem]">
            {p.name}
          </h3>
          <p className="mt-1.5 text-base leading-7 text-[var(--text-muted)]">{p.rhythm}</p>
        </div>
        <Price plan={plan} locale={locale} />
      </div>

      <WeekRing plan={plan} locale={locale} />

      <ul className="mt-5 grid gap-2.5 text-[0.95rem] leading-7">
        {p.items.map((item) => (
          <li key={item} className="flex gap-3">
            <span aria-hidden className={`mt-[0.8rem] size-1.5 shrink-0 rounded-full ${daily ? "bg-[var(--gold-bright)]" : "bg-[var(--ember)]"}`} />
            <span>{item}</span>
          </li>
        ))}
      </ul>

      <div className="mt-auto flex flex-wrap items-center gap-x-6 gap-y-3 pt-7">
        <Link
          href={getStartedPath(locale)}
          className={`inline-flex min-h-12 items-center gap-2 rounded-full px-6 text-[0.95rem] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--gold-bright)] ${
            daily ? "night-cta" : "night-cta-quiet"
          }`}
        >
          {p.start}
          <ArrowRight size={18} weight="bold" aria-hidden className="rtl:-scale-x-100" />
        </Link>
        <a
          href="#plans-details"
          className="inline-flex min-h-11 items-center font-semibold text-[var(--text-muted)] underline decoration-1 underline-offset-[6px] transition-colors hover:text-[var(--text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current"
        >
          {c.details}
        </a>
      </div>
    </TiltCard>
  );
}

/** Every detail in one table: hairline rows, words not colours, one fact per cell. */
function Details({ locale }: { locale: Locale }) {
  const c = copy[locale];
  const r = c.rows;
  const money = (plan: Plan) =>
    r.price.value(formatNumber(MONTHLY_PLAN_PRICES_SAR[plan].beforeVat, locale), formatNumber(MONTHLY_PLAN_PRICES_SAR[plan].includingVat, locale));
  const rows: { label: string; basic: string; ultimate: string; same?: boolean }[] = [
    r.report,
    r.questions,
    r.workers,
    r.summary,
    r.instructions,
    r.checks,
    { label: r.retries.label, basic: r.retries.both(REPORT_CALL_RETRIES, retryMinutes), ultimate: c.sameOnBoth, same: true },
    { label: r.recordings.label, basic: r.recordings.both(), ultimate: c.sameOnBoth, same: true },
    { label: r.emergency.label, basic: r.emergency.both(), ultimate: c.sameOnBoth, same: true },
    { label: r.price.label, basic: money("basic"), ultimate: money("ultimate") },
  ];
  return (
    <div id="plans-details" className="scroll-mt-24 pt-16 lg:pt-20">
      <h3 className="text-2xl font-semibold leading-tight sm:text-3xl">{c.details}</h3>
      <table className="mt-6 w-full border-collapse text-start text-sm leading-6 sm:text-[0.95rem] sm:leading-7">
        <caption className="sr-only">{c.caption}</caption>
        <thead>
          <tr className="border-b border-[var(--line-strong)] text-[var(--text-faint)]">
            <th scope="col" className="py-3 pe-4 text-start font-medium">
              {c.feature}
            </th>
            <th scope="col" className="py-3 pe-4 text-start font-semibold text-[var(--text)]">
              {c.plans.basic.name}
            </th>
            <th scope="col" className="py-3 text-start font-semibold text-[var(--gold-bright)]">
              {c.plans.ultimate.name}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="border-b border-[var(--line)] align-top">
              <th scope="row" className="py-3.5 pe-4 text-start font-medium text-[var(--text-muted)]">
                {row.label}
              </th>
              <td className="py-3.5 pe-4 text-[var(--text)]">{row.basic || <span className="text-[var(--text-faint)]">{c.notIncluded}</span>}</td>
              <td className={`py-3.5 ${row.same ? "text-[var(--text-faint)]" : "text-[var(--text)]"}`}>{row.ultimate}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function NightPlans({ locale }: { locale: Locale }) {
  const c = copy[locale];
  return (
    <section id="plans" aria-labelledby="plans-title" className="relative scroll-mt-20 py-20 sm:py-24 lg:py-32">
      <div className="night-frame">
        <hr aria-hidden className="night-rule mb-14 lg:mb-20" />
        <div className="grid gap-x-12 gap-y-4 lg:grid-cols-12 lg:items-end">
          <h2 id="plans-title" className="night-title lg:col-span-7">
            {c.title}
          </h2>
          <p className="max-w-[30rem] text-lg leading-8 text-[var(--text-muted)] lg:col-span-5">{c.lead}</p>
        </div>

        <div className="mt-10 grid gap-5 lg:mt-14 lg:grid-cols-2 lg:gap-7">
          <PlanCard plan="basic" locale={locale} />
          <PlanCard plan="ultimate" locale={locale} />
        </div>

        <p className="mt-6 max-w-[46rem] text-[0.95rem] leading-7 text-[var(--text-muted)]">{c.both(REPORT_CALL_RETRIES, retryMinutes)}</p>
        <p className="mt-1.5 text-sm leading-6 text-[var(--text-faint)]">{c.pricing(VAT_PERCENT)}</p>

        <Details locale={locale} />
      </div>
    </section>
  );
}
