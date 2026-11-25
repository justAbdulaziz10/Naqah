import type { Locale } from "@/domain/types";
import { Logo } from "@/components/brand/Logo";
import { LocaleSwitcher } from "@/components/shell/LocaleSwitcher";
import { getMessages } from "@/i18n/messages";
import { LANDING_PHOTOS, type LandingPhotoId } from "../photos";

/** The photographs this page shows; only these are credited. */
const shown: LandingPhotoId[] = ["hero", "closing"];

const footerLink =
  "inline-flex min-h-11 items-center font-semibold text-[var(--text-muted)] transition-colors hover:text-[var(--text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current";

export function NightFooter({ locale }: { locale: Locale }) {
  const { common, landing } = getMessages(locale);
  const c = getMessages(locale).landing.night.footer;
  const links = [
    { href: "#call", label: landing.nav.how },
    { href: "#reliability", label: landing.nav.principles },
    { href: "#plans", label: landing.nav.plans },
  ];
  const credits = shown.flatMap((id) => (LANDING_PHOTOS[id] ? [LANDING_PHOTOS[id].credit] : []));

  return (
    <footer className="night-rule bg-[var(--night-0)] text-sm">
      <div className="night-frame flex flex-col gap-8 pt-12 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-3">
          <Logo locale={locale} tone="light" href={`/${locale}`} className="min-h-11" />
          <p className="max-w-[28rem] leading-6 text-[var(--text-muted)]">{c.line}</p>
        </div>
        <nav aria-label={landing.nav.menuLabel} className="flex flex-wrap gap-x-7 gap-y-1">
          {links.map((link) => (
            <a key={link.href} href={link.href} className={footerLink}>
              {link.label}
            </a>
          ))}
        </nav>
        <LocaleSwitcher tone="light" className="min-h-11 w-fit shrink-0" />
      </div>
      <div className="night-frame flex flex-col gap-3 pb-10 pt-8 text-[0.8125rem] leading-6 text-[var(--text-faint)] sm:flex-row sm:items-start sm:justify-between">
        <p>{common.footer.rights}</p>
        {credits.length ? (
          <details className="max-w-3xl">
            <summary className="inline-flex min-h-11 cursor-pointer items-center font-medium transition-colors hover:text-[var(--text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current">
              {landing.credits}
            </summary>
            <ul className="grid gap-0.5 pb-1 leading-5">
              {credits.map((credit) => (
                <li key={credit.sourceUrl}>
                  <bdi>
                    <a href={credit.sourceUrl} className="underline decoration-[var(--line-strong)] underline-offset-4 hover:text-[var(--text)]">
                      {credit.title}
                    </a>
                  </bdi>
                  {" · "}
                  {credit.creator}
                  {" · "}
                  <a href={credit.licenseUrl} className="underline decoration-[var(--line-strong)] underline-offset-4 hover:text-[var(--text)]">
                    {credit.license}
                  </a>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
    </footer>
  );
}
