import { describe, it, expect } from 'vitest';
import { normalizeCalendarTask } from '@/lib/jmap/client';
import type { CalendarTask } from '@/lib/jmap/types';

describe('normalizeCalendarTask', () => {
  it('normalizes singular recurrenceRule to recurrenceRules array', () => {
    const raw = {
      id: 'task-1',
      '@type': 'Task',
      uid: 'uid-1',
      title: 'Lauf 🚶',
      due: '2026-09-21',
      showWithoutTime: true,
      progress: 'needs-action',
      recurrenceRule: {
        '@type': 'RecurrenceRule',
        frequency: 'daily',
      },
      calendarIds: { 'cal-1': true },
    } as unknown as CalendarTask;

    const normalized = normalizeCalendarTask(raw);
    expect(normalized.recurrenceRules).toEqual([
      {
        '@type': 'RecurrenceRule',
        frequency: 'daily',
      },
    ]);
    expect((normalized as unknown as Record<string, unknown>).recurrenceRule).toBeUndefined();
  });
});
