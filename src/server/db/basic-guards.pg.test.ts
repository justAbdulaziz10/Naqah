import { execFileSync } from "node:child_process";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

// LOCAL ONLY. Uses the same disposable Postgres/bootstrap approach as round-trip.pg.test.ts.
const database = process.env.NAQAH_TEST_DB;
const owner = "00000000-0000-0000-0000-00000000000a";
const basic = "11111111-1111-4111-8111-111111111111";
const ultimate = "22222222-2222-4222-8222-222222222222";
const other = "00000000-0000-0000-0000-00000000000b";
const task = "33333333-3333-4333-8333-333333333333";
const relay = "44444444-4444-4444-8444-444444444444";
const call = "55555555-5555-4555-8555-555555555555";
const args = () => ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose", "-d", database!];
function sql(query: string) {
  return execFileSync("psql", args(), { input: query, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
}
const violates = (query: string) => expect(() => sql(query)).toThrow(/23514/);
const insertTask = (farm: string, id = task) => `insert into public.task_tickets(id, farm_id, instruction) values ('${id}', '${farm}', 'Do it')`;
const insertRelay = (farm: string) => `insert into public.relays(id, farm_id, message) values ('${relay}', '${farm}', 'Hello')`;
const insertCall = (farm: string, purpose = "instruction") => `insert into public.pending_worker_calls(id, farm_id, purpose, message) values ('${call}', '${farm}', '${purpose}', 'Do it')`;
const apply = (farm: string, changes: object) => `set role service_role; select public.apply_farm_changes('${farm}', 0, '${JSON.stringify(changes)}'::jsonb);`;

describe.skipIf(!database)("Basic guards on disposable Postgres", () => {
  beforeAll(() => {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(database!)) throw new Error("Unsafe test database name");
    for (const host of [process.env.PGHOST ?? "127.0.0.1", process.env.PGHOSTADDR ?? ""]) {
      if (!/^(|localhost|127\.\d+\.\d+\.\d+|::1)$/.test(host)) throw new Error("Local Postgres only");
    }
    expect(sql("select inet_server_addr()::text")).toMatch(/^(127\.|::1$)/);
  });
  beforeEach(() => {
    sql(`truncate auth.users cascade;
      insert into auth.users values ('${owner}'), ('${other}');
      insert into farms(id, owner_id, plan) values ('${basic}', '${owner}', 'basic'), ('${ultimate}', '${other}', 'ultimate');`);
  });

  it("refuses new tasks, relays and follow-up calls on Basic", () => {
    violates(insertTask(basic));
    violates(insertRelay(basic));
    violates(insertCall(basic));
    violates(insertCall(basic, "task_verification"));
    expect(sql(`select count(*) from public.task_tickets where farm_id = '${basic}'`)).toBe("0");
  });

  it("allows them on Ultimate", () => {
    sql(`${insertTask(ultimate)}; ${insertRelay(ultimate)}; ${insertCall(ultimate)};`);
    expect(sql(`select count(*) from public.pending_worker_calls where farm_id = '${ultimate}'`)).toBe("1");
  });

  it("also refuses them through apply_farm_changes, and the whole save rolls back", () => {
    violates(apply(basic, { task_tickets: [{ id: task, farm_id: basic, instruction: "Do it", status: "open" }] }));
    expect(sql(`select revision from public.farms where id = '${basic}'`)).toBe("0");
  });

  it("keeps rows from before a downgrade, and they can still be updated", () => {
    sql(`${insertTask(ultimate)}; ${insertCall(ultimate)};`);
    sql(`update public.farms set plan = 'basic' where id = '${ultimate}';`);
    const changes = {
      task_tickets: [{ id: task, farm_id: ultimate, instruction: "Do it", created_at: "2026-11-09T00:00:00Z", status: "closed", closed_at: "2026-11-10T00:00:00Z", closed_via: "worker_report" }],
      pending_worker_calls: [{ id: call, farm_id: ultimate, purpose: "instruction", message: "Do it", state: "delivered", next_attempt_at: null, created_at: "2026-11-09T00:00:00Z" }],
    };
    expect(sql(apply(ultimate, changes))).toBe("1");
    expect(sql(`select status from public.task_tickets where id = '${task}'`)).toBe("closed");
    expect(sql(`select state from public.pending_worker_calls where id = '${call}'`)).toBe("delivered");
    violates(insertTask(ultimate, "66666666-6666-4666-8666-666666666666"));
  });
});
