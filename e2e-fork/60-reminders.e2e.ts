import { test, expect } from './fixtures';
import { format, nextTuesday } from 'date-fns';
import { ACCOUNTS } from '../integration/tests/helpers/config';
import { login, openCalendar } from '../integration/tests/helpers/app';
import { createTaskListOverCalDav, icsOfCalendar } from './helpers';
import { chooseTaskList, openTasksView } from './ui';

// A reminder set in the task form is "before the task is due". In iCalendar
// that is a trigger related to DUE: TRIGGER;RELATED=END (RFC 5545 §3.8.6.3).
// Related to the start, it fires at a start the task may not have, or that
// stays behind when the due date moves (tiger-iac#1814).
const { alice } = ACCOUNTS;

test('a reminder made in the task form fires relative to the due date (#1814)', async ({ page }) => {
  const stamp = Date.now();
  const slug = `remind-${stamp}`;
  const list = `E2E Remind ${stamp}`;
  const title = `E2E reminder ${stamp}`;
  await createTaskListOverCalDav(alice, slug, list);

  await login(page, alice);
  await openCalendar(page);
  await openTasksView(page);
  await page.getByRole('main').getByRole('button', { name: 'New task' }).click();
  const form = page.getByRole('dialog', { name: 'New task' });
  await form.getByRole('textbox', { name: 'Task title' }).fill(title);
  await form.getByRole('textbox', { name: 'Due date' }).fill(format(nextTuesday(new Date()), 'yyyy-MM-dd'));
  await form.getByRole('checkbox', { name: 'Include time' }).check();
  await form.getByRole('combobox', { name: 'Reminder' }).selectOption({ label: '15 minutes before' });
  await chooseTaskList(form, list);
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form).toBeHidden();

  await expect.poll(async () => {
    const ics = (await icsOfCalendar(alice, slug)).find((body) => body.split(/\r?\n/).includes(`SUMMARY:${title}`)) ?? '';
    return ics.match(/TRIGGER[^\r\n]*/)?.[0] ?? `no trigger in: ${ics.slice(0, 200)}`;
  }).toMatch(/^TRIGGER;RELATED=END:-PT15M$/);
});
