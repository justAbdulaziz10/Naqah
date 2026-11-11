'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Button, Input } from '@/components/ui';
import { useI18n } from '@/i18n/client';
import { cn } from '@/lib/cn';
import { sendOwnerOtp } from '@/app/[locale]/login/actions';
import { createClient } from '@/lib/supabase/client';
import { authIssue, latinDigits, normalizeSaudiPhone, type AuthIssue } from '@/lib/supabase/auth-input';
import { getCaptchaSiteKey, getSupabaseConfig } from '@/lib/supabase/config';
import { authDestination } from '@/lib/supabase/auth-paths';
import { AuthClosed, AuthFrame, AuthHeading, AuthSwitch } from './AuthFrame';
import { CaptchaField } from './CaptchaField';
import { AuthMethods } from './AuthMethods';
import { AuthOptions, chooseMethod } from './auth-options';
import type { AuthMethodsAvailable } from '@/lib/supabase/auth-methods';
import { EmailPasswordAuth } from './EmailPasswordAuth';

const COOLDOWN_MS = 60_000;
const PENDING_KEY = 'naqah-owner-otp';
const PENDING_MS = 10 * 60_000;

/** Keeps the code step across a language switch or reload, which remount this form. */
function readPending(): { phone: string; sentAt: number } | null {
  try {
    const saved = JSON.parse(sessionStorage.getItem(PENDING_KEY) ?? 'null');
    const fresh = typeof saved?.phone === 'string' && typeof saved?.sentAt === 'number' && Date.now() - saved.sentAt < PENDING_MS;
    return fresh ? saved : null;
  } catch { return null; }
}
function writePending(phone: string | null) {
  try {
    if (phone) sessionStorage.setItem(PENDING_KEY, JSON.stringify({ phone, sentAt: Date.now() }));
    else sessionStorage.removeItem(PENDING_KEY);
  } catch { /* Private browsing: the code step just won't survive a reload. */ }
}


