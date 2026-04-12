
// ============================================================
// CONSTANTS
// ============================================================
const ALL_CCYS = ['USD','EUR','GBP','JPY','CHF','AUD','CAD'];
const CCY_NAMES = { USD:'US Dollar', EUR:'Euro', GBP:'British Pound',
  JPY:'Japanese Yen', CHF:'Swiss Franc', AUD:'Australian Dollar', CAD:'Canadian Dollar' };

// Default FX vs USD: 1 foreign unit = X USD
const USD_RATES = {
  EUR:{spot:1.08,fwd:1.08,vol:8}, GBP:{spot:1.27,fwd:1.27,vol:9},
  JPY:{spot:0.00670,fwd:0.00662,vol:10}, CHF:{spot:1.12,fwd:1.13,vol:8},
  AUD:{spot:0.650,fwd:0.640,vol:12}, CAD:{spot:0.740,fwd:0.730,vol:8}
};

// Default correlations (sorted key e.g. 'AUD-EUR')
const DEFAULT_CORR = {
  'EUR-GBP':0.60,'EUR-JPY':0.15,'CHF-EUR':0.55,'AUD-EUR':0.25,'CAD-EUR':0.20,
  'GBP-JPY':0.10,'CHF-GBP':0.45,'AUD-GBP':0.20,'CAD-GBP':0.15,
  'CHF-JPY':0.30,'AUD-JPY':-0.10,'CAD-JPY':-0.05,
  'AUD-CHF':0.15,'CAD-CHF':0.10,'AUD-CAD':0.50
};

const CCY_COLORS = {
  USD:'#e74c3c', EUR:'#3498db', GBP:'#9b59b6', JPY:'#e67e22',
  CHF:'#1abc9c', AUD:'#f39c12', CAD:'#2ecc71'
};

// ============================================================
// STATE
// ============================================================
const S = {
  reportingCcy: 'USD',
  netDebt: 500, nav: 1200, ebitda: 200,
  selectedCcys: ['EUR','GBP','JPY'],
  debtAlloc: {}, ebitdaAlloc: {}, naAlloc: {},
  fxParams: {},    // { EUR: {spot,fwd,vol}, ... }  foreign ccys only
  correlations: {}, // { 'EUR-GBP': 0.6, ... }
  sliderLocks: {},  // { 'debt_EUR': true, ... }
  stepSize: 10, nSims: 10000, timeHorizon: 1.0,
  results: null,
  fxPaths: null,    // [nSims][nForeign] stored after run
  naLocal: null, ebitdaLocal: null,
  naReporting: 0, ebitdaReporting: 0, baseEquity: 0,
  spotArr: null, scenarios: null, allCcys: null,
  overlayScIdx: 0, _chartBPts: null
};

// ============================================================
// UTILS
// ============================================================
function fmt(n, decimals=1) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return n.toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
function fmtM(n) { return fmt(n,1) + 'M'; }
function corrKey(a,b) { return [a,b].sort().join('-'); }
function safeDestroy(chart) {
  if (chart) { try { chart.destroy(); } catch(e) {} }
  return null;
}

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  return {r,g,b};
}
function scenarioColor(debtAlloc, allCcys) {
  const n = allCcys.length;
  let domCcy = allCcys[0], domPct = 0;
  allCcys.forEach(c => { if ((debtAlloc[c]||0) > domPct) { domPct = debtAlloc[c]||0; domCcy = c; } });
  const sat = Math.max(0, (domPct/100 - 1/n) / (1 - 1/n));
  const base = hexToRgb(CCY_COLORS[domCcy] || '#888888');
  const r = Math.round(base.r*sat + 255*(1-sat));
  const g = Math.round(base.g*sat + 255*(1-sat));
  const b = Math.round(base.b*sat + 255*(1-sat));
  return `rgb(${r},${g},${b})`;
}

function getDefaultFxRate(foreignCcy, reportingCcy) {
  if (reportingCcy === 'USD') return { ...USD_RATES[foreignCcy] };
  const fUSD = foreignCcy === 'USD' ? {spot:1,fwd:1,vol:0} : USD_RATES[foreignCcy];
  const rUSD = reportingCcy === 'USD' ? {spot:1,fwd:1,vol:0} : USD_RATES[reportingCcy];
  if (!fUSD || !rUSD) return {spot:1,fwd:1,vol:10};
  const corKey = corrKey(foreignCcy, reportingCcy);
  const crossCorr = DEFAULT_CORR[corKey] || 0;
  const crossVol = Math.sqrt(fUSD.vol**2 + rUSD.vol**2 - 2*crossCorr*(fUSD.vol/100)*(rUSD.vol/100)*10000) ;
  return {
    spot: fUSD.spot / rUSD.spot,
    fwd:  fUSD.fwd  / rUSD.fwd,
    vol:  Math.round(crossVol * 10) / 10
  };
}

// ============================================================
// TAB NAVIGATION
// ============================================================
function switchTab(name) {
  if (name === 'results' && !S.results) return;
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  const btns = document.querySelectorAll('.tab-btn');
  const map = {setup:0, fx:1, scenarios:2, results:3};
  btns[map[name]].classList.add('active');
}

// ============================================================
// TAB 1: COMPANY SETUP
// ============================================================
function onReportingCcyChange() {
  S.reportingCcy = document.getElementById('reporting-ccy').value;
  saveState();
  // Remove the new reporting currency from selectedCcys to avoid duplicates
  S.selectedCcys = S.selectedCcys.filter(c => c !== S.reportingCcy);
  ['nd-ccy-lbl','nav-ccy-lbl','ebitda-ccy-lbl'].forEach(id =>
    document.getElementById(id).textContent = S.reportingCcy);
  document.getElementById('fx-reporting-label').textContent = 'vs ' + S.reportingCcy;
  rebuildFxDefaults();
  renderCcyCheckboxes();
  initAllocations();
  renderSliders();
  onParamsChange();
}

function onParamsChange() {
  const ndEl  = document.getElementById('net-debt');
  const navEl = document.getElementById('nav');
  const ebEl  = document.getElementById('ebitda');

  const rawND  = parseFloat(ndEl.value);
  const rawNAV = parseFloat(navEl.value);
  const rawEB  = parseFloat(ebEl.value);

  let valid = true;

  if (isNaN(rawNAV) || rawNAV <= 0) {
    navEl.classList.add('error'); valid = false;
  } else {
    navEl.classList.remove('error');
    S.nav = rawNAV;
  }

  if (isNaN(rawND) || rawND < 0) {
    ndEl.classList.add('error'); valid = false;
  } else {
    ndEl.classList.remove('error');
    S.netDebt = rawND;
  }

  if (isNaN(rawEB) || rawEB <= 0) {
    ebEl.classList.add('error'); valid = false;
  } else {
    ebEl.classList.remove('error');
    S.ebitda = rawEB;
  }

  if (!valid) {
    ['base-equity-val','base-lev-val','base-ltv-val'].forEach(id =>
      document.getElementById(id).textContent = '—'
    );
    return;
  }

  const eq  = S.nav - S.netDebt;
  const lev = S.netDebt / S.ebitda;
  document.getElementById('base-equity-val').textContent = S.reportingCcy + fmtM(eq);
  document.getElementById('base-lev-val').textContent = fmt(lev,2) + 'x';
  document.getElementById('base-ltv-val').textContent = fmt(100*eq/S.nav, 1) + '%';
  saveState();
}

