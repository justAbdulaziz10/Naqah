'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { Logo } from '@/components/brand/Logo';
import { AuthLocaleSwitcher } from './AuthLocaleSwitcher';
import { useI18n } from '@/i18n/client';
import { DemoAction } from '@/components/landing/LandingActions';
import { useAuthOptions } from './auth-options';

export function AuthFrame({ children, demoLink = true }: { children: ReactNode; demoLink?: boolean }) {
  const { locale, href, m } = useI18n();
  // Sign-in and sign-up only: anyone can look around the sample ranch without an account.
  const signIn = useAuthOptions() !== null && demoLink;
  return <div className="min-h-dvh bg-ivory text-espresso">
    <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5 sm:px-8 sm:py-6">
      <Logo locale={locale} href={href('/')} /><AuthLocaleSwitcher />
    </header>
    <main className="mx-auto w-full max-w-[30rem] px-4 pb-16 pt-4 sm:px-5 sm:pt-16">
      <div className="rounded-card border border-stone bg-cream px-5 py-7 sm:px-9 sm:py-9">{children}</div>
      {signIn ? (
        <p className="mt-8 text-center">
          <DemoAction plain className="inline-flex min-h-11 items-center gap-2 px-2 text-sm font-medium text-muted underline decoration-stone underline-offset-4 transition-colors hover:text-espresso hover:decoration-espresso focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brown">
            {m.common.actions.startDemo}
          </DemoAction>
        </p>
      ) : null}
    </main>
  </div>;
}

/** Accounts not set up on this deployment: say so plainly and offer the sample ranch instead of a dead form. */
export function AuthClosed({ mode }: { mode: 'login' | 'signup' }) {
  const { m } = useI18n();
  return <AuthFrame demoLink={false}>
    <AuthHeading title={m.auth[mode]} lead={m.auth.notOpen} />
    <DemoAction size="lg" className="mt-7 w-full">{m.common.actions.startDemo}</DemoAction>
  </AuthFrame>;
}

/** One title and one short line: what this screen is for. */
export function AuthHeading({ title, lead }: { title: ReactNode; lead?: ReactNode }) {
  return <div className="flex flex-col gap-2">
    <h1 className="text-balance text-2xl font-semibold leading-snug sm:text-[1.75rem]">{title}</h1>
    {lead ? <p className="text-pretty leading-relaxed text-muted">{lead}</p> : null}
  </div>;
}

/** The secondary way out of the form (log in instead of sign up and back), set apart by a hairline. */
export function AuthSwitch({ href, children }: { href: string; children: ReactNode }) {
  return <p className="mt-7 border-t border-stone pt-4 text-center">
    <Link href={href} className="inline-flex min-h-11 items-center px-2 text-sm font-medium text-espresso underline decoration-stone underline-offset-4 transition-colors hover:decoration-espresso focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brown">{children}</Link>
  </p>;
}
