import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { demoOwnerCallNow, demoOwnerCallNowEnabled, ownerUpdateCallEnabled } from "./config";

vi.mock("server-only", () => ({}));
const FARM = "11111111-1111-4111-8111-111111111111";

afterEach(() => vi.unstubAllEnvs());

describe("the Dashboard's owner call (local presentation ranch only)", () => {
  it("is on only with the runner's flag, on a local stack, for listed farms, never on Vercel", () => {
    const dir = mkdtempSync("/tmp/naqah-owner-call-now-");
    try {
      vi.stubEnv("NAQAH_DEMO_REPEAT_FARMS", FARM);
      writeFileSync(`${dir}/approved.txt`, "");
      vi.stubEnv("NAQAH_CALL_ALLOWLIST_FILE", `${dir}/approved.txt`);
      expect(demoOwnerCallNowEnabled()).toBe(false); // no NAQAH_DEMO_OWNER_CALL
      expect(demoOwnerCallNow(FARM)).toBe(false);
      vi.stubEnv("NAQAH_DEMO_OWNER_CALL", "1");
      expect(demoOwnerCallNowEnabled()).toBe(true);
      expect(demoOwnerCallNow(FARM)).toBe(true);
      expect(demoOwnerCallNow("22222222-2222-4222-8222-222222222222")).toBe(false);
      // The scheduled owner calls stay off: they have their own flag.
      expect(ownerUpdateCallEnabled()).toBe(false);
      vi.stubEnv("VERCEL", "1");
      expect(demoOwnerCallNowEnabled()).toBe(false);
      expect(demoOwnerCallNow(FARM)).toBe(false);
      vi.stubEnv("VERCEL", undefined);
      vi.stubEnv("NAQAH_CALL_ALLOWLIST_FILE", "");
      expect(demoOwnerCallNowEnabled()).toBe(false); // no local approved-numbers file: not a local stack
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
