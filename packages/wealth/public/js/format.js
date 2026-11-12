import { getTodayDate } from './cycle.js';

const dateFormatter = new Intl.DateTimeFormat('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' });
const shortDateFormatter = new Intl.DateTimeFormat('en-ZA', { day: 'numeric', month: 'short' });

/** Matches the design handoff's own fmt(): 'R' + comma-grouped digits, no space. Always shows cents — this app never rounds to whole rands. */
export function formatCurrency(value) {
  const n = value || 0;
  const sign = n < 0 ? '−' : '';
  return `${sign}R${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** The canonical amount-sign class for a value — apply alongside any other classes on the element; the `!important` in .amount-negative/.amount-positive (styles.css) guarantees it wins the color regardless of what else styles that element. */
export function amountClass(value) {
  return (value || 0) < 0 ? 'amount-negative' : 'amount-positive';
}

export function formatCurrencyCompact(value) {
  const n = value || 0;
  const abs = Math.abs(n);
  const sign = n < 0 ? '−' : '';
  if (abs >= 1e6) return `${sign}R${(abs / 1e6).toFixed(abs >= 1e7 ? 0 : 1)}m`;
  if (abs >= 1e3) return `${sign}R${(abs / 1e3).toFixed(0)}k`;
  return formatCurrency(value);
}

export function formatDate(value) {
  if (!value) return '';
  return dateFormatter.format(new Date(value));
}

export function formatShortDate(value) {
  if (!value) return '';
  return shortDateFormatter.format(new Date(value));
}

export function formatPercent(value, digits = 1) {
  return `${(value * 100).toFixed(digits)}%`;
}

/**
 * <input type="number"> silently drops a typed '.' on comma-decimal locales
 * (per the HTML spec the field only accepts its locale's separator), turning
 * "108716.94" into "10871694". Parsing from a plain text input ourselves
 * sidesteps that entirely, and accepts either separator a user might type.
 */
export function parseDecimal(str) {
  if (str == null) return null;
  const cleaned = String(str).trim().replace(',', '.');
  if (cleaned === '' || cleaned === '-') return null;
  const n = Number(cleaned);
  return Number.isNaN(n) ? null : n;
}

export function daysUntil(dateStr) {
  const target = new Date(dateStr);
  const now = getTodayDate();
  return Math.max(0, Math.ceil((target - now) / (24 * 60 * 60 * 1000)));
}

export function initials(name) {
  return (name || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('') || '?';
}
