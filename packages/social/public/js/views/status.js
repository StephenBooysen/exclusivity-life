/**
 * A4 — where an applicant waits.
 *
 * The review is drawn as a timeline so the applicant can see who has the ball,
 * and the interview step is drawn as a gate rather than a suggestion: approval
 * is refused server-side until it is recorded as passed, and the screen says so
 * in those words. Every other outcome — waitlisted, declined, paused,
 * suspended — states what happened and what can be done next. No state is a
 * dead end.
 */

import { api } from '../api.js';
import { escapeHtml, appointment, fullDate, REASON_LABELS } from '../format.js';
import { toast, toastError } from '../toast.js';
import { getSession, refreshSession, go } from '../router.js';
import { confirmSheet } from '../components/sheet.js';
import { decorate } from '../blueprint.js';

export async function renderStatus(root) {
  const session = getSession();
  const member = session.member;
  const application = session.application;
  const status = member?.status;

  const screens = {
    in_review: () => underReview(application, member, { interview: false }),
    interview: () => underReview(application, member, { interview: true }),
    info_requested: () => plain({
      eyebrow: 'Over to you',
      title: 'We need a little more.',
      body: escapeHtml(application?.decision?.note || 'Open your application and complete the missing part.'),
      action: '<button class="btn btn--primary btn--block" data-edit type="button">Open my application</button>'
    }),
    waitlisted: () => plain({
      eyebrow: 'Waitlist',
      title: application?.decision?.reasonCode === 'outside_launch_city'
        ? "We're not in your city yet."
        : "You're on the list.",
      body: application?.decision?.reasonCode === 'outside_launch_city'
        ? 'Exclusivity is open in Johannesburg only for now. You are on the list, and we write to you the moment we open where you are.'
        : 'The two sides of the club are kept in balance, which means not everyone can be taken at once. We are in touch as soon as a place opens.'
    }),
    declined: () => declined(application),
    suspended: () => plain({
      eyebrow: 'Suspended',
      title: 'Your account is on hold.',
      body: member?.suspendedUntil
        ? `It reopens on ${escapeHtml(fullDate(member.suspendedUntil))}.`
        : 'Our safety team is reviewing your account.'
    }),
    paused: () => plain({
      eyebrow: 'Paused',
      title: "You're hidden right now.",
      body: 'No one can see you and you receive no introductions. Your conversations are untouched.',
      action: '<button class="btn btn--primary btn--block" data-resume type="button">Come back</button>'
    })
  };

  root.innerHTML = (screens[status] || screens.in_review)();
  decorate(root);
  wire(root);
}

/* ---------- A4 ---------- */

