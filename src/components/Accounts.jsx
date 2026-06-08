import { useRef, useState, useMemo } from 'react';
import { ACCOUNT_TYPES, acctColor, acctLabel, acctEmoji, isDebtType, fmt, uid, parseAmount, computeBalance, monthlyEquivalent, sanitizeText, safeNum, CHART } from '../constants.js';
import { useChart } from '../hooks/useChart.js';
import { useCurrency } from '../hooks/useCurrency.js';
import { usePrivacy } from '../context/PrivacyContext.jsx';
import Modal from './Modal.jsx';
import StatementImport from './StatementImport.jsx';
import RSUImportModal from './RSUImportModal.jsx';

// ─── Debt Payoff Calculator ──────────────────────────────────────────────────
function DebtPayoffPanel({ debts }) {
  const cfmt = useCurrency();
  const privacy = usePrivacy();
  const fmtK = v => privacy ? '••••' : '$' + (v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v);
  const canvasPayoff = useRef(null);
  const [extra,  setExtra]  = useState(200);
  const [method, setMethod] = useState('avalanche'); // 'avalanche' | 'snowball'

  // Build a debt list with estimated APR via per-account minimum payment heuristic.
  // User can override APR per card via inline inputs.
  const [aprs, setAprs] = useState(() =>
    Object.fromEntries(debts.map(d => [d.id, 20])) // default 20% APR
  );
  const [mins, setMins] = useState(() =>
    Object.fromEntries(debts.map(d => [d.id, Math.max(25, Math.round(d.balance * 0.02))])) // 2% or $25
  );

  const totalDebt = debts.reduce((s, d) => s + d.balance, 0);
  const totalMin  = debts.reduce((s, d) => s + (mins[d.id] ?? 25), 0);
  const budget    = totalMin + (parseFloat(extra) || 0);

  // Run the payoff simulation
  const simulation = useMemo(() => {
    if (!debts.length || budget <= 0) return { months: [], totalInterest: 0, order: [] };

    // Build mutable debt objects
    let accounts = debts.map(d => ({
      id: d.id,
      name: d.name,
      balance: d.balance,
      apr: (aprs[d.id] ?? 20) / 100,
      min: mins[d.id] ?? 25,
    })).filter(d => d.balance > 0);

    // Sort by method
    const sortAccounts = (arr) => {
      if (method === 'avalanche') return [...arr].sort((a, b) => b.apr - a.apr);
      return [...arr].sort((a, b) => a.balance - b.balance); // snowball: lowest balance first
    };

    const months = [];
    let totalInterest = 0;
    const MAX_MONTHS = 600; // 50 years hard stop

    for (let mo = 0; mo < MAX_MONTHS && accounts.length > 0; mo++) {
      const sorted = sortAccounts(accounts);
      let remaining = budget;

      // Apply interest first
      accounts = accounts.map(a => ({
        ...a,
        balance: a.balance * (1 + a.apr / 12),
      }));

      // Count interest added this month
      const interestThisMonth = accounts.reduce((s, a) => {
        const orig = debts.find(d => d.id === a.id)?.balance ?? 0;
        return s; // rough: track separately
      }, 0);

      // Apply minimums first
      accounts = accounts.map(a => {
        const pay = Math.min(a.min, a.balance);
        remaining -= pay;
        return { ...a, balance: Math.max(0, a.balance - pay) };
      }).filter(a => a.balance > 0);

      // Apply extra to the priority target
      const sortedForExtra = sortAccounts(accounts);
      for (let i = 0; i < sortedForExtra.length && remaining > 0.01; i++) {
        const target = sortedForExtra[i];
        const pay = Math.min(remaining, target.balance);
        remaining -= pay;
        const idx = accounts.findIndex(a => a.id === target.id);
        if (idx >= 0) {
          accounts[idx] = { ...accounts[idx], balance: Math.max(0, accounts[idx].balance - pay) };
          if (accounts[idx].balance < 0.01) accounts.splice(idx, 1);
        }
      }

      const snapshotTotal = accounts.reduce((s, a) => s + a.balance, 0);
      months.push({
        mo: mo + 1,
        label: (() => { const d = new Date(); d.setMonth(d.getMonth() + mo + 1); return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }); })(),
        remaining: snapshotTotal,
      });
    }

    const totalPaid = budget * months.length;
    const totalInterestCalc = Math.max(0, totalPaid - totalDebt);

    return { months, totalInterest: totalInterestCalc, payoffMonths: months.length };
  }, [debts, aprs, mins, extra, method, totalDebt, budget]);

  // Chart: remaining debt over time
  const chartData = useMemo(() => {
    const pts = [{ label: 'Now', remaining: totalDebt }, ...simulation.months];
    // Thin to max 60 points for readability
    if (pts.length <= 60) return pts;
    const step = Math.ceil(pts.length / 60);
    return pts.filter((_, i) => i % step === 0 || i === pts.length - 1);
  }, [simulation.months, totalDebt]);

  useChart(canvasPayoff, () => ({
    type: 'line',
    data: {
      labels: chartData.map(p => p.label),
      datasets: [{
        label: 'Total Debt Remaining',
        data: chartData.map(p => p.remaining),
        borderColor: CHART.expense,
        backgroundColor: CHART.expense + '22',
        tension: 0.3, fill: true,
        pointRadius: chartData.length > 30 ? 0 : 3,
        pointBackgroundColor: CHART.expense,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ` Remaining: ${cfmt(ctx.raw)}` } } },
      scales: {
        x: { grid: { color: CHART.gridLine }, ticks: { color: CHART.gridLabel, maxTicksLimit: 12 } },
        y: { grid: { color: CHART.gridLine }, ticks: { color: CHART.gridLabel, callback: fmtK }, min: 0 },
      },
    },
  }), [JSON.stringify(chartData), cfmt]);

  const yrs = Math.floor(simulation.payoffMonths / 12);
  const mos = simulation.payoffMonths % 12;
  const payoffStr = simulation.payoffMonths
    ? `${yrs > 0 ? `${yrs}yr ` : ''}${mos > 0 ? `${mos}mo` : ''}`.trim()
    : '—';

  return (
    <div style={{ background:'var(--bg-page)', border:'1px solid #7f1d1d44', borderRadius:12, padding:20, marginTop:8 }}>
      <div style={{ fontSize:14, fontWeight:700, color:'var(--text-primary)', marginBottom:4 }}>💳 Debt Payoff Planner</div>
      <div style={{ fontSize:12, color:'var(--text-secondary)', marginBottom:16 }}>
        How fast can you eliminate your {debts.length} debt{debts.length !== 1 ? 's' : ''}? Adjust the settings below.
      </div>

      {/* Controls */}
      <div style={{ display:'flex', gap:16, flexWrap:'wrap', marginBottom:16, alignItems:'flex-end' }}>
        <div>
          <label style={{ fontSize:11, color:'var(--text-secondary)', display:'block', marginBottom:4 }}>Extra monthly payment ($)</label>
          <input type="number" min="0" step="50" value={extra}
            onChange={e => setExtra(e.target.value)}
            style={{ width:120, padding:'6px 10px', background:'var(--bg-card)', border:'1px solid var(--border-default)', borderRadius:6, color:'var(--text-primary)', fontSize:13 }} />
        </div>
        <div>
          <label style={{ fontSize:11, color:'var(--text-secondary)', display:'block', marginBottom:4 }}>Method</label>
          <div style={{ display:'flex', gap:6 }}>
            <button className={`btn btn-sm ${method === 'avalanche' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setMethod('avalanche')}>
              🏔 Avalanche
            </button>
            <button className={`btn btn-sm ${method === 'snowball' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setMethod('snowball')}>
              ⛄ Snowball
            </button>
          </div>
        </div>
        <div style={{ fontSize:11, color:'var(--text-muted)', maxWidth:260, lineHeight:1.5 }}>
          <strong style={{ color:'var(--text-secondary)' }}>{method === 'avalanche' ? 'Avalanche' : 'Snowball'}:</strong>{' '}
          {method === 'avalanche'
            ? 'Pay highest APR first. Saves the most interest.'
            : 'Pay smallest balance first. Wins psychological momentum.'}
        </div>
      </div>

      {/* APR inputs per debt */}
      <div style={{ marginBottom:16 }}>
        <div style={{ fontSize:11, color:'var(--text-secondary)', marginBottom:8, fontWeight:600, textTransform:'uppercase', letterSpacing:'0.06em' }}>Interest rates & minimums</div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(240px,1fr))', gap:8 }}>
          {debts.map(d => (
            <div key={d.id} style={{ background:'var(--bg-card)', borderRadius:8, padding:'10px 12px', display:'flex', alignItems:'center', gap:10 }}>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:12, fontWeight:600, color:'var(--text-primary)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{d.name}</div>
                <div style={{ fontSize:11, color:'var(--red)' }}>{cfmt(d.balance)}</div>
              </div>
              <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
                <div style={{ display:'flex', alignItems:'center', gap:4 }}>
                  <span style={{ fontSize:10, color:'var(--text-secondary)', width:30 }}>APR%</span>
                  <input type="number" min="0" max="100" step="0.1" value={aprs[d.id] ?? 20}
                    onChange={e => setAprs(a => ({ ...a, [d.id]: parseFloat(e.target.value) || 0 }))}
                    style={{ width:56, padding:'2px 6px', background:'var(--bg-page)', border:'1px solid var(--border-default)', borderRadius:4, color:'var(--text-primary)', fontSize:11 }} />
                </div>
                <div style={{ display:'flex', alignItems:'center', gap:4 }}>
                  <span style={{ fontSize:10, color:'var(--text-secondary)', width:30 }}>Min $</span>
                  <input type="number" min="0" step="5" value={mins[d.id] ?? 25}
                    onChange={e => setMins(m => ({ ...m, [d.id]: parseFloat(e.target.value) || 0 }))}
                    style={{ width:56, padding:'2px 6px', background:'var(--bg-page)', border:'1px solid var(--border-default)', borderRadius:4, color:'var(--text-primary)', fontSize:11 }} />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Summary stats */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:12, marginBottom:16 }}>
        <div style={{ background:'var(--bg-card)', borderRadius:8, padding:'12px 14px' }}>
          <div style={{ fontSize:11, color:'var(--text-secondary)', marginBottom:4 }}>Monthly budget</div>
          <div style={{ fontSize:16, fontWeight:700, color:'var(--text-primary)' }}>{cfmt(budget)}</div>
          <div style={{ fontSize:10, color:'var(--text-muted)' }}>Minimums {cfmt(totalMin)} + extra {cfmt(parseFloat(extra)||0)}</div>
        </div>
        <div style={{ background:'var(--bg-card)', borderRadius:8, padding:'12px 14px' }}>
          <div style={{ fontSize:11, color:'var(--text-secondary)', marginBottom:4 }}>Payoff time</div>
          <div style={{ fontSize:16, fontWeight:700, color: simulation.payoffMonths > 60 ? 'var(--amber)' : 'var(--green)' }}>{payoffStr}</div>
          <div style={{ fontSize:10, color:'var(--text-muted)' }}>{simulation.payoffMonths} monthly payments</div>
        </div>
        <div style={{ background:'var(--bg-card)', borderRadius:8, padding:'12px 14px' }}>
          <div style={{ fontSize:11, color:'var(--text-secondary)', marginBottom:4 }}>Est. total interest</div>
          <div style={{ fontSize:16, fontWeight:700, color:'var(--red)' }}>{cfmt(simulation.totalInterest)}</div>
          <div style={{ fontSize:10, color:'var(--text-muted)' }}>On {cfmt(totalDebt)} of debt</div>
        </div>
      </div>

      {/* Payoff chart */}
      {simulation.months.length > 0 && (
        <div>
          <div style={{ fontSize:12, color:'var(--text-secondary)', marginBottom:8 }}>Debt balance over time</div>
          <div style={{ height:200 }}><canvas ref={canvasPayoff} /></div>
        </div>
      )}
    </div>
  );
}

