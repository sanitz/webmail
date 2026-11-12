/**
 * Server-side helpers for the fork's E2E specs (tiger-iac#1754): what a
 * phone does over CalDAV, and reading back what Stalwart actually stored,
 * over JMAP and as iCalendar. A spec checks the server, not only the page:
 * Stalwart echoes values over JMAP it never stores (#1323) and drops others
 * silently (#1752).
 */
import type { TestAccount } from '../integration/tests/helpers/config';
import { JMAP_URL } from '../integration/tests/helpers/config';

const CALENDARS = 'urn:ietf:params:jmap:calendars';

function auth(account: TestAccount): string {
  return 'Basic ' + Buffer.from(`${account.email}:${account.password}`).toString('base64');
}

function calendarHome(account: TestAccount): string {
  return `${JMAP_URL}/dav/cal/${encodeURIComponent(account.email)}/`;
}

/** A task-only list as a phone makes it: MKCALENDAR with VTODO only, left empty. */
export async function createTaskListOverCalDav(account: TestAccount, slug: string, name: string): Promise<void> {
  await createCollectionOverCalDav(account, slug, name, ['VTODO']);
}

/** A calendar collection with the given components, over CalDAV. */
export async function createCollectionOverCalDav(account: TestAccount, slug: string, name: string, components: string[]): Promise<void> {
  const res = await fetch(`${calendarHome(account)}${slug}/`, {
    method: 'MKCALENDAR',
    headers: { Authorization: auth(account), 'Content-Type': 'application/xml; charset=utf-8' },
    body: `<?xml version="1.0" encoding="utf-8"?>
<C:mkcalendar xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:set><D:prop>
<D:displayname>${name}</D:displayname>
<C:supported-calendar-component-set>${components.map((c) => `<C:comp name="${c}"/>`).join('')}</C:supported-calendar-component-set>
</D:prop></D:set></C:mkcalendar>`,
  });
  if (res.status !== 201) throw new Error(`MKCALENDAR ${slug}: ${res.status} ${await res.text()}`);
}

/** The iCalendar bodies of every object in a calendar collection. */
export async function icsOfCalendar(account: TestAccount, slug: string): Promise<string[]> {
  const base = `${calendarHome(account)}${slug}/`;
  const res = await fetch(base, { method: 'PROPFIND', headers: { Authorization: auth(account), Depth: '1' } });
  // Objects made over JMAP have no .ics suffix: every href below the collection.
  const collection = new URL(base).pathname;
  const hrefs = [...(await res.text()).matchAll(/<D:href>([^<]+)<\/D:href>/g)]
    .map((m) => m[1])
    .filter((href) => href !== collection && !href.endsWith('/'));
  return Promise.all(hrefs.map(async (href) => {
    const r = await fetch(new URL(href, JMAP_URL), { headers: { Authorization: auth(account) } });
    return r.text();
  }));
}

async function calendarsAccountId(account: TestAccount): Promise<string> {
  const session = await (await fetch(`${JMAP_URL}/jmap/session`, { headers: { Authorization: auth(account) } })).json();
  return session.primaryAccounts[CALENDARS];
}

/** One JMAP calendars method call as `account`; its result. */
async function calendarsCall(account: TestAccount, method: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch(`${JMAP_URL}/jmap/`, {
    method: 'POST',
    headers: { Authorization: auth(account), 'Content-Type': 'application/json' },
    body: JSON.stringify({ using: ['urn:ietf:params:jmap:core', CALENDARS], methodCalls: [[method, args, '0']] }),
  });
  const [name, result] = (await res.json()).methodResponses?.[0] ?? [];
  if (name !== method) throw new Error(`${method}: ${JSON.stringify(result)}`);
  return result;
}

/** CalendarEvent/get of the account's tasks, with the given properties. */
export async function tasksOnServer(account: TestAccount, properties: string[]): Promise<Record<string, unknown>[]> {
  const accountId = await calendarsAccountId(account);
  const result = await calendarsCall(account, 'CalendarEvent/get', { accountId, ids: null, properties: ['@type', ...properties] });
  return ((result.list ?? []) as Record<string, unknown>[]).filter((item) => item['@type'] === 'Task');
}

/** The owner shares the calendar of that name with the grantee, to read and write. */
export async function shareCalendar(owner: TestAccount, name: string, grantee: TestAccount): Promise<void> {
  const accountId = await calendarsAccountId(owner);
  const { list } = await calendarsCall(owner, 'Calendar/get', { accountId, properties: ['name'] });
  const calendar = (list as { id: string; name: string }[]).find((c) => c.name === name);
  if (!calendar) throw new Error(`no calendar "${name}"`);
  const rights = { mayReadFreeBusy: true, mayReadItems: true, mayWriteAll: true, mayWriteOwn: true, mayUpdatePrivate: true, mayRSVP: true };
  const result = await calendarsCall(owner, 'Calendar/set', {
    accountId, update: { [calendar.id]: { shareWith: { [await calendarsAccountId(grantee)]: rights } } },
  });
  // Stalwart answers updated: { <id>: null }: the key counts, not its value.
  if (!(calendar.id in ((result.updated ?? {}) as Record<string, unknown>))) throw new Error(`share "${name}": ${JSON.stringify(result)}`);
}

/**
 * An all-day task as a phone stores it: PUT of a VTODO with a DUE date. With
 * `rrule` it repeats; a rule needs DTSTART, so the start is the due date.
 */
export async function putTaskOverCalDav(account: TestAccount, slug: string, uid: string, title: string, due: string, rrule?: string): Promise<void> {
  const day = due.replaceAll('-', '');
  const repeat = rrule ? [`DTSTART;VALUE=DATE:${day}`, `RRULE:${rrule}`] : [];
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//tiger-iac//e2e//EN', 'BEGIN:VTODO', `UID:${uid}`,
    `DTSTAMP:20260101T000000Z`, `SUMMARY:${title}`, ...repeat, `DUE;VALUE=DATE:${day}`, 'STATUS:NEEDS-ACTION',
    'END:VTODO', 'END:VCALENDAR', ''].join('\r\n');
  const res = await fetch(`${calendarHome(account)}${slug}/${uid}.ics`, {
    method: 'PUT',
    headers: { Authorization: auth(account), 'Content-Type': 'text/calendar; charset=utf-8' },
    body: ics,
  });
  if (res.status !== 201) throw new Error(`PUT ${uid}: ${res.status} ${await res.text()}`);
}