function underReview(application, member, { interview }) {
  const submitted = application?.submittedAt;
  const scheduled = application?.interview?.scheduledFor;
  const reference = application?.id ? application.id.slice(0, 4).toUpperCase() : null;

  return `
    <section class="screen">
      <div class="pad" style="padding-top:44px">
        <div class="eyebrow" style="color:var(--accent);letter-spacing:.2em">
          ${reference ? `Application ${escapeHtml(reference)}` : 'Application'}
        </div>
        <h1 class="h-xl" style="margin-top:14px">Under review</h1>
        <p class="lede" style="margin-top:10px">
          ${submitted ? `Submitted ${escapeHtml(shortStamp(submitted))}. Decision expected by ${escapeHtml(shortDate(dueBy(submitted)))}.`
    : 'With a reviewer now. A decision follows inside 48 hours.'}
        </p>
      </div>

      <div class="pad" style="padding-top:38px">
        <div class="timeline">
          ${step({
    title: 'Submitted',
    meta: submitted ? shortStamp(submitted) : 'Received',
    mark: 'done'
  })}
          ${step({
    title: 'Pre-screen cleared',
    meta: application?.prescreenFlags?.length
      ? `${application.prescreenFlags.length} note${application.prescreenFlags.length === 1 ? '' : 's'} for the reviewer`
      : 'Automatic · no flags',
    mark: 'done'
  })}
          ${interview ? step({
    title: 'Introductory call',
    meta: scheduled
      ? `${escapeHtml(appointment(scheduled))} · 20 minutes`
      : 'We write to you shortly to arrange a time',
    mark: 'open',
    state: 'now',
    // The gate, stated plainly. The API refuses approval with 409
    // interview_required until this is recorded as passed — the copy
    // matches the rule rather than softening it.
    body: `
            <div class="blueprint" style="margin-top:12px;padding:13px 14px">
              <p style="font-size:12.5px;line-height:1.55;color:var(--t62);margin:0">
                Approval is not possible until this call is recorded as passed. It is how standing
                is established — there are no documents to send.
              </p>
              ${scheduled ? `
                <div class="btn-row" style="margin-top:12px">
                  <button class="btn btn--secondary" style="height:40px;font-size:13px" data-reschedule type="button">Reschedule</button>
                  <a class="btn btn--primary" style="height:40px;font-size:13px" href="${calendarLink(application, member)}" download="exclusivity-call.ics">Add to calendar</a>
                </div>` : ''}
            </div>`
  }) : ''}
          ${step({ title: 'Decision', meta: 'By email and in app', mark: 'todo', state: 'todo', last: true })}
        </div>
      </div>

      <div class="screen__foot" style="display:flex;justify-content:space-between;font-size:12px">
        <button class="link" data-withdraw type="button">Withdraw application</button>
        <button class="link" data-safety type="button">Safety Centre</button>
      </div>
    </section>`;
}

function step({ title, meta, mark = 'done', state = '', body = '', last = false }) {
  const titleClass = state === 'now' ? ' timeline__title--now' : state === 'todo' ? ' timeline__title--todo' : '';
  return `<div class="timeline__step">
    <div class="timeline__rail">
      <span class="timeline__mark${mark === 'open' ? ' timeline__mark--open' : mark === 'todo' ? ' timeline__mark--todo' : ''}"></span>
      ${last ? '' : '<span class="timeline__line"></span>'}
    </div>
    <div class="timeline__body"${last ? ' style="padding-bottom:0"' : ''}>
      <div class="timeline__title${titleClass}">${escapeHtml(title)}</div>
      <div class="timeline__meta">${meta}</div>
      ${body}
    </div>
  </div>`;
}

/* ---------- other outcomes ---------- */

function plain({ eyebrow, title, body, action = '' }) {
  return `
    <section class="screen">
      <div class="pad" style="padding-top:52px">
        <div class="eyebrow">${escapeHtml(eyebrow)}</div>
        <h1 class="h-xl" style="margin-top:14px">${escapeHtml(title)}</h1>
        <p class="lede" style="margin-top:12px;max-width:36ch">${body}</p>
      </div>
      <div class="screen__foot">
        ${action}
        <button class="btn btn--quiet btn--full" style="margin-top:10px" data-signout type="button">Sign out</button>
      </div>
    </section>`;
}

/**
 * The decline screen. A reason category and the appeal path — never the
 * reviewer's identity, and never an internal flag.
 */
function declined(application) {
  const reason = REASON_LABELS[application?.decision?.reasonCode] || 'our review';
  const eligible = canAppeal(application);

  return `
    <section class="screen">
      <div class="pad" style="padding-top:52px">
        <div class="eyebrow">Decision</div>
        <h1 class="h-xl" style="margin-top:14px">We can't offer you a place.</h1>
        <div class="grid-list" style="margin-top:22px">
          <div class="grid-row">
            <div class="grid-row__body">
              <div class="grid-row__title">Reason</div>
              <div class="grid-row__note">${escapeHtml(reason)}</div>
            </div>
          </div>
          ${application?.decision?.note ? `
            <div class="grid-row">
              <div class="grid-row__body">
                <div class="grid-row__title">From the reviewer</div>
                <div class="grid-row__note">${escapeHtml(application.decision.note)}</div>
              </div>
            </div>` : ''}
          <div class="grid-row">
            <div class="grid-row__body">
              <div class="grid-row__title">Apply again</div>
              <div class="grid-row__note">${eligible
    ? 'You can start a fresh application now.'
    : `From ${escapeHtml(appealDate(application))}.`}</div>
            </div>
          </div>
        </div>
      </div>
      <div class="screen__foot">
        ${eligible ? '<button class="btn btn--primary btn--block" data-appeal type="button">Apply again</button>' : ''}
        <button class="btn btn--quiet btn--full" style="margin-top:10px" data-signout type="button">Sign out</button>
      </div>
    </section>`;
}

