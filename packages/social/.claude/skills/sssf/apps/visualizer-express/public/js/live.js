/**
 * The live-update mechanism shared by both pages.
 *
 * The server owns every pixel: an island never builds markup, it fetches the
 * same EJS fragment the page was rendered from and swaps it in. That is what
 * keeps one copy of the templates instead of a server version and a client
 * version that drift.
 *
 * Two things make swapping innerHTML safe here:
 *
 *   1. Interactive state lives in the DOM, not in JS. Collapsibles are
 *      <details>, the rendered/raw switch is a radio pair. Both are captured
 *      before a swap and re-applied after, keyed by a stable data-key.
 *   2. An unchanged fragment is not swapped at all, so a finished run never
 *      touches the DOM and text selection survives.
 */

/** Snapshot the DOM-held UI state under `root`. */
function captureState(root) {
  const open = new Set();
  for (const el of root.querySelectorAll("details[data-key]")) {
    if (el.open) open.add(el.dataset.key);
  }
  const checked = new Set();
  for (const el of root.querySelectorAll("input[type=radio]:checked")) {
    if (el.id) checked.add(el.id);
  }
  const scroll = new Map();
  for (const el of root.querySelectorAll("[data-key]")) {
    if (el.scrollTop) scroll.set(el.dataset.key, el.scrollTop);
  }
  return { open, checked, scroll, pageY: window.scrollY };
}

/** Re-apply a snapshot after the fragment has been replaced. */
function restoreState(root, snap) {
  for (const el of root.querySelectorAll("details[data-key]")) {
    el.open = snap.open.has(el.dataset.key);
  }
  for (const id of snap.checked) {
    const el = root.querySelector(`#${CSS.escape(id)}`);
    if (el) el.checked = true;
  }
  for (const el of root.querySelectorAll("[data-key]")) {
    const top = snap.scroll.get(el.dataset.key);
    if (top) el.scrollTop = top;
  }
  window.scrollTo({ top: snap.pageY });
}

/** The topbar dot: pulsing when polling, grey when stopped, red when the api is gone. */
function setLive(mode) {
  const hint = document.querySelector("#live-hint");
  if (!hint) return;
  hint.classList.toggle("idle", mode === "idle");
  hint.classList.toggle("offline", mode === "offline");
  const text = hint.querySelector(".live-text");
  if (text) text.textContent = mode === "offline" ? "offline" : mode === "idle" ? "idle" : "live";
}

function showError(message) {
  const bar = document.querySelector("#api-error");
  if (!bar) return;
  if (message) {
    bar.textContent = `api unreachable — retrying ${message}`;
    bar.hidden = false;
  } else {
    bar.hidden = true;
  }
}

/**
 * Poll a fragment URL and swap it into `target` whenever it changes.
 *
 * `stopWhen(response)` gets each response's headers so a finished run can end
 * its own polling — the same "stop once it is not running" rule the Vue cards
 * used, just decided by the server that already knows the status.
 */
export function pollFragment({ url, target, intervalMs = 500, stopWhen }) {
  let last = target.innerHTML;
  let inflight = false;
  let timer;

  const stop = (mode = "idle") => {
    clearInterval(timer);
    timer = undefined;
    setLive(mode);
  };

  async function tick() {
    if (inflight) return;
    inflight = true;
    try {
      const res = await fetch(url(), { headers: { "x-fragment": "1" } });
      if (!res.ok) throw new Error(`${res.status}`);
      const html = await res.text();
      if (html !== last) {
        const snap = captureState(target);
        target.innerHTML = html;
        restoreState(target, snap);
        last = html;
      }
      showError(null);
      setLive("live");
      if (stopWhen?.(res)) stop("idle");
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err));
      setLive("offline");
    } finally {
      inflight = false;
    }
  }

  timer = setInterval(tick, intervalMs);
  // Pause while the tab is hidden — a backgrounded trace has no reader.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      clearInterval(timer);
      timer = undefined;
    } else if (!timer) {
      timer = setInterval(tick, intervalMs);
      void tick();
    }
  });

  return { tick, stop };
}
