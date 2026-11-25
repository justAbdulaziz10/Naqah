import { AuthNavigation } from "@/components/auth/AuthNavigation";
import type { Locale } from "@/domain/types";
import { CamelMarkSymbol } from "@/components/brand/CamelMark";
import { Logo } from "@/components/brand/Logo";
import { ACCOUNT_DATA } from "@/components/entry/paths";
import { LocaleSwitcher } from "@/components/shell/LocaleSwitcher";
import { getMessages } from "@/i18n/messages";
import { EntryActions } from "../EntryActionsServer";
import { CallDimension } from "./CallDimension";
import { NightClosing } from "./NightClosing";
import { NightFooter } from "./NightFooter";
import { NightHero } from "./NightHero";
import { NightMobileNav } from "./NightMobileNav";
import { NightPlans } from "./NightPlans";
import { RanchDiorama } from "./RanchDiorama";
import { Reliability } from "./Reliability";
import "./night.css";

/**
 * The landing: ناقة in 3D first, then the call, the ranch model, what NAQAH holds to, the plans and the closing.
 * Each section owns its copy (local defineMessages) and its visuals; this file only assembles them.
 */
export function NightLanding({ locale }: { locale: Locale }) {
  const { landing } = getMessages(locale);
  const prefix = (path: string) => `/${locale}${path === "/" ? "" : path}`;
  const anchorLinks = [
    { href: "#call", label: landing.nav.how },
    { href: "#reliability", label: landing.nav.principles },
    { href: "#plans", label: landing.nav.plans },
  ];

  return (
    <div className="naqah-night min-h-svh overflow-x-clip">
      <CamelMarkSymbol />
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:start-4 focus:top-3 focus:z-[60] focus:inline-flex focus:min-h-11 focus:items-center focus:rounded-full focus:bg-[var(--gold-bright)] focus:px-5 focus:text-[var(--night-1)]"
      >
        {landing.nav.skip}
      </a>

      {/* The header floats over the night sky: glass, no hard ground. */}
      <header className="fixed inset-x-0 top-0 z-50">
        <div className="night-frame pt-3">
          <div className="night-glass flex min-h-14 items-center justify-between gap-3 px-4 sm:px-5">
            <Logo locale={locale} href={prefix("/")} tone="light" className="min-h-11" />
            <div className="flex items-center gap-1 sm:gap-2">
              <nav aria-label={landing.nav.menuLabel} className="hidden items-center lg:flex">
                {anchorLinks.map((link) => (
                  <a
                    key={link.href}
                    href={link.href}
                    className="inline-flex min-h-11 min-w-11 justify-center items-center px-3.5 text-[0.9375rem] font-semibold text-[var(--text-muted)] transition-colors hover:text-[var(--text)]"
                  >
                    {link.label}
                  </a>
                ))}
                {ACCOUNT_DATA ? <span className="night-auth contents"><AuthNavigation signup={false} /></span> : null}
              </nav>
              <div className="hidden lg:block">
                <LocaleSwitcher className="min-h-11" tone="light" />
              </div>
              <div className="ms-2 max-sm:hidden">
                <EntryActions primary={{ size: "md", className: "night-cta" }} />
              </div>
              <NightMobileNav
                links={anchorLinks}
                authControls={ACCOUNT_DATA ? <div className="night-auth"><AuthNavigation appearance="mobile" signup={false} /></div> : null}
                menuLabel={landing.nav.menu}
                menuTitle={landing.nav.menuLabel}
                actions={<EntryActions primary={{ size: "md", className: "night-cta w-full" }} />}
              />
            </div>
          </div>
        </div>
      </header>

      <main id="main" tabIndex={-1} className="outline-none">
        <NightHero locale={locale} />
        <CallDimension locale={locale} />
        <RanchDiorama locale={locale} />
        <Reliability locale={locale} />
        <NightPlans locale={locale} />
        <NightClosing locale={locale} />
      </main>
      <NightFooter locale={locale} />
    </div>
  );
}
