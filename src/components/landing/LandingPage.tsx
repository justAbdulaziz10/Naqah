import { ArrowUpRight } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import type { Locale } from "@/domain/types";
import { CamelMark } from "@/components/brand/CamelMark";
import { Logo } from "@/components/brand/Logo";
import { WovenFragment, WovenFrame, WovenSignature } from "@/components/heritage/Woven";
import { LocaleSwitcher } from "@/components/shell/LocaleSwitcher";
import { SetupLink } from "@/components/welcome/WelcomeActions";
import { getMessages } from "@/i18n/messages";
import { CamelColours } from "./CamelColours";
import { EstatePhoto } from "./EstatePhoto";
import { JourneyScene } from "./JourneyScene";
import { DemoAction, MobileNavigation, OwnerCall } from "./LandingActions";
import { LiveTranscript } from "./LiveTranscript";
import { MotionRoot } from "./MotionRoot";
import { LANDING_PHOTOS } from "./photos";
import { WovenIntro } from "./WovenIntro";

const planRows = ["cadence", "questions", "update", "calls", "tickets"] as const;
const plans = ["basic", "ultimate"] as const;

/** One pair of page margins, used by every section. */
const frame = "mx-auto w-full max-w-[1360px] px-5 sm:px-8 lg:px-12";
/** Arabic display type needs open leading and no negative tracking. */
const arabicDisplay = "[html[lang=ar]_&]:leading-[1.25] [html[lang=ar]_&]:tracking-normal";
const sectionTitle = `text-balance text-[clamp(2.25rem,4vw,4rem)] font-semibold leading-[1.08] tracking-[-0.025em] ${arabicDisplay}`;
const textLink =
  "inline-flex min-h-11 items-center font-semibold underline decoration-1 underline-offset-[6px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current";
const flat = "shadow-none!";

function Arrow({ size = 18 }: { size?: number }) {
  return <ArrowUpRight size={size} weight="regular" className="rtl:-scale-x-100" aria-hidden="true" />;
}

/** A stage of the evening call: a bold run-in carries the order, no numbering. */
function Stage({ lead, body, className, delay = 0 }: { lead: string; body: string; className?: string; delay?: number }) {
  return (
    <p data-reveal="" data-reveal-delay={delay} className={`max-w-[36ch] text-[1.0625rem] leading-[1.7] text-espresso ${className ?? ""}`}>
      <strong className="font-semibold">{lead}</strong> {body}
    </p>
  );
}

