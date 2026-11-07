import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { isAccountDataEnabled } from "./account-mode";

afterEach(() => vi.unstubAllEnvs());
it.each([undefined, "", "0", "true", " 1", "1 "])("defaults to disabled for %s", (value) => {
  vi.stubEnv("NEXT_PUBLIC_NAQAH_ACCOUNT_DATA", value);
  expect(isAccountDataEnabled()).toBe(false);
});
it("uses the same exact opt-in as the client", () => {
  vi.stubEnv("NEXT_PUBLIC_NAQAH_ACCOUNT_DATA", "1");
  expect(isAccountDataEnabled()).toBe(true);
});
