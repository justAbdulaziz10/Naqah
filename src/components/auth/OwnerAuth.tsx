'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Button, Input } from '@/components/ui';
import { useI18n } from '@/i18n/client';
import { auth } from '@/i18n/messages/auth';
import { createClient } from '@/lib/supabase/client';
import { authIssue, latinDigits, normalizeSaudiPhone, safeReturnPath } from '@/lib/supabase/auth-input';
import { getSupabaseConfig } from '@/lib/supabase/config';
import { AuthFrame } from './AuthFrame';
import { AuthMethods } from './AuthMethods';
import { EmailPasswordAuth } from './EmailPasswordAuth';

function PhoneAuth({ mode }: { mode: 'login' | 'signup' }) {
  const { locale, href } = useI18n();
  const m = auth[locale];
  const id = useId();
  const phoneId = `${id}-phone`;
  const codeId = `${id}-code`;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const next = safeReturnPath(useSearchParams().get('next'));
  const configured = !!getSupabaseConfig();
  const [phone, setPhone] = useState('');
  const [sentPhone, setSentPhone] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'sending' | 'verifying' | null>(null);
  const [issue, setIssue] = useState<keyof Pick<typeof m, 'invalidPhone' | 'invalidCodeFormat' | 'invalidCode' | 'rateLimit' | 'network' | 'unavailable' | 'failed'> | null>(null);
  const [notice, setNotice] = useState(false);
  const [googlePending, setGooglePending] = useState(false);
  const [remaining, setRemaining] = useState(0);
  const until = useRef(0);
  const locked = useRef(false);
  const codeInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const timer = setInterval(() => setRemaining(Math.max(0, Math.ceil((until.current - Date.now()) / 1000))), 500);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => { if (sentPhone) codeInput.current?.focus(); }, [sentPhone]);

  function cooldown() { until.current = Date.now() + 60_000; setRemaining(60); }
  async function send() {
    if (locked.current || googlePending || Date.now() < until.current) return;
    const normalized = normalizeSaudiPhone(phone);
    if (!normalized) { setIssue('invalidPhone'); return; }
    const client = createClient();
    if (!client) { setIssue('unavailable'); return; }
    locked.current = true; setBusy('sending'); setIssue(null); setNotice(false);
    try {
      const { error } = await client.auth.signInWithOtp({ phone: normalized, options: { shouldCreateUser: true, channel: 'sms' } });
      if (error) {
        const kind = authIssue(error); setIssue(kind);
        if (kind === 'rateLimit') cooldown();
      } else {
        setNotice(!!sentPhone); setSentPhone(normalized); setCode(''); cooldown();
      }
    } catch { setIssue('network'); }
    finally { locked.current = false; setBusy(null); }
  }
  async function verify(event: FormEvent) {
    event.preventDefault();
    if (locked.current) return;
    const token = latinDigits(code).trim();
    if (!/^\d{6}$/.test(token)) { setIssue('invalidCodeFormat'); return; }
    const client = createClient();
    if (!client) { setIssue('unavailable'); return; }
    locked.current = true; setBusy('verifying'); setIssue(null);
    try {
      const { data, error } = await client.auth.verifyOtp({ phone: sentPhone, token, type: 'sms' });
      if (error || !data.session) { setIssue(authIssue(error)); return; }
      // A full navigation avoids prefetching before the SSR cookies are written.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign(`${href('/login/success')}${next ? `?next=${encodeURIComponent(next)}` : ''}`);
    } catch { setIssue('network'); }
    finally { locked.current = false; setBusy(null); }
  }
  const error = !configured ? 'unavailable' : issue;
  return <AuthFrame>
    <h1 className="text-2xl font-semibold leading-snug">{sentPhone ? m.codeTitle : m[mode]}</h1>
    {!sentPhone && <AuthMethods mode={mode} active="phone" next={next} disabled={!!busy || !configured} onPendingChange={setGooglePending} />}
    <p className="mt-3 text-muted leading-relaxed">{sentPhone ? <>{m.sentTo} <bdi dir="ltr" className="ltr-nums block text-espresso">{sentPhone}</bdi></> : m.intro}</p>
    <form className="mt-7 flex flex-col gap-4" onSubmit={sentPhone ? verify : (event) => { event.preventDefault(); void send(); }} aria-busy={!!busy}>
      {sentPhone ? <>
        <label htmlFor={codeId} className="text-sm font-semibold">{m.code}</label>
        <Input ref={codeInput} id={codeId} name="code" type="text" dir="ltr" className="ltr-nums text-start text-xl tracking-widest" inputMode="numeric" autoComplete="one-time-code" value={code} maxLength={6} onChange={(e) => { setCode(latinDigits(e.target.value)); setIssue(null); }} disabled={!!busy} aria-invalid={!!issue} aria-describedby={`${hintId} ${errorId}`} />
        <p id={hintId} className="text-sm text-muted">{m.codeHint}</p>
      </> : <>
        <label htmlFor={phoneId} className="text-sm font-semibold">{m.phone}</label>
        <Input id={phoneId} name="phone" type="tel" dir="ltr" className="ltr-nums text-start" inputMode="tel" autoComplete="tel" value={phone} maxLength={32} onChange={(e) => { setPhone(e.target.value); setIssue(null); }} disabled={!!busy || googlePending || !configured} aria-invalid={issue === 'invalidPhone'} aria-describedby={`${hintId} ${errorId}`} />
        <p id={hintId} className="text-sm text-muted">{m.phoneHint}</p>
      </>}
      <p id={errorId} data-auth-error role="alert" className="text-sm text-danger" hidden={!error}>{error ? m[error] : ''}</p>
      <Button type="submit" size="lg" className="w-full" disabled={!!busy || googlePending || !configured || (!sentPhone && remaining > 0)}>{busy ? m[busy] : sentPhone ? m.verify : m.send}</Button>
      {sentPhone && <>
        <Button variant="secondary" size="lg" disabled={!!busy || remaining > 0} onClick={() => void send()}>{remaining ? m.cooldown(remaining) : m.resend}</Button>
        <Button variant="ghost" size="lg" disabled={!!busy} onClick={() => { setSentPhone(''); setCode(''); setIssue(null); setNotice(false); }}>{m.change}</Button>
      </>}
      {!sentPhone && remaining > 0 && <p role="status" className="text-sm text-muted">{m.cooldown(remaining)}</p>}
      <p role="status" className="text-sm text-muted">{notice ? m.resendSent : ''}</p>
    </form>
    {!sentPhone && <>
      <p className="mt-4 text-sm text-muted">{m.accountNote}</p>
      <Link className="mt-3 inline-flex min-h-11 items-center text-sm underline underline-offset-4" href={`${href(mode === 'login' ? '/signup' : '/login')}${next ? `?next=${encodeURIComponent(next)}` : ''}`}>{mode === 'login' ? m.otherSignup : m.otherLogin}</Link>
    </>}
  </AuthFrame>;
}

export function OwnerAuth({ mode }: { mode: 'login' | 'signup' }) {
  const params = useSearchParams();
  return params.get('method') === 'email'
    ? <EmailPasswordAuth key={mode} mode={mode} next={safeReturnPath(params.get('next'))} />
    : <PhoneAuth key={mode} mode={mode} />;
}
