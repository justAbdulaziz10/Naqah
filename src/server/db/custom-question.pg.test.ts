import { execFileSync, spawn } from "node:child_process";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { toDbId } from "./ids";

// LOCAL ONLY. Uses the same disposable Postgres/bootstrap approach as round-trip.pg.test.ts.
const database = process.env.NAQAH_TEST_DB;
const ownerA = "00000000-0000-0000-0000-00000000000a";
const ownerB = "00000000-0000-0000-0000-00000000000b";
const farmA = "11111111-1111-4111-8111-111111111111";
const farmB = "22222222-2222-4222-8222-222222222222";
const fifth = toDbId(farmA, "cq_fifth");
const args = () => ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose", "-d", database!];
function sql(query: string) {
  return execFileSync("psql", args(), { input: query, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
}
const asOwner = (owner = ownerA) => `set role authenticated; select set_config('request.jwt.claim.sub', '${owner}', false);`;
const insert = (id: string, farm = farmA) => `insert into public.custom_questions(id, farm_id, text) values ('${id}', '${farm}', 'Question') on conflict(id) do update set text=excluded.text, farm_id=excluded.farm_id;`;
function fails(query: string, state: string) {
  expect(() => sql(query)).toThrow(new RegExp(state));
}
function concurrent(query: string) {
  const child = spawn("psql", args(), { stdio: ["pipe", "pipe", "pipe"] });
  let out = "", err = "";
  let ready!: () => void;
  let rejectReady!: (error: Error) => void;
  const started = new Promise<void>((resolve, reject) => { ready = resolve; rejectReady = reject; });
  const done = new Promise<{ code: number | null; out: string; err: string }>((resolve, reject) => {
    child.on("error", (error) => { reject(error); rejectReady(error); });
    child.stdout.on("data", (data) => { out += String(data); if (out.includes("LOCKED")) ready(); });
    child.stderr.on("data", (data) => { err += String(data); });
    child.on("close", (code) => {
      if (!out.includes("LOCKED")) rejectReady(new Error(err || "psql exited before acquiring lock"));
      resolve({ code, out, err });
    });
  });
  // First statement owns the farm lock before the competing connection is started.
  child.stdin.end(`${query}\n\\echo LOCKED\nselect pg_sleep(1); commit;`);
  return { started, done };
}

describe.skipIf(!database)("custom question retries on disposable Postgres", () => {
  beforeAll(() => {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(database!)) throw new Error("Unsafe test database name");
    for (const host of [process.env.PGHOST ?? "127.0.0.1", process.env.PGHOSTADDR ?? ""]) {
      if (!/^(|localhost|127\.\d+\.\d+\.\d+|::1)$/.test(host)) throw new Error("Local Postgres only");
    }
    expect(sql("select inet_server_addr()::text")).toMatch(/^(127\.|::1$)/);
  });
  beforeEach(() => {
    sql(`truncate auth.users cascade;
      insert into auth.users values ('${ownerA}'), ('${ownerB}');
      insert into farms(id, owner_id) values ('${farmA}', '${ownerA}'), ('${farmB}', '${ownerB}');
      insert into custom_questions(farm_id, text) select '${farmA}', 'Q' || g from generate_series(1, 4) g;`);
  });
  it("retries the same fifth question after its successful response was lost", () => {
    sql(asOwner() + insert(fifth)); // Same onConflict:id write as owner-repository.insertRow.
    sql(asOwner() + insert(fifth));
    expect(sql(`select count(*) from custom_questions where farm_id='${farmA}'`)).toBe("5");
    sql(asOwner() + `update custom_questions set text='Edited fifth' where id='${fifth}';`);
    expect(sql(`select text from custom_questions where id='${fifth}'`)).toBe("Edited fifth");
  });
  it("rejects a genuinely new sixth question for owners and service_role", () => {
    sql(asOwner() + insert(fifth));
    const sixth = toDbId(farmA, "cq_sixth");
    fails(asOwner() + insert(sixth), "23514");
    fails("set role service_role;" + insert(sixth), "23514");
    sql("set role service_role;" + insert(fifth));
    expect(sql(`select count(*) from custom_questions where farm_id='${farmA}'`)).toBe("5");
  });
  it("does not mistake another farm's id for a retry or allow cross-owner upserts", () => {
    const otherId = toDbId(farmB, "cq_other");
    sql(asOwner(ownerB) + insert(otherId, farmB));
    sql(asOwner() + insert(fifth));
    fails(asOwner() + insert(otherId), "23514");
    sql(asOwner() + `delete from custom_questions where id='${fifth}';`);
    fails(asOwner() + insert(otherId), "42501"); // At four, the upsert still cannot steal B's row.
    fails(asOwner() + insert(otherId, farmB), "42501");
    fails("set role anon;" + insert(fifth), "42501");
    expect(sql(`select farm_id from custom_questions where id='${otherId}'`)).toBe(farmB);
  });
  it("preserves immutable farm parents, Ultimate's allowance and downgrade protection", () => {
    sql(asOwner() + insert(fifth));
    fails(`set role service_role; update custom_questions set farm_id='${farmB}' where id='${fifth}'`, "23514");
    sql(`set role service_role; update farms set plan='ultimate' where id='${farmB}';
      insert into custom_questions(farm_id,text) select '${farmB}', 'Q' || g from generate_series(1,6) g;`);
    fails(`set role service_role; update farms set plan='basic' where id='${farmB}'`, "23514");
    expect(sql(`select count(*) from custom_questions where farm_id='${farmB}'`)).toBe("6");
  });
  it("rolls back a multi-row insert that would cross the Basic limit", () => {
    fails(asOwner() + `insert into custom_questions(farm_id,text) values ('${farmA}', 'Q5'), ('${farmA}', 'Q6');`, "23514");
    expect(sql(`select count(*) from custom_questions where farm_id='${farmA}'`)).toBe("4");
  });
  it("serializes concurrent distinct inserts at four questions", async () => {
    const first = concurrent("begin;" + asOwner() + insert(fifth));
    await first.started;
    fails(asOwner() + insert(toDbId(farmA, "cq_sixth")), "23514");
    expect((await first.done).code).toBe(0);
    expect(sql(`select count(*) from custom_questions where farm_id='${farmA}'`)).toBe("5");
  });
  it("accepts concurrent retries of the same fifth question", async () => {
    const first = concurrent("begin;" + asOwner() + insert(fifth));
    await first.started;
    sql(asOwner() + insert(fifth));
    expect((await first.done).code).toBe(0);
    expect(sql(`select count(*) from custom_questions where farm_id='${farmA}'`)).toBe("5");
  });
  it("serializes a plan downgrade against a concurrent owner insert", async () => {
    sql(`set role service_role; update farms set plan='ultimate' where id='${farmB}';
      insert into custom_questions(farm_id,text) select '${farmB}', 'Q' || g from generate_series(1,5) g;`);
    const first = concurrent(`begin; set role service_role; update farms set plan='basic' where id='${farmB}';`);
    await first.started;
    fails(asOwner(ownerB) + insert(toDbId(farmB, "cq_sixth"), farmB), "23514");
    expect((await first.done).code).toBe(0);
    expect(sql(`select plan || ':' || (select count(*) from custom_questions where farm_id='${farmB}') from farms where id='${farmB}'`)).toBe("basic:5");
  });
  it("keeps invoker security, the pinned search path and RLS", () => {
    expect(sql("select not prosecdef and proconfig @> array['search_path=\"\"'] from pg_proc where oid='private.enforce_custom_question_limit()'::regprocedure")).toBe("t");
    expect(sql("select relrowsecurity from pg_class where oid='public.custom_questions'::regclass")).toBe("t");
    expect(sql("select has_function_privilege('authenticated', 'private.enforce_custom_question_limit()', 'execute')")).toBe("f");
  });
});
