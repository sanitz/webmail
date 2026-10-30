import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TaskListView } from '../task-list-view';
import type { Calendar, CalendarTask } from '@/lib/jmap/types';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
  useFormatter: () => ({ dateTime: (d: Date | string) => String(d), relativeTime: (d: Date | string) => String(d), number: (n: number) => String(n) }),
}));

vi.mock('@/stores/settings-store', () => ({
  useSettingsStore: (selector: (s: { timeFormat: string }) => unknown) => selector({ timeFormat: '24h' }),
}));

function makeTask(id: string, calendarId: string, title: string): CalendarTask {
  return {
    id,
    calendarIds: { [calendarId]: true },
    '@type': 'Task',
    uid: `uid-${id}`,
    title,
    description: '',
    due: null,
    start: null,
    duration: null,
    timeZone: null,
    showWithoutTime: false,
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
  };
}

describe('TaskListView', () => {
  const calendars: Calendar[] = [
    { id: 'cal-events', name: 'Work Events', isTasksOnly: false } as Calendar,
    { id: 'cal-tasks-only', name: 'NurAufgaben', isTasksOnly: true } as Calendar,
  ];

  it('filters tasks based on selectedCalendarIds for all collections including task-only (#1208)', () => {
    const tasks = [
      makeTask('t1', 'cal-tasks-only', 'Task in Tasks-Only Calendar'),
      makeTask('t2', 'cal-events', 'Task in Event Calendar'),
    ];

    // When cal-tasks-only is selected, its tasks are shown
    const { rerender } = render(
      <TaskListView
        tasks={tasks}
        calendars={calendars}
        selectedCalendarIds={['cal-events', 'cal-tasks-only']}
        filter="all"
        onSelectTask={vi.fn()}
        onToggleComplete={vi.fn()}
      />
    );

    expect(screen.getByText('Task in Tasks-Only Calendar')).toBeDefined();
    expect(screen.getByText('Task in Event Calendar')).toBeDefined();

    // When cal-tasks-only is unselected/hidden, its tasks MUST be filtered out
    rerender(
      <TaskListView
        tasks={tasks}
        calendars={calendars}
        selectedCalendarIds={['cal-events']}
        filter="all"
        onSelectTask={vi.fn()}
        onToggleComplete={vi.fn()}
      />
    );

    expect(screen.queryByText('Task in Tasks-Only Calendar')).toBeNull();
    expect(screen.getByText('Task in Event Calendar')).toBeDefined();
  });
});
