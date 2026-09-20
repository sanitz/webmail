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

  it('does not resurrect a taskCalendarIds flag the user just deleted, when a stale synced blob is imported afterwards (#1208 review)', () => {
    // A stale settings blob (e.g. fetched from another device, or a delayed
    // server poll) still lists a calendar the user already removed locally.
    const staleIncomingJson = JSON.stringify({ taskCalendarIds: { 'cal-deleted': true, 'cal-keep': true } });

    useSettingsStore.setState({
      taskCalendarIds: {},
      deletedTaskCalendarIds: { 'cal-deleted': new Date().toISOString() },
    });

    const ok = useSettingsStore.getState().importSettings(staleIncomingJson);

    expect(ok).toBe(true);
    expect(useSettingsStore.getState().taskCalendarIds['cal-deleted']).toBeUndefined();
    expect(useSettingsStore.getState().taskCalendarIds['cal-keep']).toBe(true);
  });
});
