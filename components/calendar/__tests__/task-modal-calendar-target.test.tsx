import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { TaskModal } from '../task-modal';
import type { Calendar, CalendarTask } from '@/lib/jmap/types';

describe('TaskModal calendar target resolution (#1208)', () => {
  it('unwraps namespaced calendar IDs to raw originalId on save', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const calendars = [
      {
        id: 'acc1::raw-cal-tasks',
        originalId: 'raw-cal-tasks',
        name: 'My Tasks',
        isTasksOnly: true,
        isShared: false,
        myRights: { mayWriteAll: true, mayWriteOwn: true },
      },
    ] as unknown as Calendar[];

    render(
      <TaskModal
        calendars={calendars}
        onSave={onSave}
        onClose={vi.fn()}
      />
    );

    fireEvent.change(screen.getByPlaceholderText('tasks.title_placeholder'), {
      target: { value: 'Buy groceries' },
    });
    fireEvent.click(screen.getByText('tasks.save'));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const saved = onSave.mock.calls[0][0] as Partial<CalendarTask>;
    expect(saved.calendarIds).toEqual({ 'raw-cal-tasks': true });
  });

  it('does not allow saving when no writable calendar exists', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const calendars = [
      {
        id: 'read-only-cal',
        originalId: 'read-only-cal',
        name: 'Shared View Only',
        isShared: true,
        myRights: { mayWriteAll: false, mayWriteOwn: false },
      },
    ] as unknown as Calendar[];

    render(
      <TaskModal
        calendars={calendars}
        onSave={onSave}
        onClose={vi.fn()}
      />
    );

    fireEvent.change(screen.getByPlaceholderText('tasks.title_placeholder'), {
      target: { value: 'Try save' },
    });
    fireEvent.click(screen.getByText('tasks.save'));

    // Should not save without a writable calendar target
    expect(onSave).not.toHaveBeenCalled();
  });
});