function AccountForm({ initial, onSave, onClose }) {
  const [form, setForm] = useState(initial ?? { name:'', type:'checking', balance:'', isBusiness: false, unvestedRSUValue: 0 });
  const [showRSUModal, setShowRSUModal] = useState(false);
  const set = (k,v) => setForm(f=>({...f,[k]:v}));
  const save = () => {
    if (!form.name.trim() || form.balance === '') return;
    const bal = parseAmount(String(form.balance));
    if (isNaN(bal)) return;
    onSave({ ...form, id: form.id ?? uid(), balance: Math.abs(bal) });
  };
  return (
    <>
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
        <div style={{ fontSize:12,color:'var(--text-secondary)' }}>
          {isDebtType(form.type)?'⚠️ Debt accounts subtract from your net worth.':'✅ Asset accounts add to your net worth.'}
        </div>
        {form.type === 'investment' && (
          <div className="form-group">
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:4 }}>
              <label className="form-label" style={{ marginBottom:0 }}>Unvested RSU Value ($)</label>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ fontSize:11 }}
                onClick={() => setShowRSUModal(true)}
              >📄 Import from Statement</button>
            </div>
            <input
              type="number"
              min="0"
              step="0.01"
              placeholder="0.00"
              value={form.unvestedRSUValue || ''}
              onChange={e => set('unvestedRSUValue', e.target.value === '' ? 0 : +e.target.value)}
            />
            <div style={{ fontSize:11, color:'var(--text-secondary)', marginTop:4 }}>
              Enter the current market value of unvested RSU grants. This is excluded from your vested net worth on the dashboard.
            </div>
          </div>
        )}
        <label style={{ display:'flex', alignItems:'center', gap:10, cursor:'pointer', padding:'8px 10px', background:'var(--bg-page)', borderRadius:8, border:'1px solid var(--bg-raised)' }}>
          <input type="checkbox" checked={!!form.isBusiness} onChange={e=>set('isBusiness', e.target.checked)} style={{ accentColor:'var(--green)', width:15, height:15 }} />
          <div>
            <div style={{ fontSize:13, color:'var(--text-primary)', fontWeight:500 }}>🏢 Business account</div>
            <div style={{ fontSize:11, color:'var(--text-secondary)', marginTop:2 }}>Mark accounts used for business income and expenses.</div>
          </div>
        </label>
        <div style={{ display:'flex',gap:8,justifyContent:'flex-end' }}>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save}>Save Account</button>
        </div>
      </div>
      {showRSUModal && (
        <RSUImportModal
          onConfirm={({ unvestedRSUValue }) => { set('unvestedRSUValue', unvestedRSUValue); setShowRSUModal(false); }}
          onClose={() => setShowRSUModal(false)}
        />
      )}
    </>
  );
}


