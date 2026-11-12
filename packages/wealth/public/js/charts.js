/** Small chart builders. Coordinates/percentages are computed from real data, never hand-authored. */

export function sparkline(points, { width = 320, height = 48, color = '#a8e6c9' } = {}) {
  if (!points.length) return '';
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const stepX = points.length > 1 ? width / (points.length - 1) : 0;

  const coords = points.map((p, i) => {
    const x = points.length > 1 ? i * stepX : width / 2;
    const y = height - 6 - ((p.value - min) / range) * (height - 12);
    return [x, y];
  });

  const line = coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' L');
  return `
    <svg width="100%" height="${height}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" style="display:block;">
      <path d="M${line}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  `;
}

/**
 * Overlaid net-worth projection lines, one per scenario, with the active
 * one emphasized (matches the design handoff's "spread" visualization).
 * @param {Array<{label:string,color:string,active:boolean,rows:Array<{age:number,netWorth:number}>}>} scenarios
 */
export function multiScenarioChart(scenarios, { retirementAge, width = 328, height = 200 } = {}) {
  if (!scenarios.length || !scenarios[0].rows.length) return '';

  const padTop = 20;
  const padBottom = 24;
  const plotHeight = height - padTop - padBottom;
  const rows = scenarios[0].rows;
  const ages = rows.map((r) => r.age);
  const minAge = ages[0];
  const maxAge = ages[ages.length - 1];

  const allValues = scenarios.flatMap((s) => s.rows.map((r) => r.netWorth));
  const maxValue = Math.max(...allValues, 1);

  const xFor = (age) => ((age - minAge) / (maxAge - minAge || 1)) * width;
  const yFor = (value) => padTop + plotHeight - (Math.max(0, value) / maxValue) * plotHeight;

  const lines = scenarios.map((s) => {
    const points = s.rows.map((r) => `${xFor(r.age).toFixed(1)},${yFor(r.netWorth).toFixed(1)}`).join(' L');
    return `<path d="M${points}" fill="none" stroke="${s.color}" stroke-width="${s.active ? 3 : 2}" opacity="${s.active ? 1 : 0.25}" stroke-linecap="round" stroke-linejoin="round" />`;
  }).join('');

  const retireX = retirementAge != null ? xFor(retirementAge) : null;
  const retireLine = retireX != null
    ? `<line x1="${retireX.toFixed(1)}" y1="${padTop - 6}" x2="${retireX.toFixed(1)}" y2="${height - padBottom + 6}" stroke="var(--card-border)" stroke-width="1" stroke-dasharray="3,3" />`
    : '';

  return `
    <svg width="100%" height="${height}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
      <line x1="0" y1="${(padTop + plotHeight).toFixed(1)}" x2="${width}" y2="${(padTop + plotHeight).toFixed(1)}" stroke="var(--divider)" stroke-width="1" />
      <line x1="0" y1="${padTop}" x2="${width}" y2="${padTop}" stroke="var(--divider)" stroke-width="1" />
      ${lines}
      ${retireLine}
    </svg>
    <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text-soft);margin-top:4px;">
      <span>${minAge}</span>
      <span>${retirementAge != null ? `Retire · ${retirementAge}` : ''}</span>
      <span>${maxAge}</span>
    </div>
  `;
}

/**
 * Pure-CSS conic-gradient donut, matching the design handoff's technique.
 * @param {Array<{label:string,value:number,color:string}>} segments
 */
export function donutChart(segments) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  const divisor = total || 1; // avoids division by zero in the percentage math below; the reported total stays the real (possibly zero) sum
  let cursor = 0;
  const stops = segments.map((s) => {
    const start = (cursor / divisor) * 100;
    cursor += s.value;
    const end = (cursor / divisor) * 100;
    return `${s.color} ${start.toFixed(2)}% ${end.toFixed(2)}%`;
  }).join(', ');

  return {
    total,
    gradient: `conic-gradient(${stops})`,
    segments: segments.map((s) => ({ ...s, pct: Math.round((s.value / divisor) * 100) }))
  };
}
