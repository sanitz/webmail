import { describe, it, expect } from 'vitest';
import { executeTaskScopeAction, type TaskStoreOperations } from '../calendar-task-scope';
import { groupTasksByDueDay } from '../calendar-tasks';
import { AllDaySeriesOverrideBlockedError } from '../all-day-series-block';
import type { CalendarTask } from '@/lib/jmap/types';
import type { IJMAPClient } from '@/lib/jmap/client-interface';
import { createRecurrenceRule } from '@/lib/recurrence-rule';

/** Store double that applies JMAP patches the way the server would (RFC 8620 §5.3 patch paths). */
function createPatchingStore(tasks: CalendarTask[]): TaskStoreOperations & { patches: Record<string, unknown>[] } {
  const store = {
    tasks,
    patches: [] as Record<string, unknown>[],
    async updateTask(_client: IJMAPClient, id: string, updates: Partial<CalendarTask>) {
      store.patches.push(updates as Record<string, unknown>);
      store.tasks = store.tasks.map((t) => {
        if (t.id !== id) return t;
        const next: Record<string, unknown> = { ...t };
        for (const [k, v] of Object.entries(updates)) {
          if (k.startsWith('recurrenceOverrides/')) {
            next.recurrenceOverrides = { ...(next.recurrenceOverrides as object), [k.slice(20)]: v };
          } else {
            next[k] = v;
          }
        }
        return next as unknown as CalendarTask;
      });
    },
    createTask: async () => { throw new Error('unexpected'); },
    deleteTask: async () => { throw new Error('unexpected'); },
  };
  return store;
}

const range = { start: new Date('2026-09-28T00:00:00'), end: new Date('2026-10-04T23:59:59') };

describe('editing a single occurrence of an all-day recurring task', () => {
  it('is refused and writes nothing while Stalwart loses the series (tiger-iac#1311)', async () => {
    const master = {
      id: 'm1', '@type': 'Task', uid: 'm1', title: 'Müll rausbringen', description: '',
      due: '2026-09-28', showWithoutTime: true, progress: 'needs-action', priority: 0,
      recurrenceRules: [createRecurrenceRule('daily')], calendarIds: { 'cal-1': true },
    } as unknown as CalendarTask;
    const store = createPatchingStore([master]);

    const occurrence = groupTasksByDueDay(store.tasks, range).get('2026-09-30')![0];
    await expect(executeTaskScopeAction({} as IJMAPClient, store, {
      type: 'edit_task',
      task: occurrence,
      updates: { title: 'Sperrmüll', due: '2026-10-01', showWithoutTime: true },
    }, 'this')).rejects.toBeInstanceOf(AllDaySeriesOverrideBlockedError);

    expect(store.patches).toEqual([]);
    const after = groupTasksByDueDay(store.tasks, range);
    expect(after.get('2026-09-30')!.map((t) => t.title)).toEqual(['Müll rausbringen']);
  });
});
