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

  it.each(['edit', 'rsvp'] as const)('hides "this event only" for %s when single occurrences are blocked', (actionType) => {
    const onSelect = vi.fn();
    render(
      <RecurrenceScopeDialog
        isOpen={true}
        actionType={actionType}
        singleOccurrenceBlocked={true}
        onSelect={onSelect}
        onClose={vi.fn()}
      />
    );

    expect(screen.queryByText('this_event')).not.toBeInTheDocument();
    expect(screen.getByText('single_occurrence_blocked')).toBeInTheDocument();
    fireEvent.click(screen.getByText(actionType === 'rsvp' ? 'respond' : 'save'));
    expect(onSelect).toHaveBeenCalledWith(actionType === 'rsvp' ? 'all' : 'this_and_future');
  });

  it('keeps "this event only" for delete even when single occurrences are blocked', () => {
    render(
      <RecurrenceScopeDialog
        isOpen={true}
        actionType="delete"
        singleOccurrenceBlocked={true}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText('this_event')).toBeInTheDocument();
    expect(screen.queryByText('single_occurrence_blocked')).not.toBeInTheDocument();
  });
});
