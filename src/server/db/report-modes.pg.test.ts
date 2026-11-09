import { execFileSync } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";

const database = process.env.NAQAH_TEST_DB;
const owner = "33333333-3333-4333-8333-333333333333";
const other = "44444444-4444-4444-8444-444444444444";
const report = "55555555-5555-4555-8555-555555555555";
const invalidReport = "66666666-6666-4666-8666-666666666666";

function sql(query: string) {
  if (database !== "naqah_report_modes_local" || process.env.PGHOST !== "127.0.0.1" || process.env.PGPORT !== "54460") throw new Error("Only the isolated report-modes database on port 54460 is allowed");
  return execFileSync("/opt/homebrew/opt/postgresql@17/bin/psql", ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-d", database], {
    input: query, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

describe.skipIf(database !== "naqah_report_modes_local")("report mode storage and isolation", () => {
  beforeAll(() => {
    sql(`insert into auth.users values ('${owner}'), ('${other}');
      insert into public.farms (id, owner_id) values ('${owner}', '${owner}'), ('${other}', '${other}');
      set role service_role;
      insert into public.reports (id, farm_id) values ('${report}', '${owner}');`);
  });

  it("loads old-style reports with null mode and empty coverage", () => {
    expect(JSON.parse(sql(`select jsonb_build_object('mode', mode, 'coverage', coverage) from reports where id = '${report}'`))).toEqual({ mode: null, coverage: [] });
  });

  it("checks modes and the coverage container", () => {
    expect(() => sql(`set role service_role; insert into reports (farm_id, mode) values ('${owner}', 'worker_choice')`)).toThrow();
    expect(() => sql(`set role service_role; insert into reports (farm_id, coverage) values ('${owner}', '{}')`)).toThrow();
  });

  it("keeps service writes and owner-only reads on the new columns", () => {
    sql(`set role service_role; update reports set mode = 'open', coverage = '[{"questionId":"feed_level","status":"not_reported"}]' where id = '${report}'`);
    const own = JSON.parse(sql(`set role authenticated; set request.jwt.claim.sub = '${owner}';
      select jsonb_build_object('mode', mode, 'coverage', coverage) from reports where id = '${report}'`));
    expect(own).toEqual({ mode: "open", coverage: [{ questionId: "feed_level", status: "not_reported" }] });
    expect(sql(`set role authenticated; set request.jwt.claim.sub = '${other}'; select count(*) from reports where id = '${report}'`)).toBe("0");
    expect(() => sql(`set role authenticated; set request.jwt.claim.sub = '${owner}'; update reports set mode = 'guided' where id = '${report}'`)).toThrow();
    expect(() => sql(`set role authenticated; set request.jwt.claim.sub = '${owner}'; insert into reports (farm_id, mode) values ('${owner}', 'open')`)).toThrow();
    expect(() => sql(`set role anon; select mode, coverage from reports`)).toThrow();
    expect(sql(`select has_function_privilege('authenticated', 'public.apply_farm_changes(uuid,bigint,jsonb,text,jsonb)', 'execute')`)).toBe("f");
  });

  it("rolls back the report, event and revision if metadata fails validation", () => {
    const revision = Number(sql(`select revision from farms where id = '${owner}'`));
    const changes = JSON.stringify({ reports: [{ id: invalidReport, farm_id: owner, mode: "invalid", at: "2026-11-09T14:00:00.000Z" }] });
    expect(() => sql(`set role service_role; select apply_farm_changes('${owner}', ${revision}, '${changes}'::jsonb, 'invalid-mode', '{"status":"saved"}')`)).toThrow();
    expect(Number(sql(`select revision from farms where id = '${owner}'`))).toBe(revision);
    expect(sql(`select count(*) from reports where id = '${invalidReport}'`)).toBe("0");
    expect(sql(`select count(*) from voice_events where farm_id = '${owner}' and event_id = 'invalid-mode'`)).toBe("0");
  });
});
