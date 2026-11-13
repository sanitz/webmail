import { format, parseISO } from "date-fns";
import type { CalendarTask } from "@/lib/jmap/types";
import { applyLocalShift, findTaskOverride, localShift, occurrenceRecurrenceId, overridePatch, taskRecurrenceId, taskSeriesId, type LocalShift } from "@/lib/calendar-tasks";
import type { IJMAPClient } from "@/lib/jmap/client-interface";
import type { RecurrenceEditScope } from "@/components/calendar/recurrence-scope-dialog";
import { generateDates } from "@/lib/recurrence-expansion";

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
  'seriesId',
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
 * Fields a split-off series must not copy from the old one: its identity,
 * what the server sets, the overrides (carried separately) and the start,
 * which follows the new due date.
 */
const SERIES_COPY_DROPPED_KEYS = new Set([
  'id', 'uid', 'created', 'updated', 'sequence', 'blobId', 'isDraft', 'isOrigin',
  'baseEventId', 'originalId', 'seriesId', 'recurrenceId', 'recurrenceIdTimeZone',
  'recurrenceOverrides', 'utcStart', 'utcEnd', 'accountId', 'accountName',
  'localAccountId', 'isShared', 'progressUpdated', 'start',
]);

/** The series' start at the same distance before `due` as before, or none. */
function startKeepingOffset(series: Pick<CalendarTask, "start" | "due">, due: string | null | undefined): Partial<CalendarTask> {
  if (!series.start || !series.due || !due) return {};
  return { start: applyLocalShift(series.start, localShift(series.due, due)) };
}

const NO_SHIFT: LocalShift = { days: 0, minutes: 0 };

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
  // UNTIL takes the value type of DTSTART (RFC 5545 §3.3.10): an all-day
  // series ends on the day before, at midnight, which Stalwart writes as a
  // DATE; one with a time ends a second before (tiger-iac#1811).
  if (master.showWithoutTime) untilDate.setDate(untilDate.getDate() - 1);
  else untilDate.setSeconds(untilDate.getSeconds() - 1);
  const until = format(untilDate, master.showWithoutTime ? "yyyy-MM-dd'T'00:00:00" : "yyyy-MM-dd'T'HH:mm:ss");

  const rules = master.recurrenceRules || [];
  // The series repeats from its start (tiger-iac#1807).
  const anchorValue = master.start || master.due;
  const anchor = anchorValue ? parseISO(anchorValue) : null;
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
const IDENTITY_KEYS = new Set(["id", "uid", "@type", "recurrenceId", "originalId", "seriesId"]);

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
  shift: LocalShift,
  newSeries: Pick<CalendarTask, "showWithoutTime">,
  editedFields: string[],
): TaskOverrides {
  const carried: TaskOverrides = {};
  for (const [key, entry] of Object.entries(overrides)) {
    const rest = Object.fromEntries(
      Object.entries(entry).filter(([field]) => field !== "updated" && !editedFields.includes(field)),
    );
    if (Object.keys(rest).length === 0) continue;
    carried[taskRecurrenceId(newSeries, parseISO(applyLocalShift(key, shift)))] = rest;
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
  // seriesId, not originalId: a shared task's originalId is its id in the sharer's account.
  const masterId = taskSeriesId(task);
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
          const shift = localShift(task.due, changes.due);
          changes.due = applyLocalShift(master.due, shift);
          // The rule repeats from the start: it moves with the due date (tiger-iac#1807).
          if (master.start && !changes.start) changes.start = applyLocalShift(master.start, shift);
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
          // Later overrides move as far as this occurrence's due date does.
          const movedFrom = task.due || occurrenceDate;
          const shift = newDue && movedFrom ? localShift(movedFrom, newDue) : NO_SHIFT;
          const carried = split
            ? carryOverrides(split.laterOverrides, shift, { showWithoutTime: newShowWithoutTime }, Object.keys(changes))
            : {};
          // Everything the series has, reminders and categories included
          // (tiger-iac#1808), except what identifies the old one.
          const kept = Object.fromEntries(
            Object.entries(master).filter(([key]) => !SERIES_COPY_DROPPED_KEYS.has(key)),
          ) as Partial<CalendarTask>;
          const newTaskData: Partial<CalendarTask> = {
            ...kept,
            ...startKeepingOffset(master, newDue),
            calendarIds: { ...master.calendarIds },
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
export function taskActionErrorKey(_error: unknown): string {
  return "notifications.task_error";
}
