import { useRef, useState, useMemo, useEffect } from 'react';
import { catColor, catIcon, isDebtType, fmt, fmtDate, thisMonth } from '../constants.js';
import { useChart } from '../hooks/useChart.js';

const DEFAULT_PREFS = {
  showIncome: true,
  showExpenses: true,
  showNet: true,
  showSavingsRate: true,
  primaryChart: 'category', // 'category' | 'incomeVsExpenses'
};

function loadPrefs() {
  try {
    const raw = localStorage.getItem('pw_dashboard_prefs');
    if (raw) return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch {}
  return DEFAULT_PREFS;
}

export default function Dashboard({ transactions, accounts, budgets, recurrences, onAddTx, grants, netWorthHistory = [], goals = [] }) {
  const canvasDonut        = useRef(null);
  const canvasBar          = useRef(null);
  const canvasForecast     = useRef(null);
  const canvasNWTrajectory = useRef(null);
  const [selMonth, setSelMonth] = useState(thisMonth());
  const [showCustomize, setShowCustomize] = useState(false);
  const [insightsOpen, setInsightsOpen] = useState(true);
  const [prefs, setPrefs] = useState(loadPrefs);

  const savePrefs = (next) => {
    setPrefs(next);
    try { localStorage.setItem('pw_dashboard_prefs', JSON.stringify(next)); } catch {}
  };
  const togglePref = (key) => savePrefs({ ...prefs, [key]: !prefs[key] });

  const availableMonths = useMemo(() => {
    const set = new Set([...transactions.map(t => t.date.slice(0,7)), thisMonth()]);
    return Array.from(set).sort().reverse();
  }, [transactions]);

  const monthTxs      = useMemo(() => transactions.filter(t => t.date.startsWith(selMonth) && t.type !== 'adjustment'), [transactions, selMonth]);
  const monthExpenses = useMemo(() => monthTxs.filter(t => t.type === 'expense'), [monthTxs]);
  const monthIncome   = useMemo(() => monthTxs.filter(t => t.type === 'income').reduce((s,t) => s + t.amount, 0), [monthTxs]);
  const monthSpend    = useMemo(() => monthExpenses.reduce((s,t) => s + Math.abs(t.amount), 0), [monthExpenses]);
  const projectedIncome = useMemo(() => {
    if (monthIncome > 0) return 0;
    return (recurrences ?? [])
      .filter(r => r.active && r.type === 'income' && r.startDate <= selMonth + '-28')
      .reduce((s, r) => {
        switch (r.frequency) {
          case 'weekly':    return s + Math.abs(r.amount) * 4.33;
          case 'biweekly':  return s + Math.abs(r.amount) * 2.17;
          case 'monthly':   return s + Math.abs(r.amount);
          case 'quarterly': return s + Math.abs(r.amount) / 3;
          case 'yearly':    return s + Math.abs(r.amount) / 12;
          default: return s;
        }
      }, 0);
  }, [recurrences, selMonth, monthIncome]);
  const effectiveIncome = monthIncome + projectedIncome;
  const isProjected = projectedIncome > 0;
  const savingsRate = effectiveIncome > 0 ? Math.max(0, (effectiveIncome - monthSpend) / effectiveIncome * 100) : 0;

  const prevMonth = useMemo(()=>{ const d=new Date(selMonth+'-01'); d.setMonth(d.getMonth()-1); return d.toISOString().slice(0,7); },[selMonth]);
  const prevTxs   = transactions.filter(t => t.date.startsWith(prevMonth) && t.type !== 'adjustment');
  const prevSpend = prevTxs.filter(t=>t.type==='expense').reduce((s,t)=>s+Math.abs(t.amount),0);
  const prevIncome= prevTxs.filter(t=>t.type==='income').reduce((s,t)=>s+t.amount,0);
  const delta = (cur, prev) => {
    if (prev === 0) return null;
    const pct = ((cur - prev) / prev * 100).toFixed(0);
    return { pct, up: cur > prev };
  };
  const spendDelta  = delta(monthSpend, prevSpend);
  const incomeDelta = delta(monthIncome, prevIncome);

  const assets      = accounts.filter(a => !isDebtType(a.type)).reduce((s,a) => s + a.balance, 0);
  const debts       = accounts.filter(a =>  isDebtType(a.type)).reduce((s,a) => s + a.balance, 0);
  const equityValue = useMemo(() => (grants || []).reduce((s, g) => s + (g.vestedShares || 0) * (g.currentPrice || 0), 0), [grants]);
  const netWorth    = assets - debts + equityValue;
  const totalBudget = budgets.filter(b => b.month === selMonth).reduce((s,b) => s + b.amount, 0);

  const catSpend = useMemo(() => {
    const map = {};
    monthExpenses.forEach(t => { map[t.category] = (map[t.category] || 0) + Math.abs(t.amount); });
    return map;
  }, [monthExpenses]);
  const topCats = useMemo(() => Object.entries(catSpend).sort((a,b) => b[1]-a[1]).slice(0,6), [catSpend]);

  const last6 = useMemo(() => Array.from({length:6}, (_,i) => {
    const d = new Date(); d.setMonth(d.getMonth() - (5-i));
    const m = d.toISOString().slice(0,7);
    return {
      label: d.toLocaleDateString('en-US',{month:'short'}),
      spend:  transactions.filter(t => t.type==='expense' && t.type!=='adjustment' && t.date.startsWith(m)).reduce((s,t)=>s+Math.abs(t.amount),0),
      income: transactions.filter(t => t.type==='income'  && t.type!=='adjustment' && t.date.startsWith(m)).reduce((s,t)=>s+t.amount,0),
    };
  }), [transactions]);

  // Spending Insights: 3-month avg vs current month
  const insights = useMemo(() => {
    const months3 = Array.from({length:3}, (_,i) => {
      const d = new Date(selMonth+'-01'); d.setMonth(d.getMonth() - (i+1));
      return d.toISOString().slice(0,7);
    });
    const avg3 = {};
    months3.forEach(m => {
      transactions.filter(t=>t.type==='expense'&&t.type!=='adjustment'&&t.date.startsWith(m)).forEach(t=>{
        avg3[t.category] = (avg3[t.category]||0) + Math.abs(t.amount);
      });
    });
    Object.keys(avg3).forEach(k => { avg3[k] /= 3; });

    const flags = [];
    Object.entries(catSpend).forEach(([cat, spent]) => {
      const avg = avg3[cat];
      if (!avg) return;
      const pct = (spent - avg) / avg * 100;
      if (pct > 40) flags.push({ cat, spent, avg, pct, dir: 'up' });
      if (pct < -40) flags.push({ cat, spent, avg, pct: Math.abs(pct), dir: 'down' });
    });
    return flags;
  }, [transactions, catSpend, selMonth]);

  useChart(canvasDonut, () => ({
    type: 'doughnut',
    data: {
      labels: topCats.map(([c]) => c),
      datasets: [{ data: topCats.map(([,v]) => v), backgroundColor: topCats.map(([c]) => catColor(c)), borderWidth:0, hoverOffset:6 }],
    },
    options: { responsive:true, maintainAspectRatio:false, cutout:'70%', plugins:{ legend:{display:false}, tooltip:{callbacks:{label:(ctx)=>` ${ctx.label}: ${fmt(ctx.raw)}`}} } },
  }), [JSON.stringify(catSpend)]);

  useChart(canvasBar, () => ({
    type: 'bar',
    data: {
      labels: last6.map(r => r.label),
      datasets: [
        { label:'Spending', data:last6.map(r=>r.spend),  backgroundColor:'#c2735a66', borderColor:'#c2735a', borderWidth:2, borderRadius:4 },
        { label:'Income',   data:last6.map(r=>r.income), backgroundColor:'#4ade8066', borderColor:'#4ade80', borderWidth:2, borderRadius:4 },
      ],
    },
    options: {
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{labels:{color:'#94a3b8',font:{size:12}}}, tooltip:{callbacks:{label:(ctx)=>` ${ctx.dataset.label}: ${fmt(ctx.raw)}`}} },
      scales:{ x:{grid:{color:'#1e2736'},ticks:{color:'#64748b'}}, y:{grid:{color:'#1e2736'},ticks:{color:'#64748b',callback:v=>'$'+(v>=1000?(v/1000).toFixed(1)+'k':v)}} },
    },
  }), [JSON.stringify(last6)]);

  const recent = transactions.slice(0, 8);

  // ── Insights panel: Spending Forecast ────────────────────────────────────────
  const forecastData = useMemo(() => {
    const months = Array.from({length:6}, (_,i) => {
      const d = new Date(); d.setMonth(d.getMonth()-(5-i));
      return d.toISOString().slice(0,7);
    });
    const points = months.map((m,i) => ({
      x: i,
      y: transactions.filter(t=>t.type==='expense'&&t.date.startsWith(m)).reduce((s,t)=>s+Math.abs(t.amount),0)
    }));
    const n = points.length;
    const sumX  = points.reduce((s,p)=>s+p.x,0);
    const sumY  = points.reduce((s,p)=>s+p.y,0);
    const sumXY = points.reduce((s,p)=>s+p.x*p.y,0);
    const sumX2 = points.reduce((s,p)=>s+p.x*p.x,0);
    const slope     = (n*sumXY - sumX*sumY)/(n*sumX2 - sumX*sumX) || 0;
    const intercept = (sumY - slope*sumX)/n;
    const labels = months.map(m=>{ const d=new Date(m+'-01'); return d.toLocaleDateString('en-US',{month:'short'}); });
    const future = [1,2,3].map((_,i) => {
      const d = new Date(); d.setMonth(d.getMonth()+i+1);
      return d.toLocaleDateString('en-US',{month:'short'});
    });
    const actualData     = points.map(p=>p.y);
    const forecastValues = [7,8,9].map(i => Math.max(0, slope*i + intercept));
    return {
      labels:         [...labels,...future],
      actualData:     [...actualData,...Array(3).fill(null)],
      forecastValues: [...Array(6).fill(null),...forecastValues],
      slope,
      intercept,
    };
  }, [transactions]);

  // ── Insights panel: Net Worth Trajectory ─────────────────────────────────────
  const nwTrajectoryData = useMemo(() => {
    const sorted = [...netWorthHistory].sort((a,b)=>a.date.localeCompare(b.date));
    return {
      labels:   sorted.map(h => h.date.slice(0,7)),
      netWorth: sorted.map(h => h.netWorth),
      assets:   sorted.map(h => h.assets),
      debts:    sorted.map(h => h.debts),
    };
  }, [netWorthHistory]);

  useChart(canvasForecast, () => ({
    type: 'line',
    data: {
      labels: forecastData.labels,
      datasets: [
        { label:'Actual',   data:forecastData.actualData,     borderColor:'#c2735a', backgroundColor:'#c2735a22', tension:0.4, fill:true,  pointBackgroundColor:'#c2735a', spanGaps:false },
        { label:'Forecast', data:forecastData.forecastValues, borderColor:'#7fa88b', backgroundColor:'transparent', tension:0.4, fill:false, borderDash:[5,4], pointBackgroundColor:'#7fa88b', spanGaps:false },
      ],
    },
    options: {
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{labels:{color:'#94a3b8'}}, tooltip:{callbacks:{label:(ctx)=>` ${ctx.dataset.label}: ${ctx.raw!=null?'$'+(ctx.raw>=1000?(ctx.raw/1000).toFixed(1)+'k':ctx.raw.toFixed(0)):'—'}`}} },
      scales:{ x:{grid:{color:'#1e2736'},ticks:{color:'#64748b'}}, y:{grid:{color:'#1e2736'},ticks:{color:'#64748b',callback:v=>'$'+(v>=1000?(v/1000).toFixed(1)+'k':v)}} },
    },
  }), [JSON.stringify(forecastData)]);

  useChart(canvasNWTrajectory, () => ({
    type: 'line',
    data: {
      labels: nwTrajectoryData.labels,
      datasets: [
        { label:'Net Worth', data:nwTrajectoryData.netWorth, borderColor:'#7fa88b', backgroundColor:'#7fa88b22', tension:0.4, fill:true, pointBackgroundColor:'#7fa88b' },
        ...goals.filter(g=>g.target>0).map(g=>({
          label: g.name,
          data: nwTrajectoryData.labels.map(()=>g.target),
          borderColor:'#4ade8066', borderDash:[4,4], borderWidth:1, pointRadius:0, fill:false,
        })),
      ],
    },
    options: {
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{labels:{color:'#94a3b8'}}, tooltip:{callbacks:{label:(ctx)=>` ${ctx.dataset.label}: $${ctx.raw!=null?(ctx.raw>=1000?(ctx.raw/1000).toFixed(1)+'k':ctx.raw.toFixed(0)):'—'}`}} },
      scales:{ x:{grid:{color:'#1e2736'},ticks:{color:'#64748b'}}, y:{grid:{color:'#1e2736'},ticks:{color:'#64748b',callback:v=>'$'+(v>=1000?(v/1000).toFixed(1)+'k':v)}} },
    },
  }), [JSON.stringify(nwTrajectoryData), JSON.stringify(goals)]);

  return (
    <div className="fade-in" style={{ padding:'24px 28px' }}>
      <div className="section-header">
        <div>
          <div className="section-title">Dashboard</div>
          <div className="section-sub">{new Date().toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'})}</div>
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          <button className="btn btn-ghost btn-sm" style={{ fontSize:12 }} onClick={()=>setShowCustomize(c=>!c)}>
            ⚙️ Customize
          </button>
          <select value={selMonth} onChange={e=>setSelMonth(e.target.value)} style={{ width:170 }}>
            {availableMonths.map(m => (
              <option key={m} value={m}>{new Date(m+'-01').toLocaleDateString('en-US',{month:'long',year:'numeric'})}</option>
            ))}
          </select>
          <button className="btn btn-primary" onClick={onAddTx}>+ Add Transaction</button>
        </div>
      </div>

      {/* Customize panel */}
      {showCustomize && (
        <div className="card" style={{ marginBottom:16, padding:'14px 18px' }}>
          <div style={{ fontSize:13, fontWeight:600, color:'#94a3b8', marginBottom:10 }}>Dashboard Customization</div>
          <div style={{ display:'flex', flexWrap:'wrap', gap:16 }}>
            <div>
              <div style={{ fontSize:12, color:'#64748b', marginBottom:6 }}>Stat Cards</div>
              {[
                ['showIncome',      'Income'],
                ['showExpenses',    'Expenses'],
                ['showNet',         'Net (transactions)'],
                ['showSavingsRate', 'Savings Rate'],
              ].map(([key, label]) => (
                <label key={key} style={{ display:'flex', alignItems:'center', gap:6, fontSize:13, marginBottom:4, cursor:'pointer' }}>
                  <input type="checkbox" checked={prefs[key]} onChange={()=>togglePref(key)} />
                  {label}
                </label>
              ))}
            </div>

          </div>
        </div>
      )}

      {/* Stat cards */}
      <div style={{ display:'grid', gridTemplateColumns:`repeat(${[prefs.showIncome,prefs.showExpenses,prefs.showNet,prefs.showSavingsRate].filter(Boolean).length},1fr)`, gap:14, marginBottom:20 }}>
        {prefs.showNet && (
          <div className="stat-card">
            <div style={{ fontSize:12,color:'#64748b',fontWeight:600,textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:6 }}>Net Worth</div>
            <div className="hero-num" style={{ fontSize:26,fontWeight:400,color:netWorth>=0?'#4ade80':'#c2735a' }}>{fmt(netWorth)}</div>
            <div style={{ fontSize:12,color:'#475569',marginTop:4 }}>{fmt(assets)} assets · {fmt(debts)} debts</div>
            {equityValue > 0 && (
              <div style={{ fontSize:11,color:'#8b5cf6',marginTop:3 }}>incl. {fmt(equityValue)} equity</div>
            )}
          </div>
        )}
        {prefs.showExpenses && (
          <div className="stat-card">
            <div style={{ fontSize:12,color:'#64748b',fontWeight:600,textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:6 }}>Month Spent</div>
            <div className="hero-num" style={{ fontSize:26,fontWeight:400,color:'#c2735a' }}>{fmt(monthSpend)}</div>
            {spendDelta
              ? <div className={spendDelta.up ? 'delta-neg' : 'delta-pos'} style={{ marginTop:4 }}>{spendDelta.up?'▲':'▼'} {Math.abs(spendDelta.pct)}% vs prev month</div>
              : totalBudget > 0 ? <div style={{ fontSize:12,color:'#475569',marginTop:4 }}>of {fmt(totalBudget)} budget · {Math.round(monthSpend/totalBudget*100)}%</div> : null}
          </div>
        )}
        {prefs.showIncome && (
          <div className="stat-card">
            <div style={{ fontSize:12,color:'#64748b',fontWeight:600,textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:6 }}>Month Income</div>
            <div className="hero-num" style={{ fontSize:26,fontWeight:400,color:'#4ade80' }}>{fmt(monthIncome)}</div>
            {incomeDelta
              ? <div className={incomeDelta.up ? 'delta-pos' : 'delta-neg'} style={{ marginTop:4 }}>{incomeDelta.up?'▲':'▼'} {Math.abs(incomeDelta.pct)}% vs prev month</div>
              : <div style={{ fontSize:12,color:monthIncome-monthSpend>=0?'#4ade80':'#c2735a',marginTop:4 }}>
                  {monthIncome-monthSpend>=0?'▲ ':'▼ '}{fmt(Math.abs(monthIncome-monthSpend))} {monthIncome-monthSpend>=0?'saved':'over'}
                </div>}
          </div>
        )}
        {prefs.showSavingsRate && (
          <div className="stat-card">
            <div style={{ fontSize:12,color:'#64748b',fontWeight:600,textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:6 }}>Savings Rate</div>
            <div className="hero-num" style={{ fontSize:26,fontWeight:400,color:savingsRate>=20?'#4ade80':'#f59e0b' }}>{savingsRate.toFixed(0)}%</div>
            <div style={{ fontSize:12,color:'#475569',marginTop:4 }}>
              {isProjected
                ? <span style={{ color:'#f59e0b' }}>📅 projected income</span>
                : `${monthTxs.length} transactions this month`}
            </div>
          </div>
        )}
      </div>

      {/* Over-budget alert */}
      {(() => {
        const overBudget = budgets.filter(b => {
          if (b.month !== selMonth) return false;
          const spent = monthExpenses.filter(t => t.category === b.category).reduce((s,t) => s + Math.abs(t.amount), 0);
          return spent > b.amount;
        });
        if (!overBudget.length) return null;
        return (
          <div style={{ background:'#c2735a18', border:'1px solid #c2735a44', borderRadius:8, padding:'10px 14px', marginBottom:16, fontSize:13, color:'#c2735a', display:'flex', alignItems:'center', gap:8 }}>
            <span style={{ fontSize:16 }}>⚠️</span>
            <span><strong>{overBudget.length} budget{overBudget.length > 1 ? 's' : ''} over limit this month:</strong>{' '}{overBudget.map(b => b.category).join(', ')}</span>
          </div>
        );
      })()}

      {/* Insights */}
      {insights.length > 0 && (
        <div className="card" style={{ marginBottom:20 }}>
          <div style={{ fontWeight:600,fontSize:14,marginBottom:12 }}>💡 Spending Insights</div>
          {insights.map(({cat,spent,avg,pct,dir}) => (
            <div key={cat} style={{ fontSize:13,color:'#94a3b8',marginBottom:6,display:'flex',alignItems:'center',gap:6 }}>
              <span>{dir==='up'?'⬆️':'⬇️'}</span>
              <span>
                <strong style={{ color:'#e2e8f0' }}>{catIcon(cat)} {cat}</strong>
                {' '}is{' '}
                <strong style={{ color: dir==='up'?'#c2735a':'#4ade80' }}>{pct.toFixed(0)}% {dir==='up'?'above':'below'}</strong>
                {' '}your 3-month average ({fmt(spent)} vs {fmt(avg)} avg)
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Charts */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1.8fr', gap:14, marginBottom:20 }}>
        <div className="card">
          <div style={{ fontWeight:600,fontSize:14,marginBottom:16 }}>Spending by Category</div>
          {topCats.length === 0
            ? <div className="empty-state"><div className="empty-icon">🍩</div><p>No expenses this month</p></div>
            : <>
                <div className="chart-container" style={{ height:160 }}><canvas ref={canvasDonut} /></div>
                <div style={{ marginTop:14,display:'flex',flexDirection:'column',gap:6 }}>
                  {topCats.map(([cat,amt]) => (
                    <div key={cat} style={{ display:'flex',alignItems:'center',gap:8 }}>
                      <div style={{ width:10,height:10,borderRadius:2,background:catColor(cat),flexShrink:0 }} />
                      <span style={{ fontSize:13,color:'#94a3b8',flex:1 }}>{catIcon(cat)} {cat}</span>
                      <span style={{ fontSize:13,fontWeight:600,color:'#e2e8f0' }}>{fmt(amt)}</span>
                    </div>
                  ))}
                </div>
              </>
          }
        </div>
        <div className="card">
          <div style={{ fontWeight:600,fontSize:14,marginBottom:16 }}>Income vs Spending — Last 6 Months</div>
          <div className="chart-container" style={{ height:240 }}><canvas ref={canvasBar} /></div>
        </div>
      </div>

      {/* Recent transactions */}
      <div className="card">
        <div style={{ fontWeight:600,fontSize:14,marginBottom:14 }}>Recent Transactions</div>
        {recent.length === 0
          ? <div className="empty-state"><div className="empty-icon">💸</div><p>No transactions yet</p></div>
          : <table>
              <thead><tr><th>Date</th><th>Description</th><th>Category</th><th style={{ textAlign:'right' }}>Amount</th></tr></thead>
              <tbody>
                {recent.map(t => (
                  <tr key={t.id}>
                    <td style={{ color:'#64748b',fontSize:13 }}>{fmtDate(t.date)}</td>
                    <td style={{ fontWeight:500 }}>
                      {t.description}
                      {t.recurringId && <span style={{ fontSize:10,background:'#1e2736',color:'#64748b',padding:'1px 6px',borderRadius:10,marginLeft:4 }}>🔁</span>}
                    </td>
                    <td><span className="tag">{catIcon(t.category)} {t.category}</span></td>
                    <td style={{ textAlign:'right',fontWeight:700,color:t.amount>=0?'#4ade80':'#c2735a' }}>
                      {t.amount>=0?'+':''}{fmt(t.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
        }
      </div>

      {/* Insights panel — Forecast + Net Worth Trajectory */}
      <div style={{ marginTop:20, border:'1px solid #1e2736', borderRadius:10, overflow:'hidden' }}>
        <div
          style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 18px', background:'#111827', cursor:'pointer', userSelect:'none' }}
          onClick={() => setInsightsOpen(o => !o)}
        >
          <span style={{ fontWeight:600, fontSize:14, color:'#e2e8f0' }}>📈 Insights</span>
          <span style={{ fontSize:16, color:'#64748b', display:'inline-block', transform:insightsOpen?'rotate(0deg)':'rotate(-90deg)', transition:'transform 0.2s' }}>⌄</span>
        </div>
        {insightsOpen && (
          <div style={{ padding:'16px 18px', display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(320px,1fr))', gap:14 }}>
            <div className="card" style={{ margin:0 }}>
              <div style={{ fontWeight:600, fontSize:14, marginBottom:4 }}>Spending Forecast</div>
              <div style={{ fontSize:12, color:'#64748b', marginBottom:14 }}>3-month projection via linear regression on last 6 months</div>
              <div className="chart-container" style={{ height:220 }}><canvas ref={canvasForecast} /></div>
            </div>
            <div className="card" style={{ margin:0 }}>
              <div style={{ fontWeight:600, fontSize:14, marginBottom:4 }}>Net Worth Trajectory</div>
              <div style={{ fontSize:12, color:'#64748b', marginBottom:14 }}>
                {goals.filter(g=>g.target>0).length > 0 ? 'Goal targets shown as dashed lines' : 'Historical net worth over time'}
              </div>
              {nwTrajectoryData.labels.length === 0
                ? <div className="empty-state" style={{ height:220 }}><div className="empty-icon">📈</div><p>No net worth history yet</p></div>
                : <div className="chart-container" style={{ height:220 }}><canvas ref={canvasNWTrajectory} /></div>
              }
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
