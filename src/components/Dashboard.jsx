import { useRef, useState, useMemo } from 'react';
import { catColor, catIcon, isDebtType, fmt, fmtDate, thisMonth, monthlyEquivalent, computeUnvestedRSUValue } from '../constants.js';
import { useChart } from '../hooks/useChart.js';
import Goals from './Goals.jsx';

export default function Dashboard({
  transactions, accounts, budgets, recurrences, onAddTx,
  grants, netWorthHistory = [], goals = [],
  onAddGoal, onEditGoal, onDeleteGoal, onDeposit, onGoToBudgets,
  compensationProfile, onCategoryClick,
}) {
  const canvasForecast     = useRef(null);
  const canvasNWTrajectory = useRef(null);
  const [selMonth, setSelMonth] = useState(thisMonth());
  const [insightsOpen, setInsightsOpen] = useState(true);

  const availableMonths = useMemo(() => {
    const set = new Set([...transactions.map(t => t.date.slice(0,7)), thisMonth()]);
    return Array.from(set).sort().reverse();
  }, [transactions]);

  // ── Month data ────────────────────────────────────────────────────────────
  const monthTxs      = useMemo(() => transactions.filter(t => t.date.startsWith(selMonth) && t.type !== 'adjustment'), [transactions, selMonth]);
  const monthExpenses = useMemo(() => monthTxs.filter(t => t.type === 'expense'), [monthTxs]);
  const monthIncome   = useMemo(() => monthTxs.filter(t => t.type === 'income').reduce((s,t) => s + t.amount, 0), [monthTxs]);
  const monthSpend    = useMemo(() => monthExpenses.reduce((s,t) => s + Math.abs(t.amount), 0), [monthExpenses]);
  const monthSurplus  = monthIncome - monthSpend;

  const prevMonth = useMemo(() => {
    const d = new Date(selMonth + '-01'); d.setMonth(d.getMonth() - 1);
    return d.toISOString().slice(0,7);
  }, [selMonth]);

  const { prevSpend, prevIncome, prevSurplus } = useMemo(() => {
    const prevTxs   = transactions.filter(t => t.date.startsWith(prevMonth) && t.type !== 'adjustment');
    const prevSpend  = prevTxs.filter(t => t.type === 'expense').reduce((s,t) => s + Math.abs(t.amount), 0);
    const prevIncome = prevTxs.filter(t => t.type === 'income').reduce((s,t) => s + t.amount, 0);
    return { prevSpend, prevIncome, prevSurplus: prevIncome - prevSpend };
  }, [transactions, prevMonth]);

  const projectedIncome = useMemo(() => {
    if (monthIncome > 0) return 0;
    return (recurrences ?? [])
      .filter(r => r.active && r.type === 'income' && r.startDate <= selMonth + '-28')
      .reduce((s, r) => s + Math.abs(monthlyEquivalent(r)), 0);
  }, [recurrences, selMonth, monthIncome]);
  const effectiveIncome = monthIncome + projectedIncome;

  const pctDelta = (cur, prev) => {
    if (prev === 0) return null;
    const pct = ((cur - prev) / Math.abs(prev) * 100).toFixed(0);
    return { pct: Math.abs(pct), up: cur > prev };
  };
  const surplusDelta  = pctDelta(monthSurplus, prevSurplus);
  const incomeDelta   = pctDelta(monthIncome, prevIncome);
  const spendDelta    = pctDelta(monthSpend, prevSpend);

  // ── Net worth ─────────────────────────────────────────────────────────────
  const assets     = accounts.filter(a => !isDebtType(a.type)).reduce((s,a) => s + a.balance, 0);
  const debts      = accounts.filter(a =>  isDebtType(a.type)).reduce((s,a) => s + a.balance, 0);
  const equityValue    = useMemo(() => (grants || []).reduce((s,g) => s + (g.vestedShares||0) * (g.currentPrice||0), 0), [grants]);
  const netWorth       = assets - debts + equityValue;
  const unvestedRSU    = useMemo(() => computeUnvestedRSUValue(accounts), [accounts]);
  const vestedNetWorth = netWorth - unvestedRSU;

  const checkingBal  = accounts.filter(a => a.type === 'checking').reduce((s,a) => s + a.balance, 0);
  const savingsBal   = accounts.filter(a => a.type === 'savings').reduce((s,a) => s + a.balance, 0);
  const investBal    = accounts.filter(a => a.type === 'investment').reduce((s,a) => s + a.balance, 0);
  const creditBal    = accounts.filter(a => a.type === 'credit').reduce((s,a) => s + a.balance, 0);

  const prevMonthNW = useMemo(() => {
    const pm = prevMonth;
    const snapshots = netWorthHistory.filter(h => h.date.slice(0,7) === pm);
    if (!snapshots.length) return null;
    return snapshots[snapshots.length - 1].netWorth;
  }, [netWorthHistory, prevMonth]);
  const nwDelta = prevMonthNW != null ? netWorth - prevMonthNW : null;

  // ── True Savings Rate ─────────────────────────────────────────────────────
  const trueSavingsRate = useMemo(() => {
    const gross = compensationProfile?.grossMonthlySalary ?? 0;
    if (gross <= 0) return null;
    const preTax = (compensationProfile.retirement401kPct / 100) * gross
                 + (compensationProfile.hsaMonthly ?? 0);
    const takehome = gross * (1 - (compensationProfile.effectiveTaxRate / 100)) - preTax;
    const rate = takehome > 0
      ? Math.min(100, Math.max(0, ((takehome - monthSpend + preTax) / gross) * 100))
      : 0;
    return rate;
  }, [compensationProfile, monthSpend]);

  // ── Category spending ─────────────────────────────────────────────────────
  const catSpend = useMemo(() => {
    const map = {};
    monthExpenses.forEach(t => { map[t.category] = (map[t.category] || 0) + Math.abs(t.amount); });
    return map;
  }, [monthExpenses]);
  const topCats = useMemo(() => Object.entries(catSpend).sort((a,b) => b[1]-a[1]), [catSpend]);

  // ── Budget progress ───────────────────────────────────────────────────────
  const monthBudgets = useMemo(() =>
    budgets.filter(b => b.month === selMonth).map(b => {
      const spent = catSpend[b.category] || 0;
      const pct   = b.amount > 0 ? (spent / b.amount) * 100 : 0;
      return { ...b, spent, pct };
    }).sort((a, b) => b.pct - a.pct)
  , [budgets, catSpend, selMonth]);

  const barColor = (pct) => pct >= 100 ? '#c2735a' : pct >= 80 ? '#f59e0b' : '#4ade80';

  // ── Goals on-track ────────────────────────────────────────────────────────
  const last3Surplus = useMemo(() => {
    const months = Array.from({length:3}, (_,i) => {
      const d = new Date(selMonth + '-01'); d.setMonth(d.getMonth() - (i+1));
      return d.toISOString().slice(0,7);
    });
    const tot = months.reduce((s, m) => {
      const inc = transactions.filter(t=>t.type==='income'&&t.date.startsWith(m)).reduce((a,t)=>a+t.amount,0);
      const exp = transactions.filter(t=>t.type==='expense'&&t.date.startsWith(m)).reduce((a,t)=>a+Math.abs(t.amount),0);
      return s + (inc - exp);
    }, 0);
    return tot / 3;
  }, [transactions, selMonth]);

  // ── Insights ──────────────────────────────────────────────────────────────
  const insights = useMemo(() => {
    const months3 = Array.from({length:3}, (_,i) => {
      const d = new Date(selMonth+'-01'); d.setMonth(d.getMonth() - (i+1));
      return d.toISOString().slice(0,7);
    });
    const avg3 = {};
    months3.forEach(m => {
      transactions.filter(t=>t.type==='expense'&&t.date.startsWith(m)).forEach(t=>{
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

  // ── FIRE data ─────────────────────────────────────────────────────────────
  const fireData = useMemo(() => {
    const last3months = Array.from({length:3}, (_,i) => {
      const d = new Date(); d.setMonth(d.getMonth() - (i + 1));
      return d.toISOString().slice(0, 7);
    });
    const totalSpend  = last3months.reduce((s, m) =>
      s + transactions.filter(t=>t.type==='expense'&&t.date.startsWith(m)).reduce((ss,t)=>ss+Math.abs(t.amount),0), 0);
    const totalIncome = last3months.reduce((s, m) =>
      s + transactions.filter(t=>t.type==='income'&&t.date.startsWith(m)).reduce((ss,t)=>ss+t.amount,0), 0);
    const avgMonthlySpend  = totalSpend  / 3;
    const avgMonthlyIncome = totalIncome / 3;
    const monthlySavings   = avgMonthlyIncome - avgMonthlySpend;
    const annualExpenses   = avgMonthlySpend * 12;
    const fireNumber       = annualExpenses * 25;
    const gap              = fireNumber - netWorth;
    const yearsToFire      = monthlySavings > 0 && gap > 0 ? gap / (monthlySavings * 12) : null;
    const fireProgress     = fireNumber > 0 ? Math.min(100, (netWorth / fireNumber) * 100) : 0;
    return { fireNumber, gap, yearsToFire, fireProgress, annualExpenses, monthlySavings, avgMonthlySpend, avgMonthlyIncome };
  }, [transactions, netWorth]);

  // ── Forecast data ─────────────────────────────────────────────────────────
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
    const labels    = months.map(m=>{ const d=new Date(m+'-01'); return d.toLocaleDateString('en-US',{month:'short'}); });
    const future    = [1,2,3].map((_,i) => {
      const d = new Date(); d.setMonth(d.getMonth()+i+1);
      return d.toLocaleDateString('en-US',{month:'short'});
    });
    return {
      labels:         [...labels,...future],
      actualData:     [...points.map(p=>p.y),...Array(3).fill(null)],
      forecastValues: [...Array(6).fill(null),...[6,7,8].map(i=>Math.max(0,slope*i+intercept))],
    };
  }, [transactions]);

  const nwTrajectoryData = useMemo(() => {
    const sorted = [...netWorthHistory].sort((a,b)=>a.date.localeCompare(b.date));
    return {
      labels:   sorted.map(h=>h.date.slice(0,7)),
      netWorth: sorted.map(h=>h.netWorth),
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

  const isNewUser = accounts.length === 0 && transactions.length === 0;

  return (
    <div className="fade-in" style={{ padding:'24px 28px' }}>
      {isNewUser && (
        <div style={{ background:'linear-gradient(135deg,#0d1f17,#0d1117)', border:'1px solid #14532d55', borderRadius:14, padding:'28px 32px', marginBottom:24 }}>
          <div style={{ fontSize:36, marginBottom:10 }}>⌚</div>
          <div style={{ fontWeight:700, fontSize:20, color:'#e2e8f0', marginBottom:6 }}>Welcome to Pocket Watch</div>
          <div style={{ fontSize:14, color:'#64748b', marginBottom:20, lineHeight:1.7 }}>
            Your data lives only on this machine — private, fast, and yours forever. Here's how to get started:
          </div>
          <div style={{ display:'flex', gap:12, flexWrap:'wrap', marginBottom:20 }}>
            {[
              { num:'1', label:'Add your accounts', desc:'Checking, savings, credit cards, investments — press 3 to go to Accounts' },
              { num:'2', label:'Import bank statements', desc:'Drop CSV or OFX files from your bank — years of history at once' },
              { num:'3', label:'Set a budget', desc:'Budget by category so you always know where your money is going — press 4' },
            ].map(step => (
              <div key={step.num} style={{ flex:'1 1 180px', background:'#0d1117', border:'1px solid #1e2736', borderRadius:10, padding:'14px 16px' }}>
                <div style={{ width:24, height:24, borderRadius:6, background:'#14532d', display:'flex', alignItems:'center', justifyContent:'center', fontSize:12, fontWeight:700, color:'#4ade80', marginBottom:10 }}>{step.num}</div>
                <div style={{ fontWeight:600, fontSize:13, color:'#e2e8f0', marginBottom:4 }}>{step.label}</div>
                <div style={{ fontSize:12, color:'#475569', lineHeight:1.5 }}>{step.desc}</div>
              </div>
            ))}
          </div>
          <button className="btn btn-primary" onClick={onAddTx}>+ Add First Transaction</button>
        </div>
      )}

      {/* Header */}
      <div className="section-header">
        <div>
          <div className="section-title">Dashboard</div>
          <div className="section-sub">{new Date().toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'})}</div>
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          <select value={selMonth} onChange={e=>setSelMonth(e.target.value)} style={{ width:170 }}>
            {availableMonths.map(m => (
              <option key={m} value={m}>{new Date(m+'-01').toLocaleDateString('en-US',{month:'long',year:'numeric'})}</option>
            ))}
          </select>
          <button className="btn btn-primary" onClick={onAddTx}>+ Add Transaction</button>
        </div>
      </div>

      {/* ── Module 1: Net Worth Bar ── */}
      <div className="card" style={{ marginBottom:16 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:12, flexWrap:'wrap', gap:8 }}>
          <div>
            {unvestedRSU > 0 ? (
              <>
                <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:2 }}>
                  <div style={{ fontSize:12, color:'#64748b', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.05em' }}>Vested Net Worth</div>
                  <span
                    title="Unvested RSU value is excluded from this figure. Update in Accounts."
                    style={{ fontSize:12, color:'#475569', cursor:'help' }}
                  >ⓘ</span>
                </div>
                <div style={{ fontSize:30, fontWeight:700, color: vestedNetWorth >= 0 ? '#4ade80' : '#c2735a' }}>{fmt(vestedNetWorth)}</div>
                <div style={{ fontSize:12, color:'#475569', marginTop:3 }}>
                  + {fmt(unvestedRSU)} <span style={{ color:'#334155' }}>locked (unvested RSUs)</span>
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize:12, color:'#64748b', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:4 }}>Net Worth</div>
                <div style={{ fontSize:30, fontWeight:700, color: netWorth >= 0 ? '#4ade80' : '#c2735a' }}>{fmt(netWorth)}</div>
              </>
            )}
          </div>
          {nwDelta != null && (
            <div style={{ textAlign:'right' }}>
              <div style={{ fontSize:12, color:'#64748b', marginBottom:2 }}>vs last month</div>
              <div style={{ fontSize:16, fontWeight:700, color: nwDelta >= 0 ? '#4ade80' : '#c2735a' }}>
                {nwDelta >= 0 ? '+' : ''}{fmt(nwDelta)}
              </div>
            </div>
          )}
        </div>
        <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
          {checkingBal !== 0 && (
            <div style={{ background:'#0d1117', borderRadius:8, padding:'6px 12px', fontSize:12 }}>
              <span style={{ color:'#64748b' }}>Checking </span>
              <span style={{ color:'#e2e8f0', fontWeight:600 }}>{fmt(checkingBal)}</span>
            </div>
          )}
          {savingsBal !== 0 && (
            <div style={{ background:'#0d1117', borderRadius:8, padding:'6px 12px', fontSize:12 }}>
              <span style={{ color:'#64748b' }}>Savings </span>
              <span style={{ color:'#e2e8f0', fontWeight:600 }}>{fmt(savingsBal)}</span>
            </div>
          )}
          {investBal !== 0 && (
            <div style={{ background:'#0d1117', borderRadius:8, padding:'6px 12px', fontSize:12 }}>
              <span style={{ color:'#64748b' }}>Investments </span>
              <span style={{ color:'#8b5cf6', fontWeight:600 }}>{fmt(investBal)}</span>
            </div>
          )}
          {equityValue > 0 && (
            <div style={{ background:'#0d1117', borderRadius:8, padding:'6px 12px', fontSize:12 }}>
              <span style={{ color:'#64748b' }}>Equity </span>
              <span style={{ color:'#8b5cf6', fontWeight:600 }}>{fmt(equityValue)}</span>
            </div>
          )}
          {creditBal !== 0 && (
            <div style={{ background:'#0d1117', borderRadius:8, padding:'6px 12px', fontSize:12 }}>
              <span style={{ color:'#64748b' }}>Credit </span>
              <span style={{ color:'#c2735a', fontWeight:600 }}>{fmt(creditBal)}</span>
            </div>
          )}
        </div>
      </div>

      {/* ── Module 2: Monthly Pulse ── */}
      <div className="card" style={{ marginBottom:16 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14, flexWrap:'wrap', gap:8 }}>
          <div style={{ fontWeight:600, fontSize:15 }}>Monthly Pulse</div>
          {projectedIncome > 0 && <span style={{ fontSize:12, color:'#f59e0b' }}>📅 Income projected from recurring</span>}
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12 }}>
          <div style={{ background:'#0d1117', borderRadius:10, padding:'14px 16px' }}>
            <div style={{ fontSize:11, color:'#64748b', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:6 }}>Income</div>
            <div style={{ fontSize:22, fontWeight:700, color:'#4ade80' }}>{fmt(effectiveIncome)}</div>
            {incomeDelta && (
              <div style={{ fontSize:11, marginTop:4, color: incomeDelta.up ? '#4ade80' : '#c2735a' }}>
                {incomeDelta.up ? '▲' : '▼'} {incomeDelta.pct}% vs prev
              </div>
            )}
          </div>
          <div style={{ background:'#0d1117', borderRadius:10, padding:'14px 16px' }}>
            <div style={{ fontSize:11, color:'#64748b', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:6 }}>Spent</div>
            <div style={{ fontSize:22, fontWeight:700, color:'#c2735a' }}>{fmt(monthSpend)}</div>
            {spendDelta && (
              <div style={{ fontSize:11, marginTop:4, color: spendDelta.up ? '#c2735a' : '#4ade80' }}>
                {spendDelta.up ? '▲' : '▼'} {spendDelta.pct}% vs prev
              </div>
            )}
          </div>
          <div style={{ background:'#0d1117', borderRadius:10, padding:'14px 16px' }}>
            <div style={{ fontSize:11, color:'#64748b', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:6 }}>Surplus</div>
            <div style={{ fontSize:22, fontWeight:700, color: monthSurplus >= 0 ? '#4ade80' : '#c2735a' }}>
              {monthSurplus >= 0 ? '+' : ''}{fmt(monthSurplus)}
            </div>
            {surplusDelta && (
              <div style={{ fontSize:11, marginTop:4, color: surplusDelta.up ? '#4ade80' : '#c2735a' }}>
                {surplusDelta.up ? '▲' : '▼'} {surplusDelta.pct}% vs prev
              </div>
            )}
          </div>
        </div>
        {trueSavingsRate != null && (
          <div style={{ marginTop:12, padding:'10px 14px', background:'#0d1117', borderRadius:8, fontSize:13 }}>
            <span style={{ color:'#64748b' }}>True Savings Rate </span>
            <span style={{ fontWeight:700, color: trueSavingsRate >= 20 ? '#4ade80' : '#f59e0b', marginLeft:6 }}>
              {trueSavingsRate.toFixed(1)}%
            </span>
            <span style={{ color:'#334155', fontSize:11, marginLeft:6 }}>of gross salary (including pre-tax)</span>
          </div>
        )}
      </div>

      {/* ── Module 3 + 4: Category + Budget (2-column) ── */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14, marginBottom:16 }}>
        {/* Module 3: Spending by Category */}
        <div className="card">
          <div style={{ fontWeight:600, fontSize:14, marginBottom:14 }}>Spending by Category</div>
          {topCats.length === 0 ? (
            <div className="empty-state"><div className="empty-icon">📊</div><p>No expenses this month</p></div>
          ) : (
            <div style={{ display:'flex', flexDirection:'column', gap:7 }}>
              {topCats.slice(0, 8).map(([cat, amt]) => {
                const pct = monthSpend > 0 ? (amt / monthSpend) * 100 : 0;
                return (
                  <div
                    key={cat}
                    onClick={() => onCategoryClick?.(cat)}
                    style={{ cursor: onCategoryClick ? 'pointer' : 'default' }}
                  >
                    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:3 }}>
                      <span style={{ fontSize:13, color:'#e2e8f0' }}>{catIcon(cat)} {cat}</span>
                      <span style={{ fontSize:13, fontWeight:600, color:'#e2e8f0' }}>{fmt(amt)}</span>
                    </div>
                    <div style={{ background:'#1e2736', borderRadius:4, height:5, overflow:'hidden' }}>
                      <div style={{ height:'100%', borderRadius:4, width:`${pct}%`, background: catColor(cat), transition:'width 0.4s ease' }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Module 4: Budget Progress */}
        <div className="card">
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:14 }}>
            <div style={{ fontWeight:600, fontSize:14 }}>Budget Progress</div>
            {monthBudgets.length > 0 && (
              <button className="btn btn-ghost btn-sm" style={{ fontSize:11 }} onClick={onGoToBudgets}>Manage →</button>
            )}
          </div>
          {monthBudgets.length === 0 ? (
            <div style={{ textAlign:'center', padding:'18px 0' }}>
              <div style={{ fontSize:13, color:'#64748b', marginBottom:12 }}>No budgets for this month</div>
              <button className="btn btn-primary btn-sm" onClick={onGoToBudgets}>+ Create Budgets</button>
            </div>
          ) : (
            <div style={{ display:'flex', flexDirection:'column', gap:9 }}>
              {monthBudgets.map(b => (
                <div key={b.id} onClick={onGoToBudgets} style={{ cursor:'pointer' }}>
                  <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:3 }}>
                    <span style={{ fontSize:13, color:'#e2e8f0', flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      {catIcon(b.category)} {b.category}
                    </span>
                    <span style={{ fontSize:11, color:'#64748b', flexShrink:0, marginLeft:8 }}>{fmt(b.spent)} / {fmt(b.amount)}</span>
                  </div>
                  <div style={{ background:'#1e2736', borderRadius:4, height:6, overflow:'hidden' }}>
                    <div style={{ height:'100%', borderRadius:4, width:`${Math.min(100, b.pct)}%`, background:barColor(b.pct), transition:'width 0.4s ease' }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Module 5: Goals Progress ── */}
      <div style={{ marginBottom:16 }}>
        <Goals
          embedded
          goals={goals}
          accounts={accounts}
          onAdd={onAddGoal}
          onEdit={onEditGoal}
          onDelete={onDeleteGoal}
          onDeposit={onDeposit}
          monthlySurplus={last3Surplus}
        />
      </div>

      {/* ── Recent transactions ── */}
      <div className="card" style={{ marginBottom:20 }}>
        <div style={{ fontWeight:600, fontSize:14, marginBottom:14 }}>Recent Transactions</div>
        {transactions.length === 0 ? (
          <div className="empty-state"><div className="empty-icon">💸</div><p>No transactions yet</p></div>
        ) : (
          <table>
            <thead><tr><th>Date</th><th>Description</th><th>Category</th><th style={{ textAlign:'right' }}>Amount</th></tr></thead>
            <tbody>
              {transactions.slice(0, 8).map(t => (
                <tr key={t.id}>
                  <td style={{ color:'#64748b', fontSize:13 }}>{fmtDate(t.date)}</td>
                  <td style={{ fontWeight:500 }}>
                    {t.description}
                    {t.recurringId && <span style={{ fontSize:10, background:'#1e2736', color:'#64748b', padding:'1px 6px', borderRadius:10, marginLeft:4 }}>🔁</span>}
                  </td>
                  <td><span className="tag">{catIcon(t.category)} {t.category}</span></td>
                  <td style={{ textAlign:'right', fontWeight:700, color:t.amount>=0?'#4ade80':'#c2735a' }}>
                    {t.amount>=0?'+':''}{fmt(t.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Insights ── */}
      {insights.length > 0 && (
        <div className="card" style={{ marginBottom:20 }}>
          <div style={{ fontWeight:600, fontSize:14, marginBottom:12 }}>💡 Spending Insights</div>
          {insights.map(({cat, spent, avg, pct, dir}) => (
            <div key={cat} style={{ fontSize:13, color:'#94a3b8', marginBottom:6, display:'flex', alignItems:'center', gap:6 }}>
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

      {/* ── Insights panel: Forecast + NW Trajectory + FIRE ── */}
      <div style={{ border:'1px solid #1e2736', borderRadius:12, overflow:'hidden' }}>
        <button
          onClick={() => setInsightsOpen(o => !o)}
          style={{ width:'100%', background:'#111827', border:'none', padding:'14px 20px', display:'flex', justifyContent:'space-between', alignItems:'center', cursor:'pointer', color:'#e2e8f0' }}>
          <span style={{ fontWeight:600, fontSize:14 }}>Insights &amp; Forecast</span>
          <span style={{ fontSize:12, color:'#64748b' }}>{insightsOpen ? '▲ Collapse' : '▼ Expand'}</span>
        </button>
        {insightsOpen && (
          <div style={{ padding:20 }}>
            <div style={{ marginBottom:24 }}>
              <div style={{ fontWeight:600, fontSize:13, color:'#94a3b8', marginBottom:12 }}>Spending Forecast — Next 3 Months</div>
              <div className="chart-container" style={{ height:200 }}><canvas ref={canvasForecast} /></div>
            </div>
            <div style={{ marginBottom:24 }}>
              <div style={{ fontWeight:600, fontSize:13, color:'#94a3b8', marginBottom:12 }}>Net Worth Trajectory</div>
              <div className="chart-container" style={{ height:200 }}><canvas ref={canvasNWTrajectory} /></div>
            </div>
            {fireData.avgMonthlySpend > 0 && (
              <div style={{ borderTop:'1px solid #1e2736', paddingTop:20 }}>
                <div style={{ fontWeight:600, fontSize:13, color:'#94a3b8', marginBottom:12 }}>🔥 FIRE Progress</div>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:12, marginBottom:16 }}>
                  <div style={{ background:'#0d1117', borderRadius:8, padding:'12px 14px' }}>
                    <div style={{ fontSize:11, color:'#64748b', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:4 }}>FIRE Number</div>
                    <div style={{ fontSize:18, fontWeight:700, color:'#94a3b8' }}>{fmt(fireData.fireNumber)}</div>
                    <div style={{ fontSize:11, color:'#475569', marginTop:2 }}>25× annual expenses</div>
                  </div>
                  <div style={{ background:'#0d1117', borderRadius:8, padding:'12px 14px' }}>
                    <div style={{ fontSize:11, color:'#64748b', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:4 }}>Monthly Savings</div>
                    <div style={{ fontSize:18, fontWeight:700, color: fireData.monthlySavings > 0 ? '#4ade80' : '#c2735a' }}>
                      {fireData.monthlySavings >= 0 ? '+' : ''}{fmt(fireData.monthlySavings)}
                    </div>
                    <div style={{ fontSize:11, color:'#475569', marginTop:2 }}>3-month avg</div>
                  </div>
                  <div style={{ background:'#0d1117', borderRadius:8, padding:'12px 14px' }}>
                    <div style={{ fontSize:11, color:'#64748b', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:4 }}>Years to FIRE</div>
                    <div style={{ fontSize:18, fontWeight:700, color: fireData.yearsToFire !== null && fireData.yearsToFire <= 15 ? '#7fa88b' : '#f59e0b' }}>
                      {fireData.yearsToFire === null
                        ? netWorth >= fireData.fireNumber ? '🎉 Now!' : '—'
                        : fireData.yearsToFire < 1 ? '<1 yr'
                        : `${fireData.yearsToFire.toFixed(1)} yrs`}
                    </div>
                    <div style={{ fontSize:11, color:'#475569', marginTop:2 }}>at current savings rate</div>
                  </div>
                </div>
                <div style={{ fontSize:11, color:'#64748b', marginBottom:4, display:'flex', justifyContent:'space-between' }}>
                  <span>Progress to FIRE</span>
                  <span style={{ color:'#7fa88b', fontWeight:600 }}>{fireData.fireProgress.toFixed(1)}%</span>
                </div>
                <div style={{ background:'#1e2736', borderRadius:6, height:10, overflow:'hidden' }}>
                  <div style={{
                    height:'100%', borderRadius:6,
                    width:`${fireData.fireProgress}%`,
                    background: fireData.fireProgress >= 100 ? '#4ade80' : 'linear-gradient(90deg,#7fa88b,#4ade80)',
                    transition:'width 0.5s ease',
                  }} />
                </div>
                <div style={{ fontSize:11, color:'#475569', marginTop:6 }}>
                  {fmt(netWorth)} saved of {fmt(fireData.fireNumber)} target · {fmt(Math.max(0, fireData.gap))} remaining
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
