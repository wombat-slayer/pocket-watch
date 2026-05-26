import { useRef, useState, useMemo } from 'react';
import { ACCOUNT_TYPES, acctColor, acctLabel, acctEmoji, isDebtType, fmt, uid, parseAmount, computeBalance } from '../constants.js';
import { useChart } from '../hooks/useChart.js';
import Modal from './Modal.jsx';

function AccountForm({ initial, onSave, onClose }) {
  const [form, setForm] = useState(initial ?? { name:'', type:'checking', balance:'' });
  const set = (k,v) => setForm(f=>({...f,[k]:v}));
  const save = () => {
    if (!form.name.trim() || form.balance === '') return;
    const bal = parseAmount(String(form.balance));
    if (isNaN(bal)) return;
    onSave({ ...form, id: form.id ?? uid(), balance: Math.abs(bal) });
  };
  return (
    <div className="form-grid" style={{ gap:14 }}>
      <div className="form-group"><label className="form-label">Account Name</label><input type="text" placeholder="e.g. Chase Checking" value={form.name} onChange={e=>set('name',e.target.value)} /></div>
      <div className="form-grid form-grid-2">
        <div className="form-group"><label className="form-label">Type</label>
          <select value={form.type} onChange={e=>set('type',e.target.value)}>
            {ACCOUNT_TYPES.map(t=><option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <div className="form-group"><label className="form-label">Current Balance ($)</label>
          <input type="text" placeholder="0.00" value={form.balance} onChange={e=>set('balance',e.target.value)} />
        </div>
      </div>
      <div style={{ fontSize:12,color:'#64748b' }}>
        {isDebtType(form.type)?'⚠️ Debt accounts subtract from your net worth.':'✅ Asset accounts add to your net worth.'}
      </div>
      <div style={{ display:'flex',gap:8,justifyContent:'flex-end' }}>
        <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save}>Save Account</button>
      </div>
    </div>
  );
}

function monthlyEquivalent(r) {
  const amt = r.amount; // signed
  switch (r.frequency) {
    case 'weekly':    return amt * 4.33;
    case 'biweekly':  return amt * 2.17;
    case 'monthly':   return amt;
    case 'quarterly': return amt / 3;
    case 'yearly':    return amt / 12;
    default: return 0;
  }
}

export default function Accounts({ accounts, transactions, netWorthHistory, recurrences, onAdd, onEdit, onDelete, onToggleCleared, onReconcile, onUpdateStatementDate }) {
  const canvasNW       = useRef(null);
  const canvasForecast = useRef(null);
  const [showAdd,       setShowAdd]       = useState(false);
  const [editA,         setEditA]         = useState(null);
  const [reconcileAcct, setReconcileAcct] = useState(null);   // account id being reconciled
  const [stmtBalance,   setStmtBalance]   = useState('');
  const [clearedIds,    setClearedIds]    = useState(new Set());
  const [reconcileAllMode, setReconcileAllMode] = useState(false);
  const [stmtDate,      setStmtDate]      = useState('');

  const openReconcile = (acctId) => {
    const existing = new Set(transactions.filter(t => t.account === acctId && t.cleared).map(t => t.id));
    setReconcileAcct(acctId);
    setStmtBalance('');
    setStmtDate('');
    setClearedIds(existing);
  };
  const closeReconcile = () => { setReconcileAcct(null); setStmtBalance(''); setStmtDate(''); setClearedIds(new Set()); };
  const toggleClearedLocal = (txId) => {
    setClearedIds(s => { const n = new Set(s); n.has(txId) ? n.delete(txId) : n.add(txId); return n; });
    if (onToggleCleared) onToggleCleared(txId);
  };
  const finishReconcile = () => {
    if (!reconcileAcct) return;
    if (onReconcile) onReconcile(reconcileAcct, [...clearedIds]);
    if (stmtDate && onUpdateStatementDate) onUpdateStatementDate(reconcileAcct, stmtDate);
    closeReconcile();
  };

  const assets    = accounts.filter(a=>!isDebtType(a.type));
  const debts     = accounts.filter(a=> isDebtType(a.type));
  const totAssets = assets.reduce((s,a)=>s+a.balance,0);
  const totDebts  = debts.reduce((s,a)=>s+a.balance,0);
  const netWorth  = totAssets - totDebts;

  const historyData = useMemo(() => {
    const sorted = [...netWorthHistory].sort((a,b)=>a.date.localeCompare(b.date));
    const byDay = {};
    sorted.forEach(h => { byDay[h.date] = h; });
    return Object.values(byDay).sort((a,b)=>a.date.localeCompare(b.date)).slice(-60);
  }, [netWorthHistory]);

  // Forecast data
  const activeRecs = (recurrences ?? []).filter(r => r.active);
  const monthlyNetFlow = activeRecs.reduce((s, r) => s + monthlyEquivalent(r), 0);
  const forecastData = useMemo(() => Array.from({length:13}, (_,i) => {
    const d = new Date(); d.setMonth(d.getMonth() + i);
    return {
      label: i === 0 ? 'Now' : d.toLocaleDateString('en-US',{month:'short',year:'2-digit'}),
      value: netWorth + monthlyNetFlow * i,
    };
  }), [netWorth, monthlyNetFlow]);

  useChart(canvasNW, () => ({
    type: 'line',
    data: {
      labels: historyData.map(h => new Date(h.date+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'})),
      datasets: [{
        label: 'Net Worth',
        data: historyData.map(h=>h.netWorth),
        borderColor: netWorth>=0?'#7fa88b':'#c2735a',
        backgroundColor: netWorth>=0?'#7fa88b22':'#c2735a22',
        tension: 0.4, fill: true, pointRadius: historyData.length<20?4:2,
        pointBackgroundColor: netWorth>=0?'#7fa88b':'#c2735a',
      }],
    },
    options: {
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{display:false}, tooltip:{callbacks:{label:(ctx)=>` Net Worth: ${fmt(ctx.raw)}`}} },
      scales:{
        x:{ grid:{color:'#1e2736'}, ticks:{color:'#64748b',maxTicksLimit:10} },
        y:{ grid:{color:'#1e2736'}, ticks:{color:'#64748b',callback:v=>'$'+(Math.abs(v)>=1000?(v/1000).toFixed(1)+'k':v)} },
      },
    },
  }), [JSON.stringify(historyData)]);

  useChart(canvasForecast, () => ({
    type: 'line',
    data: {
      labels: forecastData.map(d=>d.label),
      datasets: [{
        label: '12-Month Forecast',
        data: forecastData.map(d=>d.value),
        borderColor: monthlyNetFlow >= 0 ? '#7fa88b' : '#c2735a',
        backgroundColor: monthlyNetFlow >= 0 ? '#7fa88b22' : '#c2735a22',
        tension: 0.3, fill: true, pointRadius: 3,
        borderDash: [0],
        pointBackgroundColor: monthlyNetFlow >= 0 ? '#7fa88b' : '#c2735a',
      }],
    },
    options: {
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{display:false}, tooltip:{callbacks:{label:(ctx)=>` Forecast: ${fmt(ctx.raw)}`}} },
      scales:{
        x:{ grid:{color:'#1e2736'}, ticks:{color:'#64748b'} },
        y:{ grid:{color:'#1e2736'}, ticks:{color:'#64748b',callback:v=>'$'+(Math.abs(v)>=1000?(v/1000).toFixed(1)+'k':v)} },
      },
    },
  }), [JSON.stringify(forecastData)]);

  return (
    <div className="fade-in" style={{ padding:'24px 28px' }}>
      <div className="section-header">
        <div><div className="section-title">Accounts & Net Worth</div><div className="section-sub">Track assets and liabilities</div></div>
        <div style={{ display:'flex', gap:8 }}>
          <button className="btn btn-secondary" onClick={()=>setReconcileAllMode(m=>!m)}>
            {reconcileAllMode ? '✕ Exit Reconcile All' : '🔍 Reconcile All'}
          </button>
          <button className="btn btn-primary" onClick={()=>setShowAdd(true)}>+ Add Account</button>
        </div>
      </div>

      <div style={{ display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:14,marginBottom:24 }}>
        <div className="stat-card" style={{ borderColor:netWorth>=0?'#14532d44':'#7f1d1d44' }}>
          <div style={{ fontSize:12,color:'#64748b',fontWeight:600,textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:6 }}>Net Worth</div>
          <div className="hero-num" style={{ fontSize:28,fontWeight:400,color:netWorth>=0?'#4ade80':'#c2735a' }}>{fmt(netWorth)}</div>
          <div style={{ fontSize:12,color:'#475569',marginTop:4 }}>Assets minus debts</div>
        </div>
        <div className="stat-card">
          <div style={{ fontSize:12,color:'#64748b',fontWeight:600,textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:6 }}>Total Assets</div>
          <div className="hero-num" style={{ fontSize:28,fontWeight:400,color:'#4ade80' }}>{fmt(totAssets)}</div>
          <div style={{ fontSize:12,color:'#475569',marginTop:4 }}>{assets.length} accounts</div>
        </div>
        <div className="stat-card">
          <div style={{ fontSize:12,color:'#64748b',fontWeight:600,textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:6 }}>Total Debts</div>
          <div className="hero-num" style={{ fontSize:28,fontWeight:400,color:'#c2735a' }}>{fmt(totDebts)}</div>
          <div style={{ fontSize:12,color:'#475569',marginTop:4 }}>{debts.length} accounts</div>
        </div>
      </div>

      {historyData.length >= 2 && (
        <div className="card" style={{ marginBottom:24 }}>
          <div style={{ fontWeight:600,fontSize:14,marginBottom:4 }}>Net Worth Over Time</div>
          <div style={{ fontSize:12,color:'#64748b',marginBottom:16 }}>{historyData.length} daily snapshots (auto-tracked)</div>
          <div className="chart-container" style={{ height:200 }}><canvas ref={canvasNW} /></div>
        </div>
      )}
      {historyData.length < 2 && accounts.length > 0 && (
        <div className="card" style={{ marginBottom:24, textAlign:'center', padding:'24px', color:'#475569' }}>
          <div style={{ fontSize:24, marginBottom:8 }}>📈</div>
          <p style={{ fontSize:14 }}>Net worth history will appear here as you use the app over time.</p>
          <p style={{ fontSize:12, marginTop:6 }}>Snapshots are captured automatically each day.</p>
        </div>
      )}

      {/* Net Worth Forecast */}
      {activeRecs.length > 0 && (
        <div className="card" style={{ marginBottom:24 }}>
          <div style={{ fontWeight:600,fontSize:14,marginBottom:4 }}>📈 12-Month Net Worth Forecast</div>
          <div style={{ fontSize:12,color:'#64748b',marginBottom:4 }}>
            Based on {activeRecs.length} active recurring rule{activeRecs.length!==1?'s':''} ·
            Estimated monthly net flow: <span style={{ color: monthlyNetFlow>=0?'#4ade80':'#c2735a',fontWeight:600 }}>{monthlyNetFlow>=0?'+':''}{fmt(monthlyNetFlow)}/mo</span>
          </div>
          <div style={{ fontSize:12,color:'#475569',marginBottom:12 }}>
            Projected 12 months from now: <strong style={{ color: forecastData[12]?.value >= netWorth?'#4ade80':'#c2735a' }}>{fmt(forecastData[12]?.value ?? netWorth)}</strong>
          </div>
          <div className="chart-container" style={{ height:180 }}><canvas ref={canvasForecast} /></div>
        </div>
      )}

      {reconcileAllMode && (
        <div style={{ marginBottom:24 }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:16 }}>
            <div style={{ fontWeight:700, fontSize:15, color:'#e2e8f0' }}>🔍 Reconcile All Accounts</div>
            <button className="btn btn-primary btn-sm" onClick={()=>setReconcileAllMode(false)}>Done</button>
          </div>
          {accounts.map(acct => {
            const acctTxs = transactions.filter(t => t.account === acct.id && !t.cleared && t.type !== 'adjustment');
            const computed = transactions.filter(t => t.account === acct.id && t.type !== 'adjustment').reduce((s,t) => s+t.amount, 0);
            const discrepancy = Math.abs(acct.balance - computed);
            const hasDiscrepancy = discrepancy > 0.01;
            return (
              <div key={acct.id} style={{ marginBottom:10, border:`1px solid ${hasDiscrepancy ? '#f59e0b44' : '#14532d44'}`, borderRadius:10, overflow:'hidden' }}>
                <div style={{ display:'flex', alignItems:'center', gap:12, padding:'10px 14px', background: hasDiscrepancy ? '#1a1600' : '#0a1a0a' }}>
                  <div style={{ fontSize:18 }}>{acctEmoji(acct.type)}</div>
                  <div style={{ flex:1 }}>
                    <span style={{ fontWeight:600, fontSize:14, color:'#e2e8f0' }}>{acct.name}</span>
                    <span style={{ fontSize:12, color:'#64748b', marginLeft:8 }}>{acctLabel(acct.type)}</span>
                  </div>
                  <div style={{ textAlign:'right', fontSize:12, color:'#94a3b8' }}>
                    <div>Stored: <strong style={{ color:'#e2e8f0' }}>{fmt(acct.balance)}</strong></div>
                    <div>Computed: <strong style={{ color:'#e2e8f0' }}>{fmt(computed)}</strong></div>
                    {hasDiscrepancy
                      ? <div style={{ color:'#f59e0b', fontWeight:600 }}>⚠ Discrepancy: {fmt(discrepancy)}</div>
                      : <div style={{ color:'#4ade80', fontWeight:600 }}>✅ Balanced</div>
                    }
                  </div>
                </div>
                {hasDiscrepancy && acctTxs.length > 0 && (
                  <div style={{ padding:'10px 14px', background:'#161d2b', borderTop:'1px solid #2d3748' }}>
                    <div style={{ fontSize:12, color:'#94a3b8', marginBottom:6 }}>Uncleared transactions:</div>
                    {acctTxs.sort((a,b)=>b.date.localeCompare(a.date)).map(t => (
                      <div key={t.id} style={{ display:'flex', alignItems:'center', gap:8, padding:'5px 0', borderBottom:'1px solid #1e273640' }}>
                        <input type="checkbox" checked={false} onChange={()=>{ if(onToggleCleared) onToggleCleared(t.id); }} />
                        <span style={{ fontSize:12, color:'#94a3b8', width:80, flexShrink:0 }}>{t.date}</span>
                        <span style={{ fontSize:12, color:'#cbd5e1', flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{t.description}</span>
                        <span style={{ fontSize:12, fontWeight:600, color:t.amount>=0?'#4ade80':'#c2735a', flexShrink:0 }}>{t.amount>=0?'+':''}{fmt(t.amount)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {!reconcileAllMode && accounts.length === 0
        ? <div className="card"><div className="empty-state"><div className="empty-icon">🏦</div><p>No accounts yet</p><button className="btn btn-primary" style={{ marginTop:12 }} onClick={()=>setShowAdd(true)}>+ Add Account</button></div></div>
        : <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:20 }}>
            <div>
              <div style={{ fontSize:12,fontWeight:700,color:'#4ade80',textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:12 }}>Assets ({assets.length})</div>
              {assets.length === 0
                ? <div className="card-sm" style={{ color:'#475569',fontSize:14,textAlign:'center' }}>No asset accounts</div>
                : assets.map(a => {
                    const acctTxs = transactions.filter(t => t.account === a.id).sort((x,y) => y.date.localeCompare(x.date));
                    const oldUncleared = acctTxs.filter(t => !t.cleared && (new Date() - new Date(t.date + 'T00:00:00')) > 30*24*60*60*1000);
                    const isReconciling = reconcileAcct === a.id;
                    const stmtVal = parseFloat(stmtBalance) || 0;
                    const clearedSum = acctTxs.filter(t => clearedIds.has(t.id)).reduce((s,t) => s + t.amount, 0);
                    const discrepancy = stmtVal - clearedSum;
                    return (
                      <div key={a.id} style={{ marginBottom:8 }}>
                        <div className="card-sm" style={{ display:'flex',alignItems:'center',gap:12 }}>
                          <div style={{ width:40,height:40,borderRadius:10,background:acctColor(a.type)+'22',display:'flex',alignItems:'center',justifyContent:'center',fontSize:18,flexShrink:0 }}>
                            {acctEmoji(a.type)}
                          </div>
                          <div style={{ flex:1 }}>
                            <div style={{ fontWeight:600,fontSize:14 }}>{a.name}</div>
                            <div style={{ fontSize:12,color:acctColor(a.type),marginTop:2 }}>{acctLabel(a.type)}</div>
                            {a.lastStatementDate && (() => {
                              const daysAgo = Math.floor((new Date() - new Date(a.lastStatementDate+'T00:00:00')) / (24*60*60*1000));
                              return (
                                <div style={{ fontSize:11,color:daysAgo>45?'#f59e0b':'#64748b',marginTop:3 }}>
                                  Last reconciled: {a.lastStatementDate}{daysAgo>45?' ⚠':''}
                                </div>
                              );
                            })()}
                            {oldUncleared.length > 0 && (
                              <div style={{ fontSize:11,color:'#f59e0b',marginTop:3 }}>
                                ⚠ {oldUncleared.length} uncleared transaction{oldUncleared.length!==1?'s':''} &gt;30 days
                              </div>
                            )}
                          </div>
                          <div style={{ textAlign:'right', marginRight:8 }}>
                            <div style={{ fontSize:17,fontWeight:700,color:'#e2e8f0' }}>{fmt(a.balance)}</div>
                            {(() => {
                              const computed = computeBalance(a.id, transactions, a.type);
                              if (computed === null) return null;
                              const diff = Math.abs(computed - a.balance);
                              if (diff < 0.01) return null;
                              return (
                                <div title="Transaction history total differs from stored balance. Consider reconciling." style={{ fontSize:11, color:'#f59e0b', marginTop:3, cursor:'help' }}>
                                  ⚠ tx total: {fmt(computed)}
                                </div>
                              );
                            })()}
                          </div>
                          <button className="btn btn-ghost btn-sm" title="Reconcile" onClick={()=>isReconciling?closeReconcile():openReconcile(a.id)}>⚖️</button>
                          <button className="btn btn-ghost btn-sm" onClick={()=>setEditA({...a,balance:String(a.balance)})}>✏️</button>
                          <button className="btn btn-ghost btn-sm" style={{ color:'#c2735a' }}
                            onClick={()=>{ if(confirm('Remove this account?')) onDelete(a.id); }}>🗑</button>
                        </div>
                        {isReconciling && (
                          <div style={{ background:'#161d2b',border:'1px solid #2d3748',borderRadius:10,padding:14,marginTop:4 }}>
                            <div style={{ fontWeight:600,fontSize:13,marginBottom:10,color:'#e2e8f0' }}>Reconcile: {a.name}</div>
                            <div style={{ display:'flex',alignItems:'center',gap:10,marginBottom:8,flexWrap:'wrap' }}>
                              <label style={{ fontSize:12,color:'#94a3b8' }}>Statement Balance ($)</label>
                              <input type="number" step="0.01" value={stmtBalance} onChange={e=>setStmtBalance(e.target.value)}
                                style={{ width:120,padding:'4px 8px',background:'#0d1117',border:'1px solid #2d3748',borderRadius:6,color:'#e2e8f0',fontSize:13 }} />
                              <label style={{ fontSize:12,color:'#94a3b8',marginLeft:8 }}>Statement End Date</label>
                              <input type="date" value={stmtDate} onChange={e=>setStmtDate(e.target.value)}
                                style={{ padding:'4px 8px',background:'#0d1117',border:'1px solid #2d3748',borderRadius:6,color:'#e2e8f0',fontSize:13 }} />
                            </div>
                            <div style={{ maxHeight:220,overflowY:'auto',marginBottom:10 }}>
                              {acctTxs.length === 0
                                ? <div style={{ fontSize:12,color:'#475569',padding:'8px 0' }}>No transactions for this account.</div>
                                : acctTxs.map(t => (
                                    <div key={t.id} style={{ display:'flex',alignItems:'center',gap:8,padding:'5px 0',borderBottom:'1px solid #1e273640' }}>
                                      <input type="checkbox" checked={clearedIds.has(t.id)} onChange={()=>toggleClearedLocal(t.id)} />
                                      <span style={{ fontSize:12,color:'#94a3b8',width:80,flexShrink:0 }}>{t.date}</span>
                                      <span style={{ fontSize:12,color:'#cbd5e1',flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>{t.description}</span>
                                      <span style={{ fontSize:12,fontWeight:600,color:t.amount>=0?'#4ade80':'#c2735a',flexShrink:0 }}>{t.amount>=0?'+':''}{fmt(t.amount)}</span>
                                    </div>
                                  ))
                              }
                            </div>
                            <div style={{ fontSize:12,color:'#94a3b8',marginBottom:8,display:'flex',gap:20 }}>
                              <span>Cleared sum: <strong style={{ color:'#e2e8f0' }}>{fmt(clearedSum)}</strong></span>
                              {stmtBalance !== '' && (
                                <span>Discrepancy: <strong style={{ color:Math.abs(discrepancy)<0.01?'#4ade80':'#f59e0b' }}>{fmt(discrepancy)}</strong></span>
                              )}
                            </div>
                            <div style={{ display:'flex',gap:8,justifyContent:'flex-end' }}>
                              <button className="btn btn-secondary btn-sm" onClick={closeReconcile}>Cancel</button>
                              <button className="btn btn-primary btn-sm" onClick={finishReconcile}>Finish Reconcile</button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })
              }
            </div>
            <div>
              <div style={{ fontSize:12,fontWeight:700,color:'#c2735a',textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:12 }}>Debts ({debts.length})</div>
              {debts.length === 0
                ? <div className="card-sm" style={{ color:'#475569',fontSize:14,textAlign:'center' }}>No debt accounts 🎉</div>
                : debts.map(a => {
                    const acctTxs = transactions.filter(t => t.account === a.id).sort((x,y) => y.date.localeCompare(x.date));
                    const oldUncleared = acctTxs.filter(t => !t.cleared && (new Date() - new Date(t.date + 'T00:00:00')) > 30*24*60*60*1000);
                    const isReconciling = reconcileAcct === a.id;
                    const stmtVal = parseFloat(stmtBalance) || 0;
                    const clearedSum = acctTxs.filter(t => clearedIds.has(t.id)).reduce((s,t) => s + t.amount, 0);
                    const discrepancy = stmtVal - clearedSum;
                    return (
                      <div key={a.id} style={{ marginBottom:8 }}>
                        <div className="card-sm" style={{ display:'flex',alignItems:'center',gap:12 }}>
                          <div style={{ width:40,height:40,borderRadius:10,background:acctColor(a.type)+'22',display:'flex',alignItems:'center',justifyContent:'center',fontSize:18,flexShrink:0 }}>
                            {acctEmoji(a.type)}
                          </div>
                          <div style={{ flex:1 }}>
                            <div style={{ fontWeight:600,fontSize:14 }}>{a.name}</div>
                            <div style={{ fontSize:12,color:acctColor(a.type),marginTop:2 }}>{acctLabel(a.type)}</div>
                            {a.lastStatementDate && (() => {
                              const daysAgo = Math.floor((new Date() - new Date(a.lastStatementDate+'T00:00:00')) / (24*60*60*1000));
                              return (
                                <div style={{ fontSize:11,color:daysAgo>45?'#f59e0b':'#64748b',marginTop:3 }}>
                                  Last reconciled: {a.lastStatementDate}{daysAgo>45?' ⚠':''}
                                </div>
                              );
                            })()}
                            {oldUncleared.length > 0 && (
                              <div style={{ fontSize:11,color:'#f59e0b',marginTop:3 }}>
                                ⚠ {oldUncleared.length} uncleared transaction{oldUncleared.length!==1?'s':''} &gt;30 days
                              </div>
                            )}
                          </div>
                          <div style={{ textAlign:'right', marginRight:8 }}>
                            <div style={{ fontSize:17,fontWeight:700,color:'#c2735a' }}>-{fmt(a.balance)}</div>
                            {(() => {
                              const computed = computeBalance(a.id, transactions, a.type);
                              if (computed === null) return null;
                              const diff = Math.abs(computed - a.balance);
                              if (diff < 0.01) return null;
                              return (
                                <div title="Transaction history total differs from stored balance. Consider reconciling." style={{ fontSize:11, color:'#f59e0b', marginTop:3, cursor:'help' }}>
                                  ⚠ tx total: {fmt(computed)}
                                </div>
                              );
                            })()}
                          </div>
                          <button className="btn btn-ghost btn-sm" title="Reconcile" onClick={()=>isReconciling?closeReconcile():openReconcile(a.id)}>⚖️</button>
                          <button className="btn btn-ghost btn-sm" onClick={()=>setEditA({...a,balance:String(a.balance)})}>✏️</button>
                          <button className="btn btn-ghost btn-sm" style={{ color:'#c2735a' }}
                            onClick={()=>{ if(confirm('Remove this account?')) onDelete(a.id); }}>🗑</button>
                        </div>
                        {isReconciling && (
                          <div style={{ background:'#161d2b',border:'1px solid #2d3748',borderRadius:10,padding:14,marginTop:4 }}>
                            <div style={{ fontWeight:600,fontSize:13,marginBottom:10,color:'#e2e8f0' }}>Reconcile: {a.name}</div>
                            <div style={{ display:'flex',alignItems:'center',gap:10,marginBottom:8,flexWrap:'wrap' }}>
                              <label style={{ fontSize:12,color:'#94a3b8' }}>Statement Balance ($)</label>
                              <input type="number" step="0.01" value={stmtBalance} onChange={e=>setStmtBalance(e.target.value)}
                                style={{ width:120,padding:'4px 8px',background:'#0d1117',border:'1px solid #2d3748',borderRadius:6,color:'#e2e8f0',fontSize:13 }} />
                              <label style={{ fontSize:12,color:'#94a3b8',marginLeft:8 }}>Statement End Date</label>
                              <input type="date" value={stmtDate} onChange={e=>setStmtDate(e.target.value)}
                                style={{ padding:'4px 8px',background:'#0d1117',border:'1px solid #2d3748',borderRadius:6,color:'#e2e8f0',fontSize:13 }} />
                            </div>
                            <div style={{ maxHeight:220,overflowY:'auto',marginBottom:10 }}>
                              {acctTxs.length === 0
                                ? <div style={{ fontSize:12,color:'#475569',padding:'8px 0' }}>No transactions for this account.</div>
                                : acctTxs.map(t => (
                                    <div key={t.id} style={{ display:'flex',alignItems:'center',gap:8,padding:'5px 0',borderBottom:'1px solid #1e273640' }}>
                                      <input type="checkbox" checked={clearedIds.has(t.id)} onChange={()=>toggleClearedLocal(t.id)} />
                                      <span style={{ fontSize:12,color:'#94a3b8',width:80,flexShrink:0 }}>{t.date}</span>
                                      <span style={{ fontSize:12,color:'#cbd5e1',flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>{t.description}</span>
                                      <span style={{ fontSize:12,fontWeight:600,color:t.amount>=0?'#4ade80':'#c2735a',flexShrink:0 }}>{t.amount>=0?'+':''}{fmt(t.amount)}</span>
                                    </div>
                                  ))
                              }
                            </div>
                            <div style={{ fontSize:12,color:'#94a3b8',marginBottom:8,display:'flex',gap:20 }}>
                              <span>Cleared sum: <strong style={{ color:'#e2e8f0' }}>{fmt(clearedSum)}</strong></span>
                              {stmtBalance !== '' && (
                                <span>Discrepancy: <strong style={{ color:Math.abs(discrepancy)<0.01?'#4ade80':'#f59e0b' }}>{fmt(discrepancy)}</strong></span>
                              )}
                            </div>
                            <div style={{ display:'flex',gap:8,justifyContent:'flex-end' }}>
                              <button className="btn btn-secondary btn-sm" onClick={closeReconcile}>Cancel</button>
                              <button className="btn btn-primary btn-sm" onClick={finishReconcile}>Finish Reconcile</button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })
              }
            </div>
          </div>
      }

      {showAdd && <Modal title="Add Account" onClose={()=>setShowAdd(false)}><AccountForm onSave={a=>{onAdd(a);setShowAdd(false);}} onClose={()=>setShowAdd(false)} /></Modal>}
      {editA   && <Modal title="Edit Account" onClose={()=>setEditA(null)}><AccountForm initial={editA} onSave={a=>{onEdit(a);setEditA(null);}} onClose={()=>setEditA(null)} /></Modal>}
    </div>
  );
}
