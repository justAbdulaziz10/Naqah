'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createContext, useContext, type ReactNode } from 'react';
import { Logo } from '@/components/brand/Logo';
import { AuthLocaleSwitcher } from './AuthLocaleSwitcher';
import { useI18n } from '@/i18n/client';
import { DemoAction } from '@/components/landing/LandingActions';
import { useAuthOptions } from './auth-options';
import { LANDING_PHOTOS } from '@/components/landing/photos';
import './auth.css';

export const AuthHeadingAction = createContext<ReactNode>(null);

/**
 * Sign-in and sign-up: the form on the page ground, the herd at dusk beside it. On sign-up the photo
 * carries what comes next, the four setup steps as open rings on the product's time line.
 */
export function AuthFrame({ children, demoLink = true, wide = false }: { children: ReactNode; demoLink?: boolean; wide?: boolean }) {
  const { locale, href, m } = useI18n();
  const signupPage = usePathname()?.includes('/signup') ?? false;
  // Sign-in and sign-up only: anyone can look around the sample ranch without an account.
  const signIn = useAuthOptions() !== null && demoLink;
  const photo = LANDING_PHOTOS.hero;
  const steps = Object.values(m.setup.flow.steps);
  // A wide frame (the plan choice) gives the form most of the screen and keeps the photograph as a band.
  return <div className={`min-h-dvh bg-ivory text-espresso lg:grid ${wide ? 'lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]' : 'lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]'}`}>
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-between px-4 py-5 sm:px-8 sm:py-6 lg:px-12">
        <Logo locale={locale} href={href('/')} /><AuthLocaleSwitcher />
      </header>
      {/* Phones: a band of the same photograph above the form, carrying the promise under a scrim. */}
      {photo ? <div className="relative mx-4 h-[clamp(14rem,42svh,24rem)] overflow-hidden rounded-2xl bg-espresso sm:mx-8 sm:h-52 lg:hidden">
        <Image src={photo.src} alt="" fill sizes="100vw" className="object-cover" style={{ objectPosition: '50% 55%' }} />
        <div aria-hidden className={'absolute inset-x-0 bottom-0 h-3/4 bg-linear-to-t from-espresso/85 via-espresso/40 to-transparent' /* taste-skill-ignore: scrim under text on the photograph */} />
        <p className="absolute inset-x-0 bottom-0 p-5 text-balance text-[1.5rem] font-semibold leading-snug text-cream sm:text-xl [html[lang=ar]_&]:leading-[1.4]">{m.auth.promise}</p>
      </div> : null}
      <main className={`mx-auto flex w-full ${wide ? 'max-w-[46rem]' : 'max-w-[30rem]'} flex-1 flex-col justify-start px-4 pb-16 pt-6 sm:px-5 lg:justify-center lg:pb-24 lg:pt-0`}>
        {/* The plan choice holds its own cards, so the wide frame sits on the page ground: cards are never nested. */}
        <div className={wide ? 'naqah-auth-in py-2' : 'naqah-auth-in rounded-card border border-stone bg-cream px-5 py-7 sm:px-9 sm:py-9'}>{children}</div>
        {signIn ? (
          <p className="mt-6 text-center">
            <DemoAction plain className="inline-flex min-h-11 items-center gap-2 px-2 text-sm font-medium text-muted underline decoration-stone underline-offset-4 transition-colors hover:text-espresso hover:decoration-espresso focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brown">
              {m.common.actions.startDemo}
            </DemoAction>
          </p>
        ) : null}
      </main>
    </div>
    <aside className="relative hidden overflow-hidden bg-espresso lg:block">
      {photo ? <Image src={photo.src} alt={photo.alt[locale]} fill sizes="52vw" loading="eager" fetchPriority="high" className="object-cover" style={{ objectPosition: '50% 40%' }} /> : null}
      <div aria-hidden className={'absolute inset-x-0 bottom-0 h-3/5 bg-linear-to-t from-espresso/90 via-espresso/50 to-transparent' /* taste-skill-ignore: scrim under text on the photograph */} />
      <div className="absolute inset-x-0 bottom-0 p-12 text-cream xl:p-16">
        <p className={`max-w-[16ch] text-balance ${wide ? 'text-[clamp(1.75rem,2.4vw,2.5rem)]' : 'text-[clamp(2.25rem,3.4vw,3.5rem)]'} font-semibold leading-[1.1] [html[lang=ar]_&]:leading-[1.35]`}>{m.auth.promise}</p>
        {signupPage ? <>
          <p className="mt-6 text-lg text-cream/85">{m.auth.asideSignup}</p>
          <ol className="relative mt-5 grid grid-cols-4 gap-3">
            <span aria-hidden className="absolute inset-x-[12.5%] top-[5px] h-0 border-t-2 border-dashed border-cream/40" />
            {steps.map((step) => <li key={step} className="relative flex flex-col items-center gap-2 text-center text-[0.9375rem]">
              <span aria-hidden className="size-3 rounded-full border-2 border-gold bg-espresso" />
              {step}
            </li>)}
          </ol>
        </> : <p className="mt-4 text-lg text-cream/85">{m.auth.asideLogin}</p>}
      </div>
    </aside>
  </div>;
}

/** Accounts not set up on this deployment: say so plainly and offer the sample ranch instead of a dead form. */
export function AuthClosed({ mode }: { mode: 'login' | 'signup' }) {
  const { m } = useI18n();
  return <AuthFrame demoLink={false}>
    <AuthHeading title={m.auth[mode]} lead={m.auth.notOpen} />
    <DemoAction size="lg" className="mt-7 w-full shadow-none!">{m.common.actions.startDemo}</DemoAction>
  </AuthFrame>;
}

/** One title and one short line: what this screen is for. */
export function AuthHeading({ title, lead }: { title: ReactNode; lead?: ReactNode }) {
  const action = useContext(AuthHeadingAction);
  return <div className="flex flex-col gap-2">
    <h1 className="text-balance text-2xl font-semibold leading-snug sm:text-[1.75rem]">{title}</h1>
    {lead ? <p className="text-pretty leading-relaxed text-muted">{lead}</p> : null}
    {action ? <div className="mt-2">{action}</div> : null}
  </div>;
}

/** The secondary way out of the form (log in instead of sign up and back), set apart by a hairline. */
export function AuthSwitch({ href, children }: { href: string; children: ReactNode }) {
  return <p className="mt-7 border-t border-stone pt-4 text-center">
    <Link href={href} className="inline-flex min-h-11 items-center px-2 text-sm font-medium text-espresso underline decoration-stone underline-offset-4 transition-colors hover:decoration-espresso focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brown">{children}</Link>
  </p>;
}
