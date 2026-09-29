import { create } from 'zustand';
import { format, parseISO } from 'date-fns';
import type { CalendarTask } from '@/lib/jmap/types';
import type { IJMAPClient } from '@/lib/jmap/client-interface';
import { debug } from '@/lib/debug';
import { taskHooks } from '@/lib/plugin-hooks';
import { taskToView } from '@/lib/plugin-projection';
import { getNextRecurrenceDate } from '@/lib/recurrence-expansion';
import { findTaskOverride, occurrenceRecurrenceId, overridePatch } from '@/lib/calendar-tasks';

export type TaskViewFilter = 'all' | 'pending' | 'completed' | 'overdue';

interface TaskStore {
  tasks: CalendarTask[];
  selectedTaskId: string | null;
  filter: TaskViewFilter;
  showCompleted: boolean;
  isLoading: boolean;
  error: string | null;
  setTasks: (tasks: CalendarTask[]) => void;
  setSelectedTaskId: (id: string | null) => void;
  setFilter: (filter: TaskViewFilter) => void;
  setShowCompleted: (show: boolean) => void;
  fetchTasks: (client: IJMAPClient, calendarIds?: string[]) => Promise<void>;
  /** Resolves to null when a plugin stopped the create. */
  createTask: (client: IJMAPClient, task: Partial<CalendarTask>) => Promise<CalendarTask | null>;
  /** false when a plugin stopped it (the plugin tells the user why). */
  updateTask: (client: IJMAPClient, id: string, updates: Partial<CalendarTask>) => Promise<boolean>;
  deleteTask: (client: IJMAPClient, id: string) => Promise<boolean>;
  toggleTaskComplete: (client: IJMAPClient, task: CalendarTask) => Promise<void>;
  clearTasks: () => void;
}

