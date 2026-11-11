import { test as setup } from './fixtures';

/**
 * Not a test: after a code change `next dev` compiles for a while on the first
 * page loads and keeps the login page loading. The specs start once the login
 * form shows (tiger-iac#1754).
 */
setup('the app is compiled and shows the login form', async ({ page }) => {
  setup.setTimeout(300_000);
  for (let attempt = 1; ; attempt++) {
    try {
      // A reload of the still compiling app may cut the navigation itself short.
      await page.goto('/login');
      await page.locator('#username').waitFor({ state: 'visible', timeout: 20_000 });
      return;
    } catch (error) {
      if (attempt >= 12) throw error;
    }
  }
});
