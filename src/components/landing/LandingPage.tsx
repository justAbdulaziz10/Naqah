import { AuthNavigation } from "@/components/auth/AuthNavigation";
import { ArrowUpRight } from "@phosphor-icons/react/dist/ssr";
import type { CSSProperties } from "react";
import type { Locale } from "@/domain/types";
import { CamelMark } from "@/components/brand/CamelMark";
import { Logo } from "@/components/brand/Logo";
import { ACCOUNT_DATA } from "@/components/entry/paths";
import { LocaleSwitcher } from "@/components/shell/LocaleSwitcher";
import { REPORT_CALL_RETRIES, RETRY_DELAY_MS } from "@/domain/clock";
import { formatTime } from "@/i18n/format";
import { getMessages } from "@/i18n/messages";
import { CallStory } from "./CallStory";
import { EstatePhoto } from "./EstatePhoto";
import { EntryActions } from "./EntryActionsServer";
import { EveningRail } from "./EveningRail";
import { MobileNavigation } from "./LandingActions";
import { MotionRoot } from "./MotionRoot";
import { PlanWeeks } from "./PlanWeeks";
import { LANDING_PHOTOS, type LandingPhotoId } from "./photos";
import "./landing.css";

/** The photographs this page shows, in order; only these are credited. */
const shown: LandingPhotoId[] = ["hero", "evening", "heritage", "closing"];

/** One pair of page margins, used by every section. */
const frame = "mx-auto w-full max-w-[1360px] px-5 sm:px-8 lg:px-12";
/** Arabic display type needs open leading and no negative tracking. */
const arabicDisplay = "[html[lang=ar]_&]:leading-[1.3] [html[lang=ar]_&]:tracking-normal";
const sectionTitle = `text-balance text-[clamp(2.125rem,4.2vw,4rem)] font-semibold leading-[1.08] tracking-[-0.025em] ${arabicDisplay}`;
const textLink =
  "inline-flex min-h-11 items-center font-semibold underline decoration-1 underline-offset-[6px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current";
const flat = "shadow-none!";

function Arrow({ size = 18 }: { size?: number }) {
  return <ArrowUpRight size={size} weight="regular" className="rtl:-scale-x-100" aria-hidden="true" />;
}

/** A missed report call on the product's time line: the call, its retries (rings), then the dashboard. Counts come from the rules. */
function RetryRail({ locale }: { locale: Locale }) {
  const { retry } = getMessages(locale).landing.principles;
  const minutes = RETRY_DELAY_MS / 60_000;
  const start = Date.parse("2026-01-01T17:40:00+03:00"); // The sample evening's call time.
  const tries = Array.from({ length: REPORT_CALL_RETRIES + 1 }, (_, index) => formatTime(new Date(start + index * RETRY_DELAY_MS), locale));
  return (
    <div role="img" aria-label={retry.label(REPORT_CALL_RETRIES, minutes)} className="mb-7 mt-4 flex max-w-sm items-center pe-2">
      {tries.map((time, index) => (
        <span key={time} className="flex flex-1 items-center">
          <span className={`relative flex flex-col ${index ? "items-center" : "items-start"}`}>
            <span aria-hidden className={`size-3 rounded-full border-2 ${index ? "border-sand bg-espresso" : "border-sand bg-sand"}`} />
            <span aria-hidden className={`absolute top-5 whitespace-nowrap ${index ? "" : "start-0"}`}>
              <span className="ltr-nums text-[0.8125rem] tabular-nums text-cream/70">{time}</span>
            </span>
          </span>
          <span aria-hidden className="h-0 flex-1 border-t-2 border-dashed border-sand/50" />
        </span>
      ))}
      <span aria-hidden className="relative flex flex-col items-end">
        <span className="size-3 rounded-full bg-gold" />
        <span className="absolute end-0 top-5 whitespace-nowrap text-[0.8125rem] font-semibold text-gold">{retry.flagged}</span>
      </span>
    </div>
  );
}

