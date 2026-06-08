import { useState, useMemo, useEffect, Fragment } from 'react';
import { getAllCategories, catIcon, fmt, fmtDate, parseAmount, download } from '../constants.js';
import { useCurrency } from '../hooks/useCurrency.js';
import * as XLSX from 'xlsx';
import Modal from './Modal.jsx';
import TransactionForm from './TransactionForm.jsx';
import CSVImport from './CSVImport.jsx';
import CategoryIcon from './CategoryIcon.jsx';
import { Download, Search, Pencil, Trash2, RefreshCw, Check, CreditCard, Shuffle, ArrowRightLeft } from 'lucide-react';

// Persist filter state across navigation using sessionStorage
const FILTER_KEY = 'pw_tx_filters';
function loadFilters() {
  try { return JSON.parse(sessionStorage.getItem(FILTER_KEY) || '{}'); } catch { return {}; }
}
function saveFilters(patch) {
  try {
    const cur = loadFilters();
    sessionStorage.setItem(FILTER_KEY, JSON.stringify({ ...cur, ...patch }));
  } catch {}
}

export default function Transactions({ transactions, accounts, onAdd, onEdit, onDelete, onBulkDelete, onCSVImport, existingTxs, initialCatFilter, onClearCatFilter, userCategories, archivedTransactions = [], onRestoreArchive, recurrences = [], lastSyncResult, onDismissSyncResult, dataPath, importKey = 0 }) {
  const cfmt = useCurrency();
  const saved = loadFilters();
  const [search,      setSearch]      = useState(saved.search      ?? '');
  const [catFilter,   setCatFilter]   = useState(() => initialCatFilter && initialCatFilter !== 'All' ? initialCatFilter : (saved.catFilter ?? 'All'));
  const [typeFilter,  setTypeFilter]  = useState(saved.typeFilter  ?? 'All');
  const [monthFilter, setMonthFilter] = useState(saved.monthFilter ?? 'All');
  const [acctFilter,  setAcctFilter]  = useState(saved.acctFilter  ?? 'All');
  const [dateFrom,    setDateFrom]    = useState(saved.dateFrom    ?? '');
  const [dateTo,      setDateTo]      = useState(saved.dateTo      ?? '');
  const [tagFilter,   setTagFilter]   = useState(saved.tagFilter   ?? 'All');
  const [showAdvanced, setShowAdvanced] = useState(saved.showAdvanced ?? false);
  const [recurringOnly, setRecurringOnly] = useState(saved.recurringOnly ?? false);
  const [reviewMode,    setReviewMode]    = useState(false); // post-sync "needs a category" filter

  // Persist filter changes to sessionStorage
  useEffect(() => { saveFilters({ search });       }, [search]);
  useEffect(() => { saveFilters({ catFilter });    }, [catFilter]);
  useEffect(() => { saveFilters({ typeFilter });   }, [typeFilter]);
  useEffect(() => { saveFilters({ monthFilter });  }, [monthFilter]);
  useEffect(() => { saveFilters({ acctFilter });   }, [acctFilter]);
  useEffect(() => { saveFilters({ dateFrom });     }, [dateFrom]);
  useEffect(() => { saveFilters({ dateTo });       }, [dateTo]);
  useEffect(() => { saveFilters({ tagFilter });    }, [tagFilter]);
  useEffect(() => { saveFilters({ showAdvanced }); }, [showAdvanced]);
  useEffect(() => { saveFilters({ recurringOnly }); }, [recurringOnly]);

  // Sync catFilter when drill-down arrives from Reports
  useEffect(() => {
    if (initialCatFilter && initialCatFilter !== 'All') {
      setCatFilter(initialCatFilter);
    }
  }, [initialCatFilter]);

  // Reset to page 1 after any import so newly imported transactions are visible
  useEffect(() => { setPage(0); }, [importKey]);

  const [showCSV,     setShowCSV]     = useState(false);
  const [showAdd,     setShowAdd]     = useState(false);
  const [editTx,      setEditTx]      = useState(null);
  const [page,        setPage]        = useState(0);
  const [selected,    setSelected]    = useState(new Set());
  const [editCell,    setEditCell]    = useState(null);
  const [cellVal,     setCellVal]     = useState('');
  const [expandedSplit, setExpandedSplit] = useState(new Set());
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const PER = 50;

  // Debounce search input by 200ms to avoid filtering on every keystroke
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 200);
    return () => clearTimeout(t);
  }, [search]);

  const months = useMemo(() => {
    const s = new Set(transactions.map(t => t.date.slice(0,7)));
    return ['All', ...Array.from(s).sort().reverse()];
  }, [transactions]);

  const allTags = useMemo(() => {
    const set = new Set();
    transactions.forEach(t => (t.tags || []).forEach(tag => set.add(tag)));
    return ['All', ...Array.from(set).sort()];
  }, [transactions]);

  // Lowercased recurrence rule descriptions, for the Recurring filter toggle
  const recurDescs = useMemo(() =>
    new Set(recurrences.map(r => (r.description || '').toLowerCase()).filter(Boolean)),
  [recurrences]);

  // Plaid imports that landed in the fallback 'Other' category (need review)
  const uncategorizedCount = useMemo(() =>
    transactions.filter(t => t._plaid && t.category === 'Other').length,
  [transactions]);

  const filtered = useMemo(() => transactions.filter(t => {
    if (t.type === 'adjustment' && typeFilter !== 'adjustment') return false;
    if (debouncedSearch && !t.description.toLowerCase().includes(debouncedSearch.toLowerCase())) return false;
    if (catFilter  !== 'All' && t.category !== catFilter)         return false;
    if (typeFilter !== 'All' && t.type     !== typeFilter)        return false;
    if (monthFilter!== 'All' && !t.date.startsWith(monthFilter)) return false;
    if (acctFilter !== 'All' && t.account  !== acctFilter)       return false;
    if (dateFrom    && t.date < dateFrom)                         return false;
    if (dateTo      && t.date > dateTo)                           return false;
    if (tagFilter !== 'All' && !(t.tags || []).includes(tagFilter)) return false;
    if (recurringOnly && !(t.recurringId || recurDescs.has((t.description || '').toLowerCase()))) return false;
    if (reviewMode && !(t._plaid && t.category === 'Other')) return false;
    return true;
  }), [transactions, debouncedSearch, catFilter, typeFilter, monthFilter, acctFilter, dateFrom, dateTo, tagFilter, recurringOnly, recurDescs, reviewMode]);

  const pages    = Math.max(1, Math.ceil(filtered.length / PER));
  const safePage = Math.min(page, pages - 1);
  const paged    = filtered.slice(safePage*PER, (safePage+1)*PER);
  const acctName = (id) => accounts.find(a=>a.id===id)?.name ?? '—';

  const clearFilters = () => {
    setSearch(''); setCatFilter('All'); setTypeFilter('All');
    setMonthFilter('All'); setAcctFilter('All');
    setDateFrom(''); setDateTo(''); setTagFilter('All');
    setRecurringOnly(false); setReviewMode(false);
    setPage(0);
    if (onClearCatFilter) onClearCatFilter();
  };
  const hasFilters = search || catFilter!=='All' || typeFilter!=='All' || monthFilter!=='All'
    || acctFilter!=='All' || dateFrom || dateTo || tagFilter!=='All' || recurringOnly || reviewMode;
  const hasAdvancedFilters = dateFrom || dateTo || tagFilter !== 'All';

  const runningBalances = useMemo(() => {
    if (acctFilter === 'All') return null;
    const acct = accounts.find(a => a.id === acctFilter);
    if (!acct) return null;
    const acctTxs = transactions
      .filter(t => t.account === acctFilter)
      .sort((a,b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
    let bal = acct.balance;
    const map = {};
    for (const tx of acctTxs) { map[tx.id] = bal; bal -= tx.amount; }
    return map;
  }, [transactions, acctFilter, accounts]);

  const allPageIds   = paged.map(t => t.id);
  const allSelected  = allPageIds.length > 0 && allPageIds.every(id => selected.has(id));
  const someSelected = allPageIds.some(id => selected.has(id));
  const selectedCount= selected.size;

  const toggleAll = () => setSelected(s => {
    const n = new Set(s);
    if (allSelected) allPageIds.forEach(id => n.delete(id));
    else             allPageIds.forEach(id => n.add(id));
    return n;
  });
  const toggleOne = (id) => setSelected(s => { const n = new Set(s); n.has(id)?n.delete(id):n.add(id); return n; });
  const clearSel  = ()   => setSelected(new Set());

  const handleBulkDelete = () => {
    if (!confirm(`Delete ${selectedCount} transaction${selectedCount>1?'s':''}? This cannot be undone.`)) return;
    onBulkDelete([...selected]);
    clearSel();
  };

  const startEdit  = (tx, field) => { setEditCell({ id:tx.id, field }); setCellVal(field==='amount'?Math.abs(tx.amount).toString():String(tx[field])); };
  const commitCell = (tx) => {
    if (!editCell || editCell.id !== tx.id) return;
    const { field } = editCell;
    let value = cellVal.trim();
    if (!value) { setEditCell(null); return; }
    if (field === 'amount') {
      const v = parseAmount(value);
      if (isNaN(v)) { setEditCell(null); return; }
      value = tx.type === 'expense' ? -Math.abs(v) : Math.abs(v);
    }
    onEdit({ ...tx, [field]: value });
    setEditCell(null);
  };
  const cancelCell = () => setEditCell(null);
  const isEditing  = (tx, field) => editCell?.id === tx.id && editCell?.field === field;

  const toggleSplitExpand = (id) => setExpandedSplit(s => {
    const n = new Set(s);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });

  const exportCSV = () => {
    const header = ['Date','Description','Category','Amount','Type','Account','Notes','Tags'];
    const rows = filtered.map(t => [
      t.date, t.description, t.category, t.amount, t.type, acctName(t.account),
      t.notes ?? '', (t.tags ?? []).join(';'),
    ].map(v => `"${String(v).replace(/"/g,'""')}"`).join(','));
    download('transactions-export.csv', [header.join(','), ...rows].join('\n'), 'text/csv');
  };

  const exportXLSX = () => {
    const wb = XLSX.utils.book_new();

    // ── Sheet 1: All filtered transactions ─────────────────────────────────
    const txRows = filtered.map(t => ({
      Date:           t.date,
      Description:    t.description,
      Category:       t.category,
      Amount:         t.amount,
      Type:           t.type,
      Account:        acctName(t.account),
      Notes:          t.notes ?? '',
      Tags:           (t.tags ?? []).join(', '),
      'Tax Deductible': t.taxDeductible ? 'Yes' : 'No',
    }));
    const wsTx = XLSX.utils.json_to_sheet(txRows);
    wsTx['!cols'] = [{ wch:12 },{ wch:36 },{ wch:20 },{ wch:12 },{ wch:10 },{ wch:20 },{ wch:28 },{ wch:20 },{ wch:14 }];
    XLSX.utils.book_append_sheet(wb, wsTx, 'Transactions');

    // ── Sheet 2: Monthly summary ────────────────────────────────────────────
    const monthMap = {};
    filtered.forEach(t => {
      const mo = t.date.slice(0, 7);
      if (!monthMap[mo]) monthMap[mo] = { income: 0, expenses: 0 };
      if (t.type === 'income')   monthMap[mo].income   += t.amount;
      if (t.type === 'expense')  monthMap[mo].expenses += Math.abs(t.amount);
    });
    const moRows = Object.entries(monthMap)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([mo, { income, expenses }]) => ({
        Month:    mo,
        Income:   parseFloat(income.toFixed(2)),
        Expenses: parseFloat(expenses.toFixed(2)),
        Net:      parseFloat((income - expenses).toFixed(2)),
      }));
    const wsMo = XLSX.utils.json_to_sheet(moRows);
    wsMo['!cols'] = [{ wch:10 },{ wch:14 },{ wch:14 },{ wch:14 }];
    XLSX.utils.book_append_sheet(wb, wsMo, 'Monthly Summary');

    // ── Sheet 3: By category ────────────────────────────────────────────────
    const catMap = {};
    filtered.filter(t => t.type === 'expense').forEach(t => {
      const c = t.category || 'Other';
      if (!catMap[c]) catMap[c] = { total: 0, count: 0 };
      catMap[c].total += Math.abs(t.amount);
      catMap[c].count += 1;
    });
    const catRows = Object.entries(catMap)
      .sort((a, b) => b[1].total - a[1].total)
      .map(([cat, { total, count }]) => ({
        Category: cat,
        Transactions: count,
        Total: parseFloat(total.toFixed(2)),
        Average: parseFloat((total / count).toFixed(2)),
      }));
    const wsCat = XLSX.utils.json_to_sheet(catRows);
    wsCat['!cols'] = [{ wch:22 },{ wch:14 },{ wch:14 },{ wch:14 }];
    XLSX.utils.book_append_sheet(wb, wsCat, 'By Category');

    // ── Download ────────────────────────────────────────────────────────────
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    download('pocket-watch-export.xlsx', buf, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  };

  return (
    <div className="fade-in" style={{ padding:'24px 28px' }}>
      <div className="section-header">
        <div>
          <div className="section-title">Transactions</div>
          <div className="section-sub">Showing {filtered.length} of {transactions.length} transactions</div>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <button className="btn btn-secondary" onClick={exportCSV}><Download size={14} strokeWidth={1.5} style={{ verticalAlign:'text-bottom' }} /> CSV</button>
          <button className="btn btn-secondary" onClick={exportXLSX}><Download size={14} strokeWidth={1.5} style={{ verticalAlign:'text-bottom' }} /> Excel</button>
          <button className="btn btn-secondary" onClick={() => setShowCSV(true)}><Download size={14} strokeWidth={1.5} style={{ verticalAlign:'text-bottom' }} /> Import</button>
          <button className="btn btn-primary"   onClick={() => setShowAdd(true)}>+ Add</button>
        </div>
      </div>

      {/* Archive banner */}
      {archivedTransactions.length > 0 && (
        <div style={{ background:'#8b5cf611', border:'1px solid #8b5cf633', borderRadius:8, padding:'8px 14px', marginBottom:12, display:'flex', alignItems:'center', gap:12, fontSize:13 }}>
          <span style={{ color:'var(--accent-2)' }}>🗃 {archivedTransactions.length.toLocaleString()} transaction{archivedTransactions.length!==1?'s':''} are archived and hidden from this view.</span>
          <button className="btn btn-ghost btn-sm" style={{ fontSize:11, color:'var(--accent-2)', border:'1px solid #8b5cf644', marginLeft:'auto' }}
            onClick={() => { if (window.confirm(`Restore ${archivedTransactions.length} archived transactions?`)) onRestoreArchive?.(); }}>
            ↩ Restore
          </button>
        </div>
      )}

      {/* Post-sync review banner */}
      {lastSyncResult && lastSyncResult.uncategorized > 0 && uncategorizedCount > 0 && (
        <div style={{ background:'#14532d22', border:'1px solid #14532d66', borderRadius:8, padding:'8px 14px', marginBottom:12, display:'flex', alignItems:'center', gap:12, fontSize:13 }}>
          <span style={{ color:'var(--green)' }}>
            ✓ {lastSyncResult.count} transaction{lastSyncResult.count !== 1 ? 's' : ''} synced
            {' '}· <strong>{uncategorizedCount}</strong> need{uncategorizedCount === 1 ? 's' : ''} a category
          </span>
          <button
            className="btn btn-ghost btn-sm"
            style={{ fontSize:11, color:'var(--green)', border:'1px solid #14532d88', marginLeft:'auto' }}
            onClick={() => { setReviewMode(true); setPage(0); }}
          >
            Review
          </button>
          <button
            className="btn btn-ghost btn-sm"
            style={{ fontSize:11, color:'var(--text-secondary)' }}
            title="Dismiss"
            onClick={() => { setReviewMode(false); onDismissSyncResult?.(); }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Filters */}
      <div className="card" style={{ marginBottom:16, padding:14 }}>
        {/* Primary filter row */}
        <div className="filter-bar" style={{ flexWrap:'wrap', gap:8 }}>
          <input type="text" placeholder="Search…" value={search}
            onChange={e=>{ setSearch(e.target.value); setPage(0); }} style={{ width:190 }} />
          <select value={monthFilter} onChange={e=>{ setMonthFilter(e.target.value); setPage(0); }} style={{ width:150 }}>
            {months.map(m => <option key={m} value={m}>{m==='All'?'All Months':new Date(m+'-01').toLocaleDateString('en-US',{month:'long',year:'numeric'})}</option>)}
          </select>
          <select value={acctFilter} onChange={e=>{ setAcctFilter(e.target.value); setPage(0); }} style={{ width:148 }}>
            <option value="All">All Accounts</option>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <select value={catFilter} onChange={e=>{ setCatFilter(e.target.value); setPage(0); }} style={{ width:158 }}>
            <option value="All">All Categories</option>
            {getAllCategories(userCategories).map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
          </select>
          <select value={typeFilter} onChange={e=>{ setTypeFilter(e.target.value); setPage(0); }} style={{ width:130 }}>
            <option value="All">All Types</option>
            <option value="expense">Expense</option>
            <option value="income">Income</option>
            <option value="adjustment">Adjustment</option>
          </select>
          {recurrences.length > 0 && (
            <button
              className="btn btn-ghost btn-sm"
              style={{ fontSize:12, color: recurringOnly ? 'var(--green)' : 'var(--text-secondary)', border: recurringOnly ? '1px solid #7fa88b55' : undefined }}
              onClick={() => { setRecurringOnly(v => !v); setPage(0); }}
              title="Show only transactions matching a recurring rule"
            >
              <RefreshCw size={12} strokeWidth={2} style={{ verticalAlign:'text-bottom' }} /> Recurring{recurringOnly ? ' ●' : ''}
            </button>
          )}
          {reviewMode && (
            <button
              className="btn btn-ghost btn-sm"
              style={{ fontSize:12, color:'var(--green)', border:'1px solid #14532d88' }}
              onClick={() => { setReviewMode(false); setPage(0); }}
              title="Showing only synced transactions that need a category"
            >
              <Check size={12} strokeWidth={2} style={{ verticalAlign:'text-bottom' }} /> Needs category ●
            </button>
          )}
          <button
            className={`btn btn-ghost btn-sm${hasAdvancedFilters ? '' : ''}`}
            style={{ fontSize:12, color: hasAdvancedFilters ? 'var(--green)' : 'var(--text-secondary)', border: hasAdvancedFilters ? '1px solid #7fa88b55' : undefined }}
            onClick={() => setShowAdvanced(v => !v)}
            title="Date range and tag filters"
          >
            {showAdvanced ? '▲' : '▼'} Advanced{hasAdvancedFilters ? ' ●' : ''}
          </button>
          {hasFilters && <button className="btn btn-ghost btn-sm" style={{ color:'var(--red)' }} onClick={clearFilters}>✕ Clear</button>}
        </div>

        {/* Advanced filter row (collapsible) */}
        {(showAdvanced || hasAdvancedFilters) && (
          <div className="filter-bar" style={{ flexWrap:'wrap', gap:8, marginTop:8, paddingTop:8, borderTop:'1px solid var(--bg-raised)' }}>
            <input type="date" title="From date" value={dateFrom}
              onChange={e=>{ setDateFrom(e.target.value); setPage(0); }} style={{ width:145 }} />
            <span style={{ color:'var(--text-muted)', fontSize:13, alignSelf:'center' }}>→</span>
            <input type="date" title="To date" value={dateTo}
              onChange={e=>{ setDateTo(e.target.value); setPage(0); }} style={{ width:145 }} />
            {allTags.length > 1 && (
              <select value={tagFilter} onChange={e=>{ setTagFilter(e.target.value); setPage(0); }} style={{ fontSize:13, width:160 }}>
                {allTags.map(tag => <option key={tag} value={tag}>{tag === 'All' ? '🏷 All Tags' : `#${tag}`}</option>)}
              </select>
            )}
          </div>
        )}
      </div>

      {/* Table */}
      <div className="card" style={{ padding:0, overflow:'hidden', position:'relative' }}>
        {filtered.length === 0
          ? transactions.length === 0
            ? (
              <div style={{ padding:'48px 32px', textAlign:'center' }}>
                <div style={{ marginBottom:12, color:'var(--text-muted)' }}><CreditCard size={48} strokeWidth={1} /></div>
                <div style={{ fontSize:17, fontWeight:600, color:'var(--text-primary)', marginBottom:8 }}>No transactions yet</div>
                <div style={{ fontSize:13, color:'var(--text-secondary)', marginBottom:24, maxWidth:360, margin:'0 auto 24px' }}>
                  Add transactions manually, or import bank statements from the Accounts page to load months or years of history at once.
                </div>
                <div style={{ display:'flex', gap:10, justifyContent:'center' }}>
                  <button className="btn btn-primary" onClick={() => setShowAdd(true)}>+ Add Transaction</button>
                  <button className="btn btn-secondary" onClick={() => setShowCSV(true)}><Download size={14} strokeWidth={1.5} style={{ verticalAlign:'text-bottom' }} /> Import</button>
                </div>
              </div>
            )
            : <div className="empty-state"><div className="empty-icon"><Search size={40} strokeWidth={1} /></div><p>No transactions match your filters</p></div>
          : <>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th style={{ width:36, padding:'10px 8px 10px 16px' }}>
                        <input type="checkbox" checked={allSelected}
                          ref={el => { if (el) el.indeterminate = someSelected && !allSelected; }}
                          onChange={toggleAll} />
                      </th>
                      <th>Date</th><th>Description</th><th>Category</th><th>Account</th>
                      <th style={{ textAlign:'right' }}>Amount</th>
                      {runningBalances && <th style={{ textAlign:'right' }}>Balance</th>}
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {paged.map(t => {
                      const isSplit    = t.splits?.length > 0;
                      const isTransfer = t.category === 'Transfer' || !!t.transferPairId;
                      const isExpanded = expandedSplit.has(t.id);
                      return (
                        <Fragment key={t.id}>
                          <tr className={selected.has(t.id)?'row-selected':''}>
                            <td style={{ width:36, padding:'10px 8px 10px 16px' }} onClick={e=>e.stopPropagation()}>
                              <input type="checkbox" checked={selected.has(t.id)} onChange={()=>toggleOne(t.id)} />
                            </td>
                            <td className="cell-editable" onClick={()=>startEdit(t,'date')}>
                              {isEditing(t,'date')
                                ? <input className="inline-input" type="date" autoFocus value={cellVal}
                                    onChange={e=>setCellVal(e.target.value)} onBlur={()=>commitCell(t)}
                                    onKeyDown={e=>{if(e.key==='Enter')commitCell(t);if(e.key==='Escape')cancelCell();}}
                                    onClick={e=>e.stopPropagation()} style={{ width:130 }} />
                                : <span style={{ color:'var(--text-secondary)',fontSize:13,whiteSpace:'nowrap' }}>{fmtDate(t.date)}</span>}
                            </td>
                            <td className="cell-editable" onClick={()=>startEdit(t,'description')}>
                              {isEditing(t,'description')
                                ? <input className="inline-input" autoFocus value={cellVal}
                                    onChange={e=>setCellVal(e.target.value)} onBlur={()=>commitCell(t)}
                                    onKeyDown={e=>{if(e.key==='Enter')commitCell(t);if(e.key==='Escape')cancelCell();}}
                                    onClick={e=>e.stopPropagation()} />
                                : <div style={{ fontWeight:500 }}>
                                    <div style={{ display:'flex', alignItems:'center', gap:4, flexWrap:'wrap' }}>
                                      <span>{t.description}</span>
                                      {t.recurringId && (
                                        <span title="Auto-generated by recurring rule"
                                          style={{ fontSize:10, background:'var(--bg-raised)', color:'var(--text-secondary)', padding:'1px 6px', borderRadius:10, marginLeft:4 }}>
                                          🔁
                                        </span>
                                      )}
                                      {isTransfer && (
                                        <span style={{ fontSize:10, background:'#64748b22', color:'var(--text-secondary)', padding:'1px 6px', borderRadius:10 }}>
                                          {t.transferDirection === 'from' ? '→' : '←'}
                                        </span>
                                      )}
                                      {t.taxDeductible && (
                                        <span title="Tax deductible"
                                          style={{ fontSize:10, background:'#7fa88b22', color:'var(--green)', padding:'1px 6px', borderRadius:10 }}>
                                          🧾
                                        </span>
                                      )}
                                      {(t.receipts?.length > 0) && (
                                        <span title={`${t.receipts.length} receipt${t.receipts.length>1?'s':''} attached`}
                                          style={{ fontSize:10, background:'var(--bg-raised)', color:'var(--text-secondary)', padding:'1px 6px', borderRadius:10 }}>
                                          📎
                                        </span>
                                      )}
                                    </div>
                                    {t.notes && <div style={{ fontSize:12,color:'var(--text-muted)' }}>{t.notes}</div>}
                                    {(t.tags ?? []).length > 0 && (
                                      <div style={{ display:'flex', flexWrap:'wrap', gap:3, marginTop:3 }}>
                                        {t.tags.map(tag => (
                                          <span key={tag} style={{ fontSize:10, background:'var(--bg-raised)', color:'var(--green)', padding:'1px 6px', borderRadius:10 }}>{tag}</span>
                                        ))}
                                      </div>
                                    )}
                                  </div>}
                            </td>
                            <td className="cell-editable" onClick={()=>{ if(!isEditing(t,'category')) startEdit(t,'category'); }}>
                              {isEditing(t,'category')
                                ? <select className="inline-input" autoFocus value={cellVal}
                                    onChange={e=>{setCellVal(e.target.value);onEdit({...t,category:e.target.value});setEditCell(null);}}
                                    onBlur={cancelCell} onClick={e=>e.stopPropagation()} style={{ width:160 }}>
                                    {getAllCategories(userCategories).map(c=><option key={c.name} value={c.name}>{c.icon} {c.name}</option>)}
                                  </select>
                                : isSplit
                                  ? <span className="tag" style={{ cursor:'pointer' }} onClick={e=>{ e.stopPropagation(); toggleSplitExpand(t.id); }}>
                                      <Shuffle size={12} strokeWidth={1.5} style={{ verticalAlign:'text-bottom' }} /> Split {isExpanded ? '▲' : '▼'}
                                    </span>
                                  : isTransfer
                                    ? <span className="tag"><ArrowRightLeft size={12} strokeWidth={1.5} style={{ verticalAlign:'text-bottom' }} /> Transfer</span>
                                    : <span className="tag"><CategoryIcon name={t.category} size={12} /> {t.category}</span>
                              }
                            </td>
                            <td style={{ color:'var(--text-secondary)',fontSize:13 }}>{acctName(t.account)}</td>
                            <td className="cell-editable" style={{ textAlign:'right' }} onClick={()=>startEdit(t,'amount')}>
                              {isEditing(t,'amount')
                                ? <input className="inline-input" type="number" autoFocus min="0" step="0.01" value={cellVal}
                                    onChange={e=>setCellVal(e.target.value)} onBlur={()=>commitCell(t)}
                                    onKeyDown={e=>{if(e.key==='Enter')commitCell(t);if(e.key==='Escape')cancelCell();}}
                                    onClick={e=>e.stopPropagation()} style={{ width:100,textAlign:'right' }} />
                                : <span style={{ fontWeight:700,color:t.amount>=0?'var(--green)':'var(--red)',whiteSpace:'nowrap' }}>
                                    {t.amount>=0?'+':''}{cfmt(t.amount)}
                                  </span>}
                            </td>
                            {runningBalances && (
                              <td style={{ textAlign:'right',color:'var(--text-secondary)',fontSize:13,whiteSpace:'nowrap' }}>
                                {runningBalances[t.id] !== undefined ? cfmt(runningBalances[t.id]) : '—'}
                              </td>
                            )}
                            <td style={{ whiteSpace:'nowrap' }} onClick={e=>e.stopPropagation()}>
                              <button className="btn btn-ghost btn-sm" title="Edit"
                                onClick={()=>{
                                  if(t.transferId) {
                                    if(!confirm('This is one side of a transfer. Editing it individually may cause the two sides to become inconsistent. Continue?')) return;
                                  }
                                  setEditTx(t);
                                }}><Pencil size={14} strokeWidth={1.5} /></button>
                              <button className="btn btn-ghost btn-sm" style={{ color:'var(--red)' }} title="Delete"
                                onClick={()=>{
                                  const msg = t.transferId
                                    ? 'Delete this transfer? Both sides (debit and credit) will be removed.'
                                    : 'Delete this transaction?';
                                  if(confirm(msg)) onDelete(t.id);
                                }}><Trash2 size={14} strokeWidth={1.5} /></button>
                            </td>
                          </tr>
                          {isSplit && isExpanded && t.splits.map((sp, si) => (
                            <tr key={si} style={{ background:'var(--bg-raised)' }}>
                              <td />
                              <td />
                              <td style={{ paddingLeft:28, fontSize:13, color:'var(--text-secondary)' }}>
                                └ {sp.notes || sp.category}
                              </td>
                              <td>
                                <span className="tag" style={{ fontSize:11 }}><CategoryIcon name={sp.category} size={11} /> {sp.category}</span>
                              </td>
                              <td />
                              <td style={{ textAlign:'right', fontSize:13, color:'var(--red)', fontWeight:600 }}>
                                -{cfmt(sp.amount)}
                              </td>
                              {runningBalances && <td />}
                              <td />
                            </tr>
                          ))}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {pages > 1 && (
                <div style={{ display:'flex',gap:6,justifyContent:'center',padding:14,borderTop:'1px solid var(--bg-raised)' }}>
                  <button className="btn btn-ghost btn-sm" onClick={()=>setPage(p=>Math.max(0,p-1))} disabled={safePage===0}>← Prev</button>
                  <span style={{ fontSize:13,color:'var(--text-secondary)',padding:'5px 10px' }}>Page {safePage+1} of {pages}</span>
                  <button className="btn btn-ghost btn-sm" onClick={()=>setPage(p=>Math.min(pages-1,p+1))} disabled={safePage>=pages-1}>Next →</button>
                </div>
              )}
              {selectedCount > 0 && (
                <div className="bulk-bar">
                  <span className="bulk-bar-count">{selectedCount} transaction{selectedCount>1?'s':''} selected</span>
                  {selectedCount < filtered.length && (
                    <button className="btn btn-ghost btn-sm" style={{ color:'var(--bg-page)' }}
                      onClick={() => setSelected(new Set(filtered.map(t => t.id)))}>
                      Select all {filtered.length} transactions
                    </button>
                  )}
                  <button className="btn btn-ghost btn-sm" style={{ color:'var(--bg-page)' }} onClick={clearSel}>Clear selection</button>
                  <button className="btn btn-sm" style={{ background:'#7f1d1d',color:'#fca5a5',border:'none' }} onClick={handleBulkDelete}>
                    <Trash2 size={14} strokeWidth={1.5} style={{ verticalAlign:'text-bottom' }} /> Delete {selectedCount} selected
                  </button>
                </div>
              )}
            </>
        }
      </div>

      {showAdd && (
        <Modal title="Add Transaction" onClose={()=>setShowAdd(false)}>
          <TransactionForm accounts={accounts} onSave={tx=>{ onAdd(tx); setShowAdd(false); }} onClose={()=>setShowAdd(false)} userCategories={userCategories} existingTransactions={transactions} dataPath={dataPath} />
        </Modal>
      )}
      {editTx && (
        <Modal title="Edit Transaction" onClose={()=>setEditTx(null)}>
          <TransactionForm initial={editTx} accounts={accounts} onSave={tx=>{ onEdit(tx); setEditTx(null); }} onClose={()=>setEditTx(null)} userCategories={userCategories} existingTransactions={transactions} dataPath={dataPath} />
        </Modal>
      )}
      {showCSV && (
        <Modal title="Import Transactions" onClose={()=>setShowCSV(false)}>
          <CSVImport accounts={accounts} existingTxs={existingTxs} onImport={rows=>{ onCSVImport(rows); setShowCSV(false); }} onClose={()=>setShowCSV(false)} userCategories={userCategories} />
        </Modal>
      )}
    </div>
  );
}
