import { describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const mock = vi.hoisted(() => ({ open: vi.fn(), load: vi.fn(), save: vi.fn() }));
vi.mock("@/server/farm/actions", () => ({ openAccount: mock.open, loadWorkspace: mock.load, saveOwnerEdits: mock.save }));

const call = (body: unknown, headers: Record<string, string> = { origin: "https://naqah.test", host: "naqah.test" }) =>
  POST(new Request("https://naqah.test/api/account", { method: "POST", headers, body: JSON.stringify(body) }));

describe("account route", () => {
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
  it("refuses an unknown operation", async () => {
    expect((await call({ op: "drop" })).status).toBe(400);
  });
});
