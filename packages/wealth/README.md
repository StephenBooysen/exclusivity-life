# me-money-manager
This is my first attempt at replacing my huge budget google sheet with an application that does the same

## Running it

```
npm install
npm run dev
```

Then open http://localhost:11001 (or `PORT=xxxx npm run dev` to pick a different port).

On first boot the app seeds itself with example starter data (accounts, debit orders, categories, expenses, and three growth scenarios) so there's something to look at immediately — edit or delete any of it from the app.

## Structure

- `index.js` — process entry point, starts the Express app on `PORT` (default 11001)
- `backend/` — Express app, routes, and services; JSON-file storage via `nooblyjs-core` (`../../../nooblyjs-core`), with caching, a queue-backed activity log, and a scheduled daily net-worth snapshot job wired through the same platform
- `public/` — the mobile web frontend: plain HTML/CSS/JS (ES modules), no build step, no framework
- `.docs/PRD.md` — product requirements
- `.docs/Design/` — the visual design handoff this app's frontend was built against
