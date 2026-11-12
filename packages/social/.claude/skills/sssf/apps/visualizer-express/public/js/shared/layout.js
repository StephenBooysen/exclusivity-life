/**
 * Trace geometry — lanes, waterfall block placement, axis ticks, card timelines.
 *
 * This is the arithmetic that used to live in SessionTrace.vue's and
 * SessionCard.vue's computed properties. Extracted into pure functions so the
 * Express server can render the same layout into EJS with no framework, and
 * the browser can recompute it from the same source when it polls.
 *
 * Everything takes an explicit `nowMs` rather than reading the clock, so a
 * server render and a client re-render of the same moment agree exactly.
 */

import { axisTicks, ts } from "./format.js";
import { agentColor, dotColor, hexAlpha, parseAgentStart, parsePayload } from "./events.js";

export const ENGINEER_COLOR = "#e8b64a";
export const CODE_COLOR = "#5ad2dd";

/**
 * The engineer's request opens the run and owns the start of the timeline: it
 * gets an exclusive leading zone, and every later phase maps into the rest —
 * nothing can render on top of it.
 */
const REQ_ZONE_PCT = 16;

/**
 * Phases are sequential by doctrine, and the render must say so: when a
 * near-zero phase (a git commit) is widened to a readable floor, every later
 * block shifts right by the same amount instead of being overlapped, and the
 * whole layout is normalized back into the track. Blocks may squeeze a hair;
 * they never stack.
 */
const MIN_BLOCK_PCT = 3.5;

export const STATUS_GLYPH = {
  success: "✓",
  fail: "✗",
  running: "●",
  queued: "○",
};

export const PHASE_DOT_GLYPH = {
  success: "●",
  running: "◐",
  queued: "○",
  fail: "✗",
};

/** Wall-clock extent of the whole run, widened to `now` while it is running. */
export function traceRange(session, phases, nowMs) {
  let t0 = Infinity;
  let t1 = -Infinity;
  const sStart = ts(session?.started_at);
  const sEnd = ts(session?.ended_at);
  if (Number.isFinite(sStart)) t0 = Math.min(t0, sStart);
  if (Number.isFinite(sEnd)) t1 = Math.max(t1, sEnd);
  for (const p of phases) {
    const a = ts(p.started_at);
    const b = ts(p.ended_at);
    if (Number.isFinite(a)) {
      t0 = Math.min(t0, a);
      t1 = Math.max(t1, a);
    }
    if (Number.isFinite(b)) t1 = Math.max(t1, b);
  }
  if (session?.status === "running") t1 = Math.max(t1, nowMs);
  if (!Number.isFinite(t0)) {
    t0 = nowMs;
    t1 = t0 + 1000;
  }
  if (t1 - t0 < 1000) t1 = t0 + 1000;
  return { t0, t1, span: t1 - t0 };
}

/**
 * Where the post-request timeline begins, in ms.
 *
 * The earliest non-engineer phase start, not the request phase's end: a later
 * ADW joining the session pushes the request row's ended_at forward, which
 * would otherwise throw every already-finished phase behind the origin.
 */
function originMsFor(phases, requestPhase, t0) {
  if (!requestPhase) return t0;
  let earliest = Infinity;
  for (const p of phases) {
    if (p.kind === "engineer") continue;
    const s = ts(p.started_at);
    if (Number.isFinite(s)) earliest = Math.min(earliest, s);
  }
  if (Number.isFinite(earliest)) return Math.max(earliest, t0);
  const end = ts(requestPhase.ended_at ?? requestPhase.started_at);
  return Number.isFinite(end) ? Math.max(end, t0) : t0;
}

export function phaseDurationMs(p, nowMs) {
  const start = ts(p.started_at);
  if (!Number.isFinite(start)) return NaN;
  const end = p.status === "running" ? nowMs : ts(p.ended_at);
  if (!Number.isFinite(end)) return NaN;
  return end - start;
}

