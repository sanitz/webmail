import { format, parseISO } from "date-fns";
import type { CalendarTask } from "@/lib/jmap/types";
import { findTaskOverride, occurrenceRecurrenceId, overridePatch, taskRecurrenceId } from "@/lib/calendar-tasks";
import type { IJMAPClient } from "@/lib/jmap/client-interface";
import type { RecurrenceEditScope } from "@/components/calendar/recurrence-scope-dialog";
import { generateDates } from "@/lib/recurrence-expansion";
import { AllDaySeriesOverrideBlockedError } from "@/lib/all-day-series-block";

export type PendingTaskScopeAction =
  | { type: "edit_task"; task: CalendarTask; updates: Partial<CalendarTask> }
  | { type: "delete_task"; task: CalendarTask };

export interface TaskStoreOperations {
  tasks: CalendarTask[];
  updateTask: (client: IJMAPClient, id: string, updates: Partial<CalendarTask>) => Promise<unknown>;
  createTask: (client: IJMAPClient, task: Partial<CalendarTask>) => Promise<CalendarTask | null>;
  deleteTask: (client: IJMAPClient, id: string) => Promise<unknown>;
}

export function isRecurringTask(task: CalendarTask): boolean {
  return (task.recurrenceRules?.length ?? 0) > 0 || task.recurrenceId != null;
}

const OCCURRENCE_DROPPED_KEYS = new Set([
  'id',
  'uid',
  '@type',
  'calendarIds',
  'recurrenceRules',
  'recurrenceOverrides',
  'excludedRecurrenceRules',
  'baseEventId',
  'originalId',
  'recurrenceId',
  'recurrenceIdTimeZone',
  'created',
  'updated',
  'isDraft',
  'isOrigin',
  'utcStart',
  'utcEnd',
  'useDefaultAlerts',
  'mayInviteSelf',
  'mayInviteOthers',
  'hideAttendees',
]);

type TaskOverrides = NonNullable<CalendarTask["recurrenceOverrides"]>;

/**
 * Ends the series just before `occurrenceDate`. Overrides from that day on are
 * removed in the same patch and returned, so the new series can take them
 * over: RFC 8984 shows an override without a matching rule date as an extra
 * occurrence, so left behind they would duplicate the new series
 * (tiger-iac#1323). Also returns the occurrences a counted series has left and
 * whether nothing of the old series remains.
 */
function truncateSeries(master: CalendarTask, occurrenceDate: string) {
  const splitAt = parseISO(occurrenceDate);
  const untilDate = new Date(splitAt);
  untilDate.setSeconds(untilDate.getSeconds() - 1);
  const until = format(untilDate, "yyyy-MM-dd'T'HH:mm:ss");

  const rules = master.recurrenceRules || [];
  const anchor = master.due ? parseISO(master.due) : null;
  const count = rules[0]?.count;
  const remainingCount = count != null && anchor
    ? count - generateDates(anchor, rules[0], anchor, untilDate).length
    : null;

  const patch: Record<string, unknown> = {
    recurrenceRules: rules.map((r) => ({ ...r, until, count: null })),
  };
  const laterOverrides: TaskOverrides = {};
  for (const [key, entry] of Object.entries(master.recurrenceOverrides ?? {})) {
    if (parseISO(key) < splitAt) continue;
    patch[`recurrenceOverrides/${key}`] = null;
    laterOverrides[key] = entry;
  }
  return {
    patch: patch as Partial<CalendarTask>,
    remainingCount,
    laterOverrides,
    nothingLeft: anchor != null && anchor >= splitAt,
  };
}

/**
 * Fields the edit actually changes. The task modal always sends every form
 * field, so unchanged ones must not count as edits: they would overwrite
 * per-occurrence values such as a completed occurrence (UAT of tiger-iac#1323).
 */
const IDENTITY_KEYS = new Set(["id", "uid", "@type", "recurrenceId", "originalId"]);

function changedFields(updates: Partial<CalendarTask>, occurrence: CalendarTask): Partial<CalendarTask> {
  const occurrenceRecord = occurrence as unknown as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(updates).filter(([key, value]) =>
      !IDENTITY_KEYS.has(key) && JSON.stringify(value ?? null) !== JSON.stringify(occurrenceRecord[key] ?? null)),
  ) as Partial<CalendarTask>;
}

/**
 * Overrides re-keyed for the new series, moved by the change of its time.
 * Fields the user just edited for all following occurrences win over the
 * override; server-set fields are dropped, as are overrides left empty.
 */
function carryOverrides(
  overrides: TaskOverrides,
  shiftMs: number,
  newSeries: Pick<CalendarTask, "showWithoutTime">,
  editedFields: string[],
): TaskOverrides {
  const carried: TaskOverrides = {};
  for (const [key, entry] of Object.entries(overrides)) {
    const rest = Object.fromEntries(
      Object.entries(entry).filter(([field]) => field !== "updated" && !editedFields.includes(field)),
    );
    if (Object.keys(rest).length === 0) continue;
    carried[taskRecurrenceId(newSeries, new Date(parseISO(key).getTime() + shiftMs))] = rest;
  }
  return carried;
}

