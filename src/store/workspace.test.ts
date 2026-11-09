import { afterEach, describe, expect, it, vi } from "vitest";
import type { PersistStorage, StorageValue } from "zustand/middleware";
import { createCoalescingStorage } from "./workspace";

type SavedState = { count: number };
const saved = (count: number): StorageValue<SavedState> => ({ state: { count }, version: 1 });

function createMemoryStorage() {
  const writes: StorageValue<SavedState>[] = [];
  const removals: string[] = [];
  const storage: PersistStorage<SavedState> = {
    getItem: () => null,
    setItem: (_name, value) => { writes.push(value); },
    removeItem: (name) => { removals.push(name); },
  };
  return { storage, writes, removals };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("coalescing workspace storage", () => {
  it("serializes only the latest value after 300 ms of quiet", () => {
    vi.useFakeTimers();
    const memory = createMemoryStorage();
    const storage = createCoalescingStorage(memory.storage);

    storage.setItem("workspace", saved(1));
    vi.advanceTimersByTime(150);
    storage.setItem("workspace", saved(2));
    vi.advanceTimersByTime(299);
    expect(memory.writes).toEqual([]);
    vi.advanceTimersByTime(1);

    expect(memory.writes).toEqual([saved(2)]);
    storage.dispose();
  });

  it.each(["pagehide", "beforeunload"] as const)("flushes pending writes on %s", (eventName) => {
    vi.useFakeTimers();
    const windowEvents = new EventTarget();
    vi.stubGlobal("window", windowEvents);
    const memory = createMemoryStorage();
    const storage = createCoalescingStorage(memory.storage);
    storage.setItem("workspace", saved(3));

    windowEvents.dispatchEvent(new Event(eventName));

    expect(memory.writes).toEqual([saved(3)]);
    storage.dispose();
  });

  it("flushes when the document becomes hidden", () => {
    vi.useFakeTimers();
    const documentEvents = new EventTarget() as EventTarget & { visibilityState: DocumentVisibilityState };
    documentEvents.visibilityState = "visible";
    vi.stubGlobal("document", documentEvents);
    const memory = createMemoryStorage();
    const storage = createCoalescingStorage(memory.storage);
    storage.setItem("workspace", saved(4));

    documentEvents.visibilityState = "hidden";
    documentEvents.dispatchEvent(new Event("visibilitychange"));

    expect(memory.writes).toEqual([saved(4)]);
    storage.dispose();
  });

  it("cancels a queued write before removing its saved key", () => {
    vi.useFakeTimers();
    const memory = createMemoryStorage();
    const storage = createCoalescingStorage(memory.storage);
    storage.setItem("workspace", saved(5));
    storage.removeItem("workspace");
    vi.advanceTimersByTime(300);

    expect(memory.writes).toEqual([]);
    expect(memory.removals).toEqual(["workspace"]);
    storage.dispose();
  });
});
