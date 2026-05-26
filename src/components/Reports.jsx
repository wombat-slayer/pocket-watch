import { useRef, useState, useMemo } from 'react';
import { catColor, catIcon, fmt, fmtDate, thisMonth } from '../constants.js';
import { useChart } from '../hooks/useChart.js';

export default function Reports({ transactions, onCategoryDrillDown }) {
  const canvasCat      = useRef(null);
  const canvasTrend    = useRef(null);
  const canvasYoY      = useRef(null);
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

  const last = useMemo(() => Array.from({length:months}, (_,i) => {
    const d = new Date(); d.setMonth(d.getMonth() - (months-1-i));
    return { m: d.toISOString().slice(0,7), label: d.toLocaleDateString('en-US',{month:'short',year:'2-digit'}) };
  }), [months]);

  const cutoff = last[0]?.m ?? thisMonth();

  const catTotals = useMemo(() => {
    const map = {};
    filteredTransactions.filter(t=>t.type==='expense'&&t.type!=='adjustment'&&t.date.slice(0,7)>=cutoff).forEach(t=>{
      map[t.category] = (map[t.category]||0) + Math.abs(t.amount);
    });
    return Object.entries(map).sort((a,b)=>b[1]-a[1]);
  }, [filteredTransactions, cutoff]);

  const trendData = useMemo(() => last.map(({m,label}) => ({
    label,
    spend:  filteredTransactions.filter(t=>t.type==='expense'&&t.type!=='adjustment'&&t.date.startsWith(m)).reduce((s,t)=>s+Math.abs(t.amount),0),
    income: filteredTransactions.filter(t=>t.type==='income' &&t.type!=='adjustment'&&t.date.startsWith(m)).reduce((s,t)=>s+t.amount,0),
  })), [filteredTransactions, last]);

  const n          = trendData.length || 1;
  const avgSpend   = trendData.reduce((s,r)=>s+r.spend,0)  / n;
  const avgIncome  = trendData.reduce((s,r)=>s+r.income,0) / n;
  const avgSavings = avgIncome - avgSpend;

  // ── YoY data ────────────────────────────────────────────────────────────────
  const yoyData = useMemo(() => {
    const months12 = Array.from({length: 12}, (_, i) => {
      const label = new Date(2000, i).toLocaleDateString('en-US', {month: 'short'});
      const thisY = `${new Date().getFullYear()}-${String(i+1).padStart(2,'0')}`;
      const lastY = `${new Date().getFullYear()-1}-${String(i+1).padStart(2,'0')}`;
      const thisSpend = transactions.filter(t=>t.type==='expense'&&t.date.startsWith(thisY)).reduce((s,t)=>s+Math.abs(t.amount),0);
      const lastSpend = transactions.filter(t=>t.type==='expense'&&t.date.startsWith(lastY)).reduce((s,t)=>s+Math.abs(t.amount),0);
      return {label, thisSpend, lastSpend};
    });
    return months12;
  }, [transactions]);

  useChart(canvasCat, () => ({
    type: 'bar',
    data: {
      labels: catTotals.slice(0,8).map(([c])=>`${catIcon(c)} ${c}`),
      datasets: [{ data:catTotals.slice(0,8).map(([,v])=>v), backgroundColor:catTotals.slice(0,8).map(([c])=>catColor(c)+'cc'), borderRadius:6, borderWidth:0 }],
    },
    options: {
      indexAxis:'y', responsive:true, maintainAspectRatio:false,
      onClick: (evt, elements) => {
        if (!elements.length || !onCategoryDrillDown) return;
        const cat = catTotals.slice(0,8)[elements[0].index]?.[0];
        if (cat) onCategoryDrillDown(cat);
      },
      plugins:{legend:{display:false},tooltip:{callbacks:{label:(ctx)=>` ${fmt(ctx.raw)}`}}},
      scales:{x:{grid:{color:'#1e2736'},ticks:{color:'#64748b',callback:v=>'$'+(v>=1000?(v/1000).toFixed(1)+'k':v)}},y:{grid:{display:false},ticks:{color:'#94a3b8'}}},
    },
  }), [JSON.stringify(catTotals), months]);

  useChart(canvasTrend, () => ({
    type: 'line',
    data: {
      labels: trendData.map(r=>r.label),
      datasets: [
        { label:'Income',   data:trendData.map(r=>r.income), borderColor:'#4ade80', backgroundColor:'#4ade8022', tension:0.4, fill:true, pointBackgroundColor:'#4ade80' },
        { label:'Spending', data:trendData.map(r=>r.spend),  borderColor:'#c2735a', backgroundColor:'#c2735a22', tension:0.4, fill:true, pointBackgroundColor:'#c2735a' },
        { label:'Net',      data:trendData.map(r=>r.income - r.spend), borderColor:'#7fa88b', backgroundColor:'transparent', tension:0.4, fill:false, borderDash:[5,4], pointBackgroundColor:'#7fa88b', borderWidth:2 },
      ],
    },
    options: {
      responsive:true, maintainAspectRatio:false,
      plugins:{legend:{labels:{color:'#94a3b8'}},tooltip:{callbacks:{label:(ctx)=>` ${ctx.dataset.label}: ${fmt(ctx.raw)}`}}},
      scales:{x:{grid:{color:'#1e2736'},ticks:{color:'#64748b'}},y:{grid:{color:'#1e2736'},ticks:{color:'#64748b',callback:v=>'$'+(v>=1000?(v/1000).toFixed(1)+'k':v)}}},
    },
  }), [JSON.stringify(trendData), months]);

  // ── YoY chart ────────────────────────────────────────────────────────────────
  useChart(canvasYoY, () => ({
    type: 'bar',
    data: {
      labels: yoyData.map(r=>r.label),
      datasets: [
        { label: String(new Date().getFullYear()), data: yoyData.map(r=>r.thisSpend), backgroundColor: '#c2735acc', borderRadius: 4, borderWidth: 0 },
        { label: String(new Date().getFullYear()-1), data: yoyData.map(r=>r.lastSpend), backgroundColor: '#64748b66', borderRadius: 4, borderWidth: 0 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: '#94a3b8' } }, tooltip: { callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${fmt(ctx.raw)}` } } },
      scales: { x: { grid: { color: '#1e2736' }, ticks: { color: '#64748b' } }, y: { grid: { color: '#1e2736' }, ticks: { color: '#64748b', callback: v => '$'+(v>=1000?(v/1000).toFixed(1)+'k':v) } } },
    },
  }), [JSON.stringify(yoyData)]);

  const exportPDF = () => {
    const rangeLabel = `Last ${months} Months`;
    const generatedAt = new Date().toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
    const rows = catTotals.slice(0,12).map(([cat, amt]) => {
      const pct = avgSpend > 0 ? ((amt / months) / avgSpend * 100).toFixed(0) : 0;
      return `<tr><td>${catIcon(cat)} ${cat}</td><td style="text-align:right">${fmt(amt)}</td><td style="text-align:right">${fmt(amt/months)}/mo</td><td style="text-align:right">${pct}%</td></tr>`;
    }).join('');
    const trendRows = trendData.map(r => {
      const net = r.income - r.spend;
      return `<tr><td>${r.label}</td><td style="text-align:right;color:#166534">${fmt(r.income)}</td><td style="text-align:right;color:#991b1b">${fmt(r.spend)}</td><td style="text-align:right;color:${net>=0?'#166534':'#991b1b'}">${net>=0?'+':''}${fmt(net)}</td></tr>`;
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
  <div class="stat"><div class="stat-label">Avg Net / Month</div><div class="stat-val ${avgSavings>=0?'pos':'neg'}">${avgSavings>=0?'+':''}${fmt(avgSavings)}</div></div>
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

  return (
    <div className="fade-in" style={{ padding:'24px 28px' }}>
      <div className="section-header">
        <div><div className="section-title">Reports</div><div className="section-sub">Spending trends and insights</div></div>
        <div style={{ display:'flex',gap:8,alignItems:'center' }}>
          <span style={{ fontSize:13,color:'#64748b' }}>Range:</span>
          {[3,6,12].map(n=>(
            <button key={n} className={`btn btn-sm ${months===n?'btn-primary':'btn-secondary'}`} onClick={()=>setMonths(n)}>{n} mo</button>
          ))}
          {allTags.length > 1 && (
            <select value={tagFilter} onChange={e => setTagFilter(e.target.value)}
              style={{ fontSize:13, background:'#1e2736', border:'1px solid #334155', borderRadius:6, color:'#94a3b8', padding:'4px 8px' }}>
              {allTags.map(tag => <option key={tag} value={tag}>{tag === 'All' ? '🏷 All Tags' : `#${tag}`}</option>)}
            </select>
          )}
          <button className="btn btn-secondary" onClick={exportPDF}>📄 Export PDF</button>
        </div>
      </div>
      {tagFilter !== 'All' && (
        <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:12, fontSize:13, color:'#94a3b8' }}>
          <span style={{ background:'#1e2736', border:'1px solid #334155', borderRadius:12, padding:'2px 10px' }}>
            Filtered by <span style={{ color:'#7fa88b', fontWeight:600 }}>#{tagFilter}</span>
          </span>
          <button className="btn btn-ghost btn-sm" onClick={() => setTagFilter('All')} style={{ fontSize:12, padding:'2px 8px' }}>· Clear</button>
        </div>
      )}

      <div style={{ display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:14,marginBottom:20 }}>
        <div className="stat-card"><div style={{ fontSize:12,color:'#64748b',fontWeight:600,textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:6 }}>Avg Monthly Spend</div><div className="hero-num" style={{ fontSize:24,fontWeight:400,color:'#c2735a' }}>{fmt(avgSpend)}</div></div>
        <div className="stat-card"><div style={{ fontSize:12,color:'#64748b',fontWeight:600,textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:6 }}>Avg Monthly Income</div><div className="hero-num" style={{ fontSize:24,fontWeight:400,color:'#4ade80' }}>{fmt(avgIncome)}</div></div>
        <div className="stat-card"><div style={{ fontSize:12,color:'#64748b',fontWeight:600,textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:6 }}>Avg Net / Month</div><div className="hero-num" style={{ fontSize:24,fontWeight:400,color:avgSavings>=0?'#4ade80':'#c2735a' }}>{avgSavings>=0?'+':''}{fmt(avgSavings)}</div></div>
      </div>

      <div className="tab-group" style={{ marginBottom:16 }}>
        <div className={`tab${tab==='trend'?' active':''}`} onClick={()=>setTab('trend')}>📈 Income vs Spending</div>
        <div className={`tab${tab==='cat'  ?' active':''}`} onClick={()=>setTab('cat')}>📊 By Category</div>
        <div className={`tab${tab==='yoy'  ?' active':''}`} onClick={()=>setTab('yoy')}>📅 Year vs Year</div>
      </div>

      {tab==='trend' && (
        <div className="card"><div style={{ fontWeight:600,fontSize:14,marginBottom:16 }}>Monthly Income vs Spending</div><div className="chart-container" style={{ height:320 }}><canvas ref={canvasTrend} /></div></div>
      )}
      {tab==='cat' && (
        <div className="card">
          <div style={{ fontWeight:600,fontSize:14,marginBottom:16 }}>Top Spending Categories</div>
          {catTotals.length===0
            ? <div className="empty-state"><div className="empty-icon">📊</div><p>No expense data yet</p></div>
            : <div className="chart-container" style={{ height:Math.max(240,catTotals.slice(0,8).length*44) }}><canvas ref={canvasCat} /></div>
          }
        </div>
      )}

      {tab==='yoy' && (
        <div className="card">
          <div style={{fontWeight:600,fontSize:14,marginBottom:16}}>Year-over-Year Spending</div>
          <div className="chart-container" style={{height:320}}><canvas ref={canvasYoY} /></div>
        </div>)}

    </div>
  );
}
