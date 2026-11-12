import { api } from '../api.js';
import { initials, formatCurrency } from '../format.js';
import { openModal } from '../components/modal.js';
import { showToast } from '../toast.js';
import { refreshCurrentRoute, invalidateProfileCache } from '../router.js';

const FREQUENCY_MONTHS = { monthly: 1, quarterly: 3, annual: 12 };

function openProfileModal(settings) {
  openModal({
    title: 'Edit profile',
    submitLabel: 'Save',
    fields: [
      { name: 'profileName', label: 'Name', type: 'text', value: settings.profileName, required: true },
      { name: 'profileEmail', label: 'Email', type: 'text', value: settings.profileEmail }
    ],
    onSubmit: async (values) => {
      await api.settings.update(values);
      invalidateProfileCache();
      showToast('Profile updated');
      await refreshCurrentRoute();
    }
  });
}

function openAssumptionsModal(settings) {
  openModal({
    title: 'Assumptions',
    submitLabel: 'Save assumptions',
    fields: [
      { name: 'currentAge', label: 'Current age', type: 'number', value: settings.currentAge, required: true },
      { name: 'retirementAge', label: 'Retirement age target', type: 'number', value: settings.retirementAge, required: true },
      { name: 'horizonAge', label: 'Project to age', type: 'number', value: settings.horizonAge, required: true },
      { name: 'otherMonthlyExpenses', label: 'Other monthly costs — tax, untracked spend (R)', type: 'number', value: settings.otherMonthlyExpenses },
      { name: 'paydayDay', label: 'Payday (day of month)', type: 'number', value: settings.paydayDay },
      { name: 'inflationRate', label: 'Inflation (e.g. 0.055 = 5.5%)', type: 'number', step: '0.001', value: settings.inflationRate },
      { name: 'drawdownRate', label: 'Retirement drawdown rate', type: 'number', step: '0.001', value: settings.drawdownRate },
      { name: 'propertyAppreciationRate', label: 'Property appreciation rate', type: 'number', step: '0.001', value: settings.propertyAppreciationRate },
      { name: 'minRetirementIncome', label: "Minimum retirement income needed (R/mo, today's terms)", type: 'number', value: settings.minRetirementIncome }
    ],
    onSubmit: async (values) => {
      await api.settings.update(values);
      showToast('Assumptions updated');
      await refreshCurrentRoute();
    }
  });
}

export async function renderSettings(root) {
  const [settings, accounts, incomeStreams] = await Promise.all([api.settings.get(), api.accounts.list(), api.incomeStreams.list()]);
  const institutions = [...new Set(accounts.map((a) => a.institution).filter(Boolean))];
  const monthlyIncomeTotal = incomeStreams
    .filter((s) => s.status === 'active')
    .reduce((sum, s) => sum + (s.amount || 0) / (FREQUENCY_MONTHS[s.frequency] || 1), 0);

  root.innerHTML = `
    <h2 class="view-heading">Settings</h2>

    <div class="card" style="display:flex;align-items:center;gap:14px;">
      <div class="avatar avatar--lg">${initials(settings.profileName)}</div>
      <div style="flex:1;">
        <div style="font-size:15px;font-weight:700;color:var(--text);">${settings.profileName}</div>
        <div class="muted" style="font-size:12px;">${settings.profileEmail || ''}</div>
      </div>
      <button class="pill" id="edit-profile">Edit</button>
    </div>

    <div class="row" style="margin:0 0 8px;">
      <span class="section-label" style="margin:0;">Preferences</span>
      <button class="section-head__action" id="edit-assumptions">Edit assumptions</button>
    </div>
    <div class="card card--list">
      <div class="row-item"><span class="row-item__label">Currency</span><span class="row-item__value muted" style="font-weight:600;">ZAR (R)</span></div>
      <div class="row-item"><span class="row-item__label">Retirement age target</span><span class="row-item__value muted" style="font-weight:600;">${settings.retirementAge}</span></div>
      <div class="row-item"><span class="row-item__label">Monthly income</span><button class="row-item__value" id="go-to-income" style="background:none;border:none;font-weight:600;color:var(--brand);cursor:pointer;padding:0;">${formatCurrency(monthlyIncomeTotal)}</button></div>
      <div class="row-item"><span class="row-item__label">Push notifications</span><button class="toggle ${settings.pushNotifications ? 'on' : ''}" id="toggle-push"><span class="toggle__knob"></span></button></div>
      <div class="row-item"><span class="row-item__label">Email summaries</span><button class="toggle ${settings.emailSummaries ? 'on' : ''}" id="toggle-email"><span class="toggle__knob"></span></button></div>
    </div>
    <p class="muted" style="font-size:11.5px;margin:-4px 0 16px;">Managed as Income Streams under Accounts, so it can change over time.</p>

    <p class="section-label">Linked Accounts</p>
    <div class="card card--list">
      ${institutions.length
        ? institutions.map((name) => `<div class="list-item"><div class="list-item__dot" style="background:var(--sage);"></div><div class="list-item__body"><div class="list-item__title" style="font-weight:600;">${name}</div></div></div>`).join('')
        : '<p class="muted" style="font-size:12.5px;padding:14px 16px;">No linked accounts yet.</p>'}
    </div>

    <button id="log-out" style="width:100%;text-align:center;font-size:14px;font-weight:600;color:var(--danger);padding:14px;background:none;border:none;cursor:pointer;">Log Out</button>
  `;

  root.querySelector('#edit-profile').addEventListener('click', () => openProfileModal(settings));
  root.querySelector('#edit-assumptions').addEventListener('click', () => openAssumptionsModal(settings));
  root.querySelector('#go-to-income').addEventListener('click', () => { location.hash = '#/accounts'; });

  root.querySelector('#toggle-push').addEventListener('click', async (e) => {
    const next = !settings.pushNotifications;
    await api.settings.update({ pushNotifications: next });
    e.currentTarget.classList.toggle('on', next);
    settings.pushNotifications = next;
  });
  root.querySelector('#toggle-email').addEventListener('click', async (e) => {
    const next = !settings.emailSummaries;
    await api.settings.update({ emailSummaries: next });
    e.currentTarget.classList.toggle('on', next);
    settings.emailSummaries = next;
  });

  root.querySelector('#log-out').addEventListener('click', () => {
    showToast('Single-user mode — nothing to log out of');
  });
}
