import { describe, it, expect, vi } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { executeTaskScopeAction, isRecurringTask, taskActionErrorKey, type TaskStoreOperations } from '../calendar-task-scope';
import { AllDaySeriesOverrideBlockedError } from '@/lib/all-day-series-block';
import type { CalendarTask } from '@/lib/jmap/types';
import { createRecurrenceRule } from '@/lib/recurrence-rule';
import type { IJMAPClient } from '@/lib/jmap/client-interface';
import { parseISO } from 'date-fns';
import { groupTasksByDueDay } from '@/lib/calendar-tasks';
import { normalizeCalendarEventLike } from '@/lib/calendar-event-normalization';
import stalwartFixtures from '@/lib/__fixtures__/stalwart-recurring-task.json';

function makeTask(overrides: Partial<CalendarTask> = {}): CalendarTask {
  return {
    id: 'master-task-1',
    '@type': 'Task',
    uid: 'master-task-1',
    title: 'Daily Jog 🏃',
    description: 'Jog in the park',
    due: '2026-10-01T08:00:00',
    start: null,
    duration: null,
    timeZone: 'Europe/Berlin',
    showWithoutTime: false,
    progress: 'needs-action',
    priority: 0,
    privacy: 'public',
    keywords: null,
    categories: null,
    color: null,
    created: null,
    updated: '2026-09-01T00:00:00Z',
    recurrenceRules: [createRecurrenceRule('daily')],
    alerts: null,
    relatedTo: null,
    calendarIds: { 'cal-1': true },
    ...overrides,
  };
}

