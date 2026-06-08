import { useState, useRef } from 'react';
import { extractPdfText } from '../utils/extractPdfText.js';
import { parsePayStub, toMonthly, calcEffectiveTaxRate } from '../utils/parsePayStub.js';

const FREQUENCIES = [
  { value: 'biweekly',    label: 'Biweekly (every 2 weeks)' },
  { value: 'semimonthly', label: 'Semi-monthly (twice/month)' },
  { value: 'weekly',      label: 'Weekly' },
  { value: 'monthly',     label: 'Monthly' },
];

function buildDraft(parsed, frequency) {
  const gross = parsed.grossPerPeriod ?? 0;
  return {
    grossMonthlySalary:  +toMonthly(parsed.grossPerPeriod, frequency).toFixed(2),
    retirement401kPct:   gross > 0 && parsed.retirement401k != null
      ? +((parsed.retirement401k / gross) * 100).toFixed(1)
      : null,
    hsaMonthly:          +toMonthly(parsed.hsa, frequency).toFixed(2),
    effectiveTaxRate:    calcEffectiveTaxRate(parsed.federalTax, parsed.stateTax, gross),
    medicalMonthly:      parsed.medical != null ? +toMonthly(parsed.medical, frequency).toFixed(2) : null,
    dentalMonthly:       parsed.dental  != null ? +toMonthly(parsed.dental,  frequency).toFixed(2) : null,
    visionMonthly:       parsed.vision  != null ? +toMonthly(parsed.vision,  frequency).toFixed(2) : null,
  };
}

function Field({ label, value, onChange, step = '0.01', min = '0', suffix }) {
  return (
    <div className="form-group">
      <label className="form-label">{label}</label>
      <div style={{ display:'flex', alignItems:'center', gap:6 }}>
        <input
          type="number"
          min={min}
          step={step}
          value={value ?? ''}
          placeholder="—"
          onChange={e => onChange(e.target.value === '' ? null : +e.target.value)}
          style={{ flex:1 }}
        />
        {suffix && <span style={{ fontSize:13, color:'var(--text-secondary)', flexShrink:0 }}>{suffix}</span>}
      </div>
    </div>
  );
}

