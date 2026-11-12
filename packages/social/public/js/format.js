/** Formatting and escaping. Every string from the API passes through escapeHtml. */

const LOCALE = 'en-ZA';

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function initials(name) {
  return String(name || '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('') || '—';
}

export function timeAgo(iso) {
  if (!iso) return '';
  const seconds = (Date.now() - new Date(iso)) / 1000;
  if (seconds < 60) return 'now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d`;
  return new Date(iso).toLocaleDateString(LOCALE, { day: 'numeric', month: 'short' });
}

export function clockTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit', hour12: false });
}

export function fullDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(LOCALE, { day: 'numeric', month: 'long', year: 'numeric' });
}

export function dateTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString(LOCALE, {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false
  });
}

/**
 * "Thu 23/08 · 14:30" — an appointment a member has to keep, so the weekday is
 * carried: a bare date two days out is harder to place than a day name.
 */
export function appointment(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  const day = date.toLocaleDateString(LOCALE, { weekday: 'short' });
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return `${day} ${dd}/${mm} · ${clockTime(iso)}`;
}

/**
 * en-ZA renders ZAR as "R 2 499"; the design writes it "R2 499" — the space
 * after the symbol reads as a gap in a price where the thousands separator is
 * also a space.
 */
export function money(amount, currency = 'ZAR') {
  return new Intl.NumberFormat(LOCALE, {
    style: 'currency', currency, maximumFractionDigits: 0
  }).format(amount || 0).replace(/^(\D+)\s+/, '$1');
}

/** Turns a stored enum into the words a member would use. */
const WORDS = {
  long_term: 'A long-term relationship',
  life_partner: 'A life partner',
  still_deciding: 'Still deciding',
  secondary: 'Secondary',
  undergraduate: 'Undergraduate',
  postgraduate: 'Postgraduate',
  doctorate: 'Doctorate',
  never: 'Never',
  socially: 'Socially',
  regularly: 'Regularly',
  none: 'None',
  have_children: 'Has children',
  want_children: 'Wants children',
  prefer_not_to_say: 'Prefers not to say',
  '1m_2m': 'R1m – R2m',
  '2m_5m': 'R2m – R5m',
  '5m_10m': 'R5m – R10m',
  '10m_plus': 'R10m+',
  fake_profile: 'Fake profile',
  harassment: 'Harassment',
  solicitation: 'Solicitation',
  offensive_content: 'Offensive content',
  underage: 'Underage',
  scam: 'Scam',
  other: 'Something else'
};

export function words(key) {
  return WORDS[key] || String(key || '').replace(/_/g, ' ');
}

/** Reason codes as a reviewer would pick them from a list. */
export const REASON_LABELS = {
  incomplete_profile: 'Incomplete profile',
  photo_quality: 'Photo standards',
  photo_unverified: 'Photos not verified',
  outside_launch_city: 'Outside the launch city',
  capacity: 'At capacity',
  interview_not_passed: 'Interview not passed',
  policy_violation: 'Policy breach',
  duplicate_account: 'Duplicate account',
  age_ineligible: 'Not eligible by age',
  other: 'Other'
};

export function heightLabel(cm) {
  if (!cm) return null;
  const inchesTotal = Math.round(cm / 2.54);
  return `${cm} cm · ${Math.floor(inchesTotal / 12)}′${inchesTotal % 12}″`;
}
