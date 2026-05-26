import { useState, useMemo, Fragment } from 'react';
import { fmt, fmtDate, today, uid } from '../constants.js';
import Modal from './Modal.jsx';

// --- Holdings Ledger ---------------------------------------------------------
function HoldingsLedger({ grants, editingPrice, priceInput, onPriceClick, onPriceChange, onPriceCommit }) {
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
                color: '#64748b', fontWeight: 600, fontSize: 11, textTransform: 'uppercase',
                letterSpacing: '0.05em', padding: '6px 10px', borderBottom: '1px solid #1e2736',
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
              <tr key={g.id} style={{ borderBottom: '1px solid #1e2736' }}>
                <td style={{ padding: '8px 10px', color: '#e2e8f0', fontWeight: 600 }}>
                  {g.name}
                  {g.ticker && (
                    <span style={{ marginLeft: 6, fontSize: 11, background: '#1e2736', color: '#8b5cf6',
                      padding: '1px 6px', borderRadius: 20, fontWeight: 600 }}>{g.ticker}</span>
                  )}
                </td>
                <td style={{ padding: '8px 10px', color: '#94a3b8' }}>
                  <span style={{ color: '#4ade80', fontWeight: 700 }}>
                    {vested.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </span>
                  <span style={{ color: '#475569' }}> / {(g.totalShares || 0).toLocaleString()}</span>
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
                        background: '#1e2736', border: '1px solid #8b5cf6', borderRadius: 4, color: '#e2e8f0' }}
                    />
                  ) : (
                    <span
                      title="Click to edit price"
                      onClick={() => onPriceClick(g.id, price)}
                      style={{ cursor: 'pointer', color: '#e2e8f0', borderBottom: '1px dashed #475569', paddingBottom: 1 }}>
                      {fmt(price)}
                    </span>
                  )}
                </td>
                <td style={{ padding: '8px 10px', textAlign: 'right', color: '#4ade80', fontWeight: 700 }}>
                  {fmt(value)}
                  {g.grantPrice > 0 && (
                    <div style={{ fontSize: 11, color: gainPos ? '#4ade80' : '#c2735a', fontWeight: 400, marginTop: 2 }}>
                      {gainPos ? '+' : ''}{fmt(gain)} gain
                    </div>
                  )}
                </td>
                <td style={{ padding: '8px 10px' }}>
                  {vested >= (g.totalShares || 0)
                    ? <span style={{ color: '#4ade80', fontWeight: 600, fontSize: 12 }}>Fully Vested</span>
                    : vested > 0
                      ? <span style={{ color: '#f59e0b', fontSize: 12 }}>Vesting</span>
                      : <span style={{ color: '#475569', fontSize: 12 }}>Pending</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
        {grants.length > 0 && (
          <tfoot>
            <tr style={{ borderTop: '2px solid #334155' }}>
              <td colSpan={3} style={{ padding: '10px 10px', color: '#94a3b8', fontWeight: 600, fontSize: 13 }}>
                Portfolio Total
              </td>
              <td style={{ padding: '10px 10px', textAlign: 'right' }}>
                <span style={{ fontSize: 18, fontWeight: 700, color: '#4ade80' }}>{fmt(totalPortfolioValue)}</span>
                <div style={{ fontSize: 11, color: '#475569', marginTop: 2 }}>vested shares at current price</div>
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
  const [selectedId, setSelectedId] = useState(investmentAccounts[0]?.id ?? '');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ fontSize: 13, color: '#94a3b8' }}>
        Recording <strong style={{ color: '#e2e8f0' }}>{vestLabel}</strong> worth{' '}
        <strong style={{ color: '#4ade80' }}>{fmt(vestValue)}</strong>
      </div>
      <div className="form-group">
        <label className="form-label">Credit to investment account</label>
        <select value={selectedId} onChange={e => setSelectedId(e.target.value)}>
          {investmentAccounts.map(a => (
            <option key={a.id} value={a.id}>{a.name} ({fmt(a.balance)})</option>
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

// --- Vesting calculation -----------------------------------------------------
function computeVestEvents(grant) {
  const { grantDate, totalShares, cliffMonths, vestingMonths, vestFrequency, grantPrice, currentPrice } = grant;
  if (!grantDate || !totalShares || !vestingMonths) return [];

  const start = new Date(grantDate + 'T00:00:00');
  const cliff = new Date(start);
  cliff.setMonth(cliff.getMonth() + (cliffMonths ?? 12));

  const freqMonths = vestFrequency === 'quarterly' ? 3 : 1;
  const periods    = Math.floor(vestingMonths / freqMonths);
  const perPeriod  = totalShares / periods;
  const events     = [];

  for (let i = 1; i <= periods; i++) {
    const d = new Date(start);
    d.setMonth(d.getMonth() + i * freqMonths);
    if (d < cliff) continue;
    const dateStr   = d.toISOString().split('T')[0];
    const costBasis = perPeriod * (grantPrice ?? 0);
    const mktValue  = perPeriod * (currentPrice ?? grantPrice ?? 0);
    events.push({ date: dateStr, shares: perPeriod, costBasis, mktValue, vested: dateStr <= today() });
  }

  return events;
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
          <div style={{ fontWeight: 700, fontSize: 15, color: '#e2e8f0' }}>
            {grant.name}
            {grant.ticker && (
              <span style={{ marginLeft: 8, fontSize: 12, background: '#1e2736', color: '#8b5cf6',
                padding: '2px 8px', borderRadius: 20, fontWeight: 600 }}>{grant.ticker}</span>
            )}
          </div>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
            Granted {fmtDate(grant.grantDate)} · {grant.totalShares.toLocaleString()} shares total ·
            {' '}{grant.vestFrequency === 'quarterly' ? 'Quarterly' : 'Monthly'} over {grant.vestingMonths}mo
          </div>
          {!pastCliff && (
            <div style={{ fontSize: 12, color: '#f59e0b', marginTop: 2 }}>
              Cliff: {fmtDate(cliffStr)}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => onEdit(grant)}>Edit</button>
          <button className="btn btn-ghost btn-sm" style={{ color: '#c2735a' }}
            onClick={() => { if (confirm(`Delete grant "${grant.name}"?`)) onDelete(grant.id); }}>Delete</button>
        </div>
      </div>

      <div style={{ marginBottom: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#64748b', marginBottom: 4 }}>
          <span>{vestedPct.toFixed(0)}% vested ({vestedShares.toLocaleString()} of {grant.totalShares.toLocaleString()} shares)</span>
          <span>Vested value: <strong style={{ color: '#4ade80' }}>{fmt(vestedValue)}</strong></span>
        </div>
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: `${Math.min(100, vestedPct)}%`, background: '#8b5cf6' }} />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 16, fontSize: 12, color: '#64748b', marginBottom: 8 }}>
        <span>Grant @ {fmt(grant.grantPrice)}/sh</span>
        <span>Current @ {fmt(grant.currentPrice || grant.grantPrice)}/sh</span>
        {nextVest && <span style={{ color: '#f59e0b' }}>Next vest: {fmtDate(nextVest.date)} ({nextVest.shares.toLocaleString()} shares)</span>}
        <span>Unvested: <strong style={{ color: '#94a3b8' }}>{fmt(unvestedValue)}</strong></span>
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
                <th style={{ textAlign: 'left',  color: '#64748b', padding: '4px 8px' }}>Date</th>
                <th style={{ textAlign: 'right', color: '#64748b', padding: '4px 8px' }}>Shares</th>
                <th style={{ textAlign: 'right', color: '#64748b', padding: '4px 8px' }}>Cost Basis</th>
                <th style={{ textAlign: 'right', color: '#64748b', padding: '4px 8px' }}>Mkt Value</th>
                <th style={{ textAlign: 'right', color: '#64748b', padding: '4px 8px' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e, i) => (
                <tr key={i} style={{ opacity: e.vested ? 1 : 0.6 }}>
                  <td style={{ padding: '3px 8px', color: '#94a3b8' }}>{fmtDate(e.date)}</td>
                  <td style={{ padding: '3px 8px', textAlign: 'right', color: '#e2e8f0' }}>
                    {e.shares.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </td>
                  <td style={{ padding: '3px 8px', textAlign: 'right', color: '#94a3b8' }}>{fmt(e.costBasis)}</td>
                  <td style={{ padding: '3px 8px', textAlign: 'right', color: e.vested ? '#4ade80' : '#94a3b8' }}>{fmt(e.mktValue)}</td>
                  <td style={{ padding: '3px 8px', textAlign: 'right' }}>
                    {e.vested
                      ? <span style={{ color: '#4ade80', fontWeight: 600 }}>Vested</span>
                      : <span style={{ color: '#475569' }}>Pending</span>}
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

// --- Main Equity Component ---------------------------------------------------
export default function Equity({ grants, onAdd, onEdit, onDelete, onAddTx, onVestToAccount, onUpdateGrantPrice, investmentAccounts }) {
  const [expandedGrant, setExpandedGrant] = useState(null);
  const [editingPrice,  setEditingPrice]  = useState(null);
  const [priceInput,    setPriceInput]    = useState('');
  const [showAddForm,   setShowAddForm]   = useState(false);
  const [editingGrant,  setEditingGrant]  = useState(null);
  const [vestModal,     setVestModal]     = useState(null);

  const acctList = investmentAccounts ?? [];

  // Summary totals
  const { totalVestedValue, totalUnvestedValue } = useMemo(() => {
    let tv = 0, tu = 0;
    grants.forEach(g => {
      const events  = computeVestEvents(g);
      const price   = g.currentPrice || g.grantPrice || 0;
      const vested  = events.filter(e => e.vested).reduce((s, e) => s + e.shares, 0);
      const unvested = (g.totalShares || 0) - vested;
      tv += vested * price;
      tu += unvested * price;
    });
    return { totalVestedValue: tv, totalUnvestedValue: tu };
  }, [grants]);

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
      `Record ${event.shares.toLocaleString(undefined, { maximumFractionDigits: 2 })} shares vesting at $${price.toFixed(2)}/share = ${fmt(value)}?\n\nThis creates an income transaction.`
    )) return;
    const tx = {
      id:          uid(),
      date:        event.date,
      description: `${grant.name} vest — ${event.shares} shares`,
      amount:      value,
      category:    'Income',
      type:        'income',
      account:     grant.linkedAccountId ?? '',
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
    color: '#64748b', fontWeight: 600, fontSize: 11,
    textTransform: 'uppercase', letterSpacing: '0.05em',
    padding: '7px 10px', borderBottom: '1px solid #1e2736',
    whiteSpace: 'nowrap',
  });
  const tdStyle = (align = 'left', extra = {}) => ({
    padding: '9px 10px', textAlign: align, verticalAlign: 'middle', ...extra,
  });

  return (
    <div className="fade-in" style={{ padding: '24px 28px' }}>
      {/* Header */}
      <div className="section-header">
        <div>
          <div className="section-title">Equity</div>
          <div className="section-sub">Track RSUs, stock options, and equity vesting</div>
        </div>
        <button className="btn btn-primary" onClick={() => setShowAddForm(true)}>+ Add Grant</button>
      </div>

      {/* Summary stat cards */}
      {grants.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14, marginBottom: 20 }}>
          <div className="stat-card">
            <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Total Grants</div>
            <div className="hero-num" style={{ fontSize: 28, fontWeight: 400, color: '#e2e8f0' }}>{grants.length}</div>
          </div>
          <div className="stat-card">
            <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Vested Value</div>
            <div className="hero-num" style={{ fontSize: 28, fontWeight: 400, color: '#4ade80' }}>{fmt(totalVestedValue)}</div>
            <div style={{ fontSize: 12, color: '#475569', marginTop: 4 }}>at current price</div>
          </div>
          <div className="stat-card">
            <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Unvested Value</div>
            <div className="hero-num" style={{ fontSize: 28, fontWeight: 400, color: '#8b5cf6' }}>{fmt(totalUnvestedValue)}</div>
            <div style={{ fontSize: 12, color: '#475569', marginTop: 4 }}>at current price</div>
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
                const price      = g.currentPrice || g.grantPrice || 0;
                const totalValue = vested * price;
                const nextVest   = vestEvents.find(e => !e.vested);
                const isExpanded = expandedGrant === g.id;
                const isEditingP = editingPrice === g.id;

                return (
                  <Fragment key={g.id}>
                    {/* Main grant row */}
                    <tr
                      style={{
                        borderBottom: isExpanded ? 'none' : '1px solid #1e2736',
                        background: isExpanded ? '#131c2b' : 'transparent',
                        cursor: 'pointer',
                      }}
                      onClick={() => setExpandedGrant(isExpanded ? null : g.id)}
                    >
                      <td style={tdStyle('left')}>
                        <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{g.name}</span>
                        {isExpanded && (
                          <span style={{ marginLeft: 6, fontSize: 10, color: '#8b5cf6' }}>▲</span>
                        )}
                        {!isExpanded && (
                          <span style={{ marginLeft: 6, fontSize: 10, color: '#475569' }}>▼</span>
                        )}
                      </td>
                      <td style={tdStyle('left')}>
                        {g.ticker
                          ? <span style={{ fontSize: 11, background: '#1e2736', color: '#8b5cf6', padding: '1px 7px', borderRadius: 20, fontWeight: 600 }}>{g.ticker}</span>
                          : <span style={{ color: '#475569' }}>—</span>}
                      </td>
                      <td style={tdStyle('right')}>
                        <span style={{ color: '#4ade80', fontWeight: 700 }}>
                          {vested.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                        </span>
                      </td>
                      <td style={tdStyle('right')}>
                        <span style={{ color: '#94a3b8' }}>
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
                                background: '#1e2736', border: '1px solid #8b5cf6', borderRadius: 4, color: '#e2e8f0' }}
                            />
                            <button className="btn btn-primary btn-sm" style={{ fontSize: 11, padding: '2px 8px' }}
                              onClick={() => handlePriceSave(g.id)}>Save</button>
                            <button className="btn btn-ghost btn-sm" style={{ fontSize: 11, padding: '2px 6px' }}
                              onClick={() => { setEditingPrice(null); setPriceInput(''); }}>&#10005;</button>
                          </span>
                        ) : (
                          <span title="Click to edit price"
                            style={{ cursor: 'pointer', color: '#e2e8f0', borderBottom: '1px dashed #475569', paddingBottom: 1 }}>
                            {fmt(price)}
                          </span>
                        )}
                      </td>
                      <td style={tdStyle('right')}>
                        <span style={{ color: '#4ade80', fontWeight: 700 }}>{fmt(totalValue)}</span>
                      </td>
                      <td style={tdStyle('left')}>
                        {nextVest
                          ? <span style={{ color: '#f59e0b', fontSize: 12 }}>{fmtDate(nextVest.date)}</span>
                          : <span style={{ color: '#4ade80', fontSize: 12 }}>Fully Vested</span>}
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
                            style={{ fontSize: 13, padding: '2px 7px', color: '#c2735a' }}
                            onClick={() => { if (window.confirm(`Delete grant "${g.name}"?`)) onDelete(g.id); }}>
                            &#x1F5D1;&#xFE0F;
                          </button>
                        </span>
                      </td>
                    </tr>

                    {/* Expanded vest schedule drawer */}
                    {isExpanded && (
                      <tr key={`${g.id}-drawer`} style={{ borderBottom: '1px solid #1e2736' }}>
                        <td colSpan={8} style={{ padding: 0, background: '#131c2b' }}>
                          <div style={{ padding: '12px 16px 16px 32px' }}>
                            <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
                              Vest Schedule
                            </div>
                            <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                              <thead>
                                <tr>
                                  {['Date', 'Shares', 'Status', 'Value', 'Action'].map((h, i) => (
                                    <th key={h} style={{
                                      textAlign: i >= 2 ? 'right' : 'left',
                                      color: '#475569', fontWeight: 600, fontSize: 11,
                                      textTransform: 'uppercase', letterSpacing: '0.04em',
                                      padding: '4px 8px', borderBottom: '1px solid #1e2736',
                                    }}>{h}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {vestEvents.map((e, i) => {
                                  const evtValue = e.shares * price;
                                  return (
                                    <tr key={i} style={{ opacity: e.vested ? 0.65 : 1, borderBottom: '1px solid #0d1520' }}>
                                      <td style={{ padding: '5px 8px', color: '#94a3b8' }}>{fmtDate(e.date)}</td>
                                      <td style={{ padding: '5px 8px', color: '#e2e8f0' }}>
                                        {e.shares.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                                      </td>
                                      <td style={{ padding: '5px 8px', textAlign: 'right' }}>
                                        {e.vested
                                          ? <span style={{ color: '#4ade80' }}>Vested</span>
                                          : <span style={{ color: '#f59e0b' }}>Upcoming</span>}
                                      </td>
                                      <td style={{ padding: '5px 8px', textAlign: 'right', color: e.vested ? '#4ade80' : '#94a3b8' }}>
                                        {fmt(evtValue)}
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
              <tr style={{ borderTop: '2px solid #334155' }}>
                <td colSpan={2} style={{ padding: '10px 10px', color: '#94a3b8', fontWeight: 600, fontSize: 13 }}>
                  Portfolio Total
                </td>
                <td style={{ padding: '10px 10px', textAlign: 'right' }}>
                  <span style={{ color: '#4ade80', fontWeight: 700 }}>{fmt(totalVestedValue)}</span>
                  <div style={{ fontSize: 10, color: '#475569' }}>vested</div>
                </td>
                <td style={{ padding: '10px 10px', textAlign: 'right' }}>
                  <span style={{ color: '#8b5cf6', fontWeight: 700 }}>{fmt(totalUnvestedValue)}</span>
                  <div style={{ fontSize: 10, color: '#475569' }}>unvested</div>
                </td>
                <td colSpan={2} style={{ padding: '10px 10px', textAlign: 'right' }}>
                  <span style={{ fontSize: 18, fontWeight: 700, color: '#e2e8f0' }}>{fmt(totalVestedValue + totalUnvestedValue)}</span>
                  <div style={{ fontSize: 10, color: '#475569' }}>portfolio total</div>
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
