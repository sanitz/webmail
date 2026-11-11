import { defineConfig } from '@playwright/test';

/**
 * The fork's E2E specs (tiger-iac#1754): the app in `next dev` against a
 * throwaway Stalwart on the image production runs (e2e-fork/stalwart.sh).
 * Separate from upstream's integration/ suite, which builds containers and
 * whose runs are red upstream; the specs reuse its helpers and accounts.
 *
 * Specs are *.e2e.ts, so the Vitest suite (*.spec.ts, *.test.ts) leaves them alone.
 *
 * Run:  e2e-fork/run.sh
 */
const PORT = Number(process.env.E2E_WEB_PORT ?? 3100);
const JMAP_PORT = Number(process.env.E2E_JMAP_PORT ?? 8025);
process.env.IT_WEBMAIL_URL = `http://localhost:${PORT}`;
process.env.IT_JMAP_URL = `http://localhost:${JMAP_PORT}`;

export default defineConfig({
  testDir: '.',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  // Outside the repo (see run.sh): writes inside it make next dev reload.
  outputDir: `${process.env.E2E_OUT_DIR ?? '/tmp/bulwark-e2e'}/test-results`,
  globalSetup: './global-setup.ts',
  globalTeardown: './global-teardown.ts',
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: 'en-US',
    timezoneId: 'Europe/Berlin',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'warmup', testMatch: /warmup\.setup\.ts$/, use: { browserName: 'chromium' } },
    { name: 'chromium', testMatch: /\.e2e\.ts$/, dependencies: ['warmup'], use: { browserName: 'chromium' } },
  ],
  webServer: {
    command: `npm run dev -- -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    timeout: 240_000,
    reuseExistingServer: true,
    env: {
      JMAP_SERVER_URL: `http://localhost:${JMAP_PORT}`,
      SESSION_SECRET: 'e2e-not-a-real-secret-at-least-32-chars',
      STALWART_FEATURES: 'true',
    },
  },
});
