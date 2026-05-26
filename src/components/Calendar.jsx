import { useState, useMemo } from 'react';
import { fmt, fmtDate, thisMonth, prevMonth, nextMonth } from '../constants.js';

export default function Calendar({ transactions }) {
  const [month, setMonth] = useState(thisMonth());

  const [year, mon] = month.split('-').map(Number);
  const firstDay = new Date(year, mon - 1, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(year, mon, 0).getDate();

  // daily spend and income totals
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

  const [selectedDay, setSelectedDay] = useState(null);

  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const dayKey = (d) => String(d).padStart(2, '0');
  const monthLabel = new Date(year, mon - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="fade-in" style={{ padding: '24px 28px' }}>
      <div className="section-header">
        <div>
          <div className="section-title">Calendar</div>
          <div className="section-sub">Daily spending at a glance</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn btn-ghost btn-sm" onClick={() => { setMonth(m => prevMonth(m)); setSelectedDay(null); }}>← Prev</button>
          <span style={{ fontSize: 14, fontWeight: 600, color: '#e2e8f0', minWidth: 140, textAlign: 'center' }}>{monthLabel}</span>
          <button className="btn btn-ghost btn-sm" onClick={() => { setMonth(m => nextMonth(m)); setSelectedDay(null); }}>Next →</button>
        </div>
      </div>

      {/* Summary row */}
      {(() => {
        const totals = Object.values(dayTotals);
        const totalSpend  = totals.reduce((s, d) => s + d.spend, 0);
        const totalIncome = totals.reduce((s, d) => s + d.income, 0);
        const activeDays  = totals.filter(d => d.spend > 0 || d.income > 0).length;
        return (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14, marginBottom: 20 }}>
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
          </div>
        );
      })()}

      {/* Calendar grid */}
      <div className="card" style={{ padding: 16 }}>
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
            const k = dayKey(d);
            const data = dayTotals[k];
            const intensity = data ? Math.min(0.8, (data.spend / maxSpend) * 0.8) : 0;
            const dateStr = `${month}-${k}`;
            const isToday = dateStr === today;
            const isSelected = selectedDay === d;
            return (
              <div
                key={d}
                onClick={() => setSelectedDay(d === selectedDay ? null : d)}
                style={{
                  minHeight: 56, borderRadius: 6, padding: '5px 6px', cursor: 'pointer',
                  background: isSelected
                    ? '#7fa88b33'
                    : data?.spend
                      ? `rgba(194,115,90,${intensity})`
                      : '#0d111760',
                  border: `1px solid ${isToday ? '#7fa88b' : isSelected ? '#7fa88b88' : '#1e2736'}`,
                  transition: 'background .15s',
                }}
              >
                <div style={{ fontSize:11, fontWeight:700, color: isToday ? '#7fa88b' : '#64748b' }}>{d}</div>
                {data?.spend > 0 && (
                  <div style={{ fontSize:10, color:'#c2735a', fontWeight:600, marginTop:2 }}>
                    -{fmt(data.spend).replace('$','$')}
                  </div>
                )}
                {data?.income > 0 && (
                  <div style={{ fontSize:10, color:'#4ade80', fontWeight:600 }}>
                    +{fmt(data.income).replace('$','$')}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Day drill-down */}
      {selectedDay && (() => {
        const k = dayKey(selectedDay);
        const data = dayTotals[k];
        if (!data?.txs?.length) return (
          <div className="card" style={{ marginTop:12, fontSize:14, color:'#475569', textAlign:'center', padding:20 }}>
            No transactions on {fmtDate(`${month}-${k}`)}
          </div>
        );
        return (
          <div className="card" style={{ marginTop:12 }}>
            <div style={{ fontWeight:600, fontSize:14, marginBottom:12 }}>
              {fmtDate(`${month}-${k}`)} — {data.txs.length} transaction{data.txs.length!==1?'s':''}
            </div>
            <table>
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
          </div>
        );
      })()}
    </div>
  );
}
