import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { format, nextTuesday } from 'date-fns';
import { ACCOUNTS } from '../integration/tests/helpers/config';
import { addAccount, login, openCalendar, switchAccount } from '../integration/tests/helpers/app';
import { createTaskListOverCalDav, putTaskOverCalDav, shareCalendar, tasksOnServer } from './helpers';
import { openTasksView } from './ui';

// Tasks that are not the active login's own (tiger-iac#1763, #1805): a task
// in a calendar someone shared, and a task of a second login. Their ids carry
// a prefix ("<account>:<id>", "<login>::<id>"), and a shared task's
// originalId is its id in the sharer's account, not a series.
const { alice, bob } = ACCOUNTS;
const due = format(nextTuesday(new Date()), 'yyyy-MM-dd');

/** The tick of the task with this title in the tasks view. */
function tick(page: Page, title: string) {
  return page.getByRole('main').locator('[data-task-id]').filter({ hasText: title }).getByRole('button', { name: 'Mark as complete' });
}

const scopeDialog = (page: Page) => page.getByRole('dialog', { name: /recurring/i });

async function sharedList(stamp: number): Promise<string> {
  const list = `E2E Shared ${stamp}`;
  await createTaskListOverCalDav(alice, `shared-${stamp}`, list);
  await shareCalendar(alice, list, bob);
  return list;
}

test('ticks off a task in a calendar shared with me, in the sharer\'s account', async ({ page }) => {
  const stamp = Date.now();
  const title = `E2E shared once ${stamp}`;
  await sharedList(stamp);
  await putTaskOverCalDav(alice, `shared-${stamp}`, `once-${stamp}`, title, due);

  await login(page, bob);
  await openCalendar(page);
  await openTasksView(page);
  await tick(page, title).click();

  await expect.poll(async () => (await tasksOnServer(alice, ['title', 'progress'])).find((t) => t.title === title)?.progress)
    .toBe('completed');
});

test('asks which occurrences when ticking off a series shared with me', async ({ page }) => {
  const stamp = Date.now();
  const title = `E2E shared series ${stamp}`;
  await sharedList(stamp);
  await putTaskOverCalDav(alice, `shared-${stamp}`, `series-${stamp}`, title, due, 'FREQ=WEEKLY');

  await login(page, bob);
  await openCalendar(page);
  await openTasksView(page);
  await tick(page, title).click();

  await expect(scopeDialog(page)).toBeVisible();
});

test('asks which occurrences when ticking off a series of a second login', async ({ page }) => {
  const stamp = Date.now();
  const list = `E2E Bob ${stamp}`;
  const title = `E2E second login series ${stamp}`;
  await createTaskListOverCalDav(bob, `bob-${stamp}`, list);
  await putTaskOverCalDav(bob, `bob-${stamp}`, `series-${stamp}`, title, due, 'FREQ=WEEKLY');

  await login(page, alice);
  await addAccount(page, bob);
  await switchAccount(page, alice.email);
  await openCalendar(page);
  await openTasksView(page);
  await tick(page, title).click();

  await expect(scopeDialog(page)).toBeVisible();
});
