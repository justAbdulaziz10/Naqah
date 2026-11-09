import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { chromiumCacheRoots, findCachedChromiumExecutable, PAGES, VIEWPORTS } from "./qa-screens.mjs";

const temporaryDirectories = [];

function temporaryHome() {
  const home = mkdtempSync(join(tmpdir(), "naqah-qa-screens-"));
  temporaryDirectories.push(home);
  return home;
}

afterEach(() => {
  for (const path of temporaryDirectories.splice(0)) rmSync(path, { recursive: true, force: true });
});

it("captures the requested auth and voice-lab routes at mobile and desktop sizes", () => {
  expect(PAGES).toEqual(expect.arrayContaining(["/signup", "/login", "/welcome", "/choose-plan", "/app/voice-lab"]));
  expect(VIEWPORTS.map(({ width }) => width)).toEqual([375, 1440]);
});

it("uses an installed Chromium in the macOS Playwright cache when the pinned browser is missing", () => {
  const home = temporaryHome();
  const root = chromiumCacheRoots(home, "darwin")[0];
  const executable = join(root, "chromium-1234", "chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium");
  mkdirSync(join(executable, ".."), { recursive: true });
  writeFileSync(executable, "chromium");
  chmodSync(executable, 0o755);

  expect(findCachedChromiumExecutable({ expectedPath: join(home, "missing-playwright-browser"), homeDirectory: home, platform: "darwin" })).toBe(executable);
});

it("uses a headless Chromium already installed in the Linux Playwright cache", () => {
  const home = temporaryHome();
  const root = chromiumCacheRoots(home, "linux")[0];
  const executable = join(root, "chromium_headless_shell-1234", "chrome-linux", "headless_shell");
  mkdirSync(join(executable, ".."), { recursive: true });
  writeFileSync(executable, "chromium");
  chmodSync(executable, 0o755);

  expect(findCachedChromiumExecutable({ expectedPath: join(home, "missing-playwright-browser"), homeDirectory: home, platform: "linux" })).toBe(executable);
});

it("leaves Playwright's configured browser in use when it is installed", () => {
  const home = temporaryHome();
  const expected = join(home, "pinned-browser");
  writeFileSync(expected, "chromium");

  expect(findCachedChromiumExecutable({ expectedPath: expected, homeDirectory: home, platform: "linux" })).toBeUndefined();
});
