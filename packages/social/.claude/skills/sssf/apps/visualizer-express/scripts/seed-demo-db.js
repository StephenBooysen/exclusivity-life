/**
 * Build a demo sssf.db so the visualizer can be run — and tested — without a
 * stamped repo to point it at.
 *
 * The schema below is copied verbatim from adw_modules/tracer.py, including
 * the columns its MIGRATIONS list adds after the fact, so anything that works
 * against this db works against a real one.
 *
 *   node scripts/seed-demo-db.js [outDir]     # default: ./demo/adws/adw_data
 *   node server.js --db demo/adws/adw_data/sssf.db
 */

import { DatabaseSync } from "node:sqlite";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(process.argv[2] ?? join(HERE, "..", "demo", "adws", "adw_data"));

// ── schema, verbatim from tracer.py (SCHEMA + MIGRATIONS applied) ────────────
const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  adw_id        TEXT PRIMARY KEY,
  adw_name      TEXT,
  request       TEXT,
  status        TEXT,
  engineer      TEXT,
  started_at    TEXT, ended_at TEXT,
  total_tokens  INTEGER DEFAULT 0, total_cost REAL DEFAULT 0,
  archived      INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS phases (
  phase_id      TEXT PRIMARY KEY,
  adw_id        TEXT REFERENCES sessions,
  seq           INTEGER,
  name TEXT, kind TEXT, owner TEXT, description TEXT,
  status        TEXT DEFAULT 'fail',
  attempt       INTEGER DEFAULT 0, retries INTEGER DEFAULT 0,
  error         TEXT,
  started_at    TEXT, ended_at TEXT
);
CREATE TABLE IF NOT EXISTS events (
  event_id      TEXT PRIMARY KEY,
  adw_id        TEXT REFERENCES sessions,
  phase_id      TEXT REFERENCES phases,
  parent_id     TEXT,
  type          TEXT,
  name          TEXT,
  payload_json  TEXT,
  tokens        INTEGER,
  started_at    TEXT, ended_at TEXT
);
CREATE TABLE IF NOT EXISTS envelopes (
  envelope_id   TEXT PRIMARY KEY,
  adw_id        TEXT REFERENCES sessions,
  phase_id      TEXT REFERENCES phases,
  agent         TEXT,
  output_type   TEXT,
  payload_json  TEXT,
  valid         INTEGER,
  attempt       INTEGER,
  created_at    TEXT
);
CREATE TABLE IF NOT EXISTS gate_results (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  adw_id        TEXT REFERENCES sessions,
  phase_id      TEXT REFERENCES phases,
  attempt       INTEGER,
  gate          TEXT,
  passed        INTEGER,
  violations_json TEXT,
  checks_json   TEXT,
  created_at    TEXT
);
CREATE TABLE IF NOT EXISTS processes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  adw_id        TEXT REFERENCES sessions,
  kind          TEXT,
  name          TEXT,
  pid           INTEGER,
  command       TEXT,
  started_at    TEXT, ended_at TEXT
);
CREATE TABLE IF NOT EXISTS agent_sessions (
  adw_id        TEXT REFERENCES sessions,
  agent         TEXT,
  coding_agent  TEXT, model TEXT, color TEXT,
  session_id    TEXT,
  context_tokens INTEGER,
  context_window INTEGER,
  created_at    TEXT, last_used_at TEXT,
  PRIMARY KEY (adw_id, agent)
);
`;

mkdirSync(outDir, { recursive: true });
const dbPath = join(outDir, "sssf.db");
for (const suffix of ["", "-wal", "-shm"]) {
  rmSync(dbPath + suffix, { force: true });
}

const db = new DatabaseSync(dbPath);
db.exec("PRAGMA journal_mode=WAL;");
db.exec(SCHEMA);

// ── helpers ─────────────────────────────────────────────────────────────────

// Anchored to "now" so the three runs sort the way a real day would read:
// the live one on top, then the most recent finished ones.
let clock = Date.now() - 52 * 60_000;
const iso = (ms) => new Date(ms).toISOString().replace("Z", "+00:00");
let seq = 0;
const id = (p) => `${p}_${(seq++).toString(16).padStart(12, "0")}`;

// The session row goes in FIRST and is updated at the end — the same order
// session.ensure()/tracer.session_finish() use, which is also what the
// phases→sessions foreign key requires (node:sqlite enforces it by default,
// where Python's sqlite3 module does not).
const ins = {
  sessionStart: db.prepare(
    `INSERT INTO sessions (adw_id, adw_name, request, status, engineer, started_at, archived)
      VALUES (?,?,?,'running',?,?,0)`,
  ),
  sessionFinish: db.prepare(
    `UPDATE sessions SET status = ?, ended_at = ?, total_tokens = ?, total_cost = ?
      WHERE adw_id = ?`,
  ),
  phase: db.prepare(
    `INSERT INTO phases (phase_id, adw_id, seq, name, kind, owner, description,
      status, attempt, retries, error, started_at, ended_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ),
  event: db.prepare(
    `INSERT INTO events (event_id, adw_id, phase_id, parent_id, type, name,
      payload_json, tokens, started_at, ended_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
  ),
  envelope: db.prepare(
    `INSERT INTO envelopes (envelope_id, adw_id, phase_id, agent, output_type,
      payload_json, valid, attempt, created_at) VALUES (?,?,?,?,?,?,?,?,?)`,
  ),
  gate: db.prepare(
    `INSERT INTO gate_results (adw_id, phase_id, attempt, gate, passed,
      violations_json, checks_json, created_at) VALUES (?,?,?,?,?,?,?,?)`,
  ),
  agent: db.prepare(
    `INSERT INTO agent_sessions (adw_id, agent, coding_agent, model, color,
      session_id, context_tokens, context_window, created_at, last_used_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`,
  ),
  process: db.prepare(
    `INSERT INTO processes (adw_id, kind, name, pid, command, started_at, ended_at)
      VALUES (?,?,?,?,?,?,?)`,
  ),
};

const ROSTER = {
  planner: {
    model: "fireworks/accounts/fireworks/models/kimi-k3",
    color: "#a78bfa",
    thinking: "high",
    window: 262144,
    purpose: "Turn a request into a plan the builder can implement without asking questions.",
    tools: ["read", "grep", "find", "ls", "bash", "write", "subagent_create"],
    harness: ["adws/adw_data/harness_engineering/subagents.ts"],
  },
  builder: {
    model: "google/gemini-3.6-flash",
    color: "#22d3ee",
    thinking: "medium",
    window: 1048576,
    purpose: "Implement the plan exactly; report every changed file in the envelope.",
    tools: ["read", "grep", "find", "ls", "bash", "edit", "write"],
    harness: [],
  },
  reviewer: {
    model: "openai/gpt-5.6-terra",
    color: "#fb7185",
    thinking: "high",
    window: 400000,
    purpose: "Confirm that what was built is what was asked for; change nothing.",
    tools: ["read", "grep", "find", "ls", "bash", "write"],
    harness: [],
  },
  documenter: {
    model: "openai/gpt-5.6-luna",
    color: "#e879f9",
    thinking: "medium",
    window: 400000,
    purpose: "Write up the change that was just made, from the diff; document only.",
    tools: ["read", "grep", "find", "ls", "bash", "write", "edit"],
    harness: [],
  },
  scout: {
    model: "google/gemini-3.6-flash",
    color: "#fbbf24",
    thinking: "medium",
    window: 1048576,
    purpose: "Find and report where things live; change nothing.",
    tools: ["read", "grep", "find", "ls", "bash", "write"],
    harness: ["adws/adw_data/harness_engineering/subagents.ts"],
  },
};

function usageFor(input, output, reasoning, cacheRead, cacheWrite) {
  const rate = (n, r) => Number((n * r).toFixed(6));
  return {
    input_tokens: input,
    output_tokens: output,
    cache_read_tokens: cacheRead,
    cache_write_tokens: cacheWrite,
    reasoning_tokens: reasoning,
    total_tokens: input + output + cacheRead + cacheWrite,
    input_cost: rate(input, 0.0000012),
    output_cost: rate(output, 0.0000075),
    cache_read_cost: rate(cacheRead, 0.0000001),
    cache_write_cost: rate(cacheWrite, 0.0000015),
    total_cost: rate(input, 0.0000012) + rate(output, 0.0000075) +
      rate(cacheRead, 0.0000001) + rate(cacheWrite, 0.0000015),
  };
}

const TOOL_CALLS = [
  ["bash", { command: "ls -la src" }, "src/\n  index.ts\n  server.ts\n  routes/\n  lib/", true],
  ["read", { path: "specs/health-endpoint.md" }, "# Health endpoint\n\nExpose GET /health returning {status, uptime}.", true],
  ["grep", { pattern: "app.get\\(", path: "src" }, "src/server.ts:42:app.get('/', home)", true],
  ["write", { file_path: "src/routes/health.ts" }, "wrote 24 lines", true],
  ["edit", { file_path: "src/server.ts" }, "1 replacement", true],
  ["bash", { command: "bun test" }, "bun test v1.1\n\n 12 pass\n 0 fail\n\nRan 12 tests.", true],
  ["bash", { command: "bun x tsc --noEmit" }, "error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'.", false],
  ["find", { pattern: "**/*.test.ts" }, "src/routes/health.test.ts\nsrc/server.test.ts", true],
];

/** Write one phase plus its events, and return the phase id. */
function addPhase(adwId, n, { name, kind, owner, description, status, startMs, durMs,
                              attempt = 0, retries = 0, error = null, toolCalls = 0,
                              usage = null, envelope = null, gates = [], logs = null }) {
  const phaseId = `${adwId}_${String(n).padStart(2, "0")}_${name}`;
  const endMs = status === "running" ? null : startMs + durMs;
  ins.phase.run(phaseId, adwId, n, name, kind, owner, description, status, attempt,
                retries, error, iso(startMs), endMs === null ? null : iso(endMs));

  const ev = (type, evName, payload, tokens, sMs, eMs) =>
    ins.event.run(id("evt"), adwId, phaseId, "", type, evName,
                  payload === null ? null : JSON.stringify(payload), tokens ?? null,
                  iso(sMs), eMs == null ? null : iso(eMs));

  ev("phase_start", name, { kind, owner, description }, null, startMs);

  if (logs) ev("log", name, logs, null, startMs + 5);

  if (kind === "agent") {
    const cfg = ROSTER[owner];
    ev("agent_start", owner, {
      model: cfg.model, thinking: cfg.thinking, color: cfg.color,
      session_id: `sssf-${adwId}-${owner}-a1b2`, coding_agent: "pi",
      purpose: cfg.purpose, tools: cfg.tools, harness_engineering: cfg.harness,
    }, null, startMs + 20);

    const span = Math.max(durMs - 400, 1000);
    for (let i = 0; i < toolCalls; i++) {
      const [tool, args, result, ok] = TOOL_CALLS[i % TOOL_CALLS.length];
      const s = startMs + 200 + Math.round((span * (i + 0.5)) / Math.max(toolCalls, 1));
      const d = 220 + ((i * 617) % 2400);
      ev("tool_call", `${tool}: ${Object.values(args)[0]}`, {
        tool, tool_call_id: `call_${i}`, args, result_snippet: result,
        ok, duration_ms: d, agent: owner,
      }, null, s, s + d);
    }
  }

  for (const g of gates) {
    ins.gate.run(adwId, phaseId, g.attempt ?? 1, g.gate, g.passed ? 1 : 0,
                 JSON.stringify(g.violations ?? []), JSON.stringify(g.checks ?? []),
                 iso(startMs + durMs - 200));
    ev(g.passed ? "gate_pass" : "gate_fail", g.gate,
       { attempt: g.attempt ?? 1, violations: g.violations ?? [], checks: g.checks ?? [] },
       null, startMs + durMs - 200);
  }

  if (envelope) {
    ins.envelope.run(id("env"), adwId, phaseId, owner, envelope.type,
                     JSON.stringify(envelope.payload, null, 2), envelope.valid === false ? 0 : 1,
                     envelope.attempt ?? 1, iso(startMs + durMs - 150));
    ev("handoff", owner, {
      artifacts: envelope.payload.artifacts ?? [],
      summary: envelope.payload.summary ?? "",
    }, null, startMs + durMs - 120);
  }

  if (usage) {
    ev("agent_end", owner, {
      cost: usage.total_cost, usage,
      context_tokens: usage.context_tokens, context_window: ROSTER[owner].window,
    }, usage.total_tokens, startMs + durMs - 60);
  }

  if (status === "fail" && error) {
    ev("error", name, { error }, null, startMs + durMs - 30);
  }
  if (endMs !== null) ev("phase_end", name, { status }, null, endMs);

  return phaseId;
}

// ── run 1: a complete, accepted adw_simple_sdlc ──────────────────────────────

function seedFullRun() {
  const adwId = "a1b2c3d4";
  const t0 = clock;
  let t = t0;
  let n = 0;

  ins.sessionStart.run(adwId, "adw_simple_sdlc",
    "Add a GET /health endpoint that returns service status and uptime, with tests.",
    "Stephen Booysen", iso(t0));

  addPhase(adwId, ++n, {
    name: "request", kind: "engineer", owner: "Stephen Booysen",
    description: "Capture the incoming ask", status: "success",
    startMs: t, durMs: 400,
    logs: { input: "Add a GET /health endpoint that returns service status and uptime, with tests.", baseline: "9f3c1ab" },
  });
  t += 900;

  addPhase(adwId, ++n, {
    name: "plan", kind: "agent", owner: "planner",
    description: "Turn the request into an implementable plan",
    status: "success", startMs: t, durMs: 42_000, toolCalls: 6,
    usage: { ...usageFor(18_400, 3_120, 1_890, 96_000, 12_400), context_tokens: 41_300 },
    envelope: {
      type: "PlanOutput",
      payload: {
        status: "success",
        summary: "Plan a GET /health endpoint returning status and uptime, with a route test.",
        artifacts: ["adws/adw_data/sessions/a1b2c3d4/context_handoff/plan.md", "specs/a1b2c3d4_health-endpoint.md"],
        commit_message: "Add spec for the /health endpoint",
        notes_for_next_agent: "Register the route in src/server.ts. uptime comes from process.uptime().",
      },
    },
    gates: [
      { gate: "artifacts_exist", passed: true, checks: [
        { item: "adws/adw_data/sessions/a1b2c3d4/context_handoff/plan.md", ok: true, note: "exists, 3.2KB" },
        { item: "specs/a1b2c3d4_health-endpoint.md", ok: true, note: "exists, 3.2KB" },
      ] },
      { gate: "files_non_empty", passed: true, checks: [
        { item: "adws/adw_data/sessions/a1b2c3d4/context_handoff/plan.md", ok: true, note: "3.2KB" },
        { item: "specs/a1b2c3d4_health-endpoint.md", ok: true, note: "3.2KB" },
      ] },
    ],
  });
  t += 42_900;

  addPhase(adwId, ++n, {
    name: "commit_plan", kind: "code", owner: "git",
    description: "Put the spec on record before any code exists to blur it",
    status: "success", startMs: t, durMs: 180,
    logs: { sha: "4c1e7a9", message: "Add spec for the /health endpoint" },
  });
  t += 600;

  addPhase(adwId, ++n, {
    name: "build", kind: "agent", owner: "builder",
    description: "Implement the plan exactly",
    status: "success", startMs: t, durMs: 68_000, toolCalls: 8,
    usage: { ...usageFor(24_900, 8_640, 0, 214_000, 19_800), context_tokens: 96_700 },
    envelope: {
      type: "BuildOutput",
      payload: {
        status: "success",
        summary: "Added GET /health returning {status, uptime} and a route test.",
        artifacts: [],
        changed_files: ["src/routes/health.ts", "src/server.ts", "src/routes/health.test.ts"],
        commit_message: "Add GET /health returning status and uptime",
        notes_for_next_agent: "Route registered in src/server.ts; test covers 200 and payload shape.",
      },
    },
    gates: [
      { gate: "diff_matches_claims", passed: true, checks: [
        { item: "src/routes/health.ts", ok: true, note: "exists, 812B" },
        { item: "src/server.ts", ok: true, note: "exists, 2.4KB" },
        { item: "src/routes/health.test.ts", ok: true, note: "exists, 1.1KB" },
      ] },
    ],
  });
  t += 68_900;

  addPhase(adwId, ++n, {
    name: "test_1", kind: "code", owner: "quality",
    description: "Run the suite — a known command, so code runs it and no agent has to rediscover it",
    status: "success", startMs: t, durMs: 4_200,
    logs: { passed: true, checks: "1/1", artifacts: "adws/adw_data/sessions/a1b2c3d4/context_handoff/quality/05_test/command.log" },
  });
  t += 4_800;

  addPhase(adwId, ++n, {
    name: "review_1", kind: "agent", owner: "reviewer",
    description: "Confirm the build matches the plan",
    status: "success", startMs: t, durMs: 31_000, toolCalls: 5,
    usage: { ...usageFor(31_200, 2_480, 4_100, 58_000, 8_900), context_tokens: 52_100 },
    envelope: {
      type: "ReviewOutput",
      payload: {
        status: "success",
        summary: "The endpoint matches the plan; both requirements are met.",
        artifacts: ["adws/adw_data/sessions/a1b2c3d4/context_handoff/review.md"],
        approved: true,
        findings: [
          { requirement: "GET /health returns service status", met: true, evidence: "src/routes/health.ts:8 returns {status:'ok'}" },
          { requirement: "Response includes uptime", met: true, evidence: "src/routes/health.ts:9 uses process.uptime()" },
        ],
        blocking: [],
        notes_for_next_agent: "",
      },
    },
    gates: [
      { gate: "artifacts_exist", passed: true, checks: [
        { item: "adws/adw_data/sessions/a1b2c3d4/context_handoff/review.md", ok: true, note: "exists, 1.8KB" },
      ] },
      { gate: "verdict_consistent", passed: true, checks: [
        { item: "approved vs blocking", ok: true, note: "no blocking items" },
        { item: "approved vs findings", ok: true, note: "every requirement met" },
        { item: "rejection names a problem", ok: true, note: "verdict is supported" },
      ] },
    ],
  });
  t += 31_800;

  addPhase(adwId, ++n, {
    name: "commit_build", kind: "code", owner: "git",
    description: "Land the code only now: green suite, approved review",
    status: "success", startMs: t, durMs: 210,
    logs: { sha: "b7d0e42", message: "Add GET /health returning status and uptime" },
  });
  t += 700;

  addPhase(adwId, ++n, {
    name: "changes", kind: "code", owner: "git",
    description: "Diff the whole run against its pinned baseline, for the documenter",
    status: "success", startMs: t, durMs: 260,
    logs: { base: "9f3c1ab @ 9f3c1ab", reason: "pinned before the first commit of this run",
            files: 4, lines: "+128 -6",
            diff: "adws/adw_data/sessions/a1b2c3d4/context_handoff/changes.diff" },
  });
  t += 800;

  addPhase(adwId, ++n, {
    name: "document", kind: "agent", owner: "documenter",
    description: "Write up the completed change",
    status: "success", startMs: t, durMs: 22_000, toolCalls: 4, retries: 1,
    usage: { ...usageFor(14_600, 4_900, 0, 34_000, 6_200), context_tokens: 28_400 },
    envelope: {
      type: "DocumentOutput",
      payload: {
        status: "success",
        summary: "Documented the /health endpoint and its response shape.",
        artifacts: ["app_docs/a1b2c3d4_health-endpoint.md"],
        document_path: "app_docs/a1b2c3d4_health-endpoint.md",
        documented_files: ["src/routes/health.ts", "src/server.ts"],
        commit_message: "Document the /health endpoint",
        notes_for_next_agent: "",
      },
    },
    gates: [
      { gate: "artifacts_exist", passed: true, checks: [
        { item: "app_docs/a1b2c3d4_health-endpoint.md", ok: true, note: "exists, 2.6KB" },
      ] },
      { gate: "files_non_empty", passed: true, checks: [
        { item: "app_docs/a1b2c3d4_health-endpoint.md", ok: true, note: "2.6KB" },
      ] },
    ],
  });
  t += 22_800;

  addPhase(adwId, ++n, {
    name: "commit_docs", kind: "code", owner: "git",
    description: "Ship the write-up in its own commit, beside the code it describes",
    status: "success", startMs: t, durMs: 190,
    logs: { sha: "e91f2c7", message: "Document the /health endpoint" },
  });
  t += 500;

  ins.sessionFinish.run("success", iso(t), 559_060, 0.8421, adwId);

  for (const [agent, ctx] of [["planner", 41_300], ["builder", 96_700],
                              ["reviewer", 52_100], ["documenter", 28_400]]) {
    const cfg = ROSTER[agent];
    ins.agent.run(adwId, agent, "pi", cfg.model, cfg.color,
                  `sssf-${adwId}-${agent}-a1b2`, ctx, cfg.window, iso(t0), iso(t));
  }
  ins.process.run(adwId, "adw", "", 48213, "adw_simple_sdlc.py \"Add a GET /health endpoint…\"",
                  iso(t0), iso(t));
  return { adwId, endMs: t };
}

// ── run 2: a failing run — red suite, then a gate failure ────────────────────

function seedFailedRun(startMs) {
  const adwId = "77af09be";
  const t0 = startMs;
  let t = t0;
  let n = 0;

  ins.sessionStart.run(adwId, "adw_build_test",
    "Migrate the session store to Redis and keep the existing API surface.",
    "Stephen Booysen", iso(t0));

  addPhase(adwId, ++n, {
    name: "request", kind: "engineer", owner: "Stephen Booysen",
    description: "Capture the incoming ask", status: "success",
    startMs: t, durMs: 300,
    logs: { input: "Migrate the session store to Redis and keep the existing API surface." },
  });
  t += 800;

  addPhase(adwId, ++n, {
    name: "build", kind: "agent", owner: "builder",
    description: "Implement the plan exactly",
    status: "success", startMs: t, durMs: 54_000, toolCalls: 7,
    usage: { ...usageFor(21_400, 7_200, 0, 178_000, 15_600), context_tokens: 88_200 },
    envelope: {
      type: "BuildOutput",
      payload: {
        status: "success",
        summary: "Swapped the in-memory session store for a Redis-backed one.",
        artifacts: [],
        changed_files: ["src/store/redis.ts", "src/store/index.ts"],
        commit_message: "Move the session store onto Redis",
        notes_for_next_agent: "REDIS_URL must be set; falls back to localhost:6379.",
      },
    },
    gates: [
      { gate: "diff_matches_claims", passed: true, checks: [
        { item: "src/store/redis.ts", ok: true, note: "exists, 1.9KB" },
        { item: "src/store/index.ts", ok: true, note: "exists, 640B" },
      ] },
    ],
  });
  t += 54_800;

  addPhase(adwId, ++n, {
    name: "test_1", kind: "code", owner: "quality",
    description: "Run the suite — a known command, so code runs it and no agent has to rediscover it",
    status: "success", startMs: t, durMs: 6_100,
    logs: { passed: false, checks: "0/1",
            artifacts: "adws/adw_data/sessions/77af09be/context_handoff/quality/03_test/command.log" },
  });
  t += 6_700;

  addPhase(adwId, ++n, {
    name: "fix_1", kind: "agent", owner: "builder", retries: 1, attempt: 1,
    description: "Repair what the suite reported, from its verbatim output",
    status: "fail", startMs: t, durMs: 47_000, toolCalls: 6,
    error: "builder failed gates after 2 attempt(s):\n- src/store/redis.ts: claimed changed file does not exist",
    usage: { ...usageFor(26_800, 6_400, 0, 201_000, 17_200), context_tokens: 118_900 },
    gates: [
      { gate: "diff_matches_claims", passed: false, attempt: 1,
        violations: ["src/store/redis.ts: claimed changed file does not exist"],
        checks: [
          { item: "src/store/redis.ts", ok: false, note: "claimed changed file does not exist" },
          { item: "src/store/index.ts", ok: true, note: "exists, 640B" },
        ] },
      { gate: "diff_matches_claims", passed: false, attempt: 2,
        violations: ["src/store/redis.ts: claimed changed file does not exist"],
        checks: [
          { item: "src/store/redis.ts", ok: false, note: "claimed changed file does not exist" },
          { item: "src/store/index.ts", ok: true, note: "exists, 640B" },
        ] },
      { gate: "tests_pass(bun test)", passed: false, attempt: 2,
        violations: ["bun test: exit 1"],
        checks: [
          { item: "bun test", ok: false, note: "exit 1\n\nsrc/store/redis.test.ts:\n(fail) reconnects after a dropped socket\n  error: connect ECONNREFUSED 127.0.0.1:6379\n      at Socket.<anonymous> (node:net:1607:16)\n\n 8 pass\n 1 fail\nRan 9 tests." },
        ] },
    ],
  });
  t += 47_500;

  ins.sessionFinish.run("fail", iso(t), 473_600, 0.6118, adwId);

  const cfg = ROSTER.builder;
  ins.agent.run(adwId, "builder", "pi", cfg.model, cfg.color,
                `sssf-${adwId}-builder-c3d4`, 118_900, cfg.window, iso(t0), iso(t));
  ins.process.run(adwId, "adw", "", 48980, "adw_build_test.py \"Migrate the session store…\"",
                  iso(t0), iso(t));
  return { adwId, endMs: t };
}

// ── run 3: still running, so the live view has something to move ────────────

function seedRunningRun(startMs) {
  const adwId = "5e6f7a8b";
  const t0 = startMs;
  let t = t0;
  let n = 0;

  ins.sessionStart.run(adwId, "adw_plan_build_test",
    "Add rate limiting to the public API routes, 100 req/min per key.",
    "Stephen Booysen", iso(t0));

  addPhase(adwId, ++n, {
    name: "request", kind: "engineer", owner: "Stephen Booysen",
    description: "Capture the incoming ask", status: "success",
    startMs: t, durMs: 350,
    logs: { input: "Add rate limiting to the public API routes, 100 req/min per key." },
  });
  t += 900;

  addPhase(adwId, ++n, {
    name: "plan", kind: "agent", owner: "planner",
    description: "Turn the request into an implementable plan",
    status: "success", startMs: t, durMs: 38_000, toolCalls: 5,
    usage: { ...usageFor(16_200, 2_900, 1_450, 82_000, 11_100), context_tokens: 36_800 },
    envelope: {
      type: "PlanOutput",
      payload: {
        status: "success",
        summary: "Plan a token-bucket rate limiter middleware keyed by API key.",
        artifacts: ["specs/5e6f7a8b_rate-limiting.md"],
        commit_message: "Add spec for API rate limiting",
        notes_for_next_agent: "Use a token bucket; 100/min with burst 20.",
      },
    },
    gates: [
      { gate: "artifacts_exist", passed: true, checks: [
        { item: "specs/5e6f7a8b_rate-limiting.md", ok: true, note: "exists, 2.9KB" },
      ] },
    ],
  });
  t += 38_900;

  // The live phase: started, no ended_at, no envelope, no agent_sessions row —
  // exactly the shape the UI has to cope with mid-run.
  addPhase(adwId, ++n, {
    name: "build", kind: "agent", owner: "builder",
    description: "Implement the plan exactly",
    status: "running", startMs: t, durMs: 26_000, toolCalls: 5,
  });

  // A queued phase, so the dashed "not started yet" block renders too.
  const queuedId = `${adwId}_04_review_1`;
  ins.phase.run(queuedId, adwId, 4, "review_1", "agent", "reviewer",
                "Confirm the build matches the plan", "queued", 0, 0, null, null, null);

  ins.sessionFinish.run("running", null, 214_800, 0.3184, adwId);

  const p = ROSTER.planner;
  ins.agent.run(adwId, "planner", "pi", p.model, p.color,
                `sssf-${adwId}-planner-e5f6`, 36_800, p.window, iso(t0), iso(t));
  // builder deliberately has NO agent_sessions row — it is still in flight, so
  // its lane must be built from the agent_start event alone.
  ins.process.run(adwId, "adw", "", 49512, "adw_plan_build_test.py \"Add rate limiting…\"",
                  iso(t0), null);
  ins.process.run(adwId, "agent", "builder", 49640, "pi builder google/gemini-3.6-flash",
                  iso(t), null);
  return { adwId };
}

// ── compiled prompts on disk, for the phase panel's prompts section ─────────

const SYSTEM_MD = `# Planner

You are the **planner**. You turn a request into a plan the builder can
implement without asking questions.

## Rules

- Read before you write. Understand the code you are planning against.
- The plan is the only thing you may leave in the repo, under \`specs/\`.
- Never implement. That is the builder's phase, not yours.

> One agent, one prompt, one purpose.
`;

const USER_MD = `# Plan Task

## Variables

### prompt

Add a GET /health endpoint that returns service status and uptime, with tests.

## Task

Plan the work described in \`prompt\`.

1. Write the full plan to \`<context_handoff_dir>/plan.md\`.
2. Copy that file into the repo under \`specs/\`.
3. Emit your \`Report\` JSON, declaring BOTH paths in \`artifacts\`.

## Report

Respond with ONLY valid JSON matching \`PlanOutput\` — no prose before or after:

\`\`\`json
{
  "status": "success",
  "summary": "<one sentence describing the plan>",
  "artifacts": ["<context_handoff_dir>/plan.md", "specs/<adw_id>_<slug>.md"],
  "commit_message": "<imperative one-line git subject>",
  "notes_for_next_agent": "<what the builder must know>"
}
\`\`\`
`;

function writePrompts(adwId, agent, system, user) {
  const dir = join(outDir, "sessions", adwId, agent, "prompts");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "system.md"), system);
  writeFileSync(join(dir, "user.md"), user);
}

