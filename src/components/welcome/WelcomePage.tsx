import Link from "next/link";
import type { Locale } from "@/domain/types";
import { CamelMark } from "@/components/brand/CamelMark";
import { Logo } from "@/components/brand/Logo";
import { WovenSignature } from "@/components/heritage/Woven";
import { EstatePhoto } from "@/components/landing/EstatePhoto";
import { LANDING_PHOTOS } from "@/components/landing/photos";
import { LocaleSwitcher } from "@/components/shell/LocaleSwitcher";
import { getMessages } from "@/i18n/messages";
import { WelcomeStart } from "./WelcomeActions";
import "./welcome.css";

const headerLink =
  "inline-flex min-h-11 items-center whitespace-nowrap px-1.5 text-sm font-semibold text-cream transition-colors hover:text-sand-soft sm:px-2 sm:text-[0.9375rem]";

/**
 * First-time Welcome (handoff §04): «حيّاك الله» as a printed invitation lying on the desert at
 * dusk. The photograph fills the screen on desktop and is a band above the card on phones; only the
 * small header sits on it, over its own scrim. The card holds the one action.
 */
export function WelcomePage({ locale }: { locale: Locale }) {
  const { welcome, auth } = getMessages(locale);
  const authNext = `?next=${encodeURIComponent(`/${locale}/app`)}`;
  const signupNext = `?next=${encodeURIComponent(`/${locale}/start`)}`;
  const photoId = LANDING_PHOTOS.welcome ? "welcome" : "closing";

  return (
    <div className="relative isolate flex min-h-svh flex-col overflow-x-clip bg-espresso text-espresso">
      <div className="absolute inset-x-0 top-0 -z-10 h-[max(40svh,16rem)] lg:h-full">
        <EstatePhoto
          id={photoId}
          locale={locale}
          eager
          sizes="(min-width: 1024px) 100vw, 175vw"
          ground="bg-brown-deep"
          className="naqah-welcome-photo h-full w-full"
        />
        <div
          aria-hidden="true"
          className={"absolute inset-x-0 top-0 h-28 bg-linear-to-b from-espresso/70 to-transparent" /* taste-skill-ignore: neutral scrim under the header on the photograph */}
        />
      </div>

      <header className="flex min-h-16 items-center justify-between gap-2 px-4 sm:px-8 lg:px-12">
        <Logo locale={locale} tone="light" href={`/${locale}`} className="min-h-11" />
        <div className="flex min-w-0 items-center justify-end sm:gap-x-1">
          <Link href={`/${locale}/login${authNext}`} className={headerLink}>
            {welcome.signIn}
          </Link>
          <Link href={`/${locale}/signup${signupNext}`} className={headerLink}>
            {auth.navSignup}
          </Link>
          <LocaleSwitcher tone="light" className="min-h-11 whitespace-nowrap max-sm:px-1.5 max-sm:[&_svg]:hidden" />
        </div>
      </header>

      <main className="flex-1 px-4 pb-10 pt-[calc(max(40svh,16rem)-7rem)] sm:px-8 lg:flex lg:items-center lg:px-[clamp(3rem,8vw,8rem)] lg:py-12">
        <div className="naqah-welcome-pane mx-auto w-full max-w-[30rem] bg-cream lg:mx-0">
          <WovenSignature />
          <div className="flex flex-col items-center px-6 pb-5 pt-8 text-center sm:px-12 sm:pb-9 sm:pt-12">
            <CamelMark className="h-10 w-auto sm:h-12" />
            <h1 className="mt-4 text-[clamp(3rem,5vw,4.5rem)] font-light leading-[1.1] tracking-[-0.03em] [html[lang=ar]_&]:font-[350] [html[lang=ar]_&]:leading-[1.35] [html[lang=ar]_&]:tracking-normal">
              {welcome.title}
            </h1>
            <p className="mt-2 text-balance text-lg leading-8 sm:mt-3">{welcome.line}</p>

            <ol aria-label={welcome.stepsLabel} className="naqah-welcome-thread relative mt-7 grid w-full grid-cols-4 sm:mt-9">
              {welcome.steps.map((step) => (
                <li key={step} className="relative flex flex-col items-center gap-2.5 text-[0.9375rem] leading-6">
                  <span aria-hidden="true" className="size-[7px] rounded-full bg-brown" />
                  {step}
                </li>
              ))}
            </ol>

            <div className="mt-7 w-full sm:mt-9">
              <WelcomeStart label={welcome.cta} pending={welcome.pending} />
            </div>
            <Link
              href={`/${locale}#call`}
              className="mt-2 inline-flex min-h-11 items-center text-base font-semibold text-brown underline decoration-1 underline-offset-[6px] transition-colors hover:text-espresso"
            >
              {welcome.how}
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
