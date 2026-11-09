import { describe, expect, it } from "vitest";
import { recordOwnerInquiry } from "./actions";
import { fromRiyadh } from "./clock";
import { createEmptyWorkspace } from "./seed";
import { ownerMissedCallbackUsed } from "./rules";

const THU_1710 = fromRiyadh(2026, 11, 5, 17, 10);

describe("ownerMissedCallbackUsed", () => {
  it("uses the structured reason even when the display copy changes", () => {
    const ws = recordOwnerInquiry(createEmptyWorkspace("basic"), THU_1710, "missed_callback");
    ws.calls[0].summary.en = "Callback copy was revised";

    expect(ws.calls[0].reason).toBe("missed_notification_callback");
    expect(ownerMissedCallbackUsed(ws, THU_1710)).toBe(true);
  });

  it("recognizes legacy rows without a structured reason", () => {
    const ws = recordOwnerInquiry(createEmptyWorkspace("basic"), THU_1710, "weekly");
    ws.calls[0].summary.en = "Owner called back after a missed notification";

    expect(ownerMissedCallbackUsed(ws, THU_1710)).toBe(true);
  });

  it("does not carry a callback into the next Riyadh week", () => {
    const saturday = fromRiyadh(2026, 11, 7, 23, 59);
    const sunday = fromRiyadh(2026, 11, 8, 0, 0);
    const ws = recordOwnerInquiry(createEmptyWorkspace("basic"), saturday, "missed_callback");

    expect(ownerMissedCallbackUsed(ws, sunday)).toBe(false);
  });
});
