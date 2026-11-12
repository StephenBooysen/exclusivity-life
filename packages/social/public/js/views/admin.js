/**
 * The console: review queue, moderation, members, operations.
 *
 * Built for throughput. A reviewer sees everything on one screen, decides with
 * a reason code, and moves on — the SLA clock is visible on every row.
 */

import { api } from '../api.js';
import { escapeHtml, dateTime, timeAgo, words, REASON_LABELS, money } from '../format.js';
import { toast, toastError } from '../toast.js';
import { badgeChips } from '../badges.js';
import { openSheet, closeSheet, confirmSheet } from '../components/sheet.js';
import { decorate } from '../blueprint.js';

const TABS = [
  ['review', 'Review'],
  ['moderation', 'Moderation'],
  ['members', 'Members'],
  ['ops', 'Operations']
];

let tab = 'review';

export async function renderAdmin(root) {
  root.innerHTML = `
    <section class="screen">
      <div class="pad" style="padding-top:18px">
        <div class="eyebrow" style="color:var(--accent);letter-spacing:.2em">Console</div>
        <h1 style="font-size:28px;margin-top:10px">Exclusivity</h1>
      </div>
      <div class="pad" style="margin-top:18px">
        <div class="admin-tabs">
          ${TABS.map(([key, label]) => `
            <button class="admin-tab ${tab === key ? 'active' : ''}" data-tab="${key}" type="button">${label}</button>
          `).join('')}
        </div>
      </div>
      <div class="pad" id="admin-body" style="padding-bottom:30px">
        <div class="skeleton" style="height:180px;margin:0"></div>
      </div>
    </section>`;

  root.querySelectorAll('[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      tab = btn.dataset.tab;
      renderAdmin(root);
    });
  });

  const body = root.querySelector('#admin-body');
  const panels = { review: reviewPanel, moderation: moderationPanel, members: membersPanel, ops: opsPanel };
  await panels[tab](body, root);
  decorate(root);
}

/* ---------- review ---------- */

async function reviewPanel(body, root) {
  const data = await api.admin.queue({ state: 'open' });

  body.innerHTML = `
    <div class="section-head">
      <span class="eyebrow" style="margin:0">Waiting on a decision</span>
      <span class="meta">${data.total}</span>
    </div>
    ${data.queue.length
    ? data.queue.map(queueRow).join('')
    : '<div class="empty"><h2>Queue is clear</h2><p>Every application has been decided.</p></div>'}`;

  body.querySelectorAll('.queue-row').forEach((node) => {
    node.addEventListener('click', () => openApplication(node.dataset.id, root));
  });
}

function queueRow(item) {
  const hours = item.hoursRemaining;
  const slaClass = hours === null ? '' : hours < 0 ? 'queue-row__sla--late' : hours < 6 ? 'queue-row__sla--soon' : '';
  const slaText = hours === null ? '' : hours < 0 ? `${Math.abs(Math.round(hours))}h over` : `${Math.round(hours)}h left`;

  return `
    <button class="queue-row" data-id="${escapeHtml(item.id)}">
      <span class="queue-row__top">
        <span class="queue-row__name">
          ${escapeHtml(item.member?.displayName || item.member?.email || 'Applicant')}
          <span class="dim" style="font-weight:400"> · ${item.side === 'male' ? 'man' : 'woman'}</span>
        </span>
        <span class="queue-row__sla ${slaClass}">${escapeHtml(slaText)}</span>
      </span>
      <span class="queue-row__meta">
        ${escapeHtml(item.member?.city || '—')} ·
        ${escapeHtml(stateLabel(item.state))}
        ${item.interview?.outcome ? ` · interview ${escapeHtml(item.interview.outcome.replace('_', ' '))}` : ''}
      </span>
      ${item.flags?.length ? `<span class="flags">${item.flags.map((f) => `<span class="flag">${escapeHtml(f.replace(/_/g, ' '))}</span>`).join('')}</span>` : ''}
    </button>`;
}

function stateLabel(state) {
  return {
    submitted: 'new',
    in_review: 'being read',
    interview_scheduled: 'interview booked',
    interview_completed: 'interview done',
    info_requested: 'waiting on them'
  }[state] || state;
}

