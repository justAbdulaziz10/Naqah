import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assertLocal, json, q, sql, sqlAsync } from './task-links-db.mjs';
const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222';
const OA = '00000000-0000-0000-0000-00000000000a', OB = '00000000-0000-0000-0000-00000000000b';
const call = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const tasks = ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3'];
const otherTask = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const at = '2026-11-08T06:00:00Z';
const ticket = (id) => ({ id, instruction: 'LOCAL TEST independent task', created_at: at, scheduled_for: null, status: 'open', closed_at: null, closed_via: null });
const pending = (extra = {}) => ({ id: call, purpose: 'instruction', message: 'LOCAL TEST grouped delivery', task_ticket_id: null, relay_id: null, next_attempt_at: at, state: 'pending', ...extra });
const changes = (extra = {}) => ({ task_tickets: tasks.map(ticket), pending_worker_calls: [pending({ covered_task_ids: tasks, batch_id: 'local:batch' })], ...extra });
const rpc = (change, revision = 0, event = null, farm = A) => `set role service_role; select apply_farm_changes(${q(farm)},${revision},${q(JSON.stringify(change))}::jsonb,${event ? q(event) : 'null'},'{"status":"saved"}');`;
const count = (table) => Number(sql(`select count(*) from ${table}`));
const links = () => json(`select coalesce(json_agg(task_ticket_id order by covered_order), '[]') from pending_worker_call_tasks where pending_call_id=${q(call)} and covered_order is not null`);
function fails(query, code) { expect(() => sql(query)).toThrow(new RegExp(code)); }

