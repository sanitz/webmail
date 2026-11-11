import { test as base } from '@playwright/test';

/**
 * The specs' `test`: the app runs in `next dev`, whose hot-reload socket sent
 * every freshly loaded page "rebuilding" and reloaded it, again and again,
 * before the login form ever showed (tiger-iac#1754). A spec changes no code,
 * so the socket is answered by a silent stand-in: open, but never a message.
 */
export const test = base.extend({
  context: async ({ context }, provide) => {
    await context.routeWebSocket(/\/_next\/webpack-hmr/, () => {});
    await provide(context);
  },
});

export { expect } from '@playwright/test';
