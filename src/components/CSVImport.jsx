import { useState } from 'react';
import * as XLSX from 'xlsx';
import { getAllCategories, uid, fmt, fmtDate, parseCSVLine, parseAmount, autoCategory } from '../constants.js';
import { useCategoryMemory } from '../hooks/useCategoryMemory.js';

const CSV_PRESETS = {
  'auto':        { label: 'Auto-detect',       dateCol: null,               descCol: null,          amountCol: null,  debitCol: null,  creditCol: null },
  'chase':       { label: 'Chase Bank',        dateCol: 'Transaction Date', descCol: 'Description', amountCol: 'Amount',  flip: true },
  'bofa':        { label: 'Bank of America',   dateCol: 'Date',             descCol: 'Description', amountCol: 'Amount',  flip: false },
  'amex':        { label: 'American Express',  dateCol: 'Date',             descCol: 'Description', amountCol: 'Amount',  flip: true },
  'capital-one': { label: 'Capital One',       dateCol: 'Transaction Date', descCol: 'Description', debitCol: 'Debit', creditCol: 'Credit' },
  'discover':    { label: 'Discover',          dateCol: 'Trans. Date',      descCol: 'Description', amountCol: 'Amount',  flip: true },
  'wells-fargo': { label: 'Wells Fargo',       dateCol: 'Date',             descCol: 'Description', amountCol: 'Amount',  flip: false },
  'citi':        { label: 'Citi',              dateCol: 'Date',             descCol: 'Description', debitCol: 'Debit', creditCol: 'Credit' },
  'usaa':        { label: 'USAA',              dateCol: 'Date',             descCol: 'Description', amountCol: 'Amount',  flip: false },
  'generic':     { label: 'Generic CSV',       dateCol: 'Date',             descCol: 'Description', amountCol: 'Amount',  flip: false },
};

function parseOFXDate(raw) {
  if (!raw) return '';
  const s = raw.trim().replace(/\[.*\]/, '');
  const y = s.slice(0, 4), m = s.slice(4, 6), d = s.slice(6, 8);
  if (!y || !m || !d) return '';
  return `${y}-${m}-${d}`;
}

function ofxField(block, tag) {
  const xmlM = block.match(new RegExp(`<${tag}>([^<]*)<\/${tag}>`, 'i'));
  if (xmlM) return xmlM[1].trim();
  const sgmlM = block.match(new RegExp(`<${tag}>([^<\r\n]*)`, 'i'));
  if (sgmlM) return sgmlM[1].trim();
  return '';
}

function parseOFX(text) {
  let blocks = [];
  const xmlRe = /<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi;
  let m;
  while ((m = xmlRe.exec(text)) !== null) blocks.push(m[1]);
  if (!blocks.length) {
    const sgmlRe = /<STMTTRN>([\s\S]*?)(?=<STMTTRN>|<\/BANKTRANLIST>|<\/INVTRANLIST>|$)/gi;
    while ((m = sgmlRe.exec(text)) !== null) blocks.push(m[1]);
  }
  return blocks.map(block => {
    const date   = parseOFXDate(ofxField(block, 'DTPOSTED') || ofxField(block, 'DTTRADE'));
    const amount = parseFloat(ofxField(block, 'TRNAMT') || '0');
    const fitid  = ofxField(block, 'FITID');
    const name   = ofxField(block, 'NAME');
    const memo   = ofxField(block, 'MEMO');
    let desc = name || memo || '(Unknown)';
    if (name && memo && memo !== name && !name.includes(memo) && !memo.includes(name)) {
      desc = `${name} -- ${memo}`;
    }
    return { date, amount: isNaN(amount) ? 0 : amount, description: desc, fitid };
  }).filter(t => t.date && t.description !== '(Unknown)');
}

