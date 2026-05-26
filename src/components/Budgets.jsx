import { useState, useMemo, useEffect, useRef } from 'react';
import { CATEGORIES, getAllCategories, catColor, catIcon, fmt, thisMonth, nextMonth, prevMonth, uid, parseAmount } from '../constants.js';
import Modal from './Modal.jsx';

function BudgetForm({ initial, defaultMonth, onSave, onClose, userCategories }) {
  const [cat,      setCat]      = useState(initial?.category ?? 'Food & Dining');
  const [amt,      setAmt]      = useState(initial?.amount != null ? String(initial.amount) : '');
  const [mon,      setMon]      = useState(initial?.month ?? defaultMonth);
  const [rollover, setRollover] = useState(initial?.rollover ?? false);

  const save = () => {
    const v = parseAmount(amt);
    if (isNaN(v) || v <= 0) return;
    onSave({ id: initial?.id ?? uid(), category: cat, amount: Math.abs(v), month: mon, rollover });
  };
  return (
    <div className="form-grid" style={{ gap:14 }}>
      <div className="form-group">
        <label className="form-label">Category</label>
        <select value={cat} onChange={e=>setCat(e.target.value)}>
          {getAllCategories(userCategories).filter(c=>c.name!=='Income'&&c.name!=='Split'&&c.name!=='Transfer').map(c=><option key={c.name} value={c.name}>{c.icon} {c.name}</option>)}
        </select>
      </div>
      <div className="form-group">
        <label className="form-label">Monthly Budget ($)</label>
        <input type="number" min="1" step="1" placeholder="500" value={amt} onChange={e=>setAmt(e.target.value)} />
      </div>
      <div className="form-group">
        <label className="form-label">Month</label>
        <input type="month" value={mon} onChange={e=>setMon(e.target.value)} />
      </div>
      <div className="form-group" style={{ display:'flex', alignItems:'center', gap:10 }}>
        <input type="checkbox" id="rollover-toggle" checked={rollover} onChange={e=>setRollover(e.target.checked)}
          style={{ width:16, height:16, cursor:'pointer' }} />
        <label htmlFor="rollover-toggle" style={{ cursor:'pointer', fontSize:14, color:'#e2e8f0' }}>
          Roll over unspent amounts to next month
        </label>
      </div>
      <div style={{ display:'flex',gap:8,justifyContent:'flex-end' }}>
        <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save}>Save Budget</button>
      </div>
    </div>
  );
}

