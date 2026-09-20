/**
 * Creating calendar collections over CalDAV (through the /api/webdav proxy).
 *
 * Stalwart's JMAP Calendar/set has no way to express the CalDAV
 * supported-calendar-component-set, and the server only accepts that property
 * while a collection is being created - a later PROPPATCH is rejected with
 * "Property cannot be modified". A calendar without it advertises every
 * component type, so sync clients such as DAVx5 offer it to todo apps as well
 * as calendar apps (#760). Creating the collection with MKCALENDAR pins the
 * set; the calendar's other properties are then applied over JMAP as usual.
 */

import { apiFetch } from '@/lib/browser-navigation';
import { getActiveAccountSlotHeaders } from '@/lib/auth/active-account-slot';
import { generateUUID } from '@/lib/utils';
import type { CalendarComponentType } from '@/lib/jmap/types';

/** What a plain "calendar" holds unless the user asks for tasks. */
export const DEFAULT_CALENDAR_COMPONENTS: readonly CalendarComponentType[] = ['VEVENT'];

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Random path segment for a new collection. Stalwart's own JMAP create uses a
 * random alphanumeric name too; the display name lives in a separate property,
 * so the segment never needs to be human readable.
 */
export function newCalendarCollectionName(): string {
  return generateUUID().replace(/-/g, '').slice(0, 16);
}

export function buildMkCalendarBody(displayName: string, components: readonly CalendarComponentType[]): string {
  const comps = components.map((c) => '<C:comp name="' + c + '"/>').join('');
  return '<?xml version="1.0" encoding="utf-8"?>' +
    '<C:mkcalendar xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">' +
    '<D:set><D:prop>' +
    '<D:displayname>' + escapeXml(displayName) + '</D:displayname>' +
    '<C:supported-calendar-component-set>' + comps + '</C:supported-calendar-component-set>' +
    '</D:prop></D:set>' +
    '</C:mkcalendar>';
}

/**
 * MKCALENDAR a collection in the signed-in user's own account. Resolves true
 * when Stalwart reports 201 Created and false for any other status (older
 * server, proxy unavailable, name clash...). Rejects on network failure.
 */
export async function mkCalendarCollection(opts: {
  collectionName: string;
  displayName: string;
  components: readonly CalendarComponentType[];
}): Promise<boolean> {
  const response = await apiFetch('/api/webdav', {
    method: 'POST',
    headers: {
      'X-WebDAV-Method': 'MKCALENDAR',
      'X-WebDAV-Collection': 'cal',
      'X-WebDAV-Path': opts.collectionName,
      'Content-Type': 'application/xml; charset=utf-8',
      ...getActiveAccountSlotHeaders(),
    },
    body: buildMkCalendarBody(opts.displayName, opts.components),
  });
  return response.status === 201;
}

/**
 * Parses CalDAV multistatus PROPFIND XML response and extracts the
 * supported-calendar-component-set for each collection.
 */
export function parseCalendarCollectionComponents(xml: string): Record<string, CalendarComponentType[]> {
  const result: Record<string, CalendarComponentType[]> = {};
  if (!xml || typeof xml !== 'string') return result;

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, 'application/xml');
    const responses = doc.getElementsByTagNameNS('DAV:', 'response');

    for (let i = 0; i < responses.length; i++) {
      const resp = responses[i];
      const hrefEl = resp.getElementsByTagNameNS('DAV:', 'href')[0];
      if (!hrefEl?.textContent) continue;

      const href = decodeURIComponent(hrefEl.textContent).replace(/\/+$/, '');
      const segments = href.split('/').filter(Boolean);
      // Format is typically /dav/cal/{user}/{collectionId}
      // If segments length <= 3 (e.g. ['dav', 'cal', 'user']), it's the root directory
      if (segments.length < 4) continue;

      const collectionId = segments[segments.length - 1];
      if (!collectionId) continue;

      const compNodes = resp.getElementsByTagNameNS('urn:ietf:params:xml:ns:caldav', 'comp');
      if (compNodes && compNodes.length > 0) {
        const comps: CalendarComponentType[] = [];
        for (let j = 0; j < compNodes.length; j++) {
          const name = compNodes[j].getAttribute('name')?.toUpperCase();
          if (name === 'VEVENT' || name === 'VTODO' || name === 'VJOURNAL') {
            comps.push(name as CalendarComponentType);
          }
        }
        if (comps.length > 0) {
          result[collectionId] = comps;
        }
      }
    }
  } catch (error) {
    console.error('Failed to parse CalDAV calendar components XML:', error);
  }

  return result;
}

/**
 * Fetches the supported-calendar-component-set for all calendar collections
 * from Stalwart's CalDAV endpoint via the /api/webdav proxy.
 *
 * `accountHeaders` pins the request to a specific account's cookie slot
 * (via {@link getAccountSlotHeadersFor}) - required when scanning an account
 * other than the currently active one, since the proxy otherwise resolves
 * credentials from whichever account is focused in the UI (#1208).
 * Defaults to the active account for single-account callers.
 */
export async function fetchCalendarCollectionComponents(
  accountHeaders: Record<string, string> = getActiveAccountSlotHeaders(),
): Promise<Record<string, CalendarComponentType[]>> {
  try {
    const response = await apiFetch('/api/webdav', {
      method: 'POST',
      headers: {
        'X-WebDAV-Method': 'PROPFIND',
        'X-WebDAV-Collection': 'cal',
        'X-WebDAV-Path': '/',
        'Depth': '1',
        'Content-Type': 'application/xml; charset=utf-8',
        ...accountHeaders,
      },
      body: `<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop>
    <D:displayname/>
    <D:resourcetype/>
    <C:supported-calendar-component-set/>
  </D:prop>
</D:propfind>`,
    });

    if (response.status !== 207) {
      return {};
    }

    const text = await response.text();
    return parseCalendarCollectionComponents(text);
  } catch {
    return {};
  }
}