function renderCcyCheckboxes() {
  const container = document.getElementById('ccy-checkboxes');
  container.innerHTML = '';
  ALL_CCYS.filter(c => c !== S.reportingCcy).forEach(ccy => {
    const checked = S.selectedCcys.includes(ccy);
    const lbl = document.createElement('label');
    lbl.className = 'ccy-check' + (checked ? ' checked' : '');

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = checked;
    cb.addEventListener('change', () => onCcyToggle(ccy, cb.checked));

    const dot = document.createElement('span');
    dot.style.cssText = `display:inline-block;width:8px;height:8px;border-radius:50%;background:${CCY_COLORS[ccy]};margin-right:4px`;

    lbl.appendChild(cb);
    lbl.appendChild(dot);
    lbl.appendChild(document.createTextNode(ccy));
    container.appendChild(lbl);
  });
}

function onCcyToggle(ccy, checked) {
  if (checked) {
    if (!S.selectedCcys.includes(ccy)) S.selectedCcys.push(ccy);
  } else {
    S.selectedCcys = S.selectedCcys.filter(c => c !== ccy);
  }
  saveState();
  // Update checkbox styling
  document.querySelectorAll('.ccy-check').forEach(lbl => {
    const cb = lbl.querySelector('input');
    lbl.classList.toggle('checked', cb.checked);
  });
  initAllocations();
  rebuildFxDefaults();
  renderFxTable();
  renderCorrMatrix();
  renderSliders();
  updateScenarioCount();
  const show = S.selectedCcys.length > 0;
  document.getElementById('alloc-card').style.display = show ? '' : 'none';
}

function getAllCcys() { return [...new Set([S.reportingCcy, ...S.selectedCcys])]; }

function initAllocations() {
  const allCcys = getAllCcys();
  const n = allCcys.length;
  ['debt','ebitda','na'].forEach(grp => {
    const existing = S[grp+'Alloc'];
    const newAlloc = {};
    const step = 100 / n;
    allCcys.forEach((c, i) => {
      newAlloc[c] = existing[c] !== undefined ? existing[c] : step;
    });
    // Normalize to 100
    const total = Object.values(newAlloc).reduce((a,b)=>a+b,0);
    if (total > 0) allCcys.forEach(c => newAlloc[c] = newAlloc[c] / total * 100);
    S[grp+'Alloc'] = newAlloc;
  });
}

function renderSliders() {
  const allCcys = getAllCcys();
  ['debt','ebitda','na'].forEach(grp => {
    const container = document.getElementById('sliders-' + grp);
    if (!container) return;
    container.innerHTML = '';
    allCcys.forEach(ccy => {
      const val = S[grp+'Alloc'][ccy] || 0;
      const locked = !!S.sliderLocks[grp+'_'+ccy];
      const row = document.createElement('div');
      row.className = 'alloc-row';

      const ccyDiv = document.createElement('div');
      ccyDiv.className = 'alloc-ccy';
      ccyDiv.style.color = CCY_COLORS[ccy] || '#333';
      ccyDiv.textContent = ccy;

      const slider = document.createElement('input');
      slider.type = 'range';
      slider.className = 'alloc-slider';
      slider.id = `sl_${grp}_${ccy}`;
      slider.min = '0'; slider.max = '100'; slider.step = '0.1';
      slider.value = val.toFixed(1);
      slider.disabled = locked;
      slider.addEventListener('input', () => onSliderMove(grp, ccy, parseFloat(slider.value)));

      const valDiv = document.createElement('div');
      valDiv.className = 'alloc-val';
      valDiv.id = `sv_${grp}_${ccy}`;
      valDiv.textContent = val.toFixed(1) + '%';

      const lockBtn = document.createElement('button');
      lockBtn.className = 'lock-btn' + (locked ? ' locked' : '');
      lockBtn.id = `lb_${grp}_${ccy}`;
      lockBtn.title = locked ? 'Unlock' : 'Lock';
      lockBtn.textContent = locked ? '🔒' : '🔓';
      lockBtn.addEventListener('click', () => toggleLock(grp, ccy));

      row.appendChild(ccyDiv);
      row.appendChild(slider);
      row.appendChild(valDiv);
      row.appendChild(lockBtn);
      container.appendChild(row);
    });
    updateAllocTotal(grp);
  });
}

function onSliderMove(grp, changedCcy, newVal) {
  const allCcys = getAllCcys();
  const lockedCcys = allCcys.filter(c => c !== changedCcy && S.sliderLocks[grp+'_'+c]);
  const unlockedCcys = allCcys.filter(c => c !== changedCcy && !S.sliderLocks[grp+'_'+c]);
  const lockedSum = lockedCcys.reduce((s,c) => s + (S[grp+'Alloc'][c]||0), 0);
  const available = 100 - lockedSum;
  newVal = Math.min(newVal, available);
  S[grp+'Alloc'][changedCcy] = newVal;
  const remainder = available - newVal;
  const curUnlockedSum = unlockedCcys.reduce((s,c) => s + (S[grp+'Alloc'][c]||0), 0);
  if (unlockedCcys.length > 0) {
    unlockedCcys.forEach(c => {
      S[grp+'Alloc'][c] = curUnlockedSum > 0
        ? (S[grp+'Alloc'][c] / curUnlockedSum) * remainder
        : remainder / unlockedCcys.length;
    });
  }
  updateSliderDisplays(grp);
  saveState();
}

function updateSliderDisplays(grp) {
  const allCcys = getAllCcys();
  allCcys.forEach(c => {
    const v = S[grp+'Alloc'][c] || 0;
    const sl = document.getElementById('sl_'+grp+'_'+c);
    const sv = document.getElementById('sv_'+grp+'_'+c);
    if (sl && !S.sliderLocks[grp+'_'+c]) sl.value = v.toFixed(1);
    if (sv) sv.textContent = v.toFixed(1) + '%';
  });
  updateAllocTotal(grp);
}

function updateAllocTotal(grp) {
  const total = Object.values(S[grp+'Alloc']).reduce((a,b)=>a+b,0);
  const el = document.getElementById('total-'+grp);
  if (!el) return;
  el.textContent = 'Total: ' + total.toFixed(1) + '%';
  el.className = 'alloc-total' + (Math.abs(total-100) > 0.5 ? ' error' : '');
}

function toggleLock(grp, ccy) {
  const key = grp+'_'+ccy;
  S.sliderLocks[key] = !S.sliderLocks[key];
  renderSliders();
}

// ============================================================
// TAB 2: FX PARAMETERS
// ============================================================
function rebuildFxDefaults() {
  S.fxParams = {};
  const foreignCcys = S.reportingCcy === 'USD'
    ? S.selectedCcys
    : [...S.selectedCcys.filter(c=>c!=='USD'), ...(S.selectedCcys.includes('USD')?['USD']:[])];

  // Include all selected + USD if reporting is not USD
  const allForeign = S.selectedCcys;
  allForeign.forEach(ccy => {
    if (!S.fxParams[ccy]) S.fxParams[ccy] = getDefaultFxRate(ccy, S.reportingCcy);
  });

  // Default correlations
  S.correlations = {};
  allForeign.forEach((a,i) => allForeign.forEach((b,j) => {
    if (i < j) S.correlations[corrKey(a,b)] = DEFAULT_CORR[corrKey(a,b)] || 0;
  }));
}

