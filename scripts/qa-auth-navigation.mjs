// Local production QA only (account build: NEXT_PUBLIC_NAQAH_ACCOUNT_DATA=1). No authentication requests or account data mutations.
import { chromium, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const base = process.env.BASE ?? 'http://localhost:3108';
const out = process.env.OUT ?? 'artifacts/auth-navigation';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
try {
  for (const locale of ['ar', 'en']) {
    for (const width of [375, 1024, 1440]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
      const page = await context.newPage();
      const next = `?next=${encodeURIComponent(`/${locale}/app`)}`;
      const signupNext = `?next=${encodeURIComponent(`/${locale}/start`)}`;
      // /welcome is retired: it must land on the landing page.
      await page.goto(`${base}/${locale}/welcome`);
      await expect(page).toHaveURL(`${base}/${locale}`);
      await page.goto(`${base}/${locale}`);
      // The hero carries the one primary action (account builds: sign-up with a return to setup).
      const getStarted = page.locator(`main a[href="/${locale}/signup${signupNext}"]:visible`).first();
      await expect(getStarted).toBeVisible();
      expect((await getStarted.boundingBox()).y + 44 <= 900).toBe(true);
      if (width < 1024) await page.locator('header summary').click();
      const login = page.locator(`header a[href="/${locale}/login${next}"]:visible`);
      await expect(login).toBeVisible();
      for (const link of [login, getStarted]) {
        const box = await link.boundingBox();
        expect(box.x >= 0 && box.x + box.width <= width + 1).toBe(true);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `${out}/${locale}-${width}-landing.png`, fullPage: false });
      if (width < 1024) await page.locator('header summary').click();
      await getStarted.click();
      await expect(page).toHaveURL(`${base}/${locale}/signup${signupNext}`);
      await expect(page.locator('input[name="phone"]:visible')).toBeVisible();
      await page.goto(`${base}/login${next}`);
      expect(new URL(page.url()).pathname).toMatch(/^\/(ar|en)\/login$/);
      expect(new URL(page.url()).searchParams.get('next')).toBe(`/${locale}/app`);
      await context.close();
      console.log(`PASS navigation ${locale} ${width}: hero action in first viewport, sign-in link, validated return, layout, retired Welcome, locale negotiation`);
    }
  }
} finally { await browser.close(); }
