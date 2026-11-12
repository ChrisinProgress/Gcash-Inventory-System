import { analytics, decimal, downloadCsv, formatDate, manilaDateKey, money, report, summarize, transactionDate } from './domain.js';
import { empty, escapeHtml, heading, icon } from './ui.js';

const manila = 'Asia/Manila';
let dashboardRange = 'daily';
let reportPeriod = 'month';
let reportDate;
let chartType = 'bar';

export function resetOverview() {
  dashboardRange = 'daily';
  reportPeriod = 'month';
  reportDate = undefined;
  chartType = 'bar';
}

const count = value => Number(value).toLocaleString('en-PH');

function offsetDate(key, offset) {
  const date = new Date(`${key}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function shortDay(key) {
  return new Intl.DateTimeFormat('en-PH', { weekday: 'short', timeZone: manila }).format(new Date(`${key}T00:00:00+08:00`));
}

function stat(symbol, tone, label, value, note) {
  return `<article class="panel stat"><span class="tile-icon ${tone}">${icon(symbol, 19)}</span><p>${label}</p><strong>${value}</strong><small>${note}</small></article>`;
}

function chartHtml(series, type = 'bar') {
  if (!series.length || series.every(item => item.profit === 0)) {
    return empty('No profit for this period', 'Completed service charges will appear here.', 'chart-column');
  }
  const max = Math.max(...series.map(item => item.profit), 100);
  const stepBase = 10 ** Math.floor(Math.log10(max / 4));
  const step = Math.ceil(max / (stepBase * 4)) * stepBase;
  const limit = step * 4;
  const tickMoney = new Intl.NumberFormat('en-PH', { notation: 'compact', maximumFractionDigits: 2 });
  const levels = [4, 3, 2, 1, 0].map(level => `<span>₱${tickMoney.format(level * step / 100)}</span>`).join('');
  const points = series.map((item, index) => {
    const x = (index + 0.5) / series.length * 1000;
    const y = 208 - item.profit / limit * 208;
    return `${x},${y}`;
  });
  const labelsEvery = Math.max(1, Math.ceil(series.length / 9));
  const active = series.map(item => item.profit).lastIndexOf(Math.max(...series.map(item => item.profit)));
  const columns = series.map((item, index) => {
    const label = escapeHtml(item.label);
    const showLabel = index % labelsEvery === 0 && (labelsEvery === 1 || index <= series.length - labelsEvery) || index === series.length - 1;
    const mobileLabel = labelsEvery === 1 || index % (labelsEvery * 2) === 0 || index === series.length - 1;
    const height = item.profit / limit * 100;
    return `<div class="chart-column"><button type="button" class="chart-hit${index === active ? ' chart-highlight' : ''}" style="--profit-height:${height}%" aria-label="${label}, ${money(item.profit)}" data-chart-label="${label}" data-chart-value="${money(item.profit)}"><span></span></button><span class="chart-x${mobileLabel ? '' : ' chart-x-desktop'}">${showLabel ? label : ''}</span></div>`;
  }).join('');
  const line = type === 'line' ? `<svg class="chart-line" viewBox="0 0 1000 208" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="profit-area" x1="0" x2="0" y1="0" y2="1" gradientUnits="objectBoundingBox"><stop stop-color="#007dfe" stop-opacity=".22"/><stop offset="1" stop-color="#007dfe" stop-opacity="0"/></linearGradient></defs><polygon points="0,208 ${points.join(' ')} 1000,208" fill="url(#profit-area)"/><polyline points="${points.join(' ')}" fill="none" stroke="var(--blue)" stroke-width="3" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"/></svg>` : '';
  return `<div class="profit-chart" data-chart-type="${type}"><div class="chart-axis" aria-hidden="true">${levels}</div><div class="chart-body"><div class="chart-grid" aria-hidden="true">${'<i></i>'.repeat(5)}</div>${line}<div class="chart-columns">${columns}</div><div class="chart-tooltip" role="status" hidden></div></div></div>`;
}

function bindChart(main) {
  const tooltip = main.querySelector('.chart-tooltip');
  if (!tooltip) return;
  const body = tooltip.parentElement;
  function show(button) {
    const area = body.getBoundingClientRect();
    const hit = button.getBoundingClientRect();
    tooltip.textContent = `${button.dataset.chartLabel} · ${button.dataset.chartValue}`;
    tooltip.hidden = false;
    const halfWidth = tooltip.offsetWidth / 2;
    const center = hit.left + hit.width / 2 - area.left;
    tooltip.style.left = `${Math.min(area.width - halfWidth, Math.max(halfWidth, center))}px`;
  }
  for (const button of main.querySelectorAll('.chart-hit')) {
    button.addEventListener('pointerenter', () => show(button));
    button.addEventListener('focus', () => show(button));
    button.addEventListener('click', () => show(button));
    button.addEventListener('blur', () => { tooltip.hidden = true; });
  }
  body.addEventListener('pointerleave', () => { tooltip.hidden = true; });
}

function periodTabs(options, active, label) {
  return `<div class="segmented" role="group" aria-label="${label}">${options.map(([key, title]) => `<button type="button" data-period="${key}" aria-pressed="${key === active}">${title}</button>`).join('')}</div>`;
}

function recentRows(transactions) {
  if (!transactions.length) return empty('No transactions yet', 'Your most recent cash-ins and cash-outs will appear here.');
  return `<div class="table-wrap"><table class="data-table"><thead><tr><th>Transaction</th><th>Customer</th><th>Date</th><th>Amount</th><th>Service charge</th><th>Status</th></tr></thead><tbody>${transactions.slice().sort((a, b) => b.createdAt - a.createdAt).slice(0, 5).map(transaction => {
    const cashIn = transaction.type === 'cash-in';
    return `<tr><td><div class="table-identity"><span class="tile-icon ${cashIn ? 'tone-green' : 'tone-blue'}">${icon(cashIn ? 'arrow-down-left' : 'arrow-up-right', 17)}</span><span><strong>${cashIn ? 'Cash In' : 'Cash Out'}</strong><small>${escapeHtml(transaction.reference || transaction.id)}</small></span></div></td><td>${escapeHtml(transaction.customer)}</td><td>${escapeHtml(formatDate(transactionDate(transaction)))}</td><td><strong>${money(transaction.amount)}</strong></td><td>${money(transaction.fee)}</td><td><span class="pill ${transaction.status === 'voided' ? 'pill-danger' : 'pill-success'}">${transaction.status === 'voided' ? 'Voided' : 'Completed'}</span></td></tr>`;
  }).join('')}</tbody></table></div>`;
}

export function renderDashboard(ctx) {
  const { main, state, transactions } = ctx;
  const today = manilaDateKey();
  const totals = summarize(transactions);
  const day = report(transactions, { period: 'day', date: today });
  const month = report(transactions, { period: 'month', date: today });
  const year = report(transactions, { period: 'year', date: today });
  const weekStart = offsetDate(today, -6);
  let series = year.series;
  if (dashboardRange === 'daily') {
    const days = new Map(Array.from({ length: 7 }, (_, index) => {
      const date = offsetDate(weekStart, index);
      return [date, { label: shortDay(date), profit: 0 }];
    }));
    for (const transaction of transactions) {
      if (transaction.status !== 'completed') continue;
      const bucket = days.get(transactionDate(transaction));
      if (bucket) bucket.profit += transaction.profit;
    }
    series = [...days.values()];
  } else if (dashboardRange === 'yearly') {
    series = report(transactions, { period: 'all', date: today }).series;
  }
  const chartSubtitle = { daily: `${formatDate(weekStart)} – ${formatDate(today)}`, monthly: `Monthly service charges in ${today.slice(0, 4)}`, yearly: 'Annual service charges across all years' }[dashboardRange];
  const balance = (symbol, label, value) => `<div class="hero-balance"><span class="hero-icon">${icon(symbol, 21)}</span><div><span>${label}</span><strong>${money(value)}</strong>${value < 0 ? '<small>Below zero</small>' : ''}</div></div>`;
  const profitRows = [ ['Today', 'calendar-days', 'tone-blue', day], ['This month', 'chart-column', 'tone-green', month], ['This year', 'trending-up', 'tone-purple', year] ];

  main.innerHTML = `${heading('Dashboard', 'Monitor your balances, transactions, and service-charge earnings.', `<a class="btn btn-primary" href="#new-transaction">${icon('plus', 19)} New transaction</a>`)}
    <section class="balance-hero" aria-labelledby="hero-title"><div class="hero-heading"><h2 id="hero-title">Available balances</h2><a href="#balances">Manage balances ${icon('arrow-right', 16)}</a></div><div class="hero-balances">${balance('banknote', 'Cash on hand', state.cash)}${balance('wallet', 'GCash wallet', state.wallet)}</div></section>
    <section class="stats-grid" aria-label="All-time totals">${stat('arrow-down-left', 'tone-green', 'Total cash in', money(totals.cashInAmount), `${count(totals.cashInCount)} completed cash-ins`)}${stat('arrow-up-right', 'tone-blue', 'Total cash out', money(totals.cashOutAmount), `${count(totals.cashOutCount)} completed cash-outs`)}${stat('receipt', 'tone-purple', 'Total transactions', count(totals.count), 'Completed · all time')}${stat('trending-up', 'tone-amber', 'Accumulated profit', money(totals.profit), 'Service charges · all time')}</section>
    <div class="dashboard-grid"><section class="panel profit-panel" aria-labelledby="profit-title"><div class="panel-heading"><div><h2 id="profit-title">Profit overview</h2><p>${escapeHtml(chartSubtitle)}</p></div>${periodTabs([['daily', 'Daily'], ['monthly', 'Monthly'], ['yearly', 'Yearly']], dashboardRange, 'Chart range')}</div>${chartHtml(series, dashboardRange === 'daily' ? 'bar' : 'line')}</section>
    <section class="panel earnings-panel" aria-labelledby="earnings-title"><div class="panel-heading"><div><h2 id="earnings-title">Profit summary</h2><p>Gross service-charge earnings</p></div><span class="tile-icon tone-green">${icon('trending-up', 19)}</span></div><div class="earnings-list">${profitRows.map(([label, symbol, tone, period]) => `<div class="earnings-row"><span class="tile-icon ${tone}">${icon(symbol, 17)}</span><span>${label}</span><strong>${money(period.current.profit)}</strong></div>`).join('')}</div><a class="panel-link" href="#reports">View profit reports ${icon('arrow-right', 17)}</a></section></div>
    <section class="panel recent-panel" aria-labelledby="recent-title"><div class="panel-heading"><div><h2 id="recent-title">Recent transactions</h2><p>Latest activity in your ledger</p></div><a class="btn btn-secondary btn-small" href="#history">View history ${icon('arrow-right', 16)}</a></div>${recentRows(transactions)}</section>`;
  for (const button of main.querySelectorAll('[data-period]')) {
    button.addEventListener('click', () => {
      dashboardRange = button.dataset.period;
      renderDashboard(ctx);
      main.querySelector(`[data-period="${dashboardRange}"]`).focus();
    });
  }
  bindChart(main);
}

function comparisonText(data) {
  if (!data.previous) return 'All completed transactions';
  if (!data.profitChange) return `No change from ${data.previousLabel}`;
  const prefix = data.profitChange > 0 ? '+' : '−';
  const percent = data.profitChangePercent === null ? '' : ` (${prefix}${Math.abs(data.profitChangePercent).toLocaleString('en-PH', { maximumFractionDigits: 1 })}%)`;
  return `${prefix}${money(Math.abs(data.profitChange))}${percent} vs ${data.previousLabel}`;
}

export function renderReports(ctx) {
  const { main, transactions } = ctx;
  const date = reportDate ?? manilaDateKey();
  const data = report(transactions, { period: reportPeriod, date });
  const totals = data.current;
  const insights = analytics(data.transactions);
  const picker = {
    day: `<label class="field">Date<input id="report-date" type="date" min="1900-01-01" max="9998-12-31" value="${date}"></label>`,
    week: `<label class="field">Date within week<input id="report-date" type="date" min="1900-01-01" max="9998-12-31" value="${date}"></label>`,
    month: `<label class="field">Month<input id="report-date" type="month" min="1900-01" max="9998-12" value="${date.slice(0, 7)}"></label>`,
    year: `<label class="field">Year<input id="report-date" type="number" min="1900" max="9998" step="1" value="${date.slice(0, 4)}"></label>`,
    all: '',
  }[reportPeriod];
  const comparison = comparisonText(data);
  const insight = (title, values, itemLabel) => `<section class="panel insight-panel"><div class="panel-heading"><h2>${title}</h2></div>${values.length ? `<ul class="insight-list">${values.map(item => `<li><span>${itemLabel(item)}</span><strong>${count(item.count)} ${item.count === 1 ? 'transaction' : 'transactions'}</strong></li>`).join('')}</ul>` : empty('No activity', 'Completed transactions will appear here.', 'chart-column')}</section>`;
  const actions = `<button class="btn btn-secondary" id="print-report" type="button">${icon('printer', 18)} Print</button><button class="btn btn-primary" id="export-report" type="button">${icon('download', 18)} Export CSV</button>`;
  main.innerHTML = `${heading('Profit reports', 'Review transaction volume and earnings in Philippine time.', actions)}
    <section class="panel report-controls" aria-label="Report filters">${periodTabs([['day', 'Daily'], ['week', 'Weekly'], ['month', 'Monthly'], ['year', 'Yearly'], ['all', 'All time']], reportPeriod, 'Report period')}${picker}</section>
    <div class="report-label"><h2>${escapeHtml(data.label)}</h2><span>Asia/Manila</span></div>
    <section class="stats-grid" aria-label="Period totals">${stat('arrow-down-left', 'tone-green', 'Cash in', money(totals.cashInAmount), `${count(totals.cashInCount)} transactions`)}${stat('arrow-up-right', 'tone-blue', 'Cash out', money(totals.cashOutAmount), `${count(totals.cashOutCount)} transactions`)}${stat('receipt', 'tone-purple', 'Service charges', money(totals.fees), `${count(totals.count)} total transactions`)}${stat('trending-up', 'tone-amber', 'Gross profit', money(totals.profit), escapeHtml(comparison))}</section>
    <section class="panel profit-panel report-chart"><div class="panel-heading"><div><h2>Profit trend</h2><p>${escapeHtml(comparison)}${data.previous ? ` · Previous profit ${money(data.previous.profit)}` : ''}</p></div><div class="segmented" role="group" aria-label="Chart type"><button type="button" data-chart="bar" aria-pressed="${chartType === 'bar'}" aria-label="Bar chart">${icon('chart-column', 18)}<span>Bar</span></button><button type="button" data-chart="line" aria-pressed="${chartType === 'line'}" aria-label="Line chart">${icon('chart-line', 18)}<span>Line</span></button></div></div>${chartHtml(data.series, chartType)}</section>
    <div class="insights-grid">${insight('Most frequent amounts', insights.frequentAmounts, item => money(item.amount))}${insight('Most active days', insights.activeDays, item => escapeHtml(formatDate(item.date)))}</div>`;

  for (const button of main.querySelectorAll('[data-period], [data-chart]')) {
    button.addEventListener('click', () => {
      if (button.dataset.period) reportPeriod = button.dataset.period;
      if (button.dataset.chart) chartType = button.dataset.chart;
      renderReports(ctx);
      main.querySelector(button.dataset.period ? `[data-period="${reportPeriod}"]` : `[data-chart="${chartType}"]`).focus();
    });
  }
  main.querySelector('#report-date')?.addEventListener('change', event => {
    if (!event.target.value || !event.target.checkValidity()) return;
    const value = event.target.value;
    reportDate = reportPeriod === 'year' ? `${event.target.valueAsNumber}-01-01` : reportPeriod === 'month' ? `${value}-01` : value;
    renderReports(ctx);
    main.querySelector('#report-date')?.focus();
  });
  main.querySelector('#print-report').addEventListener('click', () => window.print());
  main.querySelector('#export-report').addEventListener('click', () => {
    downloadCsv(`gcash-profit-${reportPeriod}-${date}.csv`, ['Metric', 'Value'], [
      ['Period', data.label], ['Timezone', manila], ['Cash-in transactions', totals.cashInCount], ['Cash-in amount (PHP)', decimal(totals.cashInAmount)], ['Cash-out transactions', totals.cashOutCount], ['Cash-out amount (PHP)', decimal(totals.cashOutAmount)], ['Service charges (PHP)', decimal(totals.fees)], ['Gross profit (PHP)', decimal(totals.profit)], ['Total transactions', totals.count],
      ...(data.previous ? [['Previous period', data.previousLabel], ['Previous profit (PHP)', decimal(data.previous.profit)], ['Profit change (PHP)', decimal(data.profitChange)], ['Profit change (%)', data.profitChangePercent ?? '']] : []),
      [], ['Interval', 'Gross profit (PHP)', 'Transaction count', 'Cash-in amount (PHP)', 'Cash-out amount (PHP)'],
      ...data.series.map(item => [item.label, decimal(item.profit), item.count, decimal(item.cashInAmount), decimal(item.cashOutAmount)]),
    ]);
    ctx.toast('Profit report exported.');
  });
  bindChart(main);
}
