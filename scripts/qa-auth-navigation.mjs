// Local production QA only. No authentication requests or account data mutations.
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
      // This suite inspects navigation after the existing first-visit animation.
      await context.addInitScript(() => sessionStorage.setItem('naqah-intro-seen', '1'));
      const page = await context.newPage();
      const next = `?next=${encodeURIComponent(`/${locale}/app`)}`;
      for (const path of ['', '/welcome']) {
        await page.goto(`${base}/${locale}${path}`);
        if (!path && width < 1024) await page.locator('header summary').click();
        const login = page.locator(`header a[href="/${locale}/login${next}"]:visible`);
        const signup = page.locator(`header a[href="/${locale}/signup${next}"]:visible`);
        await expect(login).toBeVisible(); await expect(signup).toBeVisible();
        for (const link of [login, signup]) {
          const box = await link.boundingBox();
          expect(box.x >= 0 && box.x + box.width <= width + 1).toBe(true);
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: `${out}/${locale}-${width}-${path ? 'welcome' : 'landing'}.png`, fullPage: false });
        await signup.click();
        await expect(page).toHaveURL(`${base}/${locale}/signup${next}`);
        await expect(page.locator('input[name="phone"]:visible')).toBeVisible();
      }
      await page.goto(`${base}/${locale}/welcome`);
      await page.locator('main button').click();
      await expect(page).toHaveURL(`${base}/${locale}/start`);
      await page.goto(`${base}/login${next}`);
      expect(new URL(page.url()).pathname).toMatch(/^\/(ar|en)\/login$/);
      expect(new URL(page.url()).searchParams.get('next')).toBe(`/${locale}/app`);
      await context.close();
      console.log(`PASS navigation ${locale} ${width}: visible links, validated return, layout, Welcome/setup, locale negotiation`);
    }
  }
} finally { await browser.close(); }
