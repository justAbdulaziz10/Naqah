import { afterEach, describe, expect, it, vi } from "vitest";
import { createEmptyWorkspace } from "@/domain/seed";

function stubStorage(setItem: (key: string, value: string) => void) {
  vi.stubGlobal("localStorage", { getItem: () => null, setItem, removeItem: () => undefined });
}

async function freshStore() {
  vi.resetModules();
  return import("./workspace");
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("save status", () => {
  it("reports failed when the browser blocks storage access outright", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      removeItem: () => undefined,
      setItem: () => { throw new DOMException("blocked", "SecurityError"); },
    });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { useSaveStatus, useWorkspaceStore } = await freshStore();
    expect(() => useWorkspaceStore.setState({ workspace: createEmptyWorkspace("basic") })).not.toThrow();
    expect(useSaveStatus.getState().status).toBe("idle");
    vi.advanceTimersByTime(300);
    expect(useSaveStatus.getState().status).toBe("failed");
  });

  it("reports saved only after the coalesced browser write is accepted", async () => {
    vi.useFakeTimers();
    const writes: string[] = [];
    stubStorage((_key, value) => writes.push(value));
    const { useSaveStatus, useWorkspaceStore } = await freshStore();
    useWorkspaceStore.setState({ workspace: createEmptyWorkspace("basic") });
    expect(writes).toHaveLength(0);
    expect(useSaveStatus.getState().status).toBe("idle");
    vi.advanceTimersByTime(299);
    expect(writes).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(writes.length).toBeGreaterThan(0);
    expect(useSaveStatus.getState().status).toBe("saved");
  });

  it("reports failed when storage refuses the write, and recovers on the next good one", async () => {
    vi.useFakeTimers();
    let full = true;
    stubStorage(() => {
      if (full) throw new DOMException("full", "QuotaExceededError");
    });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { useSaveStatus, useWorkspaceStore } = await freshStore();
    useWorkspaceStore.setState({ workspace: createEmptyWorkspace("basic") });
    vi.advanceTimersByTime(300);
    expect(useSaveStatus.getState().status).toBe("failed");
    full = false;
    useWorkspaceStore.getState().update((ws) => ws);
    vi.advanceTimersByTime(300);
    expect(useSaveStatus.getState().status).toBe("saved");
  });
});
