import Link from "next/link";
import type { Locale } from "@/domain/types";
import { Logo } from "@/components/brand/Logo";
import { WovenFrame, WovenSignature } from "@/components/heritage/Woven";
import { EstatePhoto } from "@/components/landing/EstatePhoto";
import { LANDING_PHOTOS } from "@/components/landing/photos";
import { LocaleSwitcher } from "@/components/shell/LocaleSwitcher";
import { getMessages } from "@/i18n/messages";
import { WelcomeStart } from "./WelcomeActions";

/** Calm, once-only entrance for the reading pane; the finished page is the still state. */
const rise = "motion-safe:animate-fade-up";

/**
 * First-time Welcome (handoff §04, B + C): split editorial reading pane on Warm Ivory beside one
 * cinematic camel portrait. One photograph serves both layouts through grid areas: a calm band
 * under the header on phones, the full-height column on desktop. No text sits on the photograph.
 */
export function WelcomePage({ locale }: { locale: Locale }) {
  const { welcome } = getMessages(locale);
  const photoId = LANDING_PHOTOS.welcome ? "welcome" : "herd";

  return (
    <div className="grid min-h-svh bg-ivory text-espresso [grid-template-areas:'header'_'image'_'main'_'sig'] [grid-template-rows:auto_auto_1fr_auto] lg:grid-cols-[minmax(0,45fr)_minmax(0,55fr)] lg:[grid-template-areas:'header_image'_'main_image'_'sig_image'] lg:[grid-template-rows:auto_1fr_auto]">
      <header className="flex min-h-16 items-center justify-between gap-3 px-5 [grid-area:header] sm:px-8 lg:px-12 xl:px-20">
        <Logo locale={locale} href={`/${locale}`} className="min-h-11" />
        <div className="flex items-center gap-1">
          <Link
            href={`/${locale}/login`}
            className="inline-flex min-h-11 items-center px-2 text-[0.9375rem] font-semibold text-muted transition-colors hover:text-espresso"
          >
            {welcome.signIn}
          </Link>
          <LocaleSwitcher className="min-h-11" />
        </div>
      </header>

      <div className="relative [grid-area:image]">
        <EstatePhoto
          id={photoId}
          locale={locale}
          eager
          sizes="(min-width: 1024px) 55vw, 100vw"
          className="naqah-settle h-[38svh] min-h-[220px] w-full lg:h-full lg:min-h-svh"
        />
        <WovenFrame className="absolute inset-y-0 start-0 max-lg:hidden" />
      </div>

      <main className="naqah-welcome-pane flex flex-col justify-center px-5 py-12 [grid-area:main] sm:px-8 sm:py-16 lg:px-12 lg:py-16 xl:px-20">
        <div className="max-w-[34rem]">
          <span aria-hidden="true" className={`block h-1 w-12 bg-crimson-editorial ${rise}`} />
          <h1
            className={`mt-8 text-balance text-[clamp(2.5rem,5vw,4.5rem)] font-semibold leading-[1.05] tracking-[-0.03em] [html[lang=ar]_&]:leading-[1.3] [html[lang=ar]_&]:tracking-normal ${rise} [animation-delay:80ms]`}
          >
            {welcome.title}
          </h1>
          <p className={`mt-6 text-xl leading-9 text-espresso ${rise} [animation-delay:160ms]`}>{welcome.body}</p>
          <div className={`mt-10 flex flex-col items-start gap-4 ${rise} [animation-delay:240ms]`}>
            <WelcomeStart label={welcome.cta} pending={welcome.pending} />
            <Link
              href={`/${locale}#call`}
              className="inline-flex min-h-11 items-center text-base font-semibold text-brown underline decoration-1 underline-offset-[6px] transition-colors hover:text-espresso"
            >
              {welcome.how}
            </Link>
          </div>
          <p className={`mt-8 text-base leading-7 text-muted ${rise} [animation-delay:300ms]`}>{welcome.note}</p>
        </div>
      </main>

      <div className="[grid-area:sig]">
        <WovenSignature />
      </div>
    </div>
  );
}
