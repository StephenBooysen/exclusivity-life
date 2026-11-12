/**
 * The phase-detail view model — everything PhaseDetail.vue computed, as one
 * pure function over the session's events, envelopes and gates.
 *
 * Keeping the derivation here (rather than inside a template) is what lets the
 * server render the panel and the browser re-render it from the same code.
 */

import { ts } from "./format.js";
import { parseAgentStart, parseToolCall } from "./events.js";

export const TYPE_CLASS = {
  gate_fail: "t-red",
  error: "t-red",
  gate_pass: "t-green",
  tool_call: "t-cyan",
  handoff: "t-violet",
  agent_start: "t-purple",
  agent_end: "t-green",
};

/**
 * New-tracer gate rows carry per-item evidence in checks_json. null means no
 * evidence was recorded (legacy row → plain non-expandable line); "[]" means
 * the gate ran and inspected nothing — a real, different answer.
 */
export function gateChecks(g) {
  const raw = g.checks_json;
  if (raw == null) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed
      .filter((c) => c !== null && typeof c === "object")
      .map((c) => ({
        item: typeof c.item === "string" ? c.item : "",
        ok: c.ok === true,
        note: typeof c.note === "string" ? c.note : "",
      }));
  } catch {
    return null;
  }
}

export function violations(g) {
  try {
    const v = JSON.parse(g.violations_json ?? "[]");
    if (Array.isArray(v)) {
      return v.map((x) => (typeof x === "string" ? x : JSON.stringify(x)));
    }
  } catch {
    /* keep raw below */
  }
  return g.violations_json ? [g.violations_json] : [];
}

/** Collapsed-row count label: mixed gates surface how many items failed. */
export function checksLabel(checks) {
  const failed = checks.filter((c) => !c.ok).length;
  return failed > 0 ? `${failed} of ${checks.length} failed` : String(checks.length);
}

export function eventDurationMs(e) {
  const a = ts(e.started_at);
  const b = ts(e.ended_at);
  if (Number.isFinite(a) && Number.isFinite(b)) return b - a;
  // tool_call rows on older tracers have no ended_at — the payload's
  // duration_ms (when the coding agent reported one) is the source of truth.
  if (e.type === "tool_call") {
    const call = parseToolCall(e);
    if (call?.duration_ms != null) return call.duration_ms;
  }
  return NaN;
}

/**
 * What this phase's agent run spent, off its `agent_end` event.
 *
 * Returns null for non-agent phases and for a run still in flight. Older runs
 * recorded only a lump `cost`, so the breakdown is optional and rows are built
 * from whatever was written.
 */
function phaseUsage(phase, phaseEvents) {
  if (phase.kind !== "agent") return null;
  const end = phaseEvents.find((e) => e.type === "agent_end");
  if (!end) return null;
  let payload = {};
  try {
    payload = JSON.parse(end.payload_json ?? "{}");
  } catch {
    // A malformed payload is a missing panel, never a broken detail view.
  }
  const u = payload.usage;
  if (!u) {
    // Pre-breakdown run: the event's own token count and the lump cost still hold.
    return {
      partial: true,
      rows: [
        {
          label: "total",
          tokens: end.tokens ?? 0,
          cost: payload.cost ?? 0,
          kind: "total",
        },
      ],
    };
  }
  const rows = [
    { label: "input", tokens: u.input_tokens, cost: u.input_cost },
    { label: "output", tokens: u.output_tokens, cost: u.output_cost },
  ];
  if (u.reasoning_tokens) {
    // Thinking bills at the output rate, so its share of the output cost is
    // exact arithmetic — but it is already INSIDE the output row above.
    const share = u.output_tokens
      ? (u.output_cost * u.reasoning_tokens) / u.output_tokens
      : 0;
    rows.push({
      label: "thinking",
      tokens: u.reasoning_tokens,
      cost: share,
      kind: "nested",
      title:
        "Thinking tokens — part of output above, billed at the output rate. Not added to the total.",
    });
  }
  rows.push(
    { label: "cache read", tokens: u.cache_read_tokens, cost: u.cache_read_cost },
    {
      label: "cache write",
      tokens: u.cache_write_tokens,
      cost: u.cache_write_cost,
    },
    { label: "total", tokens: u.total_tokens, cost: u.total_cost, kind: "total" },
  );
  return { rows, partial: false };
}

/**
 * The engineer's incoming ask, logged by every ADW's request phase as a
 * `log` event with an `input` payload — surfaced as its own section.
 */
function requestText(phase, phaseEvents) {
  if (phase.kind !== "engineer") return null;
  for (const e of phaseEvents) {
    if (e.type !== "log" || !e.payload_json) continue;
    try {
      const p = JSON.parse(e.payload_json);
      if (p && typeof p === "object" && "input" in p) {
        const input = p.input;
        if (typeof input === "string" && input.trim()) return input;
      }
    } catch {
      /* not JSON — skip */
    }
  }
  return null;
}

export function buildPhaseDetail({ phase, events, envelopes, gates, nowMs }) {
  const phaseEvents = events
    .filter((e) => e.phase_id === phase.phase_id)
    .sort((a, b) => a.rowid - b.rowid);

  const phaseGates = gates
    .filter((g) => g.phase_id === phase.phase_id)
    .sort((a, b) => (a.attempt ?? 0) - (b.attempt ?? 0) || a.id - b.id)
    .map((g) => {
      const checks = gateChecks(g);
      return {
        row: g,
        checks,
        checksLabel: checks ? checksLabel(checks) : null,
        violations: violations(g),
      };
    });

  const phaseOutputs = envelopes
    .filter((e) => e.phase_id === phase.phase_id)
    .sort((a, b) => (a.attempt ?? 0) - (b.attempt ?? 0));

  // The agent's configuration, carried on its phase's `agent_start` event.
  // Older rows carry only model/thinking — rows render what was recorded.
  const startEvent =
    phase.kind === "agent"
      ? phaseEvents.find((e) => e.type === "agent_start")
      : null;

  const start = ts(phase.started_at);
  const end = phase.status === "running" ? nowMs : ts(phase.ended_at);
  const durationMs =
    Number.isFinite(start) && Number.isFinite(end) ? end - start : NaN;

  return {
    phase,
    events: phaseEvents.map((e) => ({
      row: e,
      durationMs: eventDurationMs(e),
      call: e.type === "tool_call" ? parseToolCall(e) : null,
      typeClass: TYPE_CLASS[e.type ?? ""] ?? "",
    })),
    gates: phaseGates,
    outputs: phaseOutputs,
    agentConfig: startEvent ? parseAgentStart(startEvent) : null,
    usage: phaseUsage(phase, phaseEvents),
    requestText: requestText(phase, phaseEvents),
    durationMs,
    hasDuration: Number.isFinite(durationMs),
  };
}
