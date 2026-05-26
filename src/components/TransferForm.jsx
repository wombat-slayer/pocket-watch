import { useState } from 'react';
import { today, uid, parseAmount } from '../constants.js';

export default function TransferForm({ accounts, onSave, onClose }) {
  const [form, setForm] = useState({
    fromAccount: accounts[0]?.id ?? '',
    toAccount:   accounts[1]?.id ?? '',
    amount: '',
    date: today(),
    notes: '',
  });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = () => {
    if (!form.fromAccount || !form.toAccount || form.fromAccount === form.toAccount) return;
    const raw = parseAmount(String(form.amount));
    if (isNaN(raw) || raw <= 0) return;

    const sharedId = uid();
    const fromAcct = accounts.find(a => a.id === form.fromAccount);
    const toAcct   = accounts.find(a => a.id === form.toAccount);

    const tx1 = {
      id: uid(),
      date: form.date,
      description: `Transfer to ${toAcct?.name ?? 'account'}`,
      amount: -Math.abs(raw),
      category: 'Transfer',
      account: form.fromAccount,
      type: 'expense',
      notes: form.notes,
      transferId: sharedId,
      transferDirection: 'out',
      tags: [],
    };
    const tx2 = {
      id: uid(),
      date: form.date,
      description: `Transfer from ${fromAcct?.name ?? 'account'}`,
      amount: +Math.abs(raw),
      category: 'Transfer',
      account: form.toAccount,
      type: 'income',
      notes: form.notes,
      transferId: sharedId,
      transferDirection: 'in',
      tags: [],
    };
    onSave(tx1, tx2);
  };

  return (
    <div className="form-grid" style={{ gap:14 }}>
      <div className="form-grid form-grid-2">
        <div className="form-group">
          <label className="form-label">From Account</label>
          <select value={form.fromAccount} onChange={e => set('fromAccount', e.target.value)}>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">To Account</label>
          <select value={form.toAccount} onChange={e => set('toAccount', e.target.value)}>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
      </div>
      {form.fromAccount === form.toAccount && (
        <div style={{ fontSize:12, color:'#c2735a' }}>⚠️ From and To accounts must be different.</div>
      )}
      <div className="form-grid form-grid-2">
        <div className="form-group">
          <label className="form-label">Amount ($)</label>
          <input type="number" min="0.01" step="0.01" placeholder="0.00"
            value={form.amount} onChange={e => set('amount', e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">Date</label>
          <input type="date" value={form.date} onChange={e => set('date', e.target.value)} />
        </div>
      </div>
      <div className="form-group">
        <label className="form-label">Notes (optional)</label>
        <input type="text" placeholder="e.g. Monthly savings transfer"
          value={form.notes} onChange={e => set('notes', e.target.value)} />
      </div>
      <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:4 }}>
        <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={handleSave}
          disabled={!form.amount || form.fromAccount === form.toAccount}>
          ↔️ Create Transfer
        </button>
      </div>
    </div>
  );
}
