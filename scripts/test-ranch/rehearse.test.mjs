// LOCAL TESTS. Covers scripted consent turns, TwiML parsing, SQL result filtering, and the rerun wrapper.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { countPassedSteps, extractTwiMLTargets, parseForeignChangeEvidence, parseIsolationSnapshot, scriptedAnswerFor } from "./rehearse.mjs";

describe("local test-ranch rehearsal helpers", () => {
  it("counts the final pass total for the rehearsal evidence", () => {
    expect(countPassedSteps([{ passed: true }, { passed: false }, { passed: true }])).toEqual({ passed: 2, total: 3 });
  });

  it("extracts signed Gather action and Redirect targets", () => {
    expect(extractTwiMLTargets('<Response><Gather action="/api/voice/turn?s=opaque" method="POST"><Say>Answer</Say></Gather></Response>'))
      .toEqual({ action: "/api/voice/turn?s=opaque", redirect: null });
    expect(extractTwiMLTargets('<Response><Say>Summary</Say><Gather action="/api/voice/turn?s=opaque"></Gather></Response>'))
      .toEqual({ action: "/api/voice/turn?s=opaque", redirect: null });
    expect(extractTwiMLTargets("<Response><Redirect>/api/voice/outbound</Redirect></Response>"))
      .toEqual({ action: null, redirect: "/api/voice/outbound" });
  });

  it("keeps all explicit confirmation turns positive", () => {
    expect(scriptedAnswerFor({ scenario: "report_call", step: "report_summary" })).toBe("Yes");
    expect(scriptedAnswerFor({ scenario: "owner_notification", step: "instruction_review" })).toBe("Yes");
    expect(scriptedAnswerFor({ scenario: "owner_notification", step: "instruction_schedule", replies: [{ value: "later_today", label: { en: "Later today" } }] }))
      .toBe("Later today");
    expect(scriptedAnswerFor({ scenario: "owner_notification", step: "instruction_time", inputMode: "time" })).toMatch(/^\d{2}:\d{2}$/);
    expect(scriptedAnswerFor({ scenario: "worker_outbound", step: "outbound_receipt", replies: [{ value: "received", label: { en: "I heard the instruction" } }] }))
      .toBe("I heard the instruction");
    expect(scriptedAnswerFor({ scenario: "worker_outbound", step: "outbound_task_confirmation", replies: [{ value: "yes", label: { en: "Yes, complete" } }] }))
      .toBe("Yes");
  });

  it("parses the twenty table checksum rows, excluding SQL summary checks", () => {
    const tables = [
      "farms", "workers", "camels", "resources", "report_call_runs", "reports", "report_answers", "findings", "calls", "events",
      "task_tickets", "relays", "pending_worker_calls", "pending_worker_call_tasks", "worker_call_attempts", "no_answer_tickets",
      "voice_events", "voice_call_sessions", "test_call_ranches", "test_calls",
    ];
    const raw = [
      ...tables.map((name) => name + "|0|0123456789abcdef0123456789abcdef"),
      "farms|0", "workers|0", "camels|0", "resources|0", "report_call_runs|0", "task_tickets|0", "pending_worker_calls|0",
      "no_answer_tickets|0", "voice_events|0", "voice_call_sessions|0", "test_call_ranches|0", "test_calls|0",
      "foreign_rows_created_or_updated_since_test_start|available|0",
      "rate_limit_buckets_without_test_ranch_prefix|3|0123456789abcdef0123456789abcdef|available|0",
    ].join("\n");
    const snapshot = parseIsolationSnapshot(raw);
    expect(snapshot.size).toBe(20);
    expect([...snapshot.keys()].sort()).toEqual(tables.sort());
  });

  it("uses created/updated counts when commit timestamps are unavailable", () => {
    const timestampRows = [
      "farms", "workers", "camels", "resources", "report_call_runs", "task_tickets", "pending_worker_calls",
      "no_answer_tickets", "voice_events", "voice_call_sessions", "test_call_ranches", "test_calls",
    ];
    const fallback = [...timestampRows.map((name) => `${name}|0`), "foreign_rows_created_or_updated_since_test_start|commit timestamps unavailable|"].join("\n");
    expect(parseForeignChangeEvidence(fallback)).toMatchObject({ commitTimestampStatus: "commit timestamps unavailable", safe: true });
    expect(parseForeignChangeEvidence(fallback.replace("farms|0", "farms|1"))).toMatchObject({ safe: false });
    const available = fallback.replace("commit timestamps unavailable|", "available|0");
    expect(parseForeignChangeEvidence(available)).toMatchObject({ commitTimestampStatus: "available", safe: true });
    expect(parseForeignChangeEvidence(available.replace("available|0", "available|1"))).toMatchObject({ safe: false });
  });

  it("keeps the one-command rehearsal wrapper syntax valid", () => {
    execFileSync("/bin/sh", ["-n", fileURLToPath(new URL("./rehearse.sh", import.meta.url))]);
    expect(readFileSync(new URL("./rehearse.sh", import.meta.url), "utf8")).toContain("rehearse.mjs");
  });
});