describe('calendar-task-scope', () => {
  const dummyClient = {} as unknown as IJMAPClient;

  function createMockStore(tasks: CalendarTask[]): TaskStoreOperations {
    return {
      tasks,
      updateTask: vi.fn().mockResolvedValue(undefined),
      createTask: vi.fn().mockImplementation(async (_client, t) => ({ id: 'new-series-task', ...t } as CalendarTask)),
      deleteTask: vi.fn().mockResolvedValue(undefined),
    };
  }

  describe('isRecurringTask', () => {
    it('returns true when recurrenceRules is present', () => {
      const task = makeTask({ recurrenceRules: [createRecurrenceRule('daily')] });
      expect(isRecurringTask(task)).toBe(true);
    });

    it('returns true when recurrenceId is present on an occurrence', () => {
      const task = makeTask({ recurrenceRules: null, recurrenceId: '2026-10-02T08:00:00' });
      expect(isRecurringTask(task)).toBe(true);
    });

    it('returns false for single non-recurring task', () => {
      const task = makeTask({ recurrenceRules: null, recurrenceId: null });
      expect(isRecurringTask(task)).toBe(false);
    });
  });

  describe('edit_task scope handling', () => {
    it('applies updates to master task when scope is "all"', async () => {
      const master = makeTask();
      const occurrence: CalendarTask = {
        ...master,
        id: 'master-task-1:2026-10-03T08:00:00',
        originalId: 'master-task-1',
        recurrenceId: '2026-10-03T08:00:00',
      };
      const store = createMockStore([master]);

      await executeTaskScopeAction(dummyClient, store, {
        type: 'edit_task',
        task: occurrence,
        updates: { title: 'Daily Run 🏃' },
      }, 'all');

      expect(store.updateTask).toHaveBeenCalledWith(dummyClient, 'master-task-1', {
        title: 'Daily Run 🏃',
      });
      expect(store.createTask).not.toHaveBeenCalled();
    });

    it('truncates master recurrence and creates new series when scope is "this_and_future"', async () => {
      const master = makeTask();
      const occurrence: CalendarTask = {
        ...master,
        id: 'master-task-1:2026-10-03T08:00:00',
        originalId: 'master-task-1',
        recurrenceId: '2026-10-03T08:00:00',
        due: '2026-10-03T08:00:00',
      };
      const store = createMockStore([master]);

      await executeTaskScopeAction(dummyClient, store, {
        type: 'edit_task',
        task: occurrence,
        updates: { title: 'Evening Run 🏃', due: '2026-10-03T18:00:00' },
      }, 'this_and_future');

      // Master truncated with until right before occurrence
      expect(store.updateTask).toHaveBeenCalledWith(dummyClient, 'master-task-1', {
        recurrenceRules: [
          expect.objectContaining({
            until: '2026-10-03T07:59:59',
            count: null,
          }),
        ],
      });

      // New series created from occurrence onwards
      expect(store.createTask).toHaveBeenCalledWith(dummyClient, expect.objectContaining({
        title: 'Evening Run 🏃',
        due: '2026-10-03T18:00:00',
        recurrenceRules: master.recurrenceRules,
      }));
    });

    it('patches recurrenceOverrides on master when scope is "this"', async () => {
      const master = makeTask();
      const occurrence: CalendarTask = {
        ...master,
        id: 'master-task-1:2026-10-03T08:00:00',
        originalId: 'master-task-1',
        recurrenceId: '2026-10-03T08:00:00',
        due: '2026-10-03T08:00:00',
      };
      const store = createMockStore([master]);

      await executeTaskScopeAction(dummyClient, store, {
        type: 'edit_task',
        task: occurrence,
        updates: { title: 'Special Jog 🏃' },
      }, 'this');

      expect(store.updateTask).toHaveBeenCalledWith(dummyClient, 'master-task-1', {
        recurrenceOverrides: {
          '2026-10-03T08:00:00': expect.objectContaining({
            title: 'Special Jog 🏃',
          }),
        },
      });
      expect(store.createTask).not.toHaveBeenCalled();
    });

    it('strips calendarIds and @type from recurrenceOverrides when marking progress completed on scope "this"', async () => {
      const master = makeTask();
      const occurrence: CalendarTask = {
        ...master,
        id: 'master-task-1:2026-10-03T08:00:00',
        originalId: 'master-task-1',
        recurrenceId: '2026-10-03T08:00:00',
        due: '2026-10-03T08:00:00',
      };
      const store = createMockStore([master]);

      await executeTaskScopeAction(dummyClient, store, {
        type: 'edit_task',
        task: occurrence,
        updates: {
          '@type': 'Task',
          calendarIds: { 'cal-1': true },
          progress: 'completed',
        } as unknown as Partial<CalendarTask>,
      }, 'this');

      expect(store.updateTask).toHaveBeenCalledWith(dummyClient, 'master-task-1', {
        recurrenceOverrides: {
          '2026-10-03T08:00:00': {
            progress: 'completed',
          },
        },
      });
      const passedPatch = (store.updateTask as ReturnType<typeof vi.fn>).mock.calls[0][2];
      const overrideObj = passedPatch.recurrenceOverrides['2026-10-03T08:00:00'];
      expect(overrideObj).not.toHaveProperty('calendarIds');
      expect(overrideObj).not.toHaveProperty('@type');
    });
  });

  describe('delete_task scope handling', () => {
    it('deletes master task when scope is "all"', async () => {
      const master = makeTask();
      const occurrence: CalendarTask = {
        ...master,
        id: 'master-task-1:2026-10-03T08:00:00',
        originalId: 'master-task-1',
        recurrenceId: '2026-10-03T08:00:00',
      };
      const store = createMockStore([master]);

      await executeTaskScopeAction(dummyClient, store, {
        type: 'delete_task',
        task: occurrence,
      }, 'all');

      expect(store.deleteTask).toHaveBeenCalledWith(dummyClient, 'master-task-1');
    });

    it('truncates master recurrence when scope is "this_and_future"', async () => {
      const master = makeTask();
      const occurrence: CalendarTask = {
        ...master,
        id: 'master-task-1:2026-10-03T08:00:00',
        originalId: 'master-task-1',
        recurrenceId: '2026-10-03T08:00:00',
      };
      const store = createMockStore([master]);

      await executeTaskScopeAction(dummyClient, store, {
        type: 'delete_task',
        task: occurrence,
      }, 'this_and_future');

      expect(store.updateTask).toHaveBeenCalledWith(dummyClient, 'master-task-1', {
        recurrenceRules: [
          expect.objectContaining({
            until: '2026-10-03T07:59:59',
            count: null,
          }),
        ],
      });
      expect(store.deleteTask).not.toHaveBeenCalled();
    });

    it('excludes single occurrence in recurrenceOverrides when scope is "this"', async () => {
      const master = makeTask();
      const occurrence: CalendarTask = {
        ...master,
        id: 'master-task-1:2026-10-03T08:00:00',
        originalId: 'master-task-1',
        recurrenceId: '2026-10-03T08:00:00',
      };
      const store = createMockStore([master]);

      await executeTaskScopeAction(dummyClient, store, {
        type: 'delete_task',
        task: occurrence,
      }, 'this');

      expect(store.updateTask).toHaveBeenCalledWith(dummyClient, 'master-task-1', {
        recurrenceOverrides: {
          '2026-10-03T08:00:00': {
            excluded: true,
          },
        },
      });
      expect(store.deleteTask).not.toHaveBeenCalled();
    });
  });
});

