// Tests for one-shot cron safety, local-origin validation, and counts-only append evidence.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runTick } from "./tick.mjs";

const env = {
  CRON_SECRET: "local-secret-must-not-print", NAQAH_TEST_RANCH_ID: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  PREVIEW_ORIGIN: "http://127.0.0.1:55588", NAQAH_TEST_CALL_PHASE: "worker",
  VERCEL_AUTOMATION_BYPASS_SECRET: "local-bypass-must-not-print",
};
let directory;
afterEach(() => { if (directory) rmSync(directory, { recursive: true, force: true }); directory = undefined; });

describe("single signed tick", () => {
  it("makes exactly one GET, does not follow redirects, and stores only a safe summary", async () => {
    directory = mkdtempSync(join(tmpdir(), "naqah-tick-test-"));
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true, farms: 1, placed: 1, failed: 0, errors: 0, extra: "private" }), {
      status: 200, headers: { "content-type": "application/json" },
    }));
    const printed = [];
    const result = await runTick({ env: { ...env, NAQAH_EVIDENCE_DIR: directory }, allowLocal: true, fetchImpl, now: new Date("2026-11-23T10:00:00.000Z"), output: (line) => printed.push(line) });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0].toString()).toBe("http://127.0.0.1:55588/api/cron/report-calls");
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({ method: "GET", redirect: "manual" });
    expect(fetchImpl.mock.calls[0][1].headers.authorization).toBe(`Bearer ${env.CRON_SECRET}`);
    expect(fetchImpl.mock.calls[0][1].headers["x-vercel-protection-bypass"]).toBeUndefined();
    expect(result).toMatchObject({ status: "200", farms: "1", placed: "1", failed: "0", errors: "0", phase: "worker", deployment: "127.0.0.1", mode: "local" });
    const saved = readFileSync(join(directory, "rehearsal", "ticks.local.log"), "utf8");
    expect(saved).toContain("placed=1");
    expect(saved).toContain("deployment=127.0.0.1 mode=local");
    expect(saved).not.toContain(env.CRON_SECRET);
    expect(saved).not.toContain(env.VERCEL_AUTOMATION_BYPASS_SECRET);
    expect(printed).toHaveLength(1);
  });

  it("records a redirect status without making a follow-up request", async () => {
    directory = mkdtempSync(join(tmpdir(), "naqah-tick-test-"));
    const fetchImpl = vi.fn(async () => new Response(null, { status: 307, headers: { location: "https://outside.invalid/" } }));
    const result = await runTick({ env, allowLocal: true, fetchImpl, evidencePath: join(directory, "ticks.log") });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("307");
  });

  it("labels preview ticks and never sends the bypass secret to ngrok", async () => {
    directory = mkdtempSync(join(tmpdir(), "naqah-tick-test-"));
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));
    const preview = await runTick({
      env: { ...env, PREVIEW_ORIGIN: "https://preview.example.vercel.app", NAQAH_EVIDENCE_DIR: directory },
      fetchImpl,
    });
    expect(preview).toMatchObject({ mode: "preview", deployment: "preview.example.vercel.app" });
    expect(fetchImpl.mock.calls[0][1].headers["x-vercel-protection-bypass"]).toBe(env.VERCEL_AUTOMATION_BYPASS_SECRET);
    expect(readFileSync(join(directory, "ticks.log"), "utf8")).toContain("deployment=preview.example.vercel.app mode=preview");

    fetchImpl.mockClear();
    await runTick({ env: { ...env, PREVIEW_ORIGIN: "https://naqah.ngrok-free.app" }, fetchImpl, evidencePath: join(directory, "ngrok.log") });
    expect(fetchImpl.mock.calls[0][1].headers["x-vercel-protection-bypass"]).toBeUndefined();
  });

  it("refuses missing ranch scope and insecure non-loopback origins before fetching", async () => {
    const fetchImpl = vi.fn();
    await expect(runTick({ env: { ...env, NAQAH_TEST_RANCH_ID: "" }, fetchImpl, evidencePath: "/tmp/unused-tick.log" })).rejects.toThrow("operator_scope_missing");
    await expect(runTick({ env: { ...env, NAQAH_TEST_RANCH_ID: "aaaaaaaa-aaaa-4aaa-0aaa-aaaaaaaaaaaa" }, fetchImpl, evidencePath: "/tmp/unused-tick.log" })).rejects.toThrow("operator_scope_missing");
    await expect(runTick({ env: { ...env, PREVIEW_ORIGIN: "http://preview.example.test" }, fetchImpl, evidencePath: "/tmp/unused-tick.log" })).rejects.toThrow("invalid_origin");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
