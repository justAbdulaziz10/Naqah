import { afterEach, describe, expect, it, vi } from "vitest";
import { createEmptyWorkspace } from "@/domain/seed";
import type { CallLog, Workspace } from "@/domain/types";
import type { AccountWorkspace } from "@/lib/account/types";

function calls(count: number): CallLog[] {
  const start = Date.parse("2026-01-01T00:00:00.000Z");
  return Array.from({ length: count }, (_, index) => ({
    id: `call-${index}`,
    kind: "worker_report" as const,
    direction: "inbound" as const,
    party: "worker" as const,
    at: new Date(start + index * 60_000).toISOString(),
    outcome: "completed" as const,
    attempt: null,
    summary: { ar: "تحديث", en: "Update" },
    ticketId: null,
    reportId: null,
  }));
}

async function freshStore() {
  vi.resetModules();
  return import("./workspace");
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("workspace retention boundary", () => {
  it("bounds history when a local demo workspace is updated", async () => {
    const { useWorkspaceStore, accountLink } = await freshStore();
    useWorkspaceStore.getState().startOnboarding("basic");

    useWorkspaceStore.getState().update((workspace) => ({ ...workspace, calls: calls(205) }));

    expect(useWorkspaceStore.getState().workspace?.calls).toHaveLength(200);
    accountLink.active = false;
  });

  it("leaves account workspace history untouched for server synchronization", async () => {
    const { useWorkspaceStore, accountLink } = await freshStore();
    const account = { ...createEmptyWorkspace(), farmId: "farm-1", ownerId: "owner-1" } as AccountWorkspace;
    accountLink.active = true;
    useWorkspaceStore.setState({ workspace: account });

    useWorkspaceStore.getState().update((workspace) => ({ ...workspace, calls: calls(205) } as Workspace));

    expect(useWorkspaceStore.getState().workspace?.calls).toHaveLength(205);
    accountLink.active = false;
  });
});