async function openApplication(id, root) {
  const detail = await api.admin.application(id);
  const { application, member, profile, photos, liveness, interviewRequired } = detail;
  const interviewPassed = application.interview?.outcome === 'passed';

  openSheet(`
    <h2>${escapeHtml(profile?.firstName || member.email)}</h2>
    <p class="meta" style="margin-top:5px">
      ${escapeHtml(member.email)} · ${application.side === 'male' ? 'man' : 'woman'} · ${escapeHtml(member.city || '—')}
    </p>

    ${application.prescreenFlags?.length ? `
      <div class="flags" style="margin-top:12px">
        ${application.prescreenFlags.map((f) => `<span class="flag">${escapeHtml(f.replace(/_/g, ' '))}</span>`).join('')}
      </div>` : ''}

    <hr class="rule" style="margin:18px 0" />

    <span class="eyebrow">Photographs against the live capture</span>
    <div class="review-photos">
      ${liveness ? `<figure>
        <img src="${api.admin.livenessUrl(id)}" alt="Verification capture" />
        <figcaption>Live capture</figcaption>
      </figure>` : '<p class="muted">No capture on file.</p>'}
      ${photos.map((p, i) => `<figure>
        <img src="/api/photos/${p.id}/card" alt="Photograph ${i + 1}" />
        <figcaption>${p.isPrimary ? 'Main' : `No. ${i + 1}`}</figcaption>
      </figure>`).join('')}
    </div>

    <hr class="rule" style="margin:18px 0" />

    <span class="eyebrow">What they wrote</span>
    <dl class="facts">
      <div><dt>Work</dt><dd>${escapeHtml(profile?.occupation || '—')}</dd></div>
      <div><dt>Where</dt><dd>${escapeHtml(profile?.employer || '—')}</dd></div>
      <div><dt>Age</dt><dd>${escapeHtml(profile?.age ?? '—')}</dd></div>
      <div><dt>Looking for</dt><dd>${escapeHtml(profile?.intent ? words(profile.intent) : '—')}</dd></div>
      ${application.means?.incomeBand ? `<div><dt>Income</dt><dd>${escapeHtml(words(application.means.incomeBand))}</dd></div>` : ''}
      <div><dt>Complete</dt><dd>${escapeHtml(profile?.completeness ?? 0)}%</dd></div>
    </dl>
    ${profile?.bio ? `<p style="margin-top:14px;font-size:14px;line-height:1.55">${escapeHtml(profile.bio)}</p>` : ''}

    ${interviewRequired ? `
      <hr class="rule" style="margin:18px 0" />
      <span class="eyebrow">Interview</span>
      ${application.interview ? `
        <div class="notice ${interviewPassed ? '' : ''}">
          <strong>${application.interview.outcome
    ? `Outcome: ${escapeHtml(application.interview.outcome.replace('_', ' '))}`
    : `Booked for ${escapeHtml(dateTime(application.interview.scheduledFor))}`}</strong>
          ${escapeHtml(application.interview.notes || application.interview.note || 'Standing is established here — no financial documents are collected.')}
        </div>
        ${!application.interview.outcome ? `
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:9px">
            <button class="btn btn--primary" data-outcome="passed">Passed</button>
            <button class="btn btn--danger" data-outcome="not_passed">Not passed</button>
          </div>
          <button class="btn btn--quiet btn--full btn--sm" style="margin-top:8px" data-outcome="no_show">No show</button>` : ''}
      ` : `
        <p class="muted" style="font-size:13.5px;margin-bottom:12px">
          This applicant must pass an interview before they can be approved.
        </p>
        <div class="field">
          <label for="iv-when">When</label>
          <input id="iv-when" type="datetime-local" />
        </div>
        <button class="btn btn--primary btn--full" data-schedule>Book the call</button>`}
    ` : ''}

    <hr class="rule" style="margin:18px 0" />

    <span class="eyebrow">Decision</span>
    ${interviewRequired && !interviewPassed
    ? '<p class="muted" style="font-size:13px;margin-bottom:12px">Approval unlocks once the interview is passed.</p>'
    : ''}
    <div class="field">
      <label for="d-reason">Reason</label>
      <select id="d-reason">
        ${Object.entries(REASON_LABELS).map(([code, label]) => `<option value="${code}">${escapeHtml(label)}</option>`).join('')}
      </select>
    </div>
    <div class="field">
      <label for="d-note">Note (optional)</label>
      <textarea id="d-note" rows="2"></textarea>
    </div>
    <div style="display:grid;gap:9px">
      <button class="btn btn--primary btn--full" data-decide="approve"
        ${interviewRequired && !interviewPassed ? 'disabled' : ''}>Approve</button>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:9px">
        <button class="btn" data-decide="waitlist">Waitlist</button>
        <button class="btn" data-decide="request_info">Ask for more</button>
      </div>
      <button class="btn btn--danger btn--full" data-decide="decline">Decline</button>
      <button class="btn btn--quiet btn--full" data-close>Close</button>
    </div>`, {
    onMount(sheet) {
      sheet.querySelector('[data-schedule]')?.addEventListener('click', async () => {
        const when = sheet.querySelector('#iv-when').value;
        if (!when) return toast('Pick a time', { bad: true });
        try {
          await api.admin.scheduleInterview(id, { scheduledFor: new Date(when).toISOString() });
          closeSheet();
          toast('Interview booked and the applicant emailed');
          renderAdmin(root);
        } catch (err) { toastError(err); }
        return undefined;
      });

      sheet.querySelectorAll('[data-outcome]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          try {
            await api.admin.recordInterview(id, { outcome: btn.dataset.outcome });
            closeSheet();
            toast('Interview recorded');
            openApplication(id, root);
          } catch (err) { toastError(err); }
        });
      });

      sheet.querySelectorAll('[data-decide]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const outcome = btn.dataset.decide;
          const reasonCode = sheet.querySelector('#d-reason').value;
          const note = sheet.querySelector('#d-note').value;
          try {
            await api.admin.decide(id, { outcome, reasonCode, note });
            closeSheet();
            toast(`${escapeHtml(profile?.firstName || 'Applicant')} — ${outcome.replace('_', ' ')}d`);
            renderAdmin(root);
          } catch (err) { toastError(err); }
        });
      });
    }
  });
}

