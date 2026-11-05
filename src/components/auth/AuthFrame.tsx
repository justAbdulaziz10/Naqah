'use client';

import type { ReactNode } from 'react';
import { Logo } from '@/components/brand/Logo';
import { LocaleSwitcher } from '@/components/shell/LocaleSwitcher';
import { useI18n } from '@/i18n/client';

export function AuthFrame({ children }: { children: ReactNode }) {
  const { locale, href } = useI18n();
  return <div className="min-h-dvh bg-ivory text-espresso">
    <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-6 sm:px-8">
      <Logo locale={locale} href={href('/')} /><LocaleSwitcher />
    </header>
    <main className="mx-auto w-full max-w-md px-5 pb-16 pt-10 sm:pt-20">
      <div className="rounded-card border border-stone bg-cream p-6 sm:p-8">{children}</div>
    </main>
  </div>;
}