// ── go ──────────────────────────────────────────────────────────────────────

const run1 = seedFullRun();
const run2 = seedFailedRun(run1.endMs + 90_000);
// The running one starts far enough back that its live phase has real elapsed
// time the moment the server renders it.
seedRunningRun(Date.now() - 66_000);

writePrompts(run1.adwId, "planner", SYSTEM_MD, USER_MD);
writePrompts(run1.adwId, "builder",
  "# Builder\n\nYou are the **builder**. Implement the plan exactly.\n",
  "# Build Task\n\nImplement the plan in `specs/`.\n\n## Report\n\n```json\n{\n  \"status\": \"success\",\n  \"changed_files\": [],\n  \"commit_message\": \"\"\n}\n```\n");
writePrompts(run2.adwId, "builder",
  "# Builder\n\nYou are the **builder**. Implement the plan exactly.\n",
  "# Build Task\n\nMigrate the session store to Redis.\n");

db.close();

console.log(`seeded ${dbPath}`);
console.log(`  a1b2c3d4  success  adw_simple_sdlc      10 phases, 4 agents`);
console.log(`  77af09be  fail     adw_build_test        4 phases, 1 agent`);
console.log(`  5e6f7a8b  running  adw_plan_build_test   4 phases (1 running, 1 queued)`);
console.log(`\nrun it:  node server.js --db ${dbPath}`);
