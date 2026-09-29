import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { RecurrenceScopeDialog } from '../recurrence-scope-dialog';

describe('RecurrenceScopeDialog', () => {
  it('renders options for edit action and selects scope', () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();

    render(
      <RecurrenceScopeDialog
        isOpen={true}
        actionType="edit"
        onSelect={onSelect}
        onClose={onClose}
      />
    );

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('this_event')).toBeInTheDocument();
    expect(screen.getByText('this_and_future')).toBeInTheDocument();
    expect(screen.getByText('all_events')).toBeInTheDocument();

    // Select "this_and_future"
    fireEvent.click(screen.getByText('this_and_future'));
    fireEvent.click(screen.getByText('save'));

    expect(onSelect).toHaveBeenCalledWith('this_and_future');
  });

  it('renders options for delete action and selects scope', () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();

    render(
      <RecurrenceScopeDialog
        isOpen={true}
        actionType="delete"
        onSelect={onSelect}
        onClose={onClose}
      />
    );

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('delete_title')).toBeInTheDocument();

    // Select "all"
    fireEvent.click(screen.getByText('all_events'));
    fireEvent.click(screen.getByText('delete'));

    expect(onSelect).toHaveBeenCalledWith('all');
  });
});
