import { describe, it, expect } from 'vitest';
import { filterTasksBySelectedCalendars, isTaskVisibleInCalendars } from '../task-visibility';
import type { Calendar, CalendarTask } from '@/lib/jmap/types';

describe('Task visibility filtering by selected calendar IDs (#1208)', () => {
  const calendars: Pick<Calendar, 'id' | 'originalId'>[] = [
    { id: 'acc1::cal-events', originalId: 'cal-events' },
    { id: 'acc1::cal-tasks', originalId: 'cal-tasks' },
    { id: 'acc1::cal-private', originalId: 'cal-private' },
  ];

  const taskInTasksList: CalendarTask = {
    id: 't1',
    title: 'Buy apples',
    calendarIds: { 'cal-tasks': true },
  } as unknown as CalendarTask;

  const taskInPrivateList: CalendarTask = {
    id: 't2',
    title: 'Secret plan',
    calendarIds: { 'cal-private': true },
  } as unknown as CalendarTask;

  const taskWithNamespacedId: CalendarTask = {
    id: 't3',
    title: 'Work task',
    calendarIds: { 'acc1::cal-events': true },
  } as unknown as CalendarTask;

  const taskWithoutCalendar: CalendarTask = {
    id: 't4',
    title: 'Orphan task',
    calendarIds: {},
  } as unknown as CalendarTask;

  it('includes tasks belonging to selected calendars (both raw and namespaced IDs)', () => {
    const selectedIds = ['acc1::cal-tasks'];
    expect(isTaskVisibleInCalendars(taskInTasksList, selectedIds, calendars)).toBe(true);
    expect(isTaskVisibleInCalendars(taskInPrivateList, selectedIds, calendars)).toBe(false);

    const filtered = filterTasksBySelectedCalendars(
      [taskInTasksList, taskInPrivateList, taskWithNamespacedId],
      selectedIds,
      calendars,
    );
    expect(filtered.map((t) => t.id)).toEqual(['t1']);
  });

  it('supports selecting by namespaced ID when task has namespaced ID', () => {
    const selectedIds = ['acc1::cal-events'];
    expect(isTaskVisibleInCalendars(taskWithNamespacedId, selectedIds, calendars)).toBe(true);
    expect(isTaskVisibleInCalendars(taskInTasksList, selectedIds, calendars)).toBe(false);
  });

  it('excludes tasks without calendarIds when filtering', () => {
    const selectedIds = ['acc1::cal-tasks'];
    expect(isTaskVisibleInCalendars(taskWithoutCalendar, selectedIds, calendars)).toBe(false);
  });
});
