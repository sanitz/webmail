import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useTaskStore } from '../task-store';
import type { CalendarTask } from '@/lib/jmap/types';
import type { IJMAPClient } from '@/lib/jmap/client-interface';
import { createRecurrenceRule } from '@/lib/recurrence-rule';

function makeTask(overrides: Partial<CalendarTask> = {}): CalendarTask {
  return {
    id: 'task-1',
    calendarIds: { 'cal-1': true },
    '@type': 'Task',
    uid: 'task-uid-1',
    title: 'Test task',
    description: '',
    due: '2026-09-20',
    start: null,
    duration: null,
    timeZone: null,
    showWithoutTime: true,
    progress: 'needs-action',
    priority: 0,
    privacy: 'public',
    keywords: null,
    categories: null,
    color: null,
    created: '2026-09-01T10:00:00Z',
    updated: '2026-09-01T10:00:00Z',
    recurrenceRules: null,
    alerts: null,
    relatedTo: null,
    ...overrides,
  };
}

describe('task-store recurring toggleTaskComplete', () => {
  let mockClient: Partial<IJMAPClient>;

  beforeEach(() => {
    useTaskStore.setState({
      tasks: [],
      selectedTaskId: null,
      filter: 'all',
      showCompleted: false,
      isLoading: false,
      error: null,
    });

    mockClient = {
      updateCalendarTask: vi.fn().mockResolvedValue(undefined),
    };
  });

  it('advances due date to next occurrence and keeps progress as needs-action for recurring tasks', async () => {
    const task = makeTask({
      id: 't-walk',
      title: 'Lauf 🚶',
      due: '2026-09-20',
      showWithoutTime: true,
      progress: 'needs-action',
      recurrenceRules: [createRecurrenceRule('daily')],
    });
    useTaskStore.setState({ tasks: [task] });

    await useTaskStore.getState().toggleTaskComplete(mockClient as IJMAPClient, task);

    expect(mockClient.updateCalendarTask).toHaveBeenCalledTimes(1);
    const [calledId, calledUpdates] = (mockClient.updateCalendarTask as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(calledId).toBe('t-walk');
    expect(calledUpdates).toMatchObject({
      due: '2026-09-21',
      progress: 'needs-action',
    });

    const updatedTask = useTaskStore.getState().tasks.find((t) => t.id === 't-walk');
    expect(updatedTask?.due).toBe('2026-09-21');
    expect(updatedTask?.progress).toBe('needs-action');
  });

  it('preserves due time when advancing timed recurring tasks', async () => {
    const task = makeTask({
      id: 't-timed',
      title: 'Weekly Standup',
      due: '2026-09-21T09:30:00',
      showWithoutTime: false,
      progress: 'needs-action',
      recurrenceRules: [createRecurrenceRule('weekly')],
    });
    useTaskStore.setState({ tasks: [task] });

    await useTaskStore.getState().toggleTaskComplete(mockClient as IJMAPClient, task);

    const [calledId, calledUpdates] = (mockClient.updateCalendarTask as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(calledId).toBe('t-timed');
    expect(calledUpdates).toMatchObject({
      due: '2026-09-28T09:30:00',
      progress: 'needs-action',
    });
  });

  it('sets progress to completed when the final recurrence occurrence is completed', async () => {
    const task = makeTask({
      id: 't-final',
      title: 'Final task',
      due: '2026-09-20',
      showWithoutTime: true,
      progress: 'needs-action',
      recurrenceRules: [createRecurrenceRule('daily', { count: 1 })],
    });
    useTaskStore.setState({ tasks: [task] });

    await useTaskStore.getState().toggleTaskComplete(mockClient as IJMAPClient, task);

    const [calledId, calledUpdates] = (mockClient.updateCalendarTask as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(calledId).toBe('t-final');
    expect(calledUpdates).toMatchObject({
      progress: 'completed',
    });
  });
});
