import { describe, it, expect, vi } from 'vitest';
import { executeTaskScopeAction, isRecurringTask, type TaskStoreOperations } from '../calendar-task-scope';
import type { CalendarTask } from '@/lib/jmap/types';
import { createRecurrenceRule } from '@/lib/recurrence-rule';
import type { IJMAPClient } from '@/lib/jmap/client-interface';

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