function renderFxTable() {
  const tbody = document.getElementById('fx-table-body');
  if (!tbody) return;
  tbody.innerHTML = '';
  S.selectedCcys.forEach(ccy => {
    const p = S.fxParams[ccy] || getDefaultFxRate(ccy, S.reportingCcy);
    S.fxParams[ccy] = p;

    const row = document.createElement('tr');

    const labelTd = document.createElement('td');
    labelTd.className = 'ccy-label';
    const dot = document.createElement('span');
    dot.className = 'ccy-dot';
    dot.style.background = CCY_COLORS[ccy];
    labelTd.appendChild(dot);
    labelTd.appendChild(document.createTextNode(ccy));
    row.appendChild(labelTd);

    [['fx_spot_'+ccy, p.spot, '0.0001', '0.0001'],
     ['fx_fwd_'+ccy,  p.fwd,  '0.0001', '0.0001'],
     ['fx_vol_'+ccy,  p.vol,  '0.1',    '0.1'   ]].forEach(([id, val, step, min]) => {
      const td = document.createElement('td');
      const inp = document.createElement('input');
      inp.type = 'number'; inp.id = id;
      inp.value = val; inp.step = step; inp.min = min;
      inp.addEventListener('input', () => onFxChange(ccy));
      td.appendChild(inp);
      row.appendChild(td);
    });

    tbody.appendChild(row);
  });
}

function onFxChange(ccy) {
  S.fxParams[ccy] = {
    spot: parseFloat(document.getElementById('fx_spot_'+ccy).value) || 1,
    fwd:  parseFloat(document.getElementById('fx_fwd_'+ccy).value) || 1,
    vol:  parseFloat(document.getElementById('fx_vol_'+ccy).value) || 10
  };
  saveState();
}

function renderCorrMatrix() {
  const ccys = S.selectedCcys;
  const tbl = document.getElementById('corr-table');
  if (!tbl) return;
  tbl.innerHTML = '';

  // Header row
  const headRow = document.createElement('tr');
  headRow.appendChild(document.createElement('th'));
  ccys.forEach(c => {
    const th = document.createElement('th');
    th.textContent = c;
    headRow.appendChild(th);
  });
  tbl.appendChild(headRow);

  ccys.forEach((r, i) => {
    const tr = document.createElement('tr');
    const rowTh = document.createElement('th');
    rowTh.textContent = r;
    tr.appendChild(rowTh);

    ccys.forEach((c, j) => {
      const td = document.createElement('td');
      if (i === j) {
        td.className = 'corr-diag';
        td.textContent = '1.000';
      } else {
        // canonical key always uses upper triangle (i < j)
        const [a, b] = i < j ? [r, c] : [c, r];
        const k = corrKey(a, b);
        const v = S.correlations[k] !== undefined ? S.correlations[k] : 0;
        const inp = document.createElement('input');
        inp.type = 'number';
        inp.id = `corr_${r}_${c}`;
        inp.value = v.toFixed(3);
        inp.min = '-1'; inp.max = '1'; inp.step = '0.01';
        inp.addEventListener('input', () => onCorrChange(a, b));
        td.appendChild(inp);
      }
      tr.appendChild(td);
    });

    tbl.appendChild(tr);
  });

  validateCorrMatrix();
}

function onCorrChange(a, b) {
  const k = corrKey(a,b);
  const v = parseFloat(document.getElementById('corr_'+a+'_'+b).value);
  if (!isNaN(v)) {
    S.correlations[k] = Math.max(-1, Math.min(1, v));
    // Mirror
    const mir = document.getElementById('corr_'+b+'_'+a);
    if (mir) mir.value = S.correlations[k].toFixed(3);
    saveState();
  }
  validateCorrMatrix();
}

function buildCorrMatrix() {
  const ccys = S.selectedCcys;
  return ccys.map(r => ccys.map(c => r===c ? 1 : (S.correlations[corrKey(r,c)]||0)));
}

function cholesky(M) {
  const n = M.length;
  const L = Array.from({length:n}, () => new Array(n).fill(0));
  for (let i=0;i<n;i++) {
    for (let j=0;j<=i;j++) {
      let sum=0;
      for (let k=0;k<j;k++) sum += L[i][k]*L[j][k];
      if (i===j) { const v=M[i][i]-sum; if(v<-1e-8) return null; L[i][j]=Math.sqrt(Math.max(0,v)); }
      else L[i][j] = L[j][j]>1e-10 ? (M[i][j]-sum)/L[j][j] : 0;
    }
  }
  return L;
}

function validateCorrMatrix() {
  const M = buildCorrMatrix();
  const L = cholesky(M);
  const el = document.getElementById('corr-status');
  if (!el) return;
  if (L) { el.className='ok'; el.textContent='✓ Correlation matrix is positive semi-definite'; }
  else   { el.className='warn'; el.textContent='⚠ Matrix is not positive semi-definite — check correlations'; }
}

// ============================================================
// TAB 3: SCENARIO COUNT
// ============================================================
function countCombinations(n, steps) {
  // Stars and bars: C(steps + n - 1, n - 1)
  if (n<=0) return 0;
  let num=1, den=1;
  for (let i=0;i<n-1;i++) { num*=(steps+n-1-i); den*=(i+1); }
  return Math.round(num/den);
}

function generateScenarios(allCcys, stepPct) {
  const n = allCcys.length;
  const steps = Math.round(100/stepPct);
  const results = [];
  function recurse(remaining, idx, current) {
    if (idx === n-1) { results.push([...current, remaining]); return; }
    for (let i=0;i<=remaining;i++) recurse(remaining-i, idx+1, [...current,i]);
  }
  recurse(steps, 0, []);
  return results.map(arr => {
    const alloc = {};
    allCcys.forEach((c,i) => alloc[c] = arr[i]*stepPct);
    return alloc;
  });
}

function updateScenarioCount() {
  S.stepSize  = parseInt(document.getElementById('step-size').value);
  S.nSims     = parseInt(document.getElementById('nsims').value);
  S.timeHorizon = parseFloat(document.getElementById('time-horizon').value);
  const allCcys = getAllCcys();
  const n = allCcys.length;
  if (n < 2) {
    document.getElementById('scenario-count').textContent = '—';
    document.getElementById('total-sims').textContent = '—';
    document.getElementById('step-grid').innerHTML = '';
    document.getElementById('scenario-sample-section').style.display = 'none';
    return;
  }
  const cnt = countCombinations(n, Math.round(100/S.stepSize));
  const total = cnt * S.nSims;
  document.getElementById('scenario-count').textContent = cnt.toLocaleString();
  document.getElementById('total-sims').textContent = (total/1e6).toFixed(2)+'M';
  const warn = document.getElementById('scenario-warn');
  if (total > 20e6) {
    warn.style.display='';
    warn.textContent = `\u26a0 ${(total/1e6).toFixed(1)}M ops may be slow. Consider increasing step size or reducing simulations.`;
  } else { warn.style.display='none'; }
  renderStepGrid(allCcys, S.stepSize);
  renderScenarioSample(allCcys, S.stepSize);
}

