import { test, expect } from './fixtures';
import type { Locator } from '@playwright/test';
import { format, nextTuesday } from 'date-fns';
import { ACCOUNTS } from '../integration/tests/helpers/config';
import { login, openCalendar } from '../integration/tests/helpers/app';
import { createCollectionOverCalDav, createTaskListOverCalDav, putTaskOverCalDav } from './helpers';
import { openTasksView, showWeekOf, switchView, taskListsSection } from './ui';

// A task list a phone made over CalDAV is a task list in Bulwark even while
// empty, never a target for events, and its tick hides its tasks on the grid
// and in the tasks view alike (#1208, tiger-iac#1752).
const { alice } = ACCOUNTS;

/** The names the event form's calendar picker offers. */
async function eventTargets(dialog: Locator): Promise<string[]> {
  const picker = dialog.getByRole('combobox', { name: /calendar/i });
  await expect(picker).toBeVisible();
  if (await picker.evaluate((el) => el.tagName === 'SELECT')) {
    return picker.locator('option').allTextContents();
  }
  await picker.click();
  const names = await dialog.page().getByRole('option').allTextContents();
  await dialog.page().keyboard.press('Escape');
  return names;
}

test('a task list made over CalDAV is a task list, never an event target, and its tick hides its tasks everywhere', async ({ page }) => {
  const stamp = Date.now();
  const work = `E2E Work ${stamp}`;
  const errands = `E2E Errands ${stamp}`;
  const task = `E2E milk ${stamp}`;
  await createCollectionOverCalDav(alice, `work-${stamp}`, work, ['VEVENT']);
  await createTaskListOverCalDav(alice, `errands-${stamp}`, errands);

  await login(page, alice);
  await openCalendar(page);

  // Empty, and still a task list: below the calendars, not among them.
  await expect(taskListsSection(page).getByRole('checkbox', { name: errands })).toBeVisible();
  await expect(page.locator('[data-testid="calendar-item"]', { hasText: errands })).toHaveCount(0);
  await expect(page.locator('[data-testid="calendar-item"]', { hasText: work })).toHaveCount(1);

  // Never offered for an event; the other event calendar is.
  await page.getByRole('button', { name: 'Create event' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Create event' });
  const targets = (await eventTargets(dialog)).join(' | ');
  expect(targets).toContain(work);
  expect(targets).not.toContain(errands);
  await dialog.getByRole('button', { name: 'Cancel' }).click();

  // A task the phone adds shows on the week grid; the list's tick hides it
  // there and in the tasks view, and brings it back.
  const due = nextTuesday(new Date());
  await putTaskOverCalDav(alice, `errands-${stamp}`, `milk-${stamp}`, task, format(due, 'yyyy-MM-dd'));
  await page.reload();
  await switchView(page, 'Week');
  const main = page.getByRole('main');
  await showWeekOf(page, due);
  await expect(main.getByText(task).first()).toBeVisible();

  await taskListsSection(page).getByRole('checkbox', { name: errands }).click();
  await expect(main.getByText(task)).toHaveCount(0);

  await openTasksView(page);
  await expect(main.getByText(task)).toHaveCount(0);
  await taskListsSection(page).getByRole('checkbox', { name: errands }).click();
  await expect(main.getByText(task).first()).toBeVisible();

  await switchView(page, 'Week');
  await expect(main.getByText(task).first()).toBeVisible();
});
