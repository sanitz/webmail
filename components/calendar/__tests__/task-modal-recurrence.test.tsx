import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { TaskModal } from '../task-modal';
import type { CalendarTask, Calendar } from '@/lib/jmap/types';
import { createRecurrenceRule } from '@/lib/recurrence-rule';

const toastError = vi.fn();
vi.mock('@/stores/toast-store', () => ({
  toast: { success: vi.fn(), error: (...args: unknown[]) => toastError(...args) },
}));

const calendars = [{ id: 'cal-1', name: 'Tasks', isShared: false }] as unknown as Calendar[];

function makeTask(overrides: Partial<CalendarTask> = {}): CalendarTask {
  return {
    id: 'task-1',
    '@type': 'Task',
    uid: 'uid-1',
    title: 'Lauf 🚶',
    description: '',
    due: '2026-09-21',
    showWithoutTime: true,
    priority: 0,
    progress: 'needs-action',
    progressUpdated: null,
    calendarIds: { 'cal-1': true },
    recurrenceRules: null,
    alerts: null,
    ...overrides,
  } as unknown as CalendarTask;
}

describe('TaskModal recurrence handling', () => {
  it('renders recurrence selector defaulting to none for non-recurring task', () => {
    render(<TaskModal task={makeTask()} calendars={calendars} onSave={vi.fn()} onClose={vi.fn()} />);

    const recurrenceSelect = screen.getByLabelText(/recurrence\.title/i);
    expect(recurrenceSelect).toBeInTheDocument();
    expect((recurrenceSelect as HTMLSelectElement).value).toBe('none');
  });

  it('selects daily recurrence when editing a recurring task', () => {
    const task = makeTask({
      recurrenceRules: [createRecurrenceRule('daily')],
    });
    render(<TaskModal task={task} calendars={calendars} onSave={vi.fn()} onClose={vi.fn()} />);

    const recurrenceSelect = screen.getByLabelText(/recurrence\.title/i);
    expect((recurrenceSelect as HTMLSelectElement).value).toBe('daily');
  });

  it('saves recurrenceRules when user selects daily recurrence on new task', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<TaskModal calendars={calendars} onSave={onSave} onClose={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText('tasks.title_placeholder'), { target: { value: 'Daily Jog' } });
    fireEvent.change(screen.getByLabelText(/recurrence\.title/i), { target: { value: 'daily' } });
    fireEvent.click(screen.getByText('tasks.save'));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const patch = onSave.mock.calls[0][0] as Partial<CalendarTask>;
    expect(patch.title).toBe('Daily Jog');
    expect(patch.recurrenceRules).toHaveLength(1);
    expect(patch.recurrenceRules![0]).toMatchObject({
      '@type': 'RecurrenceRule',
      frequency: 'daily',
    });
  });

  it('preserves recurrenceRules when user edits due date of a recurring task', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const task = makeTask({
      due: '2026-09-21',
      recurrenceRules: [createRecurrenceRule('daily')],
    });
    render(<TaskModal task={task} calendars={calendars} onSave={onSave} onClose={vi.fn()} />);

    // Change due date to 2026-10-01
    const dueDateInput = screen.getByDisplayValue('2026-09-21');
    fireEvent.change(dueDateInput, { target: { value: '2026-10-01' } });
    fireEvent.click(screen.getByText('tasks.save'));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const patch = onSave.mock.calls[0][0] as Partial<CalendarTask>;
    expect(patch.due).toBe('2026-10-01');
    expect(patch.recurrenceRules).toHaveLength(1);
    expect(patch.recurrenceRules![0]).toMatchObject({
      frequency: 'daily',
    });
  });

  it('sets recurrenceRules to null when user removes recurrence from recurring task', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const task = makeTask({
      recurrenceRules: [createRecurrenceRule('daily')],
    });
    render(<TaskModal task={task} calendars={calendars} onSave={onSave} onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(/recurrence\.title/i), { target: { value: 'none' } });
    fireEvent.click(screen.getByText('tasks.save'));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const patch = onSave.mock.calls[0][0] as Partial<CalendarTask>;
    expect(patch.recurrenceRules).toBeNull();
  });

  it('saves weekly recurrence when selected on new task', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<TaskModal calendars={calendars} onSave={onSave} onClose={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText('tasks.title_placeholder'), { target: { value: 'Weekly Review' } });
    fireEvent.change(screen.getByLabelText(/recurrence\.title/i), { target: { value: 'weekly' } });
    fireEvent.click(screen.getByText('tasks.save'));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const patch = onSave.mock.calls[0][0] as Partial<CalendarTask>;
    expect(patch.title).toBe('Weekly Review');
    expect(patch.recurrenceRules).toHaveLength(1);
    expect(patch.recurrenceRules![0]).toMatchObject({
      '@type': 'RecurrenceRule',
      frequency: 'weekly',
    });
  });

  it('shows error toast when onSave throws an error and resets saving state', async () => {
    toastError.mockClear();
    const onSave = vi.fn().mockRejectedValue(new Error('Stalwart rejected recurrence'));
    render(<TaskModal calendars={calendars} onSave={onSave} onClose={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText('tasks.title_placeholder'), { target: { value: 'Failing Task' } });
    fireEvent.click(screen.getByText('tasks.save'));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
  });
});