/* ---------- wiring ---------- */

function wire(root) {
  root.querySelector('[data-edit]')?.addEventListener('click', () => go('apply'));

  root.querySelector('[data-safety]')?.addEventListener('click', async () => {
    const { openSafetyGuide } = await import('./settings.js');
    openSafetyGuide();
  });

  root.querySelector('[data-reschedule]')?.addEventListener('click', () => {
    toast('We will email you to move the call');
  });

  root.querySelector('[data-withdraw]')?.addEventListener('click', async () => {
    const ok = await confirmSheet({
      title: 'Withdraw your application?',
      body: 'The submission and every photograph you uploaded are deleted. This cannot be undone.',
      confirmLabel: 'Withdraw it',
      danger: true
    });
    if (!ok) return;
    try {
      await api.application.withdraw();
      await refreshSession();
      location.hash = '#/gate';
      location.reload();
    } catch (err) { toastError(err); }
  });

  root.querySelector('[data-appeal]')?.addEventListener('click', async () => {
    const ok = await confirmSheet({
      title: 'Apply again?',
      body: 'This starts a fresh application linked to your first one. You get one of these.',
      confirmLabel: 'Start a new application'
    });
    if (!ok) return;
    try {
      await api.application.appeal();
      await refreshSession();
      go('apply');
    } catch (err) { toastError(err); }
  });

  root.querySelector('[data-resume]')?.addEventListener('click', async () => {
    try {
      await api.settings.resume();
      await refreshSession();
      toast('Welcome back');
      location.reload();
    } catch (err) { toastError(err); }
  });

  root.querySelector('[data-signout]')?.addEventListener('click', async () => {
    await api.auth.logout();
    location.hash = '#/gate';
    location.reload();
  });
}

/* ---------- dates ---------- */

function dueBy(submittedAt) {
  return new Date(new Date(submittedAt).getTime() + 48 * 3600 * 1000).toISOString();
}

/** 21/08 · 21:19 — the form the design writes stamps in. */
function shortStamp(iso) {
  const date = new Date(iso);
  return `${shortDate(iso)} · ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function shortDate(iso) {
  const date = new Date(iso);
  return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/** A local .ics rather than a third-party calendar hand-off. */
function calendarLink(application, member) {
  const start = new Date(application?.interview?.scheduledFor || Date.now());
  const end = new Date(start.getTime() + 20 * 60000);
  const stamp = (d) => `${d.toISOString().replace(/[-:]/g, '').split('.')[0]}Z`;
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Exclusivity//Interview//EN', 'BEGIN:VEVENT',
    `UID:exclusivity-${application?.id || 'interview'}`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(end)}`,
    'SUMMARY:Exclusivity introductory call',
    `DESCRIPTION:A twenty-minute call with the Exclusivity team${member?.displayName ? ` for ${member.displayName}` : ''}. Nothing to prepare and no documents to send.`,
    'END:VEVENT', 'END:VCALENDAR'
  ].join('\r\n');
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}`;
}

function canAppeal(application) {
  if (!application?.decision?.decidedAt) return false;
  const days = (Date.now() - new Date(application.decision.decidedAt)) / 864e5;
  return days >= 30;
}

function appealDate(application) {
  if (!application?.decision?.decidedAt) return 'thirty days from the decision';
  return fullDate(new Date(new Date(application.decision.decidedAt).getTime() + 30 * 864e5).toISOString());
}
