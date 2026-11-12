/**
 * @fileoverview Test harness.
 *
 * Builds an Express app wired exactly like app.js — same view engine, same
 * layout, same routes and page handlers — but against a throwaway SQLite file
 * in the OS temp directory. The real data/web-database.db is never opened.
 *
 * The service registry (nooblyjs-core) is deliberately left out:
 * it mounts the /services admin dashboards, which are not part of this app's
 * surface and would slow every suite down.
 */

'use strict';

const express = require('express');
const cors = require('cors');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const crypto = require('node:crypto');
const expressLayouts = require('express-ejs-layouts');

const WebDatabase = require('../../backend/components/webdatabase.js');

const ROOT = path.join(__dirname, '..', '..');

/** Tracks every temp database created, so afterAll can remove them. */
const created = [];

/**
 * Creates an isolated app + database pair.
 * @returns {Promise<{app: Object, database: Object, dbPath: string}>}
 */
async function createTestApp() {
  const dbPath = path.join(
    os.tmpdir(),
    'aml-tests',
    `test-${crypto.randomBytes(8).toString('hex')}.db`
  );
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const database = new WebDatabase();
  await database.init(dbPath);
  created.push({ database, dbPath });

  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  app.set('view engine', 'ejs');
  app.set('views', path.join(ROOT, 'public', 'views'));
  app.use(expressLayouts);
  app.set('layout', 'layouts/main');
  app.set('layout extractScripts', true);
  app.set('layout extractStyles', true);

  // Mirrors app.js: template source must never be served as a static file.
  app.use((req, res, next) => {
    if (req.path.endsWith('.ejs')) return res.status(404).end();
    next();
  });
  app.use(express.static(path.join(ROOT, 'public')));

  require('../../backend/routes')(app, database);
  require('../../backend/pages')(app);

  return { app, database, dbPath };
}

/** Closes connections and deletes every temp database this run created. */
async function cleanupTestApps() {
  for (const entry of created.splice(0)) {
    try {
      await entry.database.close();
    } catch (_) { /* already closed */ }
    for (const suffix of ['', '-journal', '-wal', '-shm']) {
      try {
        fs.rmSync(entry.dbPath + suffix, { force: true });
      } catch (_) { /* best effort */ }
    }
  }
}

/**
 * Creates a focus area and returns its id. The database ships empty, so any
 * test needing an area makes its own.
 * @returns {Promise<number>}
 */
async function createFocusArea(database, name = 'Health & Fitness') {
  const result = await database.run(
    'INSERT INTO focus_areas (name, category, is_active) VALUES (?, ?, 1)',
    [name, name]
  );
  return result.id;
}

module.exports = { createTestApp, cleanupTestApps, createFocusArea };
