import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useCalendarStore } from '@/stores/calendar-store';
import { canCreateEventsIn } from '@/lib/calendar-editability';
import type { IJMAPClient } from '@/lib/jmap/client-interface';
import type { Calendar, CalendarRights } from '@/lib/jmap/types';

const ALL_RIGHTS: CalendarRights = {
  mayReadFreeBusy: true,
  mayReadItems: true,
  mayWriteAll: true,
  mayWriteOwn: true,
  mayUpdatePrivate: true,
  mayRSVP: true,
  mayShare: true,
  mayDelete: true,
};

describe('useCalendarStore - task-only calendar persistence (#1208)', () => {
  beforeEach(() => {
    useCalendarStore.getState().clearState();
  });

  it('records taskCalendarIds and marks calendar as isTasksOnly on creation with VTODO', async () => {
    const mockClient = {
      createCalendar: vi.fn().mockResolvedValue({
        id: 'cal-nuraufgaben',
        name: 'NurAufgaben',
        color: '#ff0000',
        isVisible: true,
        isSubscribed: true,
      } as Calendar),
    } as unknown as IJMAPClient;

    const created = await useCalendarStore.getState().createCalendar(
      mockClient,
      { name: 'NurAufgaben', color: '#ff0000' },
      { components: ['VTODO'] }
    );

    expect(created?.isTasksOnly).toBe(true);
    const state = useCalendarStore.getState();
    expect(state.taskCalendarIds['cal-nuraufgaben']).toBe(true);
    expect(state.calendars.find((c) => c.id === 'cal-nuraufgaben')?.isTasksOnly).toBe(true);
    // Task-only calendar should be added to selectedCalendarIds (checked in sidebar)
    expect(state.selectedCalendarIds).toContain('cal-nuraufgaben');
  });

  it('adds regular/combined calendar to selectedCalendarIds and leaves isTasksOnly false', async () => {
    const mockClient = {
      createCalendar: vi.fn().mockResolvedValue({
        id: 'cal-events',
        name: 'Mein Kalender',
        color: '#3b82f6',
        isVisible: true,
        isSubscribed: true,
      } as Calendar),
    } as unknown as IJMAPClient;

    const created = await useCalendarStore.getState().createCalendar(
      mockClient,
      { name: 'Mein Kalender', color: '#3b82f6' },
      { components: ['VEVENT', 'VTODO'] }
    );

    expect(created?.isTasksOnly).toBeFalsy();
    const state = useCalendarStore.getState();
    expect(state.taskCalendarIds['cal-events']).toBeUndefined();
    expect(state.selectedCalendarIds).toContain('cal-events');
  });

  it('merges taskCalendarIds during fetchCalendars for empty calendars with custom names', async () => {
    // Pre-populate taskCalendarIds (e.g. from local storage / previous creation)
    useCalendarStore.setState({
      taskCalendarIds: { 'cal-custom-task': true },
    });

    const mockClient = {
      getParticipantIdentities: vi.fn().mockResolvedValue([]),
      getAllCalendars: vi.fn().mockResolvedValue([
        { id: 'cal-custom-task', name: 'NurAufgaben', isTasksOnly: false },
        { id: 'cal-regular', name: 'Privat', isTasksOnly: false },
      ] as Calendar[]),
    } as unknown as IJMAPClient;

    await useCalendarStore.getState().fetchCalendars(mockClient);

    const state = useCalendarStore.getState();
    const taskCal = state.calendars.find((c) => c.id === 'cal-custom-task');
    const regularCal = state.calendars.find((c) => c.id === 'cal-regular');

    expect(taskCal?.isTasksOnly).toBe(true);
    expect(regularCal?.isTasksOnly).toBe(false);
    expect(state.selectedCalendarIds).toContain('cal-regular');
    expect(state.selectedCalendarIds).toContain('cal-custom-task');
  });

  it('merges taskCalendarIds in multi-account aggregated fetchAllAccountsCalendars', async () => {
    useCalendarStore.setState({
      taskCalendarIds: { 'cal-acct2-tasks': true },
    });

    const mockClient1 = {
      getAllCalendars: vi.fn().mockResolvedValue([
        { id: 'cal-acct1-events', name: 'Main Work', isTasksOnly: false },
      ] as Calendar[]),
    } as unknown as IJMAPClient;

    const mockClient2 = {
      getAllCalendars: vi.fn().mockResolvedValue([
        { id: 'cal-acct2-tasks', name: 'Private Todo', isTasksOnly: false },
      ] as Calendar[]),
    } as unknown as IJMAPClient;

    await useCalendarStore.getState().fetchAllAccountsCalendars([
      { localAccountId: 'acct1', client: mockClient1 },
      { localAccountId: 'acct2', client: mockClient2 },
    ]);

    const state = useCalendarStore.getState();
    const acct1Cal = state.calendars.find((c) => c.originalId === 'cal-acct1-events');
    const acct2Cal = state.calendars.find((c) => c.originalId === 'cal-acct2-tasks');

    expect(acct1Cal?.isTasksOnly).toBe(false);
    expect(acct2Cal?.isTasksOnly).toBe(true);
    expect(state.selectedCalendarIds).toContain(acct1Cal?.id);
    expect(state.selectedCalendarIds).toContain(acct2Cal?.id);
  });

  it('cleans up taskCalendarIds when a calendar is removed', async () => {
    useCalendarStore.setState({
      taskCalendarIds: { 'cal-to-delete': true, 'cal-to-keep': true },
      calendars: [
        { id: 'cal-to-delete', name: 'Aufgaben Alt' } as Calendar,
        { id: 'cal-to-keep', name: 'Aufgaben Neu' } as Calendar,
      ],
    });

    const mockClient = {
      deleteCalendar: vi.fn().mockResolvedValue(undefined),
    } as unknown as IJMAPClient;

    await useCalendarStore.getState().removeCalendar(mockClient, 'cal-to-delete');

    const state = useCalendarStore.getState();
    expect(state.taskCalendarIds['cal-to-delete']).toBeUndefined();
    expect(state.taskCalendarIds['cal-to-keep']).toBe(true);
  });

  it('preserves taskCalendarIds across clearState (account switch lifecycle)', () => {
    useCalendarStore.setState({
      taskCalendarIds: { 'cal-saved-task': true },
      selectedCalendarIds: ['cal-saved-task'],
    });

    useCalendarStore.getState().clearState();

    const state = useCalendarStore.getState();
    expect(state.taskCalendarIds['cal-saved-task']).toBe(true);
    expect(state.selectedCalendarIds).toEqual([]);
  });

  it('integrates with canCreateEventsIn to ensure task calendars are never chosen for events', () => {
    const taskCal: Calendar = {
      id: 'cal-tasks-only',
      name: 'NurAufgaben',
      color: '#ff0000',
      isTasksOnly: true,
      myRights: ALL_RIGHTS,
    } as Calendar;

    const eventCal: Calendar = {
      id: 'cal-events-only',
      name: 'Termine',
      color: '#3b82f6',
      isTasksOnly: false,
      myRights: ALL_RIGHTS,
    } as Calendar;

    expect(canCreateEventsIn(taskCal)).toBe(false);
    expect(canCreateEventsIn(eventCal)).toBe(true);

    const availableCalendars = [taskCal, eventCal];
    const targetCalendar = availableCalendars.find((c) => canCreateEventsIn(c));
    expect(targetCalendar?.id).toBe('cal-events-only');
  });
});