export function sessionDurationMs(session, nowMs) {
  if (!session) return NaN;
  const start = ts(session.started_at);
  if (!Number.isFinite(start)) return NaN;
  const end = session.status === "running" ? nowMs : ts(session.ended_at);
  return (Number.isFinite(end) ? end : nowMs) - start;
}

/**
 * A live agent's model/thinking/color arrive on its agent_start event before
 * any agent_sessions row exists; attribute each start to its phase's owner.
 */
function ownerStarts(phases, events) {
  const ownerByPhase = new Map(phases.map((p) => [p.phase_id, p.owner]));
  const meta = {};
  for (const e of events) {
    if (e.type !== "agent_start") continue;
    const owner = (e.phase_id ? ownerByPhase.get(e.phase_id) : null) ?? e.name;
    if (!owner || meta[owner]) continue;
    const payload = parseAgentStart(e);
    if (payload) meta[owner] = payload;
  }
  return meta;
}

/**
 * Occupancy for an agent lane. Null unless BOTH numbers are real — a bar
 * against an unknown ceiling would be decoration, not data.
 */
function laneContext(info) {
  const used = info?.context_tokens ?? 0;
  const window = info?.context_window ?? 0;
  if (!used || !window) return null;
  const pct = Math.min(100, (used / window) * 100);
  return {
    used,
    window,
    pct,
    remaining: window - used,
    // Sub-1% occupancy is common and real; round it away and the bar reads empty.
    label: pct < 1 ? `${pct.toFixed(1)}%` : `${Math.round(pct)}%`,
    // Keep a non-zero fill visible — exact numbers ride in the label and title.
    fill: `${Math.max(pct, 2)}%`,
  };
}

/** Tool-call tick marks inside a phase block, positioned within its own span. */
function toolTicksByPhase(events) {
  const map = {};
  for (const e of events) {
    if (e.type !== "tool_call" || !e.phase_id) continue;
    (map[e.phase_id] ??= []).push({
      t: ts(e.started_at),
      ok: (() => {
        const p = parsePayload(e.payload_json);
        return !(p && "ok" in p && p.ok === false);
      })(),
    });
  }
  return map;
}

/**
 * The whole L2 view model: lanes, blocks with resolved geometry and inline
 * styles, axis ticks, and the request zone.
 */
