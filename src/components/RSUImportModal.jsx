import { useState, useRef } from 'react';
import { extractPdfText } from '../utils/extractPdfText.js';
import { parseRSUStatement } from '../utils/parseRSUStatement.js';
import { fmt, fmtDate } from '../constants.js';
import { useCurrency } from '../hooks/useCurrency.js';

function Field({ label, value, onChange, type = 'number', prefix, hint }) {
  return (
    <div className="form-group">
      <label className="form-label">{label}</label>
      {hint && <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:4 }}>{hint}</div>}
      <div style={{ display:'flex', alignItems:'center', gap:6 }}>
        {prefix && <span style={{ fontSize:13, color:'var(--text-secondary)' }}>{prefix}</span>}
        <input
          type={type}
          min="0"
          step={type === 'number' ? '0.01' : undefined}
          value={value ?? ''}
          placeholder="—"
          onChange={e => onChange(e.target.value === '' ? null : type === 'number' ? +e.target.value : e.target.value)}
          style={{ flex:1 }}
        />
      </div>
    </div>
  );
}

export default function RSUImportModal({ onConfirm, onClose }) {
  const cfmt = useCurrency();
  const [step,    setStep]    = useState('upload'); // 'upload' | 'review'
  const [parsed,  setParsed]  = useState(null);
  const [draft,   setDraft]   = useState(null);
  const [error,   setError]   = useState('');
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(null);

  const handleFile = async (file) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setError('Please select a PDF file.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const buf    = await file.arrayBuffer();
      const text   = await extractPdfText(buf);
      const result = parseRSUStatement(text);
      setParsed(result);
      setDraft({
        ticker:        result.ticker,
        unvestedShares: result.unvestedShares,
        currentPrice:  result.currentPrice,
        unvestedValue: result.unvestedValue,
        nextVestDate:  result.nextVestDate,
        nextVestShares: result.nextVestShares,
      });
      setStep('review');
    } catch (err) {
      setError(`Failed to read PDF: ${err?.message ?? err}`);
    } finally {
      setLoading(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const set = (k, v) => setDraft(d => {
    const next = { ...d, [k]: v };
    // Recompute unvestedValue when shares or price changes
    if ((k === 'unvestedShares' || k === 'currentPrice') && next.unvestedShares != null && next.currentPrice != null) {
      next.unvestedValue = Math.round(next.unvestedShares * next.currentPrice * 100) / 100;
    }
    return next;
  });

  const handleConfirm = () => {
    const finalValue = draft.unvestedValue ?? (
      draft.unvestedShares != null && draft.currentPrice != null
        ? Math.round(draft.unvestedShares * draft.currentPrice * 100) / 100
        : 0
    );
    onConfirm({ unvestedRSUValue: finalValue });
    onClose();
  };

  return (
    <div
      style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', zIndex:3000, display:'flex', alignItems:'center', justifyContent:'center' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ background:'var(--bg-card)', border:'1px solid var(--text-muted)', borderRadius:14, padding:'28px 32px', width:460, maxWidth:'95vw', maxHeight:'90vh', overflowY:'auto', boxShadow:'0 16px 48px rgba(0,0,0,0.5)' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20 }}>
          <div style={{ fontWeight:700, fontSize:18, color:'var(--text-primary)' }}>
            {step === 'upload' ? '📄 Import RSU Statement' : '✅ Review Extracted Values'}
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', color:'var(--text-secondary)', fontSize:20, cursor:'pointer', lineHeight:1 }}>×</button>
        </div>

        {/* ── Step 1: Upload ── */}
        {step === 'upload' && (
          <>
            <p style={{ fontSize:13, color:'var(--text-secondary)', marginBottom:20, lineHeight:1.6 }}>
              Upload a Fidelity stock plan statement PDF. All values are shown for review before applying.
            </p>
            <div
              onDrop={handleDrop}
              onDragOver={e => e.preventDefault()}
              onClick={() => inputRef.current?.click()}
              style={{ border:'2px dashed var(--text-muted)', borderRadius:10, padding:'32px 20px', textAlign:'center', cursor:'pointer', background:'var(--bg-page)' }}
              onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--green)'}
              onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--text-muted)'}
            >
              {loading ? (
                <div style={{ color:'var(--text-secondary)', fontSize:14 }}>Extracting text…</div>
              ) : (
                <>
                  <div style={{ fontSize:32, marginBottom:10 }}>📄</div>
                  <div style={{ fontSize:14, color:'var(--text-secondary)', marginBottom:6 }}>Drop PDF here or click to browse</div>
                  <div style={{ fontSize:12, color:'var(--text-muted)' }}>Fidelity RSU / stock plan statement</div>
                </>
              )}
            </div>
            <input ref={inputRef} type="file" accept=".pdf" style={{ display:'none' }} onChange={e => handleFile(e.target.files[0])} />
            {error && <p style={{ color:'var(--red)', fontSize:12, marginTop:12 }}>{error}</p>}
          </>
        )}

        {/* ── Step 2: Review ── */}
        {step === 'review' && draft && (
          <>
            <p style={{ fontSize:13, color:'var(--text-secondary)', marginBottom:16, lineHeight:1.6 }}>
              Review the values extracted from your statement. Edit any field that looks wrong — blank fields weren't found and need manual entry.
            </p>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:16 }}>
              <Field
                label="Ticker"
                type="text"
                value={draft.ticker}
                onChange={v => set('ticker', v)}
                hint={draft.ticker == null ? 'Not found — enter manually' : undefined}
              />
              <Field
                label="Unvested Shares"
                type="number"
                value={draft.unvestedShares}
                onChange={v => set('unvestedShares', v)}
                hint={draft.unvestedShares == null ? 'Not found — enter manually' : undefined}
              />
              <Field
                label="Price Per Share"
                type="number"
                value={draft.currentPrice}
                onChange={v => set('currentPrice', v)}
                prefix="$"
                hint={draft.currentPrice == null ? 'Not found — enter manually' : undefined}
              />
              <Field
                label="Unvested Value"
                type="number"
                value={draft.unvestedValue}
                onChange={v => set('unvestedValue', v)}
                prefix="$"
                hint="Auto-computed from shares × price"
              />
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:20 }}>
              <Field
                label="Next Vest Date"
                type="text"
                value={draft.nextVestDate}
                onChange={v => set('nextVestDate', v)}
                hint={draft.nextVestDate == null ? 'Not found (YYYY-MM-DD)' : undefined}
              />
              <Field
                label="Next Vest Shares"
                type="number"
                value={draft.nextVestShares}
                onChange={v => set('nextVestShares', v)}
                hint={draft.nextVestShares == null ? 'Not found — enter manually' : undefined}
              />
            </div>

            {/* Summary */}
            <div style={{ background:'var(--bg-page)', border:'1px solid var(--bg-raised)', borderRadius:10, padding:'14px 16px', marginBottom:20 }}>
              <div style={{ fontSize:12, color:'var(--text-secondary)', marginBottom:6 }}>Will apply to account:</div>
              <div style={{ fontSize:20, fontWeight:700, color:'var(--green)' }}>
                {draft.unvestedValue != null ? cfmt(draft.unvestedValue) : '—'} unvested RSU value
              </div>
              {draft.ticker && <div style={{ fontSize:12, color:'var(--text-secondary)', marginTop:4 }}>Ticker: {draft.ticker}</div>}
              {draft.nextVestDate && (
                <div style={{ fontSize:12, color:'var(--text-secondary)', marginTop:2 }}>
                  Next vest: {draft.nextVestShares != null ? `${draft.nextVestShares} shares on ` : ''}{draft.nextVestDate}
                </div>
              )}
            </div>

            <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setStep('upload')}>← Back</button>
              <button className="btn btn-primary" onClick={handleConfirm}>Apply to Account</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
