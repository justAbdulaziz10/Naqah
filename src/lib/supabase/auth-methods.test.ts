import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { chooseMethod } from "@/components/auth/auth-options";
import { getAuthMethods, resetAuthMethodsCache } from "./auth-methods";

const settings = (external: Record<string, boolean>) => vi.fn(async () => Response.json({ external }));

beforeEach(() => {
  resetAuthMethodsCache();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "test-only");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("sign-in methods", () => {
  it("offers only what Supabase Auth has switched on", async () => {
    vi.stubGlobal("fetch", settings({ email: true, google: true, phone: false }));
    expect(await getAuthMethods()).toEqual({ phone: false, email: true, google: true });
  });
  it("falls back to email alone when Auth can't be asked", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    expect(await getAuthMethods()).toEqual({ phone: false, email: true, google: false });
  });
  it("defaults to email when SMS is off, even if mobile was asked for", () => {
    const noSms = { phone: false, email: true, google: true };
    expect(chooseMethod(null, noSms)).toBe("email");
    expect(chooseMethod("phone", noSms)).toBe("email");
    const both = { phone: true, email: true, google: false };
    expect(chooseMethod(null, both)).toBe("phone");
    expect(chooseMethod("email", both)).toBe("email");
  });
});