export function buildWaterfall({ session, phases, agents, events, nowMs, selectedPhaseId }) {
  const ordered = [...phases].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  const range = traceRange(session, ordered, nowMs);
  const requestPhase =
    ordered.find((p) => p.kind === "engineer" && p.started_at) ?? null;
  const zonePct = requestPhase ? REQ_ZONE_PCT : 0;
  const originMs = originMsFor(ordered, requestPhase, range.t0);
  const postSpan = Math.max(range.t1 - originMs, 1000);

  const ticks = axisTicks(postSpan, 7).map((t) => ({
    pct: zonePct + (t.pct * (100 - zonePct)) / 100,
    label: t.label,
  }));

  // ── block placement ───────────────────────────────────────────────────────
  const avail = 100 - zonePct - 0.4; // hair of right margin
  const reqId = requestPhase?.phase_id;

  const timed = ordered
    .filter(
      (p) => p.phase_id !== reqId && Number.isFinite(ts(p.started_at)),
    )
    .map((p) => {
      const start = ts(p.started_at);
      let end = ts(p.ended_at);
      if (!Number.isFinite(end)) end = p.status === "running" ? nowMs : start;
      return {
        id: p.phase_id,
        start,
        left: ((start - originMs) / postSpan) * avail,
        width: ((Math.max(end, start) - start) / postSpan) * avail,
      };
    })
    .sort((a, b) => a.start - b.start);

  let shift = 0;
  let prevEdge = 0;
  const placed = [];
  for (const b of timed) {
    let left = b.left + shift;
    if (left < prevEdge) {
      shift += prevEdge - left;
      left = prevEdge;
    }
    const width = Math.max(b.width, MIN_BLOCK_PCT);
    shift += width - b.width;
    prevEdge = left + width;
    placed.push({ id: b.id, left, width });
  }

  const scale = avail / Math.max(prevEdge, avail);
  const geomById = {};
  for (const r of placed) {
    geomById[r.id] = { left: zonePct + r.left * scale, width: r.width * scale };
  }

  const ticksByPhase = toolTicksByPhase(events);

  function blockFor(p, laneColor) {
    let geom;
    if (p.phase_id === reqId && zonePct > 0) {
      geom = { left: 0.4, width: zonePct - 0.8 };
    } else {
      geom = geomById[p.phase_id];
    }
    if (!geom) return null;

    const durMs = phaseDurationMs(p, nowMs);
    const start = ts(p.started_at);
    let end = ts(p.ended_at);
    if (!Number.isFinite(end)) end = p.status === "running" ? nowMs : start;
    const innerSpan = Math.max(end - start, 1);

    return {
      phase: p,
      selected: p.phase_id === selectedPhaseId,
      glyph: STATUS_GLYPH[p.status ?? ""] ?? "○",
      durationMs: durMs,
      hasDuration: Number.isFinite(durMs),
      style: [
        `left:${geom.left}%`,
        `width:${geom.width}%`,
        `background:linear-gradient(180deg, ${hexAlpha(laneColor, 0.2)}, ${hexAlpha(laneColor, 0.05)})`,
        `border-color:${p.status === "fail" ? "rgba(255, 111, 103, 0.8)" : hexAlpha(laneColor, 0.55)}`,
        `--lane-glow:${hexAlpha(laneColor, 0.28)}`,
      ].join(";"),
      toolTicks: Number.isFinite(start)
        ? (ticksByPhase[p.phase_id] ?? [])
            .filter((m) => Number.isFinite(m.t))
            .map((m) => ({
              x: Math.min(Math.max(((m.t - start) / innerSpan) * 100, 1), 99),
              ok: m.ok,
            }))
        : [],
    };
  }

  // ── lanes ─────────────────────────────────────────────────────────────────
  const starts = ownerStarts(ordered, events);
  const agentOwners = [];
  for (const p of ordered) {
    if (p.kind === "agent" && p.owner && !agentOwners.includes(p.owner)) {
      agentOwners.push(p.owner);
    }
  }
  const codePhases = ordered.filter((p) => p.kind === "code");

  const laneDefs = [
    {
      id: "engineer",
      label: session?.engineer ?? "engineer",
      model: null,
      context: null,
      metaLines: ["engineer"],
      color: ENGINEER_COLOR,
      kind: "engineer",
      phases: ordered.filter((p) => p.kind === "engineer"),
    },
  ];
  if (codePhases.length) {
    laneDefs.push({
      id: "code",
      label: "code",
      model: null,
      context: null,
      metaLines: ["workspace"],
      color: CODE_COLOR,
      kind: "code",
      phases: codePhases,
    });
  }
  agentOwners.forEach((owner, i) => {
    const info = agents.find((a) => a.agent === owner);
    const start = starts[owner];
    laneDefs.push({
      id: `agent:${owner}`,
      label: owner,
      // The model is the lane's whole story; thinking level lives in the
      // phase detail's agent config section.
      model: info?.model ?? start?.model ?? null,
      context: laneContext(info),
      metaLines: [],
      color: agentColor(info?.color, start?.color, i),
      kind: "agent",
      phases: ordered.filter((p) => p.kind === "agent" && p.owner === owner),
    });
  });

  const lanes = laneDefs.map((lane) => ({
    ...lane,
    blocks: lane.phases
      .map((p) => blockFor(p, lane.color))
      .filter((b) => b !== null),
    queued: lane.phases
      .filter((p) => !p.started_at)
      .map((p, i) => ({
        phase: p,
        selected: p.phase_id === selectedPhaseId,
        style: `right:${10 + i * 5}px;width:170px`,
      })),
    ctxFillStyle: lane.context
      ? [
          `width:${lane.context.fill}`,
          `background:linear-gradient(90deg, ${hexAlpha(lane.color, 0.55)}, ${lane.color})`,
          `box-shadow:0 0 10px ${hexAlpha(lane.color, 0.45)}`,
        ].join(";")
      : "",
  }));

  return { lanes, ticks, zonePct, range, originMs, postSpan };
}

