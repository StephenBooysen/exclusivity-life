/**
 * Event colors, agent lane colors, and payload parsing.
 *
 * Port of the Vue app's src/lib/events.ts.
 */

// ── Event dot colors ─────────────────────────────────────────────────────────
// One color per event type, shared by the session-card timelines and the phase
// detail list. gate_fail reads as an error signal on purpose.

export const EVENT_DOT_COLORS = {
  agent_start: "#c89bff",
  tool_call: "#5ad2dd",
  handoff: "#94a3ff",
  agent_end: "#4ade80",
  error: "#ff6f67",
  gate_fail: "#ff6f67",
};

export function dotColor(type) {
  if (!type) return null;
  return EVENT_DOT_COLORS[type] ?? null;
}

// ── Agent lane colors ────────────────────────────────────────────────────────
// Config color wins (agents[].color from the API, or the agent_start payload
// for in-flight agents); the palette below covers dbs written before the
// color column existed.

export const AGENT_FALLBACK_COLORS = [
  "#c89bff",
  "#5ad2dd",
  "#94a3ff",
  "#e8b64a",
  "#f2a2c4",
];

export function agentColor(configColor, payloadColor, index) {
  return (
    configColor ??
    payloadColor ??
    AGENT_FALLBACK_COLORS[index % AGENT_FALLBACK_COLORS.length] ??
    "#c89bff"
  );
}

/** "#c89bff" + alpha → rgba() usable in inline styles. Invalid input → transparent. */
export function hexAlpha(hex, alpha) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex ?? "").trim());
  if (!m || !m[1]) return "transparent";
  const n = Number.parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 0xff}, ${(n >> 8) & 0xff}, ${n & 0xff}, ${alpha})`;
}

// ── Payload parsing ──────────────────────────────────────────────────────────

export function parsePayload(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
    /* legacy or truncated payloads render raw */
  }
  return null;
}

export function parseToolCall(e) {
  const payload = parsePayload(e.payload_json);
  if (!payload || typeof payload.tool !== "string") return null;
  return payload;
}

export function parseAgentStart(e) {
  return parsePayload(e.payload_json);
}

// Args keys most likely to BE the call, in priority order — a bash command, a
// file path, a search pattern. Used to build the one-line label.
const ARG_LABEL_KEYS = [
  "command",
  "cmd",
  "file_path",
  "path",
  "pattern",
  "query",
  "url",
  "prompt",
  "description",
];

const LABEL_MAX = 160;

function oneLine(value) {
  const flat = String(value).replaceAll(/\s+/g, " ").trim();
  return flat.length > LABEL_MAX ? `${flat.slice(0, LABEL_MAX)}…` : flat;
}

/** One-line summary of a tool's args: the call itself, not a JSON dump. */
export function argsSummary(args) {
  if (!args) return "";
  for (const key of ARG_LABEL_KEYS) {
    const v = args[key];
    if (typeof v === "string" && v.trim() !== "") return oneLine(v);
  }
  const parts = [];
  for (const [key, v] of Object.entries(args)) {
    if (v == null) continue;
    parts.push(`${key}=${typeof v === "string" ? v : JSON.stringify(v)}`);
  }
  return oneLine(parts.join(" "));
}

/**
 * Exact-call row label for an event.
 * Rich tool_call → "bash: bun test src". Legacy payloads fall back to
 * the event name plus whatever hint the payload carries.
 */
export function eventLabel(e) {
  if (e.type === "tool_call") {
    const call = parseToolCall(e);
    if (call?.tool) {
      // New-tracer rows already carry the human label in events.name
      // ("bash: ls -la src") — prefer it over re-deriving.
      if (e.name?.startsWith(call.tool)) return oneLine(e.name);
      const summary = argsSummary(call.args);
      return summary ? `${call.tool}: ${summary}` : call.tool;
    }
    const legacy = parsePayload(e.payload_json);
    if (legacy && typeof legacy.pi_event === "string") {
      return `${e.name ?? "tool"} ${legacy.pi_event}`;
    }
  }
  return e.name ?? e.type ?? "";
}