function renderStepGrid(allCcys, stepPct) {
  const steps = [];
  for (let v = 0; v <= 100; v += stepPct) steps.push(v);
  const nCcys = allCcys.length;
  const leftPad = 52, rightPad = 16, topPad = 24, rowH = 38;
  const W = 560, H = topPad + nCcys * rowH + 8;
  const chartW = W - leftPad - rightPad;

  let svg = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;max-width:${W}px;display:block" xmlns="http://www.w3.org/2000/svg">`;

  // Axis tick labels
  steps.forEach(v => {
    const x = leftPad + (v/100) * chartW;
    svg += `<text x="${x}" y="${topPad - 6}" text-anchor="middle" font-size="10" fill="#a0aec0">${v}%</text>`;
  });

  allCcys.forEach((ccy, i) => {
    const y = topPad + i * rowH + rowH / 2;
    const color = CCY_COLORS[ccy] || '#888';

    // Row background (alternating)
    if (i % 2 === 0) svg += `<rect x="${leftPad}" y="${topPad + i*rowH}" width="${chartW}" height="${rowH}" fill="#f7fafc" rx="2"/>`;

    // Currency label
    svg += `<text x="${leftPad - 8}" y="${y + 4}" text-anchor="end" font-size="12" font-weight="700" fill="${color}">${ccy}</text>`;

    // Track line
    svg += `<line x1="${leftPad}" y1="${y}" x2="${leftPad + chartW}" y2="${y}" stroke="#e2e8f0" stroke-width="1.5"/>`;

    // Dots at each step value
    steps.forEach(v => {
      const x = leftPad + (v/100) * chartW;
      svg += `<circle cx="${x}" cy="${y}" r="5.5" fill="${color}" fill-opacity="0.85" stroke="white" stroke-width="1.5"/>`;
      svg += `<title>${ccy}: ${v}%</title>`;
    });
  });

  svg += '</svg>';
  document.getElementById('step-grid').innerHTML = svg;
}

let _scenarioSampleChart = null;
function renderScenarioSample(allCcys, stepPct) {
  const section = document.getElementById('scenario-sample-section');
  const canvas  = document.getElementById('scenario-sample-chart');
  if (!section || !canvas) return;

  const scenarios = generateScenarios(allCcys, stepPct);
  if (scenarios.length === 0) { section.style.display='none'; return; }
  section.style.display = '';

  // Pick up to 24 evenly-spaced scenarios
  const maxS = Math.min(24, scenarios.length);
  const stride = Math.max(1, Math.floor(scenarios.length / maxS));
  const sample = scenarios.filter((_, i) => i % stride === 0).slice(0, maxS);

  _scenarioSampleChart = safeDestroy(_scenarioSampleChart);

  _scenarioSampleChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: sample.map((sc, i) => {
        // Short label: dominant currency
        const dom = allCcys.reduce((b,c) => (sc[c]||0)>(sc[b]||0)?c:b, allCcys[0]);
        return `${i+1}`;
      }),
      datasets: allCcys.map(ccy => ({
        label: ccy,
        data: sample.map(sc => sc[ccy] || 0),
        backgroundColor: CCY_COLORS[ccy] || '#888',
        borderWidth: 0
      }))
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position:'top', labels:{ boxWidth:10, font:{size:11} } },
        tooltip: { callbacks: {
          title: (items) => `Scenario ${items[0].label}`,
          label: ctx => `${ctx.dataset.label}: ${ctx.raw.toFixed(0)}%`
        }}
      },
      scales: {
        x: { stacked:true, grid:{ display:false },
          title:{ display:true, text:'Scenario (sample)', font:{size:11} },
          ticks:{ font:{size:10} } },
        y: { stacked:true, min:0, max:100,
          title:{ display:true, text:'% of Net Debt', font:{size:11} },
          ticks:{ callback: v => v+'%', font:{size:10} } }
      },
      animation: { duration:0 }
    }
  });
}

// ============================================================
// WEB WORKER (Blob URL)
// ============================================================
const WORKER_SRC = `
// WORKER_SRC_PLACEHOLDER
`;

// ============================================================
// RUN ANALYSIS
// ============================================================
let chartA = null, chartB = null;

function runAnalysis() {
  if (S.selectedCcys.length === 0) { alert('Please select at least one foreign currency.'); return; }
  if (S.nav <= 0 || S.ebitda <= 0 || S.netDebt < 0) {
    alert('Please fix invalid inputs (NAV must be > 0, EBITDA must be > 0, Net Debt must be ≥ 0).'); return;
  }
  const M = buildCorrMatrix();
  if (!cholesky(M)) { alert('Correlation matrix is not valid. Please fix before running.'); return; }

  S.stepSize    = parseInt(document.getElementById('step-size').value);
  S.nSims       = parseInt(document.getElementById('nsims').value);
  S.timeHorizon = parseFloat(document.getElementById('time-horizon').value);

  const allCcys     = getAllCcys();
  const foreignCcys = S.selectedCcys;
  const fwdArr  = foreignCcys.map(c => S.fxParams[c].fwd);
  const volArr  = foreignCcys.map(c => S.fxParams[c].vol / 100);
  const spotArr = foreignCcys.map(c => S.fxParams[c].spot);

  // Build scenarios: existing split first, then grid, then 100% each
  const gridScenarios = generateScenarios(allCcys, S.stepSize);

  // Find or prepend existing split
  const existingAlloc = { ...S.debtAlloc };
  let baseIdx = gridScenarios.findIndex(sc =>
    allCcys.every(c => Math.abs((sc[c]||0) - (existingAlloc[c]||0)) < 0.5)
  );
  let scenarios;
  if (baseIdx >= 0) {
    scenarios = [gridScenarios[baseIdx], ...gridScenarios.filter((_,i)=>i!==baseIdx)];
  } else {
    scenarios = [existingAlloc, ...gridScenarios];
  }

  // Add 100% each currency if not already in grid
  allCcys.forEach(ccy => {
    const single = {};
    allCcys.forEach(c => single[c] = c===ccy?100:0);
    if (!scenarios.find(sc => allCcys.every(c=>Math.abs((sc[c]||0)-(single[c]||0))<0.5)))
      scenarios.push(single);
  });

  // Store for later use
  S.scenarios  = scenarios;
  S.allCcys    = allCcys;
  S.spotArr    = spotArr;

  // UI: show progress
  document.getElementById('run-btn').disabled = true;
  const pw = document.getElementById('progress-wrap');
  pw.style.display = 'flex';
  document.getElementById('progress-fill').style.width = '0%';
  document.getElementById('progress-label').textContent = '0%';

  const blob = new Blob([WORKER_SRC], {type:'application/javascript'});
  const url  = URL.createObjectURL(blob);
  const worker = new Worker(url);

  function workerCleanup() {
    URL.revokeObjectURL(url);
    worker.terminate();
    document.getElementById('run-btn').disabled = false;
    pw.style.display = 'none';
  }

  worker.onerror = function(err) {
    workerCleanup();
    alert('Simulation error: ' + (err.message || 'Unknown error. Check console for details.'));
  };

  worker.postMessage({
    corrMatrix: M, foreignCcys, reportingCcy: S.reportingCcy,
    fwdArr, volArr, spotArr,
    navTotal: S.nav, netDebtTotal: S.netDebt, ebitdaTotal: S.ebitda,
    naAlloc: S.naAlloc, ebitdaAlloc: S.ebitdaAlloc,
    scenarios, nSims: S.nSims, T: S.timeHorizon
  });

  worker.onmessage = function(e) {
    if (e.data.type === 'progress') {
      const pct = e.data.value + '%';
      document.getElementById('progress-fill').style.width = pct;
      document.getElementById('progress-label').textContent = pct;
    } else if (e.data.type === 'error') {
      workerCleanup();
      alert('Simulation error: ' + e.data.message);
    } else if (e.data.type === 'done') {
      workerCleanup();
      S.results     = e.data.results;
      S.chartBounds = {
        xMin: Math.min(...S.results.map(r=>r.de_p1).filter(isFinite)) * 1.1,
        xMax: Math.max(...S.results.map(r=>r.de_p99).filter(isFinite)) * 1.1,
        yMin: Math.max(0, Math.min(...S.results.map(r=>r.lev_p50).filter(isFinite)) * 0.85),
        yMax: Math.max(...S.results.map(r=>r.lev_p99).filter(isFinite)) * 1.1
      };
      S.fxPaths         = e.data.paths;
      S.naLocal         = e.data.naLocal;
      S.ebitdaLocal     = e.data.ebitdaLocal;
      S.naReporting     = e.data.naRep;
      S.ebitdaReporting = e.data.ebitdaRep;
      S.baseEquity      = e.data.baseEq;
      document.getElementById('results-tab-btn').classList.remove('disabled');
      renderResults();
      switchTab('results');
    }
  };
}

