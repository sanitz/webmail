import { format, parseISO, startOfDay, endOfDay } from "date-fns";
import type { CalendarTask } from "@/lib/jmap/types";
import { generateDates } from "@/lib/recurrence-expansion";

export interface TaskDateRange {
  start: Date;
  end: Date;
}

/**
 * Tasks shown on the calendar grid (#1107): only tasks with a due date, and
 * only those in a calendar the sidebar currently shows, the same rule the
 * events follow.
 */
export function filterTasksByCalendars(tasks: CalendarTask[], selectedCalendarIds: string[]): CalendarTask[] {
  const selected = new Set(selectedCalendarIds);
  return tasks.filter((task) => Object.keys(task.calendarIds ?? {}).some((id) => selected.has(id)));
}

/** yyyy-MM-dd of the day a task is due, or null when it has no valid due date. */
export function taskDueDayKey(task: CalendarTask): string | null {
  if (!task.due) return null;
  const due = parseISO(task.due);
  if (Number.isNaN(due.getTime())) return null;
  return format(due, "yyyy-MM-dd");
}

/**
 * Tasks keyed by the day they are due. When a range is provided, recurring
 * tasks are expanded into virtual occurrences for each due date falling
 * inside that range.
 *
 * Within a day, tasks without a time come first, then by due time and title,
 * so the order does not depend on the order the server returned them in.
 */
export function groupTasksByDueDay(
  tasks: CalendarTask[] | undefined,
  range?: TaskDateRange,
): Map<string, CalendarTask[]> {
  const map = new Map<string, CalendarTask[]>();
  if (!tasks?.length) return map;

  const rangeStart = range ? startOfDay(range.start) : null;
  const rangeEnd = range ? endOfDay(range.end) : null;

  for (const task of tasks) {
    if (!task.due) continue;
    const taskDue = parseISO(task.due);
    if (Number.isNaN(taskDue.getTime())) continue;

    if (rangeStart && rangeEnd && task.recurrenceRules?.length) {
      // Recurring task with date range: expand occurrences
      const seenDates = new Set<string>();
      for (const rule of task.recurrenceRules) {
        const dates = generateDates(taskDue, rule, rangeStart, rangeEnd, true);
        for (const date of dates) {
          const key = format(date, "yyyy-MM-dd");
          if (seenDates.has(key)) continue;
          seenDates.add(key);

          const occurrenceDue = task.showWithoutTime
            ? key
            : format(date, "yyyy-MM-dd'T'HH:mm:ss");

          const occTask: CalendarTask = {
            ...task,
            due: occurrenceDue,
          };

          const existing = map.get(key);
          if (existing) existing.push(occTask);
          else map.set(key, [occTask]);
        }
      }
    } else {
      // Non-recurring task, or no range provided
      const key = taskDueDayKey(task);
      if (!key) continue;
      const existing = map.get(key);
      if (existing) existing.push(task);
      else map.set(key, [task]);
    }
  }

  for (const dayTasks of map.values()) {
    dayTasks.sort((a, b) => {
      const aTimed = a.showWithoutTime ? 0 : 1;
      const bTimed = b.showWithoutTime ? 0 : 1;
      if (aTimed !== bTimed) return aTimed - bTimed;
      const byDue = (a.due ?? "").localeCompare(b.due ?? "");
      if (byDue !== 0) return byDue;
      return (a.title ?? "").localeCompare(b.title ?? "");
    });
  }

  return map;
}