export default function PayStubImportModal({ compensationProfile = {}, onSetCompensationProfile, onClose }) {
  const [step,      setStep]      = useState('upload'); // 'upload' | 'review'
  const [frequency, setFrequency] = useState('biweekly');
  const [parsed,    setParsed]    = useState(null);
  const [draft,     setDraft]     = useState(null);
  const [error,     setError]     = useState('');
  const [loading,   setLoading]   = useState(false);
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
      const result = parsePayStub(text);
      setParsed(result);
      setDraft(buildDraft(result, frequency));
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

  const onFrequencyChange = (freq) => {
    setFrequency(freq);
    if (parsed) setDraft(buildDraft(parsed, freq));
  };

  const handleApply = () => {
    const next = {
      ...compensationProfile,
      grossMonthlySalary:    draft.grossMonthlySalary    ?? compensationProfile.grossMonthlySalary    ?? 0,
      retirement401kPct:     draft.retirement401kPct     ?? compensationProfile.retirement401kPct     ?? 0,
      hsaMonthly:            draft.hsaMonthly            ?? compensationProfile.hsaMonthly            ?? 0,
      effectiveTaxRate:      draft.effectiveTaxRate       ?? compensationProfile.effectiveTaxRate      ?? 0,
      medicalMonthly:        draft.medicalMonthly         ?? compensationProfile.medicalMonthly        ?? 0,
      dentalMonthly:         draft.dentalMonthly          ?? compensationProfile.dentalMonthly         ?? 0,
      visionMonthly:         draft.visionMonthly          ?? compensationProfile.visionMonthly         ?? 0,
    };
    onSetCompensationProfile(next);
    onClose();
  };

  const setDraftField = (key, val) => setDraft(d => ({ ...d, [key]: val }));

  return (
    <div
      style={{
        position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', zIndex:2000,
        display:'flex', alignItems:'center', justifyContent:'center',
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background:'var(--bg-card)', border:'1px solid var(--text-muted)', borderRadius:14,
        padding:'28px 32px', width:480, maxWidth:'95vw', maxHeight:'90vh',
        overflowY:'auto', boxShadow:'0 16px 48px rgba(0,0,0,0.5)',
      }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20 }}>
          <div style={{ fontWeight:700, fontSize:18, color:'var(--text-primary)' }}>
            {step === 'upload' ? '📄 Import Pay Stub' : '✅ Review Extracted Values'}
          </div>
          <button
            onClick={onClose}
            style={{ background:'none', border:'none', color:'var(--text-secondary)', fontSize:20, cursor:'pointer', lineHeight:1 }}
          >×</button>
        </div>

        {/* ── Step 1: Upload ── */}
        {step === 'upload' && (
          <>
            <p style={{ fontSize:13, color:'var(--text-secondary)', marginBottom:20, lineHeight:1.6 }}>
              Supports ADP format (PDF). All values are shown for review before saving.
            </p>

            {/* Frequency selector */}
            <div className="form-group" style={{ marginBottom:20 }}>
              <label className="form-label">Pay Frequency</label>
              <select value={frequency} onChange={e => setFrequency(e.target.value)}>
                {FREQUENCIES.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
            </div>

            {/* Drop zone */}
            <div
              onDrop={handleDrop}
              onDragOver={e => e.preventDefault()}
              onClick={() => inputRef.current?.click()}
              style={{
                border:'2px dashed var(--text-muted)', borderRadius:10, padding:'32px 20px',
                textAlign:'center', cursor:'pointer', transition:'border-color 0.15s',
                background:'var(--bg-page)',
              }}
              onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--green)'}
              onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--text-muted)'}
            >
              {loading ? (
                <div style={{ color:'var(--text-secondary)', fontSize:14 }}>Extracting text…</div>
              ) : (
                <>
                  <div style={{ fontSize:32, marginBottom:10 }}>📄</div>
                  <div style={{ fontSize:14, color:'var(--text-secondary)', marginBottom:6 }}>
                    Drop PDF here or click to browse
                  </div>
                  <div style={{ fontSize:12, color:'var(--text-muted)' }}>PDF pay stub only</div>
                </>
              )}
            </div>
            <input
              ref={inputRef}
              type="file"
              accept=".pdf"
              style={{ display:'none' }}
              onChange={e => handleFile(e.target.files[0])}
            />

            {error && (
              <div style={{ marginTop:14, padding:'10px 14px', background:'#c2735a22', border:'1px solid #c2735a44', borderRadius:8, fontSize:13, color:'var(--red)' }}>
                {error}
              </div>
            )}

            <div style={{ display:'flex', justifyContent:'flex-end', marginTop:20 }}>
              <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
            </div>
          </>
        )}

        {/* ── Step 2: Review ── */}
        {step === 'review' && draft && (
          <>
            {/* Frequency selector stays interactive */}
            <div className="form-group" style={{ marginBottom:16 }}>
              <label className="form-label">Pay Frequency</label>
              <select value={frequency} onChange={e => onFrequencyChange(e.target.value)}>
                {FREQUENCIES.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
            </div>

            <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
              <Field
                label="Gross Monthly Salary ($)"
                value={draft.grossMonthlySalary}
                onChange={v => setDraftField('grossMonthlySalary', v)}
                step="1"
              />
              <Field
                label="401(k) % of Gross"
                value={draft.retirement401kPct}
                onChange={v => setDraftField('retirement401kPct', v)}
                step="0.1"
                suffix="%"
              />
              <Field
                label="HSA Monthly ($)"
                value={draft.hsaMonthly}
                onChange={v => setDraftField('hsaMonthly', v)}
                step="1"
              />
              <Field
                label="Effective Tax Rate"
                value={draft.effectiveTaxRate}
                onChange={v => setDraftField('effectiveTaxRate', v)}
                step="0.1"
                suffix="%"
              />
              <Field
                label="Medical Premium ($/period)"
                value={draft.medicalMonthly}
                onChange={v => setDraftField('medicalMonthly', v)}
                step="1"
              />
              <Field
                label="Dental Premium ($/period)"
                value={draft.dentalMonthly}
                onChange={v => setDraftField('dentalMonthly', v)}
                step="1"
              />
              <Field
                label="Vision Premium ($/period)"
                value={draft.visionMonthly}
                onChange={v => setDraftField('visionMonthly', v)}
                step="1"
              />
            </div>

            <p style={{ fontSize:12, color:'var(--text-muted)', marginTop:14, lineHeight:1.6 }}>
              These values will populate Settings → Compensation Profile. You can edit them there at any time.
            </p>

            <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:20 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => { setStep('upload'); setError(''); }}>← Back</button>
              <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
              <button className="btn btn-primary" onClick={handleApply}>Apply to Compensation Profile</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
