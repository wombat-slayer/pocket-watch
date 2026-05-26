import { useState } from 'react';
import { CATEGORIES, uid, fmt, fmtDate, parseCSVLine, parseAmount, autoCategory } from '../constants.js';
import { useCategoryMemory } from '../hooks/useCategoryMemory.js';

const CSV_PRESETS = {
  'auto':        { label: 'Auto-detect',       dateCol: null,               descCol: null,          amountCol: null,   debitCol: null,   creditCol: null },
  'chase':       { label: 'Chase Bank',        dateCol: 'Transaction Date', descCol: 'Description', amountCol: 'Amount',   flip: true },
  'bofa':        { label: 'Bank of America',   dateCol: 'Date',             descCol: 'Description', amountCol: 'Amount',   flip: false },
  'amex':        { label: 'American Express',  dateCol: 'Date',             descCol: 'Description', amountCol: 'Amount',   flip: true },
  'capital-one': { label: 'Capital One',       dateCol: 'Transaction Date', descCol: 'Description', debitCol: 'Debit', creditCol: 'Credit' },
  'discover':    { label: 'Discover',          dateCol: 'Trans. Date',      descCol: 'Description', amountCol: 'Amount',   flip: true },
  'wells-fargo': { label: 'Wells Fargo',       dateCol: 'Date',             descCol: 'Description', amountCol: 'Amount',   flip: false },
  'generic':     { label: 'Generic CSV',       dateCol: 'Date',             descCol: 'Description', amountCol: 'Amount',   flip: false },
};

const findDuplicates = (newTxs, existingTxs) => {
  return newTxs.map(newTx => {
    const newDate = new Date(newTx.date);
    const newAmt  = Math.abs(newTx.amount);
    const newDesc = newTx.description.toLowerCase().trim();

    const isDup = existingTxs.some(ex => {
      const exDate  = new Date(ex.date);
      const dayDiff = Math.abs((newDate - exDate) / (1000 * 60 * 60 * 24));
      const amtMatch = Math.abs(Math.abs(ex.amount) - newAmt) < 0.01;
      const exWords  = ex.description.toLowerCase().trim().split(/\s+/);
      const newWords = newDesc.split(/\s+/);
      const overlap  = newWords.filter(w => w.length > 2 && exWords.some(ew => ew.includes(w) || w.includes(ew))).length;
      const descSimilar = newWords.length > 0 && overlap / newWords.length > 0.6;
      return dayDiff <= 2 && amtMatch && descSimilar;
    });

    return { ...newTx, _isDuplicate: isDup };
  });
};

