import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { createServiceClient } from "./service-client";

afterEach(() => vi.unstubAllEnvs());

describe("service client", () => {
  const configure = (key: string) => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "test-only");
    vi.stubEnv("SUPABASE_SECRET_KEY", key);
  };
  it("stays off without a secret key", () => {
    configure("");
    expect(createServiceClient()).toBeNull();
  });
  it("refuses a publishable key in the secret slot", () => {
    configure("sb_publishable_test");
    expect(createServiceClient()).toBeNull();
  });
  it("starts with a secret key", () => {
    configure("sb_secret_test");
    expect(createServiceClient()).not.toBeNull();
  });
});