/* ---------- moderation ---------- */

async function moderationPanel(body, root) {
  const [queue, edits] = await Promise.all([api.admin.moderationQueue(), api.admin.profileEdits()]);

  body.innerHTML = `
    <div class="stat-grid" style="margin-bottom:22px">
      ${stat(queue.depth.reports, 'Open reports', queue.depth.reports > 0)}
      ${stat(queue.depth.photos, 'Photos waiting')}
      ${stat(edits.length, 'Text edits')}
      ${stat(queue.depth.oldestReportAt ? timeAgo(queue.depth.oldestReportAt) : '—', 'Oldest report')}
    </div>

    <div class="section-head"><span class="eyebrow" style="margin:0">Reports</span></div>
    ${queue.reports.length ? queue.reports.map((r) => `
      <button class="queue-row" data-report="${escapeHtml(r.id)}">
        <span class="queue-row__top">
          <span class="queue-row__name">${escapeHtml(words(r.category))}</span>
          <span class="queue-row__sla ${r.ageHours > 4 ? 'queue-row__sla--soon' : ''}">${escapeHtml(timeAgo(r.createdAt))}</span>
        </span>
        <span class="queue-row__meta">
          against ${escapeHtml(r.target?.displayName || r.target?.email || 'member')}
          ${r.reporterId ? '' : ' · raised automatically'}
        </span>
      </button>`).join('') : '<p class="hint">Nothing open.</p>'}

    <hr class="rule" />
    <div class="section-head"><span class="eyebrow" style="margin:0">Photographs</span></div>
    ${queue.photos.length ? `
      <div class="review-photos">
        ${queue.photos.map((p) => `<figure>
          <img src="/api/photos/${p.id}/card" alt="" />
          <figcaption>${escapeHtml(p.owner?.displayName || '—')}</figcaption>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;margin-top:5px">
            <button class="btn btn--sm" data-photo-ok="${escapeHtml(p.id)}">Pass</button>
            <button class="btn btn--sm btn--danger" data-photo-no="${escapeHtml(p.id)}">Reject</button>
          </div>
        </figure>`).join('')}
      </div>` : '<p class="hint">Nothing waiting.</p>'}

    ${edits.length ? `
      <hr class="rule" />
      <div class="section-head"><span class="eyebrow" style="margin:0">Text edits</span></div>
      ${edits.map((e) => `
        <div class="blueprint" style="padding:16px;margin-bottom:14px">
          <strong style="font-size:14px">${escapeHtml(e.member?.displayName || '—')}</strong>
          <p class="dim" style="font-size:12.5px;margin:8px 0 4px">Now live</p>
          <p style="font-size:13.5px">${escapeHtml(e.live.bio || '—')}</p>
          <p class="dim" style="font-size:12.5px;margin:12px 0 4px">Proposed</p>
          <p style="font-size:13.5px">${escapeHtml(e.pending.bio || '—')}</p>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:14px">
            <button class="btn btn--sm" data-edit-ok="${escapeHtml(e.profileId)}">Publish</button>
            <button class="btn btn--sm btn--danger" data-edit-no="${escapeHtml(e.profileId)}">Reject</button>
          </div>
        </div>`).join('')}` : ''}`;

  body.querySelectorAll('[data-report]').forEach((node) => {
    node.addEventListener('click', () => openReportDetail(node.dataset.report, root));
  });

  const act = async (fn, message) => {
    try { await fn(); toast(message); renderAdmin(root); } catch (err) { toastError(err); }
  };

  body.querySelectorAll('[data-photo-ok]').forEach((b) => b.addEventListener('click', () => act(
    () => api.admin.moderatePhoto(b.dataset.photoOk, 'approve'), 'Photograph published'
  )));
  body.querySelectorAll('[data-photo-no]').forEach((b) => b.addEventListener('click', () => act(
    () => api.admin.moderatePhoto(b.dataset.photoNo, 'reject', 'Did not meet standards'), 'Photograph rejected'
  )));
  body.querySelectorAll('[data-edit-ok]').forEach((b) => b.addEventListener('click', () => act(
    () => api.admin.resolveEdit(b.dataset.editOk, 'approve'), 'Published'
  )));
  body.querySelectorAll('[data-edit-no]').forEach((b) => b.addEventListener('click', () => act(
    () => api.admin.resolveEdit(b.dataset.editNo, 'reject'), 'Rejected'
  )));
}

