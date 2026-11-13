import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrations = new URL("../../../supabase/migrations/", import.meta.url);
const workerClaimsVersion = "20261113100000";

function bypassesWorkerClaims(name: string, source: string): boolean {
  const sql = source.replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, " ");
  return name.slice(0, 14) > workerClaimsVersion
    && /\bcreate\s+or\s+replace\s+function\s+"?public"?\s*\.\s*"?apply_farm_changes"?\s*\(/i.test(sql)
    && !/\b(apply_farm_changes_before_worker_claims|dial_claimed_at)\b/i.test(sql);
}

describe("apply_farm_changes migration chain guard", () => {
  it("rejects later stale replacements that bypass worker dial claims", () => {
    const unsafe = readdirSync(migrations).filter((name) => name.endsWith(".sql")).sort()
      .filter((name) => bypassesWorkerClaims(name, readFileSync(new URL(name, migrations), "utf8")));
    expect(unsafe, "Later apply_farm_changes replacements must preserve apply_farm_changes_before_worker_claims or dial_claimed_at").toEqual([]);
  });

  it.each([
    ["20261109182526_old.sql", "create or replace function public.apply_farm_changes()", false],
    ["20261113100000_worker_call_claims.sql", "create or replace function public.apply_farm_changes()", false],
    ["20261114000000_stale.sql", "CREATE OR REPLACE\nFUNCTION public.apply_farm_changes()", true],
    ["20261114000000_wrapper.sql", "create or replace function public.apply_farm_changes() select private.apply_farm_changes_before_worker_claims()", false],
    ["20261114000000_inline.sql", "create or replace function public.apply_farm_changes() update calls set dial_claimed_at = null", false],
    ["20261114000000_comment.sql", "create or replace function public.apply_farm_changes() -- dial_claimed_at", true],
    ["20261114000000_other.sql", "create or replace function public.another_function()", false],
  ])("checks %s", (name, source, unsafe) => {
    expect(bypassesWorkerClaims(name, source)).toBe(unsafe);
  });
});
