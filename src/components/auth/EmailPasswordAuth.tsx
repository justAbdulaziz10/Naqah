'use client';

import { Eye, EyeSlash } from '@phosphor-icons/react';
import Link from 'next/link';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Button, Input } from '@/components/ui';
import { DEMO_AUTOFILL, DemoFillButton } from '@/components/demo/DemoFill';
import { useI18n } from '@/i18n/client';
import { auth } from '@/i18n/messages/auth';
import { createClient } from '@/lib/supabase/client';
import { getCaptchaSiteKey, getSupabaseConfig } from '@/lib/supabase/config';
import { callbackUrl, successPath } from '@/lib/supabase/auth-paths';
import { authenticateEmail, type EmailIssue } from '@/lib/supabase/email-auth';
import { rememberAuthReturn } from '@/lib/supabase/return-context';
import { AuthFrame, AuthHeading, AuthSwitch } from './AuthFrame';
import { AuthMethods } from './AuthMethods';
import { CaptchaField } from './CaptchaField';

const MIN_PASSWORD = 8;

export function EmailPasswordAuth({ mode, next }: { mode: 'login' | 'signup'; next: string | null }) {
  const { locale, href, m: messages } = useI18n();
  const m = auth[locale];
  const id = useId();
  const emailId = `${id}-email`;
  const passwordId = `${id}-password`;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const configured = !!getSupabaseConfig();
  const captchaKey = getCaptchaSiteKey();
  const [captchaToken, setCaptchaToken] = useState('');
  const [captchaReset, setCaptchaReset] = useState(0);
  const [email, setEmail] = useState('');
  const [sampleOwner, setSampleOwner] = useState('');
  const [sampleFilled, setSampleFilled] = useState(false);
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [pending, setPending] = useState(false);
  const [googlePending, setGooglePending] = useState(false);
  const [confirmation, setConfirmation] = useState(false);
  const [issue, setIssue] = useState<EmailIssue | 'shortPassword' | null>(null);
  const locked = useRef(false);
  const submitRef = useRef<HTMLButtonElement>(null);
  // After a failed submit, focus moves to what needs fixing: the password for password problems,
  // otherwise the error itself (it can hold the "Log in instead" link). Inputs re-enable first.
  const [focusIssue, setFocusIssue] = useState(0);
  useEffect(() => {
    if (!focusIssue || pending || !issue) return;
    const target = issue === 'shortPassword' || issue === 'weakPassword' || issue === 'credentials' ? passwordId : errorId;
    document.getElementById(target)?.focus();
  }, [focusIssue, pending, issue, passwordId, errorId]);
  const fail = (next: EmailIssue | 'shortPassword') => { setIssue(next); setFocusIssue((count) => count + 1); };
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (locked.current || googlePending) return;
    // A clear length hint up front; Supabase still enforces its own password policy.
    if (mode === 'signup' && password.length < MIN_PASSWORD) { fail('shortPassword'); return; }
    if (captchaKey && !captchaToken) { fail('captcha'); return; }
    const client = createClient();
    if (!client) { fail('unavailable'); return; }
    locked.current = true; setPending(true); setIssue(null);
    rememberAuthReturn(next);
    const result = await authenticateEmail(client, mode, email, password, callbackUrl(window.location.origin, locale, next, 'email'), captchaToken || undefined);
    if (captchaKey) { setCaptchaToken(''); setCaptchaReset((count) => count + 1); }
    if ('status' in result) {
      setPassword('');
      if (result.status === 'signedIn') {
        // A full navigation sends the newly written SSR session cookies.
        window.location.assign(successPath(locale, next));
        return;
      }
      setConfirmation(true);
    } else { fail(result.issue); }
    locked.current = false; setPending(false);
  }
  const query = new URLSearchParams({ method: 'email', next: `/${locale}/app` });
  const alternateQuery = new URLSearchParams(query);
  alternateQuery.set('next', `/${locale}/${mode === 'login' ? 'start' : 'app'}`);
  const error = !configured ? 'unavailable' : issue;
  const busy = pending || googlePending || !configured;
  const passwordIssue = issue === 'credentials' || issue === 'weakPassword' || issue === 'shortPassword';
  // The length error repeats the hint, so the hint steps aside while it shows.
  const showHint = mode === 'signup' && issue !== 'shortPassword' && issue !== 'weakPassword';
  return <AuthFrame>
    {confirmation ? <>
      <AuthHeading title={m.confirmTitle} />
      <p role="status" className="mt-4 leading-relaxed text-muted">{m.confirmBody}</p>
      <Link className="mt-5 inline-flex min-h-11 items-center font-medium underline underline-offset-4" href={`${href('/login')}?${query}`}>{m.otherLogin}</Link>
    </> : <>
      <AuthHeading title={m[mode]} lead={mode === 'signup' ? m.signupLead : m.loginLead} />
      <DemoFillButton className="mt-4" onFill={() => {
        if (busy) return;
        setEmail(mode === 'login' ? 'demo@naqah.demo' : 'owner+demo@naqah.demo');
        setPassword(mode === 'login' ? 'naqah-demo-2026' : 'Naqah-Sample-2026!Owner');
        if (mode === 'signup') setSampleOwner('فهد العتيبي');
        setSampleFilled(true);
        submitRef.current?.focus();
      }} />
      <span role="status" className="sr-only">{sampleFilled ? `${messages.common.demo.label} · ${email}` : ''}</span>
      <AuthMethods mode={mode} active="email" next={next} disabled={pending || !configured} onPendingChange={setGooglePending}>
      <form onSubmit={(event) => void submit(event)} className="mt-7 flex flex-col gap-5" aria-busy={pending || googlePending}>
        {DEMO_AUTOFILL && mode === 'signup' ? <div className="flex flex-col gap-2">
          <label htmlFor={`${id}-sample-owner`} className="text-sm font-semibold">{messages.setup.ranch.ownerName} · {messages.common.demo.label}</label>
          <Input id={`${id}-sample-owner`} dir="auto" value={sampleOwner} readOnly />
        </div> : null}
        <div className="flex flex-col gap-2">
          <label htmlFor={emailId} className="text-sm font-semibold">{m.email}</label>
          <Input id={emailId} name="email" type="email" dir="ltr" className="text-start" autoComplete="email" inputMode="email" autoCapitalize="none" spellCheck={false} required value={email} onChange={(event) => { setEmail(event.target.value); setIssue(null); }} disabled={busy} aria-invalid={issue === 'credentials' || issue === 'accountExists'} aria-describedby={errorId} />
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor={passwordId} className="text-sm font-semibold">{m.password}</label>
          {/* The field is left-to-right in both languages, so the toggle sits at its right edge in both. */}
          <div dir="ltr" className="relative">
            <Input id={passwordId} name="password" type={visible ? 'text' : 'password'} dir="ltr" className="pe-14 text-start" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} required value={password} onChange={(event) => { setPassword(event.target.value); setIssue(null); }} disabled={busy} aria-invalid={passwordIssue} aria-describedby={showHint ? `${hintId} ${errorId}` : errorId} />
            <button type="button" aria-controls={passwordId} aria-pressed={visible} disabled={pending || googlePending} onClick={() => setVisible(!visible)}
              className="absolute end-0.5 top-1/2 inline-flex size-11 -translate-y-1/2 items-center justify-center rounded-lg text-muted transition-colors hover:text-espresso focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-brown disabled:opacity-45">
              {visible ? <EyeSlash size={20} aria-hidden /> : <Eye size={20} aria-hidden />}
              <span className="sr-only">{visible ? m.hidePassword : m.showPassword}</span>
            </button>
          </div>
          {showHint ? <p id={hintId} className="text-sm text-muted">{m.passwordHint}</p> : null}
        </div>
        <div id={errorId} data-email-error role="alert" tabIndex={-1} className="-mt-1 text-sm leading-relaxed text-danger focus:outline-none" hidden={!error}>
          {error ? m[error] : ''}
          {error === 'accountExists' ? <Link className="flex min-h-11 w-fit items-center font-semibold text-espresso underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brown" href={`${href('/login')}?${query}`}>{m.accountExistsAction}</Link> : null}
        </div>
        {captchaKey && configured && <CaptchaField siteKey={captchaKey} resetKey={captchaReset} onToken={setCaptchaToken} onFailed={() => setIssue('captcha')} />}
        <Button ref={submitRef} type="submit" size="lg" className="naqah-press w-full shadow-none!" disabled={busy || (!!captchaKey && !captchaToken)}>{pending ? m.emailPending : mode === 'signup' ? m.emailSignup : m.emailLogin}</Button>
      </form>
      </AuthMethods>
      <AuthSwitch href={`${href(mode === 'login' ? '/signup' : '/login')}?${alternateQuery}`}>{mode === 'login' ? m.otherSignup : m.otherLogin}</AuthSwitch>
    </>}
  </AuthFrame>;
}
