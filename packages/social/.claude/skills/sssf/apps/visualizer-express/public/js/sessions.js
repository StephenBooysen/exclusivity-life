/**
 * L1 island: keep the run list fresh, and handle archive clicks.
 *
 * The list always polls — a new run can appear at any time, so unlike the
 * trace view there is no finished state to stop on.
 */

import { pollFragment } from "./live.js";

const body = document.querySelector("#sessions-body");

const poller = pollFragment({
  url: () => "/fragments/sessions",
  target: body,
});

/**
 * Archiving is optimistic: the poll would take up to half a second to drop the
 * card, and a triage click should feel instant. A failed write re-syncs from
 * the server rather than leaving the card wrongly hidden.
 */
body.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-archive]");
  if (!button) return;
  event.preventDefault();
  event.stopPropagation();

  const adwId = button.dataset.archive;
  const card = button.closest(".card");
  card?.remove();

  try {
    const res = await fetch(
      `/api/sessions/${encodeURIComponent(adwId)}/archive`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ archived: true }),
      },
    );
    if (!res.ok) throw new Error(String(res.status));
  } catch {
    void poller.tick(); // put it back if the write did not land
  }
});