describe('task links on real disposable PostgreSQL', () => {
  beforeAll(() => assertLocal());
  it('backfills an existing single-task call without changing IDs or duplicating links', () => {
    const sentinel = '99999999-9999-4999-8999-999999999999';
    expect(count(`pending_worker_calls where id=${q(sentinel)}`)).toBe(1);
    expect(count(`pending_worker_call_tasks where pending_call_id=${q(sentinel)}`)).toBe(1);
    expect(sql(`select task_ticket_id from pending_worker_call_tasks where pending_call_id=${q(sentinel)}`)).toBe(sentinel);
    expect(count(`task_tickets where id=${q(sentinel)}`)).toBe(1);
    const migration = readFileSync(new URL('../migrations/20261108000000_pending_worker_call_tasks.sql', import.meta.url), 'utf8');
    const statement = migration.slice(migration.indexOf('insert into public.pending_worker_call_tasks'), migration.indexOf('on conflict do nothing;') + 'on conflict do nothing;'.length);
    sql(statement);
    expect(count(`pending_worker_call_tasks where pending_call_id=${q(sentinel)}`)).toBe(1);
    expect(sql(`select task_links_explicit from pending_worker_calls where id=${q(sentinel)}`)).toBe('f');
  });
  beforeEach(() => {
    sql(`delete from farms where id in (${q(A)},${q(B)}); insert into auth.users values (${q(OA)}),(${q(OB)}) on conflict do nothing;
      insert into farms(id,owner_id,plan) values (${q(A)},${q(OA)},'ultimate'),(${q(B)},${q(OB)},'ultimate');
      insert into task_tickets(id,farm_id,instruction) values (${q(otherTask)},${q(B)},'LOCAL TEST other owner');`);
  });
  it('stores three independent tickets and one call with three ordered links', () => {
    sql(rpc(changes(), 0, 'group'));
    expect(count(`task_tickets where farm_id=${q(A)}`)).toBe(3);
    expect(count(`pending_worker_calls where farm_id=${q(A)}`)).toBe(1);
    expect(links()).toEqual(tasks);
    expect(sql(`select batch_id from pending_worker_calls where id=${q(call)}`)).toBe('local:batch');
  });
  it('keeps calls without tasks valid, and refuses new relays on Basic', () => {
    const relay = randomUUID();
    const save = () => sql(rpc({ relays: [{ id: relay, at, message: 'LOCAL TEST relay', delivered: false }], pending_worker_calls: [pending({ relay_id: relay, batch_id: 'relay', covered_task_ids: [] })] }));
    sql(`update farms set plan='basic' where id=${q(A)}`);
    expect(save).toThrow(/23514/);
    sql(`update farms set plan='ultimate' where id=${q(A)}`);
    save();
    expect(count(`task_tickets where farm_id=${q(A)}`)).toBe(0);
    expect(links()).toEqual([]);
  });
  it('updates only the ordered relationships and deduplicates repeated IDs', () => {
    sql(rpc(changes()));
    sql(rpc({ pending_worker_calls: [pending({ covered_task_ids: [tasks[2], tasks[0], tasks[2]] })] }, 1));
    expect(links()).toEqual([tasks[2], tasks[0]]);
    sql(rpc({ pending_worker_calls: [pending({ covered_task_ids: [tasks[2], tasks[0]] })] }, 2));
    expect(links()).toEqual([tasks[2], tasks[0]]);
  });
  it('legacy-shaped updates preserve grouped links and batch ID', () => {
    sql(rpc(changes()));
    sql(rpc({ pending_worker_calls: [pending({ state: 'delivered', next_attempt_at: null })] }, 1));
    expect(links()).toEqual(tasks);
    expect(sql(`select batch_id from pending_worker_calls where id=${q(call)}`)).toBe('local:batch');
  });
  it('explicit empty clears only grouped associations, keeping the legacy link separately', () => {
    sql(rpc(changes({ pending_worker_calls: [pending({ task_ticket_id: tasks[0], covered_task_ids: tasks })] })));
    sql(rpc({ pending_worker_calls: [pending({ covered_task_ids: [] })] }, 1));
    expect(links()).toEqual([]);
    expect(count(`pending_worker_call_tasks where pending_call_id=${q(call)}`)).toBe(1);
    expect(sql(`select task_ticket_id from pending_worker_calls where id=${q(call)}`)).toBe(tasks[0]);
  });
  it('keeps legacy links in sync when old code inserts a single-task call', () => {
    sql(rpc(changes({ pending_worker_calls: [pending({ task_ticket_id: tasks[0] })] })));
    expect(count(`pending_worker_call_tasks where pending_call_id=${q(call)}`)).toBe(1);
    expect(sql(`select covered_order is null from pending_worker_call_tasks where pending_call_id=${q(call)}`)).toBe('t');
  });
  it('rolls back all tasks/call/links/event/revision when a link is invalid', () => {
    fails(rpc(changes({ pending_worker_calls: [pending({ covered_task_ids: [tasks[0], randomUUID()] })] }), 0, 'bad-link'), '23503');
    expect(count(`task_tickets where farm_id=${q(A)}`)).toBe(0);
    expect(count(`pending_worker_calls where farm_id=${q(A)}`)).toBe(0);
    expect(count(`voice_events where farm_id=${q(A)}`)).toBe(0);
    expect(sql(`select revision from farms where id=${q(A)}`)).toBe('0');
  });
  it('rejects foreign links inside the service RPC and direct service-role writes', () => {
    fails(rpc(changes({ pending_worker_calls: [pending({ covered_task_ids: [otherTask] })] })), '23503');
    sql(rpc(changes()));
    fails(rpc({ pending_worker_calls: [pending({ covered_task_ids: [tasks[0], otherTask] })] }, 1, 'bad-existing-group'), '23503');
    expect(links()).toEqual(tasks);
    expect(sql(`select revision from farms where id=${q(A)}`)).toBe('1');
    expect(count(`voice_events where farm_id=${q(A)} and event_id='bad-existing-group'`)).toBe(0);
    fails(`set role service_role; insert into pending_worker_call_tasks values (${q(A)},${q(call)},${q(otherTask)},9);`, '23503');
    fails(`set role service_role; update pending_worker_call_tasks set farm_id=${q(B)} where pending_call_id=${q(call)};`, '23503');
    fails(`set role service_role; insert into pending_worker_call_tasks values (${q(B)},${q(call)},${q(otherTask)},0);`, '23503');
    fails(`set role service_role; insert into pending_worker_call_tasks values (${q(A)},${q(call)},${q(tasks[0])},9);`, '23505');
  });
  it('owner A reads its links, owner B cannot, and neither owner nor anon can write', () => {
    sql(rpc(changes()));
    const owner = (id) => `set role authenticated; set request.jwt.claim.sub=${q(id)};`;
    expect(Number(sql(`${owner(OA)} select count(*) from pending_worker_call_tasks where pending_call_id=${q(call)}`))).toBe(3);
    expect(Number(sql(`${owner(OB)} select count(*) from pending_worker_call_tasks where pending_call_id=${q(call)}`))).toBe(0);
    const otherCall = randomUUID();
    sql(`insert into pending_worker_calls(id,farm_id,purpose,message,task_ticket_id) values (${q(otherCall)},${q(B)},'instruction','LOCAL TEST B single',${q(otherTask)})`);
    expect(Number(sql(`${owner(OB)} select count(*) from pending_worker_call_tasks where pending_call_id=${q(otherCall)}`))).toBe(1);
    expect(Number(sql(`${owner(OA)} select count(*) from pending_worker_call_tasks where pending_call_id=${q(otherCall)}`))).toBe(0);
    fails('set role anon; select * from pending_worker_call_tasks;', '42501');
    for (const role of [owner(OA), owner(OB), 'set role anon;']) {
      fails(`${role} insert into pending_worker_call_tasks values (${q(A)},${q(call)},${q(tasks[0])},7);`, '42501');
      fails(`${role} update pending_worker_call_tasks set covered_order=7;`, '42501');
      fails(`${role} delete from pending_worker_call_tasks;`, '42501');
    }
  });
  it('rejects stale revisions with no partial state changes', () => {
    sql(rpc(changes(), 0, 'first'));
    fails(rpc({ pending_worker_calls: [pending({ covered_task_ids: [] })] }, 0, 'stale'), 'NQ409');
    expect(links()).toEqual(tasks); expect(count(`voice_events where farm_id=${q(A)}`)).toBe(1);
  });
  it.each([null, 'text', [null], [{}], ['not-a-uuid']])('rejects malformed explicit arrays atomically: %j', (covered) => {
    fails(rpc(changes({ pending_worker_calls: [pending({ covered_task_ids: covered })] }), 0, 'malformed'), covered?.[0] === 'not-a-uuid' ? '22P02' : '22023');
    expect(count(`task_tickets where farm_id=${q(A)}`)).toBe(0);
    expect(count(`voice_events where farm_id=${q(A)}`)).toBe(0);
  });
  it('a replay cannot duplicate tasks/calls/links even at a fresh revision', () => {
    sql(rpc(changes(), 0, 'once'));
    fails(rpc(changes(), 1, 'once'), '23505');
    expect(count(`task_tickets where farm_id=${q(A)}`)).toBe(3); expect(links()).toEqual(tasks);
  });
  it('concurrent duplicate deliveries commit one event and leave one logical group', async () => {
    const result = await Promise.allSettled([sqlAsync(rpc(changes(), 0, 'race')), sqlAsync(rpc(changes(), 0, 'race'))]);
    expect(result.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(count(`voice_events where farm_id=${q(A)}`)).toBe(1);
    expect(count(`pending_worker_calls where farm_id=${q(A)}`)).toBe(1); expect(links()).toEqual(tasks);
  });
  it('has one group per batch and never changes a stored batch identity', () => {
    sql(rpc(changes()));
    fails(rpc({ pending_worker_calls: [pending({ batch_id: 'different' })] }, 1), '23514');
    fails(rpc({ pending_worker_calls: [pending({ id: randomUUID(), batch_id: 'local:batch' })] }, 1), '23505');
    expect(count(`pending_worker_calls where farm_id=${q(A)}`)).toBe(1);
  });
  it('task deletion removes only its association and nulls the legacy reference, retaining the call', () => {
    sql(rpc(changes({ pending_worker_calls: [pending({ task_ticket_id: tasks[0], covered_task_ids: tasks })] })));
    sql(`delete from task_tickets where id=${q(tasks[0])}`);
    expect(count(`pending_worker_calls where id=${q(call)}`)).toBe(1); expect(links()).toEqual(tasks.slice(1));
    expect(sql(`select task_ticket_id is null from pending_worker_calls where id=${q(call)}`)).toBe('t');
  });
  it('retains SECURITY INVOKER and service-only RPC permissions', () => {
    expect(sql("select prosecdef from pg_proc where oid='public.apply_farm_changes(uuid,bigint,jsonb,text,jsonb)'::regprocedure")).toBe('f');
    expect(sql("select has_function_privilege('authenticated','public.apply_farm_changes(uuid,bigint,jsonb,text,jsonb)','execute')")).toBe('f');
    expect(sql("select has_function_privilege('anon','public.apply_farm_changes(uuid,bigint,jsonb,text,jsonb)','execute')")).toBe('f');
    expect(sql("select has_function_privilege('service_role','public.apply_farm_changes(uuid,bigint,jsonb,text,jsonb)','execute')")).toBe('t');
    expect(sql("select has_function_privilege('authenticated','private.apply_farm_changes_before_task_links(uuid,bigint,jsonb,text,jsonb)','execute')")).toBe('f');
  });
});
