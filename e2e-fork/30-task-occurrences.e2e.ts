import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { addDays, format, nextTuesday } from 'date-fns';
import { ACCOUNTS } from '../integration/tests/helpers/config';
import { login, openCalendar } from '../integration/tests/helpers/app';
import { createTaskListOverCalDav, tasksOnServer } from './helpers';
import { chooseScope, createWeeklyTask, gridCount, gridTask, gridTitle, showWeekOf, switchView } from './ui';

// One weekly series through the fork's scope handling (tiger-iac#1307,
// #1323): one occurrence ticked off, one renamed alone, the rest split off
// as a series of its own without duplicates, and that series deleted whole.
const { alice } = ACCOUNTS;
const ymd = (d: Date) => format(d, 'yyyy-MM-dd');

type ServerTask = { title?: string; progress?: string; recurrenceRule?: unknown; recurrenceOverrides?: Record<string, Record<string, unknown> | null> };
const serverTasks = async () => (await tasksOnServer(alice, ['title', 'progress', 'recurrenceRule', 'recurrenceOverrides'])) as ServerTask[];
const override = (task: ServerTask | undefined, day: Date) =>
  Object.entries(task?.recurrenceOverrides ?? {}).find(([key]) => key.startsWith(ymd(day)))?.[1];

async function editOccurrence(page: Page, title: string, day: Date, newTitle: string): Promise<void> {
  await showWeekOf(page, day);
  await (await gridTitle(page, title)).click();
  const edit = page.getByRole('dialog', { name: 'Edit task' });
  await edit.getByRole('textbox', { name: 'Task title' }).fill(newTitle);
  await edit.getByRole('button', { name: 'Save' }).click();
}

test('ticks off one occurrence, renames one alone, splits the rest off and deletes that series', async ({ page }) => {
  const stamp = Date.now();
  const list = `E2E Bins ${stamp}`;
  const title = `E2E bins ${stamp}`;
  const [d0, d1, d2, d3] = [0, 1, 2, 3].map((w) => addDays(nextTuesday(new Date()), 7 * w));
  await createTaskListOverCalDav(alice, `bins-${stamp}`, list);
  await login(page, alice);
  await openCalendar(page);
  await createWeeklyTask(page, title, d0, list);
  await switchView(page, 'Week');

  // Ticking off one occurrence completes that one only.
  await showWeekOf(page, d0);
  await (await gridTask(page, title)).getByRole('button', { name: 'Mark as complete' }).click();
  await expect.poll(async () => {
    const master = (await serverTasks()).find((t) => t.title === title);
    return { master: master?.progress, ticked: override(master, d0)?.progress };
  }).toEqual({ master: 'needs-action', ticked: 'completed' });
  await page.reload();
  await showWeekOf(page, d1);
  await expect((await gridTask(page, title)).getByRole('button', { name: 'Mark as complete' })).toBeVisible();

  // "This event only": one occurrence renamed, the next one keeps the title.
  await editOccurrence(page, title, d1, `${title} moved`);
  await chooseScope(page, 'This event only');
  await expect.poll(async () => override((await serverTasks()).find((t) => t.title === title), d1)?.title).toBe(`${title} moved`);
  await page.reload();
  await showWeekOf(page, d1);
  await expect.poll(() => gridCount(page, `${title} moved`)).toBe(1);
  await showWeekOf(page, d2);
  await expect.poll(() => gridCount(page, title)).toBe(1);

  // "This and following events": a series of its own from here, no duplicates.
  await editOccurrence(page, title, d2, `${title} new`);
  await chooseScope(page, 'This and following events');
  await expect.poll(async () => (await serverTasks()).filter((t) => t.title === `${title} new` && t.recurrenceRule).length).toBe(1);
  await page.reload();
  await showWeekOf(page, d3);
  await expect.poll(() => gridCount(page, `${title} new`)).toBe(1);
  await expect.poll(() => gridCount(page, title)).toBe(0);
  await showWeekOf(page, d0);
  await expect.poll(() => gridCount(page, title)).toBe(1);

  // "All events" on delete: the split-off series is gone, the first one stays.
  await showWeekOf(page, d3);
  await (await gridTitle(page, `${title} new`)).click();
  await page.getByRole('dialog', { name: 'Edit task' }).getByRole('button', { name: 'Delete' }).click();
  await chooseScope(page, 'All events', 'Delete');
  await expect.poll(async () => (await serverTasks()).filter((t) => t.title === `${title} new`).length).toBe(0);
  expect((await serverTasks()).filter((t) => t.title === title)).toHaveLength(1);
});