/**
 * The L1 card's per-agent dot timeline.
 *
 * Cards are a fixed size, so the timeline region fits exactly MAX_VISIBLE_ROWS
 * row slots. A roster that overflows spends one slot on the "+N more" line and
 * shows MIN_VISIBLE_ROWS agents in the rest — never fewer than three, so a
 * five-agent chain still reads as a chain rather than as a pair and a count.
 */
const MAX_VISIBLE_ROWS = 4;
const MIN_VISIBLE_ROWS = 3;

export function buildCardTimeline({ session, events, nowMs }) {
  const running = session.status === "running";
  const phases = session.phases ?? [];

  // range
  let t0 = ts(session.started_at);
  if (!Number.isFinite(t0)) {
    t0 = Math.min(
      ...events.map((e) => ts(e.started_at)).filter(Number.isFinite),
    );
  }
  if (!Number.isFinite(t0)) t0 = nowMs;
  let t1 = running ? nowMs : ts(session.ended_at);
  if (!Number.isFinite(t1)) {
    t1 = Math.max(
      ...events.map((e) => ts(e.started_at)).filter(Number.isFinite),
    );
  }
  if (!Number.isFinite(t1)) t1 = t0 + 1000;
  const span = Math.max(t1 - t0, 1000);

  const ticks = axisTicks(span, 5).map((t) => ({
    ...t,
    edge: t.pct === 0,
  }));

  // Per-agent rows: events attribute to an agent through their phase's owner.
  const owners = [];
  const ownerByPhase = new Map();
  for (const p of phases) {
    if (p.kind !== "agent" || !p.owner) continue;
    ownerByPhase.set(p.phase_id, p.owner);
    if (!owners.includes(p.owner)) owners.push(p.owner);
  }
  if (!owners.length) {
    return { rows: [], visibleRows: [], hiddenRowCount: 0, ticks, empty: true };
  }

  const byOwner = new Map(owners.map((o) => [o, []]));
  let latest = null;
  let latestT = -Infinity;

  for (const e of events) {
    const owner = e.phase_id ? ownerByPhase.get(e.phase_id) : undefined;
    const color = dotColor(e.type);
    if (!owner || !color) continue;
    const t = ts(e.started_at);
    if (!Number.isFinite(t)) continue;
    const offsetS = Math.round((t - t0) / 1000);
    const dot = {
      id: e.event_id,
      xPct: Math.min(Math.max(((t - t0) / span) * 100, 0), 100),
      color,
      title: `${e.type} ${e.name ?? ""} at ${offsetS}s`,
      latest: false,
    };
    byOwner.get(owner)?.push(dot);
    if (t >= latestT) {
      latestT = t;
      latest = dot;
    }
  }
  if (running && latest) latest.latest = true;

  // /api/sessions embeds agents so the labels can use config colors with no
  // extra request; historical sessions return color null → fallback palette.
  const rows = owners.map((owner, i) => {
    const info = (session.agents ?? []).find((a) => a.agent === owner);
    return {
      owner,
      color: agentColor(info?.color, null, i),
      title: info?.model ? `${owner} ${info.model}` : owner,
      dots: byOwner.get(owner) ?? [],
    };
  });

  const overflowing = rows.length > MAX_VISIBLE_ROWS;
  return {
    rows,
    visibleRows: overflowing ? rows.slice(0, MIN_VISIBLE_ROWS) : rows,
    hiddenRowCount: overflowing ? rows.length - MIN_VISIBLE_ROWS : 0,
    ticks,
    empty: false,
  };
}
