/** Dashboard — today's priorities, habits and a progress pulse. */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const state = { focus: [], habits: [], logsToday: new Set(), streaks: {} };

  function renderFocus() {
    const host = $('dash-focus');
    if (!state.focus.length) {
      host.innerHTML = '<div class="am-empty">No weekly goals yet. Add one on the Goals screen.</div>';
      return;
    }
    host.innerHTML = state.focus.map((g) => {
      const done = (g.progress || 0) >= 100;
      return '<div class="am-row' + (done ? ' done' : '') + '" data-goal="' + g.id + '">' +
        '<button type="button" class="am-check' + (done ? ' done' : '') + '" data-toggle-goal="' + g.id + '"' +
        ' aria-pressed="' + done + '" aria-label="Mark &quot;' + AM.esc(g.title) + '&quot; done">' +
        (done ? AM.CHECK_SVG : '') + '</button>' +
        '<div class="am-row-main">' +
          '<div class="am-row-title">' + AM.esc(g.title) + '</div>' +
          '<div class="am-row-sub">' + AM.esc(g.areaName || 'No focus area') + '</div>' +
        '</div>' +
        '<span class="tag ' + AM.priorityTag(g.priority) + '">' + AM.esc(g.priority || 'medium') + '</span>' +
      '</div>';
    }).join('');
  }

  function renderHabits() {
    const host = $('dash-habits');
    if (!state.habits.length) {
      host.innerHTML = '<div class="am-empty">No habits yet. Add one on the Habits screen.</div>';
      return;
    }
    host.innerHTML = state.habits.map((h) => {
      const done = state.logsToday.has(h.id);
      // No am-row-hair here: the enclosing .am-listcard supplies the dividers.
      return '<div class="am-row' + (done ? ' done' : '') + '">' +
        '<button type="button" class="am-check' + (done ? ' done' : '') + '" data-toggle-habit="' + h.id + '"' +
        ' aria-pressed="' + done + '" aria-label="Mark ' + AM.esc(h.name) + ' done">' +
        (done ? AM.CHECK_SVG : '') + '</button>' +
        '<div class="am-row-main" style="font-size:14px">' + AM.esc(h.name) + '</div>' +
        '<div class="am-streak">' + AM.FLAME_SVG + (state.streaks[h.id] || 0) + '</div>' +
      '</div>';
    }).join('');
  }

  function renderHero(goals) {
    const focusDone = state.focus.filter((g) => (g.progress || 0) >= 100).length;
    const habitsDone = state.logsToday.size;
    const done = focusDone + habitsDone;
    const total = state.focus.length + state.habits.length;
    const pct = total ? Math.round((done / total) * 100) : 0;
    const activeGoals = goals.filter((g) => (g.progress || 0) < 100).length;

    $('hero-progress').textContent = pct + '%';
    $('hero-pill').textContent = done + ' of ' + total + ' done';
    $('hero-caption').textContent =
      activeGoals === 1 ? '1 goal still open' : activeGoals + ' goals still open';
    $('hero-bar').style.width = pct + '%';
  }

  function renderBars(host, goals) {
    if (!goals.length) {
      host.innerHTML = '<div class="am-empty">Nothing here yet.</div>';
      return;
    }
    host.innerHTML = goals.map((g) => {
      const pct = Math.round(g.progress || 0);
      return '<div>' +
        '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:5px">' +
          '<span style="font-size:14px">' + AM.esc(g.title) + '</span>' +
          '<span style="font-size:12px" class="text-muted">' + pct + '%</span>' +
        '</div>' +
        '<div class="am-bar"><div style="width:' + pct + '%"></div></div>' +
      '</div>';
    }).join('');
  }

  function renderAnnual(host, goals) {
    if (!goals.length) {
      host.innerHTML = '<div class="am-empty" style="padding:var(--space-2) 0">No annual goals yet.</div>';
      return;
    }
    host.innerHTML = goals.map((g) => {
      const pct = Math.round(g.progress || 0);
      return '<div>' +
        '<div style="font-size:11px;margin-bottom:3px;color:color-mix(in srgb, var(--color-text) 65%, transparent)">' +
          AM.esc(g.title) + '</div>' +
        '<div class="am-bar am-bar-thin"><div style="width:' + pct + '%"></div></div>' +
      '</div>';
    }).join('');
  }

  /** An area is on track when it has a goal with real movement on it. */
  function renderAreas(areas, goals) {
    const host = $('dash-areas');
    if (!areas.length) {
      host.innerHTML = '<div class="am-empty">No focus areas yet.</div>';
      return;
    }
    host.innerHTML = areas.slice(0, 6).map((area) => {
      const mine = goals.filter((g) => g.focus_area_id === area.id);
      const moving = mine.filter((g) => (g.progress || 0) > 0);
      let label, colour;
      if (!mine.length) { label = 'No goals yet'; colour = 'var(--color-accent-2)'; }
      else if (!moving.length) { label = 'Not started'; colour = 'var(--color-accent-2)'; }
      else { label = 'On track'; colour = 'var(--color-accent)'; }
      return '<div style="display:flex;align-items:center;gap:8px;font-size:13.5px;padding:12px 0">' +
        '<span class="am-dot" style="background:' + colour + '"></span>' +
        '<span style="flex:1">' + AM.esc(area.name) + '</span>' +
        '<span style="font-size:11.5px" class="text-muted">' + label + '</span>' +
      '</div>';
    }).join('');
  }

  function renderQuote(items) {
    if (!items.length) return;
    // Stable pick per day, so the quote does not shuffle on every refresh.
    const day = Math.floor(Date.now() / 86400000);
    const q = items[day % items.length];
    $('dash-quote-text').textContent = '"' + (q.content || '') + '"';
    $('dash-quote-by').textContent = q.author ? '— ' + q.author : '';
    $('dash-quote-section').hidden = false;
  }

  async function toggleGoal(id) {
    const goal = state.focus.find((g) => String(g.id) === String(id));
    if (!goal) return;
    const next = (goal.progress || 0) >= 100 ? 0 : 100;
    goal.progress = next;
    renderFocus();
    try {
      await AM.put('/goals/' + id + '/progress', { progress: next });
    } catch (e) {
      goal.progress = next === 100 ? 0 : 100;
      renderFocus();
    }
  }

  async function toggleHabit(id) {
    const numeric = Number(id);
    const done = state.logsToday.has(numeric);
    if (done) state.logsToday.delete(numeric); else state.logsToday.add(numeric);
    renderHabits();
    try {
      await AM.post('/habit-logs', { habit_id: numeric, date: AM.isoDate(), completed: !done, notes: '' });
    } catch (e) {
      if (done) state.logsToday.add(numeric); else state.logsToday.delete(numeric);
      renderHabits();
    }
  }

  document.addEventListener('click', (e) => {
    const goalBtn = e.target.closest('[data-toggle-goal]');
    if (goalBtn) return toggleGoal(goalBtn.getAttribute('data-toggle-goal'));
    const habitBtn = e.target.closest('[data-toggle-habit]');
    if (habitBtn) return toggleHabit(habitBtn.getAttribute('data-toggle-habit'));
  });

  async function load() {
    try {
      const [goals, habits, areas, wisdom, logs] = await Promise.all([
        AM.get('/goals'),
        AM.get('/habits'),
        AM.get('/focus-areas'),
        AM.get('/wisdom').catch(() => []),
        AM.get('/habit-logs?start_date=' + AM.isoDate(AM.daysAgo(60)) + '&end_date=' + AM.isoDate())
      ]);

      const areaName = {};
      areas.forEach((a) => { areaName[a.id] = a.name; });
      goals.forEach((g) => { g.areaName = areaName[g.focus_area_id]; });

      const today = AM.isoDate();
      state.habits = habits;
      state.logsToday = new Set(
        logs.filter((l) => l.date === today && l.completed).map((l) => l.habit_id)
      );
      habits.forEach((h) => {
        const done = new Set(logs.filter((l) => l.habit_id === h.id && l.completed).map((l) => l.date));
        state.streaks[h.id] = AM.streakFor(done);
      });

      // Today's focus = the weekly tier, incomplete work first, top three.
      state.focus = goals
        .filter((g) => g.type === 'weekly')
        .sort((a, b) => (a.progress || 0) - (b.progress || 0))
        .slice(0, 3);

      renderHero(goals);
      renderFocus();
      renderHabits();
      renderBars($('dash-week'), goals.filter((g) => g.type === 'monthly').slice(0, 4));
      renderAnnual($('dash-annual'), goals.filter((g) => g.type === 'annual').slice(0, 3));
      renderAreas(areas, goals);
      renderQuote(wisdom || []);
    } catch (err) {
      console.error('Dashboard load failed', err);
      $('dash-focus').innerHTML = '<div class="am-empty">Could not load your data.</div>';
    }
  }

  document.addEventListener('DOMContentLoaded', load);
})();
