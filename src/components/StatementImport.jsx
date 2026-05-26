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
  const debitCol  = headers.findIndex(h => /debit|withdrawal|charge|outflow/.test(h));
  const creditCol = headers.findIndex(h => /credit|deposit|inflow/.test(h));
  // Mint export: "Transaction Type" column contains "debit" or "credit" alongside an always-positive Amount
  const txTypeCol = headers.findIndex(h => /^transaction type$|^type$/.test(h));

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
      // Mint: Transaction Type column flips sign on always-positive Amount
      if (txTypeCol >= 0) {
        const txType = (cols[txTypeCol] ?? '').toLowerCase().trim();
        if (txType === 'debit') amount = -Math.abs(amount);
        else if (txType === 'credit') amount = Math.abs(amount);
      }
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
  const [step,      setStep]      = useState('upload'); // upload | preview | done
  const [rows,      setRows]      = useState([]);
  const [selected,  setSelected]  = useState(new Set());
  const [error,     setError]     = useState('');
  const [fileNames, setFileNames] = useState([]);
  const [processing,setProcessing]= useState(false);
  const fileRef = useRef(null);

  const acctTxs = existingTransactions.filter(t => t.account === account.id);

  // ── Multi-file handler ────────────────────────────────────────────────────
  const handleFiles = async (fileList) => {
    const files = Array.from(fileList).filter(Boolean);
    if (!files.length) return;
    setError('');
    setProcessing(true);
    setFileNames(files.map(f => f.name));

    let allParsed = [];
    const skipped = [];

    for (const file of files) {
      try {
        const text = await file.text();
        const lower = file.name.toLowerCase();
        const parsed = (lower.endsWith('.ofx') || lower.endsWith('.qfx') || /<OFX/i.test(text))
          ? parseOFX(text)
          : parseStatementCSV(text);
        allParsed = allParsed.concat(parsed);
      } catch (e) {
        skipped.push(file.name);
      }
    }

    setProcessing(false);

    if (allParsed.length === 0) {
      setError('No transactions found in any selected file. Check that files are valid CSV, OFX, or QFX bank statements.');
      return;
    }

    // Deduplicate within the batch (same date + amount + description prefix)
    const seen = new Set();
    const deduped = allParsed.filter(r => {
      const key = `${r.date}|${r.amount.toFixed(2)}|${r.description.toLowerCase().slice(0, 20)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const annotated = deduped.map(r => ({
      ...r,
      id:       uid(),
      category: autoCategory(r.description, r.amount),
      isDup:    isDuplicate(r, acctTxs),
    }));

    setRows(annotated);
    setSelected(new Set(annotated.filter(r => !r.isDup).map(r => r.id)));
    if (skipped.length) setError(`⚠ Could not read ${skipped.length} file(s): ${skipped.join(', ')}`);
    setStep('preview');
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
        {fileNames.length > 1 && <span> from {fileNames.length} files</span>}
      </div>
      <button className="btn btn-primary" onClick={onClose}>Done</button>
    </div>
  );

  // ── Upload screen ─────────────────────────────────────────────────────────
  if (step === 'upload') return (
    <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
      <p style={{ fontSize:13, color:'#94a3b8', margin:0 }}>
        Import transactions into <strong style={{ color:'#e2e8f0' }}>{account.name}</strong>.
        Select one file or multiple years of statements at once.
      </p>
      <div
        style={{
          border:'2px dashed #2d3748', borderRadius:12, padding:'36px 24px',
          textAlign:'center', cursor: processing ? 'wait' : 'pointer', transition:'border-color 0.2s',
          opacity: processing ? 0.7 : 1,
        }}
        onClick={() => !processing && fileRef.current?.click()}
        onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = '#7fa88b'; }}
        onDragLeave={e => { e.currentTarget.style.borderColor = '#2d3748'; }}
        onDrop={e => {
          e.preventDefault();
          e.currentTarget.style.borderColor = '#2d3748';
          handleFiles(e.dataTransfer.files);
        }}
      >
        <div style={{ fontSize:40, marginBottom:10 }}>{processing ? '⏳' : '📄'}</div>
        <div style={{ fontSize:14, fontWeight:600, color:'#e2e8f0', marginBottom:4 }}>
          {processing ? 'Processing files…' : 'Drop statements here'}
        </div>
        <div style={{ fontSize:12, color:'#64748b' }}>
          {processing ? 'Reading transactions from all files' : 'or click to browse · CSV, OFX, QFX · multiple files OK'}
        </div>
        <input
          ref={fileRef} type="file" accept=".csv,.ofx,.qfx" multiple
          style={{ display:'none' }}
          onChange={e => handleFiles(e.target.files)}
        />
      </div>
      <div style={{ fontSize:12, color:'#475569', background:'#0d1117', borderRadius:8, padding:'10px 14px' }}>
        💡 <strong style={{ color:'#64748b' }}>Tip:</strong> Select all your statement files at once — the importer will merge and deduplicate them automatically. Great for loading 1–2 years of history.
      </div>
      {error && (
        <div style={{ color:'#c2735a', fontSize:13, background:'#c2735a11', borderRadius:8, padding:'10px 14px' }}>
          {error}
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
          <div style={{ fontSize:14, fontWeight:700, color:'#e2e8f0' }}>
            {rows.length} transactions found
            {fileNames.length > 1 && (
              <span style={{ marginLeft:10, fontSize:12, fontWeight:400, color:'#64748b' }}>
                from {fileNames.length} files
              </span>
            )}
          </div>
          <div style={{ fontSize:12, color:'#64748b', marginTop:2 }}>
            Account: <strong style={{ color:'#94a3b8' }}>{account.name}</strong>
            {dupCount > 0 && (
              <span style={{ marginLeft:12, color:'#f59e0b' }}>
                ⚠ {dupCount} likely duplicate{dupCount !== 1 ? 's' : ''} (pre-deselected)
              </span>
            )}
          </div>
          {fileNames.length > 1 && (
            <div style={{ fontSize:11, color:'#475569', marginTop:4 }}>
              {fileNames.join(' · ')}
            </div>
          )}
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => { setStep('upload'); setFileNames([]); setError(''); }}>← Different files</button>
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
        <span>After import: <strong style={{ color: newBalance >= 0 ? '