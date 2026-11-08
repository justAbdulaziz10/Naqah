// TEST ONLY. Run against next start with the explicit auth-qa-fixture preload.
// Every browser Auth request is intercepted. No real provider/email/SMS test occurs.
import { chromium, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { fixtureSession, fixtureUser } from './auth-qa-fixture.mjs';
const base = process.env.BASE ?? 'http://localhost:3108';
const out = process.env.OUT ?? 'artifacts/auth-methods';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
try {
  for (const locale of ['ar', 'en']) {
    for (const width of [375, 1440]) {
      const ar = locale === 'ar';
      // A fresh fixture-only number per visitor preserves main's real per-number send limit.
      const phone = `05${String(Math.floor(Math.random() * 100_000_000)).padStart(8, '0')}`;
      const context = await browser.newContext({ viewport: { width, height: 1000 }, serviceWorkers: 'block' });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      let mode = 'invalid';
      let signupCallback;
      let googleCallback;
      let signups = 0;
      let logins = 0;
      await page.route('**/auth/v1/**', async (route) => {
        const url = new URL(route.request().url());
        const fulfill = (body, status = 200) => route.fulfill({ status, json: body, headers: { 'x-supabase-api-version': '2024-01-01', 'access-control-expose-headers': 'X-Supabase-Api-Version' } });
        if (url.pathname.endsWith('/authorize')) {
          googleCallback = url.searchParams.get('redirect_to');
          expect(url.searchParams.get('provider')).toBe('google');
          expect(url.searchParams.get('code_challenge')).toBeTruthy();
          return route.fulfill({ status: 200, contentType: 'text/html', body: '<p>Mock provider only</p>' });
        }
        if (url.pathname.endsWith('/signup')) {
          signups++;
          signupCallback = url.searchParams.get('redirect_to');
          await new Promise((resolve) => setTimeout(resolve, 200));
          if (mode === 'duplicate') return fulfill({ code: 'user_already_exists', msg: 'Private backend detail' }, 422);
          if (mode === 'weak') return fulfill({ code: 'weak_password', msg: 'Private policy detail' }, 422);
          if (mode === 'instant') return fulfill(fixtureSession(url.origin));
          return fulfill({ user: fixtureUser(), session: null });
        }
        if (url.pathname.endsWith('/token')) {
          logins++;
          await new Promise((resolve) => setTimeout(resolve, 200));
          if (mode === 'unconfirmed') return fulfill({ code: 'email_not_confirmed', msg: 'Private backend detail' }, 400);
          if (mode === 'invalid') return fulfill({ code: 'invalid_credentials', msg: 'Private backend detail' }, 400);
          if (mode === 'rate') return fulfill({ code: 'over_request_rate_limit', msg: 'Private backend detail' }, 429);
          if (mode === 'network') return route.abort('internetdisconnected');
          return fulfill(fixtureSession(url.origin));
        }
        if (url.pathname.endsWith('/verify')) return fulfill(fixtureSession(url.origin));
        if (url.pathname.endsWith('/otp')) return fulfill({});
        if (url.pathname.endsWith('/user')) return fulfill(fixtureUser());
        if (url.pathname.endsWith('/logout')) return route.fulfill({ status: 204 });
        return fulfill({ code: 'invalid_credentials' }, 401);
      });
      const emailPath = `${base}/${locale}/login?method=email`;
      const fill = async () => {
        await page.locator('input[name="email"]:visible').fill('owner@example.test');
        await page.locator('input[name="password"]:visible').fill('mock-only-password');
      };
      const submit = async (signup = false) => page.getByRole('button', { name: signup ? (ar ? 'إنشاء الحساب' : 'Create account') : (ar ? 'تسجيل الدخول' : 'Log in'), exact: true }).click();
      const signedIn = async () => expect(page.getByRole('heading', { name: ar ? 'تم تسجيل دخولك' : 'You are signed in', exact: true })).toBeVisible();
      const logout = async () => {
        await page.getByRole('button', { name: ar ? 'تسجيل الخروج' : 'Log out', exact: true }).click();
        await expect(page).toHaveURL(`${base}/${locale}/login`);
        expect((await context.cookies()).some((cookie) => /-auth-token(?:\.\d+)?$/.test(cookie.name))).toBe(false);
        await page.goto(`${base}/${locale}/login/success`);
        await expect(page).toHaveURL(`${base}/${locale}/login`);
      };
      await page.goto(emailPath);
      await expect(page.locator('html')).toHaveAttribute('dir', ar ? 'rtl' : 'ltr');
      await expect(page.locator('input[name="email"]:visible')).toHaveAttribute('dir', 'ltr');
      await expect(page.locator('input[name="password"]:visible')).toHaveAttribute('autocomplete', 'current-password');
      await fill();
      await page.screenshot({ path: `${out}/${locale}-${width}-email.png` });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await submit();
      await page.locator('form').evaluate((form) => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
      await expect(page.locator('[data-email-error]:visible')).toContainText(ar ? 'تأكد من البريد' : 'Check your email and password');
      expect(logins).toBe(1);
      for (const [state, text] of [
        ['unconfirmed', ar ? 'أكّد بريدك' : 'Confirm your email'],
        ['rate', ar ? 'المحاولات كثيرة' : 'Too many attempts'],
        ['network', ar ? 'تعذّر الاتصال' : 'Could not connect'],
      ]) {
        mode = state; await submit(); await expect(page.locator('[data-email-error]:visible')).toContainText(text);
      }
      mode = 'ok';
      await submit(); await expect(page).toHaveURL(`${base}/${locale}/app`);
      await page.goto(`${base}/${locale}/login/success`); await signedIn();
      await page.reload(); await signedIn();
      // Force the stored session expiry to exercise SSR refresh through the real SDK adapters.
      const sessionCookie = (await context.cookies()).find((cookie) => /-auth-token$/.test(cookie.name));
      expect(!!sessionCookie).toBe(true);
      const stored = JSON.parse(Buffer.from(sessionCookie.value.slice('base64-'.length), 'base64url').toString());
      stored.expires_at = 1;
      await context.addCookies([{ ...sessionCookie, value: `base64-${Buffer.from(JSON.stringify(stored)).toString('base64url')}` }]);
      await page.reload(); await signedIn();
      await logout();
      await page.goto(`${base}/${locale}/signup?method=email&next=${encodeURIComponent(`/${locale}/login/callback`)}`);
      await fill(); mode = 'weak'; await submit(true);
      await expect(page.locator('[data-email-error]:visible')).toContainText(ar ? 'أطول وأقوى' : 'longer, stronger');
      mode = 'confirm'; const previousSignups = signups;
      await submit(true);
      await page.locator('form').evaluate((form) => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
      await expect(page.getByRole('heading', { name: ar ? 'تابع حسابك' : 'Continue with your account', exact: true })).toBeVisible();
      expect(signups).toBe(previousSignups + 1);
      expect(new URL(signupCallback).searchParams.get('next')).toBe(`/${locale}/start`);
      await page.screenshot({ path: `${out}/${locale}-${width}-confirmation.png` });
      // Reproduce a Site URL fallback: the provider returns a code to Login and drops next/method.
      await page.goto(`${base}/${locale}/login?code=qa-email-code`); await expect(page).toHaveURL(`${base}/${locale}/start`);
      expect((await context.cookies()).some(cookie => cookie.name === 'naqah-auth-return')).toBe(false);
      await page.goto(`${base}/${locale}/login/success`); await signedIn(); await logout();
      await page.goto(`${base}/${locale}/signup?method=email`); await fill(); mode = 'duplicate'; await submit(true);
      await expect(page.locator('[data-email-error]:visible')).toHaveText(ar ? 'هذا البريد مسجّل مسبقًا، سجّل دخولك.' : 'This email is already registered. Log in instead.');
      await expect(page.getByRole('heading', { name: ar ? 'إنشاء حسابك' : 'Create your account', exact: true })).toBeVisible();
      await expect(page.locator('input[name="email"]:visible')).toHaveAttribute('aria-invalid', 'true');
      await expect(page.getByRole('link', { name: ar ? 'عندك حساب؟ سجّل دخولك' : 'Already have an account? Log in', exact: true })).toHaveAttribute('href', `/${locale}/login?method=email&next=%2F${locale}%2Fapp`);
      await page.goto(`${base}/${locale}/signup?method=email`); await fill(); mode = 'instant'; await submit(true); await expect(page).toHaveURL(`${base}/${locale}/start`);
      await page.goto(`${base}/${locale}/login/success`); await signedIn(); await logout();
      // Google start writes a PKCE verifier; server callback must exchange using that cookie.
      await page.goto(`${emailPath}&next=${encodeURIComponent(`/${locale}/app`)}`);
      await page.getByRole('button', { name: ar ? 'المتابعة مع Google' : 'Continue with Google', exact: true }).click();
      await expect(page.getByText('Mock provider only')).toBeVisible();
      expect(new URL(googleCallback).pathname).toBe(`/${locale}/login/callback`);
      expect(new URL(googleCallback).searchParams.get('next')).toBe(`/${locale}/app`);
      const google = new URL(googleCallback); google.searchParams.set('code', 'qa-google-code');
      await page.goto(google.toString());
      await expect(page).toHaveURL(`${base}/${locale}/app`);
      await page.goto(`${base}/${locale}/login/success`); await signedIn(); await logout();
      await page.goto(`${base}/${locale}/signup?method=email`);
      await page.getByRole('button', { name: ar ? 'المتابعة مع Google' : 'Continue with Google', exact: true }).click();
      await expect(page.getByText('Mock provider only')).toBeVisible();
      expect(new URL(googleCallback).searchParams.get('next')).toBe(`/${locale}/start`);
      await page.goto(`${base}/${locale}/login?code=qa-google-code`); await expect(page).toHaveURL(`${base}/${locale}/start`);
      await page.goto(`${base}/${locale}/login/success`); await signedIn(); await logout();
      // Phone still produces the same SSR session and success behavior.
      await page.locator('input[name="phone"]:visible').fill(phone);
      await page.getByRole('button', { name: ar ? 'إرسال الرمز' : 'Send code', exact: true }).click();
      await expect(page.locator('input[name="code"]:visible')).toBeVisible();
      await page.reload();
      await expect(page.locator('input[name="code"]:visible')).toBeVisible();
      await expect(page.getByRole('button', { name: /Send again|تقدر تعيد/ })).toBeDisabled();
      await page.locator('header a[lang]').click();
      await expect(page).toHaveURL(`${base}/${ar ? 'en' : 'ar'}/login`);
      await expect(page.locator('html')).toHaveAttribute('lang', ar ? 'en' : 'ar');
      await expect(page.locator('input[name="code"]:visible')).toBeVisible();
      await page.locator('header a[lang]:visible').click();
      await expect(page).toHaveURL(`${base}/${locale}/login`);
      await expect(page.locator('html')).toHaveAttribute('lang', locale);
      await expect(page.locator('input[name="code"]:visible')).toBeVisible();
      await page.locator('input[name="code"]:visible').fill('123456');
      await expect(page.locator('input[name="code"]:visible')).toHaveValue('123456');
      await page.getByRole('button', { name: ar ? 'تحقق وتابع' : 'Verify and continue', exact: true }).click();
      await expect(page).toHaveURL(`${base}/${locale}/app`);
      await page.goto(`${base}/${locale}/login/success`); await signedIn(); await logout();
      await page.goto(`${base}/${locale}/signup`);
      await page.locator('input[name="phone"]:visible').fill(phone);
      await page.getByRole('button', { name: ar ? 'إرسال الرمز' : 'Send code', exact: true }).click();
      await page.locator('input[name="code"]:visible').fill('123456');
      await page.getByRole('button', { name: ar ? 'تحقق وتابع' : 'Verify and continue', exact: true }).click();
      await expect(page).toHaveURL(`${base}/${locale}/start`);
      await page.goto(`${base}/${locale}/login/success`); await signedIn(); await logout();
      await page.goto(`${base}/${locale}/login/callback?error=access_denied&error_description=PRIVATE&next=https://evil.test`);
      await expect(page).toHaveURL(`${base}/${locale}/login?error=callbackFailed`);
      await expect(page.getByRole('alert').first()).not.toContainText('PRIVATE');
      await page.goto(`${emailPath}&next=${encodeURIComponent(`/${locale}/app`)}`);
      await page.locator('header a[lang]').click();
      await expect(page.locator('input[name="email"]:visible')).toBeVisible();
      await expect(page.getByRole('textbox', { name: ar ? 'Email address' : 'البريد الإلكتروني', exact: true })).toBeVisible();
      expect(new URL(page.url()).searchParams.get('method')).toBe('email');
      expect(new URL(page.url()).searchParams.get('next')).toBe(`/${ar ? 'en' : 'ar'}/app`);
      expect(errors).toEqual([]);
      await context.close();
      console.log(`PASS MOCK ONLY ${locale} ${width}: email states, PKCE email/Google cookies, phone success, reload, refresh, logout, callback errors, layout`);
    }
  }
} finally { await browser.close(); }
