import { ArrowRight } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import type { CSSProperties } from "react";
import type { Locale, Plan } from "@/domain/types";
import { REPORT_CALL_RETRIES, RETRY_DELAY_MS } from "@/domain/clock";
import { MONTHLY_PLAN_PRICES_SAR, VAT_PERCENT } from "@/domain/pricing";
import { getStartedPath } from "@/components/entry/paths";
import { weekdayForms } from "@/components/visuals/weekdays";
import { formatNumber } from "@/i18n/format";
import { getMessages } from "@/i18n/messages";
import { TiltCard } from "./TiltCard";
import "./plans.css";

const retryMinutes = RETRY_DELAY_MS / 60_000;

const SAMPLE_WEEKDAY = 4; // Thursday, as in the sample ranch.

/**
 * The week as a tilted ring of seven nights. A lit night is a report call (ember); the Ultimate ring adds the
 * dashed inner ring: NAQAH calls the owner every evening. Letters stand upright above their night.
 */
function WeekRing({ plan, locale }: { plan: Plan; locale: Locale }) {
  const c = getMessages(locale).landing.night.plans;
  const longName = (index: number) =>
    new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" }).format(Date.UTC(2023, 0, 1 + index));
  const lit = (index: number) => plan === "ultimate" || index === SAMPLE_WEEKDAY;
  const spoken = `${c.ring[plan]} ${Array.from({ length: 7 }, (_, i) => `${longName(i)}: ${lit(i) ? c.ring.workerCall : "—"}`).join(". ")}`;
  return (
    <div role="img" aria-label={spoken} className="ring-stage mt-6">
      <div aria-hidden className="ring-plane">
        <span className="ring-track" />
        {plan === "ultimate" ? <span className="ring-inner" /> : null}
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
  const c = getMessages(locale).landing.night.plans;
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
  const c = getMessages(locale).landing.night.plans;
  const p = c.plans[plan];
  const daily = plan === "ultimate";
  return (
    <TiltCard
      labelledBy={`plan-${plan}`}
      className={daily ? "night-glass-strong p-6 sm:p-8" : "p-6 sm:p-8"}
      style={daily ? { borderColor: "rgba(216, 173, 108, 0.38)" } : undefined}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-5">
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
  const c = getMessages(locale).landing.night.plans;
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
  const c = getMessages(locale).landing.night.plans;
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
