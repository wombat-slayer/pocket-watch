import { useState } from 'react';
import { today, parseAmount, fmt } from '../constants.js';

export default function AdjustmentForm({ accounts, onSave, onClose }) {
  const [acctId,     setAcctId]     = useState(accounts[0]?.id ?? '');
  const [newBalance, setNewBalance] = useState('');
  const [date,       setDate]       = useState(today());
  const [notes,      setNotes]      = useState('');

  if (accounts.length === 0) return (
    <p style={{ color: '#64748b', padding: '16px 0' }}>No accounts found. Add an account first.</p>
  );

  const acct   = accounts.find(a => a.id === acctId);
  const parsed = parseAmount(String(newBalance));
  const delta  = !isNaN(parsed) && acct ? parsed - acct.balance : null;

  const handleSave = () => {
    if (!acctId || isNaN(parsed) || newBalance === '') return;
    onSave(acctId, parsed, date, notes);
  };

  return (
    <div className="form-grid" style={{ gap: 14 }}>
      <div className="form-group">
        <label className="form-label">Account</label>
        <select value={acctId} onChange={e => setAcctId(e.target.value)}>
          {accounts.map(a => (
            <option key={a.id} value={a.id}>{a.name} (current: {fmt(a.balance)})</option>
          ))}
        </select>
      </div>
      <div className="form-grid form-grid-2">
        <div className="form-group">
          <label className="form-label">New Balance ($)</label>
          <input type="number" step="0.01" placeholder="0.00" value={newBalance}
            onChange={e => setNewBalance(e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">As of Date</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} />
        </div>
      </div>
      {delta !== null && (
        <div style={{ fontSize: 13, padding: '8px 12px', borderRadius: 8, background: '#1e2736',
          color: delta >= 0 ? '#4ade80' : '#c2735a' }}>
          {delta >= 0 ? '▲' : '▼'} Change: {delta >= 0 ? '+' : ''}{fmt(delta)} from current {fmt(acct?.balance ?? 0)}
        </div>
      )}
      <div className="form-group">
        <label className="form-label">Notes (optional)</label>
        <input type="text" placeholder="e.g. Q1 2026 statement" value={notes}
          onChange={e => setNotes(e.target.value)} />
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={handleSave}
          disabled={!acctId || isNaN(parsed) || newBalance === ""}>Save Adjustment</button>
      </div>
    </div>
  );
}
