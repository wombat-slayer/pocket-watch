import { useState, useEffect, useRef } from 'react';
import { CATEGORIES, getAllCategories, today, uid, parseAmount } from '../constants.js';

export default function TransactionForm({ initial, accounts, onSave, onClose, userCategories, existingTransactions }) {
  const [form, setForm] = useState(() => initial ?? {
    date: today(), description: '', amount: '', category: 'Food & Dining',
    account: accounts[0]?.id ?? '', type: 'expense', notes: '', tags: [],
  });
  const [splitMode, setSplitMode] = useState(() => !!(initial?.splits?.length));
  const [splits, setSplits] = useState(() => initial?.splits ?? [
    { id: uid(), category: 'Food & Dining', amount: '', notes: '' },
    { id: uid(), category: 'Other',         amount: '', notes: '' },
  ]);
  const [tagInput, setTagInput] = useState('');
  const descRef = useRef(null);

  // Feature 12: auto-focus description on mount
  useEffect(() => { descRef.current?.focus(); }, []);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const totalAmount = parseAmount(String(form.amount)) || 0;
  const splitTotal  = splits.reduce((s, sp) => s + (parseFloat(sp.amount) || 0), 0);
  const remaining   = Math.abs(totalAmount) - splitTotal;

  const addSplit = () => setSplits(ss => [...ss, { id: uid(), category: 'Food & Dining', amount: '', notes: '' }]);
  const removeSplit = (id) => {
    const next = splits.filter(s => s.id !== id);
    if (next.length === 0) { setSplitMode(false); } else { setSplits(next); }
  };
  const setSplit = (id, k, v) => setSplits(ss => ss.map(s => s.id === id ? { ...s, [k]: v } : s));

  const addTag = (raw) => {
    const tag = raw.trim().slice(0, 30);
    if (!tag) return;
    const existing = form.tags ?? [];
    if (existing.length >= 10 || existing.includes(tag)) return;
    set('tags', [...existing, tag]);
  };

  const removeTag = (t) => set('tags', (form.tags ?? []).filter(x => x !== t));

  const handleTagKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTag(tagInput);
      setTagInput('');
    }
  };

  const handleSave = () => {
    if (!form.description.trim() || !form.amount || !form.date) return;
    const raw = parseAmount(String(form.amount));
    if (isNaN(raw)) return;

    // Soft duplicate check
    if (existingTransactions && existingTransactions.length > 0) {
      const newDate = new Date(form.date);
      const newAmt  = Math.abs(raw);
      const newDesc = form.description.toLowerCase().trim();
      const isDup = existingTransactions.some(ex => {
        if (ex.id && form.id && ex.id === form.id) return false;
        const exDate  = new Date(ex.date);
        const dayDiff = Math.abs((newDate - exDate) / (1000 * 60 * 60 * 24));
        const amtMatch = Math.abs(Math.abs(ex.amount) - newAmt) < 0.01;
        const descSimilar = ex.description.toLowerCase().includes(newDesc.slice(0, 8)) ||
                            newDesc.includes(ex.description.toLowerCase().slice(0, 8));
        return dayDiff <= 2 && amtMatch && descSimilar;
      });
      if (isDup && !window.confirm('This looks similar to an existing transaction. Save anyway?')) return;
    }

    if (splitMode) {
      if (Math.abs(remaining) > 0.01) return; // splits must sum to total
      const cleanSplits = splits.map(({ id, ...sp }) => ({ ...sp, amount: parseFloat(sp.amount) || 0 }));
      const signed = form.type === 'expense' ? -Math.abs(raw) : Math.abs(raw);
      onSave({ ...form, amount: signed, category: 'Split', splits: cleanSplits, id: form.id ?? uid(), tags: form.tags ?? [] });
    } else {
      const signed = form.type === 'expense' ? -Math.abs(raw) : Math.abs(raw);
      onSave({ ...form, amount: signed, id: form.id ?? uid(), splits: undefined, tags: form.tags ?? [] });
    }
  };

  // Feature 12: Enter = submit, Escape = close
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && e.target.tagName !== 'SELECT' && e.target.tagName !== 'TEXTAREA') {
      e.preventDefault();
      handleSave();
    }
    if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  };

  const allCats     = getAllCategories(userCategories);
  const expenseCats = allCats.filter(c => !['Income','Split','Transfer','Adjustment'].includes(c.name));
  const incomeCats  = allCats.filter(c => c.name === 'Income' || c.name === 'Other');

  return (
    <div className="form-grid" style={{ gap:14 }} onKeyDown={handleKeyDown}>
      <div className="tab-group" style={{ marginBottom:4 }}>
        {['expense','income'].map(t => (
          <div key={t} className={`tab${form.type===t?' active':''}`}
            onClick={() => { set('type',t); set('category', t==='income'?'Income':'Food & Dining'); }}>
            {t==='expense'?'💸 Expense':'💰 Income'}
          </div>
        ))}
      </div>
      <div className="form-grid form-grid-2">
        <div className="form-group">
          <label className="form-label">Date</label>
          <input type="date" value={form.date} onChange={e => set('date', e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">Amount ($)</label>
          <input type="number" min="0" step="0.01" placeholder="0.00" value={form.amount} onChange={e => set('amount', e.target.value)} />
        </div>
      </div>
      <div className="form-group">
        <label className="form-label">Description</label>
        <input ref={descRef} type="text" placeholder="e.g. Grocery run" value={form.description} onChange={e => set('description', e.target.value)} />
      </div>

      {/* Category or Split toggle */}
      {!splitMode ? (
        <div className="form-grid form-grid-2">
          <div className="form-group">
            <label className="form-label">Category</label>
            <select value={form.category} onChange={e => set('category', e.target.value)}>
              {(form.type==='income' ? incomeCats : expenseCats).map(c => (
                <option key={c.name} value={c.name}>{c.icon} {c.name}</option>
              ))}
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
      ) : (
        <div className="form-group">
          <label className="form-label">Account</label>
          <select value={form.account} onChange={e => set('account', e.target.value)}>
            <option value="">— None —</option>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
      )}

      {/* Split toggle button */}
      {form.type === 'expense' && (
        <div>
          <button type="button" className="btn btn-ghost btn-sm" style={{ fontSize:12 }}
            onClick={() => setSplitMode(m => !m)}>
            {splitMode ? '✕ Cancel Split' : '🔀 Split transaction'}
          </button>
        </div>
      )}

      {/* Split rows */}
      {splitMode && (
        <div style={{ background:'#0d1117', borderRadius:8, padding:12, display:'flex', flexDirection:'column', gap:8 }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:4 }}>
            <span style={{ fontSize:13, fontWeight:600, color:'#94a3b8' }}>Split Categories</span>
            <span style={{ fontSize:12, color: Math.abs(remaining) <= 0.01 ? '#4ade80' : '#c2735a' }}>
              Remaining: ${remaining.toFixed(2)}
            </span>
          </div>
          {splits.map((sp, i) => (
            <div key={sp.id} style={{ display:'grid', gridTemplateColumns:'1fr auto auto auto', gap:6, alignItems:'center' }}>
              <select value={sp.category} onChange={e => setSplit(sp.id, 'category', e.target.value)}
                style={{ fontSize:13 }}>
                {expenseCats.map(c => <option key={c.name} value={c.name}>{c.icon} {c.name}</option>)}
              </select>
              <input type="number" min="0" step="0.01" placeholder="0.00" value={sp.amount}
                onChange={e => setSplit(sp.id, 'amount', e.target.value)}
                style={{ width:90, fontSize:13 }} />
              <input type="text" placeholder="Notes" value={sp.notes}
                onChange={e => setSplit(sp.id, 'notes', e.target.value)}
                style={{ width:100, fontSize:13 }} />
              <button type="button" className="btn btn-ghost btn-sm" style={{ color:'#c2735a', padding:'4px 6px' }}
                onClick={() => removeSplit(sp.id)}>✕</button>
            </div>
          ))}
          <button type="button" className="btn btn-ghost btn-sm" style={{ alignSelf:'flex-start', fontSize:12 }}
            onClick={addSplit}>+ Add Split</button>
          <div style={{ fontSize:12, color:'#64748b', borderTop:'1px solid #1e2736', paddingTop:6, marginTop:2 }}>
            Total: ${splitTotal.toFixed(2)} / ${Math.abs(totalAmount).toFixed(2)}
            {Math.abs(remaining) <= 0.01 && <span style={{ color:'#4ade80', marginLeft:8 }}>✓ Balanced</span>}
          </div>
        </div>
      )}

      <div className="form-group">
        <label className="form-label">Notes (optional)</label>
        <input type="text" placeholder="Any notes..." value={form.notes} onChange={e => set('notes', e.target.value)} />
      </div>

      {/* Tags */}
      <div className="form-group">
        <label className="form-label">Tags (optional)</label>
        <div style={{ display:'flex', flexWrap:'wrap', gap:4, marginBottom:4 }}>
          {(form.tags ?? []).map(t => (
            <span key={t} style={{ fontSize:11, background:'#1e2736', color:'#94a3b8', padding:'2px 8px', borderRadius:20, display:'flex', alignItems:'center', gap:4 }}>
              {t}
              <button type="button" onClick={() => removeTag(t)} style={{ background:'none', border:'none', color:'#64748b', cursor:'pointer', padding:0, fontSize:12 }}>✕</button>
            </span>
          ))}
        </div>
        <input type="text" placeholder="Type tag + Enter or comma"
          value={tagInput} onChange={e => setTagInput(e.target.value)}
          onKeyDown={handleTagKeyDown}
          onBlur={() => { if (tagInput.trim()) { addTag(tagInput); setTagInput(''); } }} />
      </div>

      <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:4 }}>
        <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={handleSave}
          disabled={splitMode && Math.abs(remaining) > 0.01}
          title={splitMode && Math.abs(remaining) > 0.01 ? `Splits must sum to total (off by $${Math.abs(remaining).toFixed(2)})` : ''}>
          Save Transaction
        </button>
      </div>
    </div>
  );
}
