import type { Locale } from "@/domain/types";
import { getMessages } from "@/i18n/messages";
import { cn } from "@/lib/cn";

/**
 * The hero's key visual: one sample evening on the product's time line. Filled dots have happened,
 * the ring is the call still to come. Stacked down the start edge on phones, across on wide screens.
 */
export function EveningRail({ locale, className }: { locale: Locale; className?: string }) {
  const { evening, example } = getMessages(locale).landing;
  const last = evening.steps.length - 1;

  return (
    <figure data-ui className={cn("border-t-2 border-gold bg-cream p-5 text-espresso sm:p-6 lg:px-8 lg:py-7", className)}>
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-[0.9375rem]">
        <span className="whitespace-nowrap text-[1.0625rem] font-semibold">{evening.label}</span>
        <span className="whitespace-nowrap text-muted">{example}</span>
      </figcaption>
      <div className="relative mt-5 lg:mt-6">
        {/* One line through every moment: solid to the saved report, then dashed to the call ahead. */}
        <span aria-hidden className="absolute inset-y-2 start-[5px] w-0.5 bg-brown lg:hidden" />
        <span aria-hidden className="naqah-evening-line absolute start-0 top-[5px] hidden h-0.5 w-[calc((100%_-_4rem)/3_+_2rem)] bg-brown lg:block" />
        <span
          aria-hidden
          className="absolute start-[calc((100%_-_4rem)/3_+_2rem)] top-[5px] hidden h-0 w-[calc((100%_-_4rem)/3_+_2rem)] border-t-2 border-dashed border-brown/50 lg:block"
        />
        <ol className="relative grid gap-5 lg:grid-cols-3 lg:gap-8">
        {evening.steps.map((step, index) => {
          const ahead = index === last;
          return (
            <li key={step.time} className="relative grid grid-cols-[0.75rem_1fr] gap-x-4 lg:block">
              <span
                aria-hidden
                className={cn(
                  "relative z-10 mt-1.5 block size-3 rounded-full lg:mt-0",
                  ahead ? "border-2 border-brown bg-cream" : "bg-brown",
                )}
              />
              <div className="lg:mt-4">
                <p className="text-[0.9375rem] text-muted">
                  <span className="ltr-nums tabular-nums">{step.time}</span>
                </p>
                <p className="mt-0.5 text-[1.0625rem] font-semibold leading-snug">{step.title}</p>
                <p className="text-[0.9375rem] leading-relaxed text-muted">{step.detail}</p>
              </div>
            </li>
          );
        })}
        </ol>
      </div>
    </figure>
  );
}
