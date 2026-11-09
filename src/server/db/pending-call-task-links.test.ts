import { describe, expect, it } from 'vitest';
import { createEmptyWorkspace } from '@/domain/seed';
import type { PendingWorkerCall } from '@/domain/types';
import { voiceStep, type VoiceEvent } from '@/server/voice/contract';
import { diffWorkspace, hasChanges } from './diff';
import { toDbId } from './ids';
import { historyRows, workspaceFromRows } from './mappers';
import type { FarmRows } from './rows';

const farm = '11111111-1111-4111-8111-111111111111';
const id = (value: string) => toDbId(farm, value);
const call = (extra: Partial<PendingWorkerCall> = {}): PendingWorkerCall => ({
  id: 'pwc_group', purpose: 'instruction', message: 'Deliver the approved instructions', taskTicketId: null,
  relayId: null, attempts: [], nextAttemptAt: '2026-11-08T09:00:00Z', state: 'pending', ...extra,
});
const rows: FarmRows = {
  farm: {
    id: farm, owner_id: 'o', plan: 'ultimate', plan_selected_at: null, setup_complete: true, owner_name: '', owner_phone: '', name: '', location: '',
    latitude: null, longitude: null, supplier_name: '', supplier_phone: '', window_day: null, window_start: null, window_end: null,
    last_update_at: null, owner_allowance_used_at: null, missed_notification_at: null, call_day: null, call_time: null,
    herd_count: null, herd_count_reviewed_at: null, primary_worker_id: null, created_at: '2026-11-08T00:00:00Z', revision: 0,
  },
  workers: [], camels: [], resources: [], customQuestions: [], criteria: [], emergencies: [], reports: [], calls: [],
  taskTickets: [], noAnswerTickets: [], pendingWorkerCalls: [], reportCallRuns: [], relays: [], events: [],
};
describe('pending call relational task mapping', () => {
  it('normalizes and deduplicates ordered IDs without inferring links from message text', () => {
    const ws = createEmptyWorkspace('ultimate');
    ws.pendingWorkerCalls.push(call({ batchId: 'CA-real:instructions', coveredTaskIds: ['tsk_b', 'tsk_a', 'tsk_b', id('tsk_a')] }));
    expect(historyRows(ws, farm).pendingWorkerCalls[0]).toMatchObject({ batch_id: 'CA-real:instructions', covered_task_ids: [id('tsk_b'), id('tsk_a')] });
  });
  it('omits new payload keys for old calls, distinguishing absent from explicit empty', () => {
    const ws = createEmptyWorkspace('basic'); ws.pendingWorkerCalls.push(call());
    expect(historyRows(ws, farm).pendingWorkerCalls[0]).not.toHaveProperty('covered_task_ids');
    expect(historyRows(ws, farm).pendingWorkerCalls[0]).not.toHaveProperty('batch_id');
    ws.pendingWorkerCalls[0].coveredTaskIds = [];
    expect(historyRows(ws, farm).pendingWorkerCalls[0]).toHaveProperty('covered_task_ids', []);
  });
  it('detects a relationship-only change and an ordered-array change through the existing diff', () => {
    const before = createEmptyWorkspace('ultimate'); before.pendingWorkerCalls.push(call({ coveredTaskIds: ['tsk_a', 'tsk_b'] }));
    const after = structuredClone(before); after.pendingWorkerCalls[0].coveredTaskIds = ['tsk_b', 'tsk_a'];
    const changes = diffWorkspace(before, after, farm);
    expect(hasChanges(changes)).toBe(true);
    expect(changes.pending_worker_calls).toHaveLength(1);
    expect(changes.pending_worker_calls![0]).toMatchObject({ covered_task_ids: [id('tsk_b'), id('tsk_a')] });
    expect(changes.task_tickets).toEqual([]);
  });
  it('reconstructs explicit array order separately from the legacy-only relationship', () => {
    const mapped = workspaceFromRows({ ...rows, pendingWorkerCalls: [{
      id: id('pwc_group'), farm_id: farm, purpose: 'instruction', message: 'Group', task_ticket_id: id('tsk_legacy'),
      relay_id: null, state: 'pending', next_attempt_at: null, batch_id: 'batch', task_links_explicit: true, worker_call_attempts: [],
      pending_worker_call_tasks: [
        { farm_id: farm, pending_call_id: id('pwc_group'), task_ticket_id: id('tsk_a'), covered_order: 1 },
        { farm_id: farm, pending_call_id: id('pwc_group'), task_ticket_id: id('tsk_legacy'), covered_order: null },
        { farm_id: farm, pending_call_id: id('pwc_group'), task_ticket_id: id('tsk_b'), covered_order: 0 },
      ],
    }] });
    expect(mapped.pendingWorkerCalls[0]).toMatchObject({ taskTicketId: id('tsk_legacy'), batchId: 'batch', coveredTaskIds: [id('tsk_b'), id('tsk_a')] });
  });
  it.each([false, true])('preserves legacy/empty shape on load (explicit=%s)', (explicit) => {
    const loaded = workspaceFromRows({ ...rows, pendingWorkerCalls: [{
      id: id('pwc_group'), farm_id: farm, purpose: 'instruction', message: 'Single', task_ticket_id: id('tsk_legacy'),
      relay_id: null, state: 'pending', next_attempt_at: null, task_links_explicit: explicit, worker_call_attempts: [],
      pending_worker_call_tasks: [{ farm_id: farm, pending_call_id: id('pwc_group'), task_ticket_id: id('tsk_legacy'), covered_order: null }],
    }] }).pendingWorkerCalls[0];
    expect(loaded.taskTicketId).toBe(id('tsk_legacy'));
    if (explicit) expect(loaded.coveredTaskIds).toEqual([]);
    else expect(loaded).not.toHaveProperty('coveredTaskIds');
  });
  it('maps one Task C instruction batch onto one persisted call and rejects a replay', () => {
    const now = new Date('2026-11-08T09:00:00Z');
    const items = [
      { message: 'Fill the water', actionable: true, scheduledFor: null },
      { message: 'Check Wadhah tomorrow', actionable: true, scheduledFor: '2026-11-09T06:00:00.000Z' },
      { message: 'Bring feed if it is low', actionable: true, scheduledFor: null },
    ];
    const event = (eventId: string): VoiceEvent => ({
      version: 1, eventId, providerCallId: 'CA_LOCAL', type: 'owner_instruction',
      message: items.map((item) => item.message).join('\n'), actionable: true, scheduledFor: null,
      deliveryMessage: 'Tell the worker all three instructions', items,
    });
    const ultimate = createEmptyWorkspace('ultimate');
    const saved = voiceStep(ultimate, now, event('local-group:ultimate'));
    expect(saved.result).toEqual({ status: 'saved' });
    expect(saved.ws.taskTickets.map((task) => task.instruction)).toEqual(items.map((item) => item.message));
    expect(saved.ws.taskTickets.every((task) => task.status === 'open')).toBe(true);
    expect(saved.ws.pendingWorkerCalls).toHaveLength(1);
    const row = diffWorkspace(ultimate, saved.ws, farm).pending_worker_calls?.[0] as { batch_id?: string; covered_task_ids?: string[]; message?: string };
    expect(row.batch_id).toBe('local-group:ultimate');
    expect(row.message).toBe('Tell the worker all three instructions');
    expect(row.covered_task_ids).toEqual(saved.ws.taskTickets.map((task) => id(task.id)));
    expect(row.covered_task_ids?.join(' ')).not.toContain('Fill the water');
    const replay = voiceStep(saved.ws, now, event('local-group:ultimate'));
    expect(replay.result).toEqual({ status: 'unchanged' });
    expect(replay.ws.taskTickets).toHaveLength(3);
    expect(replay.ws.pendingWorkerCalls).toHaveLength(1);
    expect(hasChanges(diffWorkspace(saved.ws, replay.ws, farm))).toBe(false);

    const basicBefore = createEmptyWorkspace('basic');
    const basic = voiceStep(basicBefore, now, event('local-group:basic'));
    expect(basic.result).toEqual({ status: 'saved' });
    expect(basic.ws.taskTickets).toHaveLength(0);
    expect(basic.ws.relays).toHaveLength(1);
    expect(basic.ws.pendingWorkerCalls).toHaveLength(1);
    const basicRow = diffWorkspace(basicBefore, basic.ws, farm).pending_worker_calls?.[0] as { batch_id?: string; covered_task_ids?: string[] };
    expect(basicRow.batch_id).toBe('local-group:basic');
    expect(basicRow.covered_task_ids).toEqual([]);
    expect(voiceStep(basic.ws, now, event('local-group:basic')).result).toEqual({ status: 'unchanged' });
    expect(basic.ws.taskTickets).toHaveLength(0);
  });
});
