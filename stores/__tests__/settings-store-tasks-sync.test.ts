import { describe, expect, it } from 'vitest';
import { useSettingsStore } from '../settings-store';

describe('taskCalendarIds settings sync round-trip (#1208)', () => {
  it('exports and imports taskCalendarIds through settings sync so empty task calendars persist across incognito sessions', () => {
    useSettingsStore.setState({ taskCalendarIds: { 'cal-nuraufgaben': true } });

    const exportedJson = useSettingsStore.getState().exportSettings();
    const exported = JSON.parse(exportedJson);
    expect(exported.taskCalendarIds).toEqual({ 'cal-nuraufgaben': true });

    // Reset store
    useSettingsStore.setState({ taskCalendarIds: {} });
    expect(useSettingsStore.getState().taskCalendarIds).toEqual({});

    // Import back
    const ok = useSettingsStore.getState().importSettings(exportedJson);
    expect(ok).toBe(true);
    expect(useSettingsStore.getState().taskCalendarIds).toEqual({ 'cal-nuraufgaben': true });
  });
});
