/**
 * HTML routes: two pages and the two fragments their islands poll.
 *
 * Routes are real URLs rather than the Vue app's hash routes, so a phase is a
 * bookmarkable address and the back button is the browser's own.
 */

import { Router } from "express";
import { sessionsView, traceView } from "../lib/views.js";

/** Render a view inside layout.ejs. EJS has no layout support of its own. */
function page(res, next, view, locals) {
  res.render(view, locals, (err, body) => {
    if (err) return next(err);
    res.render("layout", { ...locals, body });
  });
}

export function pageRoutes(db) {
  const router = Router();

  router.get("/", (req, res, next) => {
    page(res, next, "sessions", {
      ...sessionsView(db),
      title: "Super Simple Software Factory",
      island: "sessions",
      adwId: null,
      phaseId: null,
      phaseCrumb: null,
    });
  });

  router.get("/fragments/sessions", (req, res) => {
    res.render("fragments/sessions-list", sessionsView(db));
  });

  async function renderTrace(req, res, next, phaseId) {
    try {
      const view = await traceView(db, req.params.adwId, phaseId);
      if (!view) return next();
      page(res, next, "trace", {
        ...view,
        title: `${req.params.adwId} · SSSF`,
        island: "trace",
      });
    } catch (err) {
      next(err);
    }
  }

  router.get("/s/:adwId", (req, res, next) => renderTrace(req, res, next, null));

  router.get("/s/:adwId/p/:phaseId", (req, res, next) =>
    renderTrace(req, res, next, req.params.phaseId),
  );

  router.get("/fragments/trace/:adwId", async (req, res, next) => {
    try {
      const view = await traceView(db, req.params.adwId, req.query.phase);
      if (!view) return res.status(404).send("");
      // The island stops polling on this, so it never has to read the markup
      // to find out whether there is anything left to watch.
      res.set("x-session-status", view.session.status ?? "");
      res.render("fragments/trace-body", view);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
