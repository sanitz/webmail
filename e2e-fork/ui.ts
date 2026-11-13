/** Driving the calendar UI in the fork's E2E specs (tiger-iac#1754). */
import type { Locator, Page } from '@playwright/test';
import { format } from 'date-fns';
import { expect } from './fixtures';

export const taskListsSection = (page: Page) => page.getByTestId('task-lists-section');

/** The tasks view, from the sidebar button ("Tasks", or "Tasks 3" with open tasks). */
export async function openTasksView(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^Tasks( \d+)?$/ }).first().click();
  await expect(page.getByRole('heading', { name: 'Tasks', level: 1 })).toBeVisible();
}

/** A grid view, from the view menu (the tasks view: openTasksView). */
export async function switchView(page: Page, view: 'Week' | 'Month' | 'Day'): Promise<void> {
  const current = page.getByRole('button', { name: `Change view, currently ${view}` });
  if (await current.count() > 0) return;
  const btn = page.getByRole('button', { name: /^Change view/ });
  await expect(btn).toBeVisible();
  const option = page.getByRole('menuitemradio', { name: view }).or(page.getByRole('menuitem', { name: view })).or(page.getByRole('option', { name: view })).first();
  await expect.poll(async () => {
    if (await option.isVisible()) return true;
    await btn.click();
    return await option.isVisible();
  }, { timeout: 15000, intervals: [500, 1000] }).toBe(true);
  await option.click();
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The days a week heading names: "Nov 8 – 14, 2026", "Nov 29 – Dec 5, 2026", "Dec 27, 2026 – Jan 2, 2027". */
export function weekRange(heading: string): [Date, Date] | null {
  const m = heading.match(/([A-Z][a-z]{2}) (\d+)(?:, (\d{4}))? – (?:([A-Z][a-z]{2}) )?(\d+), (\d{4})/);
  if (!m) return null;
  const [, m1, d1, y1, m2, d2, y2] = m;
  return [
    new Date(Number(y1 ?? y2), MONTHS.indexOf(m1), Number(d1)),
    new Date(Number(y2), MONTHS.indexOf(m2 ?? m1), Number(d2)),
  ];
}

/**
 * Shows the week of `day`: picks the day in the sidebar's month calendar
 * (the week view's own Next skips weeks from a Sunday; picking a day may
 * open the day view) and waits until the heading covers it.
 */
export async function showWeekOf(page: Page, day: Date): Promise<void> {
  const label = day.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  for (let step = 0; step < 14 && !(await page.getByRole('button', { name: label, exact: true }).first().isVisible()); step++) {
    await page.getByRole('button', { name: 'Next month' }).first().click();
  }
  await page.getByRole('button', { name: label, exact: true }).first().click();
  // Picking a day may open the day view.
  if (await page.getByRole('button', { name: 'Change view, currently Week' }).count() === 0) await switchView(page, 'Week');
  const target = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  await expect.poll(async () => {
    const range = weekRange((await page.getByRole('main').getByRole('heading', { level: 1 }).textContent()) ?? '');
    return !!range && range[0] <= target && target <= range[1];
  }, { message: `the week view shows ${label}` }).toBe(true);
}

/**
 * Picks the task list in the task form, when it offers a choice (labelled
 * "List"; it was looked up as "task list" and silently skipped, so every
 * task went to the first list).
 */
export async function chooseTaskList(form: Locator, name: string): Promise<void> {
  const picker = form.getByRole('combobox', { name: /^(task )?list$/i });
  if (await picker.count() === 0) return;
  if (await picker.evaluate((el) => el.tagName === 'SELECT')) {
    await picker.selectOption({ label: name });
  } else {
    await picker.click();
    await form.page().getByRole('option', { name }).click();
  }
}

/** A weekly task made in the task form of the tasks view. */
export async function createWeeklyTask(page: Page, title: string, due: Date, list: string): Promise<void> {
  await openTasksView(page);
  await page.getByRole('main').getByRole('button', { name: 'New task' }).click();
  const form = page.getByRole('dialog', { name: 'New task' });
  await form.getByRole('textbox', { name: 'Task title' }).fill(title);
  await form.getByRole('textbox', { name: 'Due date' }).fill(format(due, 'yyyy-MM-dd'));
  await form.getByRole('combobox', { name: 'Recurrence' }).selectOption({ label: 'Weekly' });
  await chooseTaskList(form, list);
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form).toBeHidden();
}

/** Grid entries with this exact title, rendered or not. */
function gridEntries(page: Page, title: string): Locator {
  return page.getByRole('main').getByTitle(title, { exact: true });
}

/** Index of each grid entry that lies on screen: the grid also renders hidden copies and the neighbouring weeks off to the side. */
async function onScreen(entries: Locator): Promise<number[]> {
  return entries.evaluateAll((els) => els.flatMap((el, i) => {
    const r = el.getBoundingClientRect();
    const shown = r.width > 0 && r.height > 0 && r.left >= 0 && r.right <= window.innerWidth && r.top >= 0 && r.bottom <= window.innerHeight;
    return shown && getComputedStyle(el).visibility !== 'hidden' ? [i] : [];
  }));
}

/** How many entries with this exact title the shown part of the grid has. */
export async function gridCount(page: Page, title: string): Promise<number> {
  return (await onScreen(gridEntries(page, title))).length;
}

/** The shown grid entry with this exact title (its title button). */
export async function gridTitle(page: Page, title: string): Promise<Locator> {
  await expect.poll(() => gridCount(page, title), { message: `"${title}" on screen` }).toBeGreaterThan(0);
  const [index] = await onScreen(gridEntries(page, title));
  return gridEntries(page, title).nth(index);
}

/** The shown grid entry with this exact title, with its own buttons. */
export async function gridTask(page: Page, title: string): Promise<Locator> {
  return (await gridTitle(page, title)).locator('xpath=..');
}

/** Answers the recurrence scope dialog. */
export async function chooseScope(page: Page, scope: 'This event only' | 'This and following events' | 'All events', confirm = 'Save'): Promise<void> {
  const dialog = page.getByRole('dialog', { name: /recurring/i });
  await dialog.getByRole('radio', { name: scope }).check();
  await dialog.getByRole('button', { name: confirm }).click();
  await expect(dialog).toBeHidden();
}
