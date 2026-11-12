# Exclusivity Life

A personal suite of five apps for running one life well: goals and habits, learning, nourishment, wealth, and a vetted dating club. Each app is a self-contained package under `packages/` that runs locally on Node.js with no external infrastructure.

Product intent for the whole suite lives in [`.claude/steering/product.md`](./.claude/steering/product.md).

## Packages

| Package | What it is | Port | Storage |
|---|---|---|---|
| [`goals`](./packages/goals) | Goal and habit tracker with morning/evening reflections, mood tracking, a wisdom library and an optional AI guide | 3100 | SQLite |
| [`learning`](./packages/learning) | Electron desktop app that turns web content into study plans (spaced repetition, active recall, interleaving), with a Chrome extension for capture | Electron | JSON files |
| [`nourishment`](./packages/nourishment) | Intermittent-fasting companion: plans, a live fast dashboard, streaks and history | 9301 | JSON files |
| [`social`](./packages/social) | Exclusivity: a vetted, human-reviewed membership dating club for Johannesburg | 9401 | JSON files |
| [`wealth`](./packages/wealth) | Personal finance for a South African household (ZAR), replacing a budget spreadsheet | 11001 | JSON files |

## Running a package

Each package installs and runs on its own:

```bash
cd packages/<name>
npm install
npm run dev
```

Then open the port shown above (or set `PORT=xxxx`). `npm run kill` frees the port if a previous run is still holding it.

Several packages depend on a sibling checkout of `nooblyjs-core` (`../nooblyjs-core/` from this repo root, i.e. `/workspaces/codespaces-blank/nooblyjs-core`), which provides the shared caching, queue, scheduler, logging and file storage. That repository must sit next to this one for `npm install` to resolve.

`learning` is started with `npm run electron:dev`.

## Repository layout

```
exclusivity-life/
├── .claude/steering/   # Product direction and research notes for Claude Code
├── packages/
│   ├── goals/          # me-architect-my-life
│   ├── learning/       # me-learning-hub
│   ├── nourishment/    # exclusivity-nourishment
│   ├── social/         # me-dating-app
│   └── wealth/         # me-money-manager
└── README.md
```

Each package keeps its own `README.md`, and some keep a `CLAUDE.md` or `.docs/` folder with design and requirements documents.

## Data and privacy

Each package's `.application/` folder holds live personal data: accounts, sessions, uploads, logs and records. It is git-ignored and must never be committed. Secrets belong in environment variables, not in code or READMEs. Copy `.env.example` where a package provides one.

## Conventions

The apps share a stack and look: native JavaScript, Express, a plain HTML/CSS/ES-module frontend with no build step, and JSON-file or SQLite storage. Where in doubt, follow the pattern used in `wealth`.