function findDuplicates(newTxs, existingTxs, isOFX) {
  const existingFitids = new Set(existingTxs.map(t => t.fitid).filter(Boolean));
  return newTxs.map(newTx => {
    if (isOFX && newTx.fitid && existingFitids.has(newTx.fitid)) {
      return { ...newTx, _isDuplicate: true };
    }
    const newDate = new Date(newTx.date);
    const newAmt  = Math.abs(newTx.amount);
    const newDesc = newTx.description.toLowerCase().trim();
    const isDup = existingTxs.some(ex => {
      const dayDiff   = Math.abs((newDate - new Date(ex.date)) / 86400000);
      const amtMatch  = Math.abs(Math.abs(ex.amount) - newAmt) < 0.01;
      const exWords   = ex.description.toLowerCase().trim().split(/\s+/);
      const newWords  = newDesc.split(/\s+/);
      const overlap   = newWords.filter(w => w.length > 2 && exWords.some(ew => ew.includes(w) || w.includes(ew))).length;
      const descMatch = newWords.length > 0 && overlap / newWords.length > 0.6;
      return dayDiff <= 2 && amtMatch && descMatch;
    });
    return { ...newTx, _isDuplicate: isDup };
  });
}

function buildCSVRows(lines, rawHeaders, dateIdx, descIdx, amtIdx, creditIdx, debitIdx, flip, accountId, suggest) {
  const result = [];
  for (let i = 1; i < lines.length; i++) {
    const c = parseCSVLine(lines[i]);
    const g = (idx) => idx >= 0 ? (c[idx] ?? '') : '';
    const date = g(dateIdx).replace(/"/g, '').trim();
    const desc = g(descIdx).trim();
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
    const mem = suggest(desc);
    const category = mem || autoCategory(desc, amt) || 'Other';
    result.push({
      id: uid(), date, description: desc, amount: amt, category,
      account: accountId, type: amt >= 0 ? 'income' : 'expense', notes: '',
      _csv: true, _memorized: mem !== null,
    });
  }
  return result;
}

export default function CSVImport({ accounts, existingTxs, onImport, onClose, userCategories = [] }) {
  const [step,       setStep]       = useState('upload');
  const [rows,       setRows]       = useState([]);
  const [error,      setError]      = useState('');
  const [ucIdx,      setUcIdx]      = useState(0);
  const [csvPreset,  setCsvPreset]  = useState('auto');
  const [skipDups,   setSkipDups]   = useState(true);
  const [dragOver,   setDragOver]   = useState(false);
  const [fileType,   setFileType]   = useState('csv');
  const [importAcct, setImportAcct] = useState(accounts[0]?.id ?? '');
  const [csvHeaders,  setCsvHeaders]  = useState([]);
  const [csvRawLines, setCsvRawLines] = useState([]);
  const [colMap,      setColMap]      = useState({ date: '', description: '', amount: '', debit: '', credit: '' });
  const [amtMode,     setAmtMode]     = useState('single');
  const [flipSign,    setFlipSign]    = useState(false);

  const { suggest } = useCategoryMemory(existingTxs || []);
  const dupCount  = rows.filter(r => r._isDuplicate).length;
  const uncatRows = rows.filter(r => r.category === 'Other');

  const processCSV = (text, preset, accountId) => {
    const lines      = text.trim().split(/\r?\n/);
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
      dateIdx   = col('date', 'posted', 'transaction date', 'trans date', 'trans. date');
      descIdx   = col('description', 'merchant', 'payee', 'memo', 'name', 'details', 'narrative');
      amtIdx    = col('amount', 'transaction amount');
      creditIdx = col('credit');
      debitIdx  = col('debit');
      flip      = false;
    } else {
      const p     = CSV_PRESETS[preset];
      const exact = (name) => name == null ? -1 : rawHeaders.findIndex(h => h.trim().toLowerCase() === name.toLowerCase());
      dateIdx   = exact(p.dateCol);
      descIdx   = exact(p.descCol);
      amtIdx    = p.amountCol != null ? exact(p.amountCol) : -1;
      creditIdx = p.creditCol != null ? exact(p.creditCol) : -1;
      debitIdx  = p.debitCol  != null ? exact(p.debitCol)  : -1;
      flip      = !!p.flip;
    }

    const hasAmount = amtIdx >= 0 || (creditIdx >= 0 && debitIdx >= 0);
    if (dateIdx < 0 || descIdx < 0 || !hasAmount) {
      const p = preset && preset !== 'auto' ? CSV_PRESETS[preset] : null;
      setCsvHeaders(rawHeaders);
      setCsvRawLines(lines);
      setColMap({
        date:        p && p.dateCol   ? (rawHeaders.find(h => h.toLowerCase() === p.dateCol.toLowerCase())   || '') : '',
        description: p && p.descCol   ? (rawHeaders.find(h => h.toLowerCase() === p.descCol.toLowerCase())   || '') : '',
        amount:      p && p.amountCol ? (rawHeaders.find(h => h.toLowerCase() === p.amountCol.toLowerCase())  || '') : '',
        debit:       p && p.debitCol  ? (rawHeaders.find(h => h.toLowerCase() === p.debitCol.toLowerCase())   || '') : '',
        credit:      p && p.creditCol ? (rawHeaders.find(h => h.toLowerCase() === p.creditCol.toLowerCase())  || '') : '',
      });
      setAmtMode(p && p.debitCol ? 'debitcredit' : 'single');
      setFlipSign(!!(p && p.flip));
      setStep('col-map');
      return null;
    }
    return buildCSVRows(lines, rawHeaders, dateIdx, descIdx, amtIdx, creditIdx, debitIdx, flip, accountId, suggest);
  };

  const applyColMap = () => {
    const idx       = (h) => csvHeaders.findIndex(x => x === h);
    const dateIdx   = idx(colMap.date);
    const descIdx   = idx(colMap.description);
    const amtIdx    = amtMode === 'single'      ? idx(colMap.amount) : -1;
    const creditIdx = amtMode === 'debitcredit' ? idx(colMap.credit) : -1;
    const debitIdx  = amtMode === 'debitcredit' ? idx(colMap.debit)  : -1;
    const result    = buildCSVRows(csvRawLines, csvHeaders, dateIdx, descIdx, amtIdx, creditIdx, debitIdx, flipSign, importAcct, suggest);
    if (!result.length) { setError('No valid rows found with these column mappings.'); return; }
    setRows(findDuplicates(result, existingTxs || [], false));
    setStep('review-all');
  };

  const handleFile = (file) => {
    if (!file) return;
    setError('');
    const ext    = file.name.split('.').pop().toLowerCase();
    const isOFX  = ext === 'ofx' || ext === 'qfx';
    const isXLSX = ext === 'xlsx' || ext === 'xls';
    setFileType(isOFX ? 'ofx' : 'csv');

    if (isXLSX) {
      // Excel: read as ArrayBuffer, parse with SheetJS, convert first sheet to CSV text,
      // then feed through the identical processCSV / column-mapping path.
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const buffer   = new Uint8Array(ev.target.result);
          const workbook = XLSX.read(buffer, { type: 'array' });
          const sheet    = workbook.Sheets[workbook.SheetNames[0]];
          // raw:false → all values as formatted strings (dates as "MM/DD/YYYY", numbers as "1234.56")
          const rows2d   = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false });
          if (!rows2d.length) { setError('Excel file appears to be empty.'); return; }
          // Serialize to CSV text so processCSV can handle it identically to a real CSV upload.
          // sheet_to_csv produces standard RFC 4180 CSV that parseCSVLine can parse.
          const csvText  = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
          const parsed   = processCSV(csvText, csvPreset, importAcct);
          if (parsed === null) return; // column-map UI shown
          if (!parsed.length) { setError('Could not parse Excel file. Ensure it has Date, Description, and Amount columns, or choose a bank format above.'); return; }
          setRows(findDuplicates(parsed, existingTxs || [], false));
          setStep('review-all');
        } catch (err) { setError('Error reading Excel file: ' + err.message); }
      };
      reader.readAsArrayBuffer(file);
      return;
    }

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const text = ev.target.result;
        if (isOFX) {
          const parsed = parseOFX(text);
          if (!parsed.length) { setError('Could not parse OFX/QFX file. It may be empty or in an unsupported format.'); return; }
          const withMeta = parsed.map(t => {
            const mem = suggest(t.description);
            return {
              id: uid(), ...t,
              category: mem || autoCategory(t.description, t.amount) || 'Other',
              account: importAcct, type: t.amount >= 0 ? 'income' : 'expense',
              notes: '', _csv: true, _memorized: mem !== null,
            };
          });
          setRows(findDuplicates(withMeta, existingTxs || [], true));
          setStep('review-all');
        } else {
          const parsed = processCSV(text, csvPreset, importAcct);
          if (parsed === null) return;
          if (!parsed.length) { setError('Could not parse CSV. Ensure it has Date, Description, and Amount columns, or choose a bank format above.'); return; }
          setRows(findDuplicates(parsed, existingTxs || [], false));
          setStep('review-all');
        }
      } catch (err) { setError('Error reading file: ' + err.message); }
    };
    reader.readAsText(file);
  };

  const updateRow = (id, key, val) => setRows(rs => rs.map(r => r.id === id ? { ...r, [key]: val } : r));
  const removeRow = (id)           => setRows(rs => rs.filter(r => r.id !== id));
  const doImport  = () => {
    const toImport = skipDups ? rows.filter(r => !r._isDuplicate) : rows;
    const clean    = toImport.map(({ _csv, _isDuplicate, _memorized, ...r }) => r);
    onImport(clean);
  };

  if (step === 'upload') return (
    <div>
      <p style={{ fontSize:13, color:'#64748b', marginBottom:16 }}>
        Import transactions from your bank export.
        <strong style={{ color:'#94a3b8' }}> OFX / QFX</strong> is recommended — it includes bank-assigned transaction IDs for reliable duplicate detection.
        <strong style={{ color:'#94a3b8' }}> CSV</strong> and <strong style={{ color:'#94a3b8' }}> Excel (.xlsx)</strong> also supported.
      </p>

      <div style={{ marginBottom:14 }}>
        <label style={{ fontSize:13, color:'#94a3b8', display:'block', marginBottom:5 }}>Import into Account</label>
        <select value={importAcct} onChange={e => setImportAcct(e.target.value)} style={{ width:'100%' }}>
          <option value="">— Select account —</option>
          {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </div>

      <div style={{ marginBottom:14 }}>
        <label style={{ fontSize:13, color:'#94a3b8', display:'block', marginBottom:5 }}>
          CSV Bank Format <span style={{ fontWeight:400, color:'#475569' }}>(ignored for OFX/QFX files)</span>
        </label>
        <select value={csvPreset} onChange={e => setCsvPreset(e.target.value)} style={{ width:'100%' }}>
          {Object.entries(CSV_PRESETS).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}
        </select>
        {csvPreset !== 'auto' && (() => {
          const p = CSV_PRESETS[csvPreset];
          const cols = [p.dateCol, p.descCol, p.amountCol || (p.debitCol ? (p.debitCol + ' / ' + p.creditCol) : null)].filter(Boolean);
          return (
            <div style={{ fontSize:12, color:'#64748b', marginTop:5 }}>
              {'Tip: Expected columns: '}
              <span style={{ color:'#94a3b8' }}>{cols.join(', ')}</span>
              {p.flip && <span style={{ color:'#f59e0b', marginLeft:6 }}>(amounts sign-flipped)</span>}
            </div>
          );
        })()}
      </div>

      <div
        onDrop={e => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files[0]); }}
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        style={{ border:'2px dashed ' + (dragOver ? '#6366f1' : '#2d3a4a'), borderRadius:10, padding:'28px 24px', textAlign:'center', marginBottom:12, background: dragOver ? '#6366f108' : 'transparent', transition:'border-color 0.15s, background 0.15s' }}>
        <div style={{ fontSize:32, marginBottom:6 }}>📥</div>
        <p style={{ color:'#94a3b8', marginBottom:3, fontSize:14 }}>Drag and drop your export file here</p>
        <p style={{ color:'#475569', marginBottom:12, fontSize:12 }}>OFX · QFX · CSV · TXT · XLSX · XLS</p>
        <label className="file-label" htmlFor="tx-import-file">📂 Choose File</label>
        <input id="tx-import-file" type="file" accept=".csv,.txt,.ofx,.qfx,.xlsx,.xls" onChange={e => handleFile(e.target.files[0])} />
      </div>

      <div style={{ background:'#0f172a', borderRadius:8, padding:'9px 13px', fontSize:12, color:'#64748b', lineHeight:1.6 }}>
        <strong style={{ color:'#94a3b8' }}>Finding OFX/QFX:</strong> In your bank website look for "Download Transactions", "Export to Quicken", or "Export to Money". OFX and QFX are the same format under different names.
      </div>
      {error && <p style={{ color:'#c2735a', fontSize:13, marginTop:10 }}>{error}</p>}
    </div>
  );

  if (step === 'col-map') {
    const sampleCols = csvRawLines.length > 1 ? parseCSVLine(csvRawLines[1]) : [];
    const mappedSet  = new Set(Object.values(colMap).filter(Boolean));
    return (
      <div>
        <div style={{ background:'#f59e0b11', border:'1px solid #f59e0b33', borderRadius:8, padding:'9px 13px', marginBottom:16, fontSize:13, color:'#f59e0b' }}>
          Could not auto-detect columns. Map them manually below.
        </div>

        {[['Date column', 'date'], ['Description column', 'description']].map(([label, key]) => (
          <div key={key} style={{ marginBottom:12 }}>
            <label style={{ fontSize:12, color:'#94a3b8', display:'block', marginBottom:4 }}>{label}</label>
            <select value={colMap[key]} onChange={e => setColMap(m => ({ ...m, [key]: e.target.value }))} style={{ width:'100%' }}>
              <option value="">— select —</option>
              {csvHeaders.map(h => <option key={h} value={h}>{h}</option>)}
            </select>
          </div>
        ))}

        <div style={{ marginBottom:12 }}>
          <label style={{ fontSize:12, color:'#94a3b8', display:'block', marginBottom:6 }}>Amount format</label>
          <div style={{ display:'flex', gap:16, marginBottom:8 }}>
            <label style={{ display:'flex', alignItems:'center', gap:6, cursor:'pointer', fontSize:13, color:'#e2e8f0' }}>
              <input type="radio" checked={amtMode === 'single'} onChange={() => setAmtMode('single')} /> Single amount column
            </label>
            <label style={{ display:'flex', alignItems:'center', gap:6, cursor:'pointer', fontSize:13, color:'#e2e8f0' }}>
              <input type="radio" checked={amtMode === 'debitcredit'} onChange={() => setAmtMode('debitcredit')} /> Separate Debit / Credit columns
            </label>
          </div>
          {amtMode === 'single' ? (
            <div style={{ display:'flex', gap:10, alignItems:'center' }}>
              <select value={colMap.amount} onChange={e => setColMap(m => ({ ...m, amount: e.target.value }))} style={{ flex:1 }}>
                <option value="">— select —</option>
                {csvHeaders.map(h => <option key={h} value={h}>{h}</option>)}
              </select>
              <label style={{ display:'flex', alignItems:'center', gap:6, cursor:'pointer', fontSize:12, color:'#94a3b8', whiteSpace:'nowrap' }}>
                <input type="checkbox" checked={flipSign} onChange={e => setFlipSign(e.target.checked)} /> Flip signs
              </label>
            </div>
          ) : (
            <div style={{ display:'flex', gap:10 }}>
              <div style={{ flex:1 }}>
                <label style={{ fontSize:11, color:'#64748b', display:'block', marginBottom:3 }}>Debit (expenses)</label>
                <select value={colMap.debit} onChange={e => setColMap(m => ({ ...m, debit: e.target.value }))} style={{ width:'100%' }}>
                  <option value="">— select —</option>
                  {csvHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>
              <div style={{ flex:1 }}>
                <label style={{ fontSize:11, color:'#64748b', display:'block', marginBottom:3 }}>Credit (income)</label>
                <select value={colMap.credit} onChange={e => setColMap(m => ({ ...m, credit: e.target.value }))} style={{ width:'100%' }}>
                  <option value="">— select —</option>
                  {csvHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>
            </div>
          )}
        </div>

        {sampleCols.length > 0 && (
          <div style={{ background:'#0f172a', borderRadius:6, padding:'8px 12px', marginBottom:14, fontSize:12 }}>
            <div style={{ color:'#475569', marginBottom:4 }}>Sample (row 1):</div>
            {csvHeaders.map((h, i) => (
              <div key={h} style={{ color: mappedSet.has(h) ? '#c4b5fd' : '#64748b' }}>
                <span style={{ color:'#475569' }}>{h}:</span> {sampleCols[i] || ''}
              </div>
            ))}
          </div>
        )}

        {error && <p style={{ color:'#c2735a', fontSize:13 }}>{error}</p>}
        <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:8 }}>
          <button className="btn btn-secondary" onClick={() => { setStep('upload'); setError(''); }}>Back</button>
          <button className="btn btn-primary" onClick={applyColMap}>Apply and Preview</button>
        </div>
      </div>
    );
  }

  if (step === 'review-all') {
    const importCount = skipDups ? rows.filter(r => !r._isDuplicate).length : rows.length;
    return (
      <div>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
            <span style={{ fontWeight:600, color:'#e2e8f0' }}>{rows.length} transactions found</span>
            {fileType === 'ofx' && (
              <span style={{ fontSize:11, color:'#818cf8', background:'#6366f122', padding:'2px 7px', borderRadius:20 }}>OFX/QFX</span>
            )}
            {uncatRows.length > 0 && (
              <span style={{ fontSize:12, color:'#f59e0b', background:'#f59e0b22', padding:'2px 8px', borderRadius:20 }}>
                {uncatRows.length} uncategorized
              </span>
            )}
            {dupCount > 0 && (
              <span style={{ fontSize:12, color:'#c2735a', background:'#c2735a22', padding:'2px 8px', borderRadius:20 }}>
                {dupCount} duplicate{dupCount !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => setStep('upload')}>Back</button>
        </div>

        {dupCount > 0 && (
          <div style={{ background:'#f59e0b11', border:'1px solid #f59e0b44', borderRadius:8, padding:'8px 12px', marginBottom:12, display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
            <label style={{ display:'flex', alignItems:'center', gap:6, cursor:'pointer', fontSize:13, color:'#e2e8f0' }}>
              <input type="checkbox" checked={skipDups} onChange={e => setSkipDups(e.target.checked)} />
              Skip duplicates
            </label>
            <span style={{ fontSize:12, color:'#94a3b8' }}>
              {dupCount} of {rows.length} rows look like duplicates and will be {skipDups ? 'skipped' : 'imported'}.
              {fileType === 'ofx' ? ' Matched by bank transaction ID.' : ''}
            </span>
          </div>
        )}

        <div style={{ maxHeight:'45vh', overflowY:'auto', marginBottom:16 }}>
          <table>
            <thead>
              <tr><th>Date</th><th>Description</th><th>Category</th><th>Amount</th><th>Account</th><th></th></tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} style={{ background: r._isDuplicate ? '#f59e0b08' : r.category === 'Other' ? '#f59e0b05' : undefined, opacity: r._isDuplicate && skipDups ? 0.5 : 1 }}>
                  <td><input type="date" value={r.date} onChange={e => updateRow(r.id, 'date', e.target.value)} style={{ width:130 }} /></td>
                  <td>
                    <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                      <input type="text" value={r.description} onChange={e => updateRow(r.id, 'description', e.target.value)} style={{ minWidth:140 }} />
                      {r._isDuplicate && (
                        <span style={{ fontSize:11, background:'#f59e0b22', color:'#f59e0b', padding:'1px 6px', borderRadius:10, whiteSpace:'nowrap' }}>
                          {fileType === 'ofx' ? 'Exact dup' : 'Likely dup'}
                        </span>
                      )}
                    </div>
                  </td>
                  <td>
                    <div style={{ display:'flex', alignItems:'center', gap:5 }}>
                      <select value={r.category} onChange={e => updateRow(r.id, 'category', e.target.value)} style={{ minWidth:140 }}>
                        {getAllCategories(userCategories).map(c => <option key={c.name} value={c.name}>{c.icon} {c.name}</option>)}
                      </select>
                      {r._memorized && (
                        <span style={{ fontSize:10, background:'#6366f122', color:'#818cf8', padding:'1px 5px', borderRadius:8, whiteSpace:'nowrap', flexShrink:0 }}>auto</span>
                      )}
                    </div>
                  </td>
                  <td style={{ color: r.amount >= 0 ? '#4ade80' : '#c2735a', fontWeight:600, whiteSpace:'nowrap' }}>{fmt(r.amount)}</td>
                  <td>
                    <select value={r.account} onChange={e => updateRow(r.id, 'account', e.target.value)} style={{ minWidth:120 }}>
                      <option value="">None</option>
                      {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  </td>
                  <td><button className="btn btn-ghost btn-sm" style={{ color:'#c2735a' }} onClick={() => removeRow(r.id)}>x</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ display:'flex', gap:8, justifyContent:'space-between', alignItems:'center' }}>
          <div>
            {uncatRows.length > 0 && (
              <button className="btn btn-secondary btn-sm" onClick={() => { setUcIdx(0); setStep('review-uncat'); }}>
                Quick-fix {uncatRows.length} uncategorized
              </button>
            )}
          </div>
          <div style={{ display:'flex', gap:8 }}>
            <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" onClick={doImport} disabled={importCount === 0}>
              Import {importCount} Transaction{importCount !== 1 ? 's' : ''}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const ucRow = uncatRows[ucIdx];
  if (step === 'review-uncat' && ucRow) return (
    <div style={{ textAlign:'center' }}>
      <p style={{ color:'#94a3b8', fontSize:13, marginBottom:16 }}>
        Quickly categorize uncategorized transactions ({ucIdx + 1} of {uncatRows.length})
      </p>
      <div className="card-sm" style={{ marginBottom:20, textAlign:'left' }}>
        <div style={{ fontWeight:600, fontSize:16 }}>{ucRow.description}</div>
        <div style={{ color:'#64748b', fontSize:13, marginTop:4 }}>
          {fmtDate(ucRow.date)} - <span style={{ color: ucRow.amount >= 0 ? '#4ade80' : '#c2735a', fontWeight:600 }}>{fmt(ucRow.amount)}</span>
        </div>
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:16 }}>
        {getAllCategories(userCategories).filter(c => c.name !== 'Other').map(c => (
          <button key={c.name} className="btn btn-secondary" style={{ justifyContent:'flex-start', gap:8 }}
            onClick={() => {
              updateRow(ucRow.id, 'category', c.name);
              if (ucIdx < uncatRows.length - 1) setUcIdx(i => i + 1);
              else setStep('review-all');
            }}>
            <span>{c.icon}</span><span>{c.name}</span>
          </button>
        ))}
      </div>
      <div style={{ display:'flex', gap:8, justifyContent:'center' }}>
        <button className="btn btn-ghost btn-sm"
          onClick={() => { if (ucIdx < uncatRows.length - 1) setUcIdx(i => i + 1); else setStep('review-all'); }}>
          Skip
        </button>
        <button className="btn btn-secondary btn-sm" onClick={() => setStep('review-all')}>Back to Review</button>
      </div>
    </div>
  );

  return null;
}