// ============================================================
// RESULTS
// ============================================================
function renderResults() {
  renderChartA(0);
  renderChartB();
  renderOverlayControls();
  renderComparisonPanel();
  renderRiskStats(0);
}

// ---------- Chart A ----------
function computeScatterForAlloc(debtAllocRaw) {
  const foreignCcys = S.selectedCcys;
  const debtRep = S.netDebt * (debtAllocRaw[S.reportingCcy]||0) / 100;
  const debtLocal = foreignCcys.map((c,i) => S.netDebt * (debtAllocRaw[c]||0) / 100 / S.spotArr[i]);
  return S.fxPaths.map(fxRates => {
    let na=S.naReporting, eb=S.ebitdaReporting, dt=debtRep;
    for (let i=0;i<foreignCcys.length;i++) {
      na += S.naLocal[i]*fxRates[i];
      eb += S.ebitdaLocal[i]*fxRates[i];
      dt += debtLocal[i]*fxRates[i];
    }
    return {x: na-dt-S.baseEquity, y: eb>0 ? dt/eb : 99};
  });
}

function renderChartA(overlayScIdx) {
  const base = S.results[0];
  const baseData = base.scatterDE.map((de,i)=>({x:de, y:base.scatterLev[i]}));
  const overlayAlloc = S.scenarios[overlayScIdx] || S.scenarios[0];
  const overlayData = computeScatterForAlloc(overlayAlloc);

  const canvas = document.getElementById('chart-a');
  chartA = safeDestroy(chartA);

  const baseLev = S.netDebt / S.ebitda;
  const b = S.chartBounds;

  // Percentile fields for risk lines
  const earPct   = parseInt(document.getElementById('ear-pct')?.value || '99');
  const larPct   = parseInt(document.getElementById('lar-pct')?.value || '99');
  const deField  = {99:'de_p1', 95:'de_p5', 90:'de_p10'}[earPct]  || 'de_p1';
  const levField = {99:'lev_p99',95:'lev_p95',90:'lev_p90'}[larPct] || 'lev_p99';
  const overlayR  = S.results[overlayScIdx] || S.results[0];
  const ear_base    = base[deField]   || 0;   // negative number (loss)
  const ear_overlay = overlayR[deField] || 0;
  const lar_base    = base[levField]   || 0;
  const lar_overlay = overlayR[levField] || 0;

  chartA = new Chart(canvas, {
    type: 'scatter',
    data: { datasets: [
      { label:'Existing Debt Split', data:baseData,
        backgroundColor:'rgba(49,130,206,0.22)', pointRadius:2, pointHoverRadius:4 },
      { label:'Overlay Scenario', data:overlayData,
        backgroundColor:'rgba(221,107,32,0.28)', pointRadius:2, pointHoverRadius:4 }
    ]},
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position:'top', labels:{ boxWidth:12, font:{size:11} } },
        tooltip: { callbacks: { label: ctx => `ΔEq: ${fmt(ctx.parsed.x,1)}M  Lev: ${fmt(ctx.parsed.y,2)}x` }},
        zoom: {
          zoom: { wheel:{enabled:true}, pinch:{enabled:true}, mode:'xy' },
          pan:  { enabled:true, mode:'xy' }
        }
      },
      scales: {
        x: { min:b.xMin, max:b.xMax,
          title:{ display:true, text:`ΔEquity (${S.reportingCcy}M)`, font:{size:11} },
          grid:{ color:'rgba(0,0,0,.05)' } },
        y: { min:b.yMin, max:b.yMax,
          title:{ display:true, text:'Leverage Ratio (x)', font:{size:11} },
          grid:{ color:'rgba(0,0,0,.05)' } }
      },
      animation: { duration:0 }
    },
    plugins: [{
      id:'reflines',
      afterDraw(chart) {
        const {ctx,chartArea:{left,right,top,bottom},scales:{x,y}} = chart;
        ctx.save();

        // Zero / base leverage grey reference lines
        ctx.strokeStyle='rgba(0,0,0,0.15)'; ctx.lineWidth=1; ctx.setLineDash([4,3]);
        const x0=x.getPixelForValue(0);
        if(x0>=left&&x0<=right){ctx.beginPath();ctx.moveTo(x0,top);ctx.lineTo(x0,bottom);ctx.stroke();}
        const yBase=y.getPixelForValue(baseLev);
        if(yBase>=top&&yBase<=bottom){ctx.beginPath();ctx.moveTo(left,yBase);ctx.lineTo(right,yBase);ctx.stroke();}

        function drawRiskLines(earVal, larVal, color) {
          ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.setLineDash([6,4]);
          // EaR vertical line
          const xE = x.getPixelForValue(earVal);
          if(xE>=left&&xE<=right){
            ctx.beginPath();ctx.moveTo(xE,top);ctx.lineTo(xE,bottom);ctx.stroke();
            ctx.fillStyle=color; ctx.font='bold 10px sans-serif';
            ctx.fillText('EaR',xE+3,top+12);
          }
          // LaR horizontal line
          const yL = y.getPixelForValue(larVal);
          if(yL>=top&&yL<=bottom){
            ctx.beginPath();ctx.moveTo(left,yL);ctx.lineTo(right,yL);ctx.stroke();
            ctx.fillStyle=color; ctx.font='bold 10px sans-serif';
            ctx.fillText('LaR',right-28,yL-4);
          }
        }

        // Existing (blue dashed)
        drawRiskLines(ear_base, lar_base, 'rgba(43,108,176,0.75)');
        // Overlay (orange dashed) — only if different scenario
        if(overlayScIdx !== 0) {
          drawRiskLines(ear_overlay, lar_overlay, 'rgba(221,107,32,0.75)');
        }

        ctx.restore();
      }
    }]
  });
}

