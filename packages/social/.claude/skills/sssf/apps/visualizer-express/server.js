/**
 * SSSF visualizer — Express + EJS server-rendered UI over a target repo's
 * sssf.db, plus the JSON API the Bun version exposed.
 *
 * Reads are read-only; the single write is POST /api/sessions/:adw_id/archive,
 * which sets one review flag on a row. There is no ingest endpoint and no
 * websocket — the data path is agents → sqlite → web ui, and the browser gets
 * there by polling server-rendered fragments.
 *
 *   node server.js
 *   node server.js --db /path/to/repo/adws/adw_data/sssf.db
 *   SSSF_DB=/path/to/sssf.db PORT=4600 node server.js
 */

import express from "express";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { SssfDb, resolveDbPath } from "./lib/db.js";
import { locals } from "./lib/helpers.js";
import { apiRoutes } from "./routes/api.js";
import { pageRoutes } from "./routes/pages.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 4600);

const dbPath = resolveDbPath();
let db;
try {
  db = new SssfDb(dbPath);
} catch (error) {
  console.error(`[sssf] ${error.message}`);
  process.exit(1);
}

const app = express();

app.set("view engine", "ejs");
app.set("views", resolve(HERE, "views"));
// Templates are ours and never change at runtime; caching them keeps a 500ms
// poll from re-reading and re-compiling every partial on every tick.
app.set("view cache", true);
app.locals = Object.assign(app.locals, locals);

app.use(express.json({ limit: "64kb" }));
app.use(express.static(resolve(HERE, "public")));

// Self-hosted Play, straight out of the installed package — no bundler, and
// no runtime call to a font CDN.
const require = createRequire(import.meta.url);
try {
  app.use(
    "/fonts",
    express.static(resolve(dirname(require.resolve("@fontsource/play/package.json")), "files")),
  );
} catch {
  console.warn("[sssf] @fontsource/play not installed — falling back to system sans");
}

app.use("/api", apiRoutes(db));
app.use("/", pageRoutes(db));

app.use((req, res) => {
  res.status(404).send("not found");
});

app.use((err, req, res, _next) => {
  console.error(`[sssf] ${req.method} ${req.originalUrl}:`, err);
  res.status(500).send("internal error");
});

const server = app.listen(PORT, () => {
  console.log(`[sssf] visualizer      http://localhost:${PORT}`);
  console.log(`[sssf] db              ${db.path}  [journal_mode=${db.journalMode}]`);
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
