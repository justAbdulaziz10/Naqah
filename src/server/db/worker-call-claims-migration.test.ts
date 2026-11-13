import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(new URL("../../../supabase/migrations/20261113100000_worker_call_claims.sql", import.meta.url), "utf8");

describe("worker claim migration contract", () => {
  it("adds one nullable column idempotently without changing RLS or rewriting existing data", () => {
    expect(migration).toContain("add column if not exists dial_claimed_at timestamptz;");
    expect(migration.split(";")[0]).not.toMatch(/\b(default|not null)\b/i);
    expect(migration).not.toMatch(/\b(security definer|policy|enable row level|disable row level)\b/i);
    expect(migration.slice(0, migration.indexOf("create or replace function"))).not.toMatch(/\b(update|delete|insert)\b/i);
    expect(migration).toContain("if to_regprocedure('private.apply_farm_changes_before_worker_claims(uuid,bigint,jsonb,text,jsonb)') is null then");
  });

  it("preserves the revision-checked writer and omitted markers while permitting explicit clears", () => {
    expect(migration).toContain("revision := private.apply_farm_changes_before_worker_claims(p_farm_id, p_expected_revision, p_changes, p_event_id, p_outcome);");
    expect(migration).toContain("set dial_claimed_at = (item ->> 'dial_claimed_at')::timestamptz");
    expect(migration).toContain("call.farm_id = p_farm_id and item ? 'dial_claimed_at'");
    expect(migration).toContain("security invoker set search_path = ''");
    expect(migration).toContain("from public, anon, authenticated;");
  });
});
