import { test, expect } from './fixtures';
import { ACCOUNTS } from '../integration/tests/helpers/config';
import { login, openCalendar } from '../integration/tests/helpers/app';

test('logs in against the throwaway Stalwart and opens the calendar', async ({ page }) => {
  await login(page, ACCOUNTS.alice);
  await openCalendar(page);
  await expect(page).toHaveURL(/calendar/);
});
