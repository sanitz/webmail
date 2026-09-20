import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { JMAPClient } from '../jmap/client';
import * as webdav from '../webdav/calendar-collection';

function makeMultiAccountSession() {
  return {
    capabilities: {
      'urn:ietf:params:jmap:core': {},
      'urn:ietf:params:jmap:calendars': {},
    },
    accounts: {
      'acct-primary': { name: 'primary', isPersonal: true, accountCapabilities: { 'urn:ietf:params:jmap:calendars': {} } },
      'acct-shared-1': { name: 'team', isPersonal: false, accountCapabilities: { 'urn:ietf:params:jmap:calendars': {} } },
      'acct-shared-2': { name: 'family', isPersonal: false, accountCapabilities: { 'urn:ietf:params:jmap:calendars': {} } },
    },
    primaryAccounts: {
      'urn:ietf:params:jmap:mail': 'acct-primary',
      'urn:ietf:params:jmap:calendars': 'acct-primary',
    },
    apiUrl: 'https://mail.example.com/jmap/api',
    downloadUrl: 'https://mail.example.com/jmap/download/{accountId}/{blobId}/{name}',
    uploadUrl: 'https://mail.example.com/jmap/upload/{accountId}/',
    eventSourceUrl: '',
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('getAllCalendars CalDAV PROPFIND deduplication (#1208)', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  let fetchDavSpy: ReturnType<typeof vi.spyOn>;
  let client: JMAPClient;

  beforeEach(async () => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy.mockResolvedValueOnce(jsonResponse(makeMultiAccountSession()));

    client = new JMAPClient('https://mail.example.com', 'user@test.com', 'pass123');
    await client.connect();
    fetchSpy.mockReset();

    fetchSpy.mockImplementation(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}'));
      const [method, args] = body.methodCalls?.[0] ?? [];
      if (method === 'Calendar/get') {
        return jsonResponse({
          methodResponses: [
            ['Calendar/get', {
              list: [
                { id: `cal-${args.accountId}`, name: `Calendar ${args.accountId}` }
              ]
            }, '0']
          ]
        });
      }
      return jsonResponse({ methodResponses: [] });
    });

    fetchDavSpy = vi.spyOn(webdav, 'fetchCalendarCollectionComponents').mockResolvedValue({
      'cal-acct-primary': ['VEVENT'],
      'cal-acct-shared-1': ['VTODO'],
      'cal-acct-shared-2': ['VEVENT', 'VTODO'],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('queries CalDAV components only once during getAllCalendars across all accounts', async () => {
    const calendars = await client.getAllCalendars();
    expect(calendars.length).toBe(3);
    // With 3 accounts, it must NOT call fetchCalendarCollectionComponents 3 times!
    expect(fetchDavSpy).toHaveBeenCalledTimes(1);
  });
});
