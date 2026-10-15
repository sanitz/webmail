import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { JMAPClient } from '../jmap/client';
import * as webdav from '../webdav/calendar-collection';

function makeSession() {
  return {
    capabilities: {
      'urn:ietf:params:jmap:core': { maxObjectsInGet: 500 },
      'urn:ietf:params:jmap:calendars': {},
    },
    accounts: {
      'acct-1': { name: 'primary', isPersonal: true, accountCapabilities: { 'urn:ietf:params:jmap:calendars': {} } },
    },
    primaryAccounts: {
      'urn:ietf:params:jmap:mail': 'acct-1',
      'urn:ietf:params:jmap:calendars': 'acct-1',
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

describe('JMAPClient getTasksOnlyCalendarIds chunking & detection (#1208)', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  let client: JMAPClient;

  beforeEach(async () => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy.mockResolvedValueOnce(jsonResponse(makeSession()));

    client = new JMAPClient('https://mail.example.com', 'user@test.com', 'pass123');
    await client.connect();
    fetchSpy.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('chunks CalendarEvent/get requests when total event IDs exceed server limits and correctly classifies task-only calendars', async () => {
    // We have 4 event calendars with 150 events each (600 events total), plus 1 task calendar with 5 tasks.
    const eventIdsCal1 = Array.from({ length: 150 }, (_, i) => `ev-1-${i}`);
    const eventIdsCal2 = Array.from({ length: 150 }, (_, i) => `ev-2-${i}`);
    const eventIdsCal3 = Array.from({ length: 150 }, (_, i) => `ev-3-${i}`);
    const eventIdsCal4 = Array.from({ length: 150 }, (_, i) => `ev-4-${i}`);
    const taskIds = ['task-1', 'task-2', 'task-3', 'task-4', 'task-5'];

    fetchSpy.mockImplementation(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}'));
      const methodCalls = body.methodCalls as [string, Record<string, unknown>, string][];

      // Handle Calendar/get
      const calGet = methodCalls.find((m) => m[0] === 'Calendar/get');
      if (calGet) {
        return jsonResponse({
          methodResponses: [
            ['Calendar/get', {
              list: [
                { id: 'cal-1', name: 'Work' },
                { id: 'cal-2', name: 'Personal' },
                { id: 'cal-3', name: 'Family' },
                { id: 'cal-4', name: 'Sports' },
                { id: 'cal-tasks', name: 'NurAufgaben' },
              ]
            }, calGet[2]],
            ...(methodCalls.length > 1 ? [['CalendarEvent/query', { ids: [] }, methodCalls[1][2]]] : []),
          ]
        });
      }

      // Handle batch of CalendarEvent/query
      if (methodCalls[0][0] === 'CalendarEvent/query') {
        const responses = methodCalls.map(([_method, args, tag]) => {
          const filter = args.filter as Record<string, string> | undefined;
          const calId = filter?.inCalendar;
          let ids: string[] = [];
          if (calId === 'cal-1') ids = eventIdsCal1;
          else if (calId === 'cal-2') ids = eventIdsCal2;
          else if (calId === 'cal-3') ids = eventIdsCal3;
          else if (calId === 'cal-4') ids = eventIdsCal4;
          else if (calId === 'cal-tasks') ids = taskIds;
          return ['CalendarEvent/query', { ids }, tag];
        });
        return jsonResponse({ methodResponses: responses });
      }

      // Handle CalendarEvent/get
      if (methodCalls[0][0] === 'CalendarEvent/get') {
        const ids = methodCalls[0][1].ids as string[];
        // Emulate server limit: if client requests more than 500 objects in a single get, reject with requestTooLarge!
        if (ids.length > 500) {
          return jsonResponse({
            methodResponses: [
              ['error', { type: 'requestTooLarge', description: 'Too many objects requested in CalendarEvent/get' }, methodCalls[0][2]]
            ]
          });
        }

        const list = ids.map((id) => {
          if (id.startsWith('task-')) {
            return { id, '@type': 'Task', calendarIds: { 'cal-tasks': true } };
          }
          return { id, '@type': 'Event', calendarIds: { [id.split('-')[1]]: true } };
        });

        return jsonResponse({
          methodResponses: [
            ['CalendarEvent/get', { list }, methodCalls[0][2]]
          ]
        });
      }

      return jsonResponse({ methodResponses: [] });
    });

    const calendars = await client.getAllCalendars();
    const taskCal = calendars.find((c) => c.id === 'cal-tasks');
    const workCal = calendars.find((c) => c.id === 'cal-1');

    expect(workCal?.isTasksOnly).toBe(false);
    expect(taskCal?.isTasksOnly).toBe(true);
  });

  it('does not misclassify a mixed calendar as tasks-only when one of several CalendarEvent/get chunks fails (#1208 review)', async () => {
    // cal-mixed has 149 tasks + 1 real event = 150 objects, so the CHUNK_SIZE=100 loop
    // splits the fetch into two CalendarEvent/get calls. The real event is placed in the
    // second chunk, which the mock fails with a server error response.
    const taskIds = Array.from({ length: 149 }, (_, i) => `task-mix-${i}`);
    const eventId = 'event-mix-real';
    const allIds = [...taskIds, eventId];

    fetchSpy.mockImplementation(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}'));
      const methodCalls = body.methodCalls as [string, Record<string, unknown>, string][];

      const calGet = methodCalls.find((m) => m[0] === 'Calendar/get');
      if (calGet) {
        return jsonResponse({
          methodResponses: [
            ['Calendar/get', { list: [{ id: 'cal-mixed', name: 'NurAufgaben' }] }, calGet[2]],
          ],
        });
      }

      if (methodCalls[0][0] === 'CalendarEvent/query') {
        const responses = methodCalls.map(([, , tag]) => ['CalendarEvent/query', { ids: allIds }, tag]);
        return jsonResponse({ methodResponses: responses });
      }

      if (methodCalls[0][0] === 'CalendarEvent/get') {
        const ids = methodCalls[0][1].ids as string[];
        if (ids.includes(eventId)) {
          // Simulate a transient failure on the chunk holding the real event.
          return jsonResponse({
            methodResponses: [['error', { type: 'serverFail', description: 'transient' }, methodCalls[0][2]]],
          });
        }
        const list = ids.map((id) => ({ id, '@type': 'Task', calendarIds: { 'cal-mixed': true } }));
        return jsonResponse({ methodResponses: [['CalendarEvent/get', { list }, methodCalls[0][2]]] });
      }

      return jsonResponse({ methodResponses: [] });
    });

    const calendars = await client.getAllCalendars();
    const mixedCal = calendars.find((c) => c.id === 'cal-mixed');

    // The calendar genuinely contains an event, but that object lives in the failed
    // chunk. Classifying it as tasks-only on the surviving partial data would hide a
    // real event calendar from the event view and block event creation in it.
    expect(mixedCal?.isTasksOnly).toBe(false);
  });

  it('marks isTasksOnlyConfirmed only for calendars with real scan evidence, not for an empty unscanned calendar (#1208 review)', async () => {
    fetchSpy.mockImplementation(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}'));
      const methodCalls = body.methodCalls as [string, Record<string, unknown>, string][];

      const calGet = methodCalls.find((m) => m[0] === 'Calendar/get');
      if (calGet) {
        return jsonResponse({
          methodResponses: [
            ['Calendar/get', {
              list: [
                { id: 'cal-empty', name: 'FrischAngelegt' },
                { id: 'cal-has-event', name: 'Termine' },
                { id: 'cal-has-tasks', name: 'NurAufgaben' },
              ],
            }, calGet[2]],
          ],
        });
      }

      if (methodCalls[0][0] === 'CalendarEvent/query') {
        const responses = methodCalls.map(([, args, tag]) => {
          const filter = args.filter as Record<string, string> | undefined;
          const calId = filter?.inCalendar;
          let ids: string[] = [];
          if (calId === 'cal-has-event') ids = ['ev-1'];
          else if (calId === 'cal-has-tasks') ids = ['task-1'];
          return ['CalendarEvent/query', { ids }, tag];
        });
        return jsonResponse({ methodResponses: responses });
      }

      if (methodCalls[0][0] === 'CalendarEvent/get') {
        const ids = methodCalls[0][1].ids as string[];
        const list = ids.map((id) =>
          id.startsWith('task-')
            ? { id, '@type': 'Task', calendarIds: { 'cal-has-tasks': true } }
            : { id, '@type': 'Event', calendarIds: { 'cal-has-event': true } }
        );
        return jsonResponse({ methodResponses: [['CalendarEvent/get', { list }, methodCalls[0][2]]] });
      }

      return jsonResponse({ methodResponses: [] });
    });

    const calendars = await client.getAllCalendars();
    const emptyCal = calendars.find((c) => c.id === 'cal-empty');
    const eventCal = calendars.find((c) => c.id === 'cal-has-event');
    const taskCal = calendars.find((c) => c.id === 'cal-has-tasks');

    // No objects at all were ever scanned for cal-empty, so nothing confirms
    // it either way - a sticky flag from a previous fetch must still be able
    // to override this "not determined" result.
    expect(emptyCal?.isTasksOnlyConfirmed).toBeFalsy();
    // Real evidence was found for the other two, so their result is authoritative.
    expect(eventCal?.isTasksOnly).toBe(false);
    expect(eventCal?.isTasksOnlyConfirmed).toBe(true);
    expect(taskCal?.isTasksOnly).toBe(true);
    expect(taskCal?.isTasksOnlyConfirmed).toBe(true);
  });

  it('keeps CalDAV-detected task calendars when the object scan of the others fails', async () => {
    vi.spyOn(webdav, 'fetchCalendarCollectionComponents').mockResolvedValue({ 'cal-dav-tasks': ['VTODO'] });
    fetchSpy.mockImplementation(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}'));
      const methodCalls = body.methodCalls as [string, Record<string, unknown>, string][];
      const [method, , tag] = methodCalls[0];
      if (method === 'Calendar/get') {
        const list = [{ id: 'cal-dav-tasks', name: 'Aufgaben' }, { id: 'cal-unknown', name: 'Alt' }];
        return jsonResponse({ methodResponses: [['Calendar/get', { list }, tag]] });
      }
      if (method === 'CalendarEvent/query') {
        return jsonResponse({ methodResponses: methodCalls.map(([, , t]) => ['CalendarEvent/query', { ids: ['obj-1'] }, t]) });
      }
      if (method === 'CalendarEvent/get') {
        return jsonResponse({ methodResponses: [['error', { type: 'serverFail' }, tag]] });
      }
      return jsonResponse({ methodResponses: [] });
    });

    const calendars = await client.getAllCalendars();
    const davTasks = calendars.find((c) => c.id === 'cal-dav-tasks');
    const unknown = calendars.find((c) => c.id === 'cal-unknown');

    expect(davTasks?.isTasksOnly).toBe(true);
    expect(davTasks?.isTasksOnlyConfirmed).toBe(true);
    expect(unknown?.isTasksOnly).toBe(false);
    expect(unknown?.isTasksOnlyConfirmed).toBeFalsy();
  });
});
