import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CalendarSidebarPanel } from '../calendar-sidebar-panel';
import type { Calendar } from '@/lib/jmap/types';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => {
    if (key === 'my_calendars') return 'Meine Kalender';
    if (key === 'tasks.label') return 'Aufgaben';
    return key;
  },
}));

const mockSettingsState = {
  timeZone: 'Europe/Berlin',
  timeFormat: '24h',
  sharedCalendarColors: {},
  enableCalendarTasks: true,
};
vi.mock('@/stores/settings-store', () => {
  const fn = (selector: (s: typeof mockSettingsState) => unknown) => selector(mockSettingsState);
  fn.getState = () => mockSettingsState;
  return { useSettingsStore: fn };
});

vi.mock('@/stores/calendar-store', () => ({
  useCalendarStore: (selector: (s: { isSubscriptionCalendar: (id: string) => boolean; icalSubscriptions: unknown[]; refreshICalSubscription: unknown; removeICalSubscription: unknown; setDefaultCalendar: unknown; setViewMode: unknown }) => unknown) =>
    selector({
      isSubscriptionCalendar: () => false,
      icalSubscriptions: [],
      refreshICalSubscription: vi.fn(),
      removeICalSubscription: vi.fn(),
      setDefaultCalendar: vi.fn(),
      setViewMode: vi.fn(),
    }),
}));

vi.mock('@/stores/account-store', () => ({
  useAccountStore: (selector: (s: { accounts: unknown[]; activeAccountId: string | null }) => unknown) =>
    selector({ accounts: [], activeAccountId: null }),
}));

vi.mock('@/stores/task-store', () => ({
  useTaskStore: (selector: (s: { tasks: unknown[] }) => unknown) => selector({ tasks: [] }),
}));

vi.mock('@/stores/toast-store', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

describe('CalendarSidebarPanel - Task Lists (#1208)', () => {
  const calendars: Calendar[] = [
    { id: 'cal-events', name: 'Arbeit Termine', isTasksOnly: false } as Calendar,
    { id: 'cal-tasks-only', name: 'NurAufgaben', isTasksOnly: true } as Calendar,
  ];

  it('renders task-only calendars in their own task lists section with visibility toggle', () => {
    const onToggleVisibility = vi.fn();

    render(
      <CalendarSidebarPanel
        calendars={calendars}
        selectedCalendarIds={['cal-events', 'cal-tasks-only']}
        onToggleVisibility={onToggleVisibility}
      />
    );

    // Both calendars should be visible in the sidebar
    expect(screen.getByText('Arbeit Termine')).toBeDefined();
    const taskCalBtn = screen.getByText('NurAufgaben');
    expect(taskCalBtn).toBeDefined();

    // Clicking task calendar toggles visibility
    fireEvent.click(taskCalBtn);
    expect(onToggleVisibility).toHaveBeenCalledWith('cal-tasks-only');
  });

  it('does not allow creating events or setting default on task-only calendars via context menu', () => {
    const onCreateEvent = vi.fn();
    render(
      <CalendarSidebarPanel
        calendars={calendars}
        selectedCalendarIds={['cal-events', 'cal-tasks-only']}
        onToggleVisibility={vi.fn()}
        onCreateEvent={onCreateEvent}
      />
    );

    const taskCalBtn = screen.getByText('NurAufgaben');
    fireEvent.contextMenu(taskCalBtn);

    // "new_event_in_calendar" should NOT be present in context menu
    expect(screen.queryByText('new_event_in_calendar')).toBeNull();
    expect(screen.queryByText('set_default')).toBeNull();
  });
});
