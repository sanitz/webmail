import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { addWeeks, format, nextTuesday } from 'date-fns';
import { ACCOUNTS } from '../integration/tests/helpers/config';
import { login, openCalendar } from '../integration/tests/helpers/app';
import { createTaskListOverCalDav, patchTaskOverJmap, putTaskOverCalDav, tasksOnServer } from './helpers';
import { gridTask, openTasksView, showWeekOf, switchView } from './ui';

// One completion model (tiger-iac#1812): ticking off a series completes one
// occurrence, the first still open, wherever it is ticked. The series keeps
// its dates, so the done date stays done in the calendar.
const { alice } = ACCOUNTS;

const listTick = (page: Page, title: string) =>
  page.getByRole('main').locator('[data-task-id]').filter({ hasText: title }).getByRole('button', { name: 'Mark as complete' });

/** What the server keeps of a series: progress, due day and its overrides. */
async function stored(title: string) {
  const series = (await tasksOnServer(alice, ['title', 'progress', 'due', 'recurrenceOverrides'])).find((t) => t.title === title);
  if (!series) return `no series ${title}`;
  const overrides = (series.recurrenceOverrides ?? {}) as Record<string, Record<string, unknown>>;
  return {
    progress: series.progress,
    due: String(series.due).slice(0, 10),
    overrides: Object.entries(overrides).map(([key, entry]) => [key.slice(0, 10), entry.progress]),
  };
}

test('a tick in the list and a tick in the grid store the same occurrence as done (#1812)', async ({ page }) => {
  const stamp = Date.now();
  const slug = `tick-${stamp}`;
  const inList = `E2E list tick ${stamp}`;
  const inGrid = `E2E grid tick ${stamp}`;
  const d0 = nextTuesday(new Date());
  const due = format(d0, 'yyyy-MM-dd');
  await createTaskListOverCalDav(alice, slug, `E2E Tick ${stamp}`);
  await putTaskOverCalDav(alice, slug, `list-${stamp}`, inList, due, 'FREQ=WEEKLY');
  await putTaskOverCalDav(alice, slug, `grid-${stamp}`, inGrid, due, 'FREQ=WEEKLY');

  await login(page, alice);
  await openCalendar(page);
  await openTasksView(page);
  await listTick(page, inList).click();
  // No question: the list shows the occurrence it completes.
  await expect(page.getByRole('dialog', { name: /recurring/i })).toBeHidden();

  await switchView(page, 'Week');
  await showWeekOf(page, d0);
  await (await gridTask(page, inGrid)).getByRole('button', { name: 'Mark as complete' }).click();

  const expected = { progress: 'needs-action', due, overrides: [[due, 'completed']] };
  await expect.poll(() => stored(inList)).toEqual(expected);
  await expect.poll(() => stored(inGrid)).toEqual(expected);

  // The list moves on to the next occurrence, still open.
  await openTasksView(page);
  await expect(listTick(page, inList)).toBeVisible();
});

test('ticking an occurrence without reloading preserves an override written concurrently via JMAP (#1813)', async ({ page }) => {
  const stamp = Date.now();
  const slug = `conc-${stamp}`;
  const title = `E2E Concurrent ${stamp}`;
  const d0 = nextTuesday(new Date());
  const d1 = addWeeks(d0, 1);
  const due0 = format(d0, 'yyyy-MM-dd');
  const due1 = format(d1, 'yyyy-MM-dd');
  await createTaskListOverCalDav(alice, slug, `E2E Conc ${stamp}`);
  await putTaskOverCalDav(alice, slug, `conc-${stamp}`, title, due0, 'FREQ=WEEKLY');

  await login(page, alice);
  await openCalendar(page);
  await openTasksView(page);
  await expect(listTick(page, title)).toBeVisible();

  // Another client marks the second occurrence done on the server while Bulwark still holds empty overrides.
  const [serverTask] = (await tasksOnServer(alice, ['id', 'title'])).filter((t) => t.title === title);
  await patchTaskOverJmap(alice, String(serverTask.id), {
    recurrenceOverrides: { [`${due1}T00:00:00`]: { progress: 'completed' } },
  });

  // Without reloading, Bulwark ticks off the first occurrence; read-before-write keeps both overrides.
  await listTick(page, title).click();
  await expect.poll(async () => {
    const res = await stored(title);
    if (typeof res === 'string') return res;
    return { ...res, overrides: [...res.overrides].sort() };
  }).toEqual({
    progress: 'needs-action',
    due: due0,
    overrides: [
      [due0, 'completed'],
      [due1, 'completed'],
    ].sort(),
  });
});