async function openReportDetail(id, root) {
  const detail = await api.admin.report(id);
  const { report, target, priorActions, messages } = detail;

  openSheet(`
    <h2>${escapeHtml(words(report.category))}</h2>
    <p class="meta" style="margin-top:5px">
      against ${escapeHtml(target?.displayName || target?.email || '—')} · ${escapeHtml(timeAgo(report.createdAt))}
    </p>
    ${report.note ? `<div class="notice" style="margin-top:14px">${escapeHtml(report.note)}</div>` : ''}
    ${priorActions.length ? `<p class="hint">${priorActions.length} previous action(s) against this member.</p>` : ''}

    ${messages?.length ? `
      <hr class="rule" style="margin:16px 0" />
      <span class="eyebrow">Conversation</span>
      <div class="thread" style="max-height:240px;overflow-y:auto">
        ${messages.map((m) => `<div class="bubble ${m.senderId === report.targetId ? 'bubble--them' : 'bubble--me'}">
          ${escapeHtml(m.text)}
          ${m.flags?.length ? `<span class="bubble__time">flagged: ${escapeHtml(m.flags.join(', '))}</span>` : ''}
        </div>`).join('')}
      </div>` : ''}

    <hr class="rule" style="margin:16px 0" />
    <div class="field">
      <label for="m-reason">Reason (recorded against you)</label>
      <input id="m-reason" type="text" placeholder="Why this action" />
    </div>
    <div style="display:grid;gap:9px">
      <button class="btn btn--full" data-act="dismiss">Dismiss — nothing wrong here</button>
      <button class="btn btn--full" data-act="warn">Warn them</button>
      <button class="btn btn--full" data-act="remove_content">Remove their content</button>
      <button class="btn btn--full" data-act="suspend">Suspend for 7 days</button>
      <button class="btn btn--danger btn--full" data-act="ban">Ban permanently</button>
      <button class="btn btn--quiet btn--full" data-close>Close</button>
    </div>`, {
    onMount(sheet) {
      sheet.querySelectorAll('[data-act]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const reason = sheet.querySelector('#m-reason').value.trim();
          if (!reason) return toast('A reason is required', { bad: true });
          const action = btn.dataset.act;
          if (action === 'ban') {
            const ok = await confirmSheet({
              title: 'Ban this member?',
              body: 'Permanent. We record a hash of their email and photographs so they cannot simply sign up again.',
              confirmLabel: 'Ban them',
              danger: true
            });
            if (!ok) return undefined;
          }
          try {
            await api.admin.actOnReport(id, { action, reason, durationDays: 7 });
            closeSheet();
            toast(`Recorded: ${action.replace('_', ' ')}`);
            renderAdmin(root);
          } catch (err) { toastError(err); }
          return undefined;
        });
      });
    }
  });
}

/* ---------- members ---------- */

