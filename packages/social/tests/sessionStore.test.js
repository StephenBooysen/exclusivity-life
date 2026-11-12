'use strict';

/**
 * The session store is the one file in the app whose torn read signs a member
 * out. Everything else that reads a half-written file shows a stale screen; a
 * session that fails to parse is indistinguishable from "not signed in", so the
 * member is bounced to the gate mid-task.
 *
 * express-session issues a write on nearly every request, and a member with two
 * tabs open — or one tab plus its socket — has concurrent reads against those
 * writes as a matter of course. These tests hold the store to the property that
 * makes that safe: a read returns a whole session or nothing, never a fragment.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { FileSessionStore } = require('../backend/services/sessionStore');

function tempStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'exclusivity-sessions-'));
  return { dir, store: new FileSessionStore({ dir }) };
}

const sessionData = (n) => ({
  memberId: `member-${n}`,
  cookie: { expires: new Date(Date.now() + 864e5) },
  // Large enough that a truncating write leaves a visible window.
  filler: 'x'.repeat(8000)
});

const set = (store, sid, data) => new Promise((resolve, reject) => {
  store.set(sid, data, (err) => (err ? reject(err) : resolve()));
});

const get = (store, sid) => new Promise((resolve) => {
  store.get(sid, (err, found) => resolve(found));
});

test('sessions: a read concurrent with writes never sees a fragment', async (t) => {
  const { dir, store } = tempStore();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const sid = 'concurrent-session-id';
  await set(store, sid, sessionData(0));

  // Interleave without awaiting, which is what two tabs against one session do.
  const pending = [];
  for (let i = 1; i <= 300; i += 1) {
    pending.push(set(store, sid, sessionData(i)));
    pending.push(get(store, sid));
  }

  const settled = await Promise.all(pending);
  const reads = settled.filter((value) => value && typeof value === 'object');

  assert.equal(reads.length, 300, 'every read should have returned a session');
  for (const found of reads) {
    assert.ok(found.memberId, 'a read returned a session with no member id');
    assert.equal(found.filler.length, 8000, 'a read returned a truncated session');
  }
});

/**
 * The store has to read its own writes.
 *
 * express-session saves after the response has gone out, so the next request
 * routinely arrives before the write reaches disk. If that request cannot see
 * the session, it starts a fresh one — and for the login POST that means the
 * CSRF token minted by the preceding GET is gone, the double-submit check
 * fails, and the member is told their session expired before they ever had one.
 * This is the test for the sign-in failure that caused.
 */
test('sessions: a read immediately after a write sees that write', async (t) => {
  const { dir, store } = tempStore();

  const writes = [];
  const reads = await Promise.all(Array.from({ length: 40 }, (_, i) => {
    const sid = `sid-${i}`;
    // Deliberately not awaited before the read: express-session does not await
    // its save either. The promise is kept only so teardown can wait for disk.
    writes.push(set(store, sid, {
      csrfToken: `token-${i}`, cookie: { expires: new Date(Date.now() + 864e5) }
    }));
    return get(store, sid);
  }));

  reads.forEach((found, i) => {
    assert.ok(found, `session ${i} was unreadable immediately after being written`);
    assert.equal(found.csrfToken, `token-${i}`);
  });

  await Promise.all(writes);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('sessions: the value survives once the write has settled', async (t) => {
  const { dir, store } = tempStore();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  await set(store, 'settled-id', { csrfToken: 'kept', cookie: { expires: new Date(Date.now() + 864e5) } });
  await new Promise((resolve) => setTimeout(resolve, 50));
  const found = await get(store, 'settled-id');
  assert.equal(found.csrfToken, 'kept', 'the in-memory hand-off must not mask a failed write');
});

test('sessions: a destroy is visible immediately, before it reaches disk', async (t) => {
  const { dir, store } = tempStore();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  await set(store, 'doomed-id', sessionData(1));
  store.destroy('doomed-id');
  assert.equal(await get(store, 'doomed-id'), null, 'a signed-out session must not read back');
});

test('sessions: a settled write is readable in full, and destroy removes it', async (t) => {
  const { dir, store } = tempStore();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  await set(store, 'plain-id', sessionData(7));
  const found = await get(store, 'plain-id');
  assert.equal(found.memberId, 'member-7');
  assert.equal(found.__expiresAt, undefined, 'the expiry marker is internal');

  await new Promise((resolve) => store.destroy('plain-id', resolve));
  assert.equal(await get(store, 'plain-id'), null);
});

test('sessions: writing leaves no temporary files behind', async (t) => {
  const { dir, store } = tempStore();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  await Promise.all(Array.from({ length: 40 }, (_, i) => set(store, `sid-${i}`, sessionData(i))));

  const stray = fs.readdirSync(dir).filter((file) => !file.endsWith('.json'));
  assert.deepEqual(stray, [], 'temporary files should be renamed over the target, not left');
});

test('sessions: an expired session reads as absent and is cleaned up', async (t) => {
  const { dir, store } = tempStore();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  await set(store, 'stale-id', {
    memberId: 'member-9',
    cookie: { expires: new Date(Date.now() - 1000) }
  });

  assert.equal(await get(store, 'stale-id'), null, 'an expired session must not read back');

  // The cleanup the read triggers goes through the same write queue as
  // everything else, so it lands shortly after rather than synchronously.
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(fs.existsSync(path.join(dir, 'stale-id.json')), false, 'and its file should be gone');
});

test('sessions: a session id can never escape the session directory', () => {
  const { dir, store } = tempStore();
  try {
    const file = store.fileFor('../../etc/passwd');
    assert.equal(path.dirname(path.resolve(file)), path.resolve(dir));
    assert.throws(() => store.fileFor('../..'), /Invalid session id/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
