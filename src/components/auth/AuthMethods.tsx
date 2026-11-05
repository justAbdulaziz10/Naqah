'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useRef, useState } from 'react';
import { Button, buttonClass } from '@/components/ui';
import { useI18n } from '@/i18n/client';
import { auth } from '@/i18n/messages/auth';
import { createClient } from '@/lib/supabase/client';
import { callbackUrl } from '@/lib/supabase/auth-paths';
import { emailIssue, type EmailIssue } from '@/lib/supabase/email-auth';

export function AuthMethods({ mode, active, next, disabled, onPendingChange }: {
  mode: 'login' | 'signup'; active: 'phone' | 'email'; next: string | null;
  disabled: boolean; onPendingChange: (pending: boolean) => void;
}) {
  const { locale, href } = useI18n();
  const m = auth[locale];
  const callbackFailed = useSearchParams().get('error') === 'callbackFailed';
  const [pending, setPending] = useState(false);
  const [issue, setIssue] = useState<EmailIssue | null>(null);
  const locked = useRef(false);
  async function google() {
    if (locked.current || disabled) return;
    locked.current = true; setPending(true); onPendingChange(true); setIssue(null);
    let navigating = false;
    try {
      const client = createClient();
      if (!client) { setIssue('unavailable'); return; }
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
  return <div className="mt-6 flex flex-col gap-3">
    <nav aria-label={m.chooseMethod} className="grid grid-cols-2 gap-2">
      {(['phone', 'email'] as const).map((method) => {
        const params = new URLSearchParams({ method });
        if (next) params.set('next', next);
        return <Link key={method} href={`${href(`/${mode}`)}?${params}`} aria-current={active === method ? 'page' : undefined}
          aria-disabled={disabled || pending} tabIndex={disabled || pending ? -1 : undefined}
          onClick={(event) => { if (disabled || pending) event.preventDefault(); }}
          className={buttonClass({ variant: active === method ? 'primary' : 'secondary', size: 'lg', className: disabled || pending ? 'opacity-45' : '' })}>
          {method === 'phone' ? m.phoneMethod : m.emailMethod}
        </Link>;
      })}
    </nav>
    <Button variant="secondary" size="lg" disabled={disabled || pending} onClick={() => void google()}>{pending ? m.googlePending : m.google}</Button>
    {callbackFailed && <p role="alert" className="text-sm text-danger">{m.callbackFailed}</p>}
    {issue && <p role="alert" className="text-sm text-danger">{m[issue]}</p>}
  </div>;
}