async function membersPanel(body, root) {
  body.innerHTML = `
    <div class="field">
      <label for="m-search">Find a member</label>
      <input id="m-search" type="text" placeholder="Email or name" />
    </div>
    <div id="m-results"><div class="skeleton" style="height:120px"></div></div>`;

  const results = body.querySelector('#m-results');

  async function search(q) {
    const rows = await api.admin.members(q);
    results.innerHTML = rows.length ? rows.map((m) => `
      <button class="queue-row" data-member="${escapeHtml(m.id)}">
        <span class="queue-row__top">
          <span class="queue-row__name">${escapeHtml(m.displayName || m.email)}</span>
          <span class="queue-row__sla">${escapeHtml(m.status)}</span>
        </span>
        <span class="queue-row__meta">
          ${escapeHtml(m.email)} · ${escapeHtml(m.side || 'staff')}${m.tier ? ` · ${escapeHtml(m.tier)}` : ''}
        </span>
      </button>`).join('') : '<p class="hint">No one matches that.</p>';

    results.querySelectorAll('[data-member]').forEach((node) => {
      node.addEventListener('click', () => openMember(node.dataset.member, root));
    });
  }

  let timer = null;
  body.querySelector('#m-search').addEventListener('input', (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => search(e.target.value), 250);
  });

  await search('');
}

async function openMember(id, root) {
  const detail = await api.admin.member(id);
  const { member, profile, subscription, moderationHistory, matchCount, timeline } = detail;

  openSheet(`
    <h2>${escapeHtml(member.displayName || member.email)}</h2>
    <p class="meta" style="margin-top:5px">${escapeHtml(member.email)} · ${escapeHtml(member.status)}</p>
    <div style="margin-top:12px">${badgeChips(member.badges)}</div>

    <dl class="facts">
      <div><dt>Side</dt><dd>${escapeHtml(member.side || 'staff')}</dd></div>
      <div><dt>Tier</dt><dd>${escapeHtml(member.tier || '—')}</dd></div>
      <div><dt>City</dt><dd>${escapeHtml(member.city || '—')}</dd></div>
      <div><dt>Matches</dt><dd>${matchCount}</dd></div>
      <div><dt>Joined</dt><dd>${escapeHtml(dateTime(member.createdAt))}</dd></div>
      ${subscription ? `<div><dt>Billing</dt><dd>${escapeHtml(subscription.state)} · ${escapeHtml(subscription.tier)}</dd></div>` : ''}
    </dl>

    ${moderationHistory.length ? `
      <hr class="rule" style="margin:16px 0" />
      <span class="eyebrow">Moderation history</span>
      ${moderationHistory.map((a) => `<p style="font-size:13px;color:var(--t55)">
        ${escapeHtml(dateTime(a.createdAt))} — <strong style="color:var(--text)">${escapeHtml(a.action)}</strong>: ${escapeHtml(a.reason)}
      </p>`).join('')}` : ''}

    <hr class="rule" style="margin:16px 0" />
    <span class="eyebrow">Audit trail</span>
    <div style="max-height:200px;overflow-y:auto">
      ${timeline.slice(-25).reverse().map((t) => `<p class="meta" style="color:var(--t45);font-size:11px">
        ${escapeHtml(dateTime(t.createdAt))} · ${escapeHtml(t.type)} — ${escapeHtml(t.message)}
      </p>`).join('') || '<p class="hint">Nothing recorded.</p>'}
    </div>

    <hr class="rule" style="margin:16px 0" />
    <div class="field">
      <label for="a-reason">Reason</label>
      <input id="a-reason" type="text" />
    </div>
    <div style="display:grid;gap:9px">
      ${member.status === 'waitlisted' || member.status === 'suspended'
    ? '<button class="btn btn--full" data-act="reinstate">Let them in</button>' : ''}
      <button class="btn btn--full" data-comp>Comp a membership</button>
      <button class="btn btn--full" data-act="suspend">Suspend for 7 days</button>
      <button class="btn btn--danger btn--full" data-act="ban">Ban</button>
      <button class="btn btn--quiet btn--full" data-close>Close</button>
    </div>`, {
    onMount(sheet) {
      sheet.querySelectorAll('[data-act]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const reason = sheet.querySelector('#a-reason').value.trim();
          if (!reason) return toast('A reason is required', { bad: true });
          try {
            await api.admin.actOnMember(id, { action: btn.dataset.act, reason, durationDays: 7 });
            closeSheet();
            toast('Done');
            renderAdmin(root);
          } catch (err) { toastError(err); }
          return undefined;
        });
      });

      sheet.querySelector('[data-comp]')?.addEventListener('click', async () => {
        try {
          await api.admin.comp(id, { tier: 'elite', days: 30 });
          closeSheet();
          toast('Elite comped for 30 days');
          renderAdmin(root);
        } catch (err) { toastError(err); }
      });
    }
  });
}

