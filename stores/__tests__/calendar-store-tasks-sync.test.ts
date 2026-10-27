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
      getAllCalendarsWithFailures: vi.fn().mockResolvedValue({ calendars: [
        { id: 'cal-synced-tasks', name: 'NurAufgaben', isTasksOnly: false },
        { id: 'cal-events', name: 'Termine', isTasksOnly: false },
      ] as Calendar[], failedAccountIds: [] }),
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

  it('clears a stale sticky taskCalendarIds flag when detection definitively says the calendar now has events (#1208 review)', async () => {
    // The calendar was previously flagged tasks-only (e.g. a transient
    // content-scan false-positive, or the CalDAV component-set changed),
    // but this fetch's detection is DEFINITIVE (CalDAV confirmed VEVENT
    // support, or the content-scan actually found a real event object).
    useSettingsStore.setState({
      taskCalendarIds: { 'cal-actually-mixed': true },
    });
    useCalendarStore.setState({ taskCalendarIds: { 'cal-actually-mixed': true } });

    const mockClient = {
      getParticipantIdentities: vi.fn().mockResolvedValue([]),
      getAllCalendarsWithFailures: vi.fn().mockResolvedValue({ calendars: [
        { id: 'cal-actually-mixed', name: 'NurAufgaben', isTasksOnly: false, isTasksOnlyConfirmed: true },
      ] as Calendar[], failedAccountIds: [] }),
    } as unknown as IJMAPClient;

    await useCalendarStore.getState().fetchCalendars(mockClient);

    const state = useCalendarStore.getState();
    const cal = state.calendars.find((c) => c.id === 'cal-actually-mixed');

    expect(cal?.isTasksOnly).toBe(false);
    expect(state.taskCalendarIds['cal-actually-mixed']).toBeUndefined();
    expect(useSettingsStore.getState().taskCalendarIds['cal-actually-mixed']).toBeUndefined();
  });

  it('leaves a task-only calendar out of selectedCalendarIds per upstream 1.18.0 contract (#1208 review)', async () => {
    // Simulate an existing user: they already had a non-empty selection from
    // a prior fetch that only knew about one event calendar.
    useCalendarStore.setState({
      calendars: [{ id: 'cal-events', name: 'Termine', isTasksOnly: false } as Calendar],
      selectedCalendarIds: ['cal-events'],
    });

    const mockClient = {
      getParticipantIdentities: vi.fn().mockResolvedValue([]),
      getAllCalendarsWithFailures: vi.fn().mockResolvedValue({ calendars: [
        { id: 'cal-events', name: 'Termine', isTasksOnly: false },
        { id: 'cal-new-tasks', name: 'NurAufgaben', isTasksOnly: true, isTasksOnlyConfirmed: true },
      ] as Calendar[], failedAccountIds: [] }),
    } as unknown as IJMAPClient;

    await useCalendarStore.getState().fetchCalendars(mockClient);

    const state = useCalendarStore.getState();
    // Upstream 1.18.0 withNewCalendars keeps task-only calendars out of
    // selectedCalendarIds by default while recording them in taskCalendarIds.
    expect(state.selectedCalendarIds).toContain('cal-events');
    expect(state.selectedCalendarIds).not.toContain('cal-new-tasks');
    expect(state.taskCalendarIds['cal-new-tasks']).toBe(true);
  });

  it('respects a user having deliberately unselected an already-known task calendar (#1208 review)', async () => {
    // The task calendar was already known and the user unchecked it - a
    // later fetch must not silently re-select it just because it's absent
    // from selectedCalendarIds.
    useCalendarStore.setState({
      calendars: [
        { id: 'cal-events', name: 'Termine', isTasksOnly: false } as Calendar,
        { id: 'cal-old-tasks', name: 'Alte Aufgaben', isTasksOnly: true } as Calendar,
      ],
      selectedCalendarIds: ['cal-events'],
    });

    const mockClient = {
      getParticipantIdentities: vi.fn().mockResolvedValue([]),
      getAllCalendarsWithFailures: vi.fn().mockResolvedValue({ calendars: [
        { id: 'cal-events', name: 'Termine', isTasksOnly: false },
        { id: 'cal-old-tasks', name: 'Alte Aufgaben', isTasksOnly: true, isTasksOnlyConfirmed: true },
      ] as Calendar[], failedAccountIds: [] }),
    } as unknown as IJMAPClient;

    await useCalendarStore.getState().fetchCalendars(mockClient);

    const state = useCalendarStore.getState();
    expect(state.selectedCalendarIds).not.toContain('cal-old-tasks');
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

  it('tombstones a removed task calendar so a later stale import cannot resurrect it (#1208 review)', async () => {
    useSettingsStore.setState({
      taskCalendarIds: { 'cal-to-delete': true },
      deletedTaskCalendarIds: {},
    });
    useCalendarStore.setState({
      taskCalendarIds: { 'cal-to-delete': true },
      calendars: [{ id: 'cal-to-delete', name: 'Alte Aufgaben' } as Calendar],
    });

    const mockClient = {
      deleteCalendar: vi.fn().mockResolvedValue(undefined),
    } as unknown as IJMAPClient;

    await useCalendarStore.getState().removeCalendar(mockClient, 'cal-to-delete');

    expect(useSettingsStore.getState().deletedTaskCalendarIds['cal-to-delete']).toBeTruthy();

    // A stale synced blob from another device/poll arrives after the deletion.
    const staleImport = JSON.stringify({ taskCalendarIds: { 'cal-to-delete': true } });
    useSettingsStore.getState().importSettings(staleImport);

    expect(useSettingsStore.getState().taskCalendarIds['cal-to-delete']).toBeUndefined();
  });
});
