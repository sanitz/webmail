# Fork E2E specs (tiger-iac#1754)

The fork's features against a real Stalwart, before each fork build:

```bash
e2e-fork/run.sh                 # all specs, about 2.5 minutes
e2e-fork/run.sh 20-task-series  # one spec
```

| Part | What |
| --- | --- |
| `stalwart.sh` | Throwaway Stalwart, rootless podman, on the image production runs (digest from tiger-iac `stalwart_image`) with upstream's bootstrap from `integration/stalwart`. No volume: `down` leaves nothing. |
| `run.sh` | Stalwart up, the app in `next dev` on port 3100, Playwright in `mcr.microsoft.com/playwright` (browsers and their system libraries inside), teardown. Output and app data in `~/.cache/bulwark-e2e`, never in the repo: `next dev` reloads on every write there. |
| `helpers.ts` | What a phone does over CalDAV, and reading back what Stalwart stored (JMAP, iCalendar). |
| `ui.ts` | Driving the calendar. |
| `fixtures.ts` | The specs' `test`: a silent stand-in for the hot-reload socket. |

Specs are `*.e2e.ts`: Vitest picks up `*.spec.ts`. Specs check the server, not only the page: Stalwart echoes values over JMAP it
never stores and drops others silently.

Covered: task-only lists (made over CalDAV, empty, never an event target, one
tick for grid and tasks view), weekly series (rule, start and due on the server
and in the iCalendar, occurrences on the grid), ticking off one occurrence, the
three scopes and a split without duplicates; ticking off a task in a calendar
shared with the login and a series of a second login (scope dialog).

Not covered: mail, contacts, files, other upstream features; looks; real
CalDAV clients; production (Caddy, OIDC, CORS); editing in shared calendars
and second logins beyond ticking off; phone layout, other browsers and time
zones.
