// Tests that isolation reports stay SELECT-only and cover ranch-owned rows without printing personal data.
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const DIR = new URL(".", import.meta.url);
const files = ["isolation-baseline.sql", "isolation-after.sql"];
const TABLES = [
  "farms", "workers", "camels", "resources", "report_call_runs", "reports", "report_answers", "findings", "calls", "events",
  "task_tickets", "relays", "pending_worker_calls", "pending_worker_call_tasks", "worker_call_attempts", "no_answer_tickets",
  "voice_events", "voice_call_sessions", "test_call_ranches", "test_calls",
];

describe("privacy-safe SQL isolation evidence", () => {
  it.each(files)("%s is read-only and covers each related table", (file) => {
    const text = readFileSync(new URL(file, DIR), "utf8");
    const executable = text.replace(/^\s*--.*$/gm, "");
    expect(executable).toMatch(/begin read only/i);
    expect(executable).toMatch(/commit\s*;/i);
    expect(executable).toContain(":'test_farm_id'");
    expect(executable).toContain(":'test_start'");
    for (const table of TABLES) expect(executable).toContain(`public.${table}`);
    expect(executable).toMatch(/pg_xact_commit_timestamp/);
    expect(executable).toMatch(/rolbypassrls/);
    expect(executable).toMatch(/cannot bypass row-level security/i);
    expect(executable).toMatch(/commit timestamps unavailable/);
    expect(executable).toMatch(/created_or_updated_after_test_start/);
    expect(executable).not.toMatch(/else\s+-1/i);
    expect(executable).toContain("rate_limit_buckets_for_other_farms");
    expect(executable).not.toMatch(/\b(create|insert|update|delete|truncate|alter|drop|grant|revoke)\s+(?!timestamp)/i);
    expect(executable).not.toMatch(/\bcreate\s+(temporary|temp)\s+table/i);
    expect(executable).not.toMatch(/select\s+(?:t\.)?(?:phone|owner_phone|supplier_phone|email|name)\b/i);
  });
});

describe("name-only env templates", () => {
  it("lists setup/ranch/bridge/operator names without assignable values", () => {
    const dir = new URL("../env/", import.meta.url);
    const names = readdirSync(dir);
    expect(names.sort()).toEqual(["bridge.env.example", "operator.env.example", "preview.ranch.env.example", "preview.setup.env.example"]);
    for (const name of names) {
      const text = readFileSync(new URL(name, dir), "utf8");
      expect(text).not.toMatch(/^\s*[A-Z_][A-Z0-9_]*\s*=/m);
      expect(text).toMatch(/absent|unset/i);
    }
  });

  it("keeps the bridge proxy and upstream on the guarded local range", () => {
    const bridge = readFileSync(new URL("../env/bridge.env.example", import.meta.url), "utf8");
    expect(bridge).toContain("NAQAH_BRIDGE_UPSTREAM must point to the guarded proxy at 127.0.0.1:55555");
    expect(bridge).toMatch(/NAQAH_CALL_TIME_LIMIT_SECONDS.*unset/i);
    for (const file of ["preview.setup.env.example", "preview.ranch.env.example"]) {
      const text = readFileSync(new URL(`../env/${file}`, import.meta.url), "utf8");
      for (const name of [
        "NAQAH_PREVIEW_ALL_RANCHES", "NAQAH_CALL_ALLOWLIST_FILE", "NAQAH_CALL_TIME_LIMIT_SECONDS",
        "NAQAH_TEST_CALLS", "NAQAH_TEST_CALL_ADMINS", "NAQAH_VOICE_LAB", "NAQAH_VOICE_LAB_OWNERS",
        "NEXT_PUBLIC_NAQAH_TEST_CALL", "NEXT_PUBLIC_NAQAH_VOICE_LAB", "SUPABASE_SERVICE_ROLE_KEY",
      ]) expect(text).toContain(`# ${name}`);
    }
  });
});
