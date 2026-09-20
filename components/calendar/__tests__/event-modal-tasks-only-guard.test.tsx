import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { EventModal } from '../event-modal';
import type { Calendar, CalendarEvent } from '@/lib/jmap/types';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => 'de',
}));

vi.mock('@/stores/settings-store', () => {
  const state = {
    timeZone: 'Europe/Berlin',
    timeFormat: '24h',
    firstDayOfWeek: 'monday',
  };
  const fn = (selector?: (s: typeof state) => unknown) => (selector ? selector(state) : state);
  fn.getState = () => state;
  return { useSettingsStore: fn };
});

vi.mock('@/stores/calendar-store', () => ({
  useCalendarStore: (selector?: (s: Record<string, unknown>) => unknown) => {
    const state = {
      calendars: [],
      createCalendar: vi.fn(),
    };
    return selector ? selector(state) : state;
  },
}));

vi.mock('@/stores/toast-store', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

describe('EventModal tasks-only & writable calendar guard (#1208)', () => {
  it('does not target tasks-only calendar and prevents saving when no event calendar is available', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const taskOnlyCalendars = [
      {
        id: 'cal-tasks-only',
        name: 'My Tasks List',
        isTasksOnly: true,
        isShared: false,
        myRights: { mayWriteAll: true, mayWriteOwn: true },
      },
    ] as unknown as Calendar[];

    render(
      <EventModal
        calendars={taskOnlyCalendars}
        defaultDate={new Date('2026-09-20T10:00:00Z')}
        onSave={onSave}
        onClose={vi.fn()}
        currentUserEmails={['user@example.com']}
      />
    );

    fireEvent.change(screen.getByPlaceholderText('form.title'), {
      target: { value: 'Dentist appointment' },
    });
    fireEvent.click(screen.getByText('form.save'));

    // Should NOT call onSave because the only calendar is task-only
    expect(onSave).not.toHaveBeenCalled();
  });
});
