import { useState, useMemo } from 'react';
import { monthlyEquivalent, getAllCategories, FREQUENCIES, catIcon, fmt, fmtDate, today, uid, parseAmount, getNextRecurDate, freqLabel } from '../constants.js';
import Modal from './Modal.jsx';

// ─── Form ─────────────────────────────────────────────────────────────────────
function RecurringForm({ initial, accounts, onSave, onClose, userCategories }) {
  const [form, setForm] = useState(() => initial ?? {
    description: '', amount: '', type: 'expense',
    category: 'Housing', account: accounts[0]?.id ?? '',
    frequency: 'monthly', startDate: today(), notes: '',
  });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = () => {
    if (!form.description.trim() || !form.amount || !form.startDate) return;
    const raw = parseAmount(String(form.amount));
    if (isNaN(raw) || raw <= 0) return;
    const signed = form.type === 'expense' ? -Math.abs(raw) : Math.abs(raw);
    onSave({ ...form, amount: signed, id: form.id ?? uid(), active: form.active ?? true, lastGenerated: form.lastGenerated ?? null });
  };

  return (
    <div className="form-grid" style={{ gap: 14 }}>
      <div className="tab-group" style={{ marginBottom: 4 }}>
        {['expense', 'income'].map(t => (
          <div key={t} className={`tab${form.type === t ? ' active' : ''}`}
            onClick={() => { set('type', t); set('category', t === 'income' ? 'Income' : 'Housing'); }}>
            {t === 'expense' ? '💸 Expense' : '💰 Income'}
          </div>
        ))}
      </div>

      <div className="form-group">
        <label className="form-label">Description</label>
        <input type="text" placeholder="e.g. Monthly Rent" value={form.description}
          onChange={e => set('description', e.target.value)} />
      </div>

      <div className="form-grid form-grid-2">
        <div className="form-group">
          <label className="form-label">Amount ($)</label>
          <input type="number" min="0" step="0.01" placeholder="0.00" value={form.amount}
            onChange={e => set('amount', e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">Frequency</label>
          <select value={form.frequency} onChange={e => set('frequency', e.target.value)}>
            {FREQUENCIES.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        </div>
      </div>

      <div className="form-grid form-grid-2">
        <div className="form-group">
          <label className="form-label">Category</label>
          <select value={form.category} onChange={e => set('category', e.target.value)}>
            {getAllCategories(userCategories)
              .filter(c => form.type === 'income' ? (c.name === 'Income' || c.name === 'Other') : c.name !== 'Income')
              .map(c => <option key={c.name} value={c.name}>{c.icon} {c.name}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Account</label>
          <select value={form.account} onChange={e => set('account', e.target.value)}>
            <option value="">— None —</option>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
      </div>

      <div className="form-group">
        <label className="form-label">Start Date</label>
        <input type="date" value={form.startDate} onChange={e => set('startDate', e.target.value)} />
      </div>

      <div className="form-group">
        <label className="form-label">Notes (optional)</label>
        <input type="text" placeholder="Any notes…" value={form.notes}
          onChange={e => set('notes', e.target.value)} />
      </div>

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
        <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={handleSave}>
          {initial ? 'Save Changes' : 'Add Rule'}
        </button>
      </div>
    </div>
  );
}

// ─── Next-due badge ───────────────────────────────────────────────────────────
function NextDueBadge({ recurrence }) {
  const todayStr = today();
  const next = recurrence.lastGenerated
    ? getNextRecurDate(recurrence.lastGenerated, recurrence.frequency)
    : recurrence.startDate;

  if (!recurrence.active) return <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Paused</span>;

  const daysUntil = Math.ceil((new Date(next + 'T00:00:00') - new Date()) / 86400000);
  const overdue   = next < todayStr;
  const soon      = daysUntil <= 3;

  return (
    <span style={{
      fontSize: 12, fontWeight: 600, padding: '2px 8px', borderRadius: 20,
      background: overdue ? '#c2735a22' : soon ? '#f59e0b22' : 'var(--bg-raised)',
      color: overdue ? 'var(--red)' : soon ? 'var(--amber)' : 'var(--text-secondary)',
    }}>
      {overdue ? `Overdue ${fmtDate(next)}` : daysUntil === 0 ? 'Due today' : `Due ${fmtDate(next)}`}
    </span>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function Recurring({ recurrences, accounts, onAdd, onEdit, onDelete, onToggle, userCategories, transactions, embedded = false }) {
  const [showAdd, setShowAdd] = useState(false);
  const [editRec, setEditRec] = useState(null);
  const [suggestionPrefill, setSuggestionPrefill] = useState(null);

  const recurSuggestions = useMemo(() => {
    if (!transactions || transactions.length < 30) return [];

    // Group expense transactions by normalized description
    const groups = {};
    transactions
      .filter(t => t.type === 'expense' && t.date)
      .forEach(t => {
        const key = t.description.toLowerCase().trim().slice(0, 35);
        if (!groups[key]) groups[key] = [];
        groups[key].push(t);
      });

    const suggestions = [];
    Object.entries(groups).forEach(([key, txs]) => {
      if (txs.length < 3) return; // Need at least 3 occurrences

      // Check if amounts are consistent (within 5%)
      const amounts = txs.map(t => Math.abs(t.amount));
      const avgAmt = amounts.reduce((s, a) => s + a, 0) / amounts.length;
      if (avgAmt === 0) return;
      const consistent = amounts.every(a => Math.abs(a - avgAmt) / avgAmt < 0.05);
      if (!consistent) return;

      // Check if dates are roughly periodic
      const dates = txs.map(t => new Date(t.date)).sort((a, b) => a - b);
      const gaps = [];
      for (let i = 1; i < dates.length; i++) {
        gaps.push((dates[i] - dates[i-1]) / (1000 * 60 * 60 * 24));
      }
      const avgGap = gaps.reduce((s, g) => s + g, 0) / gaps.length;
      const gapConsistent = gaps.every(g => Math.abs(g - avgGap) < 10);
      if (!gapConsistent) return;

      // Determine frequency
      let frequency = null;
      if (avgGap >= 25 && avgGap <= 35) frequency = 'monthly';
      else if (avgGap >= 82 && avgGap <= 98) frequency = 'quarterly';
      else if (avgGap >= 6 && avgGap <= 9) frequency = 'weekly';
      if (!frequency) return;

      // Skip if already has a recurring rule
      const alreadyExists = recurrences.some(r =>
        r.description.toLowerCase().includes(key.slice(0, 12)) ||
        key.includes(r.description.toLowerCase().slice(0, 12))
      );
      if (alreadyExists) return;

      suggestions.push({
        description: txs[0].description,
        amount: -Math.abs(avgAmt),
        category: txs[0].category,
        account: txs[0].account,
        frequency,
        occurrences: txs.length,
        lastDate: dates[dates.length - 1].toISOString().slice(0, 10),
      });
    });

    return suggestions.slice(0, 5); // Cap at 5 suggestions
  }, [transactions, recurrences]);

  const active   = recurrences.filter(r => r.active).length;

  const expenses = recurrences
    .filter(r => r.active && r.type === 'expense')
    .reduce((s, r) => s + Math.abs(monthlyEquivalent(r)), 0);

  const income = recurrences
    .filter(r => r.active && r.type === 'income')
    .reduce((s, r) => s + Math.abs(monthlyEquivalent(r)), 0);

  return (
    <div className={embedded ? '' : 'fade-in'} style={{ padding: embedded ? 0 : '24px 28px' }}>
      {recurSuggestions.length > 0 && (
        <div className="card" style={{ marginBottom: 16, borderLeft: '3px solid var(--green)' }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 10, color: 'var(--green)' }}>
            💡 Detected recurring patterns — want to add rules?
          </div>
          {recurSuggestions.map((s, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '6px 0', borderBottom: '1px solid var(--bg-raised)', fontSize: 13 }}>
              <div style={{ flex: 1 }}>
                <span style={{ color: 'var(--text-primary)' }}>{s.description}</span>
                <span style={{ color: 'var(--text-secondary)', marginLeft: 8 }}>{s.frequency} · {s.occurrences}× seen</span>
              </div>
              <span style={{ color: 'var(--red)' }}>~${Math.abs(s.amount).toFixed(2)}</span>
              <button className="btn btn-sm btn-secondary" onClick={() => {
                setShowAdd(true);
                setSuggestionPrefill(s);
              }}>+ Add Rule</button>
            </div>
          ))}
        </div>
      )}

      <div className="section-header">
        <div>
          <div className="section-title">Recurring</div>
          <div className="section-sub">Auto-generate transactions on a schedule</div>
        </div>
        <button className="btn btn-primary" onClick={() => setShowAdd(true)}>+ Add Rule</button>
      </div>

      {/* Summary cards */}
      {recurrences.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14, marginBottom: 20 }}>
          <div className="stat-card">
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Active Rules</div>
            <div className="hero-num" style={{ fontSize: 28, fontWeight: 400, color: 'var(--text-primary)' }}>{active}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{recurrences.length} total</div>
          </div>
          <div className="stat-card">
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Monthly Expenses</div>
            <div className="hero-num" style={{ fontSize: 28, fontWeight: 400, color: 'var(--red)' }}>{fmt(expenses)}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>estimated / month</div>
          </div>
          <div className="stat-card">
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Monthly Income</div>
            <div className="hero-num" style={{ fontSize: 28, fontWeight: 400, color: 'var(--green)' }}>{fmt(income)}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>estimated / month</div>
          </div>
        </div>
      )}

      {/* Rules list */}
      {recurrences.length === 0
        ? (
          <div className="card">
            <div className="empty-state">
              <div className="empty-icon">🔁</div>
              <p>No recurring rules yet.</p>
              <p style={{ fontSize: 13, marginTop: 6 }}>Set up rent, subscriptions, and salary to auto-generate each period.</p>
              <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => setShowAdd(true)}>+ Add First Rule</button>
            </div>
          </div>
        )
        : recurrences.map(r => (
          <div key={r.id} className="card-sm" style={{
            marginBottom: 10,
            display: 'flex', alignItems: 'center', gap: 14,
            opacity: r.active ? 1 : 0.55,
          }}>
            {/* Icon */}
            <div style={{
              width: 44, height: 44, borderRadius: 10, flexShrink: 0,
              background: r.amount >= 0 ? '#4ade8018' : '#c2735a18',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20,
            }}>
              {catIcon(r.category)}
            </div>

            {/* Info */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>{r.description}</span>
                <span style={{
                  fontSize: 11, fontWeight: 600, padding: '2px 7px', borderRadius: 20,
                  background: 'var(--bg-raised)', color: 'var(--text-secondary)',
                }}>{freqLabel(r.frequency)}</span>
                <NextDueBadge recurrence={r} />
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>
                {r.category}
                {r.lastGenerated && ` · Last generated ${fmtDate(r.lastGenerated)}`}
                {r.notes && ` · ${r.notes}`}
              </div>
            </div>

            {/* Amount */}
            <div style={{
              fontSize: 17, fontWeight: 700,
              color: r.amount >= 0 ? 'var(--green)' : 'var(--red)',
              whiteSpace: 'nowrap', marginRight: 8,
            }}>
              {r.amount >= 0 ? '+' : ''}{fmt(r.amount)}
            </div>

            {/* Controls */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              {/* Active toggle */}
              <button
                className={`btn btn-sm ${r.active ? 'btn-secondary' : 'btn-ghost'}`}
                style={{ fontSize: 12, padding: '4px 10px' }}
                onClick={() => onToggle(r.id)}
                title={r.active ? 'Pause rule' : 'Resume rule'}
              >
                {r.active ? '⏸ Pause' : '▶ Resume'}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setEditRec(r)} title="Edit">✏️</button>
              <button className="btn btn-ghost btn-sm" style={{ color: 'var(--red)' }}
                onClick={() => { if (confirm(`Delete "${r.description}"?`)) onDelete(r.id); }} title="Delete">🗑</button>
            </div>
          </div>
        ))
      }

      {/* How it works note */}
      {recurrences.length > 0 && (
        <div style={{ marginTop: 16, fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.6 }}>
          🔁 Transactions are auto-generated when you open the app. Past-due entries are created automatically.<br />
          <span style={{ color: 'var(--text-muted)' }}>
            If you manually delete a generated transaction, it will not be regenerated — the rule remembers the last date it ran.
            To force a regeneration, edit the rule and clear its start date.
          </span>
        </div>
      )}

      {showAdd && (
        <Modal title="Add Recurring Rule" onClose={() => { setShowAdd(false); setSuggestionPrefill(null); }}>
          <RecurringForm accounts={accounts}
            initial={suggestionPrefill ? {
              description: suggestionPrefill.description,
              amount: Math.abs(suggestionPrefill.amount).toString(),
              type: 'expense',
              category: suggestionPrefill.category || 'Housing',
              account: suggestionPrefill.account || accounts[0]?.id || '',
              frequency: suggestionPrefill.frequency || 'monthly',
              startDate: suggestionPrefill.lastDate || today(),
              notes: '',
            } : undefined}
            onSave={r => { onAdd(r); setShowAdd(false); setSuggestionPrefill(null); }}
            onClose={() => { setShowAdd(false); setSuggestionPrefill(null); }}
            userCategories={userCategories} />
        </Modal>
      )}
      {editRec && (
        <Modal title="Edit Recurring Rule" onClose={() => setEditRec(null)}>
          <RecurringForm initial={{ ...editRec, amount: Math.abs(editRec.amount).toString() }}
            accounts={accounts}
            onSave={r => { onEdit(r); setEditRec(null); }}
            onClose={() => setEditRec(null)}
            userCategories={userCategories} />
        </Modal>
      )}
    </div>
  );
}