/* ---------- operations ---------- */

function stat(value, label, alarm = false) {
  return `<div class="stat ${alarm ? 'stat--alarm' : ''}">
    <div class="stat__value">${escapeHtml(value ?? '—')}</div>
    <div class="stat__label">${escapeHtml(label)}</div>
  </div>`;
}

async function opsPanel(body, root) {
  const data = await api.admin.metrics();
  const { funnel, ratios, health, safety } = data;

  body.innerHTML = `
    <div class="notice ${ratios.alarm ? '' : ratios.ratio > 1.6 ? '' : ''}">
      <strong>${escapeHtml(ratios.city)} — ${ratios.ratio ?? '—'} men per woman</strong>
      ${escapeHtml(ratios.recommendation)}
    </div>

    <div class="section-head"><span class="eyebrow" style="margin:0">The club</span></div>
    <div class="stat-grid" style="margin-bottom:22px">
      ${stat(ratios.activeMale, 'Active men')}
      ${stat(ratios.activeFemale, 'Active women')}
      ${stat(health.reviewQueueDepth, 'In the queue', health.reviewQueueDepth > 20)}
      ${stat(health.reviewSlaAtRisk, 'SLA at risk', health.reviewSlaAtRisk > 0)}
    </div>

    <div class="section-head"><span class="eyebrow" style="margin:0">Last 30 days</span></div>
    <div class="stat-grid" style="margin-bottom:22px">
      ${stat(funnel.applicationsSubmitted, 'Applications')}
      ${stat(funnel.approved, 'Approved')}
      ${stat(pct(funnel.approvalRate), 'Approval rate')}
      ${stat(funnel.matchesCreated, 'Matches')}
      ${stat(funnel.subscriptionsStarted, 'Subscriptions')}
      ${stat(funnel.timeToDecisionP95Hours ?? '—', 'Decision p95 (h)', funnel.slaBreached)}
    </div>

    <div class="section-head"><span class="eyebrow" style="margin:0">Safety, last 7 days</span></div>
    <div class="stat-grid" style="margin-bottom:22px">
      ${stat(safety.reports, 'Reports')}
      ${stat(safety.reportsPer1000Active, 'Per 1 000 active', safety.alarm)}
      ${stat(safety.solicitationFlags, 'Solicitation flags', safety.solicitationFlags > 0)}
      ${stat(safety.bans, 'Bans')}
    </div>

    <hr class="rule" />
    <div class="section-head"><span class="eyebrow" style="margin:0">Invitations</span></div>
    <button class="btn btn--sm btn--full" data-invite>Create a Noir invitation</button>
    <div id="invites" style="margin-top:14px"></div>

    <hr class="rule" />
    <div class="section-head"><span class="eyebrow" style="margin:0">Jobs</span></div>
    <div id="jobs"></div>`;

  const invites = await api.admin.invites();
  body.querySelector('#invites').innerHTML = invites.length ? invites.slice(0, 8).map((i) => `
    <div class="switch">
      <span class="switch__label"><span class="meta">${escapeHtml(i.code)}</span><small>${escapeHtml(i.tier)} · ${i.redeemedAt ? 'used' : 'unused'}</small></span>
      <span class="meta">${escapeHtml(timeAgo(i.createdAt))}</span>
    </div>`).join('') : '<p class="hint">None yet.</p>';

  const jobs = await api.admin.jobs();
  body.querySelector('#jobs').innerHTML = jobs.map((j) => `
    <div class="switch">
      <span class="switch__label">${escapeHtml(j.name)}<small>${escapeHtml(j.description || '')}</small></span>
      <button class="btn btn--sm" data-job="${escapeHtml(j.name)}">
        ${j.lastRunAt ? escapeHtml(timeAgo(j.lastRunAt)) : 'Run'}
      </button>
    </div>`).join('');

  body.querySelectorAll('[data-job]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        await api.admin.runJob(btn.dataset.job);
        toast(`${btn.dataset.job} ran`);
        renderAdmin(root);
      } catch (err) { toastError(err); }
    });
  });

  body.querySelector('[data-invite]')?.addEventListener('click', async () => {
    try {
      const invite = await api.admin.createInvite({ tier: 'noir', expiresInDays: 30 });
      toast(`Invitation ${invite.code} created`);
      renderAdmin(root);
    } catch (err) { toastError(err); }
  });
}

function pct(value) {
  return value === null || value === undefined ? '—' : `${Math.round(value * 100)}%`;
}