function PhoneAuth({ mode, next }: { mode: 'login' | 'signup'; next: string | null }) {
  const { locale, href, m: { auth: m } } = useI18n();
  const id = useId();
  const phoneId = `${id}-phone`;
  const codeId = `${id}-code`;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const configured = !!getSupabaseConfig();
  const captchaKey = getCaptchaSiteKey();
  const [phone, setPhone] = useState('');
  const [sentPhone, setSentPhone] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'sending' | 'verifying' | null>(null);
  const [issue, setIssue] = useState<AuthIssue | 'invalidPhone' | 'invalidCodeFormat' | null>(null);
  const [captchaToken, setCaptchaToken] = useState('');
  const [captchaReset, setCaptchaReset] = useState(0);
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
  // A field-level problem sends focus back to that field once it is enabled again.
  useEffect(() => {
    if (busy || !issue) return;
    if (issue === 'invalidPhone') document.getElementById(phoneId)?.focus();
    else if (issue === 'invalidCodeFormat' || issue === 'invalidCode') codeInput.current?.focus();
  }, [issue, busy, phoneId]);
  useEffect(() => {
    const pending = readPending();
    if (!pending) return;
    until.current = pending.sentAt + COOLDOWN_MS;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sessionStorage is unavailable during prerender.
    setPhone(pending.phone.replace(/^\+966/, '')); setSentPhone(pending.phone);
  }, []);

  function cooldown() { until.current = Date.now() + COOLDOWN_MS; setRemaining(COOLDOWN_MS / 1000); }
  async function send() {
    if (locked.current || googlePending || Date.now() < until.current) return;
    const normalized = normalizeSaudiPhone(phone);
    if (!normalized) { setIssue('invalidPhone'); return; }
    if (captchaKey && !captchaToken) { setIssue('captcha'); return; }
    locked.current = true; setBusy('sending'); setIssue(null); setNotice(false);
    try {
      const { issue: failure } = await sendOwnerOtp({ phone: normalized, captchaToken: captchaToken || undefined });
      if (failure) {
        setIssue(failure);
        if (failure === 'rateLimit') cooldown();
      } else {
        setNotice(!!sentPhone); setSentPhone(normalized); setCode(''); cooldown(); writePending(normalized);
      }
    } catch { setIssue('network'); }
    finally {
      locked.current = false; setBusy(null);
      if (captchaKey) { setCaptchaToken(''); setCaptchaReset((count) => count + 1); }
    }
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
      writePending(null);
      // A full navigation avoids prefetching before the SSR cookies are written.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign(`${href('/login/success')}${next ? `?next=${encodeURIComponent(next)}` : ''}`);
    } catch { setIssue('network'); }
    finally { locked.current = false; setBusy(null); }
  }
  const error = !configured ? 'unavailable' : issue;
  const form = (
    <form className="mt-7 flex flex-col gap-5" onSubmit={sentPhone ? verify : (event) => { event.preventDefault(); void send(); }} aria-busy={!!busy}>
      {sentPhone ? <div className="flex flex-col gap-2">
        <label htmlFor={codeId} className="text-sm font-semibold">{m.code}</label>
        <Input ref={codeInput} id={codeId} name="code" type="text" dir="ltr" className="ltr-nums text-start text-xl tracking-widest" inputMode="numeric" autoComplete="one-time-code" value={code} maxLength={6} onChange={(e) => { setCode(latinDigits(e.target.value)); setIssue(null); }} disabled={!!busy} aria-invalid={!!issue} aria-describedby={`${hintId} ${errorId}`} />
        <p id={hintId} className="text-sm text-muted">{m.codeHint}</p>
      </div> : <div className="flex flex-col gap-2">
        <label htmlFor={phoneId} className="text-sm font-semibold">{m.phone}</label>
        <div dir="ltr" className={cn('flex h-12 w-full items-stretch overflow-hidden rounded-xl border bg-cream/70 transition focus-within:border-brown focus-within:bg-cream focus-within:ring-4 focus-within:ring-brown/15',
          issue === 'invalidPhone' ? 'border-danger' : 'border-stone', (!!busy || googlePending || !configured) && 'opacity-60')}>
          <span className="ltr-nums flex items-center border-e border-stone bg-ivory px-3.5 font-medium text-muted">
            <span className="sr-only">{m.phoneCountry}</span><span aria-hidden>+966</span>
          </span>
          <input id={phoneId} name="phone" type="tel" dir="ltr" className="ltr-nums min-w-0 flex-1 bg-transparent px-3.5 text-start text-[0.95rem] tracking-wide text-espresso placeholder:text-muted/70 focus:outline-none" inputMode="tel" autoComplete="tel-national" placeholder={m.phonePlaceholder} value={phone} maxLength={32} onChange={(e) => { setPhone(e.target.value); setIssue(null); }} disabled={!!busy || googlePending || !configured} aria-invalid={issue === 'invalidPhone'} aria-describedby={`${hintId} ${errorId}`} />
        </div>
        <p id={hintId} className="text-sm text-muted">{m.phoneHint}</p>
      </div>}
      {captchaKey && configured && <CaptchaField siteKey={captchaKey} resetKey={captchaReset} onToken={setCaptchaToken} onFailed={() => setIssue('captcha')} />}
      <p id={errorId} data-auth-error role="alert" className="-mt-1 text-sm leading-relaxed text-danger" hidden={!error}>{error ? m[error] : ''}</p>
      <Button type="submit" size="lg" className="naqah-press w-full shadow-none!" disabled={!!busy || googlePending || !configured || (!sentPhone && (remaining > 0 || (!!captchaKey && !captchaToken)))}>{busy ? m[busy] : sentPhone ? m.verify : m.send}</Button>
      {sentPhone && <div className="-mt-1 flex flex-col gap-2">
        <Button variant="secondary" size="lg" className="w-full" disabled={!!busy || remaining > 0 || (!!captchaKey && !captchaToken)} onClick={() => void send()}>{remaining ? <span className="ltr-nums">{m.cooldown(remaining)}</span> : m.resend}</Button>
        <Button variant="ghost" size="lg" className="w-full" disabled={!!busy} onClick={() => { setSentPhone(''); setCode(''); setIssue(null); setNotice(false); writePending(null); }}>{m.change}</Button>
      </div>}
      {!sentPhone && remaining > 0 && <p role="status" className="ltr-nums text-sm text-muted">{m.cooldown(remaining)}</p>}
      <p role="status" className={notice ? 'text-sm text-muted' : 'sr-only'}>{notice ? m.resendSent : ''}</p>
    </form>
  );
  return <AuthFrame>
    {sentPhone ? <>
      <AuthHeading title={m.codeTitle} lead={<>{m.sentTo} <bdi dir="ltr" className="ltr-nums text-espresso">{sentPhone}</bdi></>} />
      {form}
    </> : <>
      <AuthHeading title={m[mode]} lead={mode === 'signup' ? m.signupLead : m.loginLead} />
      <AuthMethods mode={mode} active="phone" next={next} disabled={!!busy || !configured} onPendingChange={setGooglePending}>{form}</AuthMethods>
      <AuthSwitch href={`${href(mode === 'login' ? '/signup' : '/login')}?next=${encodeURIComponent(`/${locale}/${mode === 'login' ? 'start' : 'app'}`)}`}>{mode === 'login' ? m.otherSignup : m.otherLogin}</AuthSwitch>
    </>}
  </AuthFrame>;
}

export function OwnerAuth({ mode, methods }: { mode: 'login' | 'signup'; methods: AuthMethodsAvailable }) {
  const params = useSearchParams();
  const { locale } = useI18n();
  const next = authDestination(locale, mode, params.get('next'));
  if (!getSupabaseConfig()) return <AuthClosed mode={mode} />;
  return <AuthOptions.Provider value={methods}>
    {chooseMethod(params.get('method'), methods) === 'email'
      ? <EmailPasswordAuth key={mode} mode={mode} next={next} />
      : <PhoneAuth key={mode} mode={mode} next={next} />}
  </AuthOptions.Provider>;
}
