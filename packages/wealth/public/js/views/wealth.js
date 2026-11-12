import { api } from '../api.js';
import { formatCurrency } from '../format.js';
import { multiScenarioChart } from '../charts.js';
import { openModal } from '../components/modal.js';
import { showToast } from '../toast.js';

const SCENARIO_COLORS = {
  Conservative: 'var(--text-faint)',
  Moderate: 'var(--brand)',
  Optimistic: 'var(--orange-light)'
};
const SCENARIO_ORDER = ['Conservative', 'Moderate', 'Optimistic'];
const ANNUAL_RA_TAX_CAP = 350000;

function retirementHero(account) {
  return `
    <div class="hero-card hero-card--dark" data-edit-fund="${account.id}" style="cursor:pointer;">
      <div class="hero-card__label">${account.name}${account.institution ? ` · ${account.institution}` : ''}</div>
      <div class="hero-card__value tabular">${formatCurrency(account.balance)}</div>
      <div class="row" style="justify-content:flex-start;gap:24px;">
        <div><div style="font-size:11px;color:#c9c6bc;">Monthly contribution</div><div style="font-size:14px;font-weight:700;" class="tabular">${formatCurrency(account.contributionMonthly)}</div></div>
      </div>
    </div>
  `;
}

function openRetirementFundModal(account, onDone) {
  openModal({
    title: `Edit ${account.name}`,
    submitLabel: 'Save changes',
    fields: [
      { name: 'name', label: 'Name', type: 'text', value: account.name, required: true },
      { name: 'institution', label: 'Provider', type: 'text', value: account.institution },
      { name: 'balance', label: 'Current value (R)', type: 'number', value: account.balance, required: true },
      { name: 'contributionMonthly', label: 'Monthly contribution (R)', type: 'number', value: account.contributionMonthly },
      { name: 'growthRateAssumed', label: 'Assumed annual growth (e.g. 0.095 = 9.5%)', type: 'number', step: '0.001', value: account.growthRateAssumed }
    ],
    onDelete: async () => {
      await api.accounts.remove(account.id);
      showToast('Retirement fund removed');
      await onDone();
    },
    onSubmit: async (values) => {
      await api.accounts.update(account.id, values);
      showToast('Retirement fund updated');
      await onDone();
    }
  });
}

async function renderRetirementTab(root, { retirementAccounts, settings, scenarioProjections }) {
  const annualContributions = retirementAccounts.reduce((sum, a) => sum + (a.contributionMonthly || 0) * 12, 0);
  const capPct = Math.min(100, (annualContributions / ANNUAL_RA_TAX_CAP) * 100);

  const rows = SCENARIO_ORDER.map((name) => {
    const proj = scenarioProjections[name];
    const atRetirement = proj?.years.find((y) => y.age === settings.retirementAge);
    return `
      <div class="row" style="padding:6px 0;">
        <span class="muted" style="font-size:13px;">${name}</span>
        <span style="font-size:13px;font-weight:700;color:var(--text);" class="tabular">${atRetirement ? formatCurrency(atRetirement.retirementInvestments) : '—'}</span>
      </div>
    `;
  }).join('');

  root.innerHTML = `
    <div class="row" style="margin-bottom:8px;">
      <span></span>
      <button class="pill" id="add-fund" style="padding:3px 10px;font-size:11px;">+ Add fund</button>
    </div>
    ${retirementAccounts.map(retirementHero).join('') || '<div class="empty-state"><p>No retirement funds added yet.</p></div>'}

    <div class="card">
      <div class="row" style="margin-bottom:8px;">
        <span style="font-size:13px;font-weight:600;color:var(--text);">Tax-year contributions</span>
        <span class="muted tabular" style="font-size:13px;">${formatCurrency(annualContributions)} / ${formatCurrency(ANNUAL_RA_TAX_CAP)}</span>
      </div>
      <div class="bar-track bar-track--lg"><div class="bar-fill" style="width:${capPct}%;background:var(--brand);"></div></div>
    </div>

    <div class="card">
      <div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:10px;">Projected at retirement (${settings.retirementAge})</div>
      ${rows}
    </div>
  `;

  root.querySelectorAll('[data-edit-fund]').forEach((card) => {
    card.addEventListener('click', () => {
      const account = retirementAccounts.find((a) => a.id === card.dataset.editFund);
      openRetirementFundModal(account, async () => { location.reload(); });
    });
  });

  root.querySelector('#add-fund').addEventListener('click', () => {
    openModal({
      title: 'Add retirement fund',
      submitLabel: 'Add fund',
      fields: [
        { name: 'name', label: 'Name', type: 'text', required: true },
        { name: 'institution', label: 'Provider', type: 'text' },
        { name: 'balance', label: 'Current value (R)', type: 'number', required: true },
        { name: 'contributionMonthly', label: 'Monthly contribution (R)', type: 'number' },
        { name: 'growthRateAssumed', label: 'Assumed annual growth (e.g. 0.095 = 9.5%)', type: 'number', step: '0.001' }
      ],
      onSubmit: async (values) => {
        await api.accounts.create({ type: 'retirement', ...values });
        showToast('Retirement fund added');
        location.reload();
      }
    });
  });
}

