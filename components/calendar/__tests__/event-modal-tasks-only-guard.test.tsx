import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { EventModal } from '../event-modal';
import type { Calendar } from '@/lib/jmap/types';

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
    expect(toastError).toHaveBeenCalledWith('errors.no_writable_calendar_for_event');
  });

  it('tells the user why saving is blocked when editing an event whose calendar became tasks-only (#1208 review finding #6)', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    // selectableCalendars always includes the event's own current calendar
    // (so an in-place edit never blanks the select) even when it is no
    // longer writable - handleSave's guard is the only thing stopping the
    // save in that case, and it must tell the user why nothing happened.
    const calendars = [
      {
        id: 'cal-now-tasks-only',
        name: 'Was Termine, jetzt Aufgaben',
        isTasksOnly: true,
        isShared: false,
        myRights: { mayWriteAll: true, mayWriteOwn: true },
      },
    ] as unknown as Calendar[];

    render(
      <EventModal
        calendars={calendars}
        event={{
          id: 'ev-1',
          title: 'Altes Meeting',
          calendarIds: { 'cal-now-tasks-only': true },
          start: '2026-09-20T10:00:00',
          duration: 'PT1H',
        } as never}
        defaultDate={new Date('2026-09-20T10:00:00Z')}
        onSave={onSave}
        onClose={vi.fn()}
        currentUserEmails={['user@example.com']}
      />
    );

    // Existing event with edit rights on the account renders a detail view
    // with an explicit edit toggle first.
    fireEvent.click(screen.getByText('events.edit'));
    fireEvent.click(screen.getByText('form.save'));

    expect(onSave).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalled();
  });


  it('picks up the default calendar and allows saving when calendars load asynchronously after mount', async () => {
    toastError.mockClear();
    const onSave = vi.fn().mockResolvedValue(undefined);

    // Initial mount with empty calendars (as during initial page fetch)
    const { rerender } = render(
      <EventModal
        calendars={[]}
        defaultDate={new Date('2026-09-20T10:00:00Z')}
        onSave={onSave}
        onClose={vi.fn()}
        currentUserEmails={['user@example.com']}
      />
    );

    // Calendars arrive from JMAP fetch
    const loadedCalendars = [
      {
        id: 'cal-work',
        name: 'Work Calendar',
        isDefault: true,
        isShared: false,
        myRights: { mayWriteAll: true, mayWriteOwn: true },
      },
      {
        id: 'cal-private',
        name: 'Private',
        isDefault: false,
        isShared: false,
        myRights: { mayWriteAll: true, mayWriteOwn: true },
      },
    ] as unknown as Calendar[];

    await act(async () => {
      rerender(
        <EventModal
          calendars={loadedCalendars}
          defaultDate={new Date('2026-09-20T10:00:00Z')}
          onSave={onSave}
          onClose={vi.fn()}
          currentUserEmails={['user@example.com']}
        />
      );
    });

    fireEvent.change(screen.getByPlaceholderText('form.title'), {
      target: { value: 'New Event Title' },
    });
    await act(async () => {
      fireEvent.click(screen.getByText('form.save'));
    });

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'New Event Title',
        calendarIds: { 'cal-work': true },
      }),
      false
    );
  });

  it('resolves namespaced or originalId calendars and saves successfully', async () => {
    toastError.mockClear();
    const onSave = vi.fn().mockResolvedValue(undefined);

    const namespacedCalendars = [
      {
        id: 'acc1:cal-work',
        originalId: 'cal-work',
        name: 'Work Calendar',
        isDefault: true,
        isShared: false,
        myRights: { mayWriteAll: true, mayWriteOwn: true },
      },
    ] as unknown as Calendar[];

    await act(async () => {
      render(
        <EventModal
          calendars={namespacedCalendars}
          defaultCalendarId="cal-work"
          defaultDate={new Date('2026-09-20T10:00:00Z')}
          onSave={onSave}
          onClose={vi.fn()}
          currentUserEmails={['user@example.com']}
        />
      );
    });

    fireEvent.change(screen.getByPlaceholderText('form.title'), {
      target: { value: 'Namespaced Event Title' },
    });
    await act(async () => {
      fireEvent.click(screen.getByText('form.save'));
    });

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Namespaced Event Title',
        calendarIds: { 'acc1:cal-work': true },
      }),
      false
    );
  });
});

