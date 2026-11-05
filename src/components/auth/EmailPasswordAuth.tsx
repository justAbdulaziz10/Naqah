'use client';

import Link from 'next/link';
import { useId, useRef, useState, type FormEvent } from 'react';
import { Button, Input } from '@/components/ui';
import { useI18n } from '@/i18n/client';
import { auth } from '@/i18n/messages/auth';
import { createClient } from '@/lib/supabase/client';
import { getSupabaseConfig } from '@/lib/supabase/config';
import { callbackUrl, successPath } from '@/lib/supabase/auth-paths';
import { authenticateEmail, type EmailIssue } from '@/lib/supabase/email-auth';
import { AuthFrame } from './AuthFrame';
import { AuthMethods } from './AuthMethods';

export function EmailPasswordAuth({ mode, next }: { mode: 'login' | 'signup'; next: string | null }) {
  const { locale, href } = useI18n();
  const m = auth[locale];
  const id = useId();
  const emailId = `${id}-email`;
  const passwordId = `${id}-password`;
  const errorId = `${id}-error`;
  const configured = !!getSupabaseConfig();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [pending, setPending] = useState(false);
  const [googlePending, setGooglePending] = useState(false);
  const [confirmation, setConfirmation] = useState(false);
  const [issue, setIssue] = useState<EmailIssue | null>(null);
  const locked = useRef(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (locked.current || googlePending) return;
    const client = createClient();
    if (!client) { setIssue('unavailable'); return; }
    locked.current = true; setPending(true); setIssue(null);
    const result = await authenticateEmail(client, mode, email, password, callbackUrl(window.location.origin, locale, next, 'email'));
    if ('status' in result) {
      setPassword('');
      if (result.status === 'signedIn') {
        // A full navigation sends the newly written SSR session cookies.
        window.location.assign(successPath(locale, next));
        return;
      }
      setConfirmation(true);
    } else { setIssue(result.issue); }
    locked.current = false; setPending(false);
  }
  const query = new URLSearchParams({ method: 'email' });
  if (next) query.set('next', next);
  const error = !configured ? 'unavailable' : issue;
  return <AuthFrame>
    <h1 className="text-2xl font-semibold leading-snug">{confirmation ? m.confirmTitle : m[mode]}</h1>
    {confirmation ? <>
      <p role="status" className="mt-4 leading-relaxed text-muted">{m.confirmBody}</p>
      <Link className="mt-5 inline-flex min-h-11 items-center underline underline-offset-4" href={`${href('/login')}?${query}`}>{m.otherLogin}</Link>
    </> : <>
      <AuthMethods mode={mode} active="email" next={next} disabled={pending || !configured} onPendingChange={setGooglePending} />
      <p className="mt-5 text-muted leading-relaxed">{m.emailIntro}</p>
      <form onSubmit={(event) => void submit(event)} className="mt-6 flex flex-col gap-4" aria-busy={pending || googlePending}>
        <label htmlFor={emailId} className="text-sm font-semibold">{m.email}</label>
        <Input id={emailId} name="email" type="email" dir="ltr" autoComplete="email" inputMode="email" autoCapitalize="none" spellCheck={false} required value={email} onChange={(event) => { setEmail(event.target.value); setIssue(null); }} disabled={pending || googlePending || !configured} aria-invalid={issue === 'credentials'} aria-describedby={errorId} />
        <label htmlFor={passwordId} className="text-sm font-semibold">{m.password}</label>
        <Input id={passwordId} name="password" type={visible ? 'text' : 'password'} dir="ltr" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} required value={password} onChange={(event) => { setPassword(event.target.value); setIssue(null); }} disabled={pending || googlePending || !configured} aria-invalid={issue === 'credentials' || issue === 'weakPassword'} aria-describedby={errorId} />
        <Button variant="ghost" className="self-start" disabled={pending || googlePending} aria-pressed={visible} onClick={() => setVisible(!visible)}>{visible ? m.hidePassword : m.showPassword}</Button>
        <p id={errorId} data-email-error role="alert" className="text-sm text-danger" hidden={!error}>{error ? m[error] : ''}</p>
        <Button type="submit" size="lg" disabled={pending || googlePending || !configured}>{pending ? m.emailPending : mode === 'signup' ? m.emailSignup : m.emailLogin}</Button>
      </form>
      <Link className="mt-5 inline-flex min-h-11 items-center text-sm underline underline-offset-4" href={`${href(mode === 'login' ? '/signup' : '/login')}?${query}`}>{mode === 'login' ? m.otherSignup : m.otherLogin}</Link>
    </>}
  </AuthFrame>;
}
