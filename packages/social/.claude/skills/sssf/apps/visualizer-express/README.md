# SSSF Visualizer — Express edition

Read-only observability UI for the Super Simple Software Factory. Same trace
db, same two views, same design — served by **Express + EJS**, rendered on the
server, with no client framework and no build step.

This is a port of `../visualizer` (Vue 3 + Vite + Bun). That app is untouched
and still works; this one is a drop-in alternative for anyone who would rather
run Node than Bun, or would rather not have a frontend build at all.

```bash
npm install
npm run seed                    # optional: a demo trace db to look at
node server.js --db demo/adws/adw_data/sssf.db
# → http://localhost:4600
```

Against a real stamped repo:

```bash
SSSF_DB=/abs/path/to/your-repo/adws/adw_data/sssf.db node server.js
```

The db is resolved as `--db` → `$SSSF_DB` → `<cwd>/adws/adw_data/sssf.db`, the
same order the Bun server used. Pass it explicitly, because the server runs
from this directory rather than from the repo being observed.

## What changed, and why

| Bun/Vue version | Here | Reason |
|---|---|---|
| `bun:sqlite` | `node:sqlite` | Ships with Node ≥22.5. No native module, nothing to compile |
| Vue 3 SPA + Vite build | EJS rendered per request | No bundler, no `dist/`, no dev-server proxy |
| `lucide-vue-next` | inline SVG in `shared/icons.js` | Nothing to tree-shake without a bundler |
| `@fontsource/play` via bundler | same package, served at `/fonts` | Self-hosted, no font CDN at runtime |
| hash routes `#/adw/phase` | real routes `/s/:adw/p/:phase` | Bookmarkable, and the back button is the browser's |
| `ref`/`reactive` open-state | `<details>` + radio inputs | State lives in the DOM, so it survives a live re-render — and works with JS off |
| client polls JSON, rebuilds DOM | client polls **HTML fragments** | The templates exist once. A live update cannot drift from a hard refresh |

Three dependencies: `express`, `ejs`, `@fontsource/play`.

## Layout

```
server.js                  wiring: db, view engine, static, routes
lib/
  db.js                    the sssf.db reader (port of the Bun server/db.ts)
  views.js                 view-model assembly + prompt-file reading
  helpers.js               what the templates are allowed to call
routes/
  pages.js                 the two pages and the two polled fragments
  api.js                   the JSON API, paths and shapes unchanged
views/                     layout, pages, fragments, partials
public/
  css/style.css            one stylesheet (global + all ex-`<style scoped>` blocks)
  js/live.js               fragment swap + DOM-state preservation
  js/{sessions,trace}.js   the two islands
  js/shared/*.js           formatting, geometry, markdown, highlighting, icons
scripts/seed-demo-db.js    builds a demo trace db to develop against
```

`public/js/shared/` is imported **by both the server and the browser**. Those
files are plain ESM with no Node or DOM dependencies, so the geometry that
places a phase block is literally the same code in both places.

## Routes

| Route | What |
|---|---|
| `GET /` | the run list |
| `GET /s/:adwId` | one run's waterfall |
| `GET /s/:adwId/p/:phaseId` | …with that phase's panel open |
| `GET /fragments/sessions` | the list, as an HTML fragment (polled) |
| `GET /fragments/trace/:adwId?phase=` | the trace, as an HTML fragment (polled) |

The JSON API is carried over unchanged: `/api/health`, `/api/sessions`,
`/api/sessions/:id`, `/api/sessions/:id/events?after=&limit=`,
`/api/sessions/:id/envelopes`, `/api/sessions/:id/gates`,
`/api/sessions/:id/agents/:agent/prompts`, and
`POST /api/sessions/:id/archive`.

## The data path is unchanged

Agents write SQLite, readers poll SQLite. There is no ingest endpoint and no
websocket. The read connection is opened `readOnly` and every query on it is a
SELECT; the one write in the process is the archive flag, on its own
connection, and only when a human clicks it.

Polling stops on its own when a run is no longer `running` — the fragment
response carries `x-session-status`, so the browser never has to read the
markup to find out whether there is anything left to watch. It also pauses
while the tab is hidden.

## Notes

- Needs **Node ≥ 22.5** for `node:sqlite` (developed on 26.x). Below that,
  swap `lib/db.js` to `better-sqlite3` — the call shapes are near-identical.
- `journal_mode` is asserted, not set: a readonly connection cannot change it.
  A non-WAL db warns on startup because live reads may then block writers.
- Every page works with JavaScript disabled. You lose live updates and the
  optimistic archive; you keep navigation, every collapsible, and the
  rendered/raw prompt switch.
