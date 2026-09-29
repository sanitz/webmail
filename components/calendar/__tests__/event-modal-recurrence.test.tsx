import { render, screen, fireEvent, act } from '@testing-library/react';
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

const toastError = vi.fn();
vi.mock('@/stores/toast-store', () => ({
  toast: { success: vi.fn(), error: (...args: unknown[]) => toastError(...args) },
}));

const calendars = [
  {
    id: 'cal-work',
    name: 'Work Calendar',
    isDefault: true,
    isShared: false,
    myRights: { mayWriteAll: true, mayWriteOwn: true },
  },
] as unknown as Calendar[];

describe('EventModal recurrence handling', () => {
  it('saves weekly recurrence when selected on new event', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(
      <EventModal
        calendars={calendars}
        defaultDate={new Date('2026-09-30T10:00:00Z')}
        onSave={onSave}
        onClose={vi.fn()}
        currentUserEmails={['user@example.com']}
      />
    );

    fireEvent.change(screen.getByPlaceholderText('form.title'), {
      target: { value: 'Weekly Team Sync' },
    });

    const weeklyOption = screen.getByText('recurrence.weekly');
    const recurrenceSelect = weeklyOption.closest('select') as HTMLSelectElement;
    expect(recurrenceSelect).toBeDefined();

    fireEvent.change(recurrenceSelect!, { target: { value: 'weekly' } });

    await act(async () => {
      fireEvent.click(screen.getByText('form.save'));
    });

    expect(onSave).toHaveBeenCalledTimes(1);
    const savedData = onSave.mock.calls[0][0] as Partial<CalendarEvent>;
    expect(savedData.title).toBe('Weekly Team Sync');
    expect(savedData.recurrenceRules).toBeDefined();
    expect(savedData.recurrenceRules).toHaveLength(1);
    expect(savedData.recurrenceRules![0].frequency).toBe('weekly');
  });
});