export default function CSVImport({ accounts, existingTxs, onImport, onClose }) {
  const [step,      setStep]      = useState('upload');
  const [rows,      setRows]      = useState([]);
  const [error,     setError]     = useState('');
  const [ucIdx,     setUcIdx]     = useState(0);
  const [csvPreset, setCsvPreset] = useState('auto');
  const [skipDups,  setSkipDups]  = useState(true);

  const { suggest } = useCategoryMemory(existingTxs || []);

  const dupCount = rows.filter(r => r._isDuplicate).length;

  const handleFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setError('');
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = importCSV(ev.target.result, csvPreset);
        if (!parsed.length) { setError('Could not parse CSV. Ensure it has Date, Description, and Amount columns.'); return; }
        const withDups = findDuplicates(parsed, existingTxs ?? []);
        setRows(withDups);
        setStep('review-all');
      } catch (err) { setError('Error reading file: ' + err.message); }
    };
    reader.readAsText(file);
  };

  const importCSV = (text, preset) => {
    const lines = text.trim().split(/\r?\n/);
    if (lines.length < 2) return [];
    const rawHeaders = parseCSVLine(lines[0]);
    const headers    = rawHeaders.map(h => h.toLowerCase().trim());

    let dateIdx, descIdx, amtIdx, creditIdx, debitIdx, flip;

    if (!preset || preset === 'auto') {
      const col = (...names) => {
        for (const n of names) {
          const i = headers.findIndex(h => h.includes(n.toLowerCase()));
          if (i >= 0) return i;
        }
        return -1;
      };
      dateIdx   = col('date', 'posted', 'transaction date', 'trans date');
      descIdx   = col('description', 'merchant', 'payee', 'memo', 'name', 'details');
      amtIdx    = col('amount', 'transaction amount');
      creditIdx = col('credit');
      debitIdx  = col('debit');
      flip      = false;
    } else {
      const p = CSV_PRESETS[preset];
      const exactCol = (name) => {
        if (name == null) return -1;
        return rawHeaders.findIndex(h => h.trim().toLowerCase() === name.toLowerCase());
      };
      dateIdx   = exactCol(p.dateCol);
      descIdx   = exactCol(p.descCol);
      amtIdx    = p.amountCol  != null ? exactCol(p.amountCol)  : -1;
      creditIdx = p.creditCol  != null ? exactCol(p.creditCol)  : -1;
      debitIdx  = p.debitCol   != null ? exactCol(p.debitCol)   : -1;
      flip      = !!p.flip;
    }

    const result = [];
    for (let i = 1; i < lines.length; i++) {
      const c = parseCSVLine(lines[i]);
      const g = (idx) => idx >= 0 ? (c[idx] ?? '') : '';
      const date = g(dateIdx).replace(/"/g, '');
      const desc = g(descIdx);
      if (!date || !desc) continue;
      let amt;
      if (creditIdx >= 0 && debitIdx >= 0) {
        const cr = parseAmount(g(creditIdx));
        const db = parseAmount(g(debitIdx));
        amt = (!isNaN(cr) && cr !== 0) ? Math.abs(cr) : (!isNaN(db) && db !== 0) ? -Math.abs(db) : 0;
      } else {
        amt = parseAmount(g(amtIdx));
        if (isNaN(amt)) continue;
      }
      if (flip) amt = -amt;
      const memSuggestion = suggest(desc);
      const category = memSuggestion || autoCategory(desc, amt) || 'Other';
      result.push({
        id: uid(), date, description: desc, amount: amt, category,
        account: accounts[0]?.id ?? '', type: amt >= 0 ? 'income' : 'expense', notes: '', _csv: true,
        _memorized: memSuggestion !== null,
      });
    }
    return result;
  };

  const updateRow = (id, key, val) => setRows(rs => rs.map(r => r.id === id ? { ...r, [key]: val } : r));
  const removeRow = (id)           => setRows(rs => rs.filter(r => r.id !== id));
  const uncatRows = rows.filter(r => r.category === 'Other');

  const doImport = () => {
    const toImport = skipDups ? rows.filter(r => !r._isDuplicate) : rows;
    const clean = toImport.map(({ _csv, _isDuplicate, _memorized, ...r }) => r);
    onImport(clean);
  };

  if (step === 'upload') return (
    <div>
      <p style={{ fontSize:13, color:'#64748b', marginBottom:16 }}>
        Supports CSV exports from Chase, Bank of America, Mint, and most major banks.
        Expected columns: <strong style={{ color:'#94a3b8' }}>Date, Description, Amount</strong> (or separate Debit/Credit columns).
      </p>

      <div style={{ marginBottom:16 }}>
        <label style={{ fontSize:13, color:'#94a3b8', display:'block', marginBottom:6 }}>
          Bank Format
        </label>
        <select value={csvPreset} onChange={e => setCsvPreset(e.target.value)} style={{ width:'100%' }}>
          {Object.entries(CSV_PRESETS).map(([key, p]) => (
            <option key={key} value={key}>{p.label}</option>
          ))}
        </select>
        {csvPreset !== 'auto' && (() => {
          const p = CSV_PRESETS[csvPreset];
          const cols = [
            p.dateCol,
            p.descCol,
            p.amountCol ?? (p.debitCol ? (p.debitCol + ' / ' + p.creditCol) : null),
          ].filter(Boolean);
          return (
            <div style={{ fontSize:12, color:'#64748b', marginTop:6 }}>
              {'💡 ' + p.label + ' exports: '}
              <span style={{ color:'#94a3b8' }}>{cols.join(', ')}</span>
              {p.flip && <span style={{ color:'#f59e0b', marginLeft:6 }}>(amounts sign-flipped)</span>}
            </div>
          );
        })()}
      </div>

      <div style={{ border:'2px dashed #2d3a4a', borderRadius:10, padding:'32px 24px', textAlign:'center', marginBottom:12 }}>
        <div style={{ fontSize:32, marginBottom:8 }}>📄</div>
        <p style={{ color:'#94a3b8', marginBottom:12, fontSize:14 }}>Drop your bank CSV or click to browse</p>
        <label className="file-label" htmlFor="csv-file">📂 Choose CSV File</label>
        <input id="csv-file" type="file" accept=".csv,.txt" onChange={handleFile} />
      </div>
      {error && <p style={{ color:'#c2735a', fontSize:13 }}>{error}</p>}
    </div>
  );

  if (step === 'review-all') {
    const importCount = skipDups ? rows.filter(r => !r._isDuplicate).length : rows.length;
    return (
      <div>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 }}>
          <div>
            <span style={{ fontWeight:600, color:'#e2e8f0' }}>{rows.length} transactions found</span>
            {uncatRows.length > 0 && (
              <span style={{ marginLeft:10, fontSize:12, color:'#f59e0b', background:'#f59e0b22', padding:'2px 8px', borderRadius:20 }}>
                ⚠️ {uncatRows.length} uncategorized
              </span>
            )}
            {dupCount > 0 && (
              <span style={{ marginLeft:10, fontSize:12, color:'#c2735a', background:'#c2735a22', padding:'2px 8px', borderRadius:20 }}>
                🔁 {dupCount} possible duplicates
              </span>
            )}
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => setStep('upload')}>← Back</button>
        </div>

        {dupCount > 0 && (
          <div style={{ background:'#f59e0b11', border:'1px solid #f59e0b44', borderRadius:8, padding:'8px 12px', marginBottom:12, display:'flex', alignItems:'center', gap:10 }}>
            <label style={{ display:'flex', alignItems:'center', gap:6, cursor:'pointer', fontSize:13, color:'#e2e8f0' }}>
              <input type="checkbox" checked={skipDups} onChange={e => setSkipDups(e.target.checked)} />
              Skip duplicates
            </label>
            <span style={{ fontSize:12, color:'#f59e0b' }}>
              {dupCount} of {rows.length} rows are likely duplicates and will be {skipDups ? 'skipped' : 'imported'}.
            </span>
          </div>
        )}

        <div style={{ maxHeight:'45vh', overflowY:'auto', marginBottom:16 }}>
          <table>
            <thead><tr>
              <th>Date</th><th>Description</th><th>Category</th><th>Amount</th><th>Account</th><th></th>
            </tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id}
                  className={r._isDuplicate ? 'dup-row' : ''}
                  style={{ background: r._isDuplicate ? '#f59e0b0a' : r.category === 'Other' ? '#f59e0b08' : undefined, opacity: r._isDuplicate && skipDups ? 0.55 : 1 }}>
                  <td><input type="date" value={r.date} onChange={e => updateRow(r.id,'date',e.target.value)} style={{ width:130 }} /></td>
                  <td>
                    <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                      <input type="text" value={r.description} onChange={e => updateRow(r.id,'description',e.target.value)} style={{ minWidth:140 }} />
                      {r._isDuplicate && (
                        <span style={{ fontSize:11, background:'#f59e0b22', color:'#f59e0b', padding:'1px 6px', borderRadius:10, whiteSpace:'nowrap' }}>
                          ⚠ Likely duplicate
                        </span>
                      )}
                    </div>
                  </td>
                  <td>
                    <div style={{ display:'flex', alignItems:'center', gap:5 }}>
                      <select value={r.category} onChange={e => updateRow(r.id,'category',e.target.value)} style={{ minWidth:140 }}>
                        {CATEGORIES.map(c => <option key={c.name} value={c.name}>{c.icon} {c.name}</option>)}
                      </select>
                      {r._memorized && (
                        <span style={{ fontSize:10, background:'#f59e0b22', color:'#f59e0b', padding:'1px 5px', borderRadius:8, whiteSpace:'nowrap', flexShrink:0 }}>
                          💡 auto
                        </span>
                      )}
                    </div>
                  </td>
                  <td style={{ color: r.amount>=0?'#4ade80':'#c2735a', fontWeight:600, whiteSpace:'nowrap' }}>{fmt(r.amount)}</td>
                  <td>
                    <select value={r.account} onChange={e => updateRow(r.id,'account',e.target.value)} style={{ minWidth:120 }}>
                      <option value="">— None —</option>
                      {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  </td>
                  <td><button className="btn btn-ghost btn-sm" onClick={() => removeRow(r.id)} style={{ color:'#c2735a' }}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ display:'flex', gap:8, justifyContent:'space-between', alignItems:'center' }}>
          <div>
            {uncatRows.length > 0 && (
              <button className="btn btn-secondary btn-sm" onClick={() => { setUcIdx(0); setStep('review-uncat'); }}>
                🎯 Quick-fix {uncatRows.length} uncategorized
              </button>
            )}
          </div>
          <div style={{ display:'flex', gap:8 }}>
            <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" onClick={doImport}>Import {importCount} Transactions</button>
          </div>
        </div>
      </div>
    );
  }

  const ucRow = uncatRows[ucIdx];
  if (step === 'review-uncat' && ucRow) return (
    <div style={{ textAlign:'center' }}>
      <p style={{ color:'#94a3b8', fontSize:13, marginBottom:16 }}>
        Quickly categorize uncategorized transactions ({ucIdx+1} of {uncatRows.length})
      </p>
      <div className="card-sm" style={{ marginBottom:20, textAlign:'left' }}>
        <div style={{ fontWeight:600, fontSize:16 }}>{ucRow.description}</div>
        <div style={{ color:'#64748b', fontSize:13, marginTop:4 }}>{fmtDate(ucRow.date)} · <span style={{ color: ucRow.amount>=0?'#4ade80':'#c2735a', fontWeight:600 }}>{fmt(ucRow.amount)}</span></div>
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:16 }}>
        {CATEGORIES.filter(c => c.name !== 'Other').map(c => (
          <button key={c.name} className="btn btn-secondary" style={{ justifyContent:'flex-start', gap:8 }}
            onClick={() => { updateRow(ucRow.id,'category',c.name); if (ucIdx < uncatRows.length-1) setUcIdx(i=>i+1); else setStep('review-all'); }}>
            <span>{c.icon}</span><span>{c.name}</span>
          </button>
        ))}
      </div>
      <div style={{ display:'flex', gap:8, justifyContent:'center' }}>
        <button className="btn btn-ghost btn-sm" onClick={() => { if (ucIdx < uncatRows.length-1) setUcIdx(i=>i+1); else setStep('review-all'); }}>Skip →</button>
        <button className="btn btn-secondary btn-sm" onClick={() => setStep('review-all')}>Back to full list</button>
      </div>
    </div>
  );

  return null;
}
