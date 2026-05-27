import { useState, useMemo, useRef } from 'react';
import { fmt, fmtDate, thisMonth, prevMonth, nextMonth, getNextRecurDate } from '../constants.js';
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
            ticks: { color: '#475569', font: { size: 10 }, callback: v => `$${(v/1000).toFixed(0)}k` },
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
    const startBalance = accounts.reduce((s, a) => s + a.balance, 0);
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
          <button className="btn btn-ghost btn-sm" onClick={() => { setMonth(m => prevMonth(m)); setSelectedDay(null); }}>← Prev</button>
          <span style={{ fontSize: 14, fontWeight: 600, color: '#e2e8f0', minWidth: 140, textAlign: 'center' }}>{monthLabel}</span>
          <button className="btn btn-ghost btn-sm" onClick={() => { setMonth(m => nextMonth(m)); setSelectedDay(null); }}>Next →</button>
        </div>
      </div>

      {/* Summary stat cards */}
      {(() => {
        const totals      = Object.values(dayTotals);
        const totalSpend  = totals.reduce((s, d) => s + d.spend, 0);
        const totalIncome = totals.reduce((s, d) => s + d.income, 0);
        const activeDays  = totals.filter(d => d.spend > 0 || d.income > 0).length;
        const netBalance  = accounts.reduce((s, a) => s + a.balance, 0);
        return (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14, marginBottom: 20 }}>
            <div className="stat-card">
              <div style={{ fontSize:12,color:'#64748b',fontWeight:600,textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:6 }}>Month Spend</div>
              <div style={{ fontSize:22,fontWeight:700,color:'#c2735a' }}>{fmt(totalSpend)}</div>
            </div>
            <div className="stat-card">
              <div style={{ fontSize:12,color:'#64748b',fontWeight:600,textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:6 }}>Month Income</div>
              <div style={{ fontSize:22,fontWeight:700,color:'#4ade80' }}>{fmt(totalIncome)}</div>
            </div>
            <div className="stat-card">
              <div style={{ fontSize:12,color:'#64748b',fontWeight:600,textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:6 }}>Active Days</div>
              <div style={{ fontSize:22,fontWeight:700,color:'#e2e8f0' }}>{activeDays}</div>
            </div>
            <div className="stat-card">
              <div style={{ fontSize:12,color:'#64748b',fontWeight:600,textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:6 }}>Current Balance</div>
              <div style={{ fontSize:22,fontWeight:700,color: netBalance >= 0 ? '#4ade80' : '#c2735a' }}>{fmt(netBalance)}</div>
            </div>
          </div>
        );
      })()}

      {/* Calendar grid */}
      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        {/* Day-of-week headers */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 4, marginBottom: 8 }}>
          {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => (
            <div key={d} style={{ textAlign:'center', fontSize:11, fontWeight:700, color:'#475569', padding:'4px 0' }}>{d}</div>
          ))}
        </div>
        {/* Calendar cells */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 4 }}>
          {cells.map((d, i) => {
            if (!d) return <div key={'e'+i} />;
            const k        = dayKey(d);
            const data     = dayTotals[k];
            const upcoming = recurEvents[k] ?? [];
            const isFuture = `${month}-${k}` > todayStr;
            const intensity = data ? Math.min(0.8, (data.spend / maxSpend) * 0.8) : 0;
            const dateStr  = `${month}-${k}`;
            const isToday  = dateStr === todayStr;
            const isSelected = selectedDay === d;

            return (
              <div
                key={d}
                onClick={() => setSelectedDay(d === selectedDay ? null : d)}
                style={{
                  minHeight: 60, borderRadius: 6, padding: '5px 6px', cursor: 'pointer',
                  background: isSelected
                    ? '#7fa88b22'
                    : data?.spend
                      ? `rgba(194,115,90,${intensity})`
                      : isFuture && upcoming.length
                        ? '#8b5cf611'
                        : '#0d111760',
                  border: `1px solid ${isToday ? '#7fa88b' : isSelected ? '#7fa88b88' : '#1e2736'}`,
                  transition: 'background .15s',
                  position: 'relative',
                }}
              >
                <div style={{ fontSize:11, fontWeight:700, color: isToday ? '#7fa88b' : '#64748b' }}>{d}</div>
                {data?.spend > 0 && (
                  <div style={{ fontSize:10, color:'#c2735a', fontWeight:600, marginTop:2 }}>
                    -{fmt(data.spend)}
                  </div>
                )}
                {data?.income > 0 && (
                  <div style={{ fontSize:10, color:'#4ade80', fontWeight:600 }}>
                    +{fmt(data.income)}
                  </div>
                )}
                {isFuture && upcoming.length > 0 && (
                  <div style={{ display:'flex', flexWrap:'wrap', gap:2, marginTop:3 }}>
                    {upcoming.slice(0, 3).map((r, ri) => (
                      <span key={ri} title={`${r.description} (${r.type})`}
                        style={{ fontSize:8, padding:'1px 3px', borderRadius:3,
                          background: r.type === 'income' ? '#4ade8033' : '#8b5cf633',
                          color: r.type === 'income' ? '#4ade80' : '#a78bfa',
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 50 }}>
                        {r.type === 'income' ? '+' : '-'}{r.description.slice(0, 8)}
                      </span>
                    ))}
                    {upcoming.length > 3 && (
                      <span style={{ fontSize:8, color:'#475569' }}>+{upcoming.length - 3}</span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Legend */}
      <div style={{ display:'flex', gap:16, fontSize:11, color:'#475569', marginBottom:16 }}>
        <span><span style={{ display:'inline-block', width:10, height:10, borderRadius:2, background:'rgba(194,115,90,0.6)', marginRight:4, verticalAlign:'middle' }} />Spending (actual)</span>
        <span><span style={{ display:'inline-block', width:10, height:10, borderRadius:2, background:'#8b5cf622', border:'1px solid #8b5cf6', marginRight:4, verticalAlign:'middle' }} />Upcoming recurring</span>
      </div>

      {/* Day drill-down */}
      {selectedDay && (() => {
        const k     = dayKey(selectedDay);
        const data  = dayTotals[k];
        const upcoming = recurEvents[k] ?? [];
        const dateStr = `${month}-${k}`;
        const isFut = dateStr > todayStr;
        return (
          <div className="card" style={{ marginBottom:16 }}>
            <div style={{ fontWeight:600, fontSize:14, marginBottom:12 }}>
              {fmtDate(dateStr)}
              {isFut && <span style={{ marginLeft:8, fontSize:11, color:'#8b5cf6' }}>Upcoming</span>}
            </div>
            {data?.txs?.length > 0 && (
              <table style={{ marginBottom: upcoming.length ? 12 : 0 }}>
                <thead>
                  <tr><th>Description</th><th>Category</th><th style={{ textAlign:'right' }}>Amount</th></tr>
                </thead>
                <tbody>
                  {data.txs.map(t => (
                    <tr key={t.id}>
                      <td style={{ fontWeight:500 }}>{t.description}</td>
                      <td><span className="tag" style={{ fontSize:11 }}>{t.category}</span></td>
                      <td style={{ textAlign:'right', fontWeight:700, color:t.amount>=0?'#4ade80':'#c2735a' }}>
                        {t.amount>=0?'+':''}{fmt(t.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {upcoming.length > 0 && (
              <>
                {data?.txs?.length > 0 && <div style={{ height:1, background:'#1e2736', margin:'8px 0' }} />}
                <div style={{ fontSize:12, color:'#64748b', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.04em', marginBottom:6 }}>Recurring (projected)</div>
                {upcoming.map((r, ri) => (
                  <div key={ri} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'5px 0', borderBottom:'1px solid #1e273640', fontSize:13 }}>
                    <span style={{ color:'#94a3b8' }}>{r.description}</span>
                    <span style={{ fontWeight:700, color: r.type==='income' ? '#4ade80' : '#c2735a' }}>
                      {r.type==='income' ? '+' : '-'}{fmt(Math.abs(r.amount))}
                    </span>
                  </div>
                ))}
              </>
            )}
            {!data?.txs?.length && !upcoming.length && (
              <div style={{ fontSize:14, color:'#475569', textAlign:'center', padding:12 }}>No transactions or upcoming items on this day.</div>
            )}
          </div>
        );
      })()}

      {/* 90-day projection */}
      <div className="card" style={{ padding: 16 }}>
        <div style={{ fontWeight:600, fontSize:14, color:'#94a3b8', marginBottom:4 }}>📈 90-Day Balance Projection</div>
        <div style={{ fontSize:12, color:'#475569', marginBottom:12 }}>
          Based on current account balances ({fmt(accounts.reduce((s,a) => s+a.balance, 0))}) + scheduled recurring transactions.
        </div>
        <div style={{ height: 180, marginBottom: 16 }}>
          <ProjectionChart data={projection} />
        </div>

        {/* Upcoming events table */}
        {projEventDays.length > 0 && (
          <>
            <div style={{ fontWeight:600, fontSize:12, color:'#64748b', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:8 }}>
              Upcoming Transactions
            </div>
            <table style={{ width:'100%', fontSize:12, borderCollapse:'collapse' }}>
              <thead>
                <tr>
                  {['Date','Event','Amount','Balance After'].map((h,i) => (
                    <th key={h} style={{ textAlign: i>=2 ? 'right' : 'left', color:'#64748b', fontWeight:600, fontSize:11, textTransform:'uppercase', letterSpacing:'0.04em', padding:'5px 8px', borderBottom:'1px solid #1e2736' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {projEventDays.slice(0, projRows).map((d, i) => (
                  d.events.map((r, ri) => (
                    <tr key={`${i}-${ri}`} style={{ borderBottom:'1px solid #0d1520' }}>
                      <td style={{ padding:'5px 8px', color:'#94a3b8' }}>{fmtDate(d.date)}</td>
                      <td style={{ padding:'5px 8px', color:'#e2e8f0' }}>{r.description}</td>
                      <td style={{ padding:'5px 8px', textAlign:'right', fontWeight:700, color: r.type==='income' ? '#4ade80' : '#c2735a' }}>
                        {r.type==='income' ? '+' : '-'}{fmt(Math.abs(r.amount))}
                      </td>
                      <td style={{ padding:'5px 8px', textAlign:'right', color: d.balance >= 0 ? '#e2e8f0' : '#c2735a', fontWeight: ri === d.events.length-1 ? 700 : 400 }}>
                        {ri === d.events.length - 1 ? fmt(d.balance) : '—'}
                      </td>
                    </tr>
                  ))
                ))}
              </tbody>
            </table>
            {projEventDays.length > projRows && (
              <button className="btn btn-ghost btn-sm" style={{ marginTop:10, fontSize:12 }}
                onClick={() => setProjRows(r => r + 20)}>
                Show more ({projEventDays.length - projRows} remaining)
              </button>
            )}
            {projEventDays.length === 0 && recurrences.length === 0 && (
              <div style={{ fontSize:13, color:'#475569', padding:'12px 0' }}>
                No recurring transactions set up. Add them in the Recurring section to see projections.
              </div>
            )}
          </>
        )}
        {projEventDays.length === 0 && (
          <div style={{ fontSize:13, color:'#475569', padding:'12px 0' }}>
            {recurrences.length === 0
              ? 'No recurring transactions set up. Add them in the Recurring section to see projections.'
              : 'No upcoming recurring transactions in the next 90 days.'}
          </div>
        )}
      </div>
    </div>
  );
}
