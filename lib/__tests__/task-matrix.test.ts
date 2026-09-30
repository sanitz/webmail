import { describe, it, expect } from 'vitest';
import { executeTaskScopeAction, type TaskStoreOperations, type PendingTaskScopeAction } from '../calendar-task-scope';
import { groupTasksByDueDay } from '../calendar-tasks';
import { AllDaySeriesOverrideBlockedError } from '../all-day-series-block';
import type { CalendarTask } from '@/lib/jmap/types';
import type { IJMAPClient } from '@/lib/jmap/client-interface';
import { createRecurrenceRule } from '@/lib/recurrence-rule';
import { normalizeCalendarTask } from '@/lib/jmap/client';
import stalwartFixtures from '../__fixtures__/stalwart-recurring-task.json';

const range = {
  start: new Date('2026-10-01T00:00:00'),
  end: new Date('2026-10-31T23:59:59'),
};

interface TestStore extends TaskStoreOperations {
  patches: Record<string, unknown>[];
  created: Partial<CalendarTask>[];
  deleted: string[];
}

/**
 * Store double that implements Stalwart v0.16.24's behavior, as measured against
 * a local v0.16.24 container (tiger-iac#1311): an override with content on a
 * master with showWithoutTime: true replaces the series; exclusions and timed
 * series are stored correctly.
 */
