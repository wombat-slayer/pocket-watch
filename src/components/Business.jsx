import { useState, useMemo } from 'react';
import { fmt, fmtDate, download, SCHEDULE_C_LINES } from '../constants.js';
import { useCurrency } from '../hooks/useCurrency.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function periodRange(period, offset = 0) {
  const now = new Date();
  if (period === 'month') {
    const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    const start = d.toISOString().slice(0, 7) + '-01';
    const end   = new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10);
    return { start, end, label: d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) };
  }
  if (period === 'quarter') {
    const q    = Math.floor(now.getMonth() / 3) + offset;
    const yr   = now.getFullYear() + Math.floor(q / 4);
    const qn   = ((q % 4) + 4) % 4;
    const sm   = qn * 3;
    const start = new Date(yr, sm, 1).toISOString().slice(0, 10);
    const end   = new Date(yr, sm + 3, 0).toISOString().slice(0, 10);
    return { start, end, label: `Q${qn + 1} ${yr}` };
  }
  // year
  const yr    = now.getFullYear() + offset;
  return { start: `${yr}-01-01`, end: `${yr}-12-31`, label: String(yr) };
}

function escapeCsv(v) {
  const s = String(v ?? '');
  return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function Business({ accounts, transactions, onUpdateTransaction }) {
  const cfmt = useCurrency();
  const [period,  setPeriod]  = useState('month');
  const [offset,  setOffset]  = useState(0);

  const businessAccounts = useMemo(() => accounts.filter(a => a.isBusiness), [accounts]);

  const { start, end, label } = useMemo(() => periodRange(period, offset), [period, offset]);

  const businessTxs = useMemo(() => {
    const bizIds = new Set(businessAccounts.map(a => a.id));
    return transactions.filter(t =>
      bizIds.has(t.account) &&
      t.date >= start &&
      t.date <= end &&
      t.type !== 'adjustment'
    );
  }, [businessAccounts, transactions, start, end]);

  const revenue  = useMemo(() => businessTxs.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0), [businessTxs]);
  const expenses = useMemo(() => businessTxs.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0), [businessTxs]);
  const net      = revenue - expenses;

  const expenseByCategory = useMemo(() => {
    const map = {};
    businessTxs.filter(t => t.amount < 0).forEach(t => {
      const cat = t.category ?? 'Business - Other';
      map[cat] = (map[cat] || 0) + Math.abs(t.amount);
    });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [businessTxs]);

  // ── Schedule C CSV export ──────────────────────────────────────────────────
  const handleExportScheduleC = () => {
    const rows = ['Schedule C Export,,,'];
    rows.push(`Period: ${label},,,`);
    rows.push('');
    rows.push('SUMMARY');
    rows.push('Category,Schedule C Line,Total,Deductible Amount');
    expenseByCategory.forEach(([cat, total]) => {
      const line   = SCHEDULE_C_LINES[cat] ?? 27;
      const isMeals = cat === 'Business - Meals (50% deductible)';
      const deductible = isMeals ? total * 0.5 : total;
      rows.push([escapeCsv(cat), line, total.toFixed(2), deductible.toFixed(2)].join(','));
    });
    rows.push('');
    rows.push('TRANSACTION DETAIL');
    rows.push('Date,Description,Category,Schedule C Line,Amount');
    businessTxs
      .filter(t => t.amount < 0)
      .sort((a, b) => a.date.localeCompare(b.date))
      .forEach(t => {
        const line = SCHEDULE_C_LINES[t.category] ?? 27;
        rows.push([escapeCsv(t.date), escapeCsv(t.description), escapeCsv(t.category ?? ''), line, Math.abs(t.amount).toFixed(2)].join(','));
      });

    const yr     = start.slice(0, 4);
    const suffix = period === 'month' ? start.slice(0, 7) : period === 'quarter' ? label.replace(' ', '-') : yr;
    download(`schedule-c-${suffix}.csv`, rows.join('\n'), 'text/csv');
  };

  // ── Empty state ────────────────────────────────────────────────────────────
  if (businessAccounts.length === 0) {
    return (
      <div style={{ padding: 32 }}>
        <h1 style={{ fontFamily:'DM Serif Display, serif', fontSize:28, color:'var(--text-primary)', marginBottom: 8 }}>Business</h1>
        <div style={{ background:'var(--bg-card)', border:'1px solid var(--bg-raised)', borderRadius:12, padding:'40px 32px', textAlign:'center', maxWidth:480 }}>
          <div style={{ fontSize:40, marginBottom:12 }}>🏢</div>
          <div style={{ fontSize:16, color:'var(--text-primary)', fontWeight:600, marginBottom:8 }}>No business accounts yet</div>
          <div style={{ fontSize:13, color:'var(--text-secondary)', lineHeight:1.6 }}>
            Mark an account as a "Business account" in Accounts settings to track business income and expenses here.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 32 }}>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:24, flexWrap:'wrap', gap:12 }}>
        <h1 style={{ fontFamily:'DM Serif Display, serif', fontSize:28, color:'var(--text-primary)', margin:0 }}>Business</h1>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          {/* Period type selector */}
          <div style={{ display:'flex', background:'var(--bg-page)', border:'1px solid var(--bg-raised)', borderRadius:8, overflow:'hidden' }}>
            {['month','quarter','year'].map(p => (
              <button key={p} onClick={() => { setPeriod(p); setOffset(0); }}
                style={{ padding:'6px 14px', fontSize:12, fontWeight:600, border:'none', cursor:'pointer', textTransform:'capitalize',
                  background: period === p ? 'var(--bg-raised)' : 'transparent',
                  color:      period === p ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </button>
            ))}
          </div>
          {/* Period navigation */}
          <button className="btn btn-ghost btn-sm" onClick={() => setOffset(o => o - 1)}>‹</button>
          <span style={{ fontSize:13, color:'var(--text-secondary)', minWidth:140, textAlign:'center' }}>{label}</span>
          <button className="btn btn-ghost btn-sm" onClick={() => setOffset(o => o + 1)} disabled={offset >= 0}>›</button>
          {/* Export */}
          <button className="btn btn-secondary" style={{ fontSize:12 }} onClick={handleExportScheduleC}>
            📄 Export Schedule C
          </button>
        </div>
      </div>

      {/* P&L Summary */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:16, marginBottom:28 }}>
        {[
          { label:'Revenue',   value: revenue,   color:'var(--green)' },
          { label:'Expenses',  value:-expenses,  color:'var(--red)' },
          { label:'Net Income',value: net,       color: net >= 0 ? 'var(--green)' : 'var(--red)' },
        ].map(({ label, value, color }) => (
          <div key={label} style={{ background:'var(--bg-card)', border:'1px solid var(--bg-raised)', borderRadius:12, padding:'18px 20px' }}>
            <div style={{ fontSize:12, color:'var(--text-secondary)', marginBottom:6 }}>{label}</div>
            <div style={{ fontSize:22, fontWeight:700, color }}>{cfmt(value)}</div>
          </div>
        ))}
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:20, marginBottom:28, alignItems:'start' }}>
        {/* Expense breakdown */}
        <div style={{ background:'var(--bg-card)', border:'1px solid var(--bg-raised)', borderRadius:12, padding:'18px 20px' }}>
          <div style={{ fontSize:13, fontWeight:600, color:'var(--text-primary)', marginBottom:14 }}>Expense Breakdown</div>
          {expenseByCategory.length === 0 ? (
            <div style={{ fontSize:13, color:'var(--text-muted)' }}>No expenses in this period.</div>
          ) : (
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
              <thead>
                <tr style={{ color:'var(--text-muted)' }}>
                  <th style={{ textAlign:'left',  padding:'4px 0', fontWeight:500 }}>Category</th>
                  <th style={{ textAlign:'center',padding:'4px 6px', fontWeight:500 }}>Sch. C</th>
                  <th style={{ textAlign:'right', padding:'4px 0', fontWeight:500 }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {expenseByCategory.map(([cat, total]) => {
                  const line     = SCHEDULE_C_LINES[cat] ?? 27;
                  const isMeals  = cat === 'Business - Meals (50% deductible)';
                  return (
                    <tr key={cat} style={{ borderTop:'1px solid var(--bg-raised)' }}>
                      <td style={{ padding:'7px 0', color:'var(--text-primary)' }}>
                        {cat.replace('Business - ', '')}
                        {isMeals && <span style={{ fontSize:10, color:'var(--amber)', marginLeft:6 }}>50% deductible</span>}
                      </td>
                      <td style={{ padding:'7px 6px', color:'var(--text-secondary)', textAlign:'center' }}>Ln {line}</td>
                      <td style={{ padding:'7px 0', color:'var(--text-primary)', textAlign:'right', fontWeight:500 }}>
                        {cfmt(total)}
                        {isMeals && <div style={{ fontSize:10, color:'var(--text-secondary)' }}>{cfmt(total * 0.5)} ded.</div>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Transaction list */}
        <div style={{ background:'var(--bg-card)', border:'1px solid var(--bg-raised)', borderRadius:12, padding:'18px 20px' }}>
          <div style={{ fontSize:13, fontWeight:600, color:'var(--text-primary)', marginBottom:14 }}>Transactions ({businessTxs.length})</div>
          {businessTxs.length === 0 ? (
            <div style={{ fontSize:13, color:'var(--text-muted)' }}>No transactions in this period.</div>
          ) : (
            <div style={{ display:'flex', flexDirection:'column', gap:6, maxHeight:380, overflowY:'auto' }}>
              {businessTxs.slice().sort((a,b) => b.date.localeCompare(a.date)).map(t => (
                <div key={t.id} style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 10px', background:'var(--bg-page)', borderRadius:8 }}>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:13, color:'var(--text-primary)', fontWeight:500, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{t.description}</div>
                    <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:2 }}>{fmtDate(t.date)} · {t.category ?? '—'}</div>
                  </div>
                  <div style={{ fontSize:13, fontWeight:600, color: t.amount >= 0 ? 'var(--green)' : 'var(--red)', whiteSpace:'nowrap' }}>
                    {t.amount >= 0 ? '+' : ''}{cfmt(t.amount)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
