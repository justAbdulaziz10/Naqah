// Development/QA only: no request reaches Supabase and no real SMS is sent.
// Browser Auth requests are intercepted. The Server Action sends codes to the local stub below,
// so the build under test must point at it, never at a real project:
// NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54399 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=placeholder-not-a-key npm run build
// BASE=http://localhost:3000 CHROMIUM_PATH=<optional browser> OUT=<screenshots> node scripts/qa-owner-auth.mjs
import { chromium, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
const base = process.env.BASE ?? 'http://localhost:3000';
const out = process.env.OUT ?? 'artifacts/owner-auth';
mkdirSync(out, { recursive: true });
let sends = 0;
let sendMode = 'ok';
let expectedPhone = '';
const stub = createServer((request, response) => {
  let body = '';
  request.on('data', (chunk) => { body += chunk; });
  request.on('end', async () => {
    const reply = (status, json) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(json)); };
    if (!request.url.endsWith('/auth/v1/otp')) return reply(404, {});
    sends++;
    expect(JSON.parse(body)).toMatchObject({ phone: expectedPhone, create_user: true });
    if (sendMode === 'network') return response.destroy();
    if (sendMode === 'rate') return reply(429, { error_code: 'over_sms_send_rate_limit', msg: 'Rate limited' });
    await new Promise((resolve) => setTimeout(resolve, 250));
    return reply(200, {});
  });
});
await new Promise((resolve) => stub.listen(54399, '127.0.0.1', resolve));
let run = 0;
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
try {
  for (const locale of ['ar', 'en']) {
    for (const width of [375, 1440]) {
      // Each run acts as a new visitor with new numbers, so the app's own OTP limit stays out of the way.
      run++;
      const context = await browser.newContext({ viewport: { width, height: 900 }, extraHTTPHeaders: { 'x-forwarded-for': `203.0.113.${run}` } });
      const local = `05012345${60 + run}`;
      const international = `+9665012345${60 + run}`;
      const otherLocal = `05012345${70 + run}`;
      sends = 0;
      sendMode = 'ok';
      expectedPhone = international;
      const page = await context.newPage();
      await page.clock.install();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      let verifies = 0;
      let verifyMode = 'otp_expired';
      await page.route('**/auth/v1/**', async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith('/verify')) {
          verifies++;
          await new Promise((resolve) => setTimeout(resolve, 250));
          return route.fulfill({ status: 403, json: { error_code: verifyMode, msg: 'Invalid code' } });
        }
        return route.fulfill({ status: 401, json: { code: 'session_not_found', msg: 'Test only: unauthenticated' } });
      });
      const ar = locale === 'ar';
      const send = ar ? 'إرسال الرمز' : 'Send code';
      const verify = ar ? 'تحقق وتابع' : 'Verify and continue';
      await page.goto(`${base}/${locale}/login`);
      await expect(page.locator('html')).toHaveAttribute('dir', ar ? 'rtl' : 'ltr');
      await expect(page.locator('#owner-phone')).toHaveAttribute('dir', 'ltr');
      await page.locator('#owner-phone').fill('123');
      await page.getByRole('button', { name: send, exact: true }).click();
      await expect(page.locator('#auth-error')).toBeVisible();
      expect(sends).toBe(0);
      await page.locator('#owner-phone').fill(local);
      await page.screenshot({ path: `${out}/${locale}-${width}-phone.png` });
      await page.getByRole('button', { name: send, exact: true }).click();
      await page.locator('form').evaluate((form) => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
      await expect(page.locator('#owner-code')).toBeVisible();
      expect(sends).toBe(1);
      await expect(page.getByText(international, { exact: true })).toBeVisible();
      await expect(page.locator('#owner-code')).toBeFocused();
      await expect(page.locator('#owner-code')).toHaveAttribute('dir', 'ltr');
      await expect(page.getByRole('button', { name: /Send again|تقدر تعيد/ })).toBeDisabled();
      await page.locator('#owner-code').fill('123456');
      await page.getByRole('button', { name: verify, exact: true }).click();
      // Submitting again while verifying must not produce another request.
      await page.locator('form').evaluate((form) => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
      await expect(page.locator('#auth-error')).toBeVisible();
      expect(verifies).toBe(1);
      await expect(page.locator('#auth-error')).toContainText(ar ? 'انتهت صلاحيته' : 'has expired');
      verifyMode = 'invalid_credentials';
      await page.getByRole('button', { name: verify, exact: true }).click();
      await expect(page.locator('#auth-error')).toBeVisible();
      await expect(page.locator('#auth-error')).toContainText(ar ? 'الرمز غير صحيح' : 'code is incorrect');
      await page.screenshot({ path: `${out}/${locale}-${width}-code-error.png` });
      await page.clock.fastForward(61_000);
      await page.getByRole('button', { name: ar ? 'إرسال رمز جديد' : 'Send a new code', exact: true }).click();
      await expect(page.getByRole('status')).toContainText(ar ? 'أرسلنا لك رمز جديد' : 'A new code has been sent');
      expect(sends).toBe(2);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.getByRole('button', { name: ar ? 'تغيير الرقم' : 'Change number', exact: true }).click();
      await expect(page.locator('#owner-phone')).toHaveValue(local);
      await expect(page.getByRole('button', { name: send, exact: true })).toBeDisabled();
      // New navigation resets the local UI cooldown; backend limits still apply.
      await page.goto(`${base}/${locale}/signup`);
      await page.locator('#owner-phone').fill(otherLocal);
      expectedPhone = `+9665012345${70 + run}`;
      sendMode = 'rate';
      await page.getByRole('button', { name: send, exact: true }).click();
      await expect(page.locator('#auth-error')).toContainText(ar ? 'المحاولات كثيرة' : 'Too many attempts');
      await expect(page.getByRole('button', { name: send, exact: true })).toBeDisabled();
      await page.reload();
      await page.locator('#owner-phone').fill(otherLocal);
      sendMode = 'network';
      await page.getByRole('button', { name: send, exact: true }).click();
      await expect(page.locator('#auth-error')).toContainText(ar ? 'تعذّر الاتصال' : 'Could not connect');
      expect(errors).toEqual([]);
      await context.close();
      console.log(`PASS ${locale} ${width}: validation, OTP errors, duplicate verify, cooldown, change phone, rate limit, network, direction, overflow`);
    }
  }
} finally { await browser.close(); stub.close(); }
