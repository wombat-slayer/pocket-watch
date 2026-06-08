import { useState, useMemo, useEffect } from 'react';
import { fmt, thisMonth, getAllCategories } from '../constants.js';
import { useCurrency } from '../hooks/useCurrency.js';

export default function MonthClose({ transactions, accounts, budgets, netWorthHistory, userCategories, onEditTx, onAdjustBalance, onClose }) {
  const cfmt = useCurrency();
  const [step, setStep] = useState(1);
  const [catEdits, setCatEdits] = useState({}); // txId → newCategory
  const [balanceEdits, setBalanceEdits] = useState({}); // acctId → newBalance

  useEffect(() => {
    const handleKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const month = thisMonth();
  const allCats = getAllCategories(userCategories);

  const monthTxs = useMemo(() => transactions.filter(t => t.date.startsWith(month)), [transactions, month]);
  const uncategorized = useMemo(() => monthTxs.filter(t => t.category === 'Other' && t.type === 'expense'), [monthTxs]);
  const monthBudgets = useMemo(() => budgets.filter(b => b.month === month), [budgets, month]);

  const catSpend = useMemo(() => {
    const map = {};
    monthTxs.filter(t => t.type === 'expense').forEach(t => {
      map[t.category] = (map[t.category] || 0) + Math.abs(t.amount);
    });
    return map;
  }, [monthTxs]);

  const monthIncome = useMemo(() => monthTxs.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0), [monthTxs]);
  const monthSpend  = useMemo(() => monthTxs.filter(t => t.type === 'expense').reduce((s, t) => s + Math.abs(t.amount), 0), [monthTxs]);

  // Net worth delta vs 1 month ago
  const lastMonthStr = (() => { const d = new Date(); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 7); })();
  const lastMonthNW  = netWorthHistory.filter(h => h.date.startsWith(lastMonthStr)).slice(-1)[0]?.netWorth ?? null;
  const currentNW    = netWorthHistory.slice(-1)[0]?.netWorth ?? null;
  const nwDelta      = lastMonthNW !== null && currentNW !== null ? currentNW - lastMonthNW : null;

  const handleCatSave = () => {
    Object.entries(catEdits).forEach(([id, cat]) => {
      const tx = transactions.find(t => t.id === id);
      if (tx) onEditTx({ ...tx, category: cat });
    });
    setStep(2);
  };

  const handleBalanceSave = () => {
    Object.entries(balanceEdits).forEach(([acctId, val]) => {
      const amt = parseFloat(val);
      if (!isNaN(amt)) onAdjustBalance(acctId, amt);
    });
    setStep(4);
  };

  const steps = [
    { label: 'Review Transactions' },
    { label: 'Budget Check' },
    { label: 'Account Balances' },
    { label: 'Summary' },
  ];

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000000cc', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--bg-raised)', borderRadius: 16, padding: '28px 32px', width: 'min(680px,95vw)', maxHeight: '85vh', overflowY: 'auto' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>
              Month Close — {new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>Step {step} of 4 — {steps[step - 1].label}</div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>

        {/* Step indicator */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 24 }}>
          {steps.map((_, i) => (
            <div key={i} style={{ flex: 1, height: 3, borderRadius: 2, background: i < step ? 'var(--green)' : 'var(--bg-raised)' }} />
          ))}
        </div>

        {/* Step 1: Uncategorized */}
        {step === 1 && (
          <div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
              {uncategorized.length === 0
                ? null
                : `${uncategorized.length} transaction${uncategorized.length !== 1 ? 's' : ''} need review`}
            </div>
            {uncategorized.length === 0
              ? (
                <div style={{ textAlign: 'center', padding: '24px', color: 'var(--green)' }}>
                  All transactions are categorized!
                </div>
              )
              : uncategorized.map(tx => (
                <div key={tx.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderBottom: '1px solid var(--bg-raised)', fontSize: 13 }}>
                  <div style={{ flex: 1, color: 'var(--text-primary)' }}>{tx.description}</div>
                  <div style={{ color: 'var(--text-secondary)', fontSize: 12 }}>{tx.date}</div>
                  <div style={{ color: 'var(--red)' }}>{cfmt(tx.amount)}</div>
                  <select
                    value={catEdits[tx.id] || 'Other'}
                    onChange={e => setCatEdits(p => ({ ...p, [tx.id]: e.target.value }))}
                    style={{ fontSize: 12 }}
                  >
                    {allCats.filter(c => !['Transfer', 'Adjustment'].includes(c.name)).map(c => (
                      <option key={c.name} value={c.name}>{c.icon || ''} {c.name}</option>
                    ))}
                  </select>
                </div>
              ))
            }
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
              <button className="btn btn-secondary" onClick={onClose}>Skip</button>
              <button className="btn btn-primary" onClick={handleCatSave}>
                {Object.keys(catEdits).length > 0 ? `Save ${Object.keys(catEdits).length} changes →` : 'Next →'}
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Budget check */}
        {step === 2 && (
          <div>
            {monthBudgets.length === 0
              ? <div style={{ textAlign: 'center', padding: '24px', color: 'var(--text-secondary)' }}>No budgets set for this month.</div>
              : monthBudgets.map(b => {
                  const spent = catSpend[b.category] || 0;
                  const pct   = b.amount > 0 ? spent / b.amount : 0;
                  const color = pct >= 1 ? 'var(--red)' : pct >= 0.8 ? 'var(--amber)' : 'var(--green)';
                  return (
                    <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderBottom: '1px solid var(--bg-raised)', fontSize: 13 }}>
                      <div style={{ flex: 1, color: 'var(--text-primary)' }}>{b.category}</div>
                      <div style={{ color }}>
                        {cfmt(spent)} / {cfmt(b.amount)}
                        <span style={{ marginLeft: 8, fontSize: 11, opacity: 0.7 }}>{(pct * 100).toFixed(0)}%</span>
                      </div>
                      {pct >= 1 && (
                        <span style={{ fontSize: 11, background: '#c2735a22', color: 'var(--red)', padding: '2px 6px', borderRadius: 4 }}>Over</span>
                      )}
                      {pct >= 0.8 && pct < 1 && (
                        <span style={{ fontSize: 11, background: '#f59e0b22', color: 'var(--amber)', padding: '2px 6px', borderRadius: 4 }}>Near</span>
                      )}
                    </div>
                  );
                })
            }
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 20 }}>
              <button className="btn btn-secondary" onClick={() => setStep(1)}>← Back</button>
              <button className="btn btn-primary" onClick={() => setStep(3)}>Next →</button>
            </div>
          </div>
        )}

        {/* Step 3: Account balances */}
        {step === 3 && (
          <div>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
              Update balances for investment and asset accounts to reflect current statements.
            </p>
            {accounts.filter(a => ['investment', 'asset'].includes(a.type)).map(a => (
              <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderBottom: '1px solid var(--bg-raised)', fontSize: 13 }}>
                <div style={{ flex: 1, color: 'var(--text-primary)' }}>{a.name}</div>
                <div style={{ color: 'var(--text-secondary)', fontSize: 12 }}>Current: {cfmt(a.balance)}</div>
                <input
                  type="number"
                  step="0.01"
                  placeholder="New balance"
                  value={balanceEdits[a.id] ?? ''}
                  onChange={e => setBalanceEdits(p => ({ ...p, [a.id]: e.target.value }))}
                  style={{ width: 120, fontSize: 12 }}
                />
              </div>
            ))}
            {accounts.filter(a => ['investment', 'asset'].includes(a.type)).length === 0 && (
              <div style={{ textAlign: 'center', padding: '24px', color: 'var(--text-secondary)' }}>No investment or asset accounts found.</div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 20 }}>
              <button className="btn btn-secondary" onClick={() => setStep(2)}>← Back</button>
              <button className="btn btn-primary" onClick={handleBalanceSave}>
                {Object.keys(balanceEdits).length > 0 ? `Save ${Object.keys(balanceEdits).length} balances →` : 'Next →'}
              </button>
            </div>
          </div>
        )}

        {/* Step 4: Summary */}
        {step === 4 && (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 20 }}>
              <div className="stat-card" style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase', marginBottom: 4 }}>Income</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--green)' }}>{cfmt(monthIncome)}</div>
              </div>
              <div className="stat-card" style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase', marginBottom: 4 }}>Spending</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--red)' }}>{cfmt(monthSpend)}</div>
              </div>
              <div className="stat-card" style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase', marginBottom: 4 }}>Net</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: monthIncome - monthSpend >= 0 ? 'var(--green)' : 'var(--red)' }}>
                  {monthIncome - monthSpend >= 0 ? '+' : ''}{cfmt(monthIncome - monthSpend)}
                </div>
              </div>
            </div>
            {nwDelta !== null && (
              <div className="stat-card" style={{ marginBottom: 16, textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase', marginBottom: 4 }}>Net Worth Change vs Last Month</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: nwDelta >= 0 ? 'var(--green)' : 'var(--red)' }}>
                  {nwDelta >= 0 ? '+' : ''}{cfmt(nwDelta)}
                </div>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: 20 }}>
              <button className="btn btn-primary" onClick={onClose}>Done ✓</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
