'use client';

import type { ReactNode } from 'react';
import { Logo } from '@/components/brand/Logo';
import { AuthLocaleSwitcher } from './AuthLocaleSwitcher';
import { useI18n } from '@/i18n/client';
import { DemoAction } from '@/components/landing/LandingActions';
import { useAuthOptions } from './auth-options';

export function AuthFrame({ children }: { children: ReactNode }) {
  const { locale, href, m } = useI18n();
  // Sign-in and sign-up only: anyone can look around the sample ranch without an account.
  const signIn = useAuthOptions() !== null;
  return <div className="min-h-dvh bg-ivory text-espresso">
    <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-6 sm:px-8">
      <Logo locale={locale} href={href('/')} /><AuthLocaleSwitcher />
    </header>
    <main className="mx-auto w-full max-w-md px-5 pb-16 pt-10 sm:pt-20">
      <div className="rounded-card border border-stone bg-cream p-6 sm:p-8">{children}</div>
      {signIn ? (
        <p className="mt-6 text-center">
          <DemoAction plain className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-brown underline underline-offset-4 hover:text-espresso focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brown">
            {m.common.actions.startDemo}
          </DemoAction>
        </p>
      ) : null}
    </main>
  </div>;
}