// ---------- Overlay controls ----------
function renderOverlayControls() {
  const allCcys = S.allCcys;
  const existingAlloc = S.scenarios[0];
  S.overlayAlloc = { ...existingAlloc };

  const container = document.getElementById('overlay-sliders');
  container.innerHTML = '';
  allCcys.forEach(ccy => {
    const val = existingAlloc[ccy] || 0;
    const row = document.createElement('div');
    row.className = 'alloc-row';

    const ccyDiv = document.createElement('div');
    ccyDiv.className = 'alloc-ccy';
    ccyDiv.style.color = CCY_COLORS[ccy] || '#333';
    ccyDiv.textContent = ccy;

    const slider = document.createElement('input');
    slider.type = 'range'; slider.className = 'alloc-slider';
    slider.id = `ov_${ccy}`; slider.min = '0'; slider.max = '100'; slider.step = '1';
    slider.value = val.toFixed(0);
    slider.addEventListener('input', () => onOverlayMove(ccy, parseFloat(slider.value)));

    const valDiv = document.createElement('div');
    valDiv.className = 'alloc-val';
    valDiv.id = `ovv_${ccy}`;
    valDiv.textContent = val.toFixed(0) + '%';

    row.appendChild(ccyDiv);
    row.appendChild(slider);
    row.appendChild(valDiv);
    container.appendChild(row);
  });

  const qb = document.getElementById('quick-btns');
  qb.innerHTML = '';

  const existingBtn = document.createElement('button');
  existingBtn.className = 'quick-btn active';
  existingBtn.textContent = 'Existing';
  existingBtn.addEventListener('click', () => setOverlayToExisting(existingBtn));
  qb.appendChild(existingBtn);

  allCcys.forEach(ccy => {
    const btn = document.createElement('button');
    btn.className = 'quick-btn';
    btn.textContent = `100% ${ccy}`;
    btn.addEventListener('click', () => setOverlayTo100(ccy, btn));
    qb.appendChild(btn);
  });
  updateOverlayMatchLabel(S.scenarios[0]);
}

function onOverlayMove(changedCcy, newVal) {
  const allCcys = S.allCcys;
  const others = allCcys.filter(c => c !== changedCcy);
  const curOtherSum = others.reduce((s,c) => s + (S.overlayAlloc[c]||0), 0);
  const remainder = Math.max(0, 100 - newVal);
  S.overlayAlloc[changedCcy] = newVal;
  if (curOtherSum > 0) {
    others.forEach(c => { S.overlayAlloc[c] = (S.overlayAlloc[c]||0) / curOtherSum * remainder; });
  } else {
    others.forEach(c => { S.overlayAlloc[c] = remainder / others.length; });
  }
  // Refresh slider displays
  allCcys.forEach(c => {
    const sl = document.getElementById('ov_'+c);
    const vl = document.getElementById('ovv_'+c);
    if (sl && c !== changedCcy) sl.value = (S.overlayAlloc[c]||0).toFixed(0);
    if (vl) vl.textContent = (S.overlayAlloc[c]||0).toFixed(0)+'%';
  });
  const nearest = findNearestScenario(S.overlayAlloc);
  const idx = S.scenarios.indexOf(nearest);
  S.overlayScIdx = idx >= 0 ? idx : 0;
  updateOverlayMatchLabel(nearest);
  renderChartA(S.overlayScIdx);
  renderComparisonPanel();
  renderRiskStats(S.overlayScIdx);
  updateChartBSelected(S.overlayScIdx);
  document.querySelectorAll('.quick-btn').forEach(b=>b.classList.remove('active'));
}

function updateOverlayMatchLabel(sc) {
  const allCcys = S.allCcys;
  const el = document.getElementById('overlay-match-label');
  if (!el) return;
  el.textContent = allCcys.map(c => `${c}: ${(sc[c]||0).toFixed(0)}%`).join('  ');
}

function findNearestScenario(targetAlloc) {
  const allCcys = S.allCcys;
  let best = S.scenarios[0], bestDist = Infinity;
  S.scenarios.forEach(sc => {
    const d = allCcys.reduce((s,c)=>s+Math.abs((sc[c]||0)-(targetAlloc[c]||0)),0);
    if (d < bestDist) { bestDist=d; best=sc; }
  });
  return best;
}

function setOverlayAlloc(alloc, btn) {
  S.overlayAlloc = { ...alloc };
  S.allCcys.forEach(c => {
    const sl = document.getElementById('ov_'+c);
    if(sl) sl.value = (alloc[c]||0).toFixed(0);
    const vl = document.getElementById('ovv_'+c);
    if(vl) vl.textContent = (alloc[c]||0).toFixed(0)+'%';
  });
  const nearest = findNearestScenario(alloc);
  const idx = S.scenarios.indexOf(nearest);
  S.overlayScIdx = idx >= 0 ? idx : 0;
  updateOverlayMatchLabel(nearest);
  renderChartA(S.overlayScIdx);
  renderComparisonPanel();
  renderRiskStats(S.overlayScIdx);
  updateChartBSelected(S.overlayScIdx);
  document.querySelectorAll('.quick-btn').forEach(b=>b.classList.remove('active'));
  if(btn) btn.classList.add('active');
}

function setOverlayToExisting(btn) {
  setOverlayAlloc(S.scenarios[0], btn);
}

function setOverlayTo100(ccy, btn) {
  const target = {};
  S.allCcys.forEach(c => target[c] = c===ccy?100:0);
  setOverlayAlloc(target, btn);
}

