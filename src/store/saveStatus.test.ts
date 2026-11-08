import { afterEach, describe, expect, it, vi } from "vitest";
import { createEmptyWorkspace } from "@/domain/seed";

function stubStorage(setItem: (key: string, value: string) => void) {
  vi.stubGlobal("localStorage", { getItem: () => null, setItem, removeItem: () => undefined });
}

async function freshStore() {
  vi.resetModules();
  return import("./workspace");
}

afterEach(() => vi.unstubAllGlobals());

describe("save status", () => {
  it("reports failed when the browser blocks storage access outright", async () => {
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      removeItem: () => undefined,
      setItem: () => { throw new DOMException("blocked", "SecurityError"); },
    });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { useSaveStatus, useWorkspaceStore } = await freshStore();
    expect(() => useWorkspaceStore.setState({ workspace: createEmptyWorkspace("basic") })).not.toThrow();
    expect(useSaveStatus.getState().status).toBe("failed");
  });

  it("reports saved only after the browser accepted the write", async () => {
    const writes: string[] = [];
    stubStorage((_key, value) => writes.push(value));
    const { useSaveStatus, useWorkspaceStore } = await freshStore();
    useWorkspaceStore.setState({ workspace: createEmptyWorkspace("basic") });
    expect(writes.length).toBeGreaterThan(0);
    expect(useSaveStatus.getState().status).toBe("saved");
  });

  it("reports failed when storage refuses the write, and recovers on the next good one", async () => {
    let full = true;
    stubStorage(() => {
      if (full) throw new DOMException("full", "QuotaExceededError");
    });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { useSaveStatus, useWorkspaceStore } = await freshStore();
    useWorkspaceStore.setState({ workspace: createEmptyWorkspace("basic") });
    expect(useSaveStatus.getState().status).toBe("failed");
    full = false;
    useWorkspaceStore.getState().update((ws) => ws);
    expect(useSaveStatus.getState().status).toBe("saved");
  });
});