// ─── Holdings form (investment accounts) ─────────────────────────────────────
function HoldingsPanel({ account, onEdit }) {
  const cfmt = useCurrency();
  const holdings = account.holdings ?? [];
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ticker:'', shares:'', costBasis:'', currentPrice:'' });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const totalValue    = holdings.reduce((s, h) => s + safeNum(h.shares) * safeNum(h.currentPrice), 0);
  const totalCost     = holdings.reduce((s, h) => s + safeNum(h.shares) * safeNum(h.costBasis),   0);
  const totalGainLoss = totalValue - totalCost;

  const saveHolding = () => {
    if (!form.ticker.trim() || !form.shares) return;
    const holding = {
      id:           uid(),
      ticker:       sanitizeText(form.ticker.toUpperCase(), 10),
      shares:       safeNum(form.shares),
      costBasis:    safeNum(form.costBasis),
      currentPrice: safeNum(form.currentPrice),
    };
    onEdit({ ...account, holdings: [...holdings, holding] });
    setForm({ ticker:'', shares:'', costBasis:'', currentPrice:'' });
    setShowForm(false);
  };

  const removeHolding = (id) => onEdit({ ...account, holdings: holdings.filter(h => h.id !== id) });
  const updatePrice   = (id, price) =>
    onEdit({ ...account, holdings: holdings.map(h => h.id === id ? { ...h, currentPrice: safeNum(price) } : h) });

  return (
    <div style={{ background:'var(--bg-page)', border:'1px solid var(--bg-raised)', borderRadius:10, padding:14, marginTop:6 }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
        <div>
          <span style={{ fontWeight:600, fontSize:13, color:'var(--text-primary)' }}>📈 Holdings</span>
          {holdings.length > 0 && (
            <span style={{ marginLeft:10, fontSize:12, color: totalGainLoss >= 0 ? 'var(--green)' : 'var(--red)', fontWeight:600 }}>
              {totalGainLoss >= 0 ? '+' : ''}{cfmt(totalGainLoss)} ({totalCost > 0 ? ((totalGainLoss/totalCost)*100).toFixed(1) : '0'}%)
            </span>
          )}
        </div>
        <button className="btn btn-ghost btn-sm" style={{ fontSize:11 }} onClick={() => setShowForm(f => !f)}>
          {showForm ? '✕ Cancel' : '+ Add Holding'}
        </button>
      </div>

      {holdings.length === 0 && !showForm && (
        <div style={{ fontSize:12, color:'var(--text-muted)', textAlign:'center', padding:'12px 0' }}>
          No holdings yet. Add your first position above.
        </div>
      )}

      {holdings.length > 0 && (
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12, marginBottom:showForm ? 12 : 0 }}>
          <thead>
            <tr>
              {['Ticker','Shares','Cost/sh','Price/sh','Value','Gain/Loss',''].map(h => (
                <th key={h} style={{ textAlign: h===''?'center':'left', color:'var(--text-secondary)', fontWeight:600, paddingBottom:6, borderBottom:'1px solid var(--bg-raised)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {holdings.map(h => {
              const val = safeNum(h.shares) * safeNum(h.currentPrice);
              const gl  = val - safeNum(h.shares) * safeNum(h.costBasis);
              return (
                <tr key={h.id}>
                  <td style={{ padding:'6px 0', color:'var(--text-primary)', fontWeight:700 }}>{h.ticker}</td>
                  <td style={{ padding:'6px 0', color:'var(--text-secondary)' }}>{h.shares}</td>
                  <td style={{ padding:'6px 0', color:'var(--text-secondary)' }}>{cfmt(h.costBasis)}</td>
                  <td style={{ padding:'6px 0' }}>
                    <input
                      type="number" step="0.01" value={h.currentPrice}
                      onChange={e => updatePrice(h.id, e.target.value)}
                      style={{ width:72, padding:'2px 6px', background:'var(--bg-card)', border:'1px solid var(--border-default)', borderRadius:5, color:'var(--text-primary)', fontSize:12 }}
                    />
                  </td>
                  <td style={{ padding:'6px 0', color:'var(--text-primary)', fontWeight:600 }}>{cfmt(val)}</td>
                  <td style={{ padding:'6px 0', fontWeight:600, color: gl >= 0 ? 'var(--green)' : 'var(--red)' }}>
                    {gl >= 0 ? '+' : ''}{cfmt(gl)}
                  </td>
                  <td style={{ padding:'6px 0', textAlign:'center' }}>
                    <button className="btn btn-ghost btn-sm" style={{ color:'var(--red)', fontSize:11 }} onClick={() => removeHolding(h.id)}>🗑</button>
                  </td>
                </tr>
              );
            })}
            {holdings.length > 1 && (
              <tr style={{ borderTop:'1px solid var(--bg-raised)' }}>
                <td colSpan={4} style={{ padding:'6px 0', color:'var(--text-secondary)', fontSize:11 }}>Total</td>
                <td style={{ padding:'6px 0', fontWeight:700, color:'var(--text-primary)' }}>{cfmt(totalValue)}</td>
                <td style={{ padding:'6px 0', fontWeight:700, color: totalGainLoss >= 0 ? 'var(--green)' : 'var(--red)' }}>
                  {totalGainLoss >= 0 ? '+' : ''}{cfmt(totalGainLoss)}
                </td>
                <td />
              </tr>
            )}
          </tbody>
        </table>
      )}

      {showForm && (
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap:8, marginTop:8 }}>
          <div>
            <label style={{ fontSize:11, color:'var(--text-secondary)' }}>Ticker</label>
            <input placeholder="AAPL" value={form.ticker} onChange={e => set('ticker', e.target.value)}
              style={{ width:'100%', boxSizing:'border-box', padding:'5px 8px', background:'var(--bg-card)', border:'1px solid var(--border-default)', borderRadius:6, color:'var(--text-primary)', fontSize:12 }} />
          </div>
          <div>
            <label style={{ fontSize:11, color:'var(--text-secondary)' }}>Shares</label>
            <input type="number" step="0.001" placeholder="10" value={form.shares} onChange={e => set('shares', e.target.value)}
              style={{ width:'100%', boxSizing:'border-box', padding:'5px 8px', background:'var(--bg-card)', border:'1px solid var(--border-default)', borderRadius:6, color:'var(--text-primary)', fontSize:12 }} />
          </div>
          <div>
            <label style={{ fontSize:11, color:'var(--text-secondary)' }}>Cost / share ($)</label>
            <input type="number" step="0.01" placeholder="150.00" value={form.costBasis} onChange={e => set('costBasis', e.target.value)}
              style={{ width:'100%', boxSizing:'border-box', padding:'5px 8px', background:'var(--bg-card)', border:'1px solid var(--border-default)', borderRadius:6, color:'var(--text-primary)', fontSize:12 }} />
          </div>
          <div>
            <label style={{ fontSize:11, color:'var(--text-secondary)' }}>Current price ($)</label>
            <input type="number" step="0.01" placeholder="175.00" value={form.currentPrice} onChange={e => set('currentPrice', e.target.value)}
              style={{ width:'100%', boxSizing:'border-box', padding:'5px 8px', background:'var(--bg-card)', border:'1px solid var(--border-default)', borderRadius:6, color:'var(--text-primary)', fontSize:12 }} />
          </div>
          <div style={{ gridColumn:'1/-1', display:'flex', justifyContent:'flex-end', gap:8, marginTop:4 }}>
            <button className="btn btn-secondary btn-sm" onClick={() => setShowForm(false)}>Cancel</button>
            <button className="btn btn-primary btn-sm" onClick={saveHolding}>Add Holding</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Accounts({ accounts, transactions, netWorthHistory, recurrences, onAdd, onEdit, onDelete, onToggleCleared, onReconcile, onUpdateStatementDate, onImportStatement }) {
  const cfmt = useCurrency();
  const privacy = usePrivacy();
  const fmtK = v => privacy ? '••••' : '$' + (Math.abs(v) >= 1000 ? (v / 1000).toFixed(1) + 'k' : v);
  const canvasNW       = useRef(null);
  const canvasForecast = useRef(null);
  const [showAdd,         setShowAdd]         = useState(false);
  const [editA,           setEditA]           = useState(null);
  const [reconcileAcct,   setReconcileAcct]   = useState(null);
  const [stmtBalance,     setStmtBalance]     = useState('');
  const [clearedIds,      setClearedIds]      = useState(new Set());
  const [reconcileAllMode,setReconcileAllMode]= useState(false);
  const [stmtDate,        setStmtDate]        = useState('');
  const [importAcct,      setImportAcct]      = useState(null); // account being imported into
  const [expandedHoldings,setExpandedHoldings]= useState(new Set()); // investment account ids with holdings open
  const [showPayoff,      setShowPayoff]      = useState(false);

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
        borderColor: netWorth>=0?CHART.income:CHART.expense,
        backgroundColor: netWorth>=0?CHART.income+'22':CHART.expense+'22',
        tension: 0.4, fill: true, pointRadius: historyData.length<20?4:2,
        pointBackgroundColor: netWorth>=0?CHART.income:CHART.expense,
      }],
    },
    options: {
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{display:false}, tooltip:{callbacks:{label:(ctx)=>` Net Worth: ${cfmt(ctx.raw)}`}} },
      scales:{
        x:{ grid:{color:CHART.gridLine}, ticks:{color:CHART.gridLabel,maxTicksLimit:10} },
        y:{ grid:{color:CHART.gridLine}, ticks:{color:CHART.gridLabel,callback:fmtK} },
      },
    },
  }), [JSON.stringify(historyData), cfmt]);

  useChart(canvasForecast, () => ({
    type: 'line',
    data: {
      labels: forecastData.map(d=>d.label),
      datasets: [{
        label: '12-Month Forecast',
        data: forecastData.map(d=>d.value),
        borderColor: monthlyNetFlow >= 0 ? CHART.income : CHART.expense,
        backgroundColor: monthlyNetFlow >= 0 ? CHART.income+'22' : CHART.expense+'22',
        tension: 0.3, fill: true, pointRadius: 3,
        borderDash: [0],
        pointBackgroundColor: monthlyNetFlow >= 0 ? CHART.income : CHART.expense,
      }],
    },
    options: {
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{display:false}, tooltip:{callbacks:{label:(ctx)=>` Forecast: ${cfmt(ctx.raw)}`}} },
      scales:{
        x:{ grid:{color:CHART.gridLine}, ticks:{color:CHART.gridLabel} },
        y:{ grid:{color:CHART.gridLine}, ticks:{color:CHART.gridLabel,callback:fmtK} },
      },
    },
  }), [JSON.stringify(forecastData), cfmt]);

  return (
    <div className="fade-in" style={{ padding:'24px 28px' }}>
      <div className="section-header">
        <div><div className="section-title">Accounts & Net Worth</div><div className="section-sub">Track assets and liabilities</div></div>
        <div style={{ display:'flex', gap:8 }}>
          {debts.length > 0 && (
            <button className="btn btn-secondary" onClick={()=>setShowPayoff(p=>!p)}>
              {showPayoff ? '✕ Hide Planner' : '💳 Payoff Planner'}
            </button>
          )}
          <button className="btn btn-secondary" onClick={()=>setReconcileAllMode(m=>!m)}>
            {reconcileAllMode ? '✕ Exit Reconcile All' : '🔍 Reconcile All'}
          </button>
          <button className="btn btn-primary" onClick={()=>setShowAdd(true)}>+ Add Account</button>
        </div>
      </div>

      <div style={{ display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:14,marginBottom:24 }}>
        <div className="stat-card" style={{ borderColor:netWorth>=0?'#14532d44':'#7f1d1d44' }}>
          <div style={{ fontSize:12,color:'var(--text-secondary)',fontWeight:600,textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:6 }}>Net Worth</div>
          <div className="hero-num" style={{ fontSize:28,fontWeight:400,color:netWorth>=0?'var(--green)':'var(--red)' }}>{cfmt(netWorth)}</div>
          <div style={{ fontSize:12,color:'var(--text-muted)',marginTop:4 }}>Assets minus debts</div>
        </div>
        <div className="stat-card">
          <div style={{ fontSize:12,color:'var(--text-secondary)',fontWeight:600,textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:6 }}>Total Assets</div>
          <div className="hero-num" style={{ fontSize:28,fontWeight:400,color:'var(--green)' }}>{cfmt(totAssets)}</div>
          <div style={{ fontSize:12,color:'var(--text-muted)',marginTop:4 }}>{assets.length} accounts</div>
        </div>
        <div className="stat-card">
          <div style={{ fontSize:12,color:'var(--text-secondary)',fontWeight:600,textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:6 }}>Total Debts</div>
          <div className="hero-num" style={{ fontSize:28,fontWeight:400,color:'var(--red)' }}>{cfmt(totDebts)}</div>
          <div style={{ fontSize:12,color:'var(--text-muted)',marginTop:4 }}>{debts.length} accounts</div>
        </div>
      </div>

      {historyData.length >= 2 && (
        <div className="card" style={{ marginBottom:24 }}>
          <div style={{ fontWeight:600,fontSize:14,marginBottom:4 }}>Net Worth Over Time</div>
          <div style={{ fontSize:12,color:'var(--text-secondary)',marginBottom:16 }}>{historyData.length} daily snapshots (auto-tracked)</div>
          <div className="chart-container" style={{ height:200 }}><canvas ref={canvasNW} /></div>
        </div>
      )}
      {historyData.length < 2 && accounts.length > 0 && (
        <div className="card" style={{ marginBottom:24, textAlign:'center', padding:'24px', color:'var(--text-muted)' }}>
          <div style={{ fontSize:24, marginBottom:8 }}>📈</div>
          <p style={{ fontSize:14 }}>Net worth history will appear here as you use the app over time.</p>
          <p style={{ fontSize:12, marginTop:6 }}>Snapshots are captured automatically each day.</p>
        </div>
      )}

      {/* Net Worth Forecast */}
      {activeRecs.length > 0 && (
        <div className="card" style={{ marginBottom:24 }}>
          <div style={{ fontWeight:600,fontSize:14,marginBottom:4 }}>📈 12-Month Net Worth Forecast</div>
          <div style={{ fontSize:12,color:'var(--text-secondary)',marginBottom:4 }}>
            Based on {activeRecs.length} active recurring rule{activeRecs.length!==1?'s':''} ·
            Estimated monthly net flow: <span style={{ color: monthlyNetFlow>=0?'var(--green)':'var(--red)',fontWeight:600 }}>{monthlyNetFlow>=0?'+':''}{cfmt(monthlyNetFlow)}/mo</span>
          </div>
          <div style={{ fontSize:12,color:'var(--text-muted)',marginBottom:12 }}>
            Projected 12 months from now: <strong style={{ color: forecastData[12]?.value >= netWorth?'var(--green)':'var(--red)' }}>{cfmt(forecastData[12]?.value ?? netWorth)}</strong>
          </div>
          <div className="chart-container" style={{ height:180 }}><canvas ref={canvasForecast} /></div>
        </div>
      )}

      {reconcileAllMode && (
        <div style={{ marginBottom:24 }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:16 }}>
            <div style={{ fontWeight:700, fontSize:15, color:'var(--text-primary)' }}>🔍 Reconcile All Accounts</div>
            <button className="btn btn-primary btn-sm" onClick={()=>setReconcileAllMode(false)}>Done</button>
          </div>
          {accounts.map(acct => {
            const acctTxs = transactions.filter(t => t.account === acct.id && !t.cleared);
            const computed = transactions.filter(t => t.account === acct.id && t.type !== 'adjustment').reduce((s,t) => s+t.amount, 0);
            const discrepancy = Math.abs(acct.balance - computed);
            const hasDiscrepancy = discrepancy > 0.01;
            return (
              <div key={acct.id} style={{ marginBottom:10, border:`1px solid ${hasDiscrepancy ? '#f59e0b44' : '#14532d44'}`, borderRadius:10, overflow:'hidden' }}>
                <div style={{ display:'flex', alignItems:'center', gap:12, padding:'10px 14px', background: hasDiscrepancy ? '#1a1600' : '#0a1a0a' }}>
                  <div style={{ fontSize:18 }}>{acctEmoji(acct.type)}</div>
                  <div style={{ flex:1 }}>
                    <span style={{ fontWeight:600, fontSize:14, color:'var(--text-primary)' }}>{acct.name}</span>
                    <span style={{ fontSize:12, color:'var(--text-secondary)', marginLeft:8 }}>{acctLabel(acct.type)}</span>
                  </div>
                  <div style={{ textAlign:'right', fontSize:12, color:'var(--text-secondary)' }}>
                    <div>Stored: <strong style={{ color:'var(--text-primary)' }}>{cfmt(acct.balance)}</strong></div>
                    <div>Computed: <strong style={{ color:'var(--text-primary)' }}>{cfmt(computed)}</strong></div>
                    {hasDiscrepancy
                      ? <div style={{ color:'var(--amber)', fontWeight:600 }}>⚠ Discrepancy: {cfmt(discrepancy)}</div>
                      : <div style={{ color:'var(--green)', fontWeight:600 }}>✅ Balanced</div>
                    }
                  </div>
                </div>
                {hasDiscrepancy && acctTxs.length > 0 && (
                  <div style={{ padding:'10px 14px', background:'var(--bg-card)', borderTop:'1px solid var(--border-default)' }}>
                    <div style={{ fontSize:12, color:'var(--text-secondary)', marginBottom:6 }}>Uncleared transactions:</div>
                    {acctTxs.sort((a,b)=>b.date.localeCompare(a.date)).map(t => (
                      <div key={t.id} style={{ display:'flex', alignItems:'center', gap:8, padding:'5px 0', borderBottom:'1px solid #1e273640' }}>
                        <input type="checkbox" checked={t.cleared} onChange={()=>{ if(onToggleCleared) onToggleCleared(t.id); }} />
                        <span style={{ fontSize:12, color:'var(--text-secondary)', width:80, flexShrink:0 }}>{t.date}</span>
                        <span style={{ fontSize:12, color:'var(--text-primary)', flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{t.description}</span>
                        <span style={{ fontSize:12, fontWeight:600, color:t.amount>=0?'var(--green)':'var(--red)', flexShrink:0 }}>{t.amount>=0?'+':''}{cfmt(t.amount)}</span>
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
        : <div style={{ display:'flex', flexDirection:'column', gap:24 }}>

            {/* ── Assets ── */}
            <div>
              <div style={{ fontSize:12,fontWeight:700,color:'var(--green)',textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:12 }}>Assets ({assets.length})</div>
              {assets.length === 0
                ? <div className="card-sm" style={{ color:'var(--text-muted)',fontSize:14,textAlign:'center' }}>No asset accounts</div>
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
                                <div style={{ fontSize:11,color:daysAgo>45?'var(--amber)':'var(--text-secondary)',marginTop:3 }}>
                                  Last reconciled: {a.lastStatementDate}{daysAgo>45?' ⚠':''}
                                </div>
                              );
                            })()}
                            {oldUncleared.length > 0 && (
                              <div style={{ fontSize:11,color:'var(--amber)',marginTop:3 }}>
                                ⚠ {oldUncleared.length} uncleared transaction{oldUncleared.length!==1?'s':''} &gt;30 days
                              </div>
                            )}
                          </div>
                          <div style={{ textAlign:'right', marginRight:8 }}>
                            <div style={{ fontSize:17,fontWeight:700,color:'var(--text-primary)' }}>{cfmt(a.balance)}</div>
                            {(() => {
                              const computed = computeBalance(a.id, transactions, a.type);
                              if (computed === null) return null;
                              const diff = Math.abs(computed - a.balance);
                              if (diff < 0.01) return null;
                              return (
                                <div title="Transaction history total differs from stored balance. Consider reconciling." style={{ fontSize:11, color:'var(--amber)', marginTop:3, cursor:'help' }}>
                                  ⚠ tx total: {cfmt(computed)}
                                </div>
                              );
                            })()}
                          </div>
                          <button className="btn btn-ghost btn-sm" title="Import statement" onClick={()=>setImportAcct(a)}>📥</button>
                          <button className="btn btn-ghost btn-sm" title="Reconcile" onClick={()=>isReconciling?closeReconcile():openReconcile(a.id)}>⚖️</button>
                          {a.type === 'investment' && (
                            <button className="btn btn-ghost btn-sm" title="Holdings" onClick={()=>setExpandedHoldings(s=>{const n=new Set(s);n.has(a.id)?n.delete(a.id):n.add(a.id);return n;})}>
                              {expandedHoldings.has(a.id) ? '▲' : '📊'}
                            </button>
                          )}
                          <button className="btn btn-ghost btn-sm" onClick={()=>setEditA({...a,balance:String(a.balance)})}>✏️</button>
                          <button className="btn btn-ghost btn-sm" style={{ color:'var(--red)' }}
                            onClick={()=>{ if(confirm('Remove this account?')) onDelete(a.id); }}>🗑</button>
                        </div>
                        {a.type === 'investment' && expandedHoldings.has(a.id) && (
                          <HoldingsPanel account={a} onEdit={onEdit} />
                        )}
                        {isReconciling && (
                          <div style={{ background:'var(--bg-card)',border:'1px solid var(--border-default)',borderRadius:10,padding:14,marginTop:4 }}>
                            <div style={{ fontWeight:600,fontSize:13,marginBottom:10,color:'var(--text-primary)' }}>Reconcile: {a.name}</div>
                            <div style={{ display:'flex',alignItems:'center',gap:10,marginBottom:8,flexWrap:'wrap' }}>
                              <label style={{ fontSize:12,color:'var(--text-secondary)' }}>Statement Balance ($)</label>
                              <input type="number" step="0.01" value={stmtBalance} onChange={e=>setStmtBalance(e.target.value)}
                                style={{ width:120,padding:'4px 8px',background:'var(--bg-page)',border:'1px solid var(--border-default)',borderRadius:6,color:'var(--text-primary)',fontSize:13 }} />
                              <label style={{ fontSize:12,color:'var(--text-secondary)',marginLeft:8 }}>Statement End Date</label>
                              <input type="date" value={stmtDate} onChange={e=>setStmtDate(e.target.value)}
                                style={{ padding:'4px 8px',background:'var(--bg-page)',border:'1px solid var(--border-default)',borderRadius:6,color:'var(--text-primary)',fontSize:13 }} />
                            </div>
                            <div style={{ maxHeight:220,overflowY:'auto',marginBottom:10 }}>
                              {acctTxs.length === 0
                                ? <div style={{ fontSize:12,color:'var(--text-muted)',padding:'8px 0' }}>No transactions for this account.</div>
                                : acctTxs.map(t => (
                                    <div key={t.id} style={{ display:'flex',alignItems:'center',gap:8,padding:'5px 0',borderBottom:'1px solid #1e273640' }}>
                                      <input type="checkbox" checked={clearedIds.has(t.id)} onChange={()=>toggleClearedLocal(t.id)} />
                                      <span style={{ fontSize:12,color:'var(--text-secondary)',width:80,flexShrink:0 }}>{t.date}</span>
                                      <span style={{ fontSize:12,color:'var(--text-primary)',flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>{t.description}</span>
                                      <span style={{ fontSize:12,fontWeight:600,color:t.amount>=0?'var(--green)':'var(--red)',flexShrink:0 }}>{t.amount>=0?'+':''}{cfmt(t.amount)}</span>
                                    </div>
                                  ))
                              }
                            </div>
                            <div style={{ fontSize:12,color:'var(--text-secondary)',marginBottom:8,display:'flex',gap:20 }}>
                              <span>Cleared sum: <strong style={{ color:'var(--text-primary)' }}>{cfmt(clearedSum)}</strong></span>
                              {stmtBalance !== '' && (
                                <span>Discrepancy: <strong style={{ color:Math.abs(discrepancy)<0.01?'var(--green)':'var(--amber)' }}>{cfmt(discrepancy)}</strong></span>
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

            {/* \u2500\u2500 Debts \u2500\u2500 */}
            {debts.length > 0 && (
              <div>
                <div style={{ fontSize:12,fontWeight:700,color:'var(--red)',textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:12 }}>Debts ({debts.length})</div>
                {debts.map(a => {
                  const acctTxs = transactions.filter(t => t.account === a.id).sort((x,y) => y.date.localeCompare(x.date));
                  const oldUncleared = acctTxs.filter(t => !t.cleared && (new Date() - new Date(t.date + 'T00:00:00')) > 30*24*60*60*1000);
                  const isReconciling = reconcileAcct === a.id;
                  const stmtVal = parseFloat(stmtBalance) || 0;
                  const clearedSum = acctTxs.filter(t => clearedIds.has(t.id)).reduce((s,t) => s + t.amount, 0);
                  const discrepancy = stmtVal - clearedSum;
                  return (
                    <div key={a.id} style={{ marginBottom:8 }}>
                      <div className="card-sm" style={{ display:'flex',alignItems:'center',gap:12, borderColor:'#7f1d1d44' }}>
                        <div style={{ width:40,height:40,borderRadius:10,background:acctColor(a.type)+'22',display:'flex',alignItems:'center',justifyContent:'center',fontSize:18,flexShrink:0 }}>
                          {acctEmoji(a.type)}
                        </div>
                        <div style={{ flex:1 }}>
                          <div style={{ fontWeight:600,fontSize:14 }}>{a.name}</div>
                          <div style={{ fontSize:12,color:acctColor(a.type),marginTop:2 }}>{acctLabel(a.type)}</div>
                          {a.lastStatementDate && (() => {
                            const daysAgo = Math.floor((new Date() - new Date(a.lastStatementDate+'T00:00:00')) / (24*60*60*1000));
                            return (
                              <div style={{ fontSize:11,color:daysAgo>45?'var(--amber)':'var(--text-secondary)',marginTop:3 }}>
                                Last reconciled: {a.lastStatementDate}{daysAgo>45?' \u26a0':''}
                              </div>
                            );
                          })()}
                          {oldUncleared.length > 0 && (
                            <div style={{ fontSize:11,color:'var(--amber)',marginTop:3 }}>
                              ⚠ {oldUncleared.length} uncleared transaction{oldUncleared.length!==1?'s':''} &gt;30 days
                            </div>
                          )}
                        </div>
                        <div style={{ textAlign:'right', marginRight:8 }}>
                          <div style={{ fontSize:17,fontWeight:700,color:'var(--red)' }}>{cfmt(a.balance)}</div>
                          {(() => {
                            if (a.lastPlaidSync) {
                              const d = new Date(a.lastPlaidSync);
                              const today = new Date(); today.setHours(0,0,0,0);
                              const syncDay = new Date(d); syncDay.setHours(0,0,0,0);
                              const diffDays = Math.round((today - syncDay) / 86400000);
                              const label = diffDays === 0 ? 'today' : diffDays === 1 ? 'yesterday'
                                : d.toLocaleDateString('en-US', { month:'short', day:'numeric' });
                              return (
                                <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:3 }}>
                                  Balance from bank · synced {label}
                                </div>
                              );
                            }
                            const computed = computeBalance(a.id, transactions, a.type);
                            if (computed === null) return null;
                            const diff = Math.abs(computed - a.balance);
                            if (diff < 0.01) return null;
                            return (
                              <div title="Transaction history total differs from stored balance. Consider reconciling." style={{ fontSize:11, color:'var(--amber)', marginTop:3, cursor:'help' }}>
                                ⚠ tx total: {cfmt(computed)}
                              </div>
                            );
                          })()}
                        </div>
                        <button className="btn btn-ghost btn-sm" title="Import statement" onClick={()=>setImportAcct(a)}>📥</button>
                        <button className="btn btn-ghost btn-sm" title="Reconcile" onClick={()=>isReconciling?closeReconcile():openReconcile(a.id)}>⚖️</button>
                        <button className="btn btn-ghost btn-sm" onClick={()=>setEditA({...a,balance:String(a.balance)})}>✏️</button>
                        <button className="btn btn-ghost btn-sm" style={{ color:'var(--red)' }}
                          onClick={()=>{ if(confirm('Remove this account?')) onDelete(a.id); }}>🗑</button>
                      </div>
                      {isReconciling && (
                        <div style={{ background:'var(--bg-card)',border:'1px solid var(--border-default)',borderRadius:10,padding:14,marginTop:4 }}>
                          <div style={{ fontWeight:600,fontSize:13,marginBottom:10,color:'var(--text-primary)' }}>Reconcile: {a.name}</div>
                          <div style={{ display:'flex',alignItems:'center',gap:10,marginBottom:8,flexWrap:'wrap' }}>
                            <label style={{ fontSize:12,color:'var(--text-secondary)' }}>Statement Balance ($)</label>
                            <input type="number" step="0.01" value={stmtBalance} onChange={e=>setStmtBalance(e.target.value)}
                              style={{ width:120,padding:'4px 8px',background:'var(--bg-page)',border:'1px solid var(--border-default)',borderRadius:6,color:'var(--text-primary)',fontSize:13 }} />
                            <label style={{ fontSize:12,color:'var(--text-secondary)',marginLeft:8 }}>Statement End Date</label>
                            <input type="date" value={stmtDate} onChange={e=>setStmtDate(e.target.value)}
                              style={{ padding:'4px 8px',background:'var(--bg-page)',border:'1px solid var(--border-default)',borderRadius:6,color:'var(--text-primary)',fontSize:13 }} />
                          </div>
                          <div style={{ maxHeight:220,overflowY:'auto',marginBottom:10 }}>
                            {acctTxs.length === 0
                              ? <div style={{ fontSize:12,color:'var(--text-muted)',padding:'8px 0' }}>No transactions for this account.</div>
                              : acctTxs.map(t => (
                                  <div key={t.id} style={{ display:'flex',alignItems:'center',gap:8,padding:'5px 0',borderBottom:'1px solid #1e273640' }}>
                                    <input type="checkbox" checked={clearedIds.has(t.id)} onChange={()=>toggleClearedLocal(t.id)} />
                                    <span style={{ fontSize:12,color:'var(--text-secondary)',width:80,flexShrink:0 }}>{t.date}</span>
                                    <span style={{ fontSize:12,color:'var(--text-primary)',flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>{t.description}</span>
                                    <span style={{ fontSize:12,fontWeight:600,color:t.amount>=0?'var(--green)':'var(--red)',flexShrink:0 }}>{t.amount>=0?'+':''}{cfmt(t.amount)}</span>
                                  </div>
                                ))
                            }
                          </div>
                          <div style={{ fontSize:12,color:'var(--text-secondary)',marginBottom:8,display:'flex',gap:20 }}>
                            <span>Cleared sum: <strong style={{ color:'var(--text-primary)' }}>{cfmt(clearedSum)}</strong></span>
                            {stmtBalance !== '' && (
                              <span>Discrepancy: <strong style={{ color:Math.abs(discrepancy)<0.01?'var(--green)':'var(--amber)' }}>{cfmt(discrepancy)}</strong></span>
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
                })}
              </div>
            )}

            {/* \u2500\u2500 Debt Payoff Planner \u2500\u2500 */}
            {showPayoff && debts.length > 0 && (
              <DebtPayoffPanel debts={debts} />
            )}

          </div>
      }

      {showAdd && <Modal title="Add Account" onClose={()=>setShowAdd(false)}><AccountForm onSave={a=>{onAdd(a);setShowAdd(false);}} onClose={()=>setShowAdd(false)} /></Modal>}
      {editA   && <Modal title="Edit Account" onClose={()=>setEditA(null)}><AccountForm initial={editA} onSave={a=>{onEdit(a);setEditA(null);}} onClose={()=>setEditA(null)} /></Modal>}
      {importAcct && (
        <Modal title={`Import Statement \u2014 ${importAcct.name}`} onClose={()=>setImportAcct(null)}>
          <StatementImport
            account={importAcct}
            existingTransactions={transactions}
            onImport={rows=>{ onImportStatement(rows); setImportAcct(null); }}
            onClose={()=>setImportAcct(null)}
          />
        </Modal>
      )}
    </div>
  );
}
