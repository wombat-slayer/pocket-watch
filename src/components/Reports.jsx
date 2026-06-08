import { useRef, useState, useMemo } from 'react';
import { catColor, catIcon, fmt, thisMonth, isDebtType, CHART } from '../constants.js';
import { useChart } from '../hooks/useChart.js';
import { useCurrency } from '../hooks/useCurrency.js';
import { usePrivacy } from '../context/PrivacyContext.jsx';

export default function Reports({ transactions, accounts = [], netWorthHistory = [], budgets = [], onCategoryDrillDown, initialTab }) {
  const cfmt = useCurrency();
  const privacy = usePrivacy();
  const fmtK = v => privacy ? '••••' : '$' + (Math.abs(v) >= 1000 ? (v / 1000).toFixed(1) + 'k' : v);
  const canvasCat       = useRef(null);
  const canvasTrend     = useRef(null);
  const canvasYoY       = useRef(null);
  const canvasCatTrend  = useRef(null);
  const canvasNWHist    = useRef(null);

  // months: number = last N months, null = all time
  const [months,    setMonths]    = useState(6);
  const [tab,       setTab]       = useState(initialTab ?? 'trend');
  const [tagFilter, setTagFilter] = useState('All');
  const [taxYear,   setTaxYear]   = useState(() => new Date().getFullYear());

  const allTags = useMemo(() => {
    const set = new Set();
    transactions.forEach(t => (t.tags || []).forEach(tag => set.add(tag)));
    return ['All', ...Array.from(set).sort()];
  }, [transactions]);

  const filteredTransactions = useMemo(() =>
    tagFilter === 'All'
      ? transactions
      : transactions.filter(t => (t.tags || []).includes(tagFilter))
  , [transactions, tagFilter]);

  // ── Month range ────────────────────────────────────────────────────────────
  // When months===null: derive range from actual transaction dates
  const last = useMemo(() => {
    if (months !== null) {
      return Array.from({length: months}, (_, i) => {
        const d = new Date(); d.setMonth(d.getMonth() - (months - 1 - i));
        return { m: d.toISOString().slice(0, 7), label: d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }) };
      });
    }
    // All time: build from actual transaction dates
    const allMonths = [...new Set(filteredTransactions.map(t => t.date.slice(0, 7)))].sort();
    if (!allMonths.length) return [];
    const start = new Date(allMonths[0] + '-01');
    const end   = new Date();
    const result = [];
    const cur = new Date(start);
    while (cur <= end) {
      const m = cur.toISOString().slice(0, 7);
      result.push({ m, label: cur.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }) });
      cur.setMonth(cur.getMonth() + 1);
    }
    return result;
  }, [months, filteredTransactions]);

  const cutoff = last[0]?.m ?? thisMonth();

  // ── Category totals (for bar + export) ────────────────────────────────────
  const catTotals = useMemo(() => {
    const map = {};
    filteredTransactions
      .filter(t => t.type === 'expense' && t.date.slice(0, 7) >= cutoff && t.category !== 'Transfer')
      .forEach(t => { map[t.category] = (map[t.category] || 0) + Math.abs(t.amount); });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [filteredTransactions, cutoff]);

  // ── Monthly trend ──────────────────────────────────────────────────────────
  const trendData = useMemo(() => last.map(({ m, label }) => ({
    label,
    spend:  filteredTransactions.filter(t => t.type === 'expense' && t.date.startsWith(m) && t.category !== 'Transfer').reduce((s, t) => s + Math.abs(t.amount), 0),
    income: filteredTransactions.filter(t => t.type === 'income'  && t.date.startsWith(m) && t.category !== 'Transfer').reduce((s, t) => s + t.amount, 0),
  })), [filteredTransactions, last]);

  const n          = trendData.length || 1;
  const avgSpend   = trendData.reduce((s, r) => s + r.spend,  0) / n;
  const avgIncome  = trendData.reduce((s, r) => s + r.income, 0) / n;
  const avgSavings = avgIncome - avgSpend;

  // ── YoY data ───────────────────────────────────────────────────────────────
  const yoyData = useMemo(() => {
    const thisYear = new Date().getFullYear();
    // Detect all years present in transactions
    const years = [...new Set(transactions.map(t => parseInt(t.date.slice(0, 4))))].sort().reverse().slice(0, 3);
    return Array.from({ length: 12 }, (_, i) => {
      const label = new Date(2000, i).toLocaleDateString('en-US', { month: 'short' });
      const mm    = String(i + 1).padStart(2, '0');
      const entry = { label };
      years.forEach(y => {
        entry[y] = transactions
          .filter(t => t.type === 'expense' && t.date.startsWith(`${y}-${mm}`))
          .reduce((s, t) => s + Math.abs(t.amount), 0);
      });
      return { ...entry, years };
    });
  }, [transactions]);

  const yoyYears = useMemo(() => {
    return [...new Set(transactions.map(t => parseInt(t.date.slice(0, 4))))].sort().reverse().slice(0, 3);
  }, [transactions]);

  // ── Category trends (top 5 categories as lines over months) ───────────────
  const catTrendData = useMemo(() => {
    // Top 5 categories by total spend in range
    const top5 = catTotals.slice(0, 5).map(([c]) => c);
    return {
      months: last,
      series: top5.map(cat => ({
        cat,
        data: last.map(({ m }) =>
          filteredTransactions
            .filter(t => t.type === 'expense' && t.category === cat && t.date.startsWith(m))
            .reduce((s, t) => s + Math.abs(t.amount), 0)
        ),
      })),
    };
  }, [filteredTransactions, last, catTotals]);

  // ── Net worth history (actual snapshots + backward reconstruction) ─────────
  const nwHistoryData = useMemo(() => {
    // Step 1: build map of actual daily snapshots → collapse to month-end
    const snapMap = {};
    netWorthHistory.forEach(h => {
      const mo = h.date.slice(0, 7);
      if (!snapMap[mo] || h.date > snapMap[mo].date) snapMap[mo] = h;
    });

    // Step 2: compute current net worth from accounts
    const currentNW = accounts.reduce((s, a) => isDebtType(a.type) ? s - a.balance : s + a.balance, 0);

    // Step 3: get all months we have transaction data for (that predate history)
    const allTxMonths = [...new Set(transactions.map(t => t.date.slice(0, 7)))].sort();
    const earliestSnap = Object.keys(snapMap).sort()[0];

    // Step 4: reconstruct net worth for months before history starts
    // NW[month-1] = NW[month] - netFlow[month]
    const reconstructed = {};
    if (allTxMonths.length > 0) {
      // Build net flow per month from transactions
      const netFlowByMonth = {};
      transactions.forEach(t => {
        const mo = t.date.slice(0, 7);
        netFlowByMonth[mo] = (netFlowByMonth[mo] || 0) + t.amount;
      });

      // Start from the earliest known snapshot or current NW
      let runningNW = earliestSnap ? snapMap[earliestSnap].netWorth : currentNW;
      const startMonth = earliestSnap ?? (new Date().toISOString().slice(0, 7));

      // Walk backwards through months that predate our history
      const monthsBefore = allTxMonths.filter(m => m < startMonth).reverse();
      for (const mo of monthsBefore) {
        runningNW = runningNW - (netFlowByMonth[mo] || 0);
        reconstructed[mo] = runningNW;
      }
    }

    // Step 5: merge — prefer actual snapshots, fill gaps with reconstruction
    const allMonths = [
      ...new Set([
        ...Object.keys(reconstructed),
        ...Object.keys(snapMap),
      ]),
    ].sort();

    return allMonths.map(mo => ({
      label: new Date(mo + '-15').toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
      value:      snapMap[mo]?.netWorth ?? reconstructed[mo] ?? currentNW,
      isActual:   !!snapMap[mo],
    }));
  }, [netWorthHistory, accounts, transactions]);

  // ── Tax summary data ───────────────────────────────────────────────────────
  const taxYears = useMemo(() => {
    const years = [...new Set(transactions.map(t => parseInt(t.date.slice(0, 4))))].sort().reverse();
    return years.length ? years : [new Date().getFullYear()];
  }, [transactions]);

  const taxData = useMemo(() => {
    const yearStr = String(taxYear);
    const deductible = transactions.filter(t =>
      !!t.taxDeductible && t.date.startsWith(yearStr)
    );
    // Group by category
    const byCat = {};
    deductible.forEach(t => {
      const cat = t.category || 'Other';
      if (!byCat[cat]) byCat[cat] = { total: 0, txs: [] };
      byCat[cat].total += Math.abs(t.amount);
      byCat[cat].txs.push(t);
    });
    const rows = Object.entries(byCat).sort((a, b) => b[1].total - a[1].total);
    const grandTotal = deductible.reduce((s, t) => s + Math.abs(t.amount), 0);
    return { deductible, rows, grandTotal };
  }, [transactions, taxYear]);

  // ── This Week ──────────────────────────────────────────────────────────────
  const weekRange = useMemo(() => {
    const now = new Date();
    const sun = new Date(now); sun.setDate(now.getDate() - now.getDay()); sun.setHours(0,0,0,0);
    const sat = new Date(sun); sat.setDate(sun.getDate() + 6);
    const toISO = d => d.toISOString().slice(0, 10);
    return {
      start: toISO(sun),
      end:   toISO(sat),
      label: `${sun.toLocaleDateString('en-US',{month:'short',day:'numeric'})} – ${sat.toLocaleDateString('en-US',{month:'short',day:'numeric'})}`,
    };
  }, []);

  const weekExpenses = useMemo(() =>
    transactions.filter(t => t.type === 'expense' && t.date >= weekRange.start && t.date <= weekRange.end)
  , [transactions, weekRange]);

  const weekTotal = useMemo(() => weekExpenses.reduce((s,t) => s + Math.abs(t.amount), 0), [weekExpenses]);

  const weekCatBreakdown = useMemo(() => {
    const map = {};
    weekExpenses.forEach(t => { map[t.category] = (map[t.category] || 0) + Math.abs(t.amount); });
    return Object.entries(map).sort((a,b) => b[1]-a[1]);
  }, [weekExpenses]);

  const weekLargestCat = weekCatBreakdown[0];

  const weekBudgetContext = useMemo(() => {
    const m = weekRange.start.slice(0, 7);
    const monthBudgets = budgets.filter(b => b.month === m);
    return weekCatBreakdown.map(([cat, spent]) => {
      const bud = monthBudgets.find(b => b.category === cat);
      // month-to-date spend for this category (for budget pct)
      const mtdSpent = transactions
        .filter(t => t.type === 'expense' && t.date.startsWith(m) && t.category === cat)
        .reduce((s,t) => s + Math.abs(t.amount), 0);
      return { cat, weekSpent: spent, mtdSpent, budget: bud?.amount ?? null };
    });
  }, [weekCatBreakdown, weekRange, transactions, budgets]);

  // ── Color palette for category trend lines ─────────────────────────────────
  const LINE_COLORS = [CHART.income, CHART.expense, CHART.primary, CHART.amber, CHART.secondary];

  // ── Charts ─────────────────────────────────────────────────────────────────
  useChart(canvasCat, () => ({
    type: 'bar',
    data: {
      labels: catTotals.slice(0, 8).map(([c]) => `${catIcon(c)} ${c}`),
      datasets: [{
        data: catTotals.slice(0, 8).map(([, v]) => v),
        backgroundColor: catTotals.slice(0, 8).map(([c]) => catColor(c) + 'cc'),
        borderRadius: 6, borderWidth: 0,
      }],
    },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      onClick: (evt, elements) => {
        if (!elements.length || !onCategoryDrillDown) return;
        const cat = catTotals.slice(0, 8)[elements[0].index]?.[0];
        if (cat) onCategoryDrillDown(cat);
      },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => ` ${cfmt(ctx.raw)}` } } },
      scales: {
        x: { grid: { color: CHART.gridLine }, ticks: { color: CHART.gridLabel, callback: fmtK } },
        y: { grid: { display: false }, ticks: { color: CHART.gridLabel } },
      },
    },
  }), [JSON.stringify(catTotals), months, cfmt]);

  useChart(canvasTrend, () => ({
    type: 'line',
    data: {
      labels: trendData.map(r => r.label),
      datasets: [
        { label: 'Income',   data: trendData.map(r => r.income), borderColor: CHART.income, backgroundColor: CHART.income + '22', tension: 0.4, fill: true, pointBackgroundColor: CHART.income, pointRadius: trendData.length > 24 ? 2 : 4 },
        { label: 'Spending', data: trendData.map(r => r.spend),  borderColor: CHART.expense, backgroundColor: CHART.expense + '22', tension: 0.4, fill: true, pointBackgroundColor: CHART.expense, pointRadius: trendData.length > 24 ? 2 : 4 },
        { label: 'Net',      data: trendData.map(r => r.income - r.spend), borderColor: CHART.primary, backgroundColor: 'transparent', tension: 0.4, fill: false, borderDash: [5, 4], pointBackgroundColor: CHART.primary, borderWidth: 2, pointRadius: trendData.length > 24 ? 2 : 4 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: CHART.gridLabel } }, tooltip: { callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${cfmt(ctx.raw)}` } } },
      scales: {
        x: { grid: { color: CHART.gridLine }, ticks: { color: CHART.gridLabel, maxTicksLimit: months === null ? 16 : 12 } },
        y: { grid: { color: CHART.gridLine }, ticks: { color: CHART.gridLabel, callback: fmtK } },
      },
    },
  }), [JSON.stringify(trendData), months, cfmt]);

  useChart(canvasYoY, () => ({
    type: 'bar',
    data: {
      labels: yoyData.map(r => r.label),
      datasets: yoyYears.map((y, i) => ({
        label: String(y),
        data: yoyData.map(r => r[y] || 0),
        backgroundColor: i === 0 ? CHART.expense + 'cc' : i === 1 ? CHART.gridLabel + '66' : CHART.income + '55',
        borderRadius: 4, borderWidth: 0,
      })),
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: CHART.gridLabel } }, tooltip: { callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${cfmt(ctx.raw)}` } } },
      scales: {
        x: { grid: { color: CHART.gridLine }, ticks: { color: CHART.gridLabel } },
        y: { grid: { color: CHART.gridLine }, ticks: { color: CHART.gridLabel, callback: fmtK } },
      },
    },
  }), [JSON.stringify(yoyData), cfmt]);

  useChart(canvasCatTrend, () => ({
    type: 'line',
    data: {
      labels: catTrendData.months.map(m => m.label),
      datasets: catTrendData.series.map((s, i) => ({
        label: s.cat,
        data: s.data,
        borderColor: LINE_COLORS[i],
        backgroundColor: LINE_COLORS[i] + '22',
        tension: 0.4,
        fill: false,
        pointBackgroundColor: LINE_COLORS[i],
        pointRadius: catTrendData.months.length > 24 ? 2 : 4,
        borderWidth: 2,
      })),
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: CHART.gridLabel } }, tooltip: { callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${cfmt(ctx.raw)}` } } },
      scales: {
        x: { grid: { color: CHART.gridLine }, ticks: { color: CHART.gridLabel, maxTicksLimit: 16 } },
        y: { grid: { color: CHART.gridLine }, ticks: { color: CHART.gridLabel, callback: fmtK }, min: 0 },
      },
    },
  }), [JSON.stringify(catTrendData), cfmt]);

  useChart(canvasNWHist, () => ({
    type: 'line',
    data: {
      labels: nwHistoryData.map(d => d.label),
      datasets: [
        {
          label: 'Net Worth',
          data: nwHistoryData.map(d => d.isActual ? d.value : null),
          borderColor: CHART.income,
          backgroundColor: CHART.income + '22',
          tension: 0.3, fill: true,
          pointRadius: nwHistoryData.length > 24 ? 2 : 4,
          pointBackgroundColor: CHART.income,
          spanGaps: false,
        },
        {
          label: 'Estimated (reconstructed)',
          data: nwHistoryData.map(d => !d.isActual ? d.value : null),
          borderColor: CHART.income + '77',
          backgroundColor: CHART.income + '11',
          borderDash: [6, 4],
          tension: 0.3, fill: false,
          pointRadius: nwHistoryData.length > 24 ? 2 : 3,
          pointBackgroundColor: CHART.income + '77',
          spanGaps: false,
        },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: CHART.gridLabel } },
        tooltip: { callbacks: { label: (ctx) => ` Net Worth: ${cfmt(ctx.raw)}` } },
      },
      scales: {
        x: { grid: { color: CHART.gridLine }, ticks: { color: CHART.gridLabel, maxTicksLimit: 16 } },
        y: { grid: { color: CHART.gridLine }, ticks: { color: CHART.gridLabel, callback: fmtK } },
      },
    },
  }), [JSON.stringify(nwHistoryData), cfmt]);

  // ── PDF export ─────────────────────────────────────────────────────────────
  const exportPDF = () => {
    const rangeLabel = months === null ? 'All Time' : `Last ${months} Months`;
    const generatedAt = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const rows = catTotals.slice(0, 12).map(([cat, amt]) => {
      const pct = avgSpend > 0 ? ((amt / (months ?? n)) / avgSpend * 100).toFixed(0) : 0;
      return `<tr><td>${catIcon(cat)} ${cat}</td><td style="text-align:right">${fmt(amt)}</td><td style="text-align:right">${fmt(amt / (months ?? n))}/mo</td><td style="text-align:right">${pct}%</td></tr>`;
    }).join('');
    const trendRows = trendData.map(r => {
      const net = r.income - r.spend;
      return `<tr><td>${r.label}</td><td style="text-align:right;color:#166534">${fmt(r.income)}</td><td style="text-align:right;color:#991b1b">${fmt(r.spend)}</td><td style="text-align:right;color:${net >= 0 ? '#166534' : '#991b1b'}">${net >= 0 ? '+' : ''}${fmt(net)}</td></tr>`;
    }).join('');
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Pocket Watch Report — ${rangeLabel}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #1e293b; padding: 32px; max-width: 780px; margin: 0 auto; }
  h1 { font-size: 22px; font-weight: 700; margin-bottom: 4px; }
  .sub { color: #64748b; font-size: 13px; margin-bottom: 28px; }
  .stats { display: grid; grid-template-columns: repeat(3,1fr); gap: 16px; margin-bottom: 28px; }
  .stat { border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px 16px; }
  .stat-label { font-size: 11px; color: #64748b; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px; }
  .stat-val { font-size: 20px; font-weight: 700; }
  h2 { font-size: 15px; font-weight: 700; border-bottom: 2px solid #e2e8f0; padding-bottom: 6px; margin: 24px 0 12px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; padding: 8px 10px; background: #f8fafc; color: #475569; font-weight: 600; font-size: 11px; text-transform: uppercase; border-bottom: 2px solid #e2e8f0; }
  td { padding: 8px 10px; border-bottom: 1px solid #f1f5f9; }
  .pos { color: #166534; } .neg { color: #991b1b; }
  @media print { body { padding: 0; } }
</style></head><body>
<h1>⌚ Pocket Watch — Financial Report</h1>
<div class="sub">${rangeLabel} · Generated ${generatedAt}</div>
<div class="stats">
  <div class="stat"><div class="stat-label">Avg Monthly Income</div><div class="stat-val pos">${fmt(avgIncome)}</div></div>
  <div class="stat"><div class="stat-label">Avg Monthly Spend</div><div class="stat-val neg">${fmt(avgSpend)}</div></div>
  <div class="stat"><div class="stat-label">Avg Net / Month</div><div class="stat-val ${avgSavings >= 0 ? 'pos' : 'neg'}">${avgSavings >= 0 ? '+' : ''}${fmt(avgSavings)}</div></div>
</div>
<h2>Monthly Trend</h2>
<table><thead><tr><th>Month</th><th style="text-align:right">Income</th><th style="text-align:right">Spending</th><th style="text-align:right">Net</th></tr></thead><tbody>${trendRows}</tbody></table>
<h2>Top Spending Categories</h2>
<table><thead><tr><th>Category</th><th style="text-align:right">Total</th><th style="text-align:right">Avg / Month</th><th style="text-align:right">% of Spend</th></tr></thead><tbody>${rows}</tbody></table>
</body></html>`;
    const w = window.open('', '_blank');
    if (!w) { alert('Pop-up blocked. Please allow pop-ups for this app and try again.'); return; }
    w.document.write(html);
    w.document.close();
    setTimeout(() => w.print(), 400);
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="fade-in" style={{ padding: '24px 28px' }}>
      <div className="section-header">
        <div>
          <div className="section-title">Reports</div>
          <div className="section-sub">Spending trends and historical insights</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Range:</span>
          {[3, 6, 12, 24].map(n => (
            <button key={n} className={`btn btn-sm ${months === n ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setMonths(n)}>{n}mo</button>
          ))}
          <button className={`btn btn-sm ${months === null ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setMonths(null)}>All</button>
          {allTags.length > 1 && (
            <select value={tagFilter} onChange={e => setTagFilter(e.target.value)}
              style={{ fontSize: 13, background: 'var(--bg-raised)', border: '1px solid var(--text-muted)', borderRadius: 6, color: 'var(--text-secondary)', padding: '4px 8px' }}>
              {allTags.map(tag => <option key={tag} value={tag}>{tag === 'All' ? '🏷 All Tags' : `#${tag}`}</option>)}
            </select>
          )}
          <button className="btn btn-secondary" onClick={exportPDF}>📄 Export PDF</button>
        </div>
      </div>

      {tagFilter !== 'All' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, fontSize: 13, color: 'var(--text-secondary)' }}>
          <span style={{ background: 'var(--bg-raised)', border: '1px solid var(--text-muted)', borderRadius: 12, padding: '2px 10px' }}>
            Filtered by <span style={{ color: 'var(--accent)', fontWeight: 600 }}>#{tagFilter}</span>
          </span>
          <button className="btn btn-ghost btn-sm" onClick={() => setTagFilter('All')} style={{ fontSize: 12, padding: '2px 8px' }}>· Clear</button>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14, marginBottom: 20 }}>
        <div className="stat-card">
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Avg Monthly Spend</div>
          <div className="hero-num" style={{ fontSize: 24, fontWeight: 400, color: 'var(--red)' }}>{cfmt(avgSpend)}</div>
        </div>
        <div className="stat-card">
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Avg Monthly Income</div>
          <div className="hero-num" style={{ fontSize: 24, fontWeight: 400, color: 'var(--green)' }}>{cfmt(avgIncome)}</div>
        </div>
        <div className="stat-card">
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Avg Net / Month</div>
          <div className="hero-num" style={{ fontSize: 24, fontWeight: 400, color: avgSavings >= 0 ? 'var(--green)' : 'var(--red)' }}>{avgSavings >= 0 ? '+' : ''}{cfmt(avgSavings)}</div>
        </div>
      </div>

      <div className="tab-group" style={{ marginBottom: 16 }}>
        <div className={`tab${tab === 'week'      ? ' active' : ''}`} onClick={() => setTab('week')}>📅 This Week</div>
        <div className={`tab${tab === 'trend'     ? ' active' : ''}`} onClick={() => setTab('trend')}>📈 Income vs Spending</div>
        <div className={`tab${tab === 'cat'       ? ' active' : ''}`} onClick={() => setTab('cat')}>📊 By Category</div>
        <div className={`tab${tab === 'cat-trend' ? ' active' : ''}`} onClick={() => setTab('cat-trend')}>📉 Category Trends</div>
        <div className={`tab${tab === 'yoy'       ? ' active' : ''}`} onClick={() => setTab('yoy')}>📅 Year vs Year</div>
        <div className={`tab${tab === 'nw-hist'   ? ' active' : ''}`} onClick={() => setTab('nw-hist')}>🏦 Net Worth History</div>
        <div className={`tab${tab === 'tax'       ? ' active' : ''}`} onClick={() => setTab('tax')}>🧾 Tax Summary</div>
      </div>

      {tab === 'week' && (
        <div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 14 }}>Week of {weekRange.label}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 20 }}>
            <div className="stat-card">
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Total Spent</div>
              <div className="hero-num" style={{ fontSize: 22, fontWeight: 400, color: 'var(--red)' }}>{cfmt(weekTotal)}</div>
            </div>
            <div className="stat-card">
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Largest Category</div>
              <div className="hero-num" style={{ fontSize: 22, fontWeight: 400, color: 'var(--text-secondary)' }}>
                {weekLargestCat ? `${catIcon(weekLargestCat[0])} ${weekLargestCat[0]}` : '—'}
              </div>
              {weekLargestCat && <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>{cfmt(weekLargestCat[1])}</div>}
            </div>
            <div className="stat-card">
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Transactions</div>
              <div className="hero-num" style={{ fontSize: 22, fontWeight: 400, color: 'var(--text-secondary)' }}>{weekExpenses.length}</div>
            </div>
          </div>

          {weekCatBreakdown.length === 0 ? (
            <div className="card">
              <div className="empty-state"><div className="empty-icon">📅</div><p>No expenses recorded this week</p></div>
            </div>
          ) : (
            <div className="card" style={{ marginBottom: 16 }}>
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12 }}>Spending by Category</div>
              {weekBudgetContext.map(({ cat, weekSpent, mtdSpent, budget }) => {
                const pct = budget ? Math.min(100, (mtdSpent / budget) * 100) : null;
                const barColor = pct == null ? 'var(--green)' : pct >= 100 ? 'var(--red)' : pct >= 80 ? 'var(--amber)' : 'var(--green)';
                return (
                  <div key={cat} style={{ marginBottom: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{catIcon(cat)} {cat}</span>
                      <div style={{ textAlign: 'right' }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{cfmt(weekSpent)}</span>
                        {budget && <span style={{ fontSize: 11, color: 'var(--text-secondary)', marginLeft: 8 }}>MTD {cfmt(mtdSpent)} / {cfmt(budget)}</span>}
                      </div>
                    </div>
                    {budget && (
                      <div style={{ height: 4, background: 'var(--bg-raised)', borderRadius: 2 }}>
                        <div style={{ height: '100%', width: `${pct}%`, background: barColor, borderRadius: 2, transition: 'width 0.3s' }} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {weekExpenses.length > 0 && (
            <div className="card">
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12 }}>Transactions This Week</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--bg-raised)' }}>
                    <th style={{ textAlign: 'left', padding: '4px 8px', color: 'var(--text-secondary)', fontWeight: 600, fontSize: 11, textTransform: 'uppercase' }}>Date</th>
                    <th style={{ textAlign: 'left', padding: '4px 8px', color: 'var(--text-secondary)', fontWeight: 600, fontSize: 11, textTransform: 'uppercase' }}>Description</th>
                    <th style={{ textAlign: 'left', padding: '4px 8px', color: 'var(--text-secondary)', fontWeight: 600, fontSize: 11, textTransform: 'uppercase' }}>Category</th>
                    <th style={{ textAlign: 'right', padding: '4px 8px', color: 'var(--text-secondary)', fontWeight: 600, fontSize: 11, textTransform: 'uppercase' }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {weekExpenses.slice().sort((a,b) => b.date.localeCompare(a.date)).map(t => (
                    <tr key={t.id} style={{ borderBottom: '1px solid var(--bg-page)', cursor: 'pointer' }}
                      onClick={() => onCategoryDrillDown?.(t.category)}>
                      <td style={{ padding: '6px 8px', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{t.date}</td>
                      <td style={{ padding: '6px 8px', color: 'var(--text-secondary)' }}>{t.description}</td>
                      <td style={{ padding: '6px 8px', color: 'var(--text-secondary)' }}>{catIcon(t.category)} {t.category}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--red)', fontWeight: 600 }}>{cfmt(Math.abs(t.amount))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'trend' && (
        <div className="card">
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>Monthly Income vs Spending</div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 16 }}>
            {last.length} months · dashed line = net cash flow
          </div>
          <div className="chart-container" style={{ height: 320 }}><canvas ref={canvasTrend} /></div>
        </div>
      )}

      {tab === 'cat' && (
        <div className="card">
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 16 }}>Top Spending Categories</div>
          {catTotals.length === 0
            ? <div className="empty-state"><div className="empty-icon">📊</div><p>No expense data in this range</p></div>
            : <div className="chart-container" style={{ height: Math.max(240, catTotals.slice(0, 8).length * 44) }}><canvas ref={canvasCat} /></div>
          }
        </div>
      )}

      {tab === 'cat-trend' && (
        <div className="card">
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>Category Spending Over Time</div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 16 }}>
            Monthly spend for your top 5 categories across {last.length} months
          </div>
          {catTrendData.series.length === 0
            ? <div className="empty-state"><div className="empty-icon">📉</div><p>No expense data in this range</p></div>
            : <div className="chart-container" style={{ height: 320 }}><canvas ref={canvasCatTrend} /></div>
          }
        </div>
      )}

      {tab === 'yoy' && (
        <div className="card">
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>Year-over-Year Spending</div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 16 }}>
            Monthly spending comparison across {yoyYears.length > 1 ? yoyYears.join(', ') : 'available years'}
          </div>
          <div className="chart-container" style={{ height: 320 }}><canvas ref={canvasYoY} /></div>
        </div>
      )}

      {tab === 'tax' && (
        <div className="card">
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16, flexWrap:'wrap', gap:8 }}>
            <div>
              <div style={{ fontWeight:600, fontSize:14, marginBottom:2 }}>🧾 Tax Year Summary</div>
              <div style={{ fontSize:12, color:'var(--text-secondary)' }}>All transactions marked as tax deductible</div>
            </div>
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <span style={{ fontSize:13, color:'var(--text-secondary)' }}>Year:</span>
              <select value={taxYear} onChange={e => setTaxYear(Number(e.target.value))}
                style={{ fontSize:13, background:'var(--bg-raised)', border:'1px solid var(--text-muted)', borderRadius:6, color:'var(--text-secondary)', padding:'4px 8px' }}>
                {taxYears.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
          </div>

          {taxData.deductible.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">🧾</div>
              <p>No tax-deductible transactions in {taxYear}</p>
              <p style={{ fontSize:12, color:'var(--text-muted)', marginTop:6 }}>
                Mark transactions as "Tax deductible" when adding or editing them.
              </p>
            </div>
          ) : (
            <>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:12, marginBottom:20 }}>
                <div className="stat-card">
                  <div style={{ fontSize:11, color:'var(--text-secondary)', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:4 }}>Total Deductible</div>
                  <div style={{ fontSize:22, fontWeight:700, color:'var(--green)' }}>{cfmt(taxData.grandTotal)}</div>
                </div>
                <div className="stat-card">
                  <div style={{ fontSize:11, color:'var(--text-secondary)', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:4 }}>Transactions</div>
                  <div style={{ fontSize:22, fontWeight:700, color:'var(--text-secondary)' }}>{taxData.deductible.length}</div>
                </div>
                <div className="stat-card">
                  <div style={{ fontSize:11, color:'var(--text-secondary)', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:4 }}>Categories</div>
                  <div style={{ fontSize:22, fontWeight:700, color:'var(--text-secondary)' }}>{taxData.rows.length}</div>
                </div>
              </div>

              <div style={{ fontSize:13, fontWeight:600, color:'var(--text-secondary)', marginBottom:8 }}>By Category</div>
              <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13, marginBottom:24 }}>
                <thead>
                  <tr style={{ borderBottom:'1px solid var(--bg-raised)' }}>
                    <th style={{ textAlign:'left', padding:'6px 10px', color:'var(--text-secondary)', fontWeight:600, fontSize:11, textTransform:'uppercase' }}>Category</th>
                    <th style={{ textAlign:'right', padding:'6px 10px', color:'var(--text-secondary)', fontWeight:600, fontSize:11, textTransform:'uppercase' }}>Transactions</th>
                    <th style={{ textAlign:'right', padding:'6px 10px', color:'var(--text-secondary)', fontWeight:600, fontSize:11, textTransform:'uppercase' }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {taxData.rows.map(([cat, data]) => (
                    <tr key={cat} style={{ borderBottom:'1px solid var(--bg-raised)' }}>
                      <td style={{ padding:'8px 10px', color:'var(--text-secondary)' }}>{catIcon(cat)} {cat}</td>
                      <td style={{ padding:'8px 10px', textAlign:'right', color:'var(--text-secondary)' }}>{data.txs.length}</td>
                      <td style={{ padding:'8px 10px', textAlign:'right', color:'var(--green)', fontWeight:600 }}>{cfmt(data.total)}</td>
                    </tr>
                  ))}
                  <tr style={{ borderTop:'2px solid var(--text-muted)' }}>
                    <td colSpan={2} style={{ padding:'10px 10px', fontWeight:700, color:'var(--text-secondary)' }}>Total</td>
                    <td style={{ padding:'10px 10px', textAlign:'right', fontWeight:700, color:'var(--green)', fontSize:16 }}>{cfmt(taxData.grandTotal)}</td>
                  </tr>
                </tbody>
              </table>

              <div style={{ fontSize:13, fontWeight:600, color:'var(--text-secondary)', marginBottom:8 }}>All Transactions</div>
              <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
                <thead>
                  <tr style={{ borderBottom:'1px solid var(--bg-raised)' }}>
                    <th style={{ textAlign:'left', padding:'6px 10px', color:'var(--text-secondary)', fontWeight:600, fontSize:11, textTransform:'uppercase' }}>Date</th>
                    <th style={{ textAlign:'left', padding:'6px 10px', color:'var(--text-secondary)', fontWeight:600, fontSize:11, textTransform:'uppercase' }}>Description</th>
                    <th style={{ textAlign:'left', padding:'6px 10px', color:'var(--text-secondary)', fontWeight:600, fontSize:11, textTransform:'uppercase' }}>Category</th>
                    <th style={{ textAlign:'right', padding:'6px 10px', color:'var(--text-secondary)', fontWeight:600, fontSize:11, textTransform:'uppercase' }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {taxData.deductible
                    .slice().sort((a, b) => a.date.localeCompare(b.date))
                    .map(t => (
                      <tr key={t.id} style={{ borderBottom:'1px solid var(--bg-page)' }}>
                        <td style={{ padding:'6px 10px', color:'var(--text-secondary)', whiteSpace:'nowrap' }}>{t.date}</td>
                        <td style={{ padding:'6px 10px', color:'var(--text-secondary)' }}>{t.description}</td>
                        <td style={{ padding:'6px 10px', color:'var(--text-secondary)' }}>{catIcon(t.category)} {t.category}</td>
                        <td style={{ padding:'6px 10px', textAlign:'right', color:'var(--green)' }}>{cfmt(Math.abs(t.amount))}</td>
                      </tr>
                    ))
                  }
                </tbody>
              </table>
            </>
          )}
        </div>
      )}

      {tab === 'nw-hist' && (
        <div className="card">
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>Net Worth History</div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 16 }}>
            Solid line = recorded daily snapshots · Dashed = reconstructed from imported transactions
          </div>
          {nwHistoryData.length === 0
            ? (
              <div className="empty-state">
                <div className="empty-icon">🏦</div>
                <p>No history yet</p>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
                  Import bank statements to reconstruct historical net worth, or use the app daily to build up snapshots.
                </p>
              </div>
            ) : (
              <>
                <div className="chart-container" style={{ height: 320 }}><canvas ref={canvasNWHist} /></div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 10 }}>
                  {nwHistoryData.filter(d => !d.isActual).length > 0 && (
                    <span>⚠ Reconstructed months are estimates based on transaction totals and current account balances. Import complete statements for better accuracy.</span>
                  )}
                </div>
              </>
            )
          }
        </div>
      )}
    </div>
  );
}
