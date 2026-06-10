import { useState, useMemo, useRef, Fragment } from 'react';
import { fmt, fmtDate, today, uid, CHART, computeVestEvents } from '../constants.js';
import Modal from './Modal.jsx';
import { useMarketData, isCryptoTicker } from '../hooks/useMarketData.js';
import { useChart } from '../hooks/useChart.js';
import { useCurrency } from '../hooks/useCurrency.js';
import { usePrivacy } from '../context/PrivacyContext.jsx';

// --- Holdings Ledger ---------------------------------------------------------
function HoldingsLedger({ grants, editingPrice, priceInput, onPriceClick, onPriceChange, onPriceCommit }) {
  const cfmt = useCurrency();
  const totalPortfolioValue = grants.reduce((s, g) => {
    const vested = computeGrantVestedShares(g);
    const price  = g.currentPrice || g.grantPrice || 0;
    return s + vested * price;
  }, 0);

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            {['Name', 'Shares (Vested / Total)', 'Price', 'Current Value', 'Status'].map(h => (
              <th key={h} style={{
                textAlign: (h === 'Price' || h === 'Current Value') ? 'right' : 'left',
                color: 'var(--text-secondary)', fontWeight: 600, fontSize: 11, textTransform: 'uppercase',
                letterSpacing: '0.05em', padding: '6px 10px', borderBottom: '1px solid var(--bg-raised)',
              }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grants.map(g => {
            const vested    = computeGrantVestedShares(g);
            const price     = g.currentPrice || g.grantPrice || 0;
            const value     = vested * price;
            const basis     = vested * (g.grantPrice || 0);
            const gain      = g.grantPrice ? value - basis : value;
            const gainPos   = gain >= 0;
            const isEditing = editingPrice === g.id;

            return (
              <tr key={g.id} style={{ borderBottom: '1px solid var(--bg-raised)' }}>
                <td style={{ padding: '8px 10px', color: 'var(--text-primary)', fontWeight: 600 }}>
                  {g.name}
                  {g.ticker && (
                    <span style={{ marginLeft: 6, fontSize: 11, background: 'var(--bg-raised)', color: 'var(--accent-2)',
                      padding: '1px 6px', borderRadius: 20, fontWeight: 600 }}>{g.ticker}</span>
                  )}
                </td>
                <td style={{ padding: '8px 10px', color: 'var(--text-secondary)' }}>
                  <span style={{ color: 'var(--green)', fontWeight: 700 }}>
                    {vested.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </span>
                  <span style={{ color: 'var(--text-muted)' }}> / {(g.totalShares || 0).toLocaleString()}</span>
                </td>
                <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                  {isEditing ? (
                    <input
                      type="number" min="0" step="0.01"
                      value={priceInput}
                      onChange={e => onPriceChange(e.target.value)}
                      onBlur={() => onPriceCommit(g.id)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') onPriceCommit(g.id);
                        if (e.key === 'Escape') onPriceCommit(null);
                      }}
                      autoFocus
                      style={{ width: 80, textAlign: 'right', fontSize: 13, padding: '2px 6px',
                        background: 'var(--bg-raised)', border: '1px solid var(--accent-2)', borderRadius: 4, color: 'var(--text-primary)' }}
                    />
                  ) : (
                    <span
                      title="Click to edit price"
                      onClick={() => onPriceClick(g.id, price)}
                      style={{ cursor: 'pointer', color: 'var(--text-primary)', borderBottom: '1px dashed var(--text-muted)', paddingBottom: 1 }}>
                      {cfmt(price)}
                    </span>
                  )}
                </td>
                <td style={{ padding: '8px 10px', textAlign: 'right', color: 'var(--green)', fontWeight: 700 }}>
                  {cfmt(value)}
                  {g.grantPrice > 0 && (
                    <div style={{ fontSize: 11, color: gainPos ? 'var(--green)' : 'var(--red)', fontWeight: 400, marginTop: 2 }}>
                      {gainPos ? '+' : ''}{cfmt(gain)} gain
                    </div>
                  )}
                </td>
                <td style={{ padding: '8px 10px' }}>
                  {vested >= (g.totalShares || 0)
                    ? <span style={{ color: 'var(--green)', fontWeight: 600, fontSize: 12 }}>Fully Vested</span>
                    : vested > 0
                      ? <span style={{ color: 'var(--amber)', fontSize: 12 }}>Vesting</span>
                      : <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>Pending</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
        {grants.length > 0 && (
          <tfoot>
            <tr style={{ borderTop: '2px solid var(--text-muted)' }}>
              <td colSpan={3} style={{ padding: '10px 10px', color: 'var(--text-secondary)', fontWeight: 600, fontSize: 13 }}>
                Portfolio Total
              </td>
              <td style={{ padding: '10px 10px', textAlign: 'right' }}>
                <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--green)' }}>{cfmt(totalPortfolioValue)}</span>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>vested shares at current price</div>
              </td>
              <td />
            </tr>
          </tfoot>
        )}
      </table>
      {grants.length === 0 && (
        <div className="empty-state" style={{ padding: 32 }}>
          <div className="empty-icon">{'>'}</div>
          <p>No grants to display</p>
        </div>
      )}
    </div>
  );
}

// Helper: compute total vested shares for a grant
function computeGrantVestedShares(grant) {
  const events = computeVestEvents(grant);
  return events.filter(e => e.vested).reduce((s, e) => s + e.shares, 0);
}

// --- Vest Account Selector Modal ---------------------------------------------
function VestAccountModal({ vestLabel, vestValue, investmentAccounts, onConfirm, onSkip, onClose }) {
  const cfmt = useCurrency();
  const [selectedId, setSelectedId] = useState(investmentAccounts[0]?.id ?? '');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
        Recording <strong style={{ color: 'var(--text-primary)' }}>{vestLabel}</strong> worth{' '}
        <strong style={{ color: 'var(--green)' }}>{cfmt(vestValue)}</strong>
      </div>
      <div className="form-group">
        <label className="form-label">Credit to investment account</label>
        <select value={selectedId} onChange={e => setSelectedId(e.target.value)}>
          {investmentAccounts.map(a => (
            <option key={a.id} value={a.id}>{a.name} ({cfmt(a.balance)})</option>
          ))}
        </select>
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="btn btn-secondary" onClick={onSkip}>Skip account update</button>
        <button className="btn btn-primary" onClick={() => onConfirm(selectedId)}>Confirm</button>
      </div>
    </div>
  );
}


// --- Grant Form --------------------------------------------------------------
function GrantForm({ initial, onSave, onClose }) {
  const [form, setForm] = useState(initial ?? {
    name: '', ticker: '', grantDate: today(),
    totalShares: '', grantPrice: '', cliffMonths: 12,
    vestingMonths: 48, vestFrequency: 'monthly',
    currentPrice: '', notes: '',
  });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = () => {
    if (!form.name.trim() || !form.totalShares || !form.grantDate) return;
    onSave({
      ...form,
      id:            form.id ?? uid(),
      totalShares:   parseFloat(form.totalShares)   || 0,
      grantPrice:    parseFloat(form.grantPrice)    || 0,
      currentPrice:  parseFloat(form.currentPrice)  || parseFloat(form.grantPrice) || 0,
      cliffMonths:   parseInt(form.cliffMonths)     || 12,
      vestingMonths: parseInt(form.vestingMonths)   || 48,
    });
  };

  return (
    <div className="form-grid" style={{ gap: 14 }}>
      <div className="form-grid form-grid-2">
        <div className="form-group">
          <label className="form-label">Grant Name / Description</label>
          <input type="text" placeholder="e.g. ACME Corp RSU Grant" value={form.name}
            onChange={e => set('name', e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">Ticker (optional)</label>
          <input type="text" placeholder="e.g. ACME" value={form.ticker}
            onChange={e => set('ticker', e.target.value.toUpperCase())} />
        </div>
      </div>
      <div className="form-grid form-grid-2">
        <div className="form-group">
          <label className="form-label">Grant Date</label>
          <input type="date" value={form.grantDate} onChange={e => set('grantDate', e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">Total Shares</label>
          <input type="number" min="1" step="1" placeholder="1000" value={form.totalShares}
            onChange={e => set('totalShares', e.target.value)} />
        </div>
      </div>
      <div className="form-grid form-grid-2">
        <div className="form-group">
          <label className="form-label">Grant Price / Share ($)</label>
          <input type="number" min="0" step="0.01" placeholder="50.00" value={form.grantPrice}
            onChange={e => set('grantPrice', e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">Current Price / Share ($)</label>
          <input type="number" min="0" step="0.01" placeholder="Same as grant" value={form.currentPrice}
            onChange={e => set('currentPrice', e.target.value)} />
        </div>
      </div>
      <div className="form-grid form-grid-2">
        <div className="form-group">
          <label className="form-label">Cliff (months)</label>
          <input type="number" min="0" step="1" placeholder="12" value={form.cliffMonths}
            onChange={e => set('cliffMonths', e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">Vesting Period (months)</label>
          <input type="number" min="1" step="1" placeholder="48" value={form.vestingMonths}
            onChange={e => set('vestingMonths', e.target.value)} />
        </div>
      </div>
      <div className="form-group">
        <label className="form-label">Vest Frequency</label>
        <select value={form.vestFrequency} onChange={e => set('vestFrequency', e.target.value)}>
          <option value="monthly">Monthly</option>
          <option value="quarterly">Quarterly</option>
        </select>
      </div>
      <div className="form-group">
        <label className="form-label">Notes (optional)</label>
        <input type="text" placeholder="Any notes..." value={form.notes}
          onChange={e => set('notes', e.target.value)} />
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={handleSave}>
          {initial ? 'Save Changes' : 'Add Grant'}
        </button>
      </div>
    </div>
  );
}

// --- Grant Card --------------------------------------------------------------
function GrantCard({ grant, onEdit, onDelete }) {
  const cfmt = useCurrency();
  const [showEvents, setShowEvents] = useState(false);
  const events       = useMemo(() => computeVestEvents(grant), [grant]);
  const vestedEvt    = events.filter(e => e.vested);
  const unvested     = events.filter(e => !e.vested);
  const vestedShares = vestedEvt.reduce((s, e) => s + e.shares, 0);
  const vestedPct    = grant.totalShares > 0 ? (vestedShares / grant.totalShares) * 100 : 0;
  const vestedValue  = vestedEvt.reduce((s, e) => s + e.mktValue, 0);
  const unvestedValue= unvested.reduce((s, e) => s + e.mktValue, 0);
  const nextVest     = unvested[0];

  const todayStr  = today();
  const cliffDate = new Date(grant.grantDate + 'T00:00:00');
  cliffDate.setMonth(cliffDate.getMonth() + (grant.cliffMonths ?? 12));
  const cliffStr  = cliffDate.toISOString().split('T')[0];
  const pastCliff = todayStr >= cliffStr;

  return (
    <div className="card-sm" style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 10 }}>
        <div style={{ width: 44, height: 44, borderRadius: 10, background: '#8b5cf622',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0 }}>
          📈
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)' }}>
            {grant.name}
            {grant.ticker && (
              <span style={{ marginLeft: 8, fontSize: 12, background: 'var(--bg-raised)', color: 'var(--accent-2)',
                padding: '2px 8px', borderRadius: 20, fontWeight: 600 }}>{grant.ticker}</span>
            )}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
            Granted {fmtDate(grant.grantDate)} · {grant.totalShares.toLocaleString()} shares total ·
            {' '}{grant.vestFrequency === 'quarterly' ? 'Quarterly' : 'Monthly'} over {grant.vestingMonths}mo
          </div>
          {!pastCliff && (
            <div style={{ fontSize: 12, color: 'var(--amber)', marginTop: 2 }}>
              Cliff: {fmtDate(cliffStr)}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => onEdit(grant)}>Edit</button>
          <button className="btn btn-ghost btn-sm" style={{ color: 'var(--red)' }}
            onClick={() => { if (confirm(`Delete grant "${grant.name}"?`)) onDelete(grant.id); }}>Delete</button>
        </div>
      </div>

      <div style={{ marginBottom: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>
          <span>{vestedPct.toFixed(0)}% vested ({vestedShares.toLocaleString()} of {grant.totalShares.toLocaleString()} shares)</span>
          <span>Vested value: <strong style={{ color: 'var(--green)' }}>{cfmt(vestedValue)}</strong></span>
        </div>
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: `${Math.min(100, vestedPct)}%`, background: 'var(--accent-2)' }} />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>
        <span>Grant @ {cfmt(grant.grantPrice)}/sh</span>
        <span>Current @ {cfmt(grant.currentPrice || grant.grantPrice)}/sh</span>
        {nextVest && <span style={{ color: 'var(--amber)' }}>Next vest: {fmtDate(nextVest.date)} ({nextVest.shares.toLocaleString()} shares)</span>}
        <span>Unvested: <strong style={{ color: 'var(--text-secondary)' }}>{cfmt(unvestedValue)}</strong></span>
      </div>

      <button className="btn btn-ghost btn-sm" style={{ fontSize: 12 }}
        onClick={() => setShowEvents(s => !s)}>
        {showEvents ? 'Hide' : 'Show'} vest schedule ({events.length} events)
      </button>

      {showEvents && (
        <div style={{ marginTop: 8, maxHeight: 200, overflowY: 'auto' }}>
          <table style={{ width: '100%', fontSize: 12 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left',  color: 'var(--text-secondary)', padding: '4px 8px' }}>Date</th>
                <th style={{ textAlign: 'right', color: 'var(--text-secondary)', padding: '4px 8px' }}>Shares</th>
                <th style={{ textAlign: 'right', color: 'var(--text-secondary)', padding: '4px 8px' }}>Cost Basis</th>
                <th style={{ textAlign: 'right', color: 'var(--text-secondary)', padding: '4px 8px' }}>Mkt Value</th>
                <th style={{ textAlign: 'right', color: 'var(--text-secondary)', padding: '4px 8px' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e, i) => (
                <tr key={i} style={{ opacity: e.vested ? 1 : 0.6 }}>
                  <td style={{ padding: '3px 8px', color: 'var(--text-secondary)' }}>{fmtDate(e.date)}</td>
                  <td style={{ padding: '3px 8px', textAlign: 'right', color: 'var(--text-primary)' }}>
                    {e.shares.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </td>
                  <td style={{ padding: '3px 8px', textAlign: 'right', color: 'var(--text-secondary)' }}>{cfmt(e.costBasis)}</td>
                  <td style={{ padding: '3px 8px', textAlign: 'right', color: e.vested ? 'var(--green)' : 'var(--text-secondary)' }}>{cfmt(e.mktValue)}</td>
                  <td style={{ padding: '3px 8px', textAlign: 'right' }}>
                    {e.vested
                      ? <span style={{ color: 'var(--green)', fontWeight: 600 }}>Vested</span>
                      : <span style={{ color: 'var(--text-muted)' }}>Pending</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// --- Portfolio Allocation Chart ----------------------------------------------
function PortfolioChart({ grants, quotes }) {
  const cfmt = useCurrency();
  const canvasRef = useRef(null);
  const COLORS = ['#7fa88b','#8b5cf6','#60a5fa','#f59e0b','#c2735a','#4ade80','#a78bfa','#fb923c'];

  useChart(canvasRef, () => {
    const items = grants.map(g => {
      const ticker = g.ticker?.toUpperCase();
      const price = (ticker && quotes[ticker]?.price) ?? g.currentPrice ?? g.grantPrice ?? 0;
      const vested = computeGrantVestedShares(g);
      return { label: g.ticker || g.name, value: vested * price };
    }).filter(i => i.value > 0);

    if (!items.length) {
      return { type: 'doughnut', data: { labels: [], datasets: [{ data: [] }] }, options: { responsive: true, maintainAspectRatio: false } };
    }

    return {
      type: 'doughnut',
      data: {
        labels: items.map(i => i.label),
        datasets: [{ data: items.map(i => i.value), backgroundColor: COLORS.slice(0, items.length), borderWidth: 0, hoverOffset: 6 }],
      },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '65%',
        plugins: {
          legend: { labels: { color: CHART.gridLabel, font: { size: 11 } } },
          tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${cfmt(ctx.raw)}` } },
        },
      },
    };
  }, [JSON.stringify(grants.map(g => g.id + (g.currentPrice ?? 0))), JSON.stringify(quotes), cfmt]); // eslint-disable-line

  return <canvas ref={canvasRef} style={{ width: '100%', height: '100%' }} />;
}

// --- Main Equity Component ---------------------------------------------------
export default function Equity({ grants, onAdd, onEdit, onDelete, onAddTx, onVestToAccount, onUpdateGrantPrice, investmentAccounts, finnhubKey, embedded = false }) {
  const cfmt = useCurrency();
  const privacy = usePrivacy();
  const [expandedGrant, setExpandedGrant] = useState(null);
  const [editingPrice,  setEditingPrice]  = useState(null);
  const [priceInput,    setPriceInput]    = useState('');
  const [showAddForm,   setShowAddForm]   = useState(false);
  const [editingGrant,  setEditingGrant]  = useState(null);
  const [vestModal,     setVestModal]     = useState(null);

  const acctList = investmentAccounts ?? [];

  // ── Live market data ─────────────────────────────────────────────────────
  const tickers = useMemo(() => grants.map(g => g.ticker).filter(Boolean), [grants]);
  const { quotes, loading: quotesLoading, error: quotesError, refresh: refreshQuotes, lastUpdated } = useMarketData(tickers, finnhubKey);

  // Use live price if available, fall back to stored price
  // Defined before useMemo that depends on it to avoid temporal dead zone
  const effectivePrice = (grant) => {
    const ticker = grant.ticker?.toUpperCase();
    return (ticker && quotes[ticker]?.price) ?? grant.currentPrice ?? grant.grantPrice ?? 0;
  };

  // Summary totals using live prices where available
  const { totalVestedValue, totalUnvestedValue } = useMemo(() => {
    let tv = 0, tu = 0;
    grants.forEach(g => {
      const events   = computeVestEvents(g);
      const price    = effectivePrice(g);
      const vested   = events.filter(e => e.vested).reduce((s, e) => s + e.shares, 0);
      const unvested = (g.totalShares || 0) - vested;
      tv += vested   * price;
      tu += unvested * price;
    });
    return { totalVestedValue: tv, totalUnvestedValue: tu };
  }, [grants, quotes]); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePriceClick = (grantId, currentPrice) => {
    setEditingPrice(grantId);
    setPriceInput(String(currentPrice));
  };

  const handlePriceSave = (grantId) => {
    if (grantId && onUpdateGrantPrice) {
      const parsed = parseFloat(priceInput);
      if (!isNaN(parsed) && parsed >= 0) onUpdateGrantPrice(grantId, parsed);
    }
    setEditingPrice(null);
    setPriceInput('');
  };

  const handleRecordVest = (event, grant) => {
    const price = grant.currentPrice || grant.grantPrice || 0;
    const value = event.shares * price;
    if (!window.confirm(
      `Record ${event.shares.toLocaleString(undefined, { maximumFractionDigits: 2 })} shares vesting at ${privacy ? '••••' : '$' + price.toFixed(2)}/share = ${cfmt(value)}?\n\nThis creates an income transaction.`
    )) return;
    const tx = {
      id:          uid(),
      date:        event.date,
      description: `${grant.name} vest — ${event.shares} shares`,
      amount:      value,
      category:    'Income',
      type:        'income',
      account:     '', // account set by VestAccountModal
      notes:       `RSU/equity vest: ${grant.ticker || grant.name}`,
      tags:        ['equity', 'vest'],
    };
    if (onVestToAccount && acctList.length > 0) {
      setVestModal({ event, grant, tx, value });
    } else {
      onAddTx && onAddTx(tx);
    }
  };

  const thStyle = (align = 'left') => ({
    textAlign: align,
    color: 'var(--text-secondary)', fontWeight: 600, fontSize: 11,
    textTransform: 'uppercase', letterSpacing: '0.05em',
    padding: '7px 10px', borderBottom: '1px solid var(--bg-raised)',
    whiteSpace: 'nowrap',
  });
  const tdStyle = (align = 'left', extra = {}) => ({
    padding: '9px 10px', textAlign: align, verticalAlign: 'middle', ...extra,
  });

  const fmtChg = (pct) => {
    if (pct == null) return null;
    const sign = pct >= 0 ? '+' : '';
    return <span style={{ fontSize:10, color: pct >= 0 ? 'var(--green)' : 'var(--red)', fontWeight:600, marginLeft:4 }}>
      {sign}{pct.toFixed(2)}%
    </span>;
  };

  return (
    <div className={embedded ? '' : 'fade-in'} style={{ padding: embedded ? 0 : '24px 28px' }}>
      {/* Header */}
      <div className="section-header">
        <div>
          <div className="section-title">Investments</div>
          <div className="section-sub">Track RSUs, stock options, and equity vesting</div>
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          {tickers.length > 0 && (
            <button className="btn btn-secondary" onClick={refreshQuotes} disabled={quotesLoading}
              title="Refresh live prices from Finnhub / CoinGecko">
              {quotesLoading ? '⟳ Fetching…' : '⟳ Refresh Prices'}
            </button>
          )}
          <button className="btn btn-primary" onClick={() => setShowAddForm(true)}>+ Add Grant</button>
        </div>
      </div>

      {/* API status / errors */}
      {quotesError && (
        <div style={{ background:'#c2735a18', border:'1px solid #c2735a44', borderRadius:8, padding:'8px 14px', marginBottom:12, fontSize:12, color:'var(--red)' }}>
          ⚠ {quotesError}
        </div>
      )}
      {lastUpdated && !quotesError && (
        <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:8 }}>
          Prices last updated {new Date(lastUpdated).toLocaleTimeString()}
        </div>
      )}

      {/* Summary stat cards */}
      {grants.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14, marginBottom: 20 }}>
          <div className="stat-card">
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Total Grants</div>
            <div className="hero-num" style={{ fontSize: 28, fontWeight: 400, color: 'var(--text-primary)' }}>{grants.length}</div>
          </div>
          <div className="stat-card">
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Vested Value</div>
            <div className="hero-num" style={{ fontSize: 28, fontWeight: 400, color: 'var(--green)' }}>{cfmt(totalVestedValue)}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>at current price</div>
          </div>
          <div className="stat-card">
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Unvested Value</div>
            <div className="hero-num" style={{ fontSize: 28, fontWeight: 400, color: 'var(--accent-2)' }}>{cfmt(totalUnvestedValue)}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>at current price</div>
          </div>
        </div>
      )}

      {/* Portfolio allocation chart */}
      {grants.length > 1 && (
        <div className="card" style={{ marginBottom:16, padding:16 }}>
          <div style={{ fontWeight:600, fontSize:13, color:'var(--text-secondary)', marginBottom:12 }}>Portfolio Allocation</div>
          <div style={{ display:'grid', gridTemplateColumns:'auto 1fr', gap:16, alignItems:'center' }}>
            <div style={{ width:220, height:220, position:'relative' }}>
              {grants.map(g => null) /* force re-mount on change */}
              <PortfolioChart grants={grants} quotes={quotes} />
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
              {grants.map((g, i) => {
                const COLORS = ['#7fa88b','#8b5cf6','#60a5fa','#f59e0b','#c2735a','#4ade80','#a78bfa','#fb923c'];
                const price = effectivePrice(g);
                const vested = computeGrantVestedShares(g);
                const value = vested * price;
                return (
                  <div key={g.id} style={{ display:'flex', alignItems:'center', gap:8, fontSize:12 }}>
                    <div style={{ width:10, height:10, borderRadius:3, background: COLORS[i % COLORS.length], flexShrink:0 }} />
                    <span style={{ color:'var(--text-secondary)', flex:1 }}>{g.ticker || g.name}</span>
                    <span style={{ color:'var(--text-primary)', fontWeight:600 }}>{cfmt(value)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Grant table */}
      {grants.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-icon">{'>'}</div>
            <p>No equity grants yet.</p>
            <p style={{ fontSize: 13, marginTop: 6 }}>Add RSUs or stock options to track your vesting schedule.</p>
            <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => setShowAddForm(true)}>+ Add First Grant</button>
          </div>
        </div>
      ) : (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thStyle('left')}>Grant Name</th>
                <th style={thStyle('left')}>Ticker</th>
                <th style={thStyle('right')}>Vested</th>
                <th style={thStyle('right')}>Unvested</th>
                <th style={thStyle('right')}>Price</th>
                <th style={thStyle('right')}>Total Value</th>
                <th style={thStyle('left')}>Next Vest</th>
                <th style={thStyle('right')}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {grants.map(g => {
                const vestEvents = computeVestEvents(g);
                const vested     = vestEvents.filter(e => e.vested).reduce((s, e) => s + e.shares, 0);
                const unvested   = (g.totalShares || 0) - vested;
                const price      = effectivePrice(g);
                const totalValue = vested * price;
                const ticker     = g.ticker?.toUpperCase();
                const liveQuote  = ticker ? quotes[ticker] : null;
                const nextVest   = vestEvents.find(e => !e.vested);
                const isExpanded = expandedGrant === g.id;
                const isEditingP = editingPrice === g.id;

                return (
                  <Fragment key={g.id}>
                    {/* Main grant row */}
                    <tr
                      style={{
                        borderBottom: isExpanded ? 'none' : '1px solid var(--bg-raised)',
                        background: isExpanded ? 'var(--bg-card)' : 'transparent',
                        cursor: 'pointer',
                      }}
                      onClick={() => setExpandedGrant(isExpanded ? null : g.id)}
                    >
                      <td style={tdStyle('left')}>
                        <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{g.name}</span>
                        {isExpanded && (
                          <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--accent-2)' }}>▲</span>
                        )}
                        {!isExpanded && (
                          <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--text-muted)' }}>▼</span>
                        )}
                      </td>
                      <td style={tdStyle('left')}>
                        {g.ticker
                          ? <span style={{ fontSize: 11, background: 'var(--bg-raised)', color: 'var(--accent-2)', padding: '1px 7px', borderRadius: 20, fontWeight: 600 }}>{g.ticker}</span>
                          : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                      </td>
                      <td style={tdStyle('right')}>
                        <span style={{ color: 'var(--green)', fontWeight: 700 }}>
                          {vested.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                        </span>
                      </td>
                      <td style={tdStyle('right')}>
                        <span style={{ color: 'var(--text-secondary)' }}>
                          {unvested.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                        </span>
                      </td>
                      <td style={tdStyle('right')} onClick={e => { e.stopPropagation(); if (!isEditingP) handlePriceClick(g.id, price); }}>
                        {isEditingP ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }} onClick={e => e.stopPropagation()}>
                            <input
                              type="number" min="0" step="0.01"
                              value={priceInput}
                              onChange={e => setPriceInput(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === 'Enter') handlePriceSave(g.id);
                                if (e.key === 'Escape') { setEditingPrice(null); setPriceInput(''); }
                              }}
                              autoFocus
                              style={{ width: 72, textAlign: 'right', fontSize: 12, padding: '2px 5px',
                                background: 'var(--bg-raised)', border: '1px solid var(--accent-2)', borderRadius: 4, color: 'var(--text-primary)' }}
                            />
                            <button className="btn btn-primary btn-sm" style={{ fontSize: 11, padding: '2px 8px' }}
                              onClick={() => handlePriceSave(g.id)}>Save</button>
                            <button className="btn btn-ghost btn-sm" style={{ fontSize: 11, padding: '2px 6px' }}
                              onClick={() => { setEditingPrice(null); setPriceInput(''); }}>&#10005;</button>
                          </span>
                        ) : (
                          <span title={liveQuote ? 'Live price — click to override' : 'Click to edit price'}
                            style={{ cursor: 'pointer', color: liveQuote ? 'var(--green)' : 'var(--text-primary)', borderBottom: '1px dashed var(--text-muted)', paddingBottom: 1 }}>
                            {cfmt(price)}
                            {liveQuote && fmtChg(liveQuote.changePct)}
                          </span>
                        )}
                      </td>
                      <td style={tdStyle('right')}>
                        <span style={{ color: 'var(--green)', fontWeight: 700 }}>{cfmt(totalValue)}</span>
                      </td>
                      <td style={tdStyle('left')}>
                        {nextVest
                          ? <span style={{ color: 'var(--amber)', fontSize: 12 }}>{fmtDate(nextVest.date)}</span>
                          : <span style={{ color: 'var(--green)', fontSize: 12 }}>Fully Vested</span>}
                      </td>
                      <td style={tdStyle('right')} onClick={e => e.stopPropagation()}>
                        <span style={{ display: 'inline-flex', gap: 4 }}>
                          <button
                            className="btn btn-ghost btn-sm"
                            title="Edit grant"
                            style={{ fontSize: 13, padding: '2px 7px' }}
                            onClick={() => setEditingGrant(g)}>
                            &#x270F;&#xFE0F;
                          </button>
                          <button
                            className="btn btn-ghost btn-sm"
                            title="Delete grant"
                            style={{ fontSize: 13, padding: '2px 7px', color: 'var(--red)' }}
                            onClick={() => { if (window.confirm(`Delete grant "${g.name}"?`)) onDelete(g.id); }}>
                            &#x1F5D1;&#xFE0F;
                          </button>
                        </span>
                      </td>
                    </tr>

                    {/* Expanded vest schedule drawer */}
                    {isExpanded && (
                      <tr key={`${g.id}-drawer`} style={{ borderBottom: '1px solid var(--bg-raised)' }}>
                        <td colSpan={8} style={{ padding: 0, background: 'var(--bg-card)' }}>
                          <div style={{ padding: '12px 16px 16px 32px' }}>
                            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
                              Vest Schedule
                            </div>
                            <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                              <thead>
                                <tr>
                                  {['Date', 'Shares', 'Status', 'Value', 'Action'].map((h, i) => (
                                    <th key={h} style={{
                                      textAlign: i >= 2 ? 'right' : 'left',
                                      color: 'var(--text-muted)', fontWeight: 600, fontSize: 11,
                                      textTransform: 'uppercase', letterSpacing: '0.04em',
                                      padding: '4px 8px', borderBottom: '1px solid var(--bg-raised)',
                                    }}>{h}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {vestEvents.map((e, i) => {
                                  const evtValue = e.shares * effectivePrice(g);
                                  return (
                                    <tr key={i} style={{ opacity: e.vested ? 0.65 : 1, borderBottom: '1px solid var(--bg-page)' }}>
                                      <td style={{ padding: '5px 8px', color: 'var(--text-secondary)' }}>{fmtDate(e.date)}</td>
                                      <td style={{ padding: '5px 8px', color: 'var(--text-primary)' }}>
                                        {e.shares.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                                      </td>
                                      <td style={{ padding: '5px 8px', textAlign: 'right' }}>
                                        {e.vested
                                          ? <span style={{ color: 'var(--green)' }}>Vested</span>
                                          : <span style={{ color: 'var(--amber)' }}>Upcoming</span>}
                                      </td>
                                      <td style={{ padding: '5px 8px', textAlign: 'right', color: e.vested ? 'var(--green)' : 'var(--text-secondary)' }}>
                                        {cfmt(evtValue)}
                                      </td>
                                      <td style={{ padding: '5px 8px', textAlign: 'right' }}>
                                        {!e.vested && onAddTx && (
                                          <button
                                            className="btn btn-green btn-sm"
                                            style={{ fontSize: 11 }}
                                            onClick={() => handleRecordVest(e, g)}>
                                            Record Vest
                                          </button>
                                        )}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
            {/* Summary footer */}
            <tfoot>
              <tr style={{ borderTop: '2px solid var(--text-muted)' }}>
                <td colSpan={2} style={{ padding: '10px 10px', color: 'var(--text-secondary)', fontWeight: 600, fontSize: 13 }}>
                  Portfolio Total
                </td>
                <td style={{ padding: '10px 10px', textAlign: 'right' }}>
                  <span style={{ color: 'var(--green)', fontWeight: 700 }}>{cfmt(totalVestedValue)}</span>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>vested</div>
                </td>
                <td style={{ padding: '10px 10px', textAlign: 'right' }}>
                  <span style={{ color: 'var(--accent-2)', fontWeight: 700 }}>{cfmt(totalUnvestedValue)}</span>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>unvested</div>
                </td>
                <td colSpan={2} style={{ padding: '10px 10px', textAlign: 'right' }}>
                  <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>{cfmt(totalVestedValue + totalUnvestedValue)}</span>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>portfolio total</div>
                </td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Add grant modal */}
      {showAddForm && (
        <Modal title="Add Equity Grant" onClose={() => setShowAddForm(false)}>
          <GrantForm onSave={g => { onAdd(g); setShowAddForm(false); }} onClose={() => setShowAddForm(false)} />
        </Modal>
      )}

      {/* Edit grant modal */}
      {editingGrant && (
        <Modal title="Edit Equity Grant" onClose={() => setEditingGrant(null)}>
          <GrantForm
            initial={{
              ...editingGrant,
              totalShares:   String(editingGrant.totalShares),
              grantPrice:    String(editingGrant.grantPrice),
              currentPrice:  String(editingGrant.currentPrice),
              cliffMonths:   String(editingGrant.cliffMonths),
              vestingMonths: String(editingGrant.vestingMonths),
            }}
            onSave={g => { onEdit(g); setEditingGrant(null); }}
            onClose={() => setEditingGrant(null)}
          />
        </Modal>
      )}

      {/* Vest-to-account modal */}
      {vestModal && (
        <Modal title="Credit Vested Shares to Account" onClose={() => setVestModal(null)}>
          <VestAccountModal
            vestLabel={`${vestModal.grant.name} — ${vestModal.event.shares} shares`}
            vestValue={vestModal.value}
            investmentAccounts={acctList}
            onConfirm={(accountId) => {
              onAddTx && onAddTx(vestModal.tx);
              onVestToAccount && onVestToAccount(accountId, vestModal.value);
              setVestModal(null);
            }}
            onSkip={() => {
              onAddTx && onAddTx(vestModal.tx);
              setVestModal(null);
            }}
            onClose={() => setVestModal(null)}
          />
        </Modal>
      )}
    </div>
  );
}
