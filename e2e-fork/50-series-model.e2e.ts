import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { addDays, format, nextTuesday } from 'date-fns';
import { ACCOUNTS } from '../integration/tests/helpers/config';
import { login, openCalendar } from '../integration/tests/helpers/app';
import { createTaskListOverCalDav, icsOfCalendar, putVtodoOverCalDav, tasksOnServer } from './helpers';
import { chooseScope, createWeeklyTask, gridTitle, showWeekOf, switchView } from './ui';

// How the fork's scope handling stores a series, read back from Stalwart
// as JMAP and as the iCalendar a phone gets (tiger-iac#1807–#1811).
const { alice } = ACCOUNTS;
const ymd = (d: Date) => format(d, 'yyyy-MM-dd');
const compact = (d: Date) => format(d, 'yyyyMMdd');

/** The VTODO of that title in the list's stored iCalendar. */
async function vtodo(slug: string, title: string): Promise<string> {
  return (await icsOfCalendar(alice, slug)).find((body) => body.split(/\r?\n/).includes(`SUMMARY:${title}`)) ?? '';
}

/** Opens the occurrence on `day`, edits it in the task form and saves. */
async function editOccurrence(page: Page, title: string, day: Date, edit: (form: ReturnType<Page['getByRole']>) => Promise<void>): Promise<void> {
  await showWeekOf(page, day);
  await (await gridTitle(page, title)).click();
  const form = page.getByRole('dialog', { name: 'Edit task' });
  await edit(form);
  await form.getByRole('button', { name: 'Save' }).click();
}

async function weeklySeriesInForm(page: Page, stamp: number, due: Date): Promise<{ slug: string; title: string }> {
  const slug = `model-${stamp}`;
  const title = `E2E model ${stamp}`;
  await createTaskListOverCalDav(alice, slug, `E2E Model ${stamp}`);
  await login(page, alice);
  await openCalendar(page);
  await createWeeklyTask(page, title, due, `E2E Model ${stamp}`);
  await switchView(page, 'Week');
  return { slug, title };
}

test('splitting an all-day series ends the old one with a DATE UNTIL (#1811)', async ({ page }) => {
  const d0 = nextTuesday(new Date());
  const { slug, title } = await weeklySeriesInForm(page, Date.now(), d0);

  await editOccurrence(page, title, addDays(d0, 14), (form) => form.getByRole('textbox', { name: 'Task title' }).fill(`${title} later`));
  await chooseScope(page, 'This and following events');

  // RFC 5545 §3.3.10: UNTIL has the value type of DTSTART, here DATE.
  await expect.poll(async () => (await vtodo(slug, title)).match(/RRULE:[^\r\n]*/)?.[0]).toMatch(/UNTIL=\d{8}(;|$)/);
});

test('"this occurrence only" stores just the change in the override (#1809)', async ({ page }) => {
  const d0 = nextTuesday(new Date());
  const { title } = await weeklySeriesInForm(page, Date.now(), d0);

  await editOccurrence(page, title, addDays(d0, 7), (form) => form.getByRole('textbox', { name: 'Task title' }).fill(`${title} once`));
  await chooseScope(page, 'This event only');

  await expect.poll(async () => {
    const master = (await tasksOnServer(alice, ['title', 'recurrenceOverrides'])).find((t) => t.title === title);
    const overrides = (master?.recurrenceOverrides ?? {}) as Record<string, Record<string, unknown>>;
    return Object.entries(overrides).map(([key, entry]) => [key.slice(0, 10), Object.keys(entry).sort()]);
  }).toEqual([[ymd(addDays(d0, 7)), ['title']]]);
});

test('moving a whole series moves its start with its due date (#1807)', async ({ page }) => {
  const d0 = nextTuesday(new Date());
  const { title } = await weeklySeriesInForm(page, Date.now(), d0);
  const moved = addDays(d0, 2);

  await editOccurrence(page, title, d0, (form) => form.getByRole('textbox', { name: 'Due date' }).fill(ymd(moved)));
  await chooseScope(page, 'All events');

  // Stalwart and every phone repeat the series from DTSTART (JMAP start).
  await expect.poll(async () => {
    const master = (await tasksOnServer(alice, ['title', 'start', 'due'])).find((t) => t.title === title);
    return [String(master?.start).slice(0, 10), String(master?.due).slice(0, 10)];
  }).toEqual([ymd(moved), ymd(moved)]);
});

test('splitting a series keeps its reminder and categories (#1808)', async ({ page }) => {
  const stamp = Date.now();
  const slug = `split-${stamp}`;
  const title = `E2E split ${stamp}`;
  const d0 = nextTuesday(new Date());
  await createTaskListOverCalDav(alice, slug, `E2E Split ${stamp}`);
  await putVtodoOverCalDav(alice, slug, `split-${stamp}`, [
    `SUMMARY:${title}`, `DTSTART;VALUE=DATE:${compact(d0)}`, `DUE;VALUE=DATE:${compact(d0)}`,
    'RRULE:FREQ=WEEKLY', 'CATEGORIES:Haushalt',
  ], ['ACTION:DISPLAY', 'DESCRIPTION:Reminder', 'TRIGGER;RELATED=END:-PT15M']);

  // Control: Stalwart reads the phone's VALARM and CATEGORIES as alerts and keywords.
  await expect.poll(async () => {
    const series = (await tasksOnServer(alice, ['title', 'alerts', 'keywords'])).find((t) => t.title === title);
    return { alerts: Object.keys((series?.alerts ?? {}) as object).length, keywords: Object.keys((series?.keywords ?? {}) as object) };
  }).toEqual({ alerts: 1, keywords: ['Haushalt'] });

  await login(page, alice);
  await openCalendar(page);
  await switchView(page, 'Week');
  await editOccurrence(page, title, addDays(d0, 14), (form) => form.getByRole('textbox', { name: 'Task title' }).fill(`${title} new`));
  await chooseScope(page, 'This and following events');

  // VALARM is JMAP alerts, CATEGORIES is keywords.
  await expect.poll(async () => {
    const series = (await tasksOnServer(alice, ['title', 'alerts', 'keywords'])).find((t) => t.title === `${title} new`);
    if (!series) return 'no new series';
    return { alerts: Object.keys((series.alerts ?? {}) as object).length, keywords: Object.keys((series.keywords ?? {}) as object) };
  }).toEqual({ alerts: 1, keywords: ['Haushalt'] });
});
