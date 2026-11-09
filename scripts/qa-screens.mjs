// Visual QA: screenshots every page at mobile + desktop in ar/en and flags horizontal overflow.
// Usage: BASE=http://localhost:3000 OUT=/tmp/naqah-shots node scripts/qa-screens.mjs [page-filter]
import { chromium } from "@playwright/test";
import { accessSync, constants, existsSync, mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const BASE = process.env.BASE ?? "http://localhost:3000";
const OUT = process.env.OUT ?? "/tmp/naqah-shots";
export const PAGES = [
  "",
  "/start",
  "/app",
  "/app/herd",
  "/app/lab",
  "/app/tickets",
  "/app/calls",
  "/app/settings",
  "/signup",
  "/login",
  "/welcome",
  "/choose-plan",
  "/app/voice-lab",
];
export const VIEWPORTS = [
  { name: "m", width: 375, height: 812 },
  { name: "d", width: 1440, height: 900 },
];

const EXECUTABLE_NAMES = new Set(["chrome", "Chromium", "headless_shell", "chrome-headless-shell"]);

export function chromiumCacheRoots(homeDirectory = homedir(), platform = process.platform) {
  if (platform === "darwin") return [join(homeDirectory, "Library", "Caches", "ms-playwright")];
  if (platform === "linux") return [join(homeDirectory, ".cache", "ms-playwright")];
  return [];
}

function canExecute(path) {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function findCachedChromiumExecutable({
  expectedPath = chromium.executablePath(),
  homeDirectory = homedir(),
  platform = process.platform,
} = {}) {
  if (existsSync(expectedPath)) return undefined;

  for (const root of chromiumCacheRoots(homeDirectory, platform)) {
    if (!existsSync(root)) continue;
    const pending = [{ path: root, depth: 0 }];
    while (pending.length) {
      const current = pending.pop();
      let entries;
      try {
        entries = readdirSync(current.path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
      } catch {
        continue;
      }
      for (const entry of entries) {
        const path = join(current.path, entry.name);
        if (entry.isDirectory() && current.depth < 8) {
          pending.push({ path, depth: current.depth + 1 });
          continue;
        }
        if ((!entry.isFile() && !entry.isSymbolicLink()) || !EXECUTABLE_NAMES.has(basename(path)) || !canExecute(path)) continue;
        const cacheDirectory = relative(root, path).split(sep)[0];
        if (/^chromium(?:_headless_shell)?-/i.test(cacheDirectory)) return path;
      }
    }
  }
  return undefined;
}

async function runScreens() {
  const filter = process.argv[2];
  mkdirSync(OUT, { recursive: true });

  let launchOptions;
  if (process.env.CHROMIUM_PATH) {
    launchOptions = { executablePath: process.env.CHROMIUM_PATH };
  } else {
    // If Playwright's pinned browser is absent, reuse a Chromium already installed in its standard cache.
    const cached = findCachedChromiumExecutable();
    if (cached) {
      launchOptions = { executablePath: cached };
      console.log(`[qa-screens] Using cached Chromium: ${cached}`);
    }
  }

  const browser = await chromium.launch(launchOptions);
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
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await runScreens();
}
