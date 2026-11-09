import { existsSync, readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Baseline gzip sizes from the production artifact in /tmp/naqah-codex-audit.md, with ~10% headroom.
export const BUDGETS = [
  { route: "/ar", maxGzipKiB: 241 },
  { route: "/ar/app", maxGzipKiB: 275 },
  { route: "/ar/signup", maxGzipKiB: 309 },
];

export function javascriptAssetPaths(html) {
  const paths = new Set();
  const references = html.matchAll(/(?:src|href)=["']([^"']+?\.js(?:\?[^"']*)?)["']/g);
  for (const [, reference] of references) {
    const pathname = new URL(reference.replaceAll("&amp;", "&"), "https://naqah.invalid").pathname;
    if (pathname.startsWith("/_next/static/") && pathname.endsWith(".js")) paths.add(pathname);
  }
  return [...paths];
}

export function prerenderedHtmlCandidates(serverAppDir, route) {
  const segments = route.split("/").filter(Boolean);
  const routePath = join(serverAppDir, ...segments);
  return [`${routePath}.html`, join(routePath, "index.html"), join(routePath, "page.html")];
}

export function findPrerenderedHtml(serverAppDir, route) {
  const htmlPath = prerenderedHtmlCandidates(serverAppDir, route).find(existsSync);
  if (!htmlPath) {
    throw new Error(`Could not find prerendered HTML for ${route} under ${serverAppDir}`);
  }
  return htmlPath;
}

export function measureRoute(distDir, route) {
  const htmlPath = findPrerenderedHtml(join(distDir, "server", "app"), route);
  const html = readFileSync(htmlPath, "utf8");
  const assets = javascriptAssetPaths(html);
  if (assets.length === 0) throw new Error(`No Next.js JavaScript assets were referenced by ${htmlPath}`);

  const files = assets.map((asset) => {
    const file = join(distDir, "static", asset.slice("/_next/static/".length));
    if (!existsSync(file)) throw new Error(`Missing JavaScript asset ${file}, referenced by ${htmlPath}`);
    return { asset, gzipBytes: gzipSync(readFileSync(file)).byteLength };
  });
  return { route, htmlPath, files, gzipBytes: files.reduce((total, file) => total + file.gzipBytes, 0) };
}

export function checkBudgets(distDir, budgets = BUDGETS) {
  return budgets.map((budget) => {
    const result = measureRoute(distDir, budget.route);
    return {
      ...result,
      maxGzipBytes: budget.maxGzipKiB * 1024,
      maxGzipKiB: budget.maxGzipKiB,
      passes: result.gzipBytes <= budget.maxGzipKiB * 1024,
    };
  });
}

export function runBudgetCheck(distDir = resolve(REPO_ROOT, ".next")) {
  const results = checkBudgets(distDir);
  for (const result of results) {
    const actual = (result.gzipBytes / 1024).toFixed(1);
    const status = result.passes ? "PASS" : "FAIL";
    console.log(`${status} ${result.route}: ${actual} KiB gzip / ${result.maxGzipKiB} KiB (${result.files.length} JS files)`);
  }
  if (results.some((result) => !result.passes)) process.exitCode = 1;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  runBudgetCheck();
}
