import { describe, it, expect } from 'vitest';
import { isTaskLikeObject, findTasksOnlyCalendarIds, type ScannedCalendarObject } from '@/lib/calendar-component-detection';

describe('isTaskLikeObject', () => {
  it('treats an explicit @type Task as a task', () => {
    expect(isTaskLikeObject({ '@type': 'Task' })).toBe(true);
    expect(isTaskLikeObject({ '@type': 'task' })).toBe(true);
  });

  it('treats an @type Event as not a task even with a stray field', () => {
    expect(isTaskLikeObject({ '@type': 'Event' })).toBe(false);
    expect(isTaskLikeObject({ '@type': 'Event', due: '2026-01-01T00:00:00' })).toBe(false);
  });

  it('detects a CalDAV task lacking @type by its task-only fields', () => {
    expect(isTaskLikeObject({ due: '2026-01-01T00:00:00' })).toBe(true);
    expect(isTaskLikeObject({ progress: 'needs-action' })).toBe(true);
    expect(isTaskLikeObject({ percentComplete: 0 })).toBe(true);
  });

  it('treats a plain object with no task markers as an event', () => {
    expect(isTaskLikeObject({})).toBe(false);
    expect(isTaskLikeObject({ '@type': 'Event', title: 'Standup' })).toBe(false);
  });
});

describe('findTasksOnlyCalendarIds', () => {
  it('flags a calendar whose objects are all tasks regardless of calendar name', () => {
    const objects: ScannedCalendarObject[] = [
      { '@type': 'Task', calendarIds: { 'cal-custom-name': true } },
      { due: '2026-01-01T00:00:00', calendarIds: { 'cal-custom-name': true } },
    ];
    expect([...findTasksOnlyCalendarIds(objects, [{ id: 'cal-custom-name', name: 'My Custom List' }])]).toEqual(['cal-custom-name']);
  });

  it('does NOT flag a calendar solely based on its name when empty', () => {
    // Name heuristics are strictly removed - empty calendars without objects are not guessed by name
    expect(findTasksOnlyCalendarIds([], [{ id: 'cal-aufgaben', name: 'Aufgaben' }]).size).toBe(0);
    expect(findTasksOnlyCalendarIds([], [{ id: 'cal-tasks', name: 'Tasks' }]).size).toBe(0);
  });

  it('does not flag a calendar that has at least one event', () => {
    const objects: ScannedCalendarObject[] = [
      { '@type': 'Task', calendarIds: { 'cal-mixed': true } },
      { '@type': 'Event', calendarIds: { 'cal-mixed': true } },
    ];
    expect(findTasksOnlyCalendarIds(objects, [{ id: 'cal-mixed', name: 'Mixed' }]).size).toBe(0);
  });

  it('does not flag an empty regular event calendar', () => {
    expect(findTasksOnlyCalendarIds([], [{ id: 'cal-empty', name: 'Work' }]).size).toBe(0);
    const objects: ScannedCalendarObject[] = [{ '@type': 'Event', calendarIds: { 'cal-other': true } }];
    expect(findTasksOnlyCalendarIds(objects, [{ id: 'cal-empty', name: 'Work' }]).size).toBe(0);
  });

  it('classifies each calendar independently in a mixed account', () => {
    const objects: ScannedCalendarObject[] = [
      { '@type': 'Event', calendarIds: { work: true } },
      { '@type': 'Task', calendarIds: { custom_todos: true } },
      { percentComplete: 50, calendarIds: { custom_todos: true } },
    ];
    const result = findTasksOnlyCalendarIds(objects, [
      { id: 'work', name: 'Work' },
      { id: 'custom_todos', name: 'Arbitrary Name' },
      { id: 'empty', name: 'Personal' },
    ]);
    expect([...result]).toEqual(['custom_todos']);
  });

  it('handles an object that belongs to several calendars', () => {
    const objects: ScannedCalendarObject[] = [
      { '@type': 'Event', calendarIds: { a: true, b: true } },
      { '@type': 'Task', calendarIds: { b: true } },
      { '@type': 'Task', calendarIds: { c: true } },
    ];
    const result = findTasksOnlyCalendarIds(objects, ['a', 'b', 'c']);
    // a has only event -> not tasks-only
    // b has event + task -> not tasks-only
    // c has only task -> tasks-only
    expect([...result]).toEqual(['c']);
  });
});
