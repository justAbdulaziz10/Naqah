import { ArrowUpRight } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import type { Locale } from "@/domain/types";
import { CamelMark } from "@/components/brand/CamelMark";
import { Logo } from "@/components/brand/Logo";
import { LocaleSwitcher } from "@/components/shell/LocaleSwitcher";
import { getMessages } from "@/i18n/messages";
import { DemoAction, MobileNavigation, OwnerCall } from "./LandingActions";
import { LiveTranscript } from "./LiveTranscript";

const planRows = ["cadence", "questions", "calls", "tickets"] as const;
const plans = ["basic", "ultimate"] as const;

const textLink =
  "inline-flex min-h-11 items-center font-semibold underline decoration-1 underline-offset-[6px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold";

function Arrow({ size = 18 }: { size?: number }) {
  return <ArrowUpRight size={size} weight="regular" className="rtl:-scale-x-100" aria-hidden="true" />;
}

export function LandingPage({ locale }: { locale: Locale }) {
  const { common, landing } = getMessages(locale);
  const prefix = (path: string) => `/${locale}${path === "/" ? "" : path}`;
  const anchorLinks = [
    { href: "#call", label: landing.nav.how },
    { href: "#plans", label: landing.nav.plans },
  ];

  return (
    <div className="min-h-screen overflow-x-clip bg-ivory text-espresso">
      <header className="sticky top-0 z-50 border-b border-stone/80 bg-ivory/95 backdrop-blur-md">
        <div className="mx-auto flex min-h-16 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
          <Logo locale={locale} href={prefix("/")} className="min-h-11" />
          <div className="flex items-center gap-1 sm:gap-2">
            <nav aria-label={landing.nav.menuLabel} className="hidden items-center lg:flex">
              {anchorLinks.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  className="inline-flex min-h-11 items-center px-3.5 text-sm font-semibold text-muted transition-colors hover:text-espresso"
                >
                  {link.label}
                </a>
              ))}
            </nav>
            <div className="hidden lg:block">
              <LocaleSwitcher className="min-h-11" />
            </div>
            <DemoAction size="md" className="ms-2 max-sm:hidden">
              {common.actions.startDemo}
            </DemoAction>
            <MobileNavigation links={anchorLinks} menuLabel={landing.nav.menu} menuTitle={landing.nav.menuLabel} />
          </div>
        </div>
      </header>

      <main>
        <section
          id="call"
          aria-labelledby="landing-title"
          className="mx-auto grid max-w-7xl scroll-mt-20 gap-14 px-4 pb-20 pt-14 sm:px-6 sm:pt-20 lg:grid-cols-12 lg:gap-x-12 lg:px-8 lg:pb-28 lg:pt-24"
        >
          <div className="lg:col-span-6 xl:col-span-7">
            <h1
              id="landing-title"
              className="max-w-[11ch] text-[clamp(2.9rem,7.4vw,6.25rem)] font-semibold leading-[1.02] tracking-[-0.04em] [html[lang=ar]_&]:leading-[1.2] [html[lang=ar]_&]:tracking-normal"
            >
              {landing.hero.title}
            </h1>
            <p className="mt-8 max-w-[34rem] text-lg leading-8 text-muted sm:text-xl sm:leading-9">
              {landing.hero.description}
            </p>
            <div className="mt-10 flex flex-wrap items-center gap-x-8 gap-y-4">
              <DemoAction size="lg">
                {common.actions.startDemo}
                <Arrow />
              </DemoAction>
              <Link href={prefix("/start")} className={`${textLink} text-espresso hover:text-brown`}>
                {common.actions.setUp}
              </Link>
            </div>
          </div>
          <div className="lg:col-span-6 lg:pt-3 xl:col-span-5">
            <LiveTranscript />
          </div>
        </section>

        <section aria-labelledby="owner-title" className="bg-espresso text-cream">
          <div className="mx-auto grid max-w-7xl gap-10 px-4 py-20 sm:px-6 lg:grid-cols-12 lg:gap-x-12 lg:px-8 lg:py-28">
            <h2 id="owner-title" className="text-3xl font-semibold tracking-tight sm:text-4xl lg:col-span-4">
              {landing.owner.title}
            </h2>
            <div className="lg:col-span-8">
              <OwnerCall />
            </div>
          </div>
        </section>

        <section aria-labelledby="rules-title" className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8 lg:py-28">
          <div className="grid gap-10 lg:grid-cols-12 lg:gap-x-12">
            <h2 id="rules-title" className="text-3xl font-semibold tracking-tight sm:text-4xl lg:col-span-4">
              {landing.rules.title}
            </h2>
            <dl className="grid gap-x-12 sm:grid-cols-2 lg:col-span-8">
              {landing.rules.items.map((rule) => (
                <div key={rule.title} className="border-t border-stone pb-9 pt-5">
                  <dt className="text-lg font-semibold leading-snug">{rule.title}</dt>
                  <dd className="mt-2 max-w-[30rem] leading-7 text-muted">{rule.body}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section id="plans" aria-labelledby="plans-title" className="scroll-mt-20 border-t border-stone bg-cream">
          <div className="mx-auto grid max-w-7xl gap-10 px-4 py-20 sm:px-6 lg:grid-cols-12 lg:gap-x-12 lg:px-8 lg:py-28">
            <div className="lg:col-span-4">
              <h2 id="plans-title" className="text-3xl font-semibold tracking-tight sm:text-4xl">
                {landing.plans.title}
              </h2>
              <p className="mt-4 max-w-xs text-sm leading-6 text-muted">{landing.plans.pricing}</p>
            </div>

            <div className="lg:col-span-8">
              <table className="w-full table-fixed border-collapse text-start">
                <caption className="sr-only">{landing.plans.title}</caption>
                <thead>
                  <tr className="align-top">
                    <td className="max-sm:hidden sm:w-[34%]" />
                    {plans.map((plan) => (
                      <th key={plan} scope="col" className="pb-6 pe-4 text-start font-normal last:pe-0">
                        <span className="block text-2xl font-semibold tracking-tight">{landing.plans[plan].name}</span>
                        <span className="mt-1.5 block text-sm leading-6 text-muted">{landing.plans[plan].summary}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                {planRows.map((row) => (
                  <tbody key={row} className="border-t border-stone">
                    <tr className="sm:hidden">
                      <th scope="rowgroup" colSpan={2} className="pt-4 text-start text-xs font-semibold text-muted">
                        {landing.plans.labels[row]}
                      </th>
                    </tr>
                    <tr className="align-baseline">
                      <th scope="row" className="py-4 pe-4 text-start text-sm font-semibold text-muted max-sm:hidden">
                        {landing.plans.labels[row]}
                      </th>
                      {plans.map((plan) => (
                        <td key={plan} className="py-4 pe-4 font-medium last:pe-0 max-sm:pt-1.5">
                          {landing.plans[plan].rows[row]}
                        </td>
                      ))}
                    </tr>
                  </tbody>
                ))}
                <tfoot className="border-t border-stone">
                  <tr>
                    <td className="max-sm:hidden" />
                    {plans.map((plan) => (
                      <td key={plan} className="pe-4 pt-6 last:pe-0">
                        <DemoAction
                          plan={plan}
                          variant={plan === "ultimate" ? "primary" : "secondary"}
                          className="w-full max-sm:px-3"
                        >
                          {landing.plans[plan].cta}
                        </DemoAction>
                      </td>
                    ))}
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </section>

        <section aria-labelledby="final-title" className="bg-espresso text-cream">
          <div className="mx-auto max-w-7xl px-4 pb-20 pt-20 sm:px-6 lg:px-8 lg:pb-24 lg:pt-28">
            <CamelMark className="h-14 w-auto sm:h-16" />
            <h2
              id="final-title"
              className="mt-8 max-w-[14ch] text-[clamp(2.4rem,5.5vw,4.5rem)] font-semibold leading-[1.05] tracking-[-0.035em] [html[lang=ar]_&]:leading-[1.25] [html[lang=ar]_&]:tracking-normal"
            >
              {landing.final.title}
            </h2>
            <p className="mt-5 max-w-md text-lg leading-8 text-cream/70">{landing.final.body}</p>
            <div className="mt-10 flex flex-wrap items-center gap-x-8 gap-y-4">
              <DemoAction variant="gold" size="lg">
                {common.actions.startDemo}
                <Arrow />
              </DemoAction>
              <Link href={prefix("/start")} className={`${textLink} text-cream hover:text-gold`}>
                {common.actions.setUp}
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="bg-espresso px-4 pb-8 text-sm text-cream/60 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 border-t border-cream/15 pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p>{common.footer.rights}</p>
          <LocaleSwitcher tone="light" className="min-h-11 w-fit" />
        </div>
      </footer>
    </div>
  );
}
