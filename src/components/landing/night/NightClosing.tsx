import { ArrowRight } from "@phosphor-icons/react/dist/ssr";
import type { Locale } from "@/domain/types";
import { CamelMark } from "@/components/brand/CamelMark";
import { defineMessages } from "@/i18n/types";
import { EntryActions } from "../EntryActionsServer";
import { EstatePhoto } from "../EstatePhoto";
import "./plans.css";

const copy = defineMessages({
  en: {
    title: "Sleep easy. NAQAH keeps watch.",
    body: "Set up your ranch in a few minutes, or look around the sample ranch first.",
  },
  ar: {
    title: "نم مرتاح، وناقة تتابع",
    body: "جهّز عزبتك في دقائق، أو تجوّل في العزبة التجريبية أول.",
  },
});

/** The close: the night gives way to a warm horizon over the desert, and the invitation rests on it. */
export function NightClosing({ locale }: { locale: Locale }) {
  const c = copy[locale];
  return (
    <section aria-labelledby="final-title" className="relative isolate overflow-hidden">
      <div className="absolute inset-0 -z-20">
        <EstatePhoto id="closing" locale={locale} sizes="100vw" ground="bg-[var(--night-2)]" fallbackTone="dark" className="h-full w-full" />
      </div>
      {/* Night above, dawn below: the top scrim keeps the words readable; the glow lightens the horizon. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[70%]"
        style={{ background: "linear-gradient(to bottom, #120d09 0%, rgba(18, 13, 9, 0.85) 35%, rgba(18, 13, 9, 0.35) 70%, rgba(18, 13, 9, 0) 100%)" }}
      />
      <div aria-hidden className="night-stars pointer-events-none absolute inset-x-0 top-0 -z-10 h-[45%] opacity-70" />
      <div aria-hidden className="dawn-glow -z-10" />

      <div className="night-frame flex min-h-[36rem] flex-col items-center justify-center py-24 text-center sm:min-h-[40rem] lg:min-h-[78svh] lg:py-32">
        <CamelMark className="h-12 w-auto text-[var(--moon)]" />
        <h2 id="final-title" className="night-display mt-7 max-w-[16ch] text-[clamp(2.25rem,5vw,4.5rem)]">
          {c.title}
        </h2>
        <p className="mt-5 max-w-[32rem] text-pretty text-lg leading-8 text-[var(--text-muted)] sm:text-xl sm:leading-9">{c.body}</p>
        <div className="mt-9 flex flex-col items-center gap-3 sm:flex-row sm:gap-x-7">
          <EntryActions
            primary={{ size: "lg", className: "night-cta min-w-[14rem]" }}
            arrow={<ArrowRight size={18} weight="bold" aria-hidden className="rtl:-scale-x-100" />}
            demoClassName="inline-flex min-h-11 items-center font-semibold text-[var(--text)] underline decoration-1 underline-offset-[6px] transition-colors hover:text-[var(--gold-bright)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current"
          />
        </div>
      </div>
    </section>
  );
}
