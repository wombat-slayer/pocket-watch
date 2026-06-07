import { useState, useMemo } from 'react';
import { fmt, computeMortgagePI } from '../constants.js';

export default function MortgageCalculator({ goal }) {
  const defaultDown = 20;
  // Pre-populate home price: if goal target looks like a down payment, back-compute
  const initPrice = goal?.target ? Math.round(goal.target / (defaultDown / 100) / 10000) * 10000 : 400000;

  const [homePrice,    setHomePrice]    = useState(initPrice);
  const [downPct,      setDownPct]      = useState(defaultDown);
  const [rate,         setRate]         = useState(7.0);
  const [termYears,    setTermYears]    = useState(30);
  const [taxInsurance, setTaxInsurance] = useState(400);

  const downAmount   = useMemo(() => Math.round(homePrice * downPct / 100), [homePrice, downPct]);
  const principal    = homePrice - downAmount;
  const pi           = useMemo(() => computeMortgagePI(principal, rate, termYears), [principal, rate, termYears]);
  const totalMonthly = pi + taxInsurance;
  const closingCosts = Math.round(homePrice * 0.03);
  const cashAtClose  = downAmount + closingCosts;
  const currentSaved = goal?.current ?? 0;
  const stillNeeded  = Math.max(0, cashAtClose - currentSaved);

  const scenarios = [
    { label: 'Conservative', rate: rate + 1,    downPct, term: 30 },
    { label: 'Current',      rate,               downPct, term: termYears },
    { label: 'Aggressive',   rate: rate - 0.5,  downPct: Math.min(40, downPct + 5), term: 15 },
  ].map(s => {
    const dn    = Math.round(homePrice * s.downPct / 100);
    const prin  = homePrice - dn;
    const mpi   = computeMortgagePI(prin, Math.max(0.1, s.rate), s.term);
    return { ...s, mpi, total: mpi + taxInsurance, cashAtClose: dn + closingCosts };
  });

  return (
    <div style={{ marginTop: 12, background: '#0d1117', borderRadius: 8, padding: 14, border: '1px solid #1e2736' }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: '#94a3b8', marginBottom: 12 }}>🏠 Mortgage Calculator</div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
        <div className="form-group" style={{ margin: 0 }}>
          <label className="form-label" style={{ fontSize: 11 }}>Home Price ($)</label>
          <input type="number" value={homePrice} onChange={e => setHomePrice(Number(e.target.value))} min={50000} step={5000} style={{ fontSize: 13 }} />
        </div>
        <div className="form-group" style={{ margin: 0 }}>
          <label className="form-label" style={{ fontSize: 11 }}>Down Payment %</label>
          <input type="number" value={downPct} onChange={e => setDownPct(Number(e.target.value))} min={3} max={100} step={1} style={{ fontSize: 13 }} />
        </div>
        <div className="form-group" style={{ margin: 0 }}>
          <label className="form-label" style={{ fontSize: 11 }}>Interest Rate %</label>
          <input type="number" value={rate} onChange={e => setRate(Number(e.target.value))} min={0.1} max={20} step={0.1} style={{ fontSize: 13 }} />
        </div>
        <div className="form-group" style={{ margin: 0 }}>
          <label className="form-label" style={{ fontSize: 11 }}>Term</label>
          <select value={termYears} onChange={e => setTermYears(Number(e.target.value))} style={{ fontSize: 13 }}>
            {[10, 15, 20, 25, 30].map(y => <option key={y} value={y}>{y} yr</option>)}
          </select>
        </div>
        <div className="form-group" style={{ margin: 0, gridColumn: '1 / -1' }}>
          <label className="form-label" style={{ fontSize: 11 }}>Est. Tax + Insurance / mo</label>
          <input type="number" value={taxInsurance} onChange={e => setTaxInsurance(Number(e.target.value))} min={0} step={50} style={{ fontSize: 13, width: '100%' }} />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 8, marginBottom: 14 }}>
        {[
          { label: 'Principal & Interest', value: fmt(pi),           color: '#c2735a' },
          { label: 'Total Monthly',        value: fmt(totalMonthly), color: '#e2e8f0' },
          { label: 'Down Payment',         value: fmt(downAmount),   color: '#94a3b8' },
          { label: 'Cash to Close (~3%)',  value: fmt(cashAtClose),  color: '#94a3b8' },
        ].map(r => (
          <div key={r.label} style={{ background: '#161d2b', borderRadius: 6, padding: '8px 12px' }}>
            <div style={{ fontSize: 10, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>{r.label}</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: r.color }}>{r.value}</div>
          </div>
        ))}
      </div>

      {goal && (
        <div style={{ fontSize: 12, color: stillNeeded > 0 ? '#64748b' : '#4ade80', marginBottom: 12, background: '#1e273640', borderRadius: 6, padding: '6px 10px' }}>
          {stillNeeded > 0
            ? `Goal progress: ${fmt(currentSaved)} saved · ${fmt(stillNeeded)} still needed for cash-to-close`
            : `✓ Goal covers cash-to-close (${fmt(currentSaved)} saved)`
          }
        </div>
      )}

      <div style={{ fontSize: 11, fontWeight: 600, color: '#64748b', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Scenario Comparison</div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid #1e2736' }}>
            {['Scenario', 'Rate', 'Down', 'P&I/mo', 'Total/mo', 'Cash to Close'].map(h => (
              <th key={h} style={{ textAlign: h === 'Scenario' ? 'left' : 'right', padding: '4px 8px', color: '#64748b', fontWeight: 600, fontSize: 10, textTransform: 'uppercase' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {scenarios.map(s => (
            <tr key={s.label} style={{ borderBottom: '1px solid #0d1117', background: s.label === 'Current' ? '#7fa88b11' : 'transparent' }}>
              <td style={{ padding: '6px 8px', color: '#94a3b8', fontWeight: s.label === 'Current' ? 600 : 400 }}>{s.label}</td>
              <td style={{ padding: '6px 8px', textAlign: 'right', color: '#64748b' }}>{s.rate.toFixed(1)}%</td>
              <td style={{ padding: '6px 8px', textAlign: 'right', color: '#64748b' }}>{s.downPct}%</td>
              <td style={{ padding: '6px 8px', textAlign: 'right', color: '#c2735a' }}>{fmt(s.mpi)}</td>
              <td style={{ padding: '6px 8px', textAlign: 'right', color: '#e2e8f0', fontWeight: 600 }}>{fmt(s.total)}</td>
              <td style={{ padding: '6px 8px', textAlign: 'right', color: '#94a3b8' }}>{fmt(s.cashAtClose)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
