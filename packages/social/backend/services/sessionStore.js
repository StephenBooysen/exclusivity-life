'use strict';

/**
 * @fileoverview A small file-backed express-session store.
 *
 * The default MemoryStore drops every session on restart and leaks in
 * production. A dependency for this would be one more thing to keep current,
 * and the semantics needed here are small enough to own: read, write, expire.
 */

const fs = require('node:fs');
const path = require('node:path');
const session = require('express-session');

const Store = session.Store;

/**
 * Rename, retrying the Windows case where the destination is momentarily open.
 *
 * POSIX replaces an open file happily; Win32 refuses with EPERM/EBUSY while any
 * handle is on it without FILE_SHARE_DELETE, which a concurrent read of the
 * same session briefly is. The handle lives for microseconds, so a short
 * backoff converges — but the error is still reported if it does not, because a
 * session that silently fails to save is a member silently signed out.
 */
function renameWithRetry(from, to, callback, attempt = 0) {
  fs.rename(from, to, (err) => {
    if (!err) return callback(null);
    const transient = err.code === 'EPERM' || err.code === 'EBUSY' || err.code === 'EACCES';
    if (!transient || attempt >= 10) return callback(err);
    return setTimeout(() => renameWithRetry(from, to, callback, attempt + 1), 5 + attempt * 5);
  });
}

class FileSessionStore extends Store {
  /**
   * @param {{dir: string, ttlMs?: number, sweepMs?: number}} options
   */
  constructor(options) {
    super();
    this.dir = options.dir;
    this.ttlMs = options.ttlMs || 30 * 864e5;
    fs.mkdirSync(this.dir, { recursive: true });

    /**
     * One write in flight per session id, with any further writes for that id
     * coalesced into a single follow-up.
     *
     * express-session writes on nearly every request, so a burst against one
     * session is normal. Letting them all run at once means a queue of renames
     * competing with the reads happening alongside them — and on Windows a
     * rename fails outright while the destination is open. Serialising also
     * makes the coalescing safe to do: these writes are whole-session
     * snapshots, so when several are waiting only the last one has any effect.
     */
    this.writing = new Set();
    this.queued = new Map();

    /**
     * The newest accepted value per session id, held until its write settles
     * on disk, so the store reads its own writes.
     *
     * express-session saves after the response has gone out, so the very next
     * request routinely arrives before the write lands. Without this, that
     * request finds no session and starts a fresh one — which for the login
     * POST means the CSRF token minted by the preceding GET is gone, the
     * double-submit check fails, and the member is told their session expired
     * when in fact it had never been readable.
     */
    this.pending = new Map();

    const timer = setInterval(() => this.sweep(), options.sweepMs || 3600 * 1000);
    timer.unref?.();
  }

  /** Session ids come from express-session, but never trust one as a filename. */
  fileFor(sid) {
    const safe = String(sid).replace(/[^a-zA-Z0-9_-]/g, '');
    if (!safe) throw new Error('Invalid session id');
    return path.join(this.dir, `${safe}.json`);
  }

  get(sid, callback) {
    // An unsettled write is newer than anything on disk, and a pending delete
    // means the session is already gone as far as any caller is concerned.
    if (this.pending.has(sid)) {
      const payload = this.pending.get(sid);
      return process.nextTick(() => callback(null, payload === null ? null : this.revive(payload, sid)));
    }

    return fs.readFile(this.fileFor(sid), 'utf8', (err, data) => {
      if (err) return callback(null, null);
      const revived = this.revive(data, sid);
      return callback(null, revived);
    });
  }

  /** Parses a stored payload, applying expiry. Returns null if it is unusable. */
  revive(data, sid) {
    try {
      const parsed = JSON.parse(data);
      if (parsed.__expiresAt && parsed.__expiresAt < Date.now()) {
        this.destroy(sid);
        return null;
      }
      delete parsed.__expiresAt;
      return parsed;
    } catch {
      return null;
    }
  }

