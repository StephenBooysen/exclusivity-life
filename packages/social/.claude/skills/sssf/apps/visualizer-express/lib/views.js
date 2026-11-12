/**
 * View-model assembly. The full page and the polled fragment render from the
 * SAME object, so a live update can never disagree with a hard refresh.
 */

import { readFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

import { buildWaterfall } from "../public/js/shared/layout.js";
import { buildPhaseDetail } from "../public/js/shared/detail.js";

/**
 * adw_ids and agent names are path segments on disk, so anything that isn't a
 * plain identifier is rejected outright rather than sanitized into something
 * that might still escape the sessions directory.
 */
const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;

export function isSafeSegment(value) {
  return SAFE_SEGMENT.test(value) && value !== "." && value !== "..";
}

/**
 * The exact compiled prompts sent to an agent, read from
 * `{data_dir}/sessions/{adw_id}/{agent}/prompts/`. These live only as files —
 * the db has no copy.
 *
 * A prompt file is absent whenever the agent never ran in this session — a
 * normal state, so it reads as null rather than an error.
 */
export async function readPrompts(db, adwId, agent) {
  if (!isSafeSegment(adwId) || !isSafeSegment(agent)) return null;

  const dir = resolve(db.sessionsDir, adwId, agent, "prompts");
  // Defense in depth: the segment check already forbids traversal.
  if (dir !== db.sessionsDir && !dir.startsWith(db.sessionsDir + sep)) return null;

  const read = async (name) => {
    try {
      return await readFile(join(dir, `${name}.md`), "utf8");
    } catch {
      return null;
    }
  };
  return { system: await read("system"), user: await read("user") };
}

/** Everything the L1 list needs, including each card's events for its timeline. */
export function sessionsView(db, limit = 200) {
  const sessions = db.sessions(limit);
  // One query for every card's dots, filtered in SQL to the handful of event
  // types a card actually plots — this runs on every poll tick, so it must not
  // scale with the size of the trace history.
  const byAdw = db.cardEvents(sessions.map((s) => s.adw_id));
  const eventsByAdw = {};
  for (const s of sessions) eventsByAdw[s.adw_id] = byAdw.get(s.adw_id) ?? [];
  return { sessions, eventsByAdw, nowMs: Date.now() };
}

/** Everything one run's trace needs: strip, waterfall, and the open phase panel. */
export async function traceView(db, adwId, phaseId) {
  const detailRow = db.sessionDetail(adwId);
  if (!detailRow) return null;

  const nowMs = Date.now();
  const events = db.allEvents(adwId);
  const phases = detailRow.phases;

  const selected = phaseId
    ? (phases.find((p) => p.phase_id === phaseId) ?? null)
    : null;

  const wf = buildWaterfall({
    session: detailRow.session,
    phases,
    agents: detailRow.agents,
    events,
    nowMs,
    selectedPhaseId: selected?.phase_id ?? null,
  });

  let detail = null;
  let prompts = null;
  if (selected) {
    detail = buildPhaseDetail({
      phase: selected,
      events,
      envelopes: db.envelopes(adwId),
      gates: db.gates(adwId),
      nowMs,
    });
    if (selected.kind === "agent" && selected.owner) {
      prompts = await readPrompts(db, adwId, selected.owner);
    }
  }

  return {
    adwId,
    phaseId: selected?.phase_id ?? null,
    phaseCrumb: selected?.name ?? null,
    session: detailRow.session,
    usage: detailRow.usage,
    wf,
    detail,
    prompts,
    nowMs,
  };
}