function createStalwartSimulatingStore(initialTasks: CalendarTask[]): TestStore {
  const store: TestStore = {
    tasks: JSON.parse(JSON.stringify(initialTasks)),
    patches: [],
    created: [],
    deleted: [],
    async updateTask(_client: IJMAPClient, id: string, updates: Partial<CalendarTask>) {
      store.patches.push(updates as Record<string, unknown>);
      store.tasks = store.tasks.map((task) => {
        if (task.id !== id) return task;

        const next: Record<string, unknown> = { ...task };
        const updatesRecord = updates as Record<string, unknown>;

        const willHaveShowWithoutTime = 'showWithoutTime' in updatesRecord
          ? updatesRecord.showWithoutTime
          : task.showWithoutTime;

        const overrideEntries = Object.entries(updatesRecord).flatMap(([k, v]) => {
          if (k.startsWith('recurrenceOverrides/')) return [v];
          if (k === 'recurrenceOverrides') return Object.values(v as Record<string, unknown>);
          return [];
        }) as Record<string, unknown>[];
        const hasContentOverride = overrideEntries.some((entry) => entry.excluded !== true);

        if (willHaveShowWithoutTime && hasContentOverride) {
          // Stalwart bug: master is wiped and replaced by override!
          return {
            id: task.id,
            title: 'CORRUPTED_SERIES_WIPED_BY_STALWART',
          } as unknown as CalendarTask;
        }

        // Apply normal updates and RFC 8620 patch paths
        for (const [k, v] of Object.entries(updatesRecord)) {
          if (k.startsWith('recurrenceOverrides/')) {
            const subKey = k.slice('recurrenceOverrides/'.length);
            next.recurrenceOverrides = {
              ...(next.recurrenceOverrides as Record<string, unknown> || {}),
              [subKey]: v,
            };
          } else {
            next[k] = v;
          }
        }
        return next as unknown as CalendarTask;
      });
    },
    async createTask(_client: IJMAPClient, task: Partial<CalendarTask>) {
      store.created.push(task);
      const newTask = {
        id: `created-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        ...task,
      } as CalendarTask;
      store.tasks.push(newTask);
      return newTask;
    },
    async deleteTask(_client: IJMAPClient, id: string) {
      store.deleted.push(id);
      store.tasks = store.tasks.filter((t) => t.id !== id);
    },
  };
  return store;
}

describe('Automated Task Recurrence Matrix (tiger-bulwark A.4a.2)', () => {
  type MatrixCase = {
    name: string;
    fixtureKey?: 'timedTask' | 'allDayTask';
    customMaster?: CalendarTask;
    occurrenceDate: string; // YYYY-MM-DD
    action: PendingTaskScopeAction;
    scope: 'this' | 'this_and_future' | 'all';
    verify: (store: TestStore) => void;
    /** Refused by the client while Stalwart loses all-day series (tiger-iac#1311). */
    expectBlocked?: boolean;
  };

  const cases: MatrixCase[] = [
    // ─── 1. TIMED TASKS ───
    {
      name: 'Timed: Edit title of single occurrence ("this")',
      fixtureKey: 'timedTask',
      occurrenceDate: '2026-10-14',
      action: {
        type: 'edit_task',
        task: {} as CalendarTask, // filled in runner
        updates: { title: 'Geänderte Einzelinstanz' },
      },
      scope: 'this',
      verify: (store) => {
        expect(store.tasks[0].title).toBe('Wöchentliche Team-Aufgabe');
        expect(store.tasks[0].recurrenceRules).toBeDefined();
        const expanded = groupTasksByDueDay(store.tasks, range);
        const occ14 = expanded.get('2026-10-14');
        expect(occ14).toBeDefined();
        expect(occ14![0].title).toBe('Geänderte Einzelinstanz');
        const occ07 = expanded.get('2026-10-07');
        expect(occ07![0].title).toBe('Wöchentliche Team-Aufgabe');
      },
    },
    {
      name: 'Timed: Move single occurrence to different day ("this")',
      fixtureKey: 'timedTask',
      occurrenceDate: '2026-10-14',
      action: {
        type: 'edit_task',
        task: {} as CalendarTask,
        updates: { due: '2026-10-15T09:00:00' },
      },
      scope: 'this',
      verify: (store) => {
        const expanded = groupTasksByDueDay(store.tasks, range);
        expect(expanded.get('2026-10-14')).toBeUndefined();
        expect(expanded.get('2026-10-15')).toBeDefined();
        expect(expanded.get('2026-10-15')![0].due).toBe('2026-10-15T09:00:00');
        expect(expanded.get('2026-10-07')).toBeDefined();
      },
    },
    {
      name: 'Timed: Delete single occurrence ("this")',
      fixtureKey: 'timedTask',
      occurrenceDate: '2026-10-14',
      action: {
        type: 'delete_task',
        task: {} as CalendarTask,
      },
      scope: 'this',
      verify: (store) => {
        const expanded = groupTasksByDueDay(store.tasks, range);
        expect(expanded.get('2026-10-14')).toBeUndefined();
        expect(expanded.get('2026-10-07')).toBeDefined();
        expect(expanded.get('2026-10-21')).toBeDefined();
      },
    },
    {
      name: 'Timed: Edit series from occurrence onwards ("this_and_future")',
      fixtureKey: 'timedTask',
      occurrenceDate: '2026-10-28',
      action: {
        type: 'edit_task',
        task: {} as CalendarTask,
        updates: { title: 'Neuer Titel ab Ende Oktober' },
      },
      scope: 'this_and_future',
      verify: (store) => {
        expect(store.created.length).toBe(1);
        const expanded = groupTasksByDueDay(store.tasks, range);
        expect(expanded.get('2026-10-07')![0].title).toBe('Wöchentliche Team-Aufgabe');
        expect(expanded.get('2026-10-28')![0].title).toBe('Neuer Titel ab Ende Oktober');
      },
    },
    {
      name: 'Timed: Edit entire series ("all")',
      fixtureKey: 'timedTask',
      occurrenceDate: '2026-10-28',
      action: {
        type: 'edit_task',
        task: {} as CalendarTask,
        updates: { title: 'Komplett umbenannte Serie' },
      },
      scope: 'all',
      verify: (store) => {
        const expanded = groupTasksByDueDay(store.tasks, range);
        expect(expanded.get('2026-10-07')![0].title).toBe('Komplett umbenannte Serie');
        expect(expanded.get('2026-10-28')![0].title).toBe('Komplett umbenannte Serie');
      },
    },

    // ─── 2. MIDNIGHT TASKS (showWithoutTime: false, due T00:00:00, as written by the former workaround) ───
    {
      name: 'All-Day: Edit title of single occurrence ("this")',
      fixtureKey: 'allDayTask',
      occurrenceDate: '2026-10-14',
      action: {
        type: 'edit_task',
        task: {} as CalendarTask,
        updates: { title: 'Ganztags-Einzeländerung' },
      },
      scope: 'this',
      verify: (store) => {
        expect(store.tasks[0].title).toBe('Wöchentliche Ganztags-Aufgabe');
        expect(store.tasks[0].recurrenceRules).toBeDefined();
        const expanded = groupTasksByDueDay(store.tasks, range);
        const occ14 = expanded.get('2026-10-14');
        expect(occ14).toBeDefined();
        expect(occ14![0].title).toBe('Ganztags-Einzeländerung');
        const occ07 = expanded.get('2026-10-07');
        expect(occ07![0].title).toBe('Wöchentliche Ganztags-Aufgabe');
      },
    },
    {
      name: 'All-Day: Move single occurrence to different day ("this")',
      fixtureKey: 'allDayTask',
      occurrenceDate: '2026-10-14',
      action: {
        type: 'edit_task',
        task: {} as CalendarTask,
        updates: { due: '2026-10-15' },
      },
      scope: 'this',
      verify: (store) => {
        const expanded = groupTasksByDueDay(store.tasks, range);
        expect(expanded.get('2026-10-14')).toBeUndefined();
        expect(expanded.get('2026-10-15')).toBeDefined();
        expect(expanded.get('2026-10-07')).toBeDefined();
      },
    },
    {
      name: 'All-Day: Delete single occurrence ("this")',
      fixtureKey: 'allDayTask',
      occurrenceDate: '2026-10-14',
      action: {
        type: 'delete_task',
        task: {} as CalendarTask,
      },
      scope: 'this',
      verify: (store) => {
        const expanded = groupTasksByDueDay(store.tasks, range);
        expect(expanded.get('2026-10-14')).toBeUndefined();
        expect(expanded.get('2026-10-07')).toBeDefined();
        expect(expanded.get('2026-10-21')).toBeDefined();
      },
    },

    // ─── 3. LEGACY ALL-DAY TASKS (Pre-existing on Stalwart with showWithoutTime: true) ───
    {
      name: 'All-day series: editing a single occurrence ("this") is refused',
      customMaster: {
        id: 'legacy-1',
        '@type': 'Task',
        uid: 'legacy-uid-1',
        title: 'Alte Ganztags-Serie',
        due: '2026-10-07',
        showWithoutTime: true,
        progress: 'needs-action',
        priority: 0,
        recurrenceRules: [createRecurrenceRule('weekly')],
        calendarIds: { 'cal-tasks': true },
      } as unknown as CalendarTask,
      occurrenceDate: '2026-10-14',
      action: {
        type: 'edit_task',
        task: {} as CalendarTask,
        updates: { title: 'Alte Serie Einzeländerung' },
      },
      scope: 'this',
      expectBlocked: true,
      verify: (store) => {
        expect(store.patches).toEqual([]);
        expect(store.tasks[0].showWithoutTime).toBe(true);
        const expanded = groupTasksByDueDay(store.tasks, range);
        expect(expanded.get('2026-10-14')![0].title).toBe('Alte Ganztags-Serie');
      },
    },
    {
      name: 'All-day series: deleting a single occurrence ("this") stays allowed',
      customMaster: {
        id: 'legacy-2',
        '@type': 'Task',
        uid: 'legacy-uid-2',
        title: 'Alte Ganztags-Serie',
        due: '2026-10-07',
        showWithoutTime: true,
        progress: 'needs-action',
        priority: 0,
        recurrenceRules: [createRecurrenceRule('weekly')],
        calendarIds: { 'cal-tasks': true },
      } as unknown as CalendarTask,
      occurrenceDate: '2026-10-14',
      action: {
        type: 'delete_task',
        task: {} as CalendarTask,
      },
      scope: 'this',
      verify: (store) => {
        expect(store.tasks[0].title).toBe('Alte Ganztags-Serie');
        expect(store.tasks[0].showWithoutTime).toBe(true);
        const expanded = groupTasksByDueDay(store.tasks, range);
        expect(expanded.get('2026-10-14')).toBeUndefined();
        expect(expanded.get('2026-10-21')).toBeDefined();
      },
    },
  ];

  it.each(cases)('$name', async ({ fixtureKey, customMaster, occurrenceDate, action, scope, verify, expectBlocked }) => {
    const rawMaster: CalendarTask = customMaster || (stalwartFixtures as Record<string, unknown>)[fixtureKey!] as CalendarTask;
    const master = normalizeCalendarTask(rawMaster);
    const store = createStalwartSimulatingStore([master]);

    // Expand to get the occurrence instance under test
    const occurrencesMap = groupTasksByDueDay(store.tasks, range);
    const dayOccurrences = occurrencesMap.get(occurrenceDate);
    expect(dayOccurrences, `Occurrence on ${occurrenceDate} must exist`).toBeDefined();
    const occurrence = dayOccurrences![0];

    // Set target task on action
    action.task = occurrence;

    // Execute the scope action through production code
    const run = executeTaskScopeAction({} as IJMAPClient, store, action, scope);
    if (expectBlocked) {
      await expect(run).rejects.toBeInstanceOf(AllDaySeriesOverrideBlockedError);
    } else {
      await run;
    }

    // Verify expectations
    verify(store);
  });
});
