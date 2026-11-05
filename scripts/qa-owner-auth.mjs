// Development/QA only: every browser Auth request is intercepted. No real SMS is sent.
// Run against a production build with public Supabase env configured.
// BASE=http://localhost:3000 CHROMIUM_PATH=<optional browser> OUT=<screenshots> node scripts/qa-owner-auth.mjs
import { chromium, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const base = process.env.BASE ?? 'http://localhost:3000';
const out = process.env.OUT ?? 'artifacts/owner-auth';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
try {
  for (const locale of ['ar', 'en']) {
    for (const width of [375, 1440]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await context.newPage();
      await page.clock.install();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      let sends = 0;
      let verifies = 0;
      let sendMode = 'ok';
      let verifyMode = 'otp_expired';
      await page.route('**/auth/v1/**', async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith('/otp')) {
          sends++;
          expect(route.request().postDataJSON()).toMatchObject({ phone: '+966501234567', create_user: true });
          if (sendMode === 'network') return route.abort('internetdisconnected');
          if (sendMode === 'rate') return route.fulfill({ status: 429, json: { code: 'over_sms_send_rate_limit', msg: 'Rate limited' } });
          await new Promise((resolve) => setTimeout(resolve, 250));
          return route.fulfill({ status: 200, json: {} });
        }
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
      await expect(page.locator('input[name="phone"]:visible')).toHaveAttribute('dir', 'ltr');
      await page.locator('input[name="phone"]:visible').fill('123');
      await page.getByRole('button', { name: send, exact: true }).click();
      await expect(page.locator('[data-auth-error]:visible')).toBeVisible();
      expect(sends).toBe(0);
      await page.locator('input[name="phone"]:visible').fill('0501234567');
      await page.screenshot({ path: `${out}/${locale}-${width}-phone.png` });
      await page.getByRole('button', { name: send, exact: true }).click();
      await page.locator('form').evaluate((form) => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
      await expect(page.locator('input[name="code"]:visible')).toBeVisible();
      expect(sends).toBe(1);
      await expect(page.getByText('+966501234567', { exact: true })).toBeVisible();
      await expect(page.locator('input[name="code"]:visible')).toBeFocused();
      await expect(page.locator('input[name="code"]:visible')).toHaveAttribute('dir', 'ltr');
      await expect(page.getByRole('button', { name: /Send again|تقدر تعيد/ })).toBeDisabled();
      await page.locator('input[name="code"]:visible').fill('123456');
      await page.getByRole('button', { name: verify, exact: true }).click();
      // Submitting again while verifying must not produce another request.
      await page.locator('form').evaluate((form) => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
      await expect(page.locator('[data-auth-error]:visible')).toBeVisible();
      expect(verifies).toBe(1);
      await expect(page.locator('[data-auth-error]:visible')).toContainText(ar ? 'انتهت صلاحيته' : 'has expired');
      verifyMode = 'invalid_credentials';
      await page.getByRole('button', { name: verify, exact: true }).click();
      await expect(page.locator('[data-auth-error]:visible')).toBeVisible();
      await expect(page.locator('[data-auth-error]:visible')).toContainText(ar ? 'الرمز غير صحيح' : 'code is incorrect');
      await page.screenshot({ path: `${out}/${locale}-${width}-code-error.png` });
      await page.clock.fastForward(61_000);
      await page.getByRole('button', { name: ar ? 'إرسال رمز جديد' : 'Send a new code', exact: true }).click();
      await expect(page.getByRole('status')).toContainText(ar ? 'أرسلنا لك رمز جديد' : 'A new code has been sent');
      expect(sends).toBe(2);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.getByRole('button', { name: ar ? 'تغيير الرقم' : 'Change number', exact: true }).click();
      await expect(page.locator('input[name="phone"]:visible')).toHaveValue('0501234567');
      await expect(page.getByRole('button', { name: send, exact: true })).toBeDisabled();
      // New navigation resets the local UI cooldown; backend limits still apply.
      await page.goto(`${base}/${locale}/signup`);
      await page.locator('input[name="phone"]:visible').fill('+966501234567');
      sendMode = 'rate';
      await page.getByRole('button', { name: send, exact: true }).click();
      await expect(page.locator('[data-auth-error]:visible')).toContainText(ar ? 'المحاولات كثيرة' : 'Too many attempts');
      await expect(page.getByRole('button', { name: send, exact: true })).toBeDisabled();
      await page.reload();
      await page.locator('input[name="phone"]:visible').fill('0501234567');
      sendMode = 'network';
      await page.getByRole('button', { name: send, exact: true }).click();
      await expect(page.locator('[data-auth-error]:visible')).toContainText(ar ? 'تعذّر الاتصال' : 'Could not connect');
      expect(errors).toEqual([]);
      await context.close();
      console.log(`PASS ${locale} ${width}: validation, OTP errors, duplicate verify, cooldown, change phone, rate limit, network, direction, overflow`);
    }
  }
} finally { await browser.close(); }