// ---------- Chart B ----------
function renderChartB() {
  if (!S.results) return;
  const allCcys = S.allCcys;
  const n = allCcys.length;
  const earPct = parseInt(document.getElementById('ear-pct')?.value || '99');
  const larPct = parseInt(document.getElementById('lar-pct')?.value || '99');
  const deField  = {99:'de_p1',  95:'de_p5',  90:'de_p10'}[earPct]  || 'de_p1';
  const levField = {99:'lev_p99',95:'lev_p95',90:'lev_p90'}[larPct] || 'lev_p99';

  const regularPts = [], specialPts = [];
  S.results.forEach((r, idx) => {
    const isBase   = idx === 0;
    const isSingle = allCcys.some(c =>
      (r.debtAlloc[c]||0) >= 99.5 && allCcys.filter(x=>x!==c).every(x=>(r.debtAlloc[x]||0)<0.5)
    );
    // Negate deltaEquity so larger loss = more positive = further right
    const x = -(r[deField] || 0);
    const y =   r[levField] || 0;
    const pt = { x, y, alloc: r.debtAlloc, earPct, larPct };
    if (isBase) {
      specialPts.push({ ...pt, label:'Existing', color:'#1a365d', shape:'circle' });
    } else if (isSingle) {
      const domCcy = allCcys.find(c=>(r.debtAlloc[c]||0)>=99.5);
      specialPts.push({ ...pt, label:`100% ${domCcy}`, color:CCY_COLORS[domCcy]||'#888', shape:'triangle' });
    } else {
      regularPts.push({ ...pt, color:scenarioColor(r.debtAlloc, allCcys) });
    }
  });

  // Selected overlay point
  S._chartBPts = { regularPts, specialPts };
  const selR = S.results[S.overlayScIdx] || S.results[0];
  const selX = -(selR[deField] || 0);
  const selY = selR[levField] || 0;

  const canvas = document.getElementById('chart-b');
  chartB = safeDestroy(chartB);

  chartB = new Chart(canvas, {
    type: 'scatter',
    data: { datasets: [
      { label:'Debt scenarios',
        data: regularPts.map(p=>({x:p.x,y:p.y})),
        backgroundColor: regularPts.map(p=>p.color),
        pointRadius:6, pointHoverRadius:8,
        borderColor: regularPts.map(p=>p.color.replace('rgb','rgba').replace(')',',0.6)')),
        borderWidth:1 },
      { label:'Special',
        data: specialPts.map(p=>({x:p.x,y:p.y})),
        backgroundColor: specialPts.map(p=>p.color),
        pointStyle: specialPts.map(p=>p.shape==='circle'?'circle':'triangle'),
        pointRadius: specialPts.map(p=>p.shape==='circle'?11:9),
        pointHoverRadius:14, borderWidth:3,
        borderColor: specialPts.map(p=>p.shape==='circle'?'white':'#333') },
      { label:'Selected',
        data: [{x:selX, y:selY}],
        backgroundColor: 'rgba(0,0,0,0)',
        pointStyle: 'circle',
        pointRadius: 14, pointHoverRadius: 16,
        borderWidth: 3, borderColor: 'rgba(221,107,32,0.9)' }
    ]},
    options: {
      responsive:true, maintainAspectRatio:false,
      onClick(event, elements) {
        if (!elements.length) return;
        const el = elements[0];
        const dsIdx = el.datasetIndex;
        if (dsIdx === 2) return; // ignore clicks on the selection ring itself
        const pts = dsIdx === 0 ? S._chartBPts.regularPts : S._chartBPts.specialPts;
        const p = pts[el.index];
        if (p && p.alloc) setOverlayAlloc(p.alloc, null);
      },
      plugins: {
        legend:{ display:false },
        tooltip:{ callbacks:{
          label:(ctx) => {
            if (ctx.datasetIndex === 2) return 'Selected overlay scenario';
            const pts = ctx.datasetIndex===0 ? regularPts : specialPts;
            const p = pts[ctx.dataIndex];
            if(!p) return '';
            const allocStr = allCcys.map(c=>`${c}:${(p.alloc[c]||0).toFixed(0)}%`).join(' ');
            const lbl = p.label ? `[${p.label}] ` : '';
            return [
              `${lbl}${allocStr}`,
              `EaR (${p.earPct}%): ${fmt(p.x,1)}M  LaR (${p.larPct}%): ${fmt(p.y,2)}x`
            ];
          }
        }},
        zoom:{
          zoom:{ wheel:{enabled:true}, pinch:{enabled:true}, mode:'xy' },
          pan:{ enabled:true, mode:'xy' }
        }
      },
      scales: {
        x:{ title:{display:true,
              text:`Equity at Risk — ${earPct}th Pctile Loss (${S.reportingCcy}M)`,font:{size:11}},
            grid:{color:'rgba(0,0,0,.05)'} },
        y:{ title:{display:true,
              text:`Leverage at Risk — ${larPct}th Pctile`,font:{size:11}},
            grid:{color:'rgba(0,0,0,.05)'} }
      },
      animation:{ duration:0 }
    }
  });

  // HTML legend (matches chart shapes)
  const leg = document.getElementById('frontier-legend');
  leg.innerHTML = allCcys.map(c =>
    `<div class="legend-item"><div class="legend-dot" style="background:${CCY_COLORS[c]}"></div>${c}</div>`
  ).join('') +
  `<div class="legend-item"><div class="legend-dot" style="background:#1a365d;border:2px solid white;box-shadow:0 0 0 2px #1a365d;border-radius:50%"></div>Existing split</div>` +
  `<div class="legend-item"><span style="font-size:13px">&#9650;</span>&nbsp;100% single currency</div>`;
}

// ---------- Comparison panel ----------
function renderComparisonPanel() {
  if (!S.results || !S.allCcys) return;
  const allCcys = S.allCcys;
  const existing = S.scenarios[0];
  const overlayAlloc = S.overlayAlloc || existing;
  const nearest = findNearestScenario(overlayAlloc);

  ['existing','overlay'].forEach(type => {
    const alloc = type === 'existing' ? existing : nearest;
    const bar = document.getElementById('comp-bar-' + type);
    const lst = document.getElementById('comp-pct-' + type);
    if (!bar || !lst) return;
    bar.innerHTML = allCcys.map(c => {
      const pct = alloc[c] || 0;
      if (pct < 0.5) return '';
      return `<div style="width:${pct}%;background:${CCY_COLORS[c]||'#888'};height:100%;display:flex;align-items:center;justify-content:center;overflow:hidden" title="${c}: ${pct.toFixed(0)}%">` +
             `<span style="font-size:10px;color:white;font-weight:700;white-space:nowrap">${pct>=8?c:''}</span></div>`;
    }).join('');
    lst.innerHTML = allCcys.filter(c=>(alloc[c]||0)>0.5).map(c =>
      `<span style="color:${CCY_COLORS[c]||'#888'};font-weight:700">${c} ${(alloc[c]||0).toFixed(0)}%</span>`
    ).join(' ');
  });
}

