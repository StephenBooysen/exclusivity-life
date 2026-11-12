/**
 * Realtime client.
 *
 * REST stays the source of truth: the client posts a message and treats the
 * socket echo as delivery confirmation, so a dropped socket degrades to a
 * refresh rather than to lost messages.
 *
 * socket.io's browser bundle is not vendored (no build step, and the CSP
 * allows scripts from self only), so this speaks the engine.io websocket
 * protocol directly — it is a small, stable framing.
 */

const handlers = new Map();
let socket = null;
let reconnectTimer = null;
let backoff = 1000;

export function on(event, handler) {
  if (!handlers.has(event)) handlers.set(event, []);
  handlers.get(event).push(handler);
  return () => {
    const list = handlers.get(event) || [];
    const idx = list.indexOf(handler);
    if (idx >= 0) list.splice(idx, 1);
  };
}

function emitLocal(event, payload) {
  (handlers.get(event) || []).forEach((fn) => {
    try { fn(payload); } catch (err) { console.error('[rt]', event, err); }
  });
}

export function emit(event, ...args) {
  if (socket?.readyState !== WebSocket.OPEN) return false;
  socket.send(`42${JSON.stringify([event, ...args])}`);
  return true;
}

export function connect() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;

  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  socket = new WebSocket(`${scheme}://${location.host}/rt/?EIO=4&transport=websocket`);

  socket.addEventListener('open', () => { backoff = 1000; });

  socket.addEventListener('message', (event) => {
    const raw = String(event.data);

    // engine.io: 0 open, 2 ping, 3 pong, 4 message. socket.io: 0 connect, 2 event.
    if (raw[0] === '0') {
      socket.send('40');
      return;
    }
    if (raw[0] === '2') {
      socket.send('3');
      return;
    }
    if (raw.startsWith('40')) {
      emitLocal('connected');
      return;
    }
    if (raw.startsWith('42')) {
      try {
        const [name, payload] = JSON.parse(raw.slice(2));
        emitLocal(name, payload);
      } catch { /* a frame we do not model is not worth a crash */ }
    }
  });

  socket.addEventListener('close', () => {
    emitLocal('disconnected');
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, backoff);
    backoff = Math.min(backoff * 2, 20000);
  });

  socket.addEventListener('error', () => socket.close());
}

export function disconnect() {
  clearTimeout(reconnectTimer);
  socket?.close();
  socket = null;
}
