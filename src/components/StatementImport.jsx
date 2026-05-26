import { useState, useRef } from 'react';
import { autoCategory, parseCSVLine, parseAmount, uid, sanitizeText, safeDate } from '../constants.js';

const fmt = (n) => new Intl.NumberFormat('en-US', { style:'currency', currency:'USD' }).format(n ?? 0);

// ─── OFX / QFX parser ─────────────────────────────────────────────────────────
function parseOFX(text) {
  const txBlocks = text.match(/<STMTTRN>[\s\S]*?<\/STMTTRN>/gi) ?? [];
  return txBlocks.map(block => {
    const dtRaw  = block.match(/<DTPOSTED>(\d{8})/i)?.[1];
    if (!dtRaw) return null;
    const date   = `${dtRaw.slice(0,4)}-${dtRaw.slice(4,6)}-${dtRaw.slice(6,8)}`;
    const rawAmt = block.match(/<TRNAMT>([-\d.]+)/i)?.[1] ?? '';
    const amount = parseFloat(rawAmt);
    if (isNaN(amount)) return null;
    const name   = block.match(/<NAME>([^<\n\r]+)/i)?.[1]?.trim() ?? '';
    const memo   = block.match(/<MEMO>([^<\n\r]+)/i)?.[1]?.trim() ?? '';
    return { date, amount, description: sanitizeText(name || memo || 'Transaction', 200) };
  }).filter(Boolean);
}

