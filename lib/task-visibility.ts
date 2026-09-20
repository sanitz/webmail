import type { Calendar, CalendarTask } from '@/lib/jmap/types';

/**
 * Checks if a task belongs to at least one selected calendar, reconciling
 * differences between raw server IDs and store/namespaced IDs (#1208).
 */
export function isTaskVisibleInCalendars(
  task: Pick<CalendarTask, 'calendarIds'>,
  selectedCalendarIds: string[],
  calendars: Pick<Calendar, 'id' | 'originalId'>[],
): boolean {
  const calIds = Object.keys(task.calendarIds || {});
  if (calIds.length === 0) return false;

  return calIds.some((id) => {
    if (selectedCalendarIds.includes(id)) return true;
    const cal = calendars.find((c) => c.id === id || c.originalId === id);
    return cal ? selectedCalendarIds.includes(cal.id) : false;
  });
}

/**
 * Filters a list of tasks against currently selected calendar IDs.
 */
export function filterTasksBySelectedCalendars(
  tasks: CalendarTask[],
  selectedCalendarIds: string[],
  calendars: Pick<Calendar, 'id' | 'originalId'>[],
): CalendarTask[] {
  return tasks.filter((task) => isTaskVisibleInCalendars(task, selectedCalendarIds, calendars));
}
