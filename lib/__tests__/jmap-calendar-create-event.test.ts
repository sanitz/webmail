import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JMAPClient } from '../jmap/client';
import { createRecurrenceRule } from '../recurrence-rule';
import type { CalendarEvent } from '../jmap/types';

function makeSession() {
  return {
    capabilities: { 'urn:ietf:params:jmap:core': {}, 'urn:ietf:params:jmap:calendars': {} },
    accounts: {
      'acct-1': { name: 'test', isPersonal: true, accountCapabilities: { 'urn:ietf:params:jmap:calendars': {} } },
    },
    primaryAccounts: { 'urn:ietf:params:jmap:mail': 'acct-1', 'urn:ietf:params:jmap:calendars': 'acct-1' },
    apiUrl: 'https://mail.example.com/jmap/api',
    downloadUrl: 'https://mail.example.com/jmap/download/{accountId}/{blobId}/{name}',
    uploadUrl: 'https://mail.example.com/jmap/upload/{accountId}/',
    eventSourceUrl: '',
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

describe('JMAPClient.createCalendarEvent', () => {
  let client: JMAPClient;
  let calls: Array<{ method: string; args: Record<string, unknown> }>;

  beforeEach(async () => {
    calls = [];
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy.mockResolvedValueOnce(jsonResponse(makeSession()));
    client = new JMAPClient('https://mail.example.com', 'user@test.com', 'pass123');
    await client.connect();
    fetchSpy.mockReset();

    fetchSpy.mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? '{}'));
      const methodResponses: unknown[] = [];
      for (const [method, args, callId] of body.methodCalls ?? []) {
        calls.push({ method, args });
        if (method === 'CalendarEvent/set') {
          methodResponses.push([
            'CalendarEvent/set',
            { created: { 'new-event': { id: 'created-ev-1' } } },
            callId,
          ]);
        } else if (method === 'CalendarEvent/get') {
          methodResponses.push([
            'CalendarEvent/get',
            {
              list: [
                {
                  id: 'created-ev-1',
                  uid: 'uid-1',
                  title: 'Weekly Sync',
                  start: '2026-09-30T10:00:00',
                  recurrenceRule: { frequency: 'weekly', interval: 1, firstDayOfWeek: 'mo' },
                  calendarIds: { 'cal-1': true },
                },
              ],
            },
            callId,
          ]);
        } else if (method === 'CalendarEvent/query') {
          methodResponses.push([
            'CalendarEvent/query',
            { ids: ['created-ev-1'] },
            callId,
          ]);
        }
      }
      return jsonResponse({ methodResponses });
    });
  });

  it('converts recurrenceRules to singular recurrenceRule and creates successfully', async () => {
    const eventPayload: Partial<CalendarEvent> = {
      title: 'Weekly Sync',
      start: '2026-09-30T10:00:00',
      duration: 'PT1H',
      timeZone: 'Europe/Berlin',
      showWithoutTime: false,
      calendarIds: { 'cal-1': true },
      recurrenceRules: [createRecurrenceRule('weekly')],
    };

    const created = await client.createCalendarEvent(eventPayload);
    expect(created).toBeDefined();
    expect(created.id).toBe('created-ev-1');
    expect(created.recurrenceRules).toBeDefined();
    expect(created.recurrenceRules).toHaveLength(1);
    expect(created.recurrenceRules![0].frequency).toBe('weekly');

    // Verify outgoing payload had singular recurrenceRule
    const setCall = calls.find(c => c.method === 'CalendarEvent/set');
    expect(setCall).toBeDefined();
    const createPayload = (setCall!.args.create as Record<string, Record<string, unknown>>)['new-event'];
    expect(createPayload.recurrenceRules).toBeUndefined();
    expect(createPayload.recurrenceRule).toMatchObject({
      '@type': 'RecurrenceRule',
      frequency: 'weekly',
    });
  });
});
