/**
 * SQLite reader over a target repo's sssf.db.
 *
 * Port of the Bun visualizer's server/db.ts onto `node:sqlite`, which ships
 * with Node itself — so this app has no native dependency to compile and no
 * bun runtime to install.
 *
 * The read connection is opened readonly and every query on it is a SELECT —
 * the writers are the tracers of running ADW processes, and WAL lets us read
 * straight through their inserts.
 *
 * ONE exception, opened lazily on its own connection: `setArchived`. Archiving
 * is review triage — "I have looked at this run" — which has to outlive a
 * browser, so it lives on the session row rather than in localStorage. It is
 * the only write this process can make, it touches exactly one column, and it
 * never runs unless a human clicks the button.
 */
import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

const DEFAULT_DB_RELATIVE = "adws/adw_data/sssf.db";
const MAX_LIMIT = 1000;
const DEFAULT_LIMIT = 500;

/**
 * The event types a session card draws a dot for — the keys of
 * EVENT_DOT_COLORS in public/js/shared/events.js. Anything else has no color
 * and is discarded by the card, so it is never worth reading.
 */
const CARD_EVENT_TYPES = [
  "agent_start",
  "tool_call",
  "handoff",
  "agent_end",
  "error",
  "gate_fail",
];

/**
 * Resolve the db path: --db arg wins, then SSSF_DB, then <cwd>/adws/adw_data/sssf.db.
 * The db lives in the TARGET repo, so cwd is the repo the visualizer is pointed at.
 */
export function resolveDbPath(argv = process.argv) {
  const flagIndex = argv.indexOf("--db");
  const inline = argv.find((a) => a.startsWith("--db="));
  const raw =
    (flagIndex !== -1 ? argv[flagIndex + 1] : undefined) ??
    (inline ? inline.slice("--db=".length) : undefined) ??
    process.env.SSSF_DB ??
    DEFAULT_DB_RELATIVE;

  return isAbsolute(raw) ? raw : resolve(process.cwd(), raw);
}

/**
 * node:sqlite hands back null-prototype rows. They serialize and template
 * fine, but anything that later spreads or Object.assigns them is clearer
 * with a real object, so rows cross this boundary as plain ones.
 */
function plain(row) {
  return row == null ? row : Object.assign({}, row);
}

function plainAll(rows) {
  return rows.map(plain);
}

export class SssfDb {
  /** Opened on first archive and kept; null until then. */
  #writer = null;
  /** Cache for hasColumn(), keyed "table.column". Only ever false → true. */
  #columnCache = new Map();
  #db;

  constructor(path) {
    if (!existsSync(path)) {
      throw new Error(
        `sssf.db not found at ${path}\n` +
          `Point the visualizer at a target repo: --db <path> or SSSF_DB=<path>, ` +
          `or run it from a repo root containing ${DEFAULT_DB_RELATIVE}`,
      );
    }
    this.path = path;
    /**
     * Where the ADW session dirs live: `{data_dir}/sessions/{adw_id}/{agent}/`.
     * The db sits in the same data_dir (config's `observability.db` defaults to
     * `adws/adw_data/sssf.db`), so deriving it as a sibling of the db file keeps
     * working when the whole data_dir is relocated.
     */
    this.sessionsDir = resolve(dirname(path), "sessions");

    // `readOnly` — capital O. The lowercase spelling is not a recognised option
    // and is silently ignored, which hands back a WRITABLE connection to a db
    // that running agents are actively writing. Verified against node:sqlite.
    this.#db = new DatabaseSync(path, { readOnly: true });

    // WAL is set by the tracer when it creates the db; a readonly connection
    // cannot change it, so we assert rather than set, and always take the
    // busy_timeout so a concurrent writer never turns into a failed request.
    this.#db.exec("PRAGMA busy_timeout = 5000");
    const mode = this.#db.prepare("PRAGMA journal_mode").get();
    this.journalMode = mode?.journal_mode ?? "unknown";
    if (String(this.journalMode).toLowerCase() !== "wal") {
      console.warn(
        `[db] journal_mode is "${this.journalMode}", expected "wal" — ` +
          `live reads during agent writes may block`,
      );
    }
  }

