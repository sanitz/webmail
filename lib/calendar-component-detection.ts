/**
 * Helpers for deciding whether a calendar holds only tasks (VTODO) and so
 * should be hidden from the *event* calendar UI (#761).
 *
 * This is derived purely from the objects a calendar contains (RFC 8984 / JMAP
 * Task types vs Events) or explicit collection component metadata, NEVER from
 * calendar names.
 */

/**
 * A calendar object as seen with the minimal properties we scan. The index
 * signature keeps it tolerant of the other fields the server returns (id, etc.).
 */
export interface ScannedCalendarObject {
  '@type'?: string;
  due?: unknown;
  progress?: unknown;
  percentComplete?: unknown;
  calendarIds?: Record<string, boolean> | null;
  [key: string]: unknown;
}

/**
 * Is this calendar object a task rather than an event? Matches an explicit
 * `@type: "Task"`, and CalDAV-created tasks (which may lack the type) by the
 * presence of RFC 8984 §5.2 Task-only keys (`due` / `progress` /
 * `percentComplete`) - a VEVENT never carries those. Mirrors the existing
 * event/task split so classification stays consistent.
 */
export function isTaskLikeObject(obj: ScannedCalendarObject): boolean {
  const type = obj['@type'];
  if (typeof type === 'string' && type.toLowerCase() === 'task') return true;
  if (type !== 'Event' && (
    ('progress' in obj && typeof obj.progress === 'string') ||
    ('due' in obj && obj.due != null) ||
    ('percentComplete' in obj)
  )) return true;
  return false;
}

export interface CalendarDescriptor {
  id: string;
  name?: string | null;
}

/**
 * Given every object in an account and the calendars under consideration,
 * return the ids of calendars that hold only tasks (no event).
 * This classification is purely object-content-based without any name heuristics.
 */
export function findTasksOnlyCalendarIds(
  objects: ScannedCalendarObject[],
  calendars: (string | CalendarDescriptor)[],
): Set<string> {
  const withAny = new Set<string>();
  const withEvent = new Set<string>();
  for (const obj of objects) {
    const task = isTaskLikeObject(obj);
    const ids = obj.calendarIds ? Object.keys(obj.calendarIds) : [];
    for (const id of ids) {
      withAny.add(id);
      if (!task) withEvent.add(id);
    }
  }

  const tasksOnly = new Set<string>();
  for (const cal of calendars) {
    const id = typeof cal === 'string' ? cal : cal.id;
    if (withAny.has(id) && !withEvent.has(id)) {
      tasksOnly.add(id);
    }
  }
  return tasksOnly;
}