function renderProjectionTab(root, { scenarios, settings, selectedName, onSelect }) {
  const chartScenarios = SCENARIO_ORDER
    .filter((name) => scenarios[name])
    .map((name) => ({
      label: name,
      color: SCENARIO_COLORS[name],
      active: name === selectedName,
      rows: scenarios[name].years.map((y) => ({ age: y.age, netWorth: y.netWorth }))
    }));

  const selected = scenarios[selectedName];
  const atRetirement = selected?.years.find((y) => y.age === settings.retirementAge);
  const atHorizon = selected?.years[selected.years.length - 1];
  const nonRetirementMilestones = (selected?.milestones || []).filter((m) => m.label !== 'Retirement');

  root.innerHTML = `
    <p class="muted" style="font-size:13px;margin-bottom:14px;">Net worth projection, age ${settings.currentAge} to ${settings.horizonAge}</p>
    <div class="chip-row">
      ${SCENARIO_ORDER.map((name) => `
        <div class="chip ${name === selectedName ? 'chip--active' : ''}" style="${name === selectedName ? `background:${SCENARIO_COLORS[name]};` : ''}" data-scenario="${name}">${name}</div>
      `).join('')}
    </div>
    <div class="card">
      ${multiScenarioChart(chartScenarios, { retirementAge: settings.retirementAge })}
    </div>

    ${selected ? `
      <div class="card" style="display:flex;gap:12px;">
        <div style="flex:1;"><div class="muted" style="font-size:11px;">At retirement (${settings.retirementAge})</div><div style="font-size:17px;font-weight:800;color:var(--text);" class="tabular">${atRetirement ? formatCurrency(atRetirement.netWorth) : '—'}</div></div>
        <div style="flex:1;"><div class="muted" style="font-size:11px;">At age ${settings.horizonAge}</div><div style="font-size:17px;font-weight:800;color:var(--text);" class="tabular">${atHorizon ? formatCurrency(atHorizon.netWorth) : '—'}</div></div>
      </div>
    ` : ''}

    <div class="card card--list">
      ${nonRetirementMilestones.length
        ? nonRetirementMilestones.map((m) => `<div class="row-item"><span class="row-item__label muted">${m.label}</span><span class="row-item__value">Age ${m.age}</span></div>`).join('')
        : '<div class="row-item"><span class="row-item__label muted">No debt-payoff milestones in this horizon.</span></div>'}
    </div>
  `;

  root.querySelectorAll('[data-scenario]').forEach((chip) => {
    chip.addEventListener('click', () => onSelect(chip.dataset.scenario));
  });
}

export async function renderWealth(root) {
  const [retirementAccounts, settings, scenarioList] = await Promise.all([
    api.accounts.list('retirement'),
    api.settings.get(),
    api.scenarios.list()
  ]);

  const scenarioByName = {};
  scenarioList.forEach((s) => { scenarioByName[s.name] = s.id; });

  const scenarioProjections = {};
  await Promise.all(SCENARIO_ORDER.map(async (name) => {
    if (!scenarioByName[name]) return;
    scenarioProjections[name] = await api.projection.forScenario(scenarioByName[name]);
  }));

  let subTab = 'retirement';
  let selectedScenario = 'Moderate';

  function draw() {
    root.innerHTML = `
      <h2 class="view-heading">Wealth</h2>
      <div class="segmented">
        <button class="segmented__item ${subTab === 'retirement' ? 'active' : ''}" data-sub="retirement">Retirement</button>
        <button class="segmented__item ${subTab === 'projection' ? 'active' : ''}" data-sub="projection">Projection</button>
      </div>
      <div id="wealth-sub"></div>
    `;

    root.querySelectorAll('[data-sub]').forEach((btn) => {
      btn.addEventListener('click', () => {
        subTab = btn.dataset.sub;
        draw();
      });
    });

    const subRoot = root.querySelector('#wealth-sub');
    if (subTab === 'retirement') {
      renderRetirementTab(subRoot, { retirementAccounts, settings, scenarioProjections });
    } else {
      renderProjectionTab(subRoot, {
        scenarios: scenarioProjections,
        settings,
        selectedName: selectedScenario,
        onSelect: (name) => { selectedScenario = name; draw(); }
      });
    }
  }

  draw();
}
