/**
 * Temporary block: Stalwart up to v0.16.24 (calcard 0.3.14) loses an all-day
 * series as soon as it stores an override with content for one occurrence;
 * on the next read the override replaces the series. Exclusions (deleting one
 * occurrence) are stored as EXDATE and are safe, as are timed series. Fixed
 * upstream in Stalwart v1.0 (support.stalw.art/t/1714, tiger-iac#1311):
 * delete this module and its call sites then.
 */

type AllDayFlag = { showWithoutTime?: boolean | null };

/** Whether writing `entry` as an override of one occurrence of `series` would lose the series. */
export function isAllDayOverrideBlocked(series: AllDayFlag, entry: Record<string, unknown>): boolean {
  return series.showWithoutTime === true && entry.excluded !== true;
}

export class AllDaySeriesOverrideBlockedError extends Error {
  constructor() {
    super('Single-occurrence changes of all-day series are blocked (tiger-iac#1311)');
    this.name = 'AllDaySeriesOverrideBlockedError';
  }
}

/**
 * Whether the scope dialog must not offer "this occurrence only". Deleting one
 * occurrence is an exclusion and stays allowed.
 */
export function isSingleOccurrenceChangeBlocked(
  action: { type: string; event?: AllDayFlag; task?: AllDayFlag },
): boolean {
  if (action.type === "delete" || action.type === "delete_task") return false;
  return (action.event ?? action.task)?.showWithoutTime === true;
}
