import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
// These aliases point at the clean inspected Task C commit, never copied/reimplemented transitions.
import { applyVoiceEvent, parseVoiceEvent, tasksToVerify, voiceStep } from '@task-c/contract';
import { submitOwnerInstructionBatch } from '@task-c/actions';
import { loadFarm } from '@/server/db/queries';
import { assertLocal, json, q, sql, sqlClient } from './task-links-db.mjs';
const now = new Date('2026-11-08T06:00:00Z');
const ownerContext = { party: 'owner', call: 'notification' };
let farm, client, event;
const count = (table) => Number(sql(`select count(*) from ${table} where farm_id=${q(farm)}`));
const load = async () => (await loadFarm(client, { id: farm })).workspace;
function makeEvent() {
  return parseVoiceEvent({ version: 1, eventId: 'local-group:' + randomUUID(), providerCallId: 'CA_LOCAL_GROUP', type: 'owner_instruction',
    message: 'LOCAL TEST approved three instructions', actionable: true, scheduledFor: null,
    deliveryMessage: 'LOCAL TEST tell the worker all three instructions in one call',
    items: [1, 2, 3].map((i) => ({ message: `LOCAL TEST independent task ${i}`, actionable: true, scheduledFor: null })),
  });
}
describe('pinned Task C accepted events through Task A storage on real local PostgreSQL', () => {
  beforeAll(() => assertLocal());
  beforeEach(() => {
    const owner = randomUUID(); farm = randomUUID(); client = sqlClient(); event = makeEvent();
    sql(`insert into auth.users values (${q(owner)}); insert into farms(id,owner_id,plan) values (${q(farm)},${q(owner)},'ultimate');`);
  });
  it('retains exactly three tasks and one ordered batch call after accepted event, reload and replay', async () => {
    expect(await applyVoiceEvent(client, farm, ownerContext, event, now)).toEqual({ status: 'saved' });
    const ws = await load();
    expect(ws.taskTickets).toHaveLength(3); expect(ws.pendingWorkerCalls).toHaveLength(1);
    const call = ws.pendingWorkerCalls[0];
    expect(call.batchId).toBe(event.eventId); expect(call.taskTicketId).toBeNull(); expect(call.coveredTaskIds).toHaveLength(3);
    expect(call.coveredTaskIds.map((id) => ws.taskTickets.find((t) => t.id === id).instruction)).toEqual(event.items.map((item) => item.message));
    expect(await applyVoiceEvent(client, farm, ownerContext, event, now)).toEqual({ status: 'saved' });
    expect(voiceStep(ws, now, event).result).toEqual({ status: 'unchanged' });
    expect(submitOwnerInstructionBatch(ws, now, event.items, event.eventId).created).toBe(false);
    expect(count('task_tickets')).toBe(3); expect(count('pending_worker_calls')).toBe(1); expect(count('pending_worker_call_tasks')).toBe(3); expect(count('voice_events')).toBe(1);
  });
  it('concurrent duplicate accepted events share one committed group and replay outcome', async () => {
    const result = await Promise.all([applyVoiceEvent(client, farm, ownerContext, event, now), applyVoiceEvent(client, farm, ownerContext, event, now)]);
    expect(result).toEqual([{ status: 'saved' }, { status: 'saved' }]);
    expect(count('task_tickets')).toBe(3); expect(count('pending_worker_calls')).toBe(1); expect(count('pending_worker_call_tasks')).toBe(3); expect(count('voice_events')).toBe(1);
  });
  it('preserves grouped associations after every retry, No Answer ticket and callback reload', async () => {
    await applyVoiceEvent(client, farm, ownerContext, event, now);
    const original = (await load()).pendingWorkerCalls[0];
    for (let i = 0; i < 4; i++) {
      await applyVoiceEvent(client, farm, { party: 'system' }, parseVoiceEvent({ version: 1, eventId: `retry:${i}:${farm}`, providerCallId: `CA_LOCAL_TRY_${i}`, type: 'worker_call_attempt', pendingCallId: original.id, answered: false }), new Date(now.getTime() + i * 1_200_000));
      expect((await load()).pendingWorkerCalls[0].coveredTaskIds).toEqual(original.coveredTaskIds);
    }
    expect(count('no_answer_tickets')).toBe(1);
    // The unresolved callback must retain its group even when older than RECENT=200.
    sql(`update pending_worker_calls set created_at=now()-interval '2 days' where id=${q(original.id)};
      insert into pending_worker_calls(farm_id,purpose,message,state)
      select ${q(farm)},'instruction','LOCAL TEST unrelated delivered history','delivered' from generate_series(1,201);`);
    expect((await load()).pendingWorkerCalls.find((c) => c.id === original.id).coveredTaskIds).toEqual(original.coveredTaskIds);
    await applyVoiceEvent(client, farm, { party: 'worker' }, parseVoiceEvent({ version: 1, eventId: 'callback:' + farm, providerCallId: 'CA_LOCAL_CALLBACK', type: 'worker_callback' }), new Date(now.getTime() + 5_000_000));
    const after = await load();
    expect(after.pendingWorkerCalls.find((c) => c.id === original.id).coveredTaskIds).toEqual(original.coveredTaskIds);
    expect(after.taskTickets.every((t) => t.status === 'open')).toBe(true);
    expect(after.noAnswerTickets[0].status).toBe('closed');
  });
  it('instruction delivery does not complete any of the three tasks', async () => {
    await applyVoiceEvent(client, farm, ownerContext, event, now);
    const call = (await load()).pendingWorkerCalls[0];
    await applyVoiceEvent(client, farm, { party: 'system' }, parseVoiceEvent({ version: 1, eventId: 'answered:' + farm, providerCallId: 'CA_LOCAL_ANSWER', type: 'worker_call_attempt', pendingCallId: call.id, answered: true }), now);
    const after = await load(); expect(after.pendingWorkerCalls[0].state).toBe('delivered');
    expect(after.pendingWorkerCalls[0].coveredTaskIds).toEqual(call.coveredTaskIds); expect(after.taskTickets.every((t) => t.status === 'open')).toBe(true);
  });
  it('keeps all scheduled grouped tasks awaiting instruction delivery after reload', async () => {
    event = parseVoiceEvent({ ...event, items: event.items.map((item) => ({ ...item, scheduledFor: '2026-11-08T06:10:00Z' })) });
    await applyVoiceEvent(client, farm, ownerContext, event, now);
    const dueAt = new Date('2026-11-08T06:20:00Z');
    const beforeDelivery = await load();
    expect(tasksToVerify(beforeDelivery, dueAt)).toEqual([]);
    const call = beforeDelivery.pendingWorkerCalls[0];
    await applyVoiceEvent(client, farm, { party: 'system' }, parseVoiceEvent({ version: 1, eventId: 'scheduled-delivery:' + farm, providerCallId: 'CA_LOCAL_SCHEDULED', type: 'worker_call_attempt', pendingCallId: call.id, answered: true }), dueAt);
    const afterDelivery = await load();
    expect(tasksToVerify(afterDelivery, dueAt).map((task) => task.id).sort()).toEqual(call.coveredTaskIds.toSorted());
    expect(afterDelivery.taskTickets.every((task) => task.status === 'open')).toBe(true);
  });
  it('Basic accepted instruction batch creates one relay call and no task associations', async () => {
    sql(`update farms set plan='basic' where id=${q(farm)}`);
    await applyVoiceEvent(client, farm, ownerContext, event, now);
    const after = await load(); expect(after.taskTickets).toHaveLength(0); expect(after.pendingWorkerCalls).toHaveLength(1);
    expect(after.pendingWorkerCalls[0].coveredTaskIds).toEqual([]); expect(after.pendingWorkerCalls[0].batchId).toBe(event.eventId);
    expect(after.relays).toHaveLength(1); expect(count('pending_worker_call_tasks')).toBe(0);
    expect(json(`select count(*) from pending_worker_calls where farm_id=${q(farm)}`)).toBe(1);
  });
});
