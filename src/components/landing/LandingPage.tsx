import { ArrowUpRight } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import type { CSSProperties } from "react";
import type { Locale } from "@/domain/types";
import { CamelMark } from "@/components/brand/CamelMark";
import { Logo } from "@/components/brand/Logo";
import { WovenSignature } from "@/components/heritage/Woven";
import { LocaleSwitcher } from "@/components/shell/LocaleSwitcher";
import { buttonClass } from "@/components/ui/Button";
import { SetupLink } from "@/components/welcome/WelcomeActions";
import { getMessages } from "@/i18n/messages";
import { CallSlips } from "./CallSlips";
import { EstatePhoto } from "./EstatePhoto";
import { DemoAction, MobileNavigation } from "./LandingActions";
import { MotionRoot } from "./MotionRoot";
import { LANDING_PHOTOS } from "./photos";
import { WovenIntro } from "./WovenIntro";
import "./landing.css";

const planRows = ["cadence", "questions", "calls", "tickets"] as const;
const plans = ["basic", "ultimate"] as const;

/** One pair of page margins, used by every section. */
const frame = "mx-auto w-full max-w-[1520px] px-5 sm:px-8 lg:px-12";
/** Display type runs light; Arabic needs open leading and no tracking for its marks and joins. */
const display = "font-light tracking-[-0.03em] [html[lang=ar]_&]:leading-[1.35] [html[lang=ar]_&]:tracking-normal";
const sectionTitle = `text-balance text-[clamp(2.25rem,4.4vw,4.5rem)] leading-[1.1] ${display}`;
const navLink =
  "inline-flex min-h-11 items-center px-3 text-[0.9375rem] font-medium text-cream transition-opacity hover:opacity-70";
const quietAction = "text-cream! underline decoration-1 underline-offset-[6px] hover:bg-cream/10!";
const flat = "shadow-none!";

function Arrow({ size = 18 }: { size?: number }) {
  return <ArrowUpRight size={size} weight="regular" className="rtl:-scale-x-100" aria-hidden="true" />;
}