export function LandingPage({ locale }: { locale: Locale }) {
  const { common, landing, auth } = getMessages(locale);
  const prefix = (path: string) => `/${locale}${path === "/" ? "" : path}`;
  const authNext = `?next=${encodeURIComponent(prefix('/app'))}`;
  const anchorLinks = [
    { href: "#call", label: landing.nav.how },
    { href: "#principles", label: landing.nav.principles },
    { href: "#colours", label: landing.nav.colours },
    { href: "#plans", label: landing.nav.plans },
  ];
  const [arrive, ask, callBack] = landing.story.stages;
  const credits = Object.values(LANDING_PHOTOS).flatMap((photo) => (photo ? [photo.credit] : []));

  return (
    <div className="min-h-svh overflow-x-clip bg-ivory text-espresso">
      <WovenIntro skipLabel={landing.intro.skip} />
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
              <Link
                href={prefix("/login") + authNext}
                className="inline-flex min-h-11 items-center px-3.5 text-[0.9375rem] font-semibold text-muted transition-colors hover:text-espresso"
              >
                {landing.nav.signIn}
              </Link>
              <Link href={prefix('/signup') + authNext} className="inline-flex min-h-11 items-center px-3.5 text-[0.9375rem] font-semibold text-muted transition-colors hover:text-espresso">
                {auth.navSignup}
              </Link>
            </nav>
            <div className="hidden lg:block">
              <LocaleSwitcher className="min-h-11" />
            </div>
            <DemoAction size="md" className={`ms-2 max-sm:hidden ${flat}`}>
              {common.actions.startDemo}
            </DemoAction>
            <MobileNavigation links={[...anchorLinks, { href: prefix("/login") + authNext, label: landing.nav.signIn }, { href: prefix('/signup') + authNext, label: auth.navSignup }]} menuLabel={landing.nav.menu} menuTitle={landing.nav.menuLabel} />
          </div>
        </div>
      </header>

      <main id="main" tabIndex={-1} className="outline-none">
        {/* Arrival: the estate at full width, the promise along its lower edge. */}
        <section aria-labelledby="landing-title" className="relative">
          <EstatePhoto
            id="hero"
            locale={locale}
            eager
            sizes="(min-width: 1024px) 100vw, 135vw"
            className="naqah-settle h-[40svh] min-h-[240px] w-full sm:h-[60svh] lg:h-[calc(100svh-4rem)] lg:max-h-[1000px] lg:min-h-[640px]"
          />
          <div
            aria-hidden="true"
            className={"pointer-events-none absolute inset-x-0 bottom-0 hidden h-[72%] bg-linear-to-t from-espresso/90 via-espresso/55 to-transparent lg:block" /* taste-skill-ignore: neutral scrim under text on the photograph */}
          />
          <div className="lg:absolute lg:inset-x-0 lg:bottom-0">
            <div className={`${frame} pb-16 pt-10 lg:pb-16 lg:pt-0`}>
              <h1
                id="landing-title"
                className={`max-w-[18ch] text-balance text-[clamp(2.6rem,7vw,6.5rem)] font-semibold leading-[1.02] tracking-[-0.035em] text-espresso lg:text-cream ${arabicDisplay}`}
              >
                {landing.hero.title}
              </h1>
              <div className="mt-6 flex flex-col gap-8 lg:mt-8">
                <p className="max-w-[36rem] text-lg leading-8 text-espresso sm:text-xl sm:leading-9 lg:text-cream/90">
                  {landing.hero.description}
                </p>
                <div className="flex shrink-0 flex-wrap items-center gap-x-8 gap-y-4">
                  <DemoAction size="lg" className={`lg:hidden ${flat}`}>
                    {common.actions.startDemo}
                    <Arrow />
                  </DemoAction>
                  <DemoAction size="lg" variant="gold" className={`max-lg:hidden ${flat}`}>
                    {common.actions.startDemo}
                    <Arrow />
                  </DemoAction>
                  <SetupLink className={`${textLink} text-espresso hover:text-brown lg:text-cream lg:hover:text-gold`}>
                    {common.actions.setUp}
                  </SetupLink>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* The journey: an independent camel artwork walks the ridge as the page scrolls (handoff §03). */}
        <section aria-labelledby="journey-title">
          <div className={`${frame} relative z-10 grid gap-6 pt-20 sm:pt-24 lg:grid-cols-12 lg:items-end lg:gap-x-10 lg:pt-28`}>
            <h2 id="journey-title" data-reveal="" className={`${sectionTitle} lg:col-span-6`}>
              {landing.journey.title}
            </h2>
            <p data-reveal="" data-reveal-delay="90" className="max-w-[34rem] text-xl leading-9 text-espresso lg:col-span-5 lg:col-start-8">
              {landing.journey.body}
            </p>
          </div>
          <JourneyScene />
        </section>

        <div data-weave="">
          <WovenSignature />
        </div>

        {/* The evening call, down a diagonal: the worker calls, NAQAH asks and saves, NAQAH calls you. */}
        <section id="call" aria-labelledby="call-title" className="scroll-mt-20 py-20 sm:py-24 lg:py-28">
          <div className={`${frame} grid gap-y-10 lg:grid-cols-12 lg:gap-x-10 lg:gap-y-8`}>
            <EstatePhoto
              id="evening"
              locale={locale}
              sizes="(min-width: 1024px) 38vw, 100vw"
              revealDelay={0}
              className="aspect-[4/3] w-full lg:col-span-5 lg:row-span-2 lg:self-start"
            />
            <h2 id="call-title" data-reveal="" className={`${sectionTitle} max-lg:order-first lg:col-span-6 lg:col-start-7 lg:row-start-1`}>
              {landing.story.title}
            </h2>
            <Stage {...arrive} delay={90} className="lg:col-span-5 lg:col-start-7 lg:row-start-2 lg:self-start" />

            <div data-ui data-reveal="" className="bg-cream p-5 sm:p-8 lg:col-span-6 lg:col-start-2 lg:mt-12">
              <LiveTranscript />
            </div>
            <Stage {...ask} delay={120} className="lg:col-span-4 lg:col-start-9 lg:mt-12 lg:self-center" />

            <Stage {...callBack} className="max-lg:order-last lg:col-span-4 lg:col-start-1 lg:mt-12 lg:self-center" />
            <div data-reveal="" data-reveal-delay="120" className="relative self-start bg-espresso text-cream lg:col-span-7 lg:col-start-6 lg:mt-12">
              {/* Pinned to the edge: an SVG strip with h-full would otherwise size the panel from its viewBox. */}
              <WovenFrame tone="dark" className="absolute inset-y-0 start-0" />
              <div className="min-w-0 p-7 ps-10 sm:p-10 sm:ps-14">
                <h3 className="text-xl font-semibold sm:text-2xl">{landing.owner.title}</h3>
                <div data-ui className="mt-6">
                  <OwnerCall />
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* What NAQAH holds to, beside the heritage it comes from. */}
        <section id="principles" aria-labelledby="principles-title" className="scroll-mt-20 bg-cream py-20 sm:py-24 lg:py-28">
          <div className={frame}>
            <h2 id="principles-title" data-reveal="" className={`${sectionTitle} max-w-[20ch]`}>
              {landing.principles.title}
            </h2>
            <p data-reveal="" data-reveal-delay="90" className="mt-6 max-w-[40rem] text-xl leading-9 text-espresso lg:text-[1.375rem]">{landing.principles.lead}</p>

            <div className="mt-14 grid gap-10 lg:mt-20 lg:grid-cols-12 lg:gap-x-4">
              <figure className="relative lg:col-span-8">
                <EstatePhoto
                  id="heritage"
                  locale={locale}
                  sizes="(min-width: 1024px) 60vw, 100vw"
                  revealDelay={0}
                  className="aspect-[4/3] w-full lg:aspect-[16/10]"
                />
                <figcaption className="bg-ivory p-5 text-xl font-semibold leading-snug text-espresso sm:p-6 lg:absolute lg:end-0 lg:top-0 lg:w-80 lg:text-2xl">
                  {landing.principles.statement}
                </figcaption>
              </figure>

              <div className="lg:col-span-4">
                <div data-reveal="" data-reveal-delay="120" className="relative grid aspect-[3/2] place-items-center bg-espresso" aria-hidden="true">
                  <WovenFragment tone="dark" className="size-20" />
                  <WovenSignature tone="dark" className="absolute inset-x-0 bottom-0" />
                </div>
                <dl className="mt-8 grid gap-6">
                  {landing.principles.items.map((item) => (
                    <div key={item.label}>
                      <dt className="text-sm font-semibold text-brown">{item.label}</dt>
                      <dd className="mt-1 text-base leading-7 text-espresso">{item.value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </div>
          </div>
        </section>

        <CamelColours locale={locale} />

        {/* Two rhythms, set like a ledger: the same rows, side by side. */}
        <section id="plans" aria-labelledby="plans-title" className="scroll-mt-20 py-20 sm:py-24 lg:py-28">
          <div className={`${frame} grid gap-12 lg:grid-cols-12 lg:gap-x-10`}>
            <div className="lg:col-span-3">
              <h2 id="plans-title" data-reveal="" className={sectionTitle}>
                {landing.plans.title}
              </h2>
              <p className="mt-4 max-w-xs text-base leading-7 text-muted">{landing.plans.pricing}</p>
              <EstatePhoto
                id="herd"
                locale={locale}
                sizes="(min-width: 1024px) 24vw, (min-width: 640px) 45vw, 100vw"
                revealDelay={120}
                className="mt-10 aspect-[4/3] w-full sm:aspect-[4/5] sm:w-2/5 lg:w-full"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:col-span-8 lg:col-start-5">
              {plans.map((plan) => {
                const copy = landing.plans[plan];
                return (
                  <section
                    key={plan}
                    aria-labelledby={`plan-${plan}`}
                    data-reveal=""
                    data-reveal-delay={plan === "ultimate" ? 90 : 0}
                    className={`flex flex-col p-6 sm:p-8 ${plan === "ultimate" ? "bg-cream" : "bg-sand-soft/45"}`}
                  >
                    <h3 id={`plan-${plan}`} className="text-[1.75rem] font-semibold leading-tight">
                      {copy.name}
                    </h3>
                    <p className="mt-2 text-base leading-7 text-muted">{copy.summary}</p>
                    <dl className="mt-8 grid gap-5">
                      {planRows.map((row) => (
                        <div key={row} className="flex items-baseline justify-between gap-6">
                          <dt className="text-base text-espresso">{landing.plans.labels[row]}</dt>
                          <dd className="text-end text-base font-semibold text-espresso">{copy.rows[row]}</dd>
                        </div>
                      ))}
                    </dl>
                    <DemoAction
                      plan={plan}
                      variant={plan === "ultimate" ? "primary" : "secondary"}
                      className={`mt-10 w-full ${flat}`}
                    >
                      {copy.cta}
                    </DemoAction>
                  </section>
                );
              })}
            </div>
          </div>
        </section>

        {/* Closing: a calm desert, the official mark, one next step. */}
        <section aria-labelledby="final-title" className="relative isolate overflow-hidden bg-espresso text-cream">
          {/* Positioned wrapper: EstatePhoto is relative by design, so it fills this layer instead. */}
          <div className="absolute inset-0 -z-10">
            <EstatePhoto id="closing" locale={locale} sizes="(min-width: 768px) 100vw, 175vw" ground="bg-espresso" className="h-full w-full" />
          </div>
          <div aria-hidden="true" className="absolute inset-0 -z-10 bg-espresso/65" />
          <div className={`${frame} py-24 sm:py-32 lg:py-40`}>
            <CamelMark className="h-14 w-auto sm:h-16" />
            <h2
              id="final-title"
              data-reveal=""
              className={`mt-8 max-w-[14ch] text-[clamp(2.4rem,5.5vw,4.5rem)] font-semibold leading-[1.05] tracking-[-0.035em] ${arabicDisplay}`}
            >
              {landing.final.title}
            </h2>
            <p data-reveal="" data-reveal-delay="90" className="mt-5 max-w-md text-lg leading-8 text-cream/90">
              {landing.final.body}
            </p>
            <div className="mt-10 flex flex-wrap items-center gap-x-8 gap-y-4">
              <DemoAction variant="gold" size="lg" className={flat}>
                {common.actions.startDemo}
                <Arrow />
              </DemoAction>
              <SetupLink className={`${textLink} text-cream hover:text-gold`}>{common.actions.setUp}</SetupLink>
            </div>
          </div>
        </section>
      </main>

      <footer className="bg-espresso text-sm text-cream/75">
        <div className={`${frame} flex flex-col gap-6 pb-10 pt-8 sm:flex-row sm:items-start sm:justify-between`}>
          <div className="max-w-3xl space-y-3 leading-6">
            <p>{common.footer.rights}</p>
            {credits.length ? (
              <p>
                {landing.credits}:{" "}
                {credits.map((credit, index) => (
                  <bdi key={credit.sourceUrl}>
                    <a href={credit.sourceUrl} className="underline decoration-cream/40 underline-offset-4 hover:text-cream">
                      {credit.title}
                    </a>
                    {", "}
                    {credit.creator}
                    {", "}
                    <a href={credit.licenseUrl} className="underline decoration-cream/40 underline-offset-4 hover:text-cream">
                      {credit.license}
                    </a>
                    {index < credits.length - 1 ? "; " : "."}
                  </bdi>
                ))}
              </p>
            ) : null}
          </div>
          <LocaleSwitcher tone="light" className="min-h-11 w-fit shrink-0" />
        </div>
      </footer>
    </div>
  );
}