export const useTaskStore = create<TaskStore>((set, get) => ({
  tasks: [],
  selectedTaskId: null,
  filter: 'all',
  showCompleted: false,
  isLoading: false,
  error: null,
  setTasks: (tasks) => set({ tasks }),
  setSelectedTaskId: (id) => set({ selectedTaskId: id }),
  setFilter: (filter) => {
    if (get().filter === filter) return;
    set({ filter });
    void taskHooks.onTaskFilterChange.emit({ filter, showCompleted: get().showCompleted });
  },
  setShowCompleted: (show) => {
    if (get().showCompleted === show) return;
    set({ showCompleted: show });
    void taskHooks.onTaskFilterChange.emit({ filter: get().filter, showCompleted: show });
  },

  fetchTasks: async (client, calendarIds) => {
    debug.log('tasks', 'TaskStore/fetchTasks start', { calendarIds: calendarIds || 'all' });
    set({ isLoading: true, error: null });
    try {
      const tasks = await client.getCalendarTasks(calendarIds);
      debug.log('tasks', 'TaskStore/fetchTasks received', tasks.length, 'tasks');
      tasks.forEach((t, i) => {
        debug.log('tasks', `TaskStore/fetchTasks [${i}]`, {
          id: t.id, uid: t.uid, '@type': t['@type'],
          title: t.title, due: t.due, progress: t.progress,
          showWithoutTime: t.showWithoutTime, calendarIds: t.calendarIds,
        });
      });
      set({ tasks, isLoading: false });
      if (taskHooks.onTasksLoaded.size > 0) void taskHooks.onTasksLoaded.emit(tasks.map(taskToView));
    } catch (error) {
      debug.error('TaskStore/fetchTasks failed', error);
      set({ isLoading: false, error: 'Failed to fetch tasks' });
    }
  },

  createTask: async (client, task) => {
    debug.log('tasks', 'TaskStore/createTask', task);
    if (!(await taskHooks.onBeforeTaskCreate.intercept(taskToView({ id: '', ...task } as CalendarTask)))) return null;
    const created = await client.createCalendarTask(task);
    debug.log('tasks', 'TaskStore/createTask result', { id: created.id, uid: created.uid, title: created.title });
    set({ tasks: [...get().tasks, created] });
    void taskHooks.onTaskCreate.emit(taskToView(created));
    return created;
  },

  updateTask: async (client, id, updates) => {
    if (!(await taskHooks.onBeforeTaskUpdate.intercept({ taskId: id, patch: updates }))) return false;
    const before = get().tasks.find(t => t.id === id);
    const newId = await client.updateCalendarTask(id, updates);
    if (newId && newId !== id) {
      // Moved into a calendar of another account: the server recreated it
      // under a new id, so reload rather than patch the old entry. (#1204)
      set({ selectedTaskId: get().selectedTaskId === id ? newId : get().selectedTaskId });
      await get().fetchTasks(client);
      const moved = get().tasks.find(t => t.id === newId)
        ?? ({ ...before, ...updates, id: newId } as CalendarTask);
      void taskHooks.onTaskUpdate.emit(taskToView(moved));
      return true;
    }
    const updated = { ...(before ?? { id }), ...updates, updated: new Date().toISOString() } as CalendarTask;
    // Patch paths like `recurrenceOverrides/<date>` land in the nested map.
    for (const [k, v] of Object.entries(updates)) {
      if (k.startsWith('recurrenceOverrides/')) {
        const overrideKey = k.slice('recurrenceOverrides/'.length);
        const current = (updated.recurrenceOverrides || {}) as Record<string, unknown>;
        updated.recurrenceOverrides = { ...current, [overrideKey]: v as any };
        delete (updated as Record<string, unknown>)[k];
      }
    }
    set({
      tasks: get().tasks.map(t => t.id === id ? updated : t),
    });
    void taskHooks.onTaskUpdate.emit(taskToView(updated));
    return true;
  },

  deleteTask: async (client, id) => {
    const title = get().tasks.find(t => t.id === id)?.title || '';
    if (!(await taskHooks.onBeforeTaskDelete.intercept({ taskId: id, title }))) return false;
    await client.deleteCalendarTask(id);
    set({
      tasks: get().tasks.filter(t => t.id !== id),
      selectedTaskId: get().selectedTaskId === id ? null : get().selectedTaskId,
    });
    void taskHooks.onTaskDelete.emit({ taskId: id, title });
    return true;
  },

  toggleTaskComplete: async (client, task) => {
    const isOccurrence = !!task.recurrenceId || task.id.includes(':');
    const masterId = task.originalId || (task.id.includes(':') ? task.id.split(':')[0] : task.id);
    const master = get().tasks.find((t) => t.id === masterId) || task;
    const recurrenceId = occurrenceRecurrenceId(task);

    if (isOccurrence && recurrenceId) {
      const isCompleted = task.progress === 'completed';
      const newProgress: CalendarTask['progress'] = isCompleted ? 'needs-action' : 'completed';
      const existingEntry = findTaskOverride(master.recurrenceOverrides, recurrenceId) || {};
      const overrideEntry: Partial<CalendarTask> & { excluded?: boolean } = {
        ...existingEntry,
        progress: newProgress,
      };
      delete (overrideEntry as Record<string, unknown>).id;
      delete (overrideEntry as Record<string, unknown>).uid;
      delete (overrideEntry as Record<string, unknown>)['@type'];
      delete (overrideEntry as Record<string, unknown>).calendarIds;
      delete (overrideEntry as Record<string, unknown>).recurrenceRules;
      delete (overrideEntry as Record<string, unknown>).recurrenceOverrides;

      await client.updateCalendarTask(masterId, overridePatch(master, recurrenceId, overrideEntry as Record<string, unknown>));
      set({
        tasks: get().tasks.map((t) => {
          if (t.id !== masterId) return t;
          const current = t.recurrenceOverrides || {};
          return {
            ...t,
            recurrenceOverrides: { ...current, [recurrenceId]: overrideEntry },
            updated: new Date().toISOString(),
          };
        }),
      });
      return;
    }

    let updates: Partial<CalendarTask>;

    if (task.progress !== 'completed' && task.recurrenceRules?.length) {
      const refDateStr = task.due || task.start;
      const refDate = refDateStr ? parseISO(refDateStr) : new Date();
      const nextDate = !isNaN(refDate.getTime())
        ? getNextRecurrenceDate(refDate, task.recurrenceRules[0])
        : null;

      if (nextDate) {
        const newDue = task.due
          ? (task.showWithoutTime ? format(nextDate, 'yyyy-MM-dd') : format(nextDate, "yyyy-MM-dd'T'HH:mm:ss"))
          : null;
        let newStart = task.start;
        if (task.start && task.due) {
          const oldDue = parseISO(task.due);
          const oldStart = parseISO(task.start);
          if (!isNaN(oldDue.getTime()) && !isNaN(oldStart.getTime())) {
            const shiftMs = nextDate.getTime() - oldDue.getTime();
            const shiftedStart = new Date(oldStart.getTime() + shiftMs);
            newStart = task.showWithoutTime ? format(shiftedStart, 'yyyy-MM-dd') : format(shiftedStart, "yyyy-MM-dd'T'HH:mm:ss");
          }
        }
        updates = {
          progress: 'needs-action',
          ...(newDue ? { due: newDue } : {}),
          ...(newStart ? { start: newStart } : {}),
        };
      } else {
        updates = { progress: 'completed' };
      }
    } else {
      const newProgress = task.progress === 'completed' ? 'needs-action' : 'completed';
      updates = { progress: newProgress };
    }

    await client.updateCalendarTask(masterId, updates);
    set({
      tasks: get().tasks.map(t => t.id === masterId ? { ...t, ...updates, updated: new Date().toISOString() } : t),
    });
    // A toggle is reported as onTaskToggleComplete only, not also as
    // onTaskUpdate, so a plugin that listens to both sees each change once.
    void taskHooks.onTaskToggleComplete.emit({ taskId: task.id, complete: newProgress === 'completed' });
  },

  clearTasks: () => set({ tasks: [], selectedTaskId: null, error: null }),
}));
