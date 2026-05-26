import { useState, useMemo, useRef } from 'react';
import { fmt, fmtDate, thisMonth, prevMonth, nextMonth, getNextRecurDate, isDebtType } from '../constants.js';
import { useChart } from '../hooks/useChart.js';

// ---------------------------------------------------------------------------
// Helper: generate all occurrences of a recurrence within a date range
// ---------------------------------------------------------------------------
function getRecurOccurrences(rec, fromDate, toDate) {
  if (!rec.active || !rec.startDate) return [];
  const events = [];
  let cur = rec.lastGenerated
    ? getNextRecurDate(rec.lastGenerated, rec.frequency)
    : rec.startDate;
  // Advance past fromDate without going beyond it (include from if >= fromDate)
  while (cur < fromDate) {
    cur = getNextRecurDate(cur, rec.frequency);
  }
  let safety = 0;
  while (cur <= toDate && safety < 400) {
    events.push({ date: cur, rec });
    cur = getNextRecurDate(cur, rec.frequency);
    safety++;
  }
  return events;
}

// ---------------------------------------------------------------------------
// 90-Day Projection chart (line chart of running balance)
// ---------------------------------------------------------------------------
function ProjectionChart({ data }) {
  const canvasRef = useRef(null);

  useChart(canvasRef, () => {
    if (!data.length) return { type: 'line', data: { labels: [], datasets: [] }, options: {} };
    const labels   = data.map(d => d.date.slice(5));  // MM-DD
    const balances = data.map(d => d.balance);
    const minBal   = Math.min(...balances);
    return {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Projected Balance',
          data: balances,
          borderColor: '#7fa88b',
          backgroundColor: 'transparent',
          pointRadius: 0,
          tension: 0.3,
          borderWidth: 2,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: {
            ticks: { color: '#475569', font: { size: 10 }, maxTicksLimit: 15 },
            grid: { color: '#1e273640' },
          },
          y: {
            ticks: { color: '#475569', font: { size: 10 }, callback: v => Math.abs(v) >= 1000 ? `$${(v/1000).toFixed(1)}k` : `$${v}` },
            grid: { color: '#1e273640' },
            suggestedMin: Math.min(0, minBal * 1.05),
          },
        },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: ctx => ` Balance: ${fmt(ctx.raw)}` } },
        },
      },
    };
  }, [JSON.stringify(data.map(d => d.balance))]); // eslint-disable-line

  return <canvas ref={canvasRef} style={{ width: '100%', height: '100%' }} />;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export default function Calendar({ transactions, recurrences = [], accounts = [] }) {
  const [month,      setMonth]      = useState(thisMonth());
  const [selectedDay, setSelectedDay] = useState(null);
  const [projRows,    setProjRows]   = useState(10); // visible rows in projection table

  const [year, mon] = month.split('-').map(Number);
  const firstDay    = new Date(year, mon - 1, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(year, mon, 0).getDate();
  const todayStr    = new Date().toISOString().slice(0, 10);
  const monthLabel  = new Date(year, mon - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  // ── Actual daily totals ──────────────────────────────────────────────────
  const dayTotals = useMemo(() => {
    const map = {};
    transactions
      .filter(t => t.date.startsWith(month) && t.type !== 'adjustment')
      .forEach(t => {
        const d = t.date.slice(8, 10);
        if (!map[d]) map[d] = { spend: 0, income: 0, txs: [] };
        if (t.type === 'expense') map[d].spend += Math.abs(t.amount);
        else if (t.type === 'income') map[d].income += t.amount;
        map[d].txs.push(t);
      });
    return map;
  }, [transactions, month]);

  const maxSpend = useMemo(() =>
    Math.max(1, ...Object.values(dayTotals).map(d => d.spend)),
  [dayTotals]);

  // ── Upcoming recurring events in the viewed month ────────────────────────
  const recurEvents = useMemo(() => {
    const firstOfMonth = `${month}-01`;
    const lastOfMonth  = `${month}-${String(daysInMonth).padStart(2, '0')}`;
    const map = {};
    recurrences.forEach(rec => {
      const occ = getRecurOccurrences(rec, firstOfMonth, lastOfMonth);
      occ.forEach(({ date, rec: r }) => {
        const d = date.slice(8, 10);
        if (!map[d]) map[d] = [];
        map[d].push(r);
      });
    });
    return map;
  }, [recurrences, month, daysInMonth]);

  // ── 90-day cashflow projection ────────────────────────────────────────────
  const projection = useMemo(() => {
    const startBalance = accounts.reduce((s, a) => s + (isDebtType(a.type) ? -a.balance : a.balance), 0);
    const from = todayStr;
    const toDate = new Date();
    toDate.setDate(toDate.getDate() + 90);
    const to = toDate.toISOString().slice(0, 10);

    // Build a map of date → list of recurring events
    const byDate = {};
    recurrences.forEach(rec => {
      const occ = getRecurOccurrences(rec, from, to);
      occ.forEach(({ date, rec: r }) => {
        if (!byDate[date]) byDate[date] = [];
        byDate[date].push(r);
      });
    });

    // Walk day by day accumulating running balance
    let balance = startBalance;
    const all = [];
    let cur = new Date(from);
    const end = new Date(to);
    while (cur <= end) {
      const dateStr = cur.toISOString().slice(0, 10);
      const evts = byDate[dateStr] ?? [];
      evts.forEach(r => { balance += r.type === 'income' ? Math.abs(r.amount) : -Math.abs(r.amount); });
      all.push({ date: dateStr, balance, events: evts });
      cur.setDate(cur.getDate() + 1);
    }
    return all;
  }, [accounts, recurrences, todayStr]);

  // Days with events for the table
  const projEventDays = useMemo(() =>
    projection.filter(d => d.events.length > 0),
  [projection]);

  // ── Calendar grid ────────────────────────────────────────────────────────
  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const dayKey = (d) => String(d).padStart(2, '0');

  return (
    <div className="fade-in" style={{ padding: '24px 28px' }}>
      {/* Header */}
      <div className="section-header">
        <div>
          <div className="section-title">Cashflow Calendar</div>
          <div className="section-sub">Daily spending & 90-day projection</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn btn-ghost btn-sm" onCli