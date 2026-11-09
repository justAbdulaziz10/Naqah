import { CaretDown } from "@phosphor-icons/react/dist/ssr";
import type { Locale } from "@/domain/types";
import { PlanPrice } from "@/components/plans/PlanPrice";
import { getMessages } from "@/i18n/messages";
import { cn } from "@/lib/cn";

const plans = ["basic", "ultimate"] as const;
const planRows = ["cadence", "questions", "update", "calls", "tickets"] as const;
/** Thursday, the sample Basic call's day (weeks run Sunday first, as in the product). */
const CALL_DAY = 4;
/** Arabic has no short weekday names, so a phone's seven-day row uses the one-letter forms (ح ن ث …). */
const narrowDay = (index: number) =>
  new Intl.DateTimeFormat("ar", { weekday: "narrow", timeZone: "UTC" }).format(Date.UTC(2023, 0, 1 + index)); // 1 Jan 2023 was a Sunday.

/** One plan's week on the product's time line: the report call, and NAQAH's call to you after it. */
function Week({ locale, plan }: { locale: Locale; plan: (typeof plans)[number] }) {
  const p = getMessages(locale).landing.plans;
  const daily = plan === "ultimate";
  // Ultimate sits on the dark sheet; Basic on paper.
  const c = daily
    ? { report: "bg-sand", thread: "bg-sand/50", rest: "bg-cream/25", on: "text-cream", off: "text-cream/65" }
    : { report: "bg-brown", thread: "bg-brown/60", rest: "bg-stone", on: "text-espresso", off: "text-muted" };
  return (
    <div role="img" aria-label={daily ? p.ultimateWeek : p.basicWeek} className="mt-8">
      <div aria-hidden className="grid grid-cols-7">
        {p.days.map((day, index) => {
          const on = daily || index === CALL_DAY;
          return (
            <div
              key={day}
              data-reveal=""
              data-reveal-delay={index * 50}
              className={cn("flex flex-col items-center gap-3 py-3", !daily && on && "bg-sand-soft/80")}
            >
              <span className={cn("text-[0.8125rem]", on ? `font-semibold ${c.on}` : c.off)}>
                {locale === "ar" ? (
                  <>
                    <span className="sm:hidden">{narrowDay(index)}</span>
                    <span className="hidden sm:inline">{day}</span>
                  </>
                ) : (
                  day
                )}
              </span>
              {on ? (
                <span className="flex flex-col items-center">
                  <span className={cn("size-3.5 rounded-full", c.report)} />
                  <span className={cn("h-5 w-0.5", c.thread)} />
                  <span className="size-3.5 rounded-full bg-gold" />
                </span>
              ) : (
                <span className="flex h-[3.25rem] items-center">
                  <span className={cn("h-0.5 w-3", c.rest)} />
                </span>
              )}
            </div>
          );
        })}
      </div>
      <div aria-hidden className={cn("mt-4 flex flex-wrap items-center gap-x-5 gap-y-1 text-[0.875rem]", c.off)}>
        <span className="inline-flex items-center gap-2">
          <span className={cn("size-2.5 rounded-full", c.report)} />
          {p.reportRow}
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="size-2.5 rounded-full bg-gold" />
          {p.ownerRow}
        </span>
        {daily ? null : <span>{p.chosenTime}</span>}
      </div>
    </div>
  );
}

/** Basic and Ultimate as the weeks they make, with the full comparison one step away. */
export function PlanWeeks({ locale }: { locale: Locale }) {
  const p = getMessages(locale).landing.plans;
  return (
    <div data-ui>
      <div className="grid gap-5 lg:grid-cols-2">
        {plans.map((plan, planIndex) => {
          const copy = p[plan];
          const daily = plan === "ultimate";
          return (
            <section
              key={plan}
              aria-labelledby={`plan-${plan}`}
              data-reveal=""
              data-reveal-delay={planIndex * 110}
              className={cn("flex flex-col border p-6 sm:p-9", daily ? "border-espresso bg-espresso text-cream" : "border-stone bg-cream")}
            >
              <h3 id={`plan-${plan}`} className="text-[clamp(1.875rem,3vw,2.75rem)] font-semibold leading-tight">
                {copy.name}
              </h3>
              <p className={cn("mt-2 text-lg leading-8", daily ? "text-cream/85" : "text-espresso")}>{copy.summary}</p>
              <PlanPrice
                plan={plan}
                copy={p.price}
                tone={daily ? "dark" : "light"}
                className={cn("mt-5 border-y py-4", daily ? "border-cream/20" : "border-stone")}
              />
              <Week locale={locale} plan={plan} />
              <dl className={cn("mt-8 grid gap-4 border-t pt-6", daily ? "border-cream/20" : "border-stone")}>
                <div className="flex items-baseline justify-between gap-6">
                  <dt className={daily ? "text-cream/75" : "text-muted"}>{p.labels.questions}</dt>
                  <dd className="text-end font-semibold">{copy.rows.questions}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-6">
                  <dt className={daily ? "text-cream/75" : "text-muted"}>{p.yourCalls}</dt>
                  <dd className="text-end font-semibold">{copy.rows.calls}</dd>
                </div>
                <div className="grid grid-cols-[1fr_auto] items-baseline gap-x-6 gap-y-2">
                  <dt className={daily ? "text-cream/75" : "text-muted"}>{p.tasks}</dt>
                  <dd className={cn("text-end font-semibold", !daily && "text-muted")}>{copy.rows.tickets}</dd>
                  {daily ? (
                    <dd className="col-span-2 flex items-center gap-3 bg-cream/10 px-4 py-3 text-[0.9375rem]">
                      <span aria-hidden className="size-3 shrink-0 rounded-full border-2 border-gold" />
                      <span>
                        <span className="font-semibold">{p.taskSample}</span>
                        <span className="text-cream/70"> · {p.taskOpen}</span>
                      </span>
                    </dd>
                  ) : null}
                </div>
              </dl>
            </section>
          );
        })}
      </div>

      <details className="group mt-5 border border-stone bg-cream">
        <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 px-6 font-semibold transition-colors hover:bg-ivory focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brown sm:px-9 [&::-webkit-details-marker]:hidden">
          {p.details}
          <CaretDown size={18} aria-hidden className="text-muted transition-transform duration-300 group-open:rotate-180" />
        </summary>
        <div className="overflow-x-auto px-2 pb-4 sm:px-5">
          <table className="w-full min-w-[20rem] table-fixed border-collapse text-start">
            <caption className="sr-only">{p.caption}</caption>
            <thead>
              <tr>
                <td className="w-[36%] p-4">
                  <span className="sr-only">{p.feature}</span>
                </td>
                {plans.map((plan) => (
                  <th key={plan} scope="col" className="p-4 text-start text-lg font-semibold">
                    {p[plan].name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {planRows.map((row) => (
                <tr key={row} className="border-t border-stone">
                  <th scope="row" className="p-4 text-start text-[0.9375rem] font-normal text-muted">
                    {p.labels[row]}
                  </th>
                  {plans.map((plan) => (
                    <td key={plan} className="p-4 text-[0.9375rem] font-semibold">
                      {p[plan].rows[row]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
