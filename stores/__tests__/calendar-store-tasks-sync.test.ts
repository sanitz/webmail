import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useCalendarStore } from '@/stores/calendar-store';
import { useSettingsStore } from '@/stores/settings-store';
import type { IJMAPClient } from '@/lib/jmap/client-interface';
import type { Calendar } from '@/lib/jmap/types';

describe('calendar-store <-> settings-store taskCalendarIds sync (#1208)', () => {
  beforeEach(() => {
    useCalendarStore.getState().clearState();
    useSettingsStore.setState({
      taskCalendarIds: {},
      enableCalendarTasks: true,
    });
  });

  it('merges taskCalendarIds from settings-store during fetchCalendars', async () => {
    // Settings store has the synced task calendar ID (e.g. loaded from server in an incognito tab)
    useSettingsStore.setState({
      taskCalendarIds: { 'cal-synced-tasks': true },
    });

    const mockClient = {
      getParticipantIdentities: vi.fn().mockResolvedValue([]),
      getAllCalendars: vi.fn().mockResolvedValue([
        { id: 'cal-synced-tasks', name: 'NurAufgaben', isTasksOnly: false },
        { id: 'cal-events', name: 'Termine', isTasksOnly: false },
      ] as Calendar[]),
    } as unknown as IJMAPClient;

    await useCalendarStore.getState().fetchCalendars(mockClient);

    const state = useCalendarStore.getState();
    const taskCal = state.calendars.find((c) => c.id === 'cal-synced-tasks');
    const eventCal = state.calendars.find((c) => c.id === 'cal-events');

    expect(taskCal?.isTasksOnly).toBe(true);
    expect(eventCal?.isTasksOnly).toBe(false);
    expect(state.taskCalendarIds['cal-synced-tasks']).toBe(true);
  });

  it('updates settings-store when createCalendar creates a VTODO calendar', async () => {
    const mockClient = {
      createCalendar: vi.fn().mockResolvedValue({
        id: 'cal-new-task',
        name: 'NurAufgaben',
        color: '#ff0000',
        isVisible: true,
        isSubscribed: true,
      } as Calendar),
    } as unknown as IJMAPClient;

    await useCalendarStore.getState().createCalendar(
      mockClient,
      { name: 'NurAufgaben', color: '#ff0000' },
      { components: ['VTODO'] }
    );

    const settingsState = useSettingsStore.getState();
    expect(settingsState.taskCalendarIds['cal-new-task']).toBe(true);
  });

  it('updates settings-store when removeCalendar deletes a task calendar', async () => {
    useSettingsStore.setState({
      taskCalendarIds: { 'cal-to-delete': true, 'cal-keep': true },
    });
    useCalendarStore.setState({
      taskCalendarIds: { 'cal-to-delete': true, 'cal-keep': true },
      calendars: [
        { id: 'cal-to-delete', name: 'Alte Aufgaben' } as Calendar,
        { id: 'cal-keep', name: 'Neue Aufgaben' } as Calendar,
      ],
    });

    const mockClient = {
      deleteCalendar: vi.fn().mockResolvedValue(undefined),
    } as unknown as IJMAPClient;

    await useCalendarStore.getState().removeCalendar(mockClient, 'cal-to-delete');

    const settingsState = useSettingsStore.getState();
    expect(settingsState.taskCalendarIds['cal-to-delete']).toBeUndefined();
    expect(settingsState.taskCalendarIds['cal-keep']).toBe(true);
  });
});