  /**
   * Write to a unique temporary file and rename it over the target.
   *
   * A plain writeFile truncates first, so a read that lands mid-write gets a
   * partial file, JSON.parse throws, and `get` hands back null — which
   * express-session treats as "no session" and the member is silently signed
   * out. Two tabs, or a socket alongside a fetch, is enough to hit it. A rename
   * is atomic, so a reader sees either the old session or the new one.
   */
  set(sid, sessionData, callback = () => {}) {
    const expiresAt = sessionData.cookie?.expires
      ? new Date(sessionData.cookie.expires).getTime()
      : Date.now() + this.ttlMs;
    const payload = JSON.stringify({ ...sessionData, __expiresAt: expiresAt });

    this.enqueue(sid, payload, callback);
  }

  /**
   * Queues one operation for a session id: a payload to write, or null to
   * delete. Anything already waiting for that id is superseded — it is an older
   * snapshot of the same session — and its callers are answered by the
   * operation that replaces it.
   */
  enqueue(sid, payload, callback) {
    const waiting = this.queued.get(sid);
    this.queued.set(sid, {
      payload,
      callbacks: waiting ? [...waiting.callbacks, callback] : [callback]
    });
    // Readable from this moment, before it reaches disk.
    this.pending.set(sid, payload);
    if (!this.writing.has(sid)) this.drain(sid);
  }

  drain(sid) {
    const next = this.queued.get(sid);
    if (!next) {
      this.writing.delete(sid);
      // Everything accepted for this id has settled, so disk is now the truth.
      this.pending.delete(sid);
      return;
    }
    this.queued.delete(sid);
    this.writing.add(sid);

    const finish = (err) => {
      for (const fn of next.callbacks) fn(err);
      // The callback is always async (it comes off an fs call), so this
      // recursion cannot grow the stack.
      this.drain(sid);
    };

    if (next.payload === null) {
      fs.unlink(this.fileFor(sid), () => finish(null));
      return;
    }
    this.writeNow(sid, next.payload, finish);
  }

  /** One temp-file write plus a rename. `drain` serialises; this does not. */
  writeNow(sid, payload, callback) {
    const target = this.fileFor(sid);
    const temp = `${target}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    fs.writeFile(temp, payload, 'utf8', (err) => {
      if (err) return callback(err);
      return renameWithRetry(temp, target, (renameErr) => {
        if (renameErr) fs.unlink(temp, () => {});
        callback(renameErr);
      });
    });
  }

  /**
   * Goes through the same queue as a write, so a save still in flight cannot
   * land after the delete and resurrect a signed-out session.
   */
  destroy(sid, callback = () => {}) {
    this.enqueue(sid, null, () => callback(null));
  }

  touch(sid, sessionData, callback = () => {}) {
    this.set(sid, sessionData, callback);
  }

  /** Signs the member out everywhere — used on password change and on ban. */
  destroyForMember(memberId, callback = () => {}) {
    fs.readdir(this.dir, (err, all) => {
      if (err) return callback(err);
      // Only settled sessions — a .tmp is a write in flight, and touching one
      // would break the rename that is about to replace the real file.
      const files = all.filter((f) => f.endsWith('.json'));
      let remaining = files.length;
      if (!remaining) return callback(null, 0);
      let destroyed = 0;
      for (const file of files) {
        const full = path.join(this.dir, file);
        fs.readFile(full, 'utf8', (readErr, data) => {
          if (!readErr) {
            try {
              if (JSON.parse(data).memberId === memberId) {
                fs.unlinkSync(full);
                destroyed += 1;
              }
            } catch { /* skip unreadable session files */ }
          }
          remaining -= 1;
          if (remaining === 0) callback(null, destroyed);
        });
      }
      return undefined;
    });
  }

  sweep() {
    fs.readdir(this.dir, (err, all) => {
      if (err) return;
      for (const file of all) {
        if (!file.endsWith('.json')) continue;
        const full = path.join(this.dir, file);
        fs.readFile(full, 'utf8', (readErr, data) => {
          if (readErr) return;
          try {
            const parsed = JSON.parse(data);
            if (parsed.__expiresAt && parsed.__expiresAt < Date.now()) fs.unlink(full, () => {});
          } catch {
            fs.unlink(full, () => {});
          }
        });
      }
    });
  }
}

module.exports = { FileSessionStore };
