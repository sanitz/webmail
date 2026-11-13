import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeTaskScopeAction, type TaskStoreOperations } from '../calendar-task-scope';
import type { CalendarTask } from '@/lib/jmap/types';
import type { IJMAPClient } from '@/lib/jmap/client-interface';
import { createRecurrenceRule } from '@/lib/recurrence-rule';

// Moving a timed series is wall-clock arithmetic: 10:00 stays 10:00 when the
// change lies on the other side of a DST switch than the series' start
// (tiger-iac#1810). Berlin leaves summer time on 2026-10-25.

const client = {} as IJMAPClient;
let originalTZ: string | undefined;
beforeEach(() => { originalTZ = process.env.TZ; process.env.TZ = 'Europe/Berlin'; });
afterEach(() => { process.env.TZ = originalTZ; });

function series(overrides: Partial<CalendarTask> = {}): CalendarTask {
  return {
    id: 'm', '@type': 'Task', uid: 'm', title: 'Water plants', description: '',
    start: '2026-10-20T10:00:00', due: '2026-10-20T10:00:00', showWithoutTime: false, timeZone: 'Europe/Berlin',
    progress: 'needs-action', priority: 0, calendarIds: { c: true },
    recurrenceRules: [createRecurrenceRule('weekly')], ...overrides,
  } as unknown as CalendarTask;
}

function store(tasks: CalendarTask[]): TaskStoreOperations {
  return {
    tasks,
    updateTask: vi.fn().mockResolvedValue(undefined),
    createTask: vi.fn().mockImplementation(async (_c, t) => ({ id: 'n', ...t } as CalendarTask)),
    deleteTask: vi.fn().mockResolvedValue(undefined),
  };
}

const occurrence = (master: CalendarTask, at: string): CalendarTask =>
  ({ ...master, id: `m:${at}`, seriesId: 'm', recurrenceId: at, due: at });

describe('moving a timed task series across a DST switch (tiger-iac#1810)', () => {
  it('"all": a winter occurrence moved a week later moves the summer series a week, still at 10:00', async () => {
    const master = series();
    const s = store([master]);
    await executeTaskScopeAction(client, s, { type: 'edit_task', task: occurrence(master, '2026-11-03T10:00:00'), updates: { due: '2026-11-10T10:00:00' } }, 'all');
    expect(s.updateTask).toHaveBeenCalledWith(client, 'm', { due: '2026-10-27T10:00:00', start: '2026-10-27T10:00:00' });
  });

  it('"this and following": overrides from summer time keep their 10:00 in the new series', async () => {
    const master = series({ recurrenceOverrides: { '2026-11-10T10:00:00': { title: 'Big pot' } } as CalendarTask['recurrenceOverrides'] });
    const s = store([master]);
    await executeTaskScopeAction(client, s, { type: 'edit_task', task: occurrence(master, '2026-10-20T10:00:00'), updates: { due: '2026-11-04T10:00:00' } }, 'this_and_future');
    const created = vi.mocked(s.createTask).mock.calls[0][1];
    expect(created.due).toBe('2026-11-04T10:00:00');
    expect(created.start).toBe('2026-11-04T10:00:00');
    expect(Object.keys(created.recurrenceOverrides ?? {})).toEqual(['2026-11-25T10:00:00']);
  });
});