export async function executeTaskScopeAction(
  client: IJMAPClient,
  taskStore: TaskStoreOperations,
  action: PendingTaskScopeAction,
  scope: RecurrenceEditScope,
): Promise<void> {
  const { task } = action;
  const masterId = task.originalId || (task.id.includes(":") ? task.id.split(":")[0] : task.id);
  const master = taskStore.tasks.find((t) => t.id === masterId) || task;
  const occurrenceDate = occurrenceRecurrenceId(task) ?? master.due;

  if (action.type === "edit_task") {
    const { updates } = action;
    switch (scope) {
      case "all": {
        // Only real changes reach the series: an unchanged progress of a
        // completed occurrence would otherwise complete every occurrence.
        const changes = changedFields(updates, task);
        if (changes.due && task.due && master.due) {
          // Moving one occurrence moves the series by the same amount, from its own start.
          const shiftMs = parseISO(changes.due).getTime() - parseISO(task.due).getTime();
          changes.due = format(new Date(parseISO(master.due).getTime() + shiftMs), "yyyy-MM-dd'T'HH:mm:ss");
        }
        if (Object.keys(changes).length > 0) await taskStore.updateTask(client, master.id, changes);
        break;
      }
      case "this_and_future": {
        const split = occurrenceDate ? truncateSeries(master, occurrenceDate) : null;
        const remainingCount = split?.remainingCount ?? null;
        const changes = changedFields(updates, task);
        const newDue = changes.due || task.due || occurrenceDate;
        const newShowWithoutTime = changes.showWithoutTime ?? master.showWithoutTime;

        if (remainingCount == null || remainingCount > 0) {
          const shiftMs = newDue && occurrenceDate ? parseISO(newDue).getTime() - parseISO(occurrenceDate).getTime() : 0;
          const carried = split
            ? carryOverrides(split.laterOverrides, shiftMs, { showWithoutTime: newShowWithoutTime }, Object.keys(changes))
            : {};
          const newTaskData: Partial<CalendarTask> = {
            title: master.title,
            description: master.description,
            priority: master.priority,
            calendarIds: { ...master.calendarIds },
            showWithoutTime: master.showWithoutTime,
            timeZone: master.timeZone,
            progress: "needs-action",
            recurrenceRules: remainingCount != null
              ? (master.recurrenceRules || []).map((r) => ({ ...r, count: remainingCount }))
              : master.recurrenceRules,
            ...(Object.keys(carried).length > 0 ? { recurrenceOverrides: carried } : {}),
            ...changes,
            due: newDue,
          };
          // Create first: if it fails, the old series is still complete.
          await taskStore.createTask(client, newTaskData);
        }

        if (split?.nothingLeft) await taskStore.deleteTask(client, master.id);
        else if (split) await taskStore.updateTask(client, master.id, split.patch);
        break;
      }
      case "this": {
        const recKey = occurrenceRecurrenceId(task);
        if (!recKey) {
          await taskStore.updateTask(client, master.id, updates);
          break;
        }
        const cleanUpdates: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(updates)) {
          if (!OCCURRENCE_DROPPED_KEYS.has(k)) {
            cleanUpdates[k] = v;
          }
        }
        const overrideEntry = {
          ...findTaskOverride(master.recurrenceOverrides, recKey),
          ...cleanUpdates,
        };

        await taskStore.updateTask(client, master.id, overridePatch(master, recKey, overrideEntry));
        break;
      }
    }
  } else {
    // delete_task
    switch (scope) {
      case "all": {
        await taskStore.deleteTask(client, master.id);
        break;
      }
      case "this_and_future": {
        const split = occurrenceDate ? truncateSeries(master, occurrenceDate) : null;
        if (split && !split.nothingLeft) {
          await taskStore.updateTask(client, master.id, split.patch);
        } else {
          await taskStore.deleteTask(client, master.id);
        }
        break;
      }
      case "this": {
        const recKey = occurrenceRecurrenceId(task);
        if (!recKey) {
          await taskStore.deleteTask(client, master.id);
          break;
        }
        const overrideEntry = {
          ...findTaskOverride(master.recurrenceOverrides, recKey),
          excluded: true,
        };

        await taskStore.updateTask(client, master.id, overridePatch(master, recKey, overrideEntry));
        break;
      }
    }
  }
}

/** Translation key for a failed task action, so no failure stays silent (tiger-iac#1323). */
export function taskActionErrorKey(error: unknown): string {
  return error instanceof AllDaySeriesOverrideBlockedError
    ? "notifications.single_occurrence_blocked"
    : "notifications.task_error";
}
