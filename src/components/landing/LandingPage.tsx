import {
  ArrowUpRight,
  ChartLineUp,
  ChatCircleDots,
  CheckCircle,
  ClockCounterClockwise,
  GlobeHemisphereWest,
  MicrophoneSlash,
  PhoneCall,
  Question,
  Target,
  Ticket,
  Translate,
  WarningCircle,
} from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import type { Locale, Plan } from "@/domain/types";
import { CamelMark } from "@/components/brand/CamelMark";
import { Logo } from "@/components/brand/Logo";
import { LocaleSwitcher } from "@/components/shell/LocaleSwitcher";
import { ButtonLink } from "@/components/ui/Button";
import { getMessages } from "@/i18n/messages";
import { DemoAction, MobileNavigation, SpeechButton } from "./LandingActions";
import { LiveTranscript } from "./LiveTranscript";

const steps = [PhoneCall, ChatCircleDots, ChartLineUp];
const capabilityIcons = [Question, Target, Ticket, ClockCounterClockwise, Translate, MicrophoneSlash, PhoneCall, GlobeHemisphereWest];
const principleIcons = [CheckCircle, CheckCircle, MicrophoneSlash, WarningCircle];
const planRows = ["cadence", "questions", "calls", "tickets"] as const;

function DuneLines() {
  return (
    <svg viewBox="0 0 1440 180" preserveAspectRatio="none" className="pointer-events-none absolute inset-x-0 bottom-0 h-28 w-full text-gold/35 sm:h-40" aria-hidden="true">
      <path d="M0 142C185 102 260 92 422 118s240 45 416 11 337-73 602-19" fill="none" stroke="currentColor" strokeWidth="1" />
      <path d="M0 158c194-25 321-45 495-25s275 31 437-5 315-49 508-23" fill="none" stroke="currentColor" strokeOpacity=".55" strokeWidth="1" />
      <path d="M0 171c249-12 388-31 564-13s325 20 497-11 258-27 379-14" fill="none" stroke="currentColor" strokeOpacity=".35" strokeWidth="1" />
    </svg>
  );
}

function PlanCard({ locale, featured }: { locale: Locale; featured: boolean }) {
  const { common, landing } = getMessages(locale);
  const plan: Plan = featured ? "ultimate" : "basic";
  const copy = featured ? landing.plans.ultimate : landing.plans.basic;
  return (
    <article
      className={`relative flex h-full flex-col rounded-[1.5rem] border p-6 shadow-soft sm:p-8 ${
        featured ? "border-espresso bg-espresso text-cream shadow-lift" : "border-stone bg-cream text-espresso"
      }`}
    >
      {featured ? (
        <span className="mb-5 inline-flex min-h-8 w-fit items-center rounded-full bg-gold px-3.5 text-xs font-semibold text-espresso">
          {landing.plans.ultimate.featured}
        </span>
      ) : null}
      <h3 className="text-2xl font-semibold tracking-tight">{copy.name}</h3>
      <p className={`mt-2 min-h-12 max-w-sm text-sm leading-relaxed ${featured ? "text-cream/70" : "text-muted"}`}>
        {copy.summary}
      </p>

      <dl className={`mt-7 flex-1 divide-y ${featured ? "divide-cream/15" : "divide-stone/70"}`}>
        {planRows.map((row) => (
          <div key={row} className="grid gap-1.5 py-4 sm:grid-cols-[0.7fr_1fr] sm:gap-4">
            <dt className={`text-xs font-semibold ${featured ? "text-cream/60" : "text-muted"}`}>
              {landing.plans.rowLabels[row]}
            </dt>
            <dd className="flex items-start gap-2 text-sm leading-relaxed">
              <span className={`mt-[0.55rem] size-1.5 shrink-0 rounded-full ${featured ? "bg-gold" : "bg-sand"}`} aria-hidden="true" />
              <span>{copy.rows[row]}</span>
            </dd>
          </div>
        ))}
      </dl>

      <DemoAction
        plan={plan}
        size="md"
        variant={featured ? "gold" : "primary"}
        className="mt-7 min-h-11 w-full"
      >
        <span>{copy.cta}</span>
        <ArrowUpRight size={17} weight="regular" className="rtl:-scale-x-100" aria-hidden="true" />
      </DemoAction>
      <p className={`mt-3 text-center text-xs ${featured ? "text-cream/50" : "text-muted"}`}>
        {common.demo.badge}
      </p>
    </article>
  );
}

