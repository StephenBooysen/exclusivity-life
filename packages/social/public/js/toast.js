/**
 * Transient confirmations. Errors state what happened and what to do; they do
 * not apologise and they are never vague.
 */

let timer = null;

export function toast(message, { bad = false, ms = 2600 } = {}) {
  const node = document.getElementById('toast');
  if (!node) return;
  node.textContent = message;
  node.classList.toggle('toast--bad', bad);
  node.classList.add('show');
  clearTimeout(timer);
  timer = setTimeout(() => node.classList.remove('show'), ms);
}

/** Maps an ApiError to something a member can act on. */
export function toastError(err) {
  const map = {
    allowance_exhausted: "That's all your introductions for today. More at six tomorrow.",
    entitlement_required: 'Your membership does not include that.',
    csrf_failed: 'Your session expired. Refresh and try again.',
    rate_limited_messaging: "You're sending messages very quickly. Give it a moment.",
    already_acted: "You've already decided on this introduction.",
    interview_required: 'This applicant has to pass an interview first.'
  };
  toast(map[err?.code] || err?.message || 'Something went wrong', { bad: true });
}