// ---------- Risk stats cards ----------
function renderRiskStats(overlayScIdx) {
  const el = document.getElementById('risk-stats-row');
  if (!el || !S.results) return;
  const earPct   = parseInt(document.getElementById('ear-pct')?.value || '99');
  const larPct   = parseInt(document.getElementById('lar-pct')?.value || '99');
  const deField  = {99:'de_p1', 95:'de_p5', 90:'de_p10'}[earPct]  || 'de_p1';
  const levField = {99:'lev_p99',95:'lev_p95',90:'lev_p90'}[larPct] || 'lev_p99';
  const baseR    = S.results[0];
  const overlayR = S.results[overlayScIdx] || S.results[0];
  const ear_base    = -(baseR[deField]   || 0);
  const ear_overlay = -(overlayR[deField] || 0);
  const lar_base    = baseR[levField]    || 0;
  const lar_overlay = overlayR[levField] || 0;

  function deltaArrow(delta, lowerIsBetter) {
    if (Math.abs(delta) < 0.005) return '';
    const better = lowerIsBetter ? delta < 0 : delta > 0;
    const cls    = better ? 'better' : 'worse';
    const arrow  = delta > 0 ? '▲' : '▼';
    const abs    = Math.abs(delta);
    const disp   = abs < 10 ? abs.toFixed(2) : abs.toFixed(1);
    return `<span class="risk-arrow ${cls}">${arrow} ${disp}</span>`;
  }

  const earDelta = ear_overlay - ear_base;
  const larDelta = lar_overlay - lar_base;
  const deDelta  = overlayR.de_p50 - baseR.de_p50;
  const levDelta = overlayR.lev_p50 - baseR.lev_p50;

  el.innerHTML = `
    <div class="risk-block">
      <div class="risk-block-title">Equity at Risk (${earPct}th pctile loss)</div>
      <div class="risk-row">
        <span class="risk-label" style="color:var(--blue)">Existing</span>
        <span class="risk-val">${S.reportingCcy} ${fmt(ear_base,1)}M</span>
      </div>
      <div class="risk-row">
        <span class="risk-label" style="color:#dd6b20">Overlay</span>
        <span class="risk-val">${S.reportingCcy} ${fmt(ear_overlay,1)}M ${deltaArrow(earDelta, true)}</span>
      </div>
    </div>
    <div class="risk-block">
      <div class="risk-block-title">Leverage at Risk (${larPct}th pctile)</div>
      <div class="risk-row">
        <span class="risk-label" style="color:var(--blue)">Existing</span>
        <span class="risk-val">${fmt(lar_base,2)}x</span>
      </div>
      <div class="risk-row">
        <span class="risk-label" style="color:#dd6b20">Overlay</span>
        <span class="risk-val">${fmt(lar_overlay,2)}x ${deltaArrow(larDelta, true)}</span>
      </div>
    </div>
    <div class="risk-block">
      <div class="risk-block-title">Median ΔEquity</div>
      <div class="risk-row">
        <span class="risk-label" style="color:var(--blue)">Existing</span>
        <span class="risk-val">${S.reportingCcy} ${fmt(baseR.de_p50,1)}M</span>
      </div>
      <div class="risk-row">
        <span class="risk-label" style="color:#dd6b20">Overlay</span>
        <span class="risk-val">${S.reportingCcy} ${fmt(overlayR.de_p50,1)}M ${deltaArrow(deDelta, false)}</span>
      </div>
    </div>
    <div class="risk-block">
      <div class="risk-block-title">Median Leverage</div>
      <div class="risk-row">
        <span class="risk-label" style="color:var(--blue)">Existing</span>
        <span class="risk-val">${fmt(baseR.lev_p50,2)}x</span>
      </div>
      <div class="risk-row">
        <span class="risk-label" style="color:#dd6b20">Overlay</span>
        <span class="risk-val">${fmt(overlayR.lev_p50,2)}x ${deltaArrow(levDelta, true)}</span>
      </div>
    </div>`;
}

// ---------- Update Chart B selected marker (no full re-render) ----------
function updateChartBSelected(overlayScIdx) {
  if (!chartB || !S._chartBPts) return;
  const earPct   = parseInt(document.getElementById('ear-pct')?.value || '99');
  const larPct   = parseInt(document.getElementById('lar-pct')?.value || '99');
  const deField  = {99:'de_p1', 95:'de_p5', 90:'de_p10'}[earPct]  || 'de_p1';
  const levField = {99:'lev_p99',95:'lev_p95',90:'lev_p90'}[larPct] || 'lev_p99';
  const r = S.results[overlayScIdx] || S.results[0];
  chartB.data.datasets[2].data = [{x: -(r[deField]||0), y: r[levField]||0}];
  chartB.update('none');
}

// ============================================================
// STATE PERSISTENCE
// ============================================================
const STATE_KEY = 'fx-frontier-state';

const PERSISTED_KEYS = [
  'reportingCcy','netDebt','nav','ebitda','selectedCcys',
  'debtAlloc','ebitdaAlloc','naAlloc','fxParams','correlations',
  'stepSize','nSims','timeHorizon'
];

function saveState() {
  const snapshot = {};
  PERSISTED_KEYS.forEach(k => { snapshot[k] = S[k]; });
  try { localStorage.setItem(STATE_KEY, JSON.stringify(snapshot)); } catch(e) {}
}

function loadState() {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (!raw) return false;
    const saved = JSON.parse(raw);
    PERSISTED_KEYS.forEach(k => { if (saved[k] !== undefined) S[k] = saved[k]; });
    return true;
  } catch(e) { return false; }
}

// ============================================================
// STATIC EVENT BINDINGS
// ============================================================
function initUI() {
  // Tab navigation (event delegation on the tabs bar)
  document.querySelector('.tabs-bar').addEventListener('click', e => {
    const btn = e.target.closest('[data-tab]');
    if (btn) switchTab(btn.dataset.tab);
  });

  // Company parameters
  document.getElementById('reporting-ccy').addEventListener('change', onReportingCcyChange);
  document.getElementById('net-debt').addEventListener('input', onParamsChange);
  document.getElementById('nav').addEventListener('input', onParamsChange);
  document.getElementById('ebitda').addEventListener('input', onParamsChange);

  // Scenario settings
  document.getElementById('step-size').addEventListener('change', updateScenarioCount);
  const nsimsEl = document.getElementById('nsims');
  nsimsEl.addEventListener('input', () => {
    document.getElementById('nsims-label').textContent = Number(nsimsEl.value).toLocaleString();
    updateScenarioCount();
  });

  // Run button
  document.getElementById('run-btn').addEventListener('click', runAnalysis);

  // Reset zoom buttons
  document.getElementById('reset-zoom-a').addEventListener('click', () => { if (chartA) chartA.resetZoom(); });
  document.getElementById('reset-zoom-b').addEventListener('click', () => { if (chartB) chartB.resetZoom(); });

  // Risk percentile selectors
  const onRiskPctChange = () => {
    renderChartB();
    renderChartA(S.overlayScIdx);
    renderRiskStats(S.overlayScIdx);
  };
  document.getElementById('ear-pct').addEventListener('change', onRiskPctChange);
  document.getElementById('lar-pct').addEventListener('change', onRiskPctChange);
}

// ============================================================
// INITIALISE
// ============================================================
function init() {
  initUI();

  const restored = loadState();

  if (restored) {
    // Sync form fields from restored state
    document.getElementById('reporting-ccy').value = S.reportingCcy;
    document.getElementById('net-debt').value = S.netDebt;
    document.getElementById('nav').value = S.nav;
    document.getElementById('ebitda').value = S.ebitda;
    document.getElementById('step-size').value = S.stepSize;
    document.getElementById('nsims').value = S.nSims;
    document.getElementById('nsims-label').textContent = Number(S.nSims).toLocaleString();
    document.getElementById('time-horizon').value = S.timeHorizon;
  } else {
    // First-run defaults
    S.debtAlloc   = { USD:50, EUR:30, GBP:20 };
    S.ebitdaAlloc = { USD:40, EUR:35, GBP:25 };
    S.naAlloc     = { USD:35, EUR:40, GBP:25 };
  }

  renderCcyCheckboxes();
  onParamsChange();

  if (!restored) initAllocations();

  rebuildFxDefaults();
  renderSliders();
  renderFxTable();
  renderCorrMatrix();
  updateScenarioCount();

  document.getElementById('alloc-card').style.display = '';
  document.getElementById('fx-reporting-label').textContent = 'vs ' + S.reportingCcy;
}

window.addEventListener('DOMContentLoaded', init);
