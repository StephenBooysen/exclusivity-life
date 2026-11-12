/** Goals — annual → monthly → weekly, filtered by a segmented control. */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const state = { tier: 'annual', goals: [], areas: [], expanded: null, notes: {} };

  function areaName(id) {
    const a = state.areas.find((x) => x.id === id);
    return a ? a.name : '';
  }

  function parentTitle(goal) {
    if (!goal.parent_id) return null;
    const p = state.goals.find((g) => g.id === goal.parent_id);
    return p ? p.title : null;
  }

  function formatDate(value) {
    if (!value) return 'no date';
    const d = new Date(value);
    if (isNaN(d)) return value;
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }

  function detailHtml(goal) {
    const notes = state.notes[goal.id];
    let html = '<div class="am-goal-detail">';
    html += '<div class="am-goal-criteria"><span class="text-muted">Success criteria — </span>' +
            AM.esc(goal.success_criteria || 'not set') + '</div>';

    if (notes === undefined) {
      html += '<div class="text-muted" style="font-size:12px">Loading notes…</div>';
    } else if (notes.worked.length || notes.didnt_work.length) {
      html += '<div class="am-goal-notes">' +
        '<div><div class="am-note-label worked">What worked</div><p>' +
          AM.esc(notes.worked.map((n) => n.content).join(' ')) + '</p></div>' +
        '<div><div class="am-note-label didnt">What didn\'t</div><p>' +
          AM.esc(notes.didnt_work.map((n) => n.content).join(' ')) + '</p></div>' +
      '</div>';
    }
    html += '</div>';
    return html;
  }

  function render() {
    const host = $('goal-list');
    const list = state.goals.filter((g) => g.type === state.tier);
    $('goal-new-label').textContent = 'New ' + state.tier + ' goal';

    if (!list.length) {
      host.innerHTML = '<div class="am-empty">No ' + state.tier + ' goals yet.</div>';
      return;
    }

    host.innerHTML = list.map((g) => {
      const pct = Math.round(g.progress || 0);
      const parent = parentTitle(g);
      const expanded = String(state.expanded) === String(g.id);
      return '<div class="card elev-sm" data-goal="' + g.id + '" role="button" tabindex="0"' +
             ' aria-expanded="' + expanded + '" style="cursor:pointer">' +
        (parent ? '<div class="am-goal-parent">↳ ' + AM.esc(parent) + '</div>' : '') +
        '<div class="am-goal-head">' +
          '<div class="card-title">' + AM.esc(g.title) + '</div>' +
          '<span class="tag ' + AM.priorityTag(g.priority) + '" style="flex:none;height:fit-content">' +
            AM.esc(g.priority || 'medium') + '</span>' +
        '</div>' +
        '<div class="am-bar"><div style="width:' + pct + '%"></div></div>' +
        '<div class="card-meta"><span>' + pct + '% complete</span><span>·</span>' +
          '<span>Due ' + AM.esc(formatDate(g.target_date)) + '</span>' +
          (areaName(g.focus_area_id) ? '<span>·</span><span>' + AM.esc(areaName(g.focus_area_id)) + '</span>' : '') +
        '</div>' +
        (expanded ? detailHtml(g) : '') +
      '</div>';
    }).join('');
  }

  async function toggleExpand(id) {
    state.expanded = String(state.expanded) === String(id) ? null : id;
    render();
    if (state.expanded !== null && state.notes[id] === undefined) {
      try {
        state.notes[id] = await AM.get('/goals/' + id + '/notes');
      } catch (e) {
        state.notes[id] = { general: [], worked: [], didnt_work: [] };
      }
      if (String(state.expanded) === String(id)) render();
    }
  }

  document.addEventListener('click', (e) => {
    const card = e.target.closest('[data-goal]');
    if (card) toggleExpand(card.getAttribute('data-goal'));
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const card = e.target.closest && e.target.closest('[data-goal]');
    if (card) { e.preventDefault(); toggleExpand(card.getAttribute('data-goal')); }
  });

  document.querySelectorAll('input[name="tier"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      state.tier = radio.value;
      state.expanded = null;
      render();
    });
  });

  /* — new goal — */
  const modal = $('goal-modal');
  function openModal() { modal.classList.remove('hidden'); $('goal-title').focus(); }
  function closeModal() { modal.classList.add('hidden'); $('goal-form').reset(); }

  $('goal-new').addEventListener('click', () => {
    $('goal-modal-title').textContent = 'New ' + state.tier + ' goal';
    openModal();
  });
  $('goal-modal-close').addEventListener('click', closeModal);
  $('goal-cancel').addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

  $('goal-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const now = new Date();
    const payload = {
      type: state.tier,
      title: $('goal-title').value.trim(),
      success_criteria: $('goal-criteria').value.trim(),
      priority: $('goal-priority').value,
      focus_area_id: $('goal-area').value || null,
      target_date: $('goal-target').value || null,
      target_year: now.getFullYear(),
      progress: 0
    };
    if (state.tier === 'monthly' || state.tier === 'weekly') payload.target_month = now.getMonth() + 1;
    try {
      await AM.post('/goals', payload);
      closeModal();
      await load();
    } catch (err) {
      alert('Could not save the goal.');
    }
  });

  async function load() {
    try {
      const [goals, areas] = await Promise.all([AM.get('/goals'), AM.get('/focus-areas')]);
      state.goals = goals;
      state.areas = areas;
      $('goal-area').innerHTML = '<option value="">None</option>' +
        areas.map((a) => '<option value="' + a.id + '">' + AM.esc(a.name) + '</option>').join('');
      render();
    } catch (err) {
      console.error('Goals load failed', err);
      $('goal-list').innerHTML = '<div class="am-empty">Could not load your goals.</div>';
    }
  }

  document.addEventListener('DOMContentLoaded', load);
})();
