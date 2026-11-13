import { describe, expect, it } from "vitest";
import { claimDueWorkerCall, markWorkerCallPlacementUnknown, releaseWorkerCallClaim, resolveWorkerCallAttempt, retryUndeliveredCall } from "./actions";
import { undeliveredCalls } from "./alerts";
import { MINUTE, RETRY_DELAY_MS } from "./clock";
import { createEmptyWorkspace } from "./seed";

const now = new Date("2026-11-12T14:00:00.000Z");
const at = (minutes: number) => new Date(now.getTime() + minutes * MINUTE);

function farm() {
  const ws = createEmptyWorkspace("ultimate");
  ws.pendingWorkerCalls.push({ id: "pending", purpose: "instruction", message: "Move Wadha to the shade", taskTicketId: null, relayId: null, attempts: [], nextAttemptAt: now.toISOString(), state: "pending" });
  return ws;
}

describe("durable worker call claims", () => {
  it("settles each expired ambiguous claim once, waits 20 minutes, and stops after three attempts", () => {
    let ws = farm();
    for (const [index, minute] of [0, 35, 70].entries()) {
      const claimed = claimDueWorkerCall(ws, at(minute));
      expect(claimed).toMatchObject({ pendingCallId: "pending", attempt: index + 1 });
      ws = markWorkerCallPlacementUnknown(claimed.ws, "pending", index + 1, at(minute));
      expect(claimDueWorkerCall(ws, at(minute + 14)).pendingCallId).toBeNull();
      const expired = claimDueWorkerCall(ws, at(minute + 15));
      expect(expired.pendingCallId).toBeNull();
      ws = expired.ws;
      expect(ws.pendingWorkerCalls[0].attempts).toHaveLength(index + 1);
      expect(ws.pendingWorkerCalls[0].dialClaimedAt).toBeNull();
      expect(claimDueWorkerCall(ws, at(minute + 15)).ws.pendingWorkerCalls[0].attempts).toHaveLength(index + 1);
      if (index < 2) expect(ws.pendingWorkerCalls[0].nextAttemptAt).toBe(new Date(at(minute + 15).getTime() + RETRY_DELAY_MS).toISOString());
    }
    expect(undeliveredCalls(ws)).toHaveLength(1);
    expect(ws.noAnswerTickets).toEqual([]);
    expect(claimDueWorkerCall(ws, at(500)).pendingCallId).toBeNull();
    const retried = retryUndeliveredCall(ws, at(500), "pending");
    expect(claimDueWorkerCall(retried, at(500))).toMatchObject({ pendingCallId: "pending", attempt: 4 });
    expect(retried.pendingWorkerCalls).toHaveLength(1);
  });

  it.each(["unanswered", "interrupted", "delivered"] as const)("clears the claim on a %s callback before expiry", (result) => {
    const claimed = claimDueWorkerCall(farm(), now);
    const ws = markWorkerCallPlacementUnknown(claimed.ws, "pending", 1, now);
    const resolved = resolveWorkerCallAttempt(ws, at(1), "pending", result).ws;
    expect(resolved.pendingWorkerCalls[0].dialClaimedAt).toBeNull();
    expect(claimDueWorkerCall(resolved, at(15)).ws.pendingWorkerCalls[0].attempts).toHaveLength(1);
    expect(markWorkerCallPlacementUnknown(resolved, "pending", 1, now)).toBe(resolved);
  });

  it("releases definite rejection without using an attempt or later expiring it", () => {
    const claimed = claimDueWorkerCall(farm(), now);
    const ws = releaseWorkerCallClaim(claimed.ws, "pending", now);
    expect(ws.pendingWorkerCalls[0]).toMatchObject({ attempts: [], dialClaimedAt: null, nextAttemptAt: at(20).toISOString() });
    expect(claimDueWorkerCall(ws, at(20))).toMatchObject({ pendingCallId: "pending", attempt: 1 });
  });

  it("bounds an unmarked placement response at the existing two-hour timeout", () => {
    const claimed = claimDueWorkerCall(farm(), now);
    expect(claimDueWorkerCall(claimed.ws, at(119)).pendingCallId).toBeNull();
    const expired = claimDueWorkerCall(claimed.ws, at(120));
    expect(expired.pendingCallId).toBeNull();
    expect(expired.ws.pendingWorkerCalls[0]).toMatchObject({ attempts: [{ answered: false }], nextAttemptAt: at(140).toISOString() });
  });

  it("leaves a legacy due row without claim metadata behaving as before", () => {
    const ws = farm();
    ws.pendingWorkerCalls[0].nextAttemptAt = at(120).toISOString();
    const claimed = claimDueWorkerCall(ws, at(120));
    expect(claimed).toMatchObject({ pendingCallId: "pending", attempt: 1 });
    expect(claimed.ws.pendingWorkerCalls[0].attempts).toEqual([]);
  });

  it("does not shorten another attempt's or a newer claim's lock", () => {
    const claimed = claimDueWorkerCall(farm(), now).ws;
    expect(markWorkerCallPlacementUnknown(claimed, "pending", 2, now)).toBe(claimed);
    expect(markWorkerCallPlacementUnknown(claimed, "pending", 1, at(1))).toBe(claimed);
  });
});
