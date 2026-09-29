import { describe, it, expect } from 'vitest';
import { groupTasksByDueDay } from '../calendar-tasks';
import type { CalendarTask } from '@/lib/jmap/types';
import { createRecurrenceRule } from '@/lib/recurrence-rule';

function makeTask(id: string, overrides: Partial<CalendarTask> = {}): CalendarTask {
  return {
    id,
    '@type': 'Task',
    uid: id,
    title: 'Task ' + id,
    description: '',
    due: '2026-09-20',
    start: null,
    duration: null,
    timeZone: null,
    showWithoutTime: true,
    progress: 'needs-action',
    priority: 0,
    privacy: 'public',
    keywords: null,
    categories: null,
    color: null,
    created: null,
    updated: '2026-09-01T00:00:00Z',
    recurrenceRules: null,
    alerts: null,
    relatedTo: null,
    calendarIds: { 'cal-1': true },
    ...overrides,
  };
}

describe('groupTasksByDueDay recurrence expansion', () => {
  it('expands a daily recurring task across the given date range', () => {
    const task = makeTask('walk', {
      title: 'Lauf 🚶',
      due: '2026-09-20',
      recurrenceRules: [createRecurrenceRule('daily')],
    });

    const range = {
      start: new Date('2026-09-20T00:00:00'),
      end: new Date('2026-09-23T23:59:59'),
    };

    const map = groupTasksByDueDay([task], range);
    expect([...map.keys()].sort()).toEqual([
      '2026-09-20',
      '2026-09-21',
      '2026-09-22',
      '2026-09-23',
    ]);

    // Check each day has the task instance with matching due date
    const day21 = map.get('2026-09-21');
    expect(day21).toHaveLength(1);
    expect(day21![0].id).toBe('walk');
    expect(day21![0].due).toBe('2026-09-21');
  });

  it('respects until parameter in recurrence rule', () => {
    const task = makeTask('walk', {
      title: 'Lauf 🚶',
      due: '2026-09-20',
      recurrenceRules: [createRecurrenceRule('daily', { until: '2026-09-21T23:59:59' })],
    });

    const range = {
      start: new Date('2026-09-20T00:00:00'),
      end: new Date('2026-09-25T23:59:59'),
    };

    const map = groupTasksByDueDay([task], range);
    expect([...map.keys()].sort()).toEqual([
      '2026-09-20',
      '2026-09-21',
    ]);
  });
});
