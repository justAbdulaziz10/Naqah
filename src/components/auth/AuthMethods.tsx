'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui';
import { cn } from '@/lib/cn';
import { useI18n } from '@/i18n/client';
import { auth } from '@/i18n/messages/auth';
import { createClient } from '@/lib/supabase/client';
import { callbackUrl } from '@/lib/supabase/auth-paths';
import { emailIssue, type EmailIssue } from '@/lib/supabase/email-auth';
import { rememberAuthReturn } from '@/lib/supabase/return-context';
import { useAuthOptions } from './auth-options';

/** Mobile or email as a quiet switch, the chosen form, then Google as the alternative. */
export function AuthMethods({ mode, active, next, disabled, onPendingChange, children }: {
  mode: 'login' | 'signup'; active: 'phone' | 'email'; next: string | null;
  disabled: boolean; onPendingChange: (pending: boolean) => void; children: ReactNode;
}) {
  const { locale, href } = useI18n();
  const m = auth[locale];
  const callbackFailed = useSearchParams().get('error') === 'callbackFailed';
  const [pending, setPending] = useState(false);
  const [issue, setIssue] = useState<EmailIssue | null>(null);
  const locked = useRef(false);
  // Only what Supabase Auth has on: no switch for a single method, no Google unless it is enabled.
  const options = useAuthOptions() ?? { phone: true, email: true, google: true };
  const methods = (['phone', 'email'] as const).filter((method) => options[method]);
  async function google() {
    if (locked.current || disabled) return;
    locked.current = true; setPending(true); onPendingChange(true); setIssue(null);
    let navigating = false;
    try {
      const client = createClient();
      if (!client) { setIssue('unavailable'); return; }
      rememberAuthReturn(next);
      const { data, error } = await client.auth.signInWithOAuth({
        provider: 'google', options: { redirectTo: callbackUrl(window.location.origin, locale, next, 'google'), skipBrowserRedirect: true },
      });
      if (error || !data.url) { setIssue(error ? emailIssue(error) : 'failed'); return; }
      window.location.assign(data.url);
      navigating = true;
    } catch { setIssue('network'); }
    finally {
      if (!navigating) { locked.current = false; setPending(false); onPendingChange(false); }
    }
  }
  return <>
    {methods.length > 1 ? <nav aria-label={m.chooseMethod} className="mt-6 grid grid-cols-2 rounded-full border border-stone bg-ivory p-1">
      {methods.map((method) => {
        const params = new URLSearchParams({ method });
        if (next) params.set('next', next);
        return <Link key={method} href={`${href(`/${mode}`)}?${params}`} aria-current={active === method ? 'page' : undefined}
          aria-disabled={disabled || pending} tabIndex={disabled || pending ? -1 : undefined}
          onClick={(event) => { if (disabled || pending) event.preventDefault(); }}
          className={cn('inline-flex min-h-11 items-center justify-center rounded-full px-4 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brown',
            active === method ? 'bg-cream text-espresso shadow-soft' : 'text-muted hover:text-espresso',
            disabled || pending ? 'opacity-45' : '')}>
          {method === 'phone' ? m.phoneMethod : m.emailMethod}
        </Link>;
      })}
    </nav> : null}
    {children}
    {options.google ? <>
      <div className="mt-6 flex items-center gap-3 text-sm text-muted" aria-hidden="true">
        <span className="h-px flex-1 bg-stone" />{m.or}<span className="h-px flex-1 bg-stone" />
      </div>
      <Button variant="secondary" size="lg" className="mt-6 w-full" disabled={disabled || pending} onClick={() => void google()}>{pending ? m.googlePending : m.google}</Button>
    </> : null}
    {callbackFailed && <p role="alert" className="mt-3 text-sm text-danger">{m.callbackFailed}</p>}
    {issue && <p role="alert" className="mt-3 text-sm text-danger">{m[issue]}</p>}
  </>;
}