export function LandingPage({ locale }: { locale: Locale }) {
  const { common, landing } = getMessages(locale);
  const prefix = (path: string) => `/${locale}${path === "/" ? "" : path}`;
  const anchorLinks = [
    { href: "#how-it-works", label: landing.nav.how },
    { href: "#plans", label: landing.nav.plans },
    { href: "#principles", label: landing.nav.principles },
  ];

  return (
    <div className="min-h-screen overflow-x-clip bg-ivory text-espresso">
      <header className="sticky top-0 z-50 border-b border-stone/70 bg-ivory/95 backdrop-blur-md">
        <div className="mx-auto flex min-h-16 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
          <Logo locale={locale} href={prefix("/")} className="min-h-11" />

          <nav aria-label={landing.nav.menuLabel} className="hidden items-center gap-1 lg:flex">
            {anchorLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="inline-flex min-h-11 items-center rounded-full px-3.5 text-sm font-semibold text-muted transition hover:bg-espresso/5 hover:text-espresso"
              >
                {link.label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-1.5 sm:gap-2">
            <div className="hidden lg:block">
              <LocaleSwitcher className="min-h-11" />
            </div>
            <DemoAction size="md" className="min-h-11 max-sm:px-3.5 max-sm:text-xs">
              <span className="hidden sm:inline">{common.actions.startDemo}</span>
              <span className="sm:hidden">{landing.nav.demoShort}</span>
            </DemoAction>
            <MobileNavigation
              links={anchorLinks}
              menuLabel={landing.nav.menu}
              menuTitle={landing.nav.menuLabel}
            />
          </div>
        </div>
      </header>

      <main>
        <section className="relative isolate overflow-hidden border-b border-stone/70" aria-labelledby="landing-title">
          <CamelMark className="pointer-events-none absolute -end-24 top-12 z-[-1] h-[30rem] w-auto text-gold/[0.075] sm:-end-16 sm:top-0 sm:h-[38rem]" />
          <DuneLines />
          <div className="relative mx-auto grid max-w-7xl items-center gap-12 px-4 pb-24 pt-14 sm:px-6 sm:pb-32 sm:pt-20 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16 lg:px-8 lg:py-24">
            <div className="relative z-10 max-w-2xl">
              <p className="inline-flex min-h-8 items-center rounded-full border border-stone bg-cream/75 px-3.5 text-xs font-semibold text-muted">
                {common.demo.badge}
              </p>
              <h1 id="landing-title" className="mt-5 max-w-[13ch] text-4xl font-semibold leading-[1.18] tracking-[-0.035em] sm:text-5xl lg:text-6xl">
                {landing.hero.title}
              </h1>
              <p className="mt-5 max-w-xl text-base leading-8 text-muted sm:text-lg sm:leading-9">
                {landing.hero.description}
              </p>
              <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                <DemoAction size="lg" className="min-h-11 w-full sm:w-auto">
                  <span>{common.actions.startDemo}</span>
                  <ArrowUpRight size={18} weight="regular" className="rtl:-scale-x-100" aria-hidden="true" />
                </DemoAction>
                <ButtonLink href={prefix("/start")} variant="secondary" size="lg" className="min-h-11 w-full sm:w-auto">
                  <span>{common.actions.setUp}</span>
                </ButtonLink>
              </div>
              <p className="mt-5 text-sm font-medium text-muted">{landing.hero.builtFor}</p>
            </div>

            <div className="relative z-10 mx-auto w-full max-w-2xl">
              <div className="rounded-[1.6rem] border border-stone bg-cream p-3 shadow-lift sm:rounded-[2rem] sm:p-4">
                <LiveTranscript />
                <div className="grid gap-3 px-2 pb-1 pt-5 sm:grid-cols-[0.65fr_1fr] sm:px-3">
                  <div>
                    <p className="text-sm font-semibold text-espresso">{landing.hero.factsTitle}</p>
                    <p className="mt-1 text-xs leading-relaxed text-muted">{landing.hero.facts.note}</p>
                  </div>
                  <div className="grid gap-2">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-xl border border-stone/80 bg-ivory/70 px-3.5 py-3">
                      <span className="text-xs font-semibold text-muted">{landing.hero.facts.feedLabel}</span>
                      <span className="text-sm font-semibold text-espresso">{landing.hero.facts.feedValue}</span>
                    </div>
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-xl border border-stone/80 bg-ivory/70 px-3.5 py-3">
                      <span className="text-xs font-semibold text-muted">{landing.hero.facts.camelLabel}</span>
                      <span className="text-sm font-semibold text-espresso">{landing.hero.facts.camelValue}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="how-it-works" className="scroll-mt-24 bg-cream py-20 sm:py-24" aria-labelledby="how-title">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="max-w-2xl">
              <h2 id="how-title" className="text-3xl font-semibold tracking-tight sm:text-4xl">{landing.how.title}</h2>
              <p className="mt-4 text-base leading-7 text-muted">{landing.how.description}</p>
            </div>
            <ol className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-3 lg:gap-10">
              {landing.how.steps.map((step, index) => {
                const Icon = steps[index];
                return (
                  <li key={step.title} className="border-t border-sand pt-6 sm:pt-7">
                    <div className="flex items-center gap-3">
                      <span className="ltr-nums text-sm font-semibold text-gold">{step.number}</span>
                      <Icon size={21} weight="regular" className="text-brown" aria-hidden="true" />
                    </div>
                    <h3 className="mt-5 text-xl font-semibold">{step.title}</h3>
                    <p className="mt-2 max-w-sm text-sm leading-7 text-muted">{step.body}</p>
                  </li>
                );
              })}
            </ol>
          </div>
        </section>

        <section className="bg-espresso py-20 text-cream sm:py-24" aria-labelledby="owner-call-title">
          <div className="mx-auto grid max-w-7xl gap-10 px-4 sm:px-6 lg:grid-cols-[0.75fr_1.25fr] lg:gap-16 lg:px-8">
            <div className="max-w-lg">
              <h2 id="owner-call-title" className="text-3xl font-semibold tracking-tight sm:text-4xl">{landing.ownerCall.title}</h2>
              <p className="mt-4 text-base leading-7 text-cream/70">{landing.ownerCall.description}</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <article className="flex flex-col rounded-[1.25rem] border border-cream/15 bg-cream/[0.04] p-5 sm:p-6">
                <p className="text-xs font-semibold text-gold">{landing.ownerCall.findingLabel}</p>
                <blockquote className="mt-4 flex-1 text-lg leading-8 text-cream sm:text-xl sm:leading-9">
                  {landing.ownerCall.openQuote}{landing.ownerCall.findingQuote}{landing.ownerCall.closeQuote}
                </blockquote>
                <div className="mt-5">
                  <SpeechButton text={landing.ownerCall.findingQuote} />
                </div>
              </article>
              <article className="flex flex-col rounded-[1.25rem] border border-cream/15 bg-cream/[0.04] p-5 sm:p-6">
                <p className="text-xs font-semibold text-cream/60">{landing.ownerCall.quietLabel}</p>
                <blockquote className="mt-4 flex-1 text-base leading-8 text-cream/90 sm:text-lg sm:leading-9">
                  {landing.ownerCall.openQuote}{landing.ownerCall.quietQuote}{landing.ownerCall.closeQuote}
                </blockquote>
              </article>
            </div>
          </div>
        </section>

        <section className="bg-ivory py-20 sm:py-24" aria-labelledby="capabilities-title">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="max-w-2xl">
              <h2 id="capabilities-title" className="text-3xl font-semibold tracking-tight sm:text-4xl">{landing.capabilities.title}</h2>
              <p className="mt-4 text-base leading-7 text-muted">{landing.capabilities.description}</p>
            </div>
            <div className="mt-11 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {landing.capabilities.items.map((item, index) => {
                const Icon = capabilityIcons[index];
                return (
                  <article key={item.title} className="rounded-[1.25rem] border border-stone/80 bg-cream p-5 sm:p-6">
                    <span className="inline-flex size-10 items-center justify-center rounded-xl bg-gold-soft text-brown">
                      <Icon size={21} weight="regular" aria-hidden="true" />
                    </span>
                    <h3 className="mt-4 text-base font-semibold leading-6">{item.title}</h3>
                    <p className="mt-2 text-sm leading-6 text-muted">{item.body}</p>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section id="plans" className="scroll-mt-24 bg-cream py-20 sm:py-24" aria-labelledby="plans-title">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="mx-auto max-w-2xl text-center">
              <h2 id="plans-title" className="text-3xl font-semibold tracking-tight sm:text-4xl">{landing.plans.title}</h2>
              <p className="mt-4 text-base leading-7 text-muted">{landing.plans.description}</p>
            </div>
            <div className="mx-auto mt-11 grid max-w-5xl items-stretch gap-4 lg:grid-cols-2 lg:gap-6">
              <PlanCard locale={locale} featured={false} />
              <PlanCard locale={locale} featured />
            </div>
            <p className="mx-auto mt-6 max-w-2xl text-center text-sm leading-6 text-muted">{landing.plans.pricing}</p>
          </div>
        </section>

        <section id="principles" className="scroll-mt-24 bg-ivory py-20 sm:py-24" aria-labelledby="principles-title">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="max-w-2xl">
              <h2 id="principles-title" className="text-3xl font-semibold tracking-tight sm:text-4xl">{landing.principles.title}</h2>
              <p className="mt-4 text-base leading-7 text-muted">{landing.principles.description}</p>
            </div>
            <div className="mt-10 grid gap-x-10 divide-y divide-stone border-y border-stone sm:grid-cols-2 sm:divide-y-0">
              {landing.principles.items.map((item, index) => {
                const Icon = principleIcons[index];
                return (
                  <article key={item.title} className="flex gap-4 py-6 sm:px-6 sm:py-7 first:sm:ps-0 last:sm:pe-0">
                    <Icon size={22} weight="regular" className="mt-0.5 shrink-0 text-brown" aria-hidden="true" />
                    <div>
                      <h3 className="font-semibold">{item.title}</h3>
                      <p className="mt-1.5 max-w-md text-sm leading-6 text-muted">{item.body}</p>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section className="relative isolate overflow-hidden bg-espresso py-16 text-cream sm:py-20" aria-labelledby="final-title">
          <CamelMark className="pointer-events-none absolute -end-12 top-1/2 z-[-1] h-72 w-auto -translate-y-1/2 text-gold/20 sm:end-12 sm:h-80" />
          <div className="relative mx-auto flex max-w-7xl flex-col items-start gap-7 px-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
            <div className="max-w-2xl">
              <h2 id="final-title" className="text-3xl font-semibold tracking-tight sm:text-4xl">{landing.final.title}</h2>
              <p className="mt-3 max-w-xl text-base leading-7 text-cream/70">{landing.final.body}</p>
            </div>
            <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
              <DemoAction variant="gold" size="lg" className="min-h-11 w-full sm:w-auto">
                <span>{common.actions.startDemo}</span>
                <ArrowUpRight size={18} weight="regular" className="rtl:-scale-x-100" aria-hidden="true" />
              </DemoAction>
              <Link
                href={prefix("/start")}
                className="inline-flex min-h-11 items-center justify-center rounded-full border border-cream/25 px-6 text-sm font-semibold text-cream transition hover:bg-cream/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
              >
                {common.actions.setUp}
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="bg-espresso px-4 pb-8 text-cream sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-7xl flex-col gap-5 border-t border-cream/15 pt-7 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-xl">
            <Logo locale={locale} tone="light" href={prefix("/")} className="min-h-11" />
            <p className="mt-3 text-xs leading-6 text-cream/60">{common.footer.noRecordings}</p>
            <p className="mt-1 text-xs leading-6 text-cream/60">{common.footer.rights}</p>
          </div>
          <LocaleSwitcher tone="light" className="min-h-11 w-fit" />
        </div>
      </footer>
    </div>
  );
}