export function LandingPage({ locale }: { locale: Locale }) {
  const { common, landing, auth } = getMessages(locale);
  const prefix = (path: string) => `/${locale}${path === "/" ? "" : path}`;
  const authNext = `?next=${encodeURIComponent(prefix("/app"))}`;
  const signupNext = `?next=${encodeURIComponent(prefix("/start"))}`;
  const anchorLinks = [
    { href: "#call", label: landing.nav.how },
    { href: "#plans", label: landing.nav.plans },
  ];
  const accountLinks = [
    { href: prefix("/login") + authNext, label: landing.nav.signIn },
    { href: prefix("/signup") + signupNext, label: auth.navSignup },
  ];
  const credits = Object.values(LANDING_PHOTOS).flatMap((photo) => (photo ? [photo.credit] : []));

  return (
    <div className="min-h-svh overflow-x-clip bg-espresso text-espresso">
      <WovenIntro />
      <MotionRoot />
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:start-4 focus:top-3 focus:z-[60] focus:inline-flex focus:min-h-11 focus:items-center focus:rounded-full focus:bg-espresso focus:px-5 focus:text-cream"
      >
        {landing.nav.skip}
      </a>

      <header className="naqah-bar fixed inset-x-0 top-0 z-50 text-cream">
        <div className={`${frame} flex min-h-[4.5rem] items-center justify-between gap-3`}>
          <Logo locale={locale} tone="light" href={prefix("/")} className="min-h-11" />
          <div className="flex items-center gap-1 sm:gap-2">
            <nav aria-label={landing.nav.menuLabel} className="hidden items-center lg:flex">
              {[...anchorLinks, ...accountLinks].map((link) => (
                <Link key={link.href} href={link.href} className={navLink}>
                  {link.label}
                </Link>
              ))}
            </nav>
            <div className="hidden lg:block">
              <LocaleSwitcher tone="light" className="min-h-11" />
            </div>
            <SetupLink className={buttonClass({ variant: "gold", size: "md", className: `naqah-bar-action ms-2 max-sm:hidden ${flat}` })}>{landing.setUp}</SetupLink>
            <MobileNavigation links={[...anchorLinks, ...accountLinks]} menuLabel={landing.nav.menu} menuTitle={landing.nav.menuLabel} />
          </div>
        </div>
      </header>

      <main id="main" tabIndex={-1} className="outline-none">
        {/* The opening frame: the title sits in the sky, the action on the sand, the herd walks between. */}
        <section id="hero" aria-labelledby="landing-title" className="relative isolate flex min-h-svh flex-col justify-between overflow-hidden bg-espresso">
          <div className="absolute inset-x-0 top-0 -z-10 h-[max(60svh,24rem)] sm:h-full" data-parallax="">
            <EstatePhoto id="hero" locale={locale} eager sizes="(min-width: 1024px) 100vw, 220vw" ground="bg-sand" className="naqah-settle h-[calc(100%+6rem)] w-full" />
          </div>
          <div aria-hidden="true" className={"absolute inset-x-0 bottom-0 -z-10 hidden h-[26%] bg-linear-to-t from-black/55 to-transparent sm:block" /* taste-skill-ignore: neutral scrim under the action on the sand */} />

          <div className={`${frame} pt-24 sm:pt-28 lg:pt-32`}>
            <h1
              id="landing-title"
              className={`naqah-rise text-balance text-[clamp(2.75rem,6.8vw,7.5rem)] leading-[1.04] text-espresso ${display} [html[lang=ar]_&]:text-[clamp(2.75rem,7.4vw,8rem)]`}
            >
              {landing.hero.title}
            </h1>
          </div>

          <div
            className={`${frame} naqah-rise flex flex-col gap-5 pb-6 text-cream sm:pb-10 lg:flex-row lg:items-center lg:justify-between lg:gap-12 lg:pb-12`}
            style={{ "--rise-delay": "180ms" } as CSSProperties}
          >
            <p className="max-w-[35rem] text-lg leading-8 sm:text-xl sm:leading-9">{landing.hero.line}</p>
            <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1">
              <SetupLink className={buttonClass({ variant: "gold", size: "lg", className: `max-sm:w-full ${flat}` })}>
                {landing.setUp}
                <Arrow />
              </SetupLink>
              <DemoAction variant="ghost" size="lg" className={`max-sm:w-full ${quietAction}`}>
                {common.actions.startDemo}
              </DemoAction>
            </div>
          </div>
        </section>

        {/* The evening call, told by what it produces: three slips standing along the fold. */}
        <section id="call" aria-labelledby="call-title" className="relative isolate scroll-mt-16 overflow-hidden bg-espresso">
          <div className="absolute inset-x-0 top-0 -z-10 h-[70svh] lg:h-full">
            <EstatePhoto id="evening" locale={locale} sizes="100vw" ground="bg-brown-deep" className="h-full w-full" />
          </div>
                    <div className={`${frame} flex min-h-[96svh] flex-col justify-between gap-16 pb-6 pt-24 sm:pt-28 lg:gap-14 lg:pb-0`}>
            <div>
              <h2 id="call-title" data-reveal="" className={`${sectionTitle} max-w-[17ch]`}>
                {landing.story.title}
              </h2>
              <p data-reveal="" data-reveal-delay="90" className="mt-5 text-xl leading-9">
                {landing.story.line}
              </p>
            </div>
            <CallSlips locale={locale} />
          </div>
        </section>

        {/* The heritage it comes from: the weave opens across the page, the promises follow. */}
        <section aria-labelledby="heritage-title" className="bg-ivory">
          <div data-reveal="" data-reveal-kind="warp" className="relative">
            <EstatePhoto id="heritage" locale={locale} sizes="100vw" className="h-[46svh] w-full lg:h-[78svh]" />
            <div aria-hidden="true" className="naqah-warp">
              {Array.from({ length: 12 }, (_, index) => (
                <span key={index} style={{ "--i": Math.abs(index - 5.5) } as CSSProperties} />
              ))}
            </div>
          </div>
          <WovenSignature />
          <div className={`${frame} grid gap-10 py-20 sm:py-24 lg:grid-cols-12 lg:gap-x-10 lg:py-32`}>
            <h2 id="heritage-title" data-reveal="" className={`${sectionTitle} lg:col-span-7`}>
              {landing.heritage.title}
            </h2>
            <dl className="grid content-end gap-8 lg:col-span-4 lg:col-start-9">
              {landing.heritage.items.map((item, index) => (
                <div key={item.label} data-reveal="" data-reveal-delay={90 + index * 90}>
                  <dt className="text-2xl font-medium leading-snug">{item.label}</dt>
                  <dd className="mt-1 text-lg leading-8">{item.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* Two plans, set the way a menu sets its prices. */}
        <section id="plans" aria-labelledby="plans-title" className="scroll-mt-16 bg-cream py-20 sm:py-24 lg:py-32">
          <div className={`${frame} grid gap-12 lg:grid-cols-12 lg:gap-x-10`}>
            <div className="grid gap-x-10 sm:grid-cols-2 lg:col-span-4 lg:grid-cols-1">
              <div>
                <h2 id="plans-title" data-reveal="" className={sectionTitle}>
                  {landing.plans.title}
                </h2>
                <p data-reveal="" data-reveal-delay="60" className="mt-4 text-lg leading-8">
                  {landing.plans.pricing}
                </p>
              </div>
              <EstatePhoto
                id="herd"
                locale={locale}
                sizes="(min-width: 1024px) 28vw, (min-width: 640px) 45vw, 100vw"
                revealDelay={120}
                className="naqah-photo-hover mt-10 aspect-[4/3] w-full sm:mt-0 lg:mt-10 lg:aspect-[4/5] lg:w-4/5"
              />
            </div>

            <div className="grid gap-14 sm:grid-cols-2 sm:gap-10 lg:col-span-7 lg:col-start-6 lg:gap-16">
              {plans.map((plan, planIndex) => {
                const copy = landing.plans[plan];
                return (
                  <section key={plan} aria-labelledby={`plan-${plan}`} data-reveal="" data-reveal-delay={planIndex * 110} className="flex flex-col">
                    <h3 id={`plan-${plan}`} className={`text-[clamp(2.25rem,3.4vw,3.25rem)] leading-tight ${display}`}>
                      {copy.name}
                    </h3>
                    <p className="mt-3 text-lg leading-8">{copy.summary}</p>
                    <dl className="mt-10 grid gap-6">
                      {planRows.map((row) => (
                        <div key={row}>
                          <dt className="text-base text-muted">{landing.plans.labels[row]}</dt>
                          <dd className="text-xl font-medium">{copy.rows[row]}</dd>
                        </div>
                      ))}
                    </dl>
                    <DemoAction plan={plan} variant="secondary" size="lg" className={`mt-10 w-full border-transparent! bg-sand-soft! hover:bg-sand! ${flat}`}>
                      {copy.cta}
                    </DemoAction>
                  </section>
                );
              })}
            </div>
          </div>
        </section>

        {/* The close: the same dusk, and the invitation lying on it. */}
        <section aria-labelledby="final-title" className="relative isolate overflow-hidden bg-espresso">
          <div className="absolute inset-0 -z-10">
            <EstatePhoto id="closing" locale={locale} sizes="100vw" ground="bg-espresso" className="h-full w-full" />
          </div>
          <div className={`${frame} flex min-h-[86svh] items-end justify-end pt-28 lg:pt-40`}>
            <div data-reveal="" data-reveal-kind="slip" className="naqah-slip w-full bg-cream p-8 pb-12 text-center text-espresso [--tilt:-1.6deg] sm:max-w-[32rem] sm:p-12 sm:pb-16 lg:-mb-6 lg:pb-24">
              <CamelMark className="mx-auto h-12 w-auto" />
              <h2 id="final-title" className={`mt-6 text-balance text-[clamp(2.25rem,3.4vw,3.25rem)] leading-[1.15] ${display}`}>
                {landing.final.title}
              </h2>
              <p className="mt-3 text-lg leading-8">{landing.final.line}</p>
              <SetupLink className={buttonClass({ variant: "primary", size: "lg", className: `mt-8 h-14! w-full bg-espresso! hover:bg-brown! ${flat}` })}>
                {landing.setUp}
                <Arrow />
              </SetupLink>
              <DemoAction variant="ghost" className="mt-2 underline decoration-1 underline-offset-[6px]">
                {common.actions.startDemo}
              </DemoAction>
            </div>
          </div>
        </section>
      </main>

      <footer className="bg-espresso text-sm text-cream/75">
        <div className={`${frame} flex flex-col gap-6 pb-10 pt-8 sm:flex-row sm:items-start sm:justify-between`}>
          <div className="max-w-3xl space-y-3 leading-6">
            <p>{common.footer.rights}</p>
            {credits.length ? (
              <div>
                <p>{landing.credits}</p>
                <ul className="mt-1">
                  {credits.map((credit) => (
                    <li key={credit.sourceUrl} dir="auto">
                      <a href={credit.sourceUrl} className="underline decoration-cream/40 underline-offset-4 hover:text-cream">
                        {credit.title}
                      </a>
                      {", "}
                      {credit.creator}
                      {", "}
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
