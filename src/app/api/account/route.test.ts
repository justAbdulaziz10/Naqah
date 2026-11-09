import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const mock = vi.hoisted(() => ({ open: vi.fn(), load: vi.fn(), save: vi.fn() }));
vi.mock("@/server/farm/actions", () => ({ openAccount: mock.open, loadWorkspace: mock.load, saveOwnerEdits: mock.save }));
vi.mock("server-only", () => ({}));

const call = (body: unknown, headers: Record<string, string> = { origin: "https://naqah.test", host: "naqah.test" }) =>
  POST(new Request("https://naqah.test/api/account", { method: "POST", headers, body: JSON.stringify(body) }));

describe("account route", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("NEXT_PUBLIC_NAQAH_ACCOUNT_DATA", "1"); });
  afterEach(() => vi.unstubAllEnvs());
  it.each([undefined, "", "0", "true"])("is absent with flag %s, without invoking any account operation", async (flag) => {
    vi.stubEnv("NEXT_PUBLIC_NAQAH_ACCOUNT_DATA", flag);
    for (const op of ["open", "load", "save"]) {
      const response = await call({ op, changes: [], farm: "created" });
      expect(response.status).toBe(404);
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
    expect(mock.open).not.toHaveBeenCalled();
    expect(mock.load).not.toHaveBeenCalled();
    expect(mock.save).not.toHaveBeenCalled();
  });
  it("does not even parse a request body when disabled", async () => {
    vi.stubEnv("NEXT_PUBLIC_NAQAH_ACCOUNT_DATA", "0");
    const request = new Request("https://naqah.test/api/account", { method: "POST", body: "not-json" });
    const parse = vi.spyOn(request, "json");
    expect((await POST(request)).status).toBe(404);
    expect(parse).not.toHaveBeenCalled();
  });
  it("refuses another site, and a request that names no origin", async () => {
    expect((await call({ op: "load" }, { origin: "https://evil.test", host: "naqah.test" })).status).toBe(403);
    expect((await call({ op: "load" }, { host: "naqah.test" })).status).toBe(403);
    expect(mock.load).not.toHaveBeenCalled();
  });
  it("passes a save through and never caches a farm", async () => {
    mock.save.mockResolvedValue({ ok: true, data: {} });
    const response = await call({ op: "save", changes: [], farm: "created" });
    expect(mock.save).toHaveBeenCalledWith([], "created");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("returns 413 for an oversized JSON body and rejects malformed JSON", async () => {
    const oversized = await POST(new Request("https://naqah.test/api/account", {
      method: "POST",
      headers: { origin: "https://naqah.test", host: "naqah.test", "content-type": "application/json" },
      body: JSON.stringify({ op: "save", changes: "x".repeat(70_000) }),
    }));
    expect(oversized.status).toBe(413);
    expect(await oversized.json()).toEqual({ ok: false, error: "payload_too_large" });
    const malformed = await POST(new Request("https://naqah.test/api/account", {
      method: "POST", headers: { origin: "https://naqah.test", host: "naqah.test" }, body: "{",
    }));
    expect(malformed.status).toBe(400);
    expect(mock.save).not.toHaveBeenCalled();
  });
  it("refuses an unknown operation", async () => {
    expect((await call({ op: "drop" })).status).toBe(400);
  });
});
