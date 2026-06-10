import { useState, useRef, useMemo, useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import { autoCategory, parseCSVLine, parseAmount, uid, sanitizeText, safeDate, shouldFlipImportAmounts, detectImportDuplicates } from '../constants.js';

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

// ─── Component ────────────────────────────────────────────────────────────────
export default function StatementImport({ account, existingTransactions, onImport, onClose }) {
  const [step,      setStep]      = useState('upload'); // upload | dupes | preview | done
  const [rows,      setRows]      = useState([]);       // base parsed rows (raw amounts, no isDup)
  const [selected,  setSelected]  = useState(new Set());
  const [error,     setError]     = useState('');
  const [fileNames, setFileNames] = useState([]);
  const [processing,setProcessing]= useState(false);
  const [flipSign,  setFlipSign]  = useState(() => shouldFlipImportAmounts(account.type));
  const fileRef = useRef(null);

  // M2/M3: recompute dup pairs whenever rows or flipSign changes (memo keyed on both).
  // Returns [{imported: row, existing: matchedTx}] surplus-only (one match consumed per pair).
  const dupPairs = useMemo(() => {
    if (!rows.length) return [];
    const effective = rows.map(r => ({ ...r, amount: flipSign ? -r.amount : r.amount }));
    return detectImportDuplicates(effective, existingTransactions, account.id);
  }, [rows, flipSign, existingTransactions, account.id]);

  const dupImportedIds = useMemo(() => new Set(dupPairs.map(p => p.imported.id)), [dupPairs]);

  // M3: when dupImportedIds changes (flipSign toggle on preview), deselect newly-flagged dups.
  useEffect(() => {
    if (step === 'preview' || step === 'dupes') {
      setSelected(prev => {
        const next = new Set(prev);
        dupImportedIds.forEach(id => next.delete(id));
        return next;
      });
    }
  }, [dupImportedIds]); // eslint-disable-line

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

    // H5: track format so OFX/QFX (already correctly signed) don't get double-flipped
    let anyOFX = false;
    let anyCSV = false;

    for (const file of files) {
      try {
        const text = await file.text();
        const lower = file.name.toLowerCase();
        const isOFX = lower.endsWith('.ofx') || lower.endsWith('.qfx') || /<OFX/i.test(text);
        if (isOFX) anyOFX = true; else anyCSV = true;
        const parsed = isOFX ? parseOFX(text) : parseStatementCSV(text);
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

    // OFX/QFX amounts are already correctly signed per the OFX spec (debits negative).
    // Only auto-enable flip for CSV imports on debt accounts. Use a local variable so
    // autoCategory and dupe detection are consistent within this call (setFlipSign is
    // async and won't update flipSign until the next render).
    // Known limitation: when a batch mixes OFX and CSV files, effectiveFlip falls back
    // to flipSign and applies to ALL rows — including OFX rows that don't need it.
    // Per-file-flip is tracked in BACKLOG.md as a Medium improvement.
    const effectiveFlip = anyOFX && !anyCSV ? false : flipSign;
    if (effectiveFlip !== flipSign) setFlipSign(effectiveFlip);

    // Deduplicate within the batch (same date + amount + description prefix)
    const seen = new Set();
    const deduped = allParsed.filter(r => {
      const key = `${r.date}|${r.amount.toFixed(2)}|${r.description.toLowerCase().slice(0, 20)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // H3: pass the effective (post-flip) amount to autoCategory so credit card charges
    // (positive in CSV) aren't passed as +amount and incorrectly assigned 'Income'.
    const annotated = deduped.map(r => ({
      ...r,
      id:       uid(),
      category: autoCategory(r.description, effectiveFlip ? -r.amount : r.amount),
    }));

    // Compute initial dupPairs synchronously (using effectiveFlip, same as the memo will use).
    const effectiveForDup = annotated.map(r => ({ ...r, amount: effectiveFlip ? -r.amount : r.amount }));
    const initialDupPairs = detectImportDuplicates(effectiveForDup, existingTransactions, account.id);
    const initialDupIds = new Set(initialDupPairs.map(p => p.imported.id));

    setRows(annotated); // store base rows (no isDup flag — memo derives dups dynamically)
    setSelected(new Set(annotated.filter(r => !initialDupIds.has(r.id)).map(r => r.id)));
    if (skipped.length) setError(`⚠ Could not read ${skipped.length} file(s): ${skipped.join(', ')}`);
    setStep(initialDupIds.size > 0 ? 'dupes' : 'preview');
  };

  // ── Selection helpers ─────────────────────────────────────────────────────
  const toggleRow = (id) =>
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const nonDupIds = rows.filter(r => !dupImportedIds.has(r.id)).map(r => r.id);
  const toggleAll = () =>
    setSelected(selected.size === nonDupIds.length ? new Set() : new Set(nonDupIds));

  // ── Commit ────────────────────────────────────────────────────────────────
  const effectiveAmt = (r) => flipSign ? -r.amount : r.amount;

  const handleImport = () => {
    const toImport = rows
      .filter(r => selected.has(r.id))
      .map(r => {
        const amt = effectiveAmt(r);
        return {
          id:          r.id,
          date:        r.date,
          description: r.description,
          amount:      amt,
          category:    r.category,
          account:     account.id,
          type:        amt >= 0 ? 'income' : 'expense',
          notes:       '',
          tags:        [],
          cleared:     false,
        };
      });
    onImport(toImport);
    setStep('done');
  };

  const selectedRows = rows.filter(r => selected.has(r.id));
  const importTotal  = selectedRows.reduce((s, r) => s + effectiveAmt(r), 0);
  const newBalance   = account.balance + importTotal;
  const dupCount     = dupImportedIds.size;

  // ── Done screen ───────────────────────────────────────────────────────────
  if (step === 'done') return (
    <div style={{ textAlign:'center', padding:'40px 24px' }}>
      <div style={{ fontSize:48, marginBottom:12 }}>✅</div>
      <div style={{ fontSize:16, fontWeight:700, color:'var(--text-primary)', marginBottom:6 }}>Import complete</div>
      <div style={{ fontSize:13, color:'var(--text-secondary)', marginBottom:28 }}>
        {selectedRows.length} transaction{selectedRows.length !== 1 ? 's' : ''} added to <strong style={{ color:'var(--text-secondary)' }}>{account.name}</strong>
        {fileNames.length > 1 && <span> from {fileNames.length} files</span>}
      </div>
      <button className="btn btn-primary" onClick={onClose}>Done</button>
    </div>
  );

  // ── Upload screen ─────────────────────────────────────────────────────────
  if (step === 'upload') return (
    <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
      <p style={{ fontSize:13, color:'var(--text-secondary)', margin:0 }}>
        Import transactions into <strong style={{ color:'var(--text-primary)' }}>{account.name}</strong>.
        Select one file or multiple years of statements at once.
      </p>
      <div
        style={{
          border:'2px dashed var(--border-default)', borderRadius:12, padding:'36px 24px',
          textAlign:'center', cursor: processing ? 'wait' : 'pointer', transition:'border-color 0.2s',
          opacity: processing ? 0.7 : 1,
        }}
        onClick={() => !processing && fileRef.current?.click()}
        onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = 'var(--green)'; }}
        onDragLeave={e => { e.currentTarget.style.borderColor = 'var(--border-default)'; }}
        onDrop={e => {
          e.preventDefault();
          e.currentTarget.style.borderColor = 'var(--border-default)';
          handleFiles(e.dataTransfer.files);
        }}
      >
        <div style={{ fontSize:40, marginBottom:10 }}>{processing ? '⏳' : '📄'}</div>
        <div style={{ fontSize:14, fontWeight:600, color:'var(--text-primary)', marginBottom:4 }}>
          {processing ? 'Processing files…' : 'Drop statements here'}
        </div>
        <div style={{ fontSize:12, color:'var(--text-secondary)' }}>
          {processing ? 'Reading transactions from all files' : 'or click to browse · CSV, OFX, QFX · multiple files OK'}
        </div>
        <input
          ref={fileRef} type="file" accept=".csv,.ofx,.qfx" multiple
          style={{ display:'none' }}
          onChange={e => handleFiles(e.target.files)}
        />
      </div>
      <div style={{ fontSize:12, color:'var(--text-muted)', background:'var(--bg-page)', borderRadius:8, padding:'10px 14px' }}>
        💡 <strong style={{ color:'var(--text-secondary)' }}>Tip:</strong> Select all your statement files at once — the importer will merge and deduplicate them automatically. Great for loading 1–2 years of history.
      </div>
      {error && (
        <div style={{ color:'var(--red)', fontSize:13, background:'#c2735a11', borderRadius:8, padding:'10px 14px' }}>
          {error}
        </div>
      )}
      <div style={{ display:'flex', justifyContent:'flex-end' }}>
        <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
      </div>
    </div>
  );

  // ── Dupes screen (per-row selectable) ───────────────────────────────────
  if (step === 'dupes') {
    const uniqueCount  = rows.length - dupPairs.length;
    const includedDups = dupPairs.filter(p => selected.has(p.imported.id)).length;
    return (
      <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
        <div style={{ display:'flex', gap:12, alignItems:'flex-start', background:'#f59e0b11', border:'1px solid #f59e0b44', borderRadius:10, padding:'14px 16px' }}>
          <AlertTriangle size={20} style={{ color:'var(--amber)', flexShrink:0, marginTop:2 }} />
          <div>
            <div style={{ fontSize:14, fontWeight:700, color:'var(--text-primary)', marginBottom:4 }}>
              {dupPairs.length} likely duplicate{dupPairs.length !== 1 ? 's' : ''} found
            </div>
            <div style={{ fontSize:13, color:'var(--text-secondary)' }}>
              These match existing transactions by date and amount. Uncheck to include them anyway.
            </div>
          </div>
        </div>
        <div style={{ maxHeight:240, overflowY:'auto', border:'1px solid var(--bg-raised)', borderRadius:8 }}>
          {dupPairs.map(({ imported: r, existing: ex }) => (
            <label key={r.id} style={{ display:'flex', gap:10, alignItems:'flex-start', padding:'10px 12px', borderBottom:'1px solid #1e273630', cursor:'pointer' }}>
              <input
                type="checkbox"
                checked={!selected.has(r.id)}
                onChange={() => setSelected(s => { const n = new Set(s); n.has(r.id) ? n.add(r.id) : n.delete(r.id); return n; })}
                style={{ marginTop:2, flexShrink:0 }}
              />
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ display:'flex', gap:8, fontSize:12, color:'var(--text-primary)' }}>
                  <span style={{ color:'var(--text-secondary)', whiteSpace:'nowrap' }}>{r.date}</span>
                  <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{r.description}</span>
                  <span style={{ marginLeft:'auto', fontWeight:600, whiteSpace:'nowrap', color: effectiveAmt(r) >= 0 ? 'var(--green)' : 'var(--red)', flexShrink:0 }}>
                    {effectiveAmt(r) >= 0 ? '+' : ''}{fmt(effectiveAmt(r))}
                  </span>
                </div>
                {ex && (
                  <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:3 }}>
                    Matches: {ex.date} · {ex.description} · {fmt(ex.amount)}
                  </div>
                )}
              </div>
            </label>
          ))}
        </div>
        <div style={{ display:'flex', gap:8, justifyContent:'space-between', alignItems:'center' }}>
          <div style={{ display:'flex', gap:6 }}>
            <button className="btn btn-ghost btn-sm" onClick={() => setSelected(s => { const n = new Set(s); dupPairs.forEach(p => n.delete(p.imported.id)); return n; })}>
              Skip all
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setSelected(s => { const n = new Set(s); dupPairs.forEach(p => n.add(p.imported.id)); return n; })}>
              Import all anyway
            </button>
          </div>
          <button className="btn btn-primary" onClick={() => setStep('preview')}>
            Continue — import {uniqueCount + includedDups} of {rows.length}
          </button>
        </div>
      </div>
    );
  }

  // ── Preview screen ────────────────────────────────────────────────────────
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', flexWrap:'wrap', gap:8 }}>
        <div>
          <div style={{ fontSize:14, fontWeight:700, color:'var(--text-primary)' }}>
            {rows.length} transactions found
            {fileNames.length > 1 && (
              <span style={{ marginLeft:10, fontSize:12, fontWeight:400, color:'var(--text-secondary)' }}>
                from {fileNames.length} files
              </span>
            )}
          </div>
          <div style={{ fontSize:12, color:'var(--text-secondary)', marginTop:2 }}>
            Account: <strong style={{ color:'var(--text-secondary)' }}>{account.name}</strong>
            {dupCount > 0 && (
              <span style={{ marginLeft:12, color:'var(--amber)' }}>
                ⚠ {dupCount} likely duplicate{dupCount !== 1 ? 's' : ''} (pre-deselected)
              </span>
            )}
          </div>
          {fileNames.length > 1 && (
            <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:4 }}>
              {fileNames.join(' · ')}
            </div>
          )}
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          <div>
            <label style={{ display:'flex', alignItems:'center', gap:6, cursor:'pointer', fontSize:12, color:'var(--text-secondary)' }}>
              <input type="checkbox" checked={flipSign} onChange={e => setFlipSign(e.target.checked)} />
              Invert signs (use for credit card CSVs)
            </label>
            {account.type === 'credit' && (
              <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:3 }}>
                Chase, Citi, and most credit card CSV exports show charges as positive numbers.
              </div>
            )}
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => { setStep('upload'); setFileNames([]); setError(''); }}>← Different files</button>
        </div>
      </div>

      {/* Table */}
      <div style={{ maxHeight:320, overflowY:'auto', border:'1px solid var(--bg-raised)', borderRadius:8 }}>
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
          <thead style={{ position:'sticky', top:0, background:'var(--bg-card)', zIndex:1 }}>
            <tr>
              <th style={{ padding:'8px 10px', textAlign:'left', color:'var(--text-secondary)', fontWeight:600, borderBottom:'1px solid var(--bg-raised)' }}>
                <input
                  type="checkbox"
                  onChange={toggleAll}
                  checked={nonDupIds.length > 0 && selected.size === nonDupIds.length}
                  title="Select all non-duplicates"
                />
              </th>
              {['Date','Description','Category','Amount'].map(h => (
                <th key={h} style={{ padding:'8px 10px', textAlign: h==='Amount'?'right':'left', color:'var(--text-secondary)', fontWeight:600, borderBottom:'1px solid var(--bg-raised)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr
                key={r.id}
                style={{
                  background: dupImportedIds.has(r.id) ? '#1a1400' : selected.has(r.id) ? '#0a150a' : 'transparent',
                  opacity: dupImportedIds.has(r.id) ? 0.55 : 1,
                }}
              >
                <td style={{ padding:'6px 10px', borderBottom:'1px solid #1e273630' }}>
                  <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleRow(r.id)} />
                </td>
                <td style={{ padding:'6px 10px', color:'var(--text-secondary)', borderBottom:'1px solid #1e273630', whiteSpace:'nowrap' }}>{r.date}</td>
                <td style={{ padding:'6px 10px', color:'var(--text-primary)', borderBottom:'1px solid #1e273630', maxWidth:200, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                  {r.description}
                  {dupImportedIds.has(r.id) && <span style={{ marginLeft:6, fontSize:10, color:'var(--amber)', background:'#f59e0b22', borderRadius:4, padding:'1px 5px' }}>DUP</span>}
                </td>
                <td style={{ padding:'6px 10px', color:'var(--text-secondary)', borderBottom:'1px solid #1e273630' }}>{r.category}</td>
                <td style={{ padding:'6px 10px', textAlign:'right', fontWeight:600, borderBottom:'1px solid #1e273630', whiteSpace:'nowrap', color: effectiveAmt(r) >= 0 ? 'var(--green)' : 'var(--red)' }}>
                  {effectiveAmt(r) >= 0 ? '+' : ''}{fmt(effectiveAmt(r))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Summary bar */}
      <div style={{ background:'var(--bg-page)', borderRadius:8, padding:'10px 14px', fontSize:12, display:'flex', gap:20, flexWrap:'wrap', color:'var(--text-secondary)' }}>
        <span>Selected: <strong style={{ color:'var(--text-primary)' }}>{selected.size}</strong></span>
        <span>Net change: <strong style={{ color: importTotal >= 0 ? 'var(--green)' : 'var(--red)' }}>{importTotal >= 0 ? '+' : ''}{fmt(importTotal)}</strong></span>
        <span>Current balance: <strong style={{ color:'var(--text-primary)' }}>{fmt(account.balance)}</strong></span>
        <span>After import: <strong style={{ color: newBalance >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmt(newBalance)}</strong></span>
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
