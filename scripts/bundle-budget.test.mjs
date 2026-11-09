import { gzipSync } from "node:zlib";
import { randomBytes } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { checkBudgets, javascriptAssetPaths, prerenderedHtmlCandidates } from "./bundle-budget.mjs";

const temporaryDirectories = [];

function temporaryDist() {
  const dist = mkdtempSync(join(tmpdir(), "naqah-bundle-budget-"));
  temporaryDirectories.push(dist);
  return dist;
}

afterEach(() => {
  for (const path of temporaryDirectories.splice(0)) rmSync(path, { recursive: true, force: true });
});

it("collects unique Next.js script and preload references", () => {
  const html = '<script src="/_next/static/chunks/a.js"></script><link rel="preload" href="/_next/static/chunks/a.js" as="script"><script src="https://cdn.invalid/other.js"></script>';

  expect(javascriptAssetPaths(html)).toEqual(["/_next/static/chunks/a.js"]);
});

it("checks gzip size from the HTML assets and locates nested prerendered pages", () => {
  const dist = temporaryDist();
  const serverApp = join(dist, "server", "app");
  const staticDir = join(dist, "static", "chunks");
  mkdirSync(join(serverApp, "ar"), { recursive: true });
  mkdirSync(staticDir, { recursive: true });
  const assetContents = "export const route = 'landing';";
  writeFileSync(join(serverApp, "ar.html"), '<script src="/_next/static/chunks/landing.js"></script>');
  writeFileSync(join(serverApp, "ar", "app.html"), '<script src="/_next/static/chunks/landing.js"></script>');
  writeFileSync(join(staticDir, "landing.js"), assetContents);

  const results = checkBudgets(dist, [
    { route: "/ar", maxGzipKiB: 1 },
    { route: "/ar/app", maxGzipKiB: 1 },
  ]);

  expect(prerenderedHtmlCandidates(serverApp, "/ar/app")).toContain(join(serverApp, "ar", "app.html"));
  expect(results.every((result) => result.passes)).toBe(true);
  expect(results[0].gzipBytes).toBe(gzipSync(assetContents).byteLength);
  expect(results[0].files).toHaveLength(1);
});

it("marks a route over its gzip budget as failing", () => {
  const dist = temporaryDist();
  const serverApp = join(dist, "server", "app");
  const staticDir = join(dist, "static", "chunks");
  mkdirSync(serverApp, { recursive: true });
  mkdirSync(staticDir, { recursive: true });
  writeFileSync(join(serverApp, "ar.html"), '<script src="/_next/static/chunks/landing.js"></script>');
  writeFileSync(join(staticDir, "landing.js"), randomBytes(12000));

  expect(checkBudgets(dist, [{ route: "/ar", maxGzipKiB: 1 }])[0].passes).toBe(false);
});
