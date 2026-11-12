/**
 * Fetch wrapper. Carries the CSRF token, turns non-2xx into a typed error the
 * views can branch on, and routes a 401 back to the gate.
 */

const listeners = { unauthorised: [] };

function csrfToken() {
  const match = document.cookie.match(/(?:^|;\s*)exclusivity\.csrf=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error || 'Something went wrong');
    this.status = status;
    this.code = body?.code || 'error';
    this.details = body;
  }
}

async function request(method, path, body, { raw = false } = {}) {
  const headers = {};
  const token = csrfToken();
  if (token) headers['x-csrf-token'] = token;

  let payload;
  if (body instanceof FormData) {
    payload = body;
  } else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: payload,
    credentials: 'same-origin'
  });

  if (raw) return res;

  const text = await res.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }

  if (!res.ok) {
    if (res.status === 401) listeners.unauthorised.forEach((fn) => fn());
    throw new ApiError(res.status, parsed);
  }
  return parsed;
}

export function onUnauthorised(fn) {
  listeners.unauthorised.push(fn);
}

const get = (p) => request('GET', p);
const post = (p, b) => request('POST', p, b);
const put = (p, b) => request('PUT', p, b);
const del = (p, b) => request('DELETE', p, b);

export const api = {
  health: () => get('/health'),

  auth: {
    me: () => get('/auth/me'),
    register: (data) => post('/auth/register', data),
    login: (data) => post('/auth/login', data),
    logout: () => post('/auth/logout'),
    changePassword: (data) => post('/auth/password', data),
    signOutEverywhere: () => del('/auth/sessions')
  },

  application: {
    mine: () => get('/applications/mine'),
    save: (data) => put('/applications/mine', data),
    submit: () => post('/applications/mine/submit'),
    withdraw: () => del('/applications/mine'),
    appeal: () => post('/applications/mine/appeal'),
    liveness: (file) => {
      const fd = new FormData();
      fd.append('photo', file);
      return post('/applications/mine/liveness', fd);
    }
  },

  photos: {
    list: () => get('/photos'),
    upload: (file) => {
      const fd = new FormData();
      fd.append('photo', file);
      return post('/photos', fd);
    },
    setPrimary: (id) => put(`/photos/${id}/primary`),
    remove: (id) => del(`/photos/${id}`),
    url: (id, size = 'card') => `/api/photos/${id}/${size}`
  },

  profile: {
    mine: () => get('/profile'),
    save: (data) => put('/profile', data),
    of: (memberId) => get(`/profile/${memberId}`),
    preferences: () => get('/profile/preferences'),
    savePreferences: (data) => put('/profile/preferences', data)
  },

  discovery: {
    deck: () => get('/discovery/deck'),
    browse: (params) => get(`/discovery/browse?${new URLSearchParams(params)}`),
    likedMe: () => get('/discovery/liked-me'),
    like: (memberId, source) => post('/discovery/like', { memberId, source }),
    pass: (memberId, source) => post('/discovery/pass', { memberId, source }),
    allowance: () => get('/discovery/allowance'),
    interests: ({ count = true } = {}) => get(`/discovery/interests${count ? '' : '?count=0'}`),
    // The pool is never fully loaded here, so the match count is a server
    // query on every toggle rather than anything counted client-side.
    countInterests: (categories) => post('/discovery/interests/count', { categories }),
    saveInterests: (categories) => put('/discovery/interests', { categories })
  },

  matches: {
    list: () => get('/matches'),
    unmatch: (id, reason) => del(`/matches/${id}`, { reason })
  },

  messages: {
    history: (matchId, params = {}) => get(`/messages/${matchId}?${new URLSearchParams(params)}`),
    send: (matchId, text, idempotencyKey) => post(`/messages/${matchId}`, { text, idempotencyKey }),
    markRead: (matchId) => post(`/messages/${matchId}/read`)
  },

  membership: {
    get: () => get('/membership'),
    subscribe: (tier, term) => post('/membership/subscribe', { tier, term }),
    cancel: (reason) => post('/membership/cancel', { reason }),
    invoices: () => get('/membership/invoices'),
    portal: () => post('/membership/portal')
  },

  safety: {
    report: (data) => post('/reports', data),
    categories: () => get('/reports/categories'),
    block: (memberId) => post('/blocks', { memberId }),
    blocks: () => get('/blocks'),
    unblock: (memberId) => del(`/blocks/${memberId}`)
  },

  settings: {
    get: () => get('/settings'),
    preferences: (data) => put('/settings/preferences', data),
    notifications: (data) => put('/settings/notifications', data),
    privacy: (data) => put('/settings/privacy', data),
    pause: () => post('/settings/pause'),
    resume: () => post('/settings/resume'),
    remove: () => post('/settings/delete', { confirm: true }),
    exportUrl: '/api/settings/export'
  },

  notifications: {
    list: () => get('/notifications'),
    markRead: (ids) => post('/notifications/read', { ids })
  },

  admin: {
    queue: (params = {}) => get(`/admin/review/queue?${new URLSearchParams(params)}`),
    application: (id) => get(`/admin/review/${id}`),
    claim: (id) => post(`/admin/review/${id}/claim`),
    scheduleInterview: (id, data) => post(`/admin/review/${id}/interview`, data),
    recordInterview: (id, data) => post(`/admin/review/${id}/interview/outcome`, data),
    decide: (id, data) => post(`/admin/review/${id}/decide`, data),
    livenessUrl: (id) => `/api/admin/review/${id}/liveness`,

    moderationQueue: (params = {}) => get(`/admin/moderation/queue?${new URLSearchParams(params)}`),
    report: (id) => get(`/admin/moderation/reports/${id}`),
    actOnReport: (id, data) => post(`/admin/moderation/reports/${id}/act`, data),
    moderatePhoto: (id, decision, reason) => post(`/admin/moderation/photos/${id}/${decision}`, { reason }),
    profileEdits: () => get('/admin/moderation/profile-edits'),
    resolveEdit: (id, decision, reason) => post(`/admin/moderation/profile-edits/${id}/${decision}`, { reason }),

    members: (q) => get(`/admin/members?${new URLSearchParams({ q: q || '' })}`),
    member: (id) => get(`/admin/members/${id}`),
    actOnMember: (id, data) => post(`/admin/members/${id}/action`, data),
    comp: (id, data) => post(`/admin/members/${id}/comp`, data),
    grantBadge: (id, badge) => post(`/admin/members/${id}/badges`, { badge }),

    metrics: () => get('/admin/ops/metrics'),
    invites: () => get('/admin/ops/invites'),
    createInvite: (data) => post('/admin/ops/invites', data),
    jobs: () => get('/admin/ops/jobs'),
    runJob: (name) => post(`/admin/ops/jobs/${name}/run`)
  }
};
