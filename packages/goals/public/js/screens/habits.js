/** Habits — daily check-off, a 7-day grid, and a 14-day consistency chart. */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  const state = { habits: [], done: new Set(), streaks: {} };

  const key = (habitId, date) => habitId + '|' + date;

  function renderToday() {
    const host = $('habits-today');
    if (!state.habits.length) {
      host.innerHTML = '<div class="am-empty">No habits yet. Add your first one below.</div>';
      return;
    }
    const today = AM.isoDate();
    host.innerHTML = state.habits.map((h) => {
      const done = state.done.has(key(h.id, today));
      return '<div class="am-row am-row-hair' + (done ? ' done' : '') + '">' +
        '<button type="button" class="am-check' + (done ? ' done' : '') + '" data-toggle-habit="' + h.id + '"' +
        ' aria-pressed="' + done + '" aria-label="Mark ' + AM.esc(h.name) + ' done">' +
        (done ? AM.CHECK_SVG : '') + '</button>' +
        '<div class="am-row-main">' +
          '<div style="font-size:14.5px">' + AM.esc(h.name) + '</div>' +
          (h.category ? '<div class="am-row-sub">' + AM.esc(h.category) + '</div>' : '') +
        '</div>' +
        '<div class="am-streak">' + AM.FLAME_SVG + (state.streaks[h.id] || 0) + '</div>' +
      '</div>';
    }).join('');
  }

  function renderWeek() {
    const host = $('habits-week');
    if (!state.habits.length) { host.innerHTML = ''; return; }
    const week = AM.currentWeekDates().map(AM.isoDate);

    let html = '<div class="am-weekgrid"><span></span>' +
      DAY_LABELS.map((d) => '<span class="day">' + d + '</span>').join('') + '</div>';

    html += state.habits.map((h) =>
      '<div class="am-weekgrid">' +
        '<span class="name">' + AM.esc(h.name) + '</span>' +
        week.map((date) => {
          const on = state.done.has(key(h.id, date));
          return '<span class="am-dot" style="background:' +
            (on ? 'var(--color-accent)' : 'var(--color-neutral-200)') + '"></span>';
        }).join('') +
      '</div>'
    ).join('');

    host.innerHTML = html;
  }

  function renderTrend() {
    const host = $('habits-trend');
    const total = state.habits.length;
    if (!total) { host.innerHTML = ''; return; }
    let html = '';
    for (let i = 13; i >= 0; i--) {
      const date = AM.isoDate(AM.daysAgo(i));
      const completed = state.habits.filter((h) => state.done.has(key(h.id, date))).length;
      const pct = Math.round((completed / total) * 100);
      // A floor of 4% keeps empty days visible as a baseline rather than vanishing.
      html += '<div style="height:' + Math.max(pct, 4) + '%"></div>';
    }
    host.innerHTML = html;
  }

  function renderAll() { renderToday(); renderWeek(); renderTrend(); }

  async function toggleHabit(id) {
    const numeric = Number(id);
    const today = AM.isoDate();
    const k = key(numeric, today);
    const done = state.done.has(k);
    if (done) state.done.delete(k); else state.done.add(k);
    recomputeStreak(numeric);
    renderAll();
    try {
      await AM.post('/habit-logs', { habit_id: numeric, date: today, completed: !done, notes: '' });
    } catch (e) {
      if (done) state.done.add(k); else state.done.delete(k);
      recomputeStreak(numeric);
      renderAll();
    }
  }

  function recomputeStreak(habitId) {
    const dates = new Set();
    state.done.forEach((k) => {
      const [id, date] = k.split('|');
      if (Number(id) === habitId) dates.add(date);
    });
    state.streaks[habitId] = AM.streakFor(dates);
  }

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-toggle-habit]');
    if (btn) toggleHabit(btn.getAttribute('data-toggle-habit'));
  });

  /* — new habit — */
  const modal = $('habit-modal');
  const closeModal = () => { modal.classList.add('hidden'); $('habit-form').reset(); };
  $('habit-new').addEventListener('click', () => { modal.classList.remove('hidden'); $('habit-name').focus(); });
  $('habit-modal-close').addEventListener('click', closeModal);
  $('habit-cancel').addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

  $('habit-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await AM.post('/habits', {
        name: $('habit-name').value.trim(),
        description: '',
        category: $('habit-category').value.trim(),
        frequency: $('habit-frequency').value,
        custom_days: null,
        target_streak: 30
      });
      closeModal();
      await load();
    } catch (err) {
      alert('Could not save the habit.');
    }
  });

  async function load() {
    try {
      const [habits, logs] = await Promise.all([
        AM.get('/habits'),
        AM.get('/habit-logs?start_date=' + AM.isoDate(AM.daysAgo(60)) + '&end_date=' + AM.isoDate())
      ]);
      state.habits = habits;
      state.done = new Set(logs.filter((l) => l.completed).map((l) => key(l.habit_id, l.date)));
      habits.forEach((h) => recomputeStreak(h.id));
      renderAll();
    } catch (err) {
      console.error('Habits load failed', err);
      $('habits-today').innerHTML = '<div class="am-empty">Could not load your habits.</div>';
    }
  }

  document.addEventListener('DOMContentLoaded', load);
})();
