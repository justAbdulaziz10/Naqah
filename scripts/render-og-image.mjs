// Renders src/app/[locale]/opengraph-image.png with the brand fonts. Needs `npm run dev` on :3000.
// Usage: node scripts/render-og-image.mjs  (set CHROMIUM_PATH to use a cached Chromium)
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
const camel = readFileSync("src/components/brand/CamelMark.tsx", "utf8").match(/CAMEL_PATH =\s*"([^"]+)"/)[1];
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.goto("http://localhost:3000/ar", { waitUntil: "networkidle" });
await page.evaluate((camel) => {
  document.documentElement.setAttribute("dir", "ltr");
  document.body.innerHTML = `
  <div style="position:fixed;inset:0;background:#29241F;color:#FFFCF8;display:flex;overflow:hidden;font-family:var(--font-montserrat)">
    <svg viewBox="0 0 990 767" style="position:absolute;right:-90px;bottom:-70px;height:600px;width:774px;fill:#B68A58;opacity:.12"><g transform="translate(0,767) scale(0.1,-0.1)"><path d="${camel}"/></g></svg>
    <svg viewBox="0 0 1200 120" style="position:absolute;left:0;bottom:0;width:1200px;height:120px;fill:none;stroke:#B68A58;stroke-opacity:.25;stroke-width:1.2"><path d="M0 80 C 200 40, 380 110, 600 70 S 1000 30, 1200 70"/><path d="M0 105 C 240 70, 420 125, 640 95 S 1020 60, 1200 95"/></svg>
    <div style="position:relative;padding:84px 88px;display:flex;flex-direction:column;justify-content:space-between;width:100%">
      <div style="display:flex;align-items:center;gap:22px">
        <svg viewBox="0 0 990 767" style="height:64px;width:83px;fill:#B68A58"><g transform="translate(0,767) scale(0.1,-0.1)"><path d="${camel}"/></g></svg>
        <span style="font-size:40px;font-weight:700;letter-spacing:.14em">NAQAH</span>
        <span style="font-family:var(--font-alexandria);font-size:40px;font-weight:600;color:#D2B48C;margin-inline-start:6px">ناقة</span>
      </div>
      <div>
        <div style="font-family:var(--font-alexandria);font-size:76px;font-weight:700;line-height:1.25;direction:rtl;text-align:left;unicode-bidi:plaintext">اطمئنان، دون انشغال</div>
        <div style="font-size:40px;font-weight:500;color:#D2B48C;margin-top:10px">Peace of mind, without the busyness.</div>
      </div>
      <div style="font-size:22px;color:#DDD3C5;opacity:.85;letter-spacing:.02em">The AI voice agent for private camel ranches · Investor preview</div>
    </div>
  </div>`;
}, camel);
await page.waitForTimeout(800);
await page.screenshot({ path: "src/app/[locale]/opengraph-image.png" });
await browser.close();
