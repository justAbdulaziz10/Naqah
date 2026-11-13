import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as calendar } from "./calendar/route";
import { GET as cron } from "./cron/report-calls/route";
import { GET as integrations } from "./integrations/status/route";
import { encodeSchedule } from "@/lib/calendar/schedule";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ getOwner: async () => ({ user: null }) }));
vi.mock("next/server", async (original) => {
  const actual = await original<typeof import("next/server")>();
  return { ...actual, connection: vi.fn(async () => {}) };
});

afterEach(() => vi.unstubAllEnvs());

describe("public and scheduled API routes", () => {
  it("keeps the calendar snapshot public while refusing malformed tokens", async () => {
    const malformed = await calendar(new Request("https://naqah.test/api/calendar?s=%25%25%25"));
    expect(malformed.status).toBe(400);
    const token = encodeSchedule({ v: 1, l: "en", f: "Ranch", p: "basic", w: null, t: [] });
    const response = await calendar(new Request(`https://naqah.test/api/calendar?s=${token}`));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/calendar");
    expect(await response.text()).toContain("BEGIN:VCALENDAR");
  });

  it("requires the cron bearer secret and never places a call in sample mode", async () => {
    vi.stubEnv("NAQAH_VOICE_MODE", "sample");
    vi.stubEnv("CRON_SECRET", "");
    expect((await cron(new Request("https://naqah.test/api/cron/report-calls"))).status).toBe(503);
    vi.stubEnv("CRON_SECRET", "cron-test-secret");
    expect((await cron(new Request("https://naqah.test/api/cron/report-calls"))).status).toBe(401);
    expect((await cron(new Request("https://naqah.test/api/cron/report-calls", { headers: { authorization: "Bearer wrong" } }))).status).toBe(401);
    const response = await cron(new Request("https://naqah.test/api/cron/report-calls", {
      headers: { authorization: "Bearer cron-test-secret" },
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, placed: 0, skipped: "sample_mode" });
  });

  it("keeps only bare integration health public", async () => {
    vi.stubEnv("TWILIO_AUTH_TOKEN", "secret-token");
    const response = await integrations();
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(JSON.parse(body)).toEqual({ ok: true });
    expect(body).not.toContain("secret-token");
  });
});
