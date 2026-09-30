import { describe, it, expect } from 'vitest';
import { overridePatch } from '../calendar-tasks';
import { AllDaySeriesOverrideBlockedError, isSingleOccurrenceChangeBlocked } from '../all-day-series-block';
import type { CalendarTask } from '@/lib/jmap/types';

/**
 * Stalwart v0.16.24 (calcard 0.3.14) loses the series when an all-day series
 * gets an override with content; exclusions and timed series are safe.
 * Verified against a local v0.16.24 container (tiger-iac#1311).
 */
function master(overrides: Partial<CalendarTask> = {}): CalendarTask {
  return {
    id: 'm1',
    '@type': 'Task',
    title: 'Müll',
    due: '2026-10-07',
    showWithoutTime: true,
    recurrenceRules: [{ '@type': 'RecurrenceRule', frequency: 'weekly' }],
    ...overrides,
  } as unknown as CalendarTask;
}

describe('overridePatch on all-day series (tiger-iac#1311)', () => {
  it.each([
    ['title', { title: 'Geändert' }],
    ['progress', { progress: 'completed' }],
    ['due', { due: '2026-10-15' }],
  ])('rejects an override with %s', (_name, entry) => {
    expect(() => overridePatch(master(), '2026-10-14T00:00:00', entry)).toThrow(AllDaySeriesOverrideBlockedError);
  });

  it('allows an exclusion and leaves the series all-day', () => {
    const patch = overridePatch(master(), '2026-10-14T00:00:00', { excluded: true });
    expect(patch).toEqual({ recurrenceOverrides: { '2026-10-14T00:00:00': { excluded: true } } });
  });

  it('allows content overrides on timed series', () => {
    const timed = master({ due: '2026-10-07T09:00:00', showWithoutTime: false });
    const patch = overridePatch(timed, '2026-10-14T09:00:00', { title: 'Geändert' });
    expect(patch).toEqual({ recurrenceOverrides: { '2026-10-14T09:00:00': { title: 'Geändert' } } });
  });
});

describe('isSingleOccurrenceChangeBlocked (tiger-iac#1311)', () => {
  const allDay = { showWithoutTime: true };
  const timed = { showWithoutTime: false };

  it.each([
    ['edit on all-day event', { type: 'edit', event: allDay }, true],
    ['rsvp on all-day event', { type: 'rsvp', event: allDay }, true],
    ['edit_task on all-day task', { type: 'edit_task', task: allDay }, true],
    ['delete on all-day event', { type: 'delete', event: allDay }, false],
    ['delete_task on all-day task', { type: 'delete_task', task: allDay }, false],
    ['edit on timed event', { type: 'edit', event: timed }, false],
    ['edit_task on timed task', { type: 'edit_task', task: timed }, false],
  ] as const)('%s → %s', (_name, action, expected) => {
    expect(isSingleOccurrenceChangeBlocked(action)).toBe(expected);
  });
});