  /**
   * A SELECT fragment for a column the tracer adds by migration.
   *
   * We open readonly and cannot run those ALTERs ourselves, so selecting one
   * blindly would throw "no such column" on every request against a db an older
   * tracer wrote. Instead we probe and substitute NULL, which reads downstream
   * as "this db predates the column" — the same thing the UI shows for a row
   * the migration didn't backfill.
   *
   * The probe re-runs while the column is missing, because the tracer's ALTER
   * can land while we're serving: a startup-only check would keep returning
   * NULL for the rest of the process even after the data arrived. Once seen,
   * a column never goes away, so it latches.
   */
  hasColumn(table, column) {
    const key = `${table}.${column}`;
    if (!this.#columnCache.get(key)) {
      const cols = this.#db.prepare(`PRAGMA table_info(${table})`).all();
      this.#columnCache.set(
        key,
        cols.some((c) => c.name === column),
      );
    }
    return this.#columnCache.get(key) ?? false;
  }

  #optionalColumn(table, column) {
    return this.hasColumn(table, column) ? column : `NULL AS ${column}`;
  }

  close() {
    this.#writer?.close();
    this.#db.close();
  }

  /**
   * Archive or restore a session — the only write in this process.
   *
   * busy_timeout matters: a run may be mid-insert on the same WAL db, and a
   * click should wait its turn rather than fail. Returns false when the id
   * does not exist, so the route can 404 instead of silently succeeding.
   */
  setArchived(adwId, archived) {
    if (!this.hasColumn("sessions", "archived")) {
      throw new Error(
        "this db predates the archived column — run any ADW once to migrate it",
      );
    }
    if (!this.#writer) {
      this.#writer = new DatabaseSync(this.path);
      this.#writer.exec("PRAGMA busy_timeout=5000;");
    }
    this.#writer
      .prepare("UPDATE sessions SET archived = ? WHERE adw_id = ?")
      .run(archived ? 1 : 0, adwId);
    return this.session(adwId) !== null;
  }

  /** Sessions, most recent first, each with its phase statuses for the progress dots. */
  sessions(limit = 200) {
    const rows = plainAll(
      this.#db
        .prepare(
          `SELECT adw_id, ${this.#optionalColumn("sessions", "adw_name")}, request,
                  status, engineer, started_at, ended_at,
                  total_tokens, total_cost,
                  ${this.#optionalColumn("sessions", "archived")}
             FROM sessions
            WHERE COALESCE(${this.hasColumn("sessions", "archived") ? "archived" : "0"}, 0) = 0
            ORDER BY started_at DESC, rowid DESC
            LIMIT ?`,
        )
        .all(clamp(limit, 1, MAX_LIMIT)),
    );

    if (rows.length === 0) return [];

    // Embed each session's phases so the L1 progress dots cost no extra request.
    const ids = rows.map((row) => row.adw_id);
    const placeholders = ids.map(() => "?").join(", ");
    const phaseRows = plainAll(
      this.#db
        .prepare(
          `SELECT phase_id, adw_id, seq, name, kind, owner, description, status,
                  attempt, retries, error, started_at, ended_at
             FROM phases WHERE adw_id IN (${placeholders}) ORDER BY seq, rowid`,
        )
        .all(...ids),
    );

    const byAdw = new Map();
    for (const phase of phaseRows) {
      const list = byAdw.get(phase.adw_id);
      if (list) list.push(phase);
      else byAdw.set(phase.adw_id, [phase]);
    }

    // Agents come along too: an L1 card draws a per-agent dot timeline, and its
    // dots are colored per agent — without this it would be one request per card.
    const agentsByAdw = this.#agentsFor(ids);

    const summaries = [];
    for (const session of rows) {
      const phases = byAdw.get(session.adw_id) ?? [];
      summaries.push(
        Object.assign(session, {
          phases,
          phase_count: phases.length,
          agents: agentsByAdw.get(session.adw_id) ?? [],
        }),
      );
    }
    return summaries;
  }

  session(adwId) {
    return (
      plain(
        this.#db
          .prepare(
            `SELECT adw_id, ${this.#optionalColumn("sessions", "adw_name")}, request,
                    status, engineer, started_at, ended_at,
                    total_tokens, total_cost
               FROM sessions WHERE adw_id = ?`,
          )
          .get(adwId),
      ) ?? null
    );
  }

  phases(adwId) {
    return plainAll(
      this.#db
        .prepare(
          `SELECT phase_id, adw_id, seq, name, kind, owner, description, status,
                  attempt, retries, error, started_at, ended_at
             FROM phases WHERE adw_id = ? ORDER BY seq, rowid`,
        )
        .all(adwId),
    );
  }

  agentSessions(adwId) {
    return this.#agentsFor([adwId]).get(adwId) ?? [];
  }

  /**
   * Agents per session, for a set of ids at once: the agent_sessions rows plus
   * anything that has started but not finished.
   *
   * agents.py writes the agent_sessions row only after the envelope persists, so
   * a running agent has no row there — precisely the case the live view exists
   * for. Its model, color and session_id are already on the agent_start event,
   * so a lane is labelled and colored from the moment the agent spawns.
   */
  #agentsFor(adwIds) {
    const byAdw = new Map();
    if (adwIds.length === 0) return byAdw;
    const placeholders = adwIds.map(() => "?").join(", ");

    const append = (adwId, agent) => {
      const list = byAdw.get(adwId);
      if (list) list.push(agent);
      else byAdw.set(adwId, [agent]);
    };

    const color = this.#optionalColumn("agent_sessions", "color");
    const ctxUsed = this.#optionalColumn("agent_sessions", "context_tokens");
    const ctxWindow = this.#optionalColumn("agent_sessions", "context_window");

    const completed = plainAll(
      this.#db
        .prepare(
          `SELECT adw_id, agent, coding_agent, model, session_id, ${color},
                  ${ctxUsed}, ${ctxWindow}, created_at, last_used_at
             FROM agent_sessions WHERE adw_id IN (${placeholders})
            ORDER BY created_at, agent`,
        )
        .all(...adwIds),
    );
    for (const row of completed) append(row.adw_id, row);

    const started = plainAll(
      this.#db
        .prepare(
          `SELECT e.adw_id, p.owner AS agent, e.payload_json, e.started_at
             FROM events e JOIN phases p ON p.phase_id = e.phase_id
            WHERE e.adw_id IN (${placeholders}) AND e.type = 'agent_start'
            ORDER BY e.rowid`,
        )
        .all(...adwIds),
    );

    for (const row of started) {
      if (!row.agent) continue;
      // A finished row is authoritative; only fill genuine gaps.
      if (byAdw.get(row.adw_id)?.some((a) => a.agent === row.agent)) continue;
      let payload = {};
      try {
        payload = JSON.parse(row.payload_json ?? "{}");
      } catch {
        // A malformed payload just means no label — never a failed request.
      }
      append(row.adw_id, {
        adw_id: row.adw_id,
        agent: row.agent,
        coding_agent: null,
        model: payload.model ?? null,
        session_id: payload.session_id ?? null,
        color: payload.color ?? null,
        // Occupancy is only known once the agent's turn closes.
        context_tokens: null,
        context_window: null,
        created_at: row.started_at,
        last_used_at: row.started_at,
      });
    }
    return byAdw;
  }

  /** Session + phases + agents in one shot — L2 needs all three to draw lanes. */
  sessionDetail(adwId) {
    const session = this.session(adwId);
    if (!session) return null;

    return {
      session,
      usage: this.usage(adwId),
      phases: this.phases(adwId),
      agents: this.agentSessions(adwId),
    };
  }

  /**
   * Raw tokens read and written, beside the billed headline.
   *
   * Derived from the `agent_end` payloads rather than stored, so every run
   * already in the db gets the split without a migration or a re-run.
   *
   * `total_tokens` is a SPEND number: every turn re-sends the whole
   * conversation, so an 86k conversation over 49 turns bills millions. These
   * two say what actually moved — material read for the first time, and
   * material generated. The gap between them and the headline is cached
   * re-reads, which is usually most of it.
   */
  usage(adwId) {
    const rows = this.#db
      .prepare(
        "SELECT payload_json FROM events WHERE adw_id = ? AND type = 'agent_end'",
      )
      .all(adwId);

    let read = 0;
    let written = 0;
    for (const row of rows) {
      if (!row.payload_json) continue;
      try {
        const u = JSON.parse(row.payload_json).usage;
        if (!u) continue;
        // RAW reads only: material entering the context for the first time,
        // billed either as uncached input or as a cache write. Cache reads are
        // the same tokens served again on later turns — counting them here
        // would rebuild the very inflation this split exists to expose.
        read += (u.input_tokens ?? 0) + (u.cache_write_tokens ?? 0);
        written += u.output_tokens ?? 0;
      } catch {
        /* a payload written by an older tracer simply contributes nothing */
      }
    }
    return { read, written };
  }

  /**
   * The polling query. Rowid cursor, insertion order, bounded page — the same
   * mechanism serves the live tail and lazy-paged history.
   */
  events(adwId, after = 0, limit = DEFAULT_LIMIT) {
    const cappedLimit = clamp(limit, 1, MAX_LIMIT);
    const events = plainAll(
      this.#db
        .prepare(
          `SELECT rowid, event_id, adw_id, phase_id, parent_id, type, name,
                  payload_json, tokens, started_at, ended_at
             FROM events
            WHERE adw_id = ? AND rowid > ?
            ORDER BY rowid
            LIMIT ?`,
        )
        .all(adwId, Math.max(0, after), cappedLimit),
    );

    return {
      events,
      cursor:
        events.length > 0
          ? events[events.length - 1].rowid
          : Math.max(0, after),
      has_more: events.length === cappedLimit,
    };
  }

  /**
   * Just the events an L1 card plots, for many sessions in one query.
   *
   * The list fragment re-renders every 500ms, so draining every event of every
   * session (which is what the Vue cards each did for themselves, client-side)
   * would put the whole trace history through this process twice a second. A
   * card only draws dots for agent-phase events that HAVE a dot color, and it
   * never reads a payload — so the filtering belongs in SQL, and payload_json
   * is left on disk entirely.
   */
  cardEvents(adwIds) {
    const byAdw = new Map();
    if (adwIds.length === 0) return byAdw;
    const ids = adwIds.map(() => "?").join(", ");
    const types = CARD_EVENT_TYPES.map(() => "?").join(", ");
    const rows = this.#db
      .prepare(
        `SELECT e.adw_id, e.event_id, e.phase_id, e.type, e.name, e.started_at
           FROM events e JOIN phases p ON p.phase_id = e.phase_id
          WHERE e.adw_id IN (${ids}) AND p.kind = 'agent' AND e.type IN (${types})
          ORDER BY e.rowid`,
      )
      .all(...adwIds, ...CARD_EVENT_TYPES);
    for (const row of rows) {
      const list = byAdw.get(row.adw_id);
      if (list) list.push(row);
      else byAdw.set(row.adw_id, [row]);
    }
    return byAdw;
  }

  /** Every event for a session, drained page by page — what a server render needs. */
  allEvents(adwId) {
    const out = [];
    let cursor = 0;
    for (;;) {
      const page = this.events(adwId, cursor, MAX_LIMIT);
      out.push(...page.events);
      cursor = page.cursor;
      if (!page.has_more) return out;
    }
  }

  envelopes(adwId) {
    return plainAll(
      this.#db
        .prepare(
          `SELECT envelope_id, adw_id, phase_id, agent, output_type, payload_json,
                  valid, attempt, created_at
             FROM envelopes WHERE adw_id = ? ORDER BY created_at, rowid`,
        )
        .all(adwId),
    );
  }

  gates(adwId) {
    const checks = this.#optionalColumn("gate_results", "checks_json");
    return plainAll(
      this.#db
        .prepare(
          `SELECT id, adw_id, phase_id, attempt, gate, passed, violations_json,
                  ${checks}, created_at
             FROM gate_results WHERE adw_id = ? ORDER BY id`,
        )
        .all(adwId),
    );
  }

  sessionCount() {
    const row = this.#db.prepare("SELECT COUNT(*) AS n FROM sessions").get();
    return row?.n ?? 0;
  }
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}
