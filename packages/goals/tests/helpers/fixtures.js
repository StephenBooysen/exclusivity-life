/** Shared fixture builders. Keep payloads close to what the UI actually posts. */

'use strict';

const thisYear = new Date().getFullYear();
const thisMonth = new Date().getMonth() + 1;

function annualGoal(overrides = {}) {
  return Object.assign({
    type: 'annual',
    title: 'Run a marathon',
    description: '',
    parent_id: null,
    priority: 'high',
    success_criteria: 'Finish under 4:30:00',
    target_date: `${thisYear}-11-08`,
    target_year: thisYear,
    target_month: null,
    target_week: null,
    focus_area_id: null
  }, overrides);
}

function monthlyGoal(parentId, overrides = {}) {
  return annualGoal(Object.assign({
    type: 'monthly',
    title: 'Run 80 miles this month',
    parent_id: parentId,
    target_month: thisMonth
  }, overrides));
}

function weeklyGoal(parentId, overrides = {}) {
  return annualGoal(Object.assign({
    type: 'weekly',
    title: 'Long run — 14 miles Saturday',
    parent_id: parentId,
    target_month: thisMonth,
    target_week: 1,
    priority: 'medium'
  }, overrides));
}

function habit(overrides = {}) {
  return Object.assign({
    name: 'Morning pages',
    description: 'Three pages, longhand',
    category: 'Personal Development',
    frequency: 'daily',
    custom_days: null,
    target_streak: 30
  }, overrides);
}

function wisdom(overrides = {}) {
  return Object.assign({
    content: 'We are what we repeatedly do.',
    author: 'Will Durant',
    source: 'The Story of Philosophy',
    tags: 'habits,discipline',
    category: 'Discipline',
    personal_notes: '',
    is_favorite: 0
  }, overrides);
}

/** YYYY-MM-DD for today, or n days back. Local time, matching the client. */
function isoDate(daysBack = 0) {
  const d = new Date();
  d.setDate(d.getDate() - daysBack);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

module.exports = {
  annualGoal, monthlyGoal, weeklyGoal, habit, wisdom, isoDate, thisYear, thisMonth
};
