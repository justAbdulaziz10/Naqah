import { execFileSync } from "node:child_process";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

// LOCAL ONLY. Uses the same disposable Postgres/bootstrap approach as round-trip.pg.test.ts.
const database = process.env.NAQAH_TEST_DB;
const owner = "00000000-0000-0000-0000-00000000000a";
const farm = "11111111-1111-4111-8111-111111111111";
const sql = (query: string) =>
  execFileSync("psql", ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-d", database!], { input: query, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
const asOwner = `set role authenticated; select set_config('request.jwt.claim.sub', '${owner}', false);`;
const quiet = (query: string) => sql(query).split("\n").at(-1) ?? "";

describe.skipIf(!database)("report mode columns on disposable Postgres", () => {
  beforeAll(() => {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(database!)) throw new Error("Unsafe test database name");
    expect(sql("select inet_server_addr()::text")).toMatch(/^(127\.|::1$)/);
  });
  beforeEach(() => {
    sql(`truncate auth.users cascade; insert into auth.users values ('${owner}'); insert into farms(id, owner_id) values ('${farm}', '${owner}');`);
  });

  it("gives existing and new farms today's call", () => {
    expect(sql(`select report_mode || ' ' || question_plan::text from farms where id='${farm}'`)).toBe("guided []");
  });
  it("lets an owner write their own report mode and plan", () => {
    const plan = `[{"id":"herd_health","enabled":false,"required":true}]`;
    sql(`${asOwner} update farms set report_mode='open', question_plan='${plan}' where id='${farm}';`);
    expect(sql(`select report_mode || ' ' || (question_plan->0->>'enabled') from farms where id='${farm}'`)).toBe("open false");
  });
  it("refuses an unknown mode, a plan that isn't a list and an oversized plan", () => {
    expect(() => sql(`${asOwner} update farms set report_mode='speech' where id='${farm}';`)).toThrow(/check constraint/);
    expect(() => sql(`${asOwner} update farms set question_plan='{}' where id='${farm}';`)).toThrow(/check constraint/);
    expect(() => sql(`${asOwner} update farms set question_plan=(select jsonb_agg(g) from generate_series(1, 501) g) where id='${farm}';`)).toThrow(/check constraint/);
  });
  it("keeps the stored herd question in step with the call", () => {
    expect(quiet(`select text_en from predefined_questions where id='herd_count'`)).toBe("How many camels are there in total today?");
  });
});
