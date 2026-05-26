import { useState, useRef } from 'react';
import { autoCategory, sanitizeText, today, uid } from '../constants.js';
import { useCategoryMemory } from '../hooks/useCategoryMemory.js';

// Parse natural-language quick entry: "Netflix $15.99", "$4,200 rent", "-50 gas"
function parseQuickInput(raw) {
  const text = raw.trim();
  if (!text) return null;

  // Match an amount token: optional $, optional sign, digits, optional decimal
  const amtMatch = text.match(/(-?\$?[\d,]+\.?\d{0,2})/);
  if (!amtMatch) return null;

  const rawAmt = parseFloat(amtMatch[1].replace(/[$,]/g, ''));
  if (isNaN(rawAmt) || rawAmt === 0) return null;

  // Remove the amount token to get the description
  const desc = text.replace(amtMatch[0], '').trim().replace(/\s+/g, ' ') || 'Transaction';

  // Positive if explicitly negative amount given, or income keywords present
  const incomePattern = /salary|paycheck|income|deposit|refund|reimbursement|payroll|dividend|interest earned/i;
  const isIncome = incomePattern.test(desc) || rawAmt > 0 && /^\$?[\d,.]+/.test(text.trimStart()) === false;
  // Rule: if user typed a bare positive number with income words → positive; otherwise expense (negative)
  const amount = incomePattern.test(desc) ? Math.abs(rawAmt) : -Math.abs(rawAmt);

  return { desc: sanitizeText(desc, 100), amount };
}

export default function QuickAddBar({ accounts, onAdd, onOpenFull }) {
  const [value,   setValue]   = useState('');
  const [acctId,  setAcctId]  = useState('');
  const [flash,   setFlash]   = useState(false);
  const inputRef = useRef(null);
  const { suggest } = useCategoryMemory();

  // Prefer non-investment accounts as default
  const spendableAccts = accounts.filter(a => a.type !== 'investment');
  const allAccts       = spendableAccts.length ? spendableAccts : accounts;
  const effectiveAcct  = acctId || allAccts[0]?.id || '';

  const handleSubmit = () => {
    const parsed = parseQuickInput(value);
    if (!parsed || !effectiveAcct) return;
    const category = suggest(parsed.desc) || autoCategory(parsed.desc, parsed.amount);
    onAdd({
      id:          uid(),
      date:        today(),
      description: parsed.desc,
      amount:      parsed.amount,
      category,
      account:     effectiveAcct,
      type:        parsed.amount >= 0 ? 'income' : 'expense',
      notes:       '',
      tags:        [],
      cleared:     false,
    });
    setValue('');
    setFlash(true);
    setTimeout(() => setFlash(false), 1500);
    inputRef.current?.focus();
  };

  const handleKey = (e) => {
    if (e.key === 'Enter')  { e.preventDefault(); handleSubmit(); }
    if (e.key === 'Escape') { setValue(''); inputRef.current?.blur(); }
  };

  const parsed = value ? parseQuickInput(value) : null;

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
      {/* Label row */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <span style={{ fontSize:11, color:'#475569', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.06em' }}>Quick Add</span>
        {flash
          ? <span style={{ fontSize:10, color:'#4ade80', fontWeight:600 }}>✓ Added!</span>
          : <button
              style={{ background:'none', border:'none', color:'#475569', cursor:'pointer', fontSize:10, padding:0 }}
              onClick={onOpenFull}
              title="Open full transaction form"
            >full form →</button>
        }
      </div>

      {/* Smart input */}
      <div style={{ position:'relative' }}>
        <input
          ref={inputRef}
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={handleKey}
          placeholder='"Netflix $15.99" or "Rent $1,200"'
          style={{
            width:'100%', boxSizing:'border-box',
            padding:'7px 48px 7px 10px', fontSize:12,
            background: flash ? '#0a2010' : '#0d1117',
            border:`1px solid ${flash ? '#4ade80' : '#1e2736'}`,
            borderRadius:7, color:'#e2e8f0',
            outline:'none', transition:'border-color 0.2s, background 0.3s',
          }}
        />
        {parsed && (
          <span style={{
            position:'absolute', right:8, top:'50%', transform:'translateY(-50%)',
            fontSize:11, fontWeight:700, pointerEvents:'none',
            color: parsed.amount >= 0 ? '#4ade80' : '#c2735a',
          }}>
            {parsed.amount >= 0 ? '+' : ''}{Math.abs(parsed.amount).toFixed(2)}
          </span>
        )}
      </div>

      {/* Account selector (only if >1 account) */}
      {allAccts.length > 1 && (
        <select
          value={effectiveAcct}
          onChange={e => setAcctId(e.target.value)}
          style={{ fontSize:11, padding:'4px 6px', background:'#0d1117', border:'1px solid #1e2736', borderRadius:6, color:'#94a3b8' }}
        >
          {allAccts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      )}

      {/* Add button */}
      <button
        className="btn btn-primary"
        style={{ justifyContent:'center', fontSize:12, padding:'6px 0', opacity: parsed ? 1 : 0.45, cursor: parsed ? 'pointer' : 'not-allowed' }}
        onClick={handleSubmit}
        disabled={!parsed}
        title="Add (Enter)"
      >
        + Add Transaction
      </button>
    </div>
  );
}
