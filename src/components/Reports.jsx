import { useRef, useState, useMemo } from 'react';
import { catColor, catIcon, fmt, thisMonth, isDebtType } from '../constants.js';
import { useChart } from '../hooks/useChart.js';

export default function Reports({ transactions, accounts = [], netWorthHistory = [], onCategoryDrillDown }) {
  const canvasCat       = useRef(null);
  const canvasTrend     = useRef(null);
  const canvasYoY       = useRef(null);
  const canvasCatTrend  = useRef(null);
  const canvasNWHist    = useRef(null);

  // months: number = last N months, null = all time
  const [months,    setMonths]    = useState(6);
  const [tab,       setTab]       = useState('trend');
  const [tagFilter, setTagFilter] = useState('All');

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
      .filter(t => t.type === 'expense' && t.date.slice(0, 7) >= cutoff)
      .forEach(t => { map[t.category] = (map[t.category] || 0) + Math.abs(t.amount); });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [filteredTransactions, cutoff]);

  // ── Monthly trend ──────────────────────────────────────────────────────────
  const trendData = useMemo(() => last.map(({ m, label }) => ({
    label,
    spend:  filteredTransactions.filter(t => t.type === 'expense' && t.date.startsWith(m)).reduce((s, t) => s + Math.abs(t.amount), 0),
    income: filteredTransactions.filter(t => t.type === 'income'  && t.date.startsWith(m)).reduce((s, t) => s + t.amount, 0),
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

  // ── Color palette for category trend lines ─────────────────────────────────
  const LINE_COLORS = ['#7fa88b', '#c2735a', '#60a5fa', '#f59e0b', '#a78bfa'];

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
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => ` ${fmt(ctx.raw)}` } } },
      scales: {
        x: { grid: { color: '#1e2736' }, ticks: { color: '#64748b', callback: v => '$' + (v >= 1000 ? (v / 1000).toFixed(1) + 'k' : v) } },
        y: { grid: { display: false }, ticks: { color: '#94a3b8' } },
      },
    },
  }), [JSON.stringify(catTotals), months]);

  useChart(canvasTrend, () => ({
    type: 'line',
    data: {
      labels: trendData.map(r => r.label),
      datasets: [
        { label: 'Income',   data: trendData.map(r => r.income), borderColor: '#4ade80', backgroundColor: '#4ade8022', tension: 0.4, fill: true, pointBackgroundColor: '#4ade80', pointRadius: trendData.length > 24 ? 2 : 4 },
        { label: 'Spending', data: trendData.map(r => r.spend),  borderColor: '#c2735a', backgroundColor: '#c2735a22', tension: 0.4, fill: true, pointBackgroundColor: '#c2735a', pointRadius: trendData.length > 24 ? 2 : 4 },
        { label: 'Net',      data: trendData.map(r => r.income - r.spend), borderColor: '#7fa88b', backgroundColor: 'transparent', tension: 0.4, fill: false, borderDash: [5, 4], pointBackgroundColor: '#7fa88b', borderWidth: 2, pointRadius: trendData.length > 24 ? 2 : 4 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: '#94a3b8' } }, tooltip: { callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${fmt(ctx.raw)}` } } },
      scales: {
        x: { grid: { color: '#1e2736' }, ticks: { color: '#64748b', maxTicksLimit: months === null ? 16 : 12 } },
        y: { grid: { color: '#1e2736' }, ticks: { color: '#64748b', callback: v => '$' + (Math.abs(v) >= 1000 ? (v / 1000).toFixed(1) + 'k' : v) } },
      },
    },
  }), [JSON.stringify(trendData), months]);

  useChart(canvasYoY, () => ({
    type: 'bar',
    data: {
      labels: yoyData.map(r => r.label),
      datasets: yoyYears.map((y, i) => ({
        label: String(y),
        data: yoyData.map(r => r[y] || 0),
        backgroundColor: i === 0 ? '#c2735acc' : i === 1 ? '#64748b66' : '#7fa88b55',
        borderRadius: 4, borderWidth: 0,
      })),
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: '#94a3b8' } }, tooltip: { callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${fmt(ctx.raw)}` } } },
      scales: {
        x: { grid: { color: '#1e2736' }, ticks: { color: '#64748b' } },
        y: { grid: { color: '#1e2736' }, ticks: { color: '#64748b', callback: v => '$' + (v >= 1000 ? (v / 1000).toFixed(1) + 'k' : v) } },
      },
    },
  }), [JSON.stringify(yoyData)]);

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
      plugins: { legend: { labels: { color: '#94a3b8' } }, tooltip: { callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${fmt(ctx.raw)}` } } },
      scales: {
        x: { grid: { color: '#1e2736' }, ticks: { color: '#64748b', maxTicksLimit: 16 } },
        y: { grid: { color: '#1e2736' }, ticks: { color: '#64748b', callback: v => '$' + (v >= 1000 ? (v / 1000).toFixed(1) + 'k' : v) }, min: 0 },
      },
    },
  }), [JSON.stringify(catTrendData)]);

  useChart(canvasNWHist, () => ({
    type: 'line',
    data: {
      labels: nwHistoryData.map(d => d.label),
      datasets: [
        {
          label: 'Net Worth',
          data: nwHistoryData.map(d => d.isActual ? d.value : null),
          borderColor: '#7fa88b',
          backgroundColor: '#7fa88b22',
          tension: 0.3, fill: true,
          pointRadius: nwHistoryData.length > 24 ? 2 : 4,
          pointBackgroundColor: '#7fa88b',
          spanGaps: false,
        },
        {
          label: 'Estimated (reconstructed)',
          data: nwHistoryData.map(d => !d.isActual ? d.value : null),
          borderColor: '#7fa88b77',
          backgroundColor: '#7fa88b11',
          borderDash: [6, 4],
          tension: 0.3, fill: false,
          pointRadius: nwHistoryData.length > 24 ? 2 : 3,
          pointBackgroundColor: '#7fa88b77',
          spanGaps: false,
        },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: '#94a3b8' } },
        tooltip: { callbacks: { label: (ctx) => ` Net Worth: ${fmt(ctx.raw)}` } },
      },
      scales: {
        x: { grid: { color: '#1e2736' }, ticks: { color: '#64748b', maxTicksLimit: 16 } },
        y: { grid: { color: '#1e2736' }, ticks: { color: '#64748b', callback: v => '$' + (Math.abs(v) >= 1000 ? (v / 1000).toFixed(1) + 'k' : v) } },
      },
    },
  }), [JSON.stringify(nwHistoryData)]);

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
          <span style={{ fontSize: 13, color: '#64748b' }}>Range:</span>
          {[3, 6, 12, 24].map(n => (
            <button key={n} className={`btn btn-sm ${months === n ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setMonths(n)}>{n}mo</button>
          ))}
          <button className={`btn btn-sm ${months === null ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setMonths(null)}>All</button>
          {allTags.length > 1 && (
            <select value={tagFilter} onChange={e => setTagFilter(e.target.value)}
              style={{ fontSize: 13, background: '#1e2736', border: '1px solid #334155', borderRadius: 6, color: '#94a3b8', padding: '4px 8px' }}>
              {allTags.map(tag => <option key={tag} value={tag}>{tag === 'All' ? '🏷 All Tags' : `#${tag}`}</option>)}
            </select>
          )}
          <button className="btn btn-secondary" onClick={exportPDF}>📄 Export PDF</button>
        </div>
      </div>

      {tagFilter !== 'All' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, fontSize: 13, color: '#94a3b8' }}>
          <span style={{ background: '#1e2736', border: '1px solid #334155', borderRadius: 12, padding: '2px 10px' }}>
            Filtered by <span style={{ color: '#7fa88b', fontWeight: 600 }}>#{tagFilter}</span>
          </span>
          <button className="btn btn-ghost btn-sm" onClick={() => setTagFilter('All')} style={{ fontSize: 12, padding: '2px 8px' }}>· Clear</button>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14, marginBottom: 20 }}>
        <div className="stat-card">
          <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Avg Monthly Spend</div>
          <div className="hero-num" style={{ fontSize: 24, fontWeight: 400, color: '#c2735a' }}>{fmt(avgSpend)}</div>
        </div>
        <div className="stat-card">
          <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Avg Monthly Income</div>
          <div className="hero-num" style={{ fontSize: 24, fontWeight: 400, color: '#4ade80' }}>{fmt(avgIncome)}</div>
        </div>
        <div className="stat-card">
          <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Avg Net / Month</div>
          <div className="hero-num" style={{ fontSize: 24, fontWeight: 400, color: avgSavings >= 0 ? '#4ade80' : '#c2735a' }}>{avgSavings >= 0 ? '+' : ''}{fmt(avgSavings)}</div>
        </div>
      </div>

      <div className="tab-group" style={{ marginBottom: 16 }}>
        <div className={`tab${tab === 'trend'     ? ' active' : ''}`} onClick={() => setTab('trend')}>📈 Income vs Spending</div>
        <div className={`tab${tab === 'cat'       ? ' active' : ''}`} onClick={() => setTab('cat')}>📊 By Category</div>
        <div className={`tab${tab === 'cat-trend' ? ' active' : ''}`} onClick={() => setTab('cat-trend')}>📉 Category Trends</div>
        <div className={`tab${tab === 'yoy'       ? ' active' : ''}`} onClick={() => setTab('yoy')}>📅 Year vs Year</div>
        <div className={`tab${tab === 'nw-hist'   ? ' active' : ''}`} onClick={() => setTab('nw-hist')}>🏦 Net Worth History</div>
      </div>

      {tab === 'trend' && (
        <div className="card">
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>Monthly Income vs Spending</div>
          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 16 }}>
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
          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 16 }}>
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
          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 16 }}>
            Monthly spending comparison across {yoyYears.length > 1 ? yoyYears.join(', ') : 'available years'}
          </div>
          <div className="chart-container" style={{ height: 320 }}><canvas ref={canvasYoY} /></div>
        </div>
      )}

      {tab === 'nw-hist' && (
        <div className="card">
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>Net Worth History</div>
          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 16 }}>
            Solid line = recorded daily snapshots · Dashed = reconstructed from imported transactions
          </div>
          {nwHistoryData.length === 0
            ? (
              <div className="empty-state">
                <div className="empty-icon">🏦</div>
                <p>No history yet</p>
                <p style={{ fontSize: 12, color: '#475569', marginTop: 6 }}>
                  Import bank statements to reconstruct historical net worth, or use the app daily to build up snapshots.
                </p>
              </div>
            ) : (
              <>
                <div className="chart-container" style={{ height: 320 }}><canvas ref={canvasNWHist} /></div>
                <div style={{ fontSize: 11, color: '#475569', marginTop: 10 }}>
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
