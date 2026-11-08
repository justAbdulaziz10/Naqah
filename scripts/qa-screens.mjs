// Visual QA: screenshots every page at mobile + desktop in ar/en and flags horizontal overflow.
// Usage: BASE=http://localhost:3000 OUT=/tmp/naqah-shots node scripts/qa-screens.mjs [page-filter]
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const OUT = process.env.OUT ?? "/tmp/naqah-shots";
const filter = process.argv[2];
mkdirSync(OUT, { recursive: true });

const PAGES = ["", "/start", "/app", "/app/herd", "/app/lab", "/app/tickets", "/app/calls", "/app/settings"];
const VIEWPORTS = [
  { name: "m", width: 375, height: 812 },
  { name: "d", width: 1440, height: 900 },
];

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const problems = [];
for (const locale of ["ar", "en"]) {
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1, locale: locale === "ar" ? "ar-SA" : "en-US" });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => problems.push(`[${locale}/${vp.name}] pageerror: ${e.message}`));
    page.on("console", (msg) => {
      if (msg.type() === "error") problems.push(`[${locale}/${vp.name}] console: ${msg.text().slice(0, 200)}`);
    });
    // Seed the sample farm through the real UI gate.
    await page.goto(`${BASE}/${locale}/app`, { waitUntil: "networkidle" });
    const demo = page.getByRole("button", { name: locale === "ar" ? "استكشف العرض التجريبي" : "Explore the demo" });
    if (await demo.count()) await demo.first().click();
    await page.waitForTimeout(400);
    for (const p of PAGES) {
      if (filter && !(p || "/home").includes(filter)) continue;
      const url = `${BASE}/${locale}${p}`;
      await page.goto(url, { waitUntil: "networkidle" });
      await page.waitForTimeout(900);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (overflow > 1) problems.push(`[${locale}/${vp.name}] ${p || "/"} horizontal overflow ${overflow}px`);
      const name = `${locale}-${vp.name}-${(p || "/home").replaceAll("/", "_").replace(/^_/, "")}.png`;
      await page.screenshot({ path: `${OUT}/${name}`, fullPage: true });
    }
    await ctx.close();
  }
}
await browser.close();
console.log(problems.length ? problems.join("\n") : "NO PROBLEMS");
