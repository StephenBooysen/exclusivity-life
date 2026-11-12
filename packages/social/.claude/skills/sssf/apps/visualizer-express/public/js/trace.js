/**
 * L2 island: keep one run's waterfall and phase panel live.
 *
 * Polling stops once the run is no longer `running` — the server reports the
 * status on each fragment response, so the client never has to parse the
 * markup to work out whether there is anything left to watch.
 */

import { pollFragment } from "./live.js";

const trace = document.querySelector(".trace");
const body = document.querySelector("#trace-body");
const { adwId, phaseId } = trace.dataset;

pollFragment({
  url: () => {
    const qs = phaseId ? `?phase=${encodeURIComponent(phaseId)}` : "";
    return `/fragments/trace/${encodeURIComponent(adwId)}${qs}`;
  },
  target: body,
  stopWhen: (res) => res.headers.get("x-session-status") !== "running",
});
