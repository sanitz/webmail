import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { CalendarDayView } from '../calendar-day-view';
import type { CalendarEvent, Calendar, CalendarTask } from '@/lib/jmap/types';

const calendars = [{ id: 'cal-1', name: 'Work', color: '#123456' }] as unknown as Calendar[];

function makeTask(id: string, due: string, overrides: Partial<CalendarTask> = {}): CalendarTask {
  return {
    id,
    '@type': 'Task',
    uid: id,
    title: 'Task ' + id,
    description: '',
    due,
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
    created: null,
    updated: '2026-09-01T00:00:00Z',
    recurrenceRules: null,
    alerts: null,
    relatedTo: null,
    calendarIds: { 'cal-1': true },
    ...overrides,
  };
}

function makeAllDayEvent(id: string, start: string): CalendarEvent {
  return {
    id,
    '@type': 'Event',
    uid: id,
    title: 'Event ' + id,
    start,
    duration: 'P1D',
    showWithoutTime: true,
    calendarIds: { 'cal-1': true },
  } as unknown as CalendarEvent;
}

type Props = React.ComponentProps<typeof CalendarDayView>;

function renderView(overrides: Partial<Props> = {}) {
  const props: Props = {
    focus: { date: new Date(2026, 8, 9), nonce: 0 },
    windowKey: 'day:2026-09-09',
    // Load 21 days so "far away" events are out of view
    rangeStart: new Date(2026, 8, 1),
    rangeEnd: new Date(2026, 8, 21),
    selectedDate: new Date(2026, 8, 9),
    events: [],
    calendars,
    onSelectEvent: vi.fn(),
    onCreateAtTime: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<CalendarDayView {...props} />) };
}

describe('CalendarDayView all-day area visible-window sizing (#1324)', () => {
  afterEach(() => {
    cleanup();
  });

  it('hides the all-day area when only non-visible days have entries', () => {
    // Focus is Sep 9. All events are far away on Sep 20.
    renderView({
      events: [
        makeAllDayEvent('e1', '2026-09-20'),
        makeAllDayEvent('e2', '2026-09-20'),
        makeAllDayEvent('e3', '2026-09-20'),
        makeAllDayEvent('e4', '2026-09-20'),
      ],
    });

    // The all-day area should not be rendered because the visible day (Sep 9) has no entries
    expect(document.querySelector('[data-testid="day-all-day-grid"]')).toBeNull();
  });

  it('caps the all-day area at 3 rows and shows an expand toggle when the visible day is crowded', () => {
    // Focus day Sep 9 has 5 tasks
    renderView({
      tasks: [
        makeTask('t1', '2026-09-09'),
        makeTask('t2', '2026-09-09'),
        makeTask('t3', '2026-09-09'),
        makeTask('t4', '2026-09-09'),
        makeTask('t5', '2026-09-09'),
      ],
    });

    const toggle = screen.getByRole('button', { name: /all-day-expand/i });
    expect(toggle).toBeInTheDocument();
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    // Default height is capped to 3 rows (3 * 24 + 4 = 76px)
    const allDayGrid = document.querySelector<HTMLElement>('[data-testid="day-all-day-grid"]');
    expect(allDayGrid).toBeInTheDocument();
    expect(allDayGrid?.style.height).toBe('76px');

    // Click toggle to expand
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(allDayGrid?.style.height).toBe('124px'); // 5 * 24 + 4
  });

  it('resizes the all-day area when scrolling to a day with entries (#1324)', async () => {
    renderView({
      events: [
        makeAllDayEvent('e1', '2026-09-15'),
        makeAllDayEvent('e2', '2026-09-15'),
        makeAllDayEvent('e3', '2026-09-15'),
        makeAllDayEvent('e4', '2026-09-15'),
      ],
    });
    // Initially: focus day (Sep 9) has no entries → no all-day area
    expect(document.querySelector('[data-testid="day-all-day-grid"]')).toBeNull();

    // Scroll the strip to Sep 15 (index 14 from rangeStart Sep 1)
    const strip = document.querySelector<HTMLElement>('[role="grid"]')!;
    const colEl = document.querySelector<HTMLElement>('[data-day]')!;
    // In day view each column = viewport width, get computed width
    const colWidth = colEl.getBoundingClientRect().width || 600;
    strip.scrollLeft = 14 * colWidth;
    fireEvent.scroll(strip);
    await new Promise((r) => requestAnimationFrame(() => r(null)));

    // Now the all-day area should appear with a height cap
    const allDayGrid = await screen.findByTestId('day-all-day-grid');
    expect(allDayGrid.style.height).toBe('76px');
    expect(screen.getByRole('button', { name: /all-day-expand/i })).toBeInTheDocument();
  });
});
