import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TaskListView } from '../task-list-view';
import type { Calendar, CalendarTask } from '@/lib/jmap/types';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
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

  it('displays tasks in task-only calendars even when not in selectedCalendarIds (#1208)', () => {
    // selectedCalendarIds only contains event calendars ('cal-events')
    const selectedCalendarIds = ['cal-events'];
    const tasks = [
      makeTask('t1', 'cal-tasks-only', 'Task in Tasks-Only Calendar'),
      makeTask('t2', 'cal-events', 'Task in Event Calendar'),
    ];

    render(
      <TaskListView
        tasks={tasks}
        calendars={calendars}
        selectedCalendarIds={selectedCalendarIds}
        filter="all"
        showCompleted={false}
        onSelectTask={vi.fn()}
        onToggleComplete={vi.fn()}
      />
    );

    expect(screen.getByText('Task in Tasks-Only Calendar')).toBeDefined();
    expect(screen.getByText('Task in Event Calendar')).toBeDefined();
  });
});
