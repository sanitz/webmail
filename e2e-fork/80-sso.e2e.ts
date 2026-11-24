import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { ACCOUNTS, type TestAccount } from '../integration/tests/helpers/config';
import { accountSwitcher, activeAccountEmail, neutralizeDevOverlay } from '../integration/tests/helpers/app';

/**
 * Sign-in through Stalwart's own login page (tiger-iac#1922): the webmail's
 * "Sign in with SSO" next to the password form, with a password or a passkey
 * on Stalwart's side. run.sh configures the app's OAuth and stalwart.sh the
 * matching client, as production declares them.
 */
const STALWART = process.env.IT_JMAP_URL ?? 'http://localhost:8025';

/** Webmail login page → "Sign in with SSO" → Stalwart's login page. */
async function openStalwartLogin(page: Page): Promise<void> {
  await neutralizeDevOverlay(page);
  // The button shows once the hydrated page has the provider's metadata; the
  // first fetch, from before hydration, is aborted.
  const metadata = page.waitForResponse((r) => r.url().endsWith('/api/auth/oauth/metadata') && r.ok());
  await page.goto('/');
  await metadata;
  await page.getByRole('button', { name: 'Sign in with SSO' }).click();
  await page.waitForURL((url) => url.origin === STALWART);
}

/** Stalwart's consent page → "Allow" → back in the webmail. */
async function allowAndReturn(page: Page): Promise<void> {
  // Consent comes after Stalwart accepted the sign-in; a click before it
  // shows lands on nothing.
  await page.getByRole('heading', { name: 'Authorize access' }).waitFor();
  await page.locator('#allow-btn').click();
  await accountSwitcher(page).waitFor({ state: 'visible', timeout: 30_000 });
}

/**
 * Registers a passkey for `account` with a virtual authenticator, the way
 * Stalwart's account page does: registration options (needs the current
 * password), the browser's WebAuthn ceremony on Stalwart's origin, then the
 * authenticator's answer back to Stalwart.
 */
async function registerPasskey(page: Page, account: TestAccount): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true },
  });
  await page.goto(`${STALWART}/login`);
  const created = await page.evaluate(async ({ user, password }) => {
    const auth = `Basic ${btoa(`${user}:${password}`)}`;
    const jmap = async (method: string, args: Record<string, unknown>) => {
      const res = await fetch('/jmap', {
        method: 'POST',
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ using: ['urn:ietf:params:jmap:core', 'urn:stalwart:jmap'], methodCalls: [[method, args, '0']] }),
      });
      return (await res.json()).methodResponses[0];
    };
    const b64 = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const unb64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

    const [, options] = await jmap('x:Passkey/registrationOptions', { currentSecret: password });
    const pk = options.publicKey;
    const credential = (await navigator.credentials.create({
      publicKey: {
        ...pk,
        challenge: unb64(pk.challenge),
        user: { ...pk.user, id: unb64(pk.user.id) },
        excludeCredentials: [],
      },
    })) as PublicKeyCredential;
    const response = credential.response as AuthenticatorAttestationResponse;
    const [name, result] = await jmap('x:Passkey/set', {
      create: {
        e2e: {
          description: 'E2E virtual authenticator',
          registration: { clientDataJson: b64(response.clientDataJSON), attestationObject: b64(response.attestationObject) },
        },
      },
    });
    return { name, created: Object.keys(result.created ?? {}), notCreated: result.notCreated ?? null };
  }, { user: account.email, password: account.password });
  expect(created, JSON.stringify(created)).toMatchObject({ name: 'x:Passkey/set', created: ['e2e'] });
}

test('SSO with the short login name signs in as the full address', async ({ page }) => {
  // Bulwark keys synced settings and subscription owners by account name
  // (tiger-iac#1643); over SSO it has to be the full address, whatever was typed.
  await openStalwartLogin(page);
  await page.locator('#username').fill(ACCOUNTS.alice.user);
  await page.locator('#password').fill(ACCOUNTS.alice.password);
  await page.locator('#submit-btn').click();
  await allowAndReturn(page);
  expect(await activeAccountEmail(page)).toBe(ACCOUNTS.alice.email);
});

test('SSO with a passkey signs in without a password', async ({ page }) => {
  await registerPasskey(page, ACCOUNTS.carol);
  // Stalwart's login page asks for a passkey on load (autofill, conditional
  // mediation); the authenticator answers it, so no button is clicked: a
  // second ceremony from "Sign in with a passkey" would cancel the first.
  await openStalwartLogin(page);
  await allowAndReturn(page);
  expect(await activeAccountEmail(page)).toBe(ACCOUNTS.carol.email);
});
