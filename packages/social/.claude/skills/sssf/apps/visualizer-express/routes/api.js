/**
 * The JSON API, carried over from the Bun server unchanged.
 *
 * The UI is server-rendered now and does not need these — but they are the
 * documented read surface over a trace db, and scripts point at them, so the
 * paths and shapes stay exactly as they were.
 *
 * There is no ingest endpoint and no websocket. The data path is
 * agents → sqlite → web ui.
 */

import { Router } from "express";
import { isSafeSegment, readPrompts } from "../lib/views.js";

/** Guard every handler so a malformed query can't take the server down mid-run. */
function safely(handler) {
  return async (req, res, next) => {
    try {
      await handler(req, res, next);
    } catch (error) {
      console.error(`[sssf] ${req.method} ${req.originalUrl}:`, error);
      res.status(500).json({ error: error.message });
    }
  };
}

function intQuery(req, key, fallback) {
  const raw = req.query[key];
  if (raw === undefined || String(raw).trim() === "") return fallback;
  const parsed = Number.parseInt(String(raw), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function apiRoutes(db) {
  const router = Router();

  router.use((req, res, nextFn) => {
    res.set("cache-control", "no-store");
    nextFn();
  });

  router.get(
    "/health",
    safely((req, res) => {
      res.json({
        ok: true,
        db: db.path,
        journal_mode: db.journalMode,
        sessions: db.sessionCount(),
      });
    }),
  );

  router.get(
    "/sessions",
    safely((req, res) => {
      res.json(db.sessions(intQuery(req, "limit", 200)));
    }),
  );

  router.get(
    "/sessions/:adwId",
    safely((req, res) => {
      const detail = db.sessionDetail(req.params.adwId);
      if (!detail) {
        return res.status(404).json({ error: `no session ${req.params.adwId}` });
      }
      res.json(detail);
    }),
  );

  // The one write. Archiving is review triage — it belongs to the reader, not
  // to the run — so it never touches anything a tracer wrote.
  router.post(
    "/sessions/:adwId/archive",
    safely((req, res) => {
      const adwId = req.params.adwId;
      if (!isSafeSegment(adwId)) {
        return res.status(400).json({ error: "invalid adw_id" });
      }
      const body = req.body ?? {};
      const archived = body.archived === undefined ? true : Boolean(body.archived);
      if (!db.setArchived(adwId, archived)) {
        return res.status(404).json({ error: `no session ${adwId}` });
      }
      res.json({ adw_id: adwId, archived });
    }),
  );

  router.get(
    "/sessions/:adwId/events",
    safely((req, res) => {
      res.json(
        db.events(
          req.params.adwId,
          intQuery(req, "after", 0),
          intQuery(req, "limit", 500),
        ),
      );
    }),
  );

  router.get(
    "/sessions/:adwId/envelopes",
    safely((req, res) => {
      res.json(db.envelopes(req.params.adwId));
    }),
  );

  router.get(
    "/sessions/:adwId/gates",
    safely((req, res) => {
      res.json(db.gates(req.params.adwId));
    }),
  );

  // The exact prompts an agent was sent, read from the session dir. Files are
  // the raw record; the db has no copy of them.
  router.get(
    "/sessions/:adwId/agents/:agent/prompts",
    safely(async (req, res) => {
      const { adwId, agent } = req.params;
      if (!isSafeSegment(adwId) || !isSafeSegment(agent)) {
        return res.status(400).json({ error: "invalid adw_id or agent" });
      }
      if (!db.session(adwId)) {
        return res.status(404).json({ error: `no session ${adwId}` });
      }
      res.json((await readPrompts(db, adwId, agent)) ?? { system: null, user: null });
    }),
  );

  router.use((req, res) => {
    res.status(404).json({ error: `no route ${req.originalUrl}` });
  });

  return router;
}