export default function Budgets({ transactions, budgets, onAdd, onEdit, onDelete, userCategories, budgetTemplates = [], onSaveTemplate, onLoadTemplate, onBudgetAlert, onToggleTemplateAutoApply }) {
  const [month,   setMonth]   = useState(thisMonth());
  const [showAdd, setShowAdd] = useState(false);
  const [editB,   setEditB]   = useState(null);
  const [copied,  setCopied]  = useState(false);
  const [view,    setView]    = useState('current');
  const alertedRef = useRef(new Set());

  const monthBudgets = budgets.filter(b => b.month === month);

  const spend = useMemo(() => {
    const map = {};
    transactions.filter(t=>t.type==='expense'&&t.date.startsWith(month)).forEach(t=>{
      map[t.category] = (map[t.category]||0) + Math.abs(t.amount);
    });
    return map;
  }, [transactions, month]);

  const prevMonthStr = prevMonth(month);
  const prevSpend = useMemo(() => {
    const map = {};
    transactions.filter(t=>t.type==='expense'&&t.date.startsWith(prevMonthStr)).forEach(t=>{
      map[t.category] = (map[t.category]||0) + Math.abs(t.amount);
    });
    return map;
  }, [transactions, prevMonthStr]);

  const prevMonthBudgets = useMemo(() => {
    const map = {};
    budgets.filter(b=>b.month===prevMonthStr).forEach(b=>{ map[b.category]=b; });
    return map;
  }, [budgets, prevMonthStr]);

  const getEffectiveLimit = (b) => {
    if (!b.rollover) return b.amount;
    const prevB = prevMonthBudgets[b.category];
    if (!prevB) return b.amount;
    const prevUnspent = Math.max(0, prevB.amount - (prevSpend[b.category] || 0));
    return b.amount + prevUnspent;
  };

  const totalBudget = monthBudgets.reduce((s,b)=>s+getEffectiveLimit(b),0);
  const totalSpend  = monthBudgets.reduce((s,b)=>s+(spend[b.category]||0),0);

  const months = useMemo(() => {
    const s = new Set([...budgets.map(b=>b.month), thisMonth()]);
    return Array.from(s).sort().reverse();
  }, [budgets]);

  const history6 = useMemo(() => Array.from({length:6}, (_,i) => {
    const d = new Date(); d.setMonth(d.getMonth() - (5-i));
    return d.toISOString().slice(0,7);
  }), []);

  const historySpend = useMemo(() => {
    const map = {};
    history6.forEach(m => {
      map[m] = {};
      transactions.filter(t=>t.type==='expense'&&t.date.startsWith(m)).forEach(t=>{
        map[m][t.category] = (map[m][t.category]||0) + Math.abs(t.amount);
      });
    });
    return map;
  }, [transactions, history6]);

  const historyCategories = useMemo(() => {
    const cats = new Set();
    budgets.filter(b=>history6.includes(b.month)).forEach(b=>cats.add(b.category));
    return Array.from(cats);
  }, [budgets, history6]);

  const historyBudget = useMemo(() => {
    const map = {};
    history6.forEach(m => {
      map[m] = {};
      budgets.filter(b=>b.month===m).forEach(b=>{ map[m][b.category]=b.amount; });
    });
    return map;
  }, [budgets, history6]);

  const annualData = useMemo(() => {
    const yr = new Date().getFullYear();
    const mons = Array.from({length: 12}, (_, i) => {
      const d = new Date(yr, i, 1);
      return d.toISOString().slice(0, 7);
    });
    return mons.map(m => {
      const spent = {};
      transactions.filter(t => t.type === 'expense' && t.date.startsWith(m)).forEach(t => {
        spent[t.category] = (spent[t.category] || 0) + Math.abs(t.amount);
      });
      return { month: m, spent };
    });
  }, [transactions]);

  const annualCategories = useMemo(() => {
    const yr = String(new Date().getFullYear());
    const cats = new Set();
    budgets.filter(b => b.month.startsWith(yr)).forEach(b => cats.add(b.category));
    return Array.from(cats);
  }, [budgets]);

  const annualBudgetMap = useMemo(() => {
    const map = {};
    budgets.forEach(b => {
      if (!map[b.month]) map[b.month] = {};
      map[b.month][b.category] = b.amount;
    });
    return map;
  }, [budgets]);

  // ── 3-month rolling average spend per category ────────────────────────────
  const rollingAvg3 = useMemo(() => {
    const map = {};
    // Last 3 months prior to the selected month
    const recentMonths = Array.from({length: 3}, (_, i) => {
      const d = new Date(month + '-01');
      d.setMonth(d.getMonth() - (i + 1));
      return d.toISOString().slice(0, 7);
    });
    // Collect all categories in current month's budgets
    const cats = new Set(monthBudgets.map(b => b.category));
    cats.forEach(cat => {
      const monthlyAmounts = recentMonths.map(m =>
        transactions
          .filter(t => t.type === 'expense' && t.category === cat && t.date.startsWith(m))
          .reduce((s, t) => s + Math.abs(t.amount), 0)
      );
      const nonZero = monthlyAmounts.filter(v => v > 0);
      map[cat] = nonZero.length > 0
        ? monthlyAmounts.reduce((s, v) => s + v, 0) / 3  // always divide by 3 (zero months count)
        : null; // null = no data for this category in last 3 months
    });
    return map;
  }, [transactions, month, monthBudgets]);

  useEffect(() => {
    if (!onBudgetAlert) return;
    const curBudgets = budgets.filter(b => b.month === thisMonth());
    curBudgets.forEach(b => {
      const spent = spend[b.category] || 0;
      const pct = b.amount > 0 ? spent / b.amount : 0;
      const key80  = `${b.category}-80`;
      const key100 = `${b.category}-100`;
      if (pct >= 0.8 && pct < 1.0 && !alertedRef.current.has(key80)) {
        alertedRef.current.add(key80);
        onBudgetAlert(b.category, 80);
      }
      if (pct >= 1.0 && !alertedRef.current.has(key100)) {
        alertedRef.current.add(key100);
        onBudgetAlert(b.category, 100);
      }
    });
  }, [budgets, spend, onBudgetAlert]);

  const copyToNext = () => {
    const nm = nextMonth(month);
    const existing = new Set(budgets.filter(b=>b.month===nm).map(b=>b.category));
    const toAdd = monthBudgets.filter(b=>!existing.has(b.category)).map(b=>({ ...b, id:uid(), month:nm, _seeded:undefined }));
    if (!toAdd.length) { alert(`All categories already have budgets for ${new Date(nm+'-01').toLocaleDateString('en-US',{month:'long',year:'numeric'})}.`); return; }
    toAdd.forEach(onAdd);
    setCopied(true);
    setTimeout(()=>setCopied(false),2500);
  };

  const nmLabel = new Date(nextMonth(month)+'-01').toLocaleDateString('en-US',{month:'long',year:'numeric'});

  const cellColor = (spent, limit) => {
    if (!limit) return '#1e2736';
    const pct = spent / limit;
    if (pct > 1)   return '#c2735a33';
    if (pct > 0.8) return '#f59e0b22';
    if (pct > 0)   return '#4ade8011';
    return '#1e2736';
  };

  return (
    <div className="fade-in" style={{ padding:'24px 28px' }}>
      <div className="section-header">
        <div><div className="section-title">Budgets</div><div className="section-sub">Set and track monthly spending limits</div></div>
        <div style={{ display:'flex',gap:8,alignItems:'center' }}>
          <div className="tab-group" style={{ marginBottom:0 }}>
            <div className={`tab${view==='current'?' active':''}`} onClick={()=>setView('current')}>This Month</div>
            <div className={`tab${view==='history'?' active':''}`} onClick={()=>setView('history')}>6-Month History</div>
            <div className={`tab${view==='annual'?' active':''}`} onClick={()=>setView('annual')}>Annual</div>
          </div>
          {view === 'current' && (
            <>
              <select value={month} onChange={e=>{setMonth(e.target.value);setCopied(false);}} style={{ width:170 }}>
                {months.map(m=><option key={m} value={m}>{new Date(m+'-01').toLocaleDateString('en-US',{month:'long',year:'numeric'})}</option>)}
              </select>
              {monthBudgets.length > 0 && (
                <button className="btn btn-secondary" onClick={copyToNext} title={`Copy to ${nmLabel}`}>
                  {copied ? 'Copied!' : `Copy to ${nmLabel}`}
                </button>
              )}
              <button className="btn btn-primary" onClick={()=>setShowAdd(true)}>+ Add Budget</button>
            </>
          )}
        </div>
      </div>

      {view === 'current' && (
        <>
          <div className="card" style={{ marginBottom:16, padding:'12px 16px' }}>
            <div style={{ display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
              <span style={{ fontSize:13, fontWeight:600, color:'#94a3b8' }}>Templates</span>
              <button
                className="btn btn-secondary"
                style={{ fontSize:12, padding:'4px 10px' }}
                onClick={() => {
                  if (monthBudgets.length === 0) { alert('No budgets in current month to save.'); return; }
                  const name = prompt('Template name:');
                  if (name && name.trim() && onSaveTemplate) onSaveTemplate(name.trim(), monthBudgets);
                }}
              >
                Save as Template
              </button>
              {budgetTemplates.length > 0 && (
                <select
                  defaultValue=""
                  style={{ fontSize:12, padding:'4px 8px', width:'auto', minWidth:160 }}
                  onChange={e => {
                    const tpl = budgetTemplates.find(t => t.name === e.target.value);
                    if (tpl && onLoadTemplate) {
                      if (confirm(`Load template "${tpl.name}"? This will replace current month budgets.`)) {
                        onLoadTemplate(tpl);
                      }
                    }
                    e.target.value = '';
                  }}
                >
                  <option value="" disabled>Load template...</option>
                  {budgetTemplates.map(t => <option key={t.name} value={t.name}>{t.name}</option>)}
                </select>
              )}
              {budgetTemplates.length > 0 && (
                <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                  {budgetTemplates.map(t => (
                    <div key={t.name} style={{ display:'flex', flexDirection:'column', gap:3 }}>
                      <span style={{ display:'inline-flex', alignItems:'center', gap:4, background:'#1e2736', border:'1px solid #334155', borderRadius:20, padding:'2px 10px', fontSize:11, color:'#94a3b8' }}>
                        {t.name}
                        <button
                          style={{ background:'none', border:'none', cursor:'pointer', color:'#7fa88b', fontSize:11, padding:0, marginLeft:2 }}
                          onClick={() => { if (onLoadTemplate && confirm(`Apply template "${t.name}"?`)) onLoadTemplate(t); }}
                        >
                          Apply
                        </button>
                      </span>
                      <label style={{ display:'inline-flex', alignItems:'center', gap:4, fontSize:10, color:'#64748b', cursor:'pointer', paddingLeft:10 }}>
                        <input
                          type="checkbox"
                          checked={t.autoApply === true}
                          onChange={() => onToggleTemplateAutoApply && onToggleTemplateAutoApply(t.name)}
                          style={{ width:11, height:11, cursor:'pointer' }}
                        />
                        Auto-apply monthly
                      </label>
                      {t.autoApply && (
                        <div style={{ fontSize:10, color:'#7fa88b', paddingLeft:10 }}>Applied automatically on the 1st of each month</div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div style={{ display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:14,marginBottom:20 }}>
            <div className="stat-card">
              <div style={{ fontSize:12,color:'#64748b',fontWeight:600,textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:6 }}>Total Budgeted</div>
              <div className="hero-num" style={{ fontSize:26,fontWeight:400,color:'#e2e8f0' }}>{fmt(totalBudget)}</div>
            </div>
            <div className="stat-card">
              <div style={{ fontSize:12,color:'#64748b',fontWeight:600,textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:6 }}>Total Spent</div>
              <div className="hero-num" style={{ fontSize:26,fontWeight:400,color:totalSpend>totalBudget?'#c2735a':'#e2e8f0' }}>{fmt(totalSpend)}</div>
            </div>
            <div className="stat-card">
              <div style={{ fontSize:12,color:'#64748b',fontWeight:600,textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:6 }}>Remaining</div>
              <div className="hero-num" style={{ fontSize:26,fontWeight:400,color:totalBudget-totalSpend>=0?'#4ade80':'#c2735a' }}>{fmt(totalBudget-totalSpend)}</div>
            </div>
          </div>

          {totalBudget > 0 && (
            <div className="card" style={{ marginBottom:20 }}>
              <div style={{ display:'flex',justifyContent:'space-between',marginBottom:8,fontSize:13,color:'#94a3b8' }}>
                <span>Overall budget usage</span>
                <span style={{ fontWeight:600 }}>{Math.round(totalSpend/totalBudget*100)}%</span>
              </div>
              <div className="progress-bar" style={{ height:10 }}>
                <div className="progress-fill" style={{ width:`${Math.min(100,totalSpend/totalBudget*100)}%`, background:totalSpend>totalBudget?'#c2735a':totalSpend/totalBudget>0.8?'#f59e0b':'#7fa88b' }} />
              </div>
            </div>
          )}

          {monthBudgets.length === 0
            ? (
              <div className="card" style={{ padding:'40px 32px', textAlign:'center' }}>
                <div style={{ fontSize:40, marginBottom:12 }}>📋</div>
                <div style={{ fontSize:16, fontWeight:600, color:'#e2e8f0', marginBottom:8 }}>No budgets for this month</div>
                <div style={{ fontSize:13, color:'#64748b', marginBottom:20, maxWidth:400, margin:'0 auto 20px' }}>
                  Set category limits to control your spending. Use a template to apply last month's budgets instantly, or add them one at a time.
                </div>
                <div style={{ display:'flex', gap:10, justifyContent:'center', flexWrap:'wrap' }}>
                  <button className="btn btn-primary" onClick={()=>setShowAdd(true)}>+ Add Budget</button>
                  {budgetTemplates.length > 0 && (
                    <select defaultValue="" onChange={e => { const tpl = budgetTemplates.find(t=>t.name===e.target.value); if (tpl && onLoadTemplate) onLoadTemplate(tpl); }}
                      style={{ fontSize:13, background:'#1e2736', border:'1px solid #334155', borderRadius:6, color:'#94a3b8', padding:'6px 10px', cursor:'pointer' }}>
                      <option value="" disabled>📂 Load template…</option>
                      {budgetTemplates.map(t => <option key={t.name} value={t.name}>{t.name}</option>)}
                    </select>
                  )}
                </div>
              </div>
            )
            : monthBudgets.map(b => {
                const spent      = spend[b.category] || 0;
                const effLimit   = getEffectiveLimit(b);
                const rolloverAmt= effLimit - b.amount;
                const pct        = effLimit > 0 ? Math.min(100, (spent/effLimit)*100) : 0;
                const over       = effLimit > 0 && spent > effLimit;
                const avg3       = rollingAvg3[b.category];
                // Trend: is current spend tracking above or below 3-month avg? (scaled to full month)
                const today      = new Date();
                const daysInMonth= new Date(today.getFullYear(), today.getMonth()+1, 0).getDate();
                const dayOfMonth = today.getDate();
                const projectedSpend = dayOfMonth > 0 ? (spent / dayOfMonth) * daysInMonth : spent;
                const trendPct   = avg3 > 0 ? ((projectedSpend - avg3) / avg3 * 100) : null;
                return (
                  <div key={b.id} className="card-sm" style={{ marginBottom:10 }}>
                    <div style={{ display:'flex',alignItems:'center',gap:10,marginBottom:10 }}>
                      <span style={{ fontSize:20 }}>{catIcon(b.category)}</span>
                      <div style={{ flex:1 }}>
                        <div style={{ fontWeight:600,fontSize:14 }}>{b.category}</div>
                        {b.rollover && <div style={{ fontSize:11,color:'#64748b' }}>Rollover enabled</div>}
                        {avg3 !== null && (
                          <div style={{ fontSize:11,color:'#64748b',marginTop:2 }}>
                            3-mo avg: <span style={{ color:'#94a3b8' }}>{fmt(avg3)}/mo</span>
                            {trendPct !== null && (
                              <span style={{ marginLeft:8, color: Math.abs(trendPct) < 5 ? '#64748b' : trendPct > 0 ? '#c2735a' : '#4ade80', fontWeight:600 }}>
                                {trendPct > 0 ? '▲' : '▼'} {Math.abs(trendPct).toFixed(0)}% vs avg
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                      <div style={{ textAlign:'right' }}>
                        <div style={{ fontSize:15,fontWeight:700,color:over?'#c2735a':'#e2e8f0' }}>{fmt(spent)}</div>
                        <div style={{ fontSize:12,color:'#64748b' }}>of {fmt(effLimit)}</div>
                        {avg3 !== null && b.amount > 0 && avg3 > b.amount * 1.1 && (
                          <div style={{ fontSize:10,color:'#f59e0b',marginTop:2 }} title="Your 3-month average spend exceeds this budget">⚠ avg &gt; budget</div>
                        )}
                      </div>
                      <button className="btn btn-ghost btn-sm" onClick={()=>setEditB(b)}>Edit</button>
                      <button className="btn btn-ghost btn-sm" style={{ color:'#c2735a' }}
                        onClick={()=>{ if(confirm('Remove this budget?')) onDelete(b.id); }}>Delete</button>
                    </div>
                    <div className="progress-bar">
                      <div className="progress-fill" style={{ width:`${pct}%`, background:over?'#c2735a':pct>80?'#f59e0b':catColor(b.category) }} />
                    </div>
                    <div style={{ display:'flex',justifyContent:'space-between',marginTop:6,fontSize:12,color:'#475569' }}>
                      <span>
                        {Math.round(pct)}% used
                        {rolloverAmt > 0 && <span style={{ color:'#7fa88b',marginLeft:6 }}>incl. {fmt(rolloverAmt)} rollover</span>}
                      </span>
                      <span style={{ color:over?'#c2735a':'#4ade80' }}>
                        {over ? `${fmt(spent-effLimit)} over budget` : `${fmt(effLimit-spent)} remaining`}
                      </span>
                    </div>
                  </div>
                );
              })
          }
        </>
      )}

      {view === 'history' && (
        <div className="card" style={{ padding:0, overflow:'auto' }}>
          {historyCategories.length === 0
            ? <div className="empty-state"><div className="empty-icon">📅</div><p>No budget data in the last 6 months</p></div>
            : (
              <table style={{ width:'100%', borderCollapse:'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign:'left', padding:'12px 16px', fontSize:13, color:'#64748b', borderBottom:'1px solid #1e2736' }}>Category</th>
                    {history6.map(m => (
                      <th key={m} style={{ textAlign:'right', padding:'12px 12px', fontSize:12, color:'#64748b', borderBottom:'1px solid #1e2736', whiteSpace:'nowrap' }}>
                        {new Date(m+'-01').toLocaleDateString('en-US',{month:'short',year:'2-digit'})}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {historyCategories.map(cat => (
                    <tr key={cat} style={{ borderBottom:'1px solid #1e273666' }}>
                      <td style={{ padding:'10px 16px', fontSize:13, fontWeight:600 }}>
                        {catIcon(cat)} {cat}
                      </td>
                      {history6.map(m => {
                        const spent = historySpend[m]?.[cat] || 0;
                        const limit = historyBudget[m]?.[cat] || 0;
                        const color = cellColor(spent, limit);
                        return (
                          <td key={m} style={{ textAlign:'right', padding:'10px 12px', background:color }}>
                            {limit > 0 ? (
                              <>
                                <div style={{ fontSize:13, fontWeight:600, color: spent > limit ? '#c2735a' : '#e2e8f0' }}>{fmt(spent)}</div>
                                <div style={{ fontSize:10, color:'#475569' }}>of {fmt(limit)}</div>
                              </>
                            ) : (
                              <span style={{ color:'#334155', fontSize:12 }}>-</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          }
        </div>
      )}

      {view === 'annual' && (
        <div className="card" style={{ padding:0, overflow:'auto' }}>
          {annualCategories.length === 0
            ? <div className="empty-state"><div className="empty-icon">📅</div><p>No budget data for {new Date().getFullYear()}</p></div>
            : (
              <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign:'left', padding:'12px 16px', color:'#64748b', borderBottom:'1px solid #1e2736', whiteSpace:'nowrap' }}>Month</th>
                    {annualCategories.map(cat => (
                      <th key={cat} style={{ textAlign:'right', padding:'12px 10px', color:'#64748b', borderBottom:'1px solid #1e2736', whiteSpace:'nowrap', fontSize:11 }}>
                        {cat}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {annualData.map(row => {
                    const label = new Date(row.month + '-02').toLocaleString('default', { month: 'short' });
                    return (
                      <tr key={row.month} style={{ borderBottom:'1px solid #1e273640' }}>
                        <td style={{ padding:'10px 16px', color:'#94a3b8', fontWeight:600, whiteSpace:'nowrap' }}>{label}</td>
                        {annualCategories.map(cat => {
                          const spent  = row.spent[cat] ?? 0;
                          const budget = annualBudgetMap[row.month]?.[cat] ?? 0;
                          const over   = budget > 0 && spent > budget;
                          return (
                            <td key={cat} style={{ textAlign:'right', padding:'10px 10px', whiteSpace:'nowrap' }}>
                              {spent > 0 ? (
                                <span style={{ color: over ? '#c2735a' : '#e2e8f0', fontWeight: over ? 700 : 400 }}>
                                  {fmt(spent)}
                                  {budget > 0 && <span style={{ color:'#64748b', fontSize:11, marginLeft:4 }}>/ {fmt(budget)}</span>}
                                </span>
                              ) : <span style={{ color:'#334155', fontSize:12 }}>-</span>}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )
          }
        </div>
      )}

      {showAdd && (
        <Modal title="Add Budget" onClose={()=>setShowAdd(false)}>
          <BudgetForm defaultMonth={month} onSave={b=>{onAdd(b);setShowAdd(false);}} onClose={()=>setShowAdd(false)} userCategories={userCategories} />
        </Modal>
      )}
      {editB && (
        <Modal title="Edit Budget" onClose={()=>setEditB(null)}>
          <BudgetForm initial={editB} defaultMonth={month} onSave={b=>{onEdit(b);setEditB(null);}} onClose={()=>setEditB(null)} userCategories={userCategories} />
        </Modal>
      )}
    </div>
  );
}
