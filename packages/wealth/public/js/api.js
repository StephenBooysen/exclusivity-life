const BASE = '/api';

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  if (res.status === 204) return null;
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error((body && body.error) || `Request failed: ${res.status}`);
  }
  return body;
}

const get = (path) => request(path);
const post = (path, data) => request(path, { method: 'POST', body: JSON.stringify(data) });
const put = (path, data) => request(path, { method: 'PUT', body: JSON.stringify(data) });
const del = (path) => request(path, { method: 'DELETE' });

export const api = {
  dashboard: {
    get: () => get('/dashboard')
  },
  accounts: {
    list: (type) => get(`/accounts${type ? `?type=${type}` : ''}`),
    get: (id) => get(`/accounts/${id}`),
    history: (id) => get(`/accounts/${id}/history`),
    create: (data) => post('/accounts', data),
    update: (id, data) => put(`/accounts/${id}`, data),
    remove: (id) => del(`/accounts/${id}`)
  },
  debitOrders: {
    list: () => get('/debit-orders'),
    upcoming: (days = 7) => get(`/debit-orders/upcoming?days=${days}`),
    create: (data) => post('/debit-orders', data),
    update: (id, data) => put(`/debit-orders/${id}`, data),
    remove: (id) => del(`/debit-orders/${id}`)
  },
  transactions: {
    list: (accountId, month) => get(`/transactions?${new URLSearchParams({ accountId, ...(month ? { month } : {}) })}`),
    totals: (accountId, month) => get(`/transactions/totals?${new URLSearchParams({ accountId, ...(month ? { month } : {}) })}`),
    create: (data) => post('/transactions', data),
    update: (id, accountId, data) => put(`/transactions/${id}`, { ...data, accountId }),
    remove: (id, accountId) => del(`/transactions/${id}?${new URLSearchParams({ accountId })}`),
    setOpeningBalance: (accountId, month, amount) => put('/transactions/opening-balance', { accountId, month, amount })
  },
  transfers: {
    create: (data) => post('/transfers', data)
  },
  incomeStreams: {
    list: () => get('/income-streams'),
    get: (id) => get(`/income-streams/${id}`),
    history: (id) => get(`/income-streams/${id}/history`),
    create: (data) => post('/income-streams', data),
    update: (id, data) => put(`/income-streams/${id}`, data),
    remove: (id) => del(`/income-streams/${id}`)
  },
  categories: {
    list: () => get('/categories'),
    create: (data) => post('/categories', data),
    update: (id, data) => put(`/categories/${id}`, data),
    remove: (id) => del(`/categories/${id}`)
  },
  settings: {
    get: () => get('/settings'),
    update: (data) => put('/settings', data)
  },
  scenarios: {
    list: () => get('/scenarios'),
    create: (data) => post('/scenarios', data),
    remove: (id) => del(`/scenarios/${id}`)
  },
  projection: {
    forScenario: (scenarioId) => get(`/projection${scenarioId ? `?scenario=${scenarioId}` : ''}`)
  },
  activity: {
    recent: (limit = 20) => get(`/activity?limit=${limit}`)
  }
};
