import { describe, expect, it } from 'vitest';
import { useSettingsStore } from '../settings-store';

describe('settings-store enableCalendarTasks default (#1208)', () => {
  it('enables calendar tasks by default so new incognito sessions render tasks and task lists', () => {
    const state = useSettingsStore.getState();
    expect(state.enableCalendarTasks).toBe(true);
  });
});
