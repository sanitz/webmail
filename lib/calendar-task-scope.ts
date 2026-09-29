import { format } from "date-fns";
import type { CalendarTask } from "@/lib/jmap/types";
import type { IJMAPClient } from "@/lib/jmap/client-interface";
import type { RecurrenceEditScope } from "@/components/calendar/recurrence-scope-dialog";

export type PendingTaskScopeAction =
  | { type: "edit_task"; task: CalendarTask; updates: Partial<CalendarTask> }
  | { type: "delete_task"; task: CalendarTask };

export interface TaskStoreOperations {
  tasks: CalendarTask[];
  updateTask: (client: IJMAPClient, id: string, updates: Partial<CalendarTask>) => Promise<void>;
  createTask: (client: IJMAPClient, task: Partial<CalendarTask>) => Promise<CalendarTask>;
  deleteTask: (client: IJMAPClient, id: string) => Promise<void>;
}

export function isRecurringTask(task: CalendarTask): boolean {
  return (task.recurrenceRules?.length ?? 0) > 0 || task.recurrenceId != null;
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
  const occurrenceDate = task.recurrenceId || (task.due ? (task.showWithoutTime ? task.due.slice(0, 10) : task.due) : master.due);

  if (action.type === "edit_task") {
    const { updates } = action;
    switch (scope) {
      case "all": {
        const cleanUpdates = { ...updates };
        delete (cleanUpdates as Record<string, unknown>).id;
        delete (cleanUpdates as Record<string, unknown>).uid;
        delete (cleanUpdates as Record<string, unknown>).recurrenceId;
        delete (cleanUpdates as Record<string, unknown>).originalId;
        await taskStore.updateTask(client, master.id, cleanUpdates);
        break;
      }
      case "this_and_future": {
        if (occurrenceDate) {
          const untilDate = new Date(occurrenceDate);
          untilDate.setSeconds(untilDate.getSeconds() - 1);
          const until = format(untilDate, "yyyy-MM-dd'T'HH:mm:ss");
          const truncatedRules = (master.recurrenceRules || []).map((r) => ({
            ...r,
            until,
            count: null,
          }));
          await taskStore.updateTask(client, master.id, { recurrenceRules: truncatedRules });
        }

        const newTaskData: Partial<CalendarTask> = {
          title: master.title,
          description: master.description,
          priority: master.priority,
          calendarIds: { ...master.calendarIds },
          showWithoutTime: master.showWithoutTime,
          timeZone: master.timeZone,
          recurrenceRules: master.recurrenceRules,
          ...updates,
          due: updates.due || task.due || occurrenceDate,
        };
        delete (newTaskData as Record<string, unknown>).id;
        delete (newTaskData as Record<string, unknown>).uid;
        delete (newTaskData as Record<string, unknown>).recurrenceId;
        delete (newTaskData as Record<string, unknown>).originalId;
        await taskStore.createTask(client, newTaskData);
        break;
      }
      case "this": {
        const recKey = task.recurrenceId || (task.due ? (task.showWithoutTime ? task.due.slice(0, 10) : task.due) : null);
        if (!recKey) {
          await taskStore.updateTask(client, master.id, updates);
          break;
        }
        const existingOverrides = (master.recurrenceOverrides || {}) as Record<string, unknown>;
        const cleanUpdates = { ...updates };
        delete (cleanUpdates as Record<string, unknown>).id;
        delete (cleanUpdates as Record<string, unknown>).uid;
        delete (cleanUpdates as Record<string, unknown>).recurrenceId;
        delete (cleanUpdates as Record<string, unknown>).originalId;
        delete (cleanUpdates as Record<string, unknown>).recurrenceRules;

        const patchKey = `recurrenceOverrides/${recKey}`;
        const overrideEntry = {
          ...((existingOverrides[recKey] as Record<string, unknown>) || {}),
          ...cleanUpdates,
        };

        const patch = (!master.recurrenceOverrides || Object.keys(master.recurrenceOverrides).length === 0)
          ? { recurrenceOverrides: { [recKey]: overrideEntry } }
          : { [patchKey]: overrideEntry };

        await taskStore.updateTask(client, master.id, patch);
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
        if (occurrenceDate) {
          const untilDate = new Date(occurrenceDate);
          untilDate.setSeconds(untilDate.getSeconds() - 1);
          const until = format(untilDate, "yyyy-MM-dd'T'HH:mm:ss");
          const truncatedRules = (master.recurrenceRules || []).map((r) => ({
            ...r,
            until,
            count: null,
          }));
          await taskStore.updateTask(client, master.id, { recurrenceRules: truncatedRules });
        } else {
          await taskStore.deleteTask(client, master.id);
        }
        break;
      }
      case "this": {
        const recKey = task.recurrenceId || (task.due ? (task.showWithoutTime ? task.due.slice(0, 10) : task.due) : null);
        if (!recKey) {
          await taskStore.deleteTask(client, master.id);
          break;
        }
        const existingOverrides = (master.recurrenceOverrides || {}) as Record<string, unknown>;
        const patchKey = `recurrenceOverrides/${recKey}`;
        const overrideEntry = {
          ...((existingOverrides[recKey] as Record<string, unknown>) || {}),
          excluded: true,
        };

        const patch = (!master.recurrenceOverrides || Object.keys(master.recurrenceOverrides).length === 0)
          ? { recurrenceOverrides: { [recKey]: overrideEntry } }
          : { [patchKey]: overrideEntry };

        await taskStore.updateTask(client, master.id, patch);
        break;
      }
    }
  }
}