describe('splitting a task series with "this_and_future" (tiger-iac#1323)', () => {
  const client = {} as unknown as IJMAPClient;

  /** Store that applies updates like Stalwart: patch paths, null removes the override. */
  function serverLikeStore(initial: CalendarTask[]) {
    const state = { tasks: initial };
    const store: TaskStoreOperations = {
      get tasks() { return state.tasks; },
      updateTask: vi.fn(async (_c, id, updates) => {
        state.tasks = state.tasks.map((t) => {
          if (t.id !== id) return t;
          const next: CalendarTask = { ...t, recurrenceOverrides: { ...(t.recurrenceOverrides ?? {}) } };
          for (const [k, v] of Object.entries(updates)) {
            if (!k.startsWith('recurrenceOverrides/')) { (next as unknown as Record<string, unknown>)[k] = v; continue; }
            const key = k.slice('recurrenceOverrides/'.length);
            if (v === null) delete next.recurrenceOverrides![key];
            else next.recurrenceOverrides![key] = v as never;
          }
          return next;
        });
      }),
      createTask: vi.fn(async (_c, t) => {
        const created = { ...t, id: `new-${state.tasks.length}` } as CalendarTask;
        state.tasks = [...state.tasks, created];
        return created;
      }),
      deleteTask: vi.fn(async (_c, id) => { state.tasks = state.tasks.filter((t) => t.id !== id); }),
    };
    return { store, state };
  }

  function fixtureMaster(): CalendarTask {
    return normalizeCalendarEventLike(structuredClone(stalwartFixtures.timedTask) as never) as unknown as CalendarTask;
  }

  function occurrenceOf(master: CalendarTask, recurrenceId: string): CalendarTask {
    return { ...master, id: `${master.id}:${recurrenceId}`, originalId: master.id, recurrenceId, due: recurrenceId };
  }

  function titlesByDay(tasks: CalendarTask[], from: string, to: string) {
    const map = groupTasksByDueDay(tasks, { start: parseISO(from), end: parseISO(to) });
    return Object.fromEntries([...map.entries()].sort().map(([day, list]) => [day, list.map((t) => t.title)]));
  }

  it('edit: every later day shows exactly the new series, the old overrides are gone', async () => {
    const master = fixtureMaster();
    const { store, state } = serverLikeStore([master]);

    await executeTaskScopeAction(client, store, { type: 'edit_task', task: occurrenceOf(master, '2026-10-14T09:00:00'), updates: { title: 'Neu' } }, 'this_and_future');

    expect(store.updateTask).toHaveBeenCalledWith(client, master.id, expect.objectContaining({
      'recurrenceOverrides/2026-10-14T09:00:00': null,
      'recurrenceOverrides/2026-10-21T09:00:00': null,
    }));
    expect(titlesByDay(state.tasks, '2026-10-01', '2026-10-31')).toEqual({
      '2026-10-07': ['Wöchentliche Team-Aufgabe'],
      '2026-10-14': ['Neu'],
      '2026-10-21': ['Neu'],
      '2026-10-28': ['Neu'],
    });
  });

  it('delete: nothing is left from the split day on', async () => {
    const master = fixtureMaster();
    const { store, state } = serverLikeStore([master]);

    await executeTaskScopeAction(client, store, { type: 'delete_task', task: occurrenceOf(master, '2026-10-14T09:00:00') }, 'this_and_future');

    expect(titlesByDay(state.tasks, '2026-10-01', '2026-10-31')).toEqual({
      '2026-10-07': ['Wöchentliche Team-Aufgabe'],
    });
  });

  it('a counted series keeps its total number of occurrences', async () => {
    const master = makeCountedMaster();
    const { store, state } = serverLikeStore([master]);

    await executeTaskScopeAction(client, store, { type: 'edit_task', task: occurrenceOf(master, '2026-10-15T09:00:00'), updates: { title: 'C2' } }, 'this_and_future');

    expect(state.tasks[1].recurrenceRules).toEqual([expect.objectContaining({ count: 2 })]);
    expect(Object.values(titlesByDay(state.tasks, '2026-09-25', '2027-01-31')).flat()).toEqual(['C', 'C', 'C2', 'C2']);
  });

  function progressByDay(tasks: CalendarTask[], from: string, to: string) {
    const map = groupTasksByDueDay(tasks, { start: parseISO(from), end: parseISO(to) });
    return Object.fromEntries([...map.entries()].sort().map(([day, list]) => [day, list.map((t) => `${t.title}|${t.progress}|${t.due?.slice(11, 16)}`)]));
  }

  /** What task-modal.tsx sends on save: always every form field, changed or not. */
  function modalPayload(occurrence: CalendarTask, changes: Partial<CalendarTask>): Partial<CalendarTask> {
    const { title, description, due, showWithoutTime, priority, progress, calendarIds, recurrenceRules } = occurrence;
    return { '@type': 'Task', title, description: description || '', due, showWithoutTime, priority, progress, calendarIds, recurrenceRules, id: occurrence.id, ...changes };
  }

  function dailyWithSecondDone(): CalendarTask {
    return makeTask({
      id: 'd', title: 'Daily', due: '2026-10-03T12:00:00', recurrenceRules: [createRecurrenceRule('daily', { count: 4 })],
      recurrenceOverrides: { '2026-10-04T12:00:00': { progress: 'completed', updated: '2026-10-01T21:00:00Z' } as never },
    });
  }

  it('edit from the first occurrence keeps later completions and leaves no empty series behind (UAT 3b)', async () => {
    const master = dailyWithSecondDone();
    const { store, state } = serverLikeStore([master]);

    const first = occurrenceOf(master, '2026-10-03T12:00:00');
    await executeTaskScopeAction(client, store, { type: 'edit_task', task: first, updates: modalPayload(first, { title: 'Neu' }) }, 'this_and_future');

    expect(state.tasks.map((t) => t.id)).not.toContain('d');
    expect(progressByDay(state.tasks, '2026-10-01', '2026-10-31')).toEqual({
      '2026-10-03': ['Neu|needs-action|12:00'],
      '2026-10-04': ['Neu|completed|12:00'],
      '2026-10-05': ['Neu|needs-action|12:00'],
      '2026-10-06': ['Neu|needs-action|12:00'],
    });
  });

  it('a new time moves the carried-over completions with the series', async () => {
    const master = dailyWithSecondDone();
    const { store, state } = serverLikeStore([master]);

    const first = occurrenceOf(master, '2026-10-03T12:00:00');
    await executeTaskScopeAction(client, store, { type: 'edit_task', task: first, updates: modalPayload(first, { due: '2026-10-03T14:00:00' }) }, 'this_and_future');

    expect(progressByDay(state.tasks, '2026-10-01', '2026-10-31')['2026-10-04']).toEqual(['Daily|completed|14:00']);
    expect(state.tasks.at(-1)?.recurrenceOverrides).toEqual({ '2026-10-04T14:00:00': { progress: 'completed' } });
  });

  it('editing a completed occurrence does not complete the whole new series', async () => {
    const master = dailyWithSecondDone();
    const { store, state } = serverLikeStore([master]);
    const second = { ...occurrenceOf(master, '2026-10-04T12:00:00'), progress: 'completed' as const };

    await executeTaskScopeAction(client, store, { type: 'edit_task', task: second, updates: modalPayload(second, { title: 'Neu' }) }, 'this_and_future');

    expect(progressByDay(state.tasks, '2026-10-01', '2026-10-31')).toEqual({
      '2026-10-03': ['Daily|needs-action|12:00'],
      '2026-10-04': ['Neu|completed|12:00'],
      '2026-10-05': ['Neu|needs-action|12:00'],
      '2026-10-06': ['Neu|needs-action|12:00'],
    });
  });

  it('"all" on a completed occurrence renames the series without completing it', async () => {
    const master = dailyWithSecondDone();
    const { store, state } = serverLikeStore([master]);
    const second = { ...occurrenceOf(master, '2026-10-04T12:00:00'), progress: 'completed' as const };

    await executeTaskScopeAction(client, store, { type: 'edit_task', task: second, updates: modalPayload(second, { title: 'Neu' }) }, 'all');

    expect(progressByDay(state.tasks, '2026-10-01', '2026-10-31')).toEqual({
      '2026-10-03': ['Neu|needs-action|12:00'],
      '2026-10-04': ['Neu|completed|12:00'],
      '2026-10-05': ['Neu|needs-action|12:00'],
      '2026-10-06': ['Neu|needs-action|12:00'],
    });
  });

  it('"all" with a new time on a later occurrence shifts the series instead of moving its start there', async () => {
    const master = dailyWithSecondDone();
    const { store, state } = serverLikeStore([master]);
    const third = occurrenceOf(master, '2026-10-05T12:00:00');

    await executeTaskScopeAction(client, store, { type: 'edit_task', task: third, updates: modalPayload(third, { due: '2026-10-05T15:00:00' }) }, 'all');

    expect(state.tasks[0].due).toBe('2026-10-03T15:00:00');
  });

  it('creates the new series before shortening the old one, so a failed create loses nothing', async () => {
    const master = dailyWithSecondDone();
    const { store, state } = serverLikeStore([master]);
    store.createTask = vi.fn().mockRejectedValue(new Error('rejected'));

    await expect(executeTaskScopeAction(client, store, { type: 'edit_task', task: occurrenceOf(master, '2026-10-05T12:00:00'), updates: { title: 'Neu' } }, 'this_and_future')).rejects.toThrow('rejected');
    expect(state.tasks).toEqual([master]);
  });

  it('delete from the first occurrence removes the series instead of leaving an empty one', async () => {
    const master = dailyWithSecondDone();
    const { store } = serverLikeStore([master]);

    await executeTaskScopeAction(client, store, { type: 'delete_task', task: occurrenceOf(master, '2026-10-03T12:00:00') }, 'this_and_future');

    expect(store.deleteTask).toHaveBeenCalledWith(client, 'd');
    expect(store.updateTask).not.toHaveBeenCalled();
  });

  function makeCountedMaster(): CalendarTask {
    return makeTask({ id: 'm', title: 'C', due: '2026-10-01T09:00:00', recurrenceRules: [createRecurrenceRule('weekly', { count: 4 })] });
  }
});

describe('taskActionErrorKey (tiger-iac#1323)', () => {
  it.each([
    ['the all-day block', new AllDaySeriesOverrideBlockedError(), 'notifications.single_occurrence_blocked'],
    ['any other failure, e.g. the network', new TypeError('Failed to fetch'), 'notifications.task_error'],
  ])('maps %s to a visible message', (_name, error, key) => {
    expect(taskActionErrorKey(error)).toBe(key);
  });

  it.each(readdirSync(join(process.cwd(), 'locales')))('every key it returns is translated in %s', (locale) => {
    const messages = JSON.parse(readFileSync(join(process.cwd(), 'locales', locale, 'common.json'), 'utf8'));
    for (const error of [new AllDaySeriesOverrideBlockedError(), new Error('x')]) {
      const [group, name] = taskActionErrorKey(error).split('.');
      expect(messages.calendar[group][name], `${locale}: calendar.${group}.${name}`).toBeTruthy();
    }
  });
});
