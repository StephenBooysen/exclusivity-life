# Tests

```bash
npm test                      # everything
npx jest --selectProjects backend
npx jest --selectProjects client
npx jest tests/api/goals      # one file
```

## Layout

| Path | Environment | Covers |
|---|---|---|
| `tests/api/goals.test.js` | node | Goal CRUD, tier/parent/year filters, hierarchy, progress rollup, notes |
| `tests/api/habits.test.js` | node | Habits, archiving, habit logs, replace-on-retoggle, date-range filters |
| `tests/api/content.test.js` | node | Focus areas, wisdom, morning/evening reflections, moods, chat history, Claude proxy validation, health |
| `tests/pages/routes.test.js` | node | All ten page routes, the rendered shell, per-screen script loading, static assets |
| `tests/client/am-util.test.js` | jsdom | Escaping, local-date handling, week ranges, streak counting, priority tags |
| `tests/client/shell.test.js` | jsdom | Personal header, More sheet, AI sheet, AI chat request/response handling |

`tests/helpers/testApp.js` builds an Express app wired exactly like `app.js` —
same view engine, layout, routes and page handlers.

## Your data is never touched

Every backend suite gets its own SQLite file under the OS temp directory, created
in `beforeEach` and deleted afterwards. `data/web-database.db` is never opened.
This works because `WebDatabase.init()` accepts an optional path; the default is
unchanged, so production behaviour is identical.

## No network calls

The Claude tests exercise the proxy's own validation (missing key, missing
messages), which returns 400 before any outbound request. The client chat tests
stub `fetch`. Nothing here needs an API key or reaches api.anthropic.com.

## The service registry is not loaded

`app.js` initialises `nooblyjs-core`, which mounts the `/services`
admin dashboards. That is not part of this app's surface and would slow every
suite, so the harness omits it. If those dashboards ever become load-bearing,
they need their own suite.

## Notes

- Backend suites use `beforeEach`/`afterEach` for a clean database per test;
  `tests/pages` uses `beforeAll` because it only reads.
- `forceExit` is set in `jest.config.js`: sqlite3 can hold a handle briefly
  after `close()` resolves.
- Schema-level failures (a bad goal tier, an unknown habit frequency) surface as
  500s, because the routes let the SQLite CHECK constraint reject them. The
  tests assert that as current behaviour, not as a recommendation — returning
  400 with a validation message would be better, and would change those tests.
