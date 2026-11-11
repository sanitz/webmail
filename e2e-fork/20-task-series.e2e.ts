import { test, expect } from './fixtures';
import { addDays, format, nextTuesday } from 'date-fns';
import { ACCOUNTS } from '../integration/tests/helpers/config';
import { login, openCalendar } from '../integration/tests/helpers/app';
import { createTaskListOverCalDav, icsOfCalendar, tasksOnServer } from './helpers';
import { createWeeklyTask, openTasksView, showWeekOf, switchView } from './ui';

// A weekly task made in the task form keeps its rule on Stalwart: on the
// server, in the stored iCalendar and on the week grid after a reload
// (tiger-iac#1752, where Stalwart dropped the rule of a task without start).
const { alice } = ACCOUNTS;

test('a weekly task made in the form keeps its rule on the server and repeats on the grid', async ({ page }) => {
  const slug = `series-${Date.now()}`;
  const list = `E2E Chores ${slug}`;
  const title = `E2E weekly ${slug}`;
  const due = nextTuesday(new Date());
  await createTaskListOverCalDav(alice, slug, list);

  await login(page, alice);
  await openCalendar(page);
  await createWeeklyTask(page, title, due, list);

  // On the server: the rule and a start, which Stalwart needs to keep it.
  await expect.poll(async () => (await tasksOnServer(alice, ['title', 'start', 'due', 'recurrenceRule'])).find((t) => t.title === title)).toMatchObject({
    start: `${format(due, 'yyyy-MM-dd')}T00:00:00`,
    due: `${format(due, 'yyyy-MM-dd')}T00:00:00`,
    recurrenceRule: { frequency: 'weekly' },
  });
  // In the stored iCalendar a CalDAV client reads, in the task list it went to.
  const ics = (await icsOfCalendar(alice, slug)).find((body) => body.includes(title)) ?? '';
  expect(ics).toMatch(/RRULE:FREQ=WEEKLY/);
  expect(ics).toMatch(/DTSTART[^:\r\n]*:\d{8}/);
  expect(ics).toMatch(/DUE[^:\r\n]*:\d{8}/);

  // After a reload: the form still says weekly, and three weeks show it.
  await page.reload();
  await openTasksView(page);
  await page.getByText(title).first().click();
  await expect(page.getByRole('combobox', { name: 'Recurrence' })).toHaveValue('weekly');
  await page.keyboard.press('Escape');

  await switchView(page, 'Week');
  const main = page.getByRole('main');
  for (let week = 0; week < 3; week++) {
    const day = addDays(due, 7 * week);
    await showWeekOf(page, day);
    await expect(main.getByText(title).first(), `occurrence on ${format(day, 'yyyy-MM-dd')}`).toBeVisible();
  }
});