// ─── CSV parser ───────────────────────────────────────────────────────────────
// Auto-detects common bank export column layouts
function parseStatementCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase().trim().replace(/['"]/g, ''));

  const dateCol   = headers.findIndex(h => /^date$|posted|trans.*date|settlement/.test(h));
  const descCol   = headers.findIndex(h => /desc|name|memo|payee|narration|detail|merchant|reference/.test(h));
  const amtCol    = headers.findIndex(h => /^amount$|^amt$|^transaction amount$|^net amount$/.test(h));
  const debitCol  = headers.findIndex(h => /debit|withdrawal|charge/.test(h));
  const creditCol = headers.findIndex(h => /credit|deposit/.test(h));

  if (dateCol === -1) return [];

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    if (cols.length < 2) continue;

    const rawDate = cols[dateCol]?.replace(/['"]/g, '').trim() ?? '';
    // Try to parse various date formats → YYYY-MM-DD
    let date = '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
      date = rawDate;
    } else if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(rawDate)) {
      const [m, d, y] = rawDate.split('/');
      date = `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
    } else if (/^\d{1,2}-\d{1,2}-\d{4}$/.test(rawDate)) {
      const [m, d, y] = rawDate.split('-');
      date = `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
    } else {
      date = safeDate(rawDate);
    }

    const description = sanitizeText(
      descCol >= 0 ? (cols[descCol]?.replace(/['"]/g, '').trim() ?? '') : '',
      200
    ) || 'Transaction';

    let amount;
    if (amtCol >= 0) {
      amount = parseAmount(cols[amtCol] ?? '');
    } else if (debitCol >= 0 || creditCol >= 0) {
      const debit  = debitCol  >= 0 ? parseAmount(cols[debitCol]  ?? '') : NaN;
      const credit = creditCol >= 0 ? parseAmount(cols[creditCol] ?? '') : NaN;
      const dAmt = isNaN(debit)  ? 0 : Math.abs(debit);
      const cAmt = isNaN(credit) ? 0 : Math.abs(credit);
      amount = cAmt > 0 ? cAmt : dAmt > 0 ? -dAmt : NaN;
    } else {
      continue;
    }
    if (isNaN(amount)) continue;
    rows.push({ date, amount, description });
  }
  return rows;
}

// ─── Duplicate check ──────────────────────────────────────────────────────────
function isDuplicate(tx, existing) {
  return existing.some(e =>
    e.date === tx.date &&
    Math.abs(e.amount - tx.amount) < 0.01 &&
    e.description.toLowerCase().slice(0, 20) === tx.description.toLowerCase().slice(0, 20)
  );
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function StatementImport({ account, existingTransactions, onImport, onClose }) {
  const [step,     setStep]     = useState('upload'); // upload | preview | done
  const [rows,     setRows]     = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [error,    setError]    = useState('');
  const fileRef = useRef(null);

  const acctTxs = existingTransactions.filter(t => t.account === account.id);

  // ── File handler ──────────────────────────────────────────────────────────
  const handleFile = async (file) => {
    if (!file) return;
    setError('');
    try {
      const text = await file.text();
      let parsed = [];
      const lower = file.name.toLowerCase();
      if (lower.endsWith('.ofx') || lower.endsWith('.qfx') || /<OFX/i.test(text)) {
        parsed = parseOFX(text);
      } else {
        parsed = parseStatementCSV(text);
      }
      if (parsed.length === 0) {
        setError('No transactions found. Ensure the file is a valid CSV, OFX, or QFX bank statement.');
        return;
      }
      const annotated = parsed.map(r => ({
        ...r,
        id:       uid(),
        category: autoCategory(r.description, r.amount),
        isDup:    isDuplicate(r, acctTxs),
      }));
      setRows(annotated);
      // Pre-select all non-duplicates
      setSelected(new Set(annotated.filter(r => !r.isDup).map(r => r.id)));
      setStep('preview');
    } catch (e) {
      setError('Could not read file: ' + String(e?.message ?? e));
    }
  };

  // ── Selection helpers ─────────────────────────────────────────────────────
  const toggleRow = (id) =>
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const nonDupIds = rows.filter(r => !r.isDup).map(r => r.id);
  const toggleAll = () =>
    setSelected(selected.size === nonDupIds.length ? new Set() : new Set(nonDupIds));

  // ── Commit ────────────────────────────────────────────────────────────────
  const handleImport = () => {
    const toImport = rows
      .filter(r => selected.has(r.id))
      .map(r => ({
        id:          r.id,
        date:        r.date,
        description: r.description,
        amount:      r.amount,
        category:    r.category,
        account:     account.id,
        type:        r.amount >= 0 ? 'income' : 'expense',
        notes:       '',
        tags:        [],
        cleared:     false,
      }));
    onImport(toImport);
    setStep('done');
  };

  const selectedRows = rows.filter(r => selected.has(r.id));
  const importTotal  = selectedRows.reduce((s, r) => s + r.amount, 0);
  const newBalance   = account.balance + importTotal;
  const dupCount     = rows.filter(r => r.isDup).length;

  // ── Done screen ───────────────────────────────────────────────────────────
  if (step === 'done') return (
    <div style={{ textAlign:'center', padding:'40px 24px' }}>
      <div style={{ fontSize:48, marginBottom:12 }}>✅</div>
      <div style={{ fontSize:16, fontWeight:700, color:'#e2e8f0', marginBottom:6 }}>Import complete</div>
      <div style={{ fontSize:13, color:'#64748b', marginBottom:28 }}>
        {selectedRows.length} transaction{selectedRows.length !== 1 ? 's' : ''} added to <strong style={{ color:'#94a3b8' }}>{account.name}</strong>
      </div>
      <button className="btn btn-primary" onClick={onClose}>Done</button>
    </div>
  );

  // ── Upload screen ─────────────────────────────────────────────────────────
  if (step === 'upload') return (
    <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
      <p style={{ fontSize:13, color:'#94a3b8', margin:0 }}>
        Import transactions into <strong style={{ color:'#e2e8f0' }}>{account.name}</strong>.
        Supports CSV exports from most banks, plus OFX / QFX files.
      </p>
      <div
        style={{
          border:'2px dashed #2d3748', borderRadius:12, padding:'36px 24px',
          textAlign:'center', cursor:'pointer', transition:'border-color 0.2s',
        }}
        onClick={() => fileRef.current?.click()}
        onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = '#7fa88b'; }}
        onDragLeave={e => { e.currentTarget.style.borderColor = '#2d3748'; }}
        onDrop={e => {
          e.preventDefault();
          e.currentTarget.style.borderColor = '#2d3748';
          handleFile(e.dataTransfer.files[0]);
        }}
      >
        <div style={{ fontSize:40, marginBottom:10 }}>📄</div>
        <div style={{ fontSize:14, fontWeight:600, color:'#e2e8f0', marginBottom:4 }}>
          Drop your statement here
        </div>
        <div style={{ fontSize:12, color:'#64748b' }}>or click to browse · CSV, OFX, QFX</div>
        <input
          ref={fileRef} type="file" accept=".csv,.ofx,.qfx"
          style={{ display:'none' }}
          onChange={e => handleFile(e.target.files[0])}
        />
      </div>
      {error && (
        <div style={{ color:'#c2735a', fontSize:13, background:'#c2735a11', borderRadius:8, padding:'10px 14px' }}>
          ⚠️ {error}
        </div>
      )}
      <div style={{ display:'flex', justifyContent:'flex-end' }}>
        <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
      </div>
    </div>
  );

  // ── Preview screen ────────────────────────────────────────────────────────
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', flexWrap:'wrap', gap:8 }}>
        <div>
          <div style={{ fontSize:14, fontWeight:700, color:'#e2e8f0' }}>{rows.length} transactions found</div>
          <div style={{ fontSize:12, color:'#64748b', marginTop:2 }}>
            Account: <strong style={{ color:'#94a3b8' }}>{account.name}</strong>
            {dupCount > 0 && (
              <span style={{ marginLeft:12, color:'#f59e0b' }}>
                ⚠ {dupCount} likely duplicate{dupCount !== 1 ? 's' : ''} (pre-deselected)
              </span>
            )}
          </div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => setStep('upload')}>← Different file</button>
      </div>

      {/* Table */}
      <div style={{ maxHeight:320, overflowY:'auto', border:'1px solid #1e2736', borderRadius:8 }}>
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
          <thead style={{ position:'sticky', top:0, background:'#161d2b', zIndex:1 }}>
            <tr>
              <th style={{ padding:'8px 10px', textAlign:'left', color:'#64748b', fontWeight:600, borderBottom:'1px solid #1e2736' }}>
                <input
                  type="checkbox"
                  onChange={toggleAll}
                  checked={nonDupIds.length > 0 && selected.size === nonDupIds.length}
                  title="Select all non-duplicates"
                />
              </th>
              {['Date','Description','Category','Amount'].map(h => (
                <th key={h} style={{ padding:'8px 10px', textAlign: h==='Amount'?'right':'left', color:'#64748b', fontWeight:600, borderBottom:'1px solid #1e2736' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr
                key={r.id}
                style={{
                  background: r.isDup ? '#1a1400' : selected.has(r.id) ? '#0a150a' : 'transparent',
                  opacity: r.isDup ? 0.55 : 1,
                }}
              >
                <td style={{ padding:'6px 10px', borderBottom:'1px solid #1e273630' }}>
                  <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleRow(r.id)} />
                </td>
                <td style={{ padding:'6px 10px', color:'#94a3b8', borderBottom:'1px solid #1e273630', whiteSpace:'nowrap' }}>{r.date}</td>
                <td style={{ padding:'6px 10px', color:'#cbd5e1', borderBottom:'1px solid #1e273630', maxWidth:200, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                  {r.description}
                  {r.isDup && <span style={{ marginLeft:6, fontSize:10, color:'#f59e0b', background:'#f59e0b22', borderRadius:4, padding:'1px 5px' }}>DUP</span>}
                </td>
                <td style={{ padding:'6px 10px', color:'#64748b', borderBottom:'1px solid #1e273630' }}>{r.category}</td>
                <td style={{ padding:'6px 10px', textAlign:'right', fontWeight:600, borderBottom:'1px solid #1e273630', whiteSpace:'nowrap', color: r.amount >= 0 ? '#4ade80' : '#c2735a' }}>
                  {r.amount >= 0 ? '+' : ''}{fmt(r.amount)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Summary bar */}
      <div style={{ background:'#0d1117', borderRadius:8, padding:'10px 14px', fontSize:12, display:'flex', gap:20, flexWrap:'wrap', color:'#64748b' }}>
        <span>Selected: <strong style={{ color:'#e2e8f0' }}>{selected.size}</strong></span>
        <span>Net change: <strong style={{ color: importTotal >= 0 ? '#4ade80' : '#c2735a' }}>{importTotal >= 0 ? '+' : ''}{fmt(importTotal)}</strong></span>
        <span>Current balance: <strong style={{ color:'#e2e8f0' }}>{fmt(account.balance)}</strong></span>
        <span>After import: <strong style={{ color: newBalance >= 0 ? '#4ade80' : '#c2735a' }}>{fmt(newBalance)}</strong></span>
      </div>

      {/* Actions */}
      <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
        <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button
          className="btn btn-primary"
          onClick={handleImport}
          disabled={selected.size === 0}
        >
          Import {selected.size} transaction{selected.size !== 1 ? 's' : ''}
        </button>
      </div>
    </div>
  );
}