export function LandingPage({ locale }: { locale: Locale }) {
  const { common, landing } = getMessages(locale);
  const prefix = (path: string) => `/${locale}${path === "/" ? "" : path}`;
  const anchorLinks = [
    { href: "#call", label: landing.nav.how },
    { href: "#principles", label: landing.nav.principles },
    { href: "#plans", label: landing.nav.plans },
  ];
  const credits = shown.flatMap((id) => (LANDING_PHOTOS[id] ? [LANDING_PHOTOS[id].credit] : []));

  return (
    <div className="min-h-svh overflow-x-clip bg-ivory text-espresso">
      <MotionRoot />
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:start-4 focus:top-3 focus:z-[60] focus:inline-flex focus:min-h-11 focus:items-center focus:rounded-full focus:bg-espresso focus:px-5 focus:text-cream"
      >
        {landing.nav.skip}
      </a>

      <header className="sticky top-0 z-50 bg-ivory">
        <div className={`${frame} flex min-h-16 items-center justify-between gap-3`}>
          <Logo locale={locale} href={prefix("/")} className="min-h-11" />
          <div className="flex items-center gap-1 sm:gap-2">
            <nav aria-label={landing.nav.menuLabel} className="hidden items-center lg:flex">
              {anchorLinks.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  className="inline-flex min-h-11 items-center px-3.5 text-[0.9375rem] font-semibold text-muted transition-colors hover:text-espresso"
                >
                  {link.label}
                </a>
              ))}
              {/* Accounts are opt-in: without them there is nothing to sign in to, so no control waits here. */}
              {ACCOUNT_DATA ? <AuthNavigation signup={false} /> : null}
            </nav>
            <div className="hidden lg:block">
              <LocaleSwitcher className="min-h-11" />
            </div>
            <div className="ms-2 max-sm:hidden">
              <EntryActions primary={{ size: "md", className: flat }} />
            </div>
            <MobileNavigation
              links={anchorLinks}
              authControls={ACCOUNT_DATA ? <AuthNavigation appearance="mobile" signup={false} /> : null}
              menuLabel={landing.nav.menu}
              menuTitle={landing.nav.menuLabel}
            />
          </div>
        </div>
      </header>

      <main id="main" tabIndex={-1} className="outline-none">
        {/* Arrival: the title in the evening sky above the herd; the evening itself laid across the photograph's edge. */}
        <section aria-labelledby="landing-title">
          <div className="relative isolate h-[min(62svh,31rem)] sm:h-[38rem] lg:h-[calc(100svh-10rem)] lg:max-h-[52rem] lg:min-h-[34rem]">
            {/* 83vw on wide screens asks for the 1200px rendition at 1440: half the bytes of 1920 for an atmospheric photograph, and the first screen's largest paint. */}
            <div className="absolute inset-0 -z-10">
              <EstatePhoto id="hero" locale={locale} eager sizes="(min-width: 1024px) 83vw, (min-width: 640px) 100vw, 200vw" ground="bg-sand-soft" className="naqah-settle h-full w-full" />
            </div>
            <div className={`${frame} pt-8 sm:pt-14 lg:pt-[clamp(2.5rem,7vh,5rem)]`}>
              <h1
                id="landing-title"
                className={`naqah-arrive max-w-[12ch] text-balance text-[clamp(2.5rem,5.6vw,5rem)] font-semibold leading-[1.02] tracking-[-0.035em] text-espresso lg:max-w-none ${arabicDisplay}`}
              >
                {landing.hero.title}
              </h1>
              <div className="mt-6 flex-wrap items-center justify-between gap-x-12 gap-y-6 max-sm:hidden sm:flex lg:mt-8">
                <p className="naqah-arrive max-w-[34rem] text-xl leading-9 text-espresso" style={{ "--arrive-delay": "120ms" } as CSSProperties}>
                  {landing.hero.description}
                </p>
                <div className="naqah-arrive flex flex-wrap items-center gap-x-7 gap-y-2" style={{ "--arrive-delay": "220ms" } as CSSProperties}>
                  <EntryActions primary={{ size: "lg", className: flat }} arrow={<Arrow />} demoClassName={`${textLink} text-espresso hover:text-brown`} />
                </div>
              </div>
            </div>
          </div>

          {/* Phones: the photograph keeps the title; the line and the actions sit in thumb reach below it. */}
          <div className={`${frame} pt-7 sm:hidden`}>
            {/* Arabic wraps to three lines on narrow phones once its font arrives: hold that height so the actions don't move. */}
            <p className="text-lg leading-8 text-espresso max-[405px]:[html[lang=ar]_&]:min-h-24">{landing.hero.description}</p>
            <div className="mt-6 flex flex-col items-stretch gap-1">
              <EntryActions
                primary={{ size: "lg", className: `w-full ${flat}` }}
                arrow={<Arrow />}
                demoClassName={`${textLink} justify-center text-espresso hover:text-brown`}
              />
            </div>
          </div>

          <div className={`${frame} relative z-10 mt-8 sm:-mt-20 lg:-mt-24`}>
            <EveningRail locale={locale} className="naqah-arrive [--arrive-delay:320ms]" />
          </div>
        </section>

        {/* The evening as a scroll-led sequence, built from the product's own parts. */}
        <section id="call" aria-labelledby="call-title" className="scroll-mt-20 pb-20 pt-24 sm:pb-24 lg:pb-32 lg:pt-36">
          <div className={frame}>
            <h2 id="call-title" data-reveal="" className={`${sectionTitle} max-w-[16ch]`}>
              {landing.story.title}
            </h2>
            <p data-reveal="" data-reveal-delay="90" className="mt-5 max-w-[30rem] text-lg leading-8 text-espresso lg:text-xl lg:leading-9">
              {landing.story.line}
            </p>
            <div className="mt-14 lg:mt-6">
              <CallStory />
            </div>
          </div>
        </section>

        {/* What NAQAH holds to, beside the weave it comes from. */}
        <section id="principles" aria-labelledby="principles-title" className="scroll-mt-20 bg-espresso py-20 text-cream sm:py-24 lg:py-32">
          <div className={`${frame} grid gap-10 lg:grid-cols-12 lg:gap-x-10`}>
            <div className="lg:col-span-6 lg:col-start-7 lg:row-start-1">
              <h2 id="principles-title" data-reveal="" className={`${sectionTitle} max-w-[16ch]`}>
                {landing.principles.title}
              </h2>
              <p data-reveal="" data-reveal-delay="90" className="mt-5 max-w-[34rem] text-lg leading-8 text-cream/90 lg:text-xl lg:leading-9">
                {landing.principles.lead}
              </p>
            </div>
            <EstatePhoto
              id="heritage"
              locale={locale}
              sizes="(min-width: 1024px) 40vw, 100vw"
              revealDelay={0}
              ground="bg-brown-deep"
              className="aspect-[16/10] w-full lg:col-span-5 lg:row-span-2 lg:row-start-1 lg:aspect-auto lg:min-h-[34rem]"
            />
            <dl className="grid gap-x-10 gap-y-9 sm:grid-cols-2 lg:col-span-6 lg:col-start-7 lg:row-start-2 lg:self-end">
              {landing.principles.items.map((item, index) => (
                <div key={item.label} data-reveal="" data-reveal-delay={120 + index * 70}>
                  <dt className="text-xl font-semibold leading-snug">{item.label}</dt>
                  <dd className="mt-1.5 text-base leading-7 text-cream/85">
                    {item.value}
                    {index === 1 ? <RetryRail locale={locale} /> : null}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* Two rhythms, shown as the weeks they make. */}
        <section id="plans" aria-labelledby="plans-title" className="scroll-mt-20 py-20 sm:py-24 lg:py-32">
          <div className={frame}>
            <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-3">
              <h2 id="plans-title" data-reveal="" className={sectionTitle}>
                {landing.plans.title}
              </h2>
              <p data-reveal="" data-reveal-delay="60" className="text-lg text-muted">{landing.plans.pricing}</p>
            </div>
            <div className="mt-10 lg:mt-14">
              <PlanWeeks locale={locale} />
            </div>
          </div>
        </section>

        {/* The close: the desert at dusk, and the invitation lying on it. */}
        <section aria-labelledby="final-title" className="relative isolate overflow-hidden bg-espresso">
          <div className="absolute inset-0 -z-10">
            <EstatePhoto id="closing" locale={locale} sizes="100vw" ground="bg-espresso" className="h-full w-full" />
          </div>
          <div className={`${frame} flex min-h-[34rem] items-end justify-center pt-24 sm:justify-end lg:min-h-[80svh] lg:pt-32`}>
            <div
              data-reveal=""
              data-reveal-kind="slip"
              className="naqah-slip -mb-6 w-full bg-cream p-8 pb-14 text-center text-espresso [--tilt:-1.5deg] sm:max-w-[30rem] sm:p-12 sm:pb-16 lg:me-[6%] lg:pb-20"
            >
              <CamelMark className="mx-auto h-12 w-auto" />
              <h2 id="final-title" className={`mt-6 text-balance text-[clamp(2rem,3.2vw,3rem)] font-semibold leading-[1.12] ${arabicDisplay}`}>
                {landing.final.title}
              </h2>
              <p className="mt-3 text-lg leading-8">{landing.final.body}</p>
              <div className="mt-8 flex flex-col items-stretch gap-1">
                <EntryActions
                  primary={{ size: "lg", className: `w-full bg-espresso! hover:bg-brown! ${flat}` }}
                  arrow={<Arrow />}
                  demoClassName={`${textLink} justify-center text-espresso hover:text-brown`}
                />
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="relative bg-espresso text-sm text-cream/75">
        <div className={`${frame} flex flex-col gap-6 pb-10 pt-12 sm:flex-row sm:items-start sm:justify-between`}>
          <div className="max-w-3xl space-y-3 leading-6">
            <p>{common.footer.rights}</p>
            {credits.length ? (
              <div>
                <p>{landing.credits}</p>
                <ul className="mt-1 grid gap-0.5">
                  {credits.map((credit) => (
                    <li key={credit.sourceUrl}>
                      <bdi>
                        <a href={credit.sourceUrl} className="underline decoration-cream/40 underline-offset-4 hover:text-cream">
                          {credit.title}
                        </a>
                      </bdi>
                      {" · "}
                      {credit.creator}
                      {" · "}
                      <a href={credit.licenseUrl} className="underline decoration-cream/40 underline-offset-4 hover:text-cream">
                        {credit.license}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
          <LocaleSwitcher tone="light" className="min-h-11 w-fit shrink-0" />
        </div>
      </footer>
    </div>
  );
}
