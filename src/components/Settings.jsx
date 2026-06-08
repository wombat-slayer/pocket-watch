import { useState, useMemo, useEffect } from 'react';
import { download, getAllCategories, thisMonth } from '../constants.js';
import { promptNewDataFile } from '../dataLayer.js';
import PlaidSync from './PlaidSync.jsx';
import Recurring from './Recurring.jsx';
import Equity from './Equity.jsx';
import PayStubImportModal from './PayStubImportModal.jsx';

export default function Settings({ transactions, accounts, budgets, goals, netWorthHistory, dataPath, onReset, onClearDemo, onImport, onChangeDataFile, userCategories, onAddUserCategory, onDeleteUserCategory, apiKeys = {}, onSaveApiKeys, archivedTransactions = [], onArchive, onRestoreArchive, onImportNetWorthHistory, onPlaidImport, onPlaidBalances, onToast, onPlaidSyncComplete, onPlaidModify, onPlaidRemove, recurrences = [], onAddRecurrence, onEditRecurrence, onDeleteRecurrence, onToggleRecurrence, grants = [], onAddGrant, onEditGrant, onDeleteGrant, onAddTx, onVestToAccount, onUpdateGrantPrice, compensationProfile, onSetCompensationProfile, budgetAlerts = { enabled: true, warnAt: 80, alertAt: 100 }, onSaveBudgetAlerts, onScanTransfers }) {
  const [confirmReset,     setConfirmReset]     = useState(false);
  const [confirmDemo,      setConfirmDemo]      = useState(false);
  const [showPayStubModal, setShowPayStubModal] = useState(false);
  const [importError,  setImportError]  = useState('');
  const [importOk,     setImportOk]     = useState(false);
  const [newCatName,  setNewCatName]  = useState('');
  const [newCatIcon,  setNewCatIcon]  = useState('📦');
  const [newCatColor, setNewCatColor] = useState('#94a3b8');
  const [finnhubInput, setFinnhubInput] = useState('');
  const [apiKeySaved,  setApiKeySaved]  = useState(false);
  const [nwImportError,  setNwImportError]  = useState('');
  const [nwImportResult, setNwImportResult] = useState('');
  const [archiveBefore, setArchiveBefore] = useState(() => {
    const d = new Date(); d.setFullYear(d.getFullYear() - 2);
    return d.toISOString().slice(0, 10);
  });
  const [archiveResult, setArchiveResult] = useState('');

  // Update states
  const [updateStatus, setUpdateStatus] = useState('idle'); // idle | checking | available | uptodate | installing | restart | error
  const [updateInfo,   setUpdateInfo]   = useState(null);

  // Collapsible Investments section
  const [investmentsOpen, setInvestmentsOpen] = useState(false);


  const demoTxCount  = transactions.filter(t=>t._seeded).length;
  const demoAccCount = accounts.filter(a=>a._seeded).length;
  const demoBgCount  = budgets.filter(b=>b._seeded).length;
  const demoGlCount  = (goals??[]).filter(g=>g._seeded).length;
  const demoTotal    = demoTxCount + demoAccCount + demoBgCount + demoGlCount;

  const exportTransactionsCSV = () => {
    const header = 'Date,Description,Category,Amount,Type,Account,Notes,Tags';
    const rows   = transactions.map(t => [t.date,t.description,t.category,t.amount,t.type,t.account,t.notes??'',(t.tags??[]).join(';')].map(v=>`"${String(v).replace(/"/g,'""')}"`).join(','));
    download('pocket-watch-transactions.csv', [header,...rows].join('\n'), 'text/csv');
  };

  const exportJSON = () => {
    const data = { transactions, accounts, budgets, goals: goals??[], netWorthHistory, exportedAt: new Date().toISOString(), version: 3 };
    download('pocket-watch-backup.json', JSON.stringify(data,null,2), 'application/json');
  };

  const handleImport = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setImportError(''); setImportOk(false);
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        if (!Array.isArray(data.transactions) || !Array.isArray(data.accounts)) throw new Error('Invalid backup file — expected transactions and accounts arrays.');
        if (!confirm('This will replace ALL current data with the backup. Continue?')) return;
        onImport(data);
        setImportOk(true);
      } catch (err) { setImportError(err.message); }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleMoveDataFile = async () => {
    const newPath = await promptNewDataFile();
    if (!newPath) return;
    await onChangeDataFile(newPath);
  };

  const handleCheckUpdate = async () => {
    setUpdateStatus('checking');
    try {
      const { check } = await import('@tauri-apps/plugin-updater');
      const update = await check();
      if (update?.available) {
        setUpdateStatus('available');
        setUpdateInfo(update);
      } else {
        setUpdateStatus('uptodate');
      }
    } catch (e) {
      console.error('Update check failed:', e);
      setUpdateStatus('error');
    }
  };

  const handleInstallUpdate = async () => {
    if (!updateInfo) return;
    try {
      setUpdateStatus('installing');
      await updateInfo.downloadAndInstall();
      setUpdateStatus('restart');
    } catch (e) {
      console.error('Install failed:', e);
      setUpdateStatus('error');
    }
  };

  const dataHealth = useMemo(() => {
    const now = new Date();
    const cutoff60 = new Date(now - 60*24*60*60*1000).toISOString().slice(0,10);
    const cutoff30 = new Date(now - 30*24*60*60*1000).toISOString().slice(0,10);
    return {
      totalTxs: transactions.length,
      oldestTx: transactions.length ? transactions.reduce((a,b) => a.date < b.date ? a : b).date : null,
      newestTx: transactions.length ? transactions.reduce((a,b) => a.date > b.date ? a : b).date : null,
      unclearedOld: transactions.filter(t=>!t.cleared && t.date < cutoff30 && t.type==='expense').length,
      accountsNoActivity: accounts.filter(a => !transactions.some(t=>t.account===a.id && t.date>=cutoff60)).length,
      budgetsNoSpend: budgets
        .filter(b => b.month === thisMonth())
        .filter(b => !transactions.some(t => t.category === b.category && t.date.startsWith(b.month))).length,
      untagged: transactions.filter(t=>(!t.tags||t.tags.length===0) && t.type==='expense').length,
    };
  }, [transactions, accounts, budgets]);

  return (
    <>
    <div className="fade-in" style={{ padding:'24px 28px' }}>
      <div className="section-header">
        <div><div className="section-title">Settings</div><div className="section-sub">Data management and preferences</div></div>
      </div>

      {/* API Keys */}
      <div className="settings-section">
        <div className="settings-section-title">🔑 API Keys</div>
        <p style={{ fontSize:13, color:'var(--text-secondary)', marginBottom:12 }}>
          Add a <strong style={{ color:'var(--text-primary)' }}>Finnhub</strong> API key to enable live stock price fetching in the Investments section below.
          {' '}<a href="https://finnhub.io/register" target="_blank" rel="noreferrer"
            style={{ color:'var(--green)', textDecoration:'none', borderBottom:'1px dashed #7fa88b44' }}>
            Get a free key at finnhub.io
          </a>{' '}(free tier: 60 req/min). Crypto prices via CoinGecko require no key.
        </p>
        <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap', maxWidth:500 }}>
          {apiKeys.finnhub ? (
            <span style={{ fontSize:12, color:'var(--green)', padding:'2px 10px', background:'var(--bg-raised)', borderRadius:20, whiteSpace:'nowrap' }}>
              ● Key set
            </span>
          ) : (
            <span style={{ fontSize:12, color:'var(--text-secondary)', padding:'2px 10px', background:'var(--bg-raised)', borderRadius:20, whiteSpace:'nowrap' }}>
              ○ No key
            </span>
          )}
          <input
            type="password"
            placeholder={apiKeys.finnhub ? 'Enter new key to replace…' : 'Finnhub API key (sk_…)'}
            value={finnhubInput}
            onChange={e => { setFinnhubInput(e.target.value); setApiKeySaved(false); }}
            style={{ flex:1, fontFamily:'monospace', fontSize:13, minWidth:180 }}
            autoComplete="off"
          />
          <button
            className="btn btn-primary"
            disabled={!finnhubInput.trim()}
            onClick={async () => {
              if (finnhubInput.trim() && onSaveApiKeys) {
                try {
                  await onSaveApiKeys({ finnhub: finnhubInput.trim() });
                  setFinnhubInput('');
                  setApiKeySaved(true);
                } catch (err) {
                  console.error('Failed to save Finnhub key:', err);
                }
              }
            }}>
            Save
          </button>
          {apiKeys.finnhub && (
            <button className="btn btn-ghost btn-sm" style={{ color:'var(--red)' }}
              onClick={async () => { setFinnhubInput(''); if (onSaveApiKeys) await onSaveApiKeys({ finnhub: '' }).catch(() => {}); setApiKeySaved(false); }}>
              Clear
            </button>
          )}
        </div>
        {apiKeySaved && <p style={{ color:'var(--green)', fontSize:12, marginTop:6 }}>✅ API key saved.</p>}
        <p style={{ fontSize:11, color:'var(--text-muted)', marginTop:8 }}>Key is stored in your OS keychain — never in the data file or uploaded.</p>
      </div>


      {/* Compensation Profile */}
      {compensationProfile !== undefined && onSetCompensationProfile && (
        <div className="settings-section">
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14 }}>
            <div className="settings-section-title" style={{ marginBottom:0 }}>💼 Compensation Profile</div>
            <button
              className="btn btn-secondary btn-sm"
              style={{ fontSize:12 }}
              onClick={() => setShowPayStubModal(true)}
            >
              📄 Import from Pay Stub
            </button>
          </div>
          <p style={{ fontSize:13, color:'var(--text-secondary)', marginBottom:14 }}>
            Used to calculate your True Savings Rate on the Dashboard. All values stay local — never uploaded.
          </p>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, maxWidth:520 }}>
            <div className="form-group">
              <label className="form-label">Gross Monthly Salary ($)</label>
              <input
                type="number" min="0" step="100"
                placeholder="0"
                value={compensationProfile.grossMonthlySalary || ''}
                onChange={e => onSetCompensationProfile({ ...compensationProfile, grossMonthlySalary: +e.target.value || 0 })}
              />
            </div>
            <div className="form-group">
              <label className="form-label">401(k) Contribution (%)</label>
              <input
                type="number" min="0" max="100" step="0.5"
                placeholder="0"
                value={compensationProfile.retirement401kPct || ''}
                onChange={e => onSetCompensationProfile({ ...compensationProfile, retirement401kPct: +e.target.value || 0 })}
              />
            </div>
            <div className="form-group">
              <label className="form-label">HSA Monthly Contribution ($)</label>
              <input
                type="number" min="0" step="10"
                placeholder="0"
                value={compensationProfile.hsaMonthly || ''}
                onChange={e => onSetCompensationProfile({ ...compensationProfile, hsaMonthly: +e.target.value || 0 })}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Effective Tax Rate (%)</label>
              <input
                type="number" min="0" max="100" step="0.5"
                placeholder="0"
                value={compensationProfile.effectiveTaxRate || ''}
                onChange={e => onSetCompensationProfile({ ...compensationProfile, effectiveTaxRate: +e.target.value || 0 })}
              />
            </div>
          </div>
          <div style={{ marginTop:12, marginBottom:4, maxWidth:520 }}>
            <div style={{ fontSize:12, fontWeight:600, color:'var(--text-muted)', letterSpacing:'0.05em', textTransform:'uppercase' }}>Benefits (monthly, pre-tax)</div>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, maxWidth:520 }}>
            <div className="form-group">
              <label className="form-label">Medical Premium ($)</label>
              <input
                type="number" min="0" step="10"
                placeholder="0"
                value={compensationProfile.medicalMonthly || ''}
                onChange={e => onSetCompensationProfile({ ...compensationProfile, medicalMonthly: +e.target.value || 0 })}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Dental Premium ($)</label>
              <input
                type="number" min="0" step="1"
                placeholder="0"
                value={compensationProfile.dentalMonthly || ''}
                onChange={e => onSetCompensationProfile({ ...compensationProfile, dentalMonthly: +e.target.value || 0 })}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Vision Premium ($)</label>
              <input
                type="number" min="0" step="1"
                placeholder="0"
                value={compensationProfile.visionMonthly || ''}
                onChange={e => onSetCompensationProfile({ ...compensationProfile, visionMonthly: +e.target.value || 0 })}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Other Benefits ($)</label>
              <input
                type="number" min="0" step="1"
                placeholder="0"
                value={compensationProfile.otherBenefitsMonthly || ''}
                onChange={e => onSetCompensationProfile({ ...compensationProfile, otherBenefitsMonthly: +e.target.value || 0 })}
              />
            </div>
          </div>
          <div className="form-group" style={{ marginTop:6, maxWidth:520 }}>
            <label className="form-label">Notes</label>
            <input
              type="text"
              placeholder="e.g. base + bonus, excludes RSU"
              value={compensationProfile.notes || ''}
              onChange={e => onSetCompensationProfile({ ...compensationProfile, notes: e.target.value })}
            />
          </div>
          <p style={{ fontSize:11, color:'var(--text-muted)', marginTop:8 }}>Changes auto-save with the rest of your data.</p>
        </div>
      )}

      {/* Bank Sync */}
      <div className="settings-section">
        <div className="settings-section-title">🏦 Bank Sync (Plaid)</div>
        <p style={{ fontSize:13, color:'var(--text-secondary)', marginBottom:16 }}>
          Connect your bank accounts to automatically import transactions via Plaid.
          You'll need a free <a href="https://dashboard.plaid.com/signup" target="_blank" rel="noreferrer"
            style={{ color:'var(--green)', textDecoration:'none', borderBottom:'1px dashed #7fa88b44' }}>
            Plaid developer account
          </a> (Trial plan: free, up to 10 linked items, no credit card).
          Enter your sandbox credentials to test, or switch to production when ready.
        </p>
        <PlaidSync
          accounts={accounts}
          existingTxs={transactions}
          onImport={rows => onPlaidImport?.(rows)}
          onUpdateBalances={onPlaidBalances}
          onToast={onToast}
          onSyncComplete={onPlaidSyncComplete}
          onModifyTxs={onPlaidModify}
          onRemoveTxs={onPlaidRemove}
        />
      </div>

      {/* Data Health */}
      <div className="settings-section">
        <div className="settings-section-title">🩺 Data Health</div>
        <div style={{ display:'flex', flexWrap:'wrap', gap:10 }}>
          {/* Total transactions */}
          <div style={{ background:'var(--bg-page)', borderRadius:8, padding:'8px 14px', fontSize:12, color:'var(--green)', border:'1px solid #14532d44' }}>
            ✅ {dataHealth.totalTxs} transactions
            {dataHealth.oldestTx && dataHealth.newestTx && (
              <span style={{ color:'var(--text-secondary)', marginLeft:6 }}>({dataHealth.oldestTx} → {dataHealth.newestTx})</span>
            )}
          </div>
          {/* Uncleared old */}
          <div style={{ background:'var(--bg-page)', borderRadius:8, padding:'8px 14px', fontSize:12, color: dataHealth.unclearedOld > 0 ? 'var(--amber)' : 'var(--green)', border: dataHealth.unclearedOld > 0 ? '1px solid #f59e0b44' : '1px solid #14532d44' }}>
            {dataHealth.unclearedOld > 0 ? '⚠' : '✅'} {dataHealth.unclearedOld} uncleared expense{dataHealth.unclearedOld !== 1 ? 's' : ''} older than 30 days
          </div>
          {/* Accounts with no activity */}
          <div style={{ background:'var(--bg-page)', borderRadius:8, padding:'8px 14px', fontSize:12, color: dataHealth.accountsNoActivity > 0 ? 'var(--amber)' : 'var(--green)', border: dataHealth.accountsNoActivity > 0 ? '1px solid #f59e0b44' : '1px solid #14532d44' }}>
            {dataHealth.accountsNoActivity > 0 ? '⚠' : '✅'} {dataHealth.accountsNoActivity} account{dataHealth.accountsNoActivity !== 1 ? 's' : ''} with no activity in 60 days
          </div>
          {/* Budgets with no spending */}
          <div style={{ background:'var(--bg-page)', borderRadius:8, padding:'8px 14px', fontSize:12, color: dataHealth.budgetsNoSpend > 0 ? 'var(--amber)' : 'var(--green)', border: dataHealth.budgetsNoSpend > 0 ? '1px solid #f59e0b44' : '1px solid #14532d44' }}>
            {dataHealth.budgetsNoSpend > 0 ? '⚠' : '✅'} {dataHealth.budgetsNoSpend} budget{dataHealth.budgetsNoSpend !== 1 ? 's' : ''} with no spending this month
          </div>
          {/* Untagged expenses */}
          <div style={{ background:'var(--bg-page)', borderRadius:8, padding:'8px 14px', fontSize:12, color:'var(--text-secondary)', border:'1px solid var(--bg-raised)' }}>
            📌 {dataHealth.untagged} expense transaction{dataHealth.untagged !== 1 ? 's' : ''} without tags
          </div>
        </div>
      </div>

      {/* Data file location */}
      <div className="settings-section">
        <div className="settings-section-title">📁 Data File</div>
        <p style={{ fontSize:13, color:'var(--text-secondary)', marginBottom:12 }}>
          All Pocket Watch data is stored locally in a single JSON file you control. You can put it in Dropbox, iCloud Drive, or any folder — it stays on your devices.
        </p>
        <div style={{ background:'var(--bg-page)', borderRadius:8, padding:'10px 14px', fontFamily:'monospace', fontSize:12, color:'var(--green)', marginBottom:12, wordBreak:'break-all' }}>
          {dataPath ?? 'Loading…'}
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <button className="btn btn-secondary" onClick={handleMoveDataFile}>📂 Move Data File…</button>
        </div>
        <p style={{ fontSize:12,color:'var(--text-muted)',marginTop:10 }}>Moving the data file copies all data to the new location and updates the remembered path.</p>
      </div>

      {/* Storage stats */}
      <div className="settings-section">
        <div className="settings-section-title">📊 Storage Overview</div>
        <div style={{ display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:12 }}>
          {[['Transactions',transactions.length],['Accounts',accounts.length],['Budgets',budgets.length],['Goals',(goals??[]).length],['NW Snapshots',netWorthHistory.length]].map(([label,count])=>(
            <div key={label} className="card-sm" style={{ textAlign:'center',padding:14 }}>
              <div style={{ fontSize:22,fontWeight:800,color:'var(--text-primary)' }}>{count}</div>
              <div style={{ fontSize:12,color:'var(--text-secondary)',marginTop:4 }}>{label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Net Worth History Import */}
      <div className="settings-section">
        <div className="settings-section-title">📈 Import Historical Net Worth</div>
        <p style={{ fontSize:13, color:'var(--text-secondary)', marginBottom:12 }}>
          Upload a CSV file with past net worth snapshots to populate the historical chart.
          Accepted columns (case-insensitive): <code style={{ fontSize:11, color:'var(--green)' }}>date, net_worth</code> or
          {' '}<code style={{ fontSize:11, color:'var(--green)' }}>date, assets, debts</code>.
          Date format: YYYY-MM-DD. Duplicate dates are skipped.
        </p>
        <label className="file-label" htmlFor="nw-csv-import">📂 Choose Net Worth CSV</label>
        <input id="nw-csv-import" type="file" accept=".csv" onChange={(e) => {
          const file = e.target.files[0];
          if (!file) return;
          setNwImportError(''); setNwImportResult('');
          const reader = new FileReader();
          reader.onload = (ev) => {
            try {
              const lines = ev.target.result.split('\n').map(l => l.trim()).filter(Boolean);
              if (!lines.length) throw new Error('Empty file');
              const header = lines[0].toLowerCase().split(',').map(h => h.replace(/[^a-z_]/g, ''));
              const dateIdx  = header.findIndex(h => h === 'date');
              const nwIdx    = header.findIndex(h => h === 'net_worth' || h === 'networth' || h === 'net');
              const assIdx   = header.findIndex(h => h === 'assets');
              const debIdx   = header.findIndex(h => h === 'debts' || h === 'liabilities');
              if (dateIdx < 0) throw new Error('Missing "date" column');
              if (nwIdx < 0 && (assIdx < 0 || debIdx < 0)) throw new Error('Need either a "net_worth" column or both "assets" and "debts" columns');
              const rows = [];
              for (let i = 1; i < lines.length; i++) {
                const cols = lines[i].split(',').map(c => c.trim().replace(/^"|"$/g,''));
                const date = cols[dateIdx]?.slice(0,10);
                if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
                let netWorth, assets = 0, debts = 0;
                if (nwIdx >= 0) {
                  netWorth = parseFloat(cols[nwIdx]); assets = netWorth; debts = 0;
                } else {
                  assets  = parseFloat(cols[assIdx]) || 0;
                  debts   = parseFloat(cols[debIdx]) || 0;
                  netWorth = assets - debts;
                }
                if (isNaN(netWorth)) continue;
                rows.push({ id: `nw-import-${Date.now()}-${i}`, date, netWorth, assets, debts });
              }
              if (!rows.length) throw new Error('No valid rows found. Check date format (YYYY-MM-DD) and column names.');
              onImportNetWorthHistory?.(rows);
              setNwImportResult(`✅ Imported ${rows.length} snapshot${rows.length!==1?'s':''} (duplicates skipped).`);
            } catch (err) { setNwImportError(err.message); }
          };
          reader.readAsText(file);
          e.target.value = '';
        }} />
        {nwImportError  && <p style={{ color:'var(--red)',fontSize:13,marginTop:8 }}>❌ {nwImportError}</p>}
        {nwImportResult && <p style={{ color:'var(--green)',fontSize:13,marginTop:8 }}>{nwImportResult}</p>}
        <p style={{ fontSize:11,color:'var(--text-muted)',marginTop:8 }}>
          Currently {netWorthHistory.length} snapshots stored.
          {netWorthHistory.length > 0 && ` Oldest: ${netWorthHistory[0]?.date}. Latest: ${netWorthHistory[netWorthHistory.length-1]?.date}.`}
        </p>
      </div>

      {/* Archive */}
      <div className="settings-section">
        <div className="settings-section-title">🗃️ Transaction Archive</div>
        <p style={{ fontSize:13, color:'var(--text-secondary)', marginBottom:12 }}>
          Move old transactions to an archive to keep your active dataset small and fast. Archived transactions are still saved in your data file and can be restored at any time.
        </p>
        <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap', marginBottom:10 }}>
          <label style={{ fontSize:13, color:'var(--text-secondary)' }}>Archive transactions before:</label>
          <input type="date" value={archiveBefore} onChange={e => setArchiveBefore(e.target.value)}
            style={{ fontSize:13, padding:'4px 8px', width:'auto' }} />
          <button className="btn btn-secondary"
            onClick={() => {
              const count = onArchive?.(archiveBefore) ?? 0;
              setArchiveResult(count > 0 ? `✅ Archived ${count} transaction${count!==1?'s':''}.` : '⚠ No transactions matched that date range.');
            }}>
            Archive Old Transactions
          </button>
        </div>
        {archiveResult && <p style={{ fontSize:12, color:'var(--text-secondary)', marginBottom:8 }}>{archiveResult}</p>}
        {archivedTransactions.length > 0 && (
          <div style={{ display:'flex', alignItems:'center', gap:10, background:'var(--bg-page)', borderRadius:8, padding:'8px 12px', fontSize:13 }}>
            <span style={{ color:'var(--text-secondary)' }}>{archivedTransactions.length.toLocaleString()} transaction{archivedTransactions.length!==1?'s':''} archived</span>
            <button className="btn btn-ghost btn-sm" style={{ color:'var(--amber)', fontSize:11 }}
              onClick={() => { if (window.confirm(`Restore ${archivedTransactions.length} archived transactions to active view?`)) { onRestoreArchive?.(); setArchiveResult(''); } }}>
              ↩ Restore All
            </button>
          </div>
        )}
        {archivedTransactions.length === 0 && (
          <div style={{ fontSize:12, color:'var(--text-muted)' }}>No archived transactions.</div>
        )}
      </div>

      {/* Export */}
      <div className="settings-section">
        <div className="settings-section-title">📤 Export Data</div>
        <div style={{ display:'flex',gap:10,flexWrap:'wrap' }}>
          <button className="btn btn-secondary" onClick={exportTransactionsCSV}>⬇ Transactions CSV</button>
          <button className="btn btn-secondary" onClick={exportJSON}>⬇ Full Backup (JSON)</button>
          {onScanTransfers && (
            <button className="btn btn-secondary" onClick={onScanTransfers} title="Re-detect transfer pairs across all transactions">
              ⇄ Scan for transfers
            </button>
          )}
        </div>
        <p style={{ fontSize:12,color:'var(--text-muted)',marginTop:10 }}>The CSV export works with Excel and Google Sheets. The JSON backup includes everything and can be restored below.</p>
      </div>

      {/* Import */}
      <div className="settings-section">
        <div className="settings-section-title">📥 Restore from Backup</div>
        <label className="file-label" htmlFor="json-restore">📂 Choose JSON Backup File</label>
        <input id="json-restore" type="file" accept=".json" onChange={handleImport} />
        {importError && <p style={{ color:'var(--red)',fontSize:13,marginTop:8 }}>❌ {importError}</p>}
        {importOk    && <p style={{ color:'var(--green)',fontSize:13,marginTop:8 }}>✅ Backup restored successfully.</p>}
        <p style={{ fontSize:12,color:'var(--text-muted)',marginTop:10 }}>⚠️ Restoring replaces all current data with the backup contents.</p>
      </div>

      {/* Updates */}
      <div className="settings-section">
        <div className="settings-section-title">🔄 Updates</div>
        <p style={{ fontSize:13,color:'var(--text-secondary)',marginBottom:12 }}>
          Check for the latest version of Pocket Watch.
          {' '}<span style={{ color:'var(--text-muted)', fontSize:11 }}>
            Endpoint: <code style={{ fontSize:10, color:'var(--text-muted)' }}>https://releases.pocketwatch.app/...</code>
            {' '}— deploy a GitHub Release with a signed <code style={{ fontSize:10, color:'var(--text-muted)' }}>latest.json</code> manifest to activate.
          </span>
        </p>
        <div style={{ display:'flex',gap:10,alignItems:'center',flexWrap:'wrap' }}>
          <button className="btn btn-secondary" onClick={handleCheckUpdate} disabled={updateStatus==='checking'}>
            {updateStatus==='checking' ? '⏳ Checking…' : '🔍 Check for Updates'}
          </button>
          {updateStatus === 'uptodate' && <span style={{ color:'var(--green)',fontSize:13 }}>✅ You're up to date!</span>}
          {updateStatus === 'available' && updateInfo && (
            <>
              <span style={{ color:'var(--amber)',fontSize:13 }}>🆕 Update available: v{updateInfo.version}</span>
              <button className="btn btn-primary" onClick={handleInstallUpdate}>⬇ Install Update</button>
            </>
          )}
          {updateStatus === 'installing' && (
            <span style={{ color:'var(--accent)',fontSize:13 }}>⏳ Downloading and installing…</span>
          )}
          {updateStatus === 'restart' && (
            <span style={{ color:'var(--green)',fontSize:13 }}>✅ Update installed — please restart Pocket Watch to finish.</span>
          )}
          {updateStatus === 'error' && (
            <span style={{ color:'var(--red)',fontSize:13 }}>❌ Update check failed. Check your internet connection.</span>
          )}
        </div>
      </div>

      {/* Demo data */}
      {demoTotal > 0 && (
        <div className="settings-section">
          <div className="settings-section-title">🧹 Clear Demo Data</div>
          <p style={{ fontSize:14,color:'var(--text-secondary)',marginBottom:12 }}>
            You have <strong style={{ color:'var(--text-primary)' }}>{demoTxCount}</strong> demo transactions,{' '}
            <strong style={{ color:'var(--text-primary)' }}>{demoAccCount}</strong> demo accounts, and{' '}
            <strong style={{ color:'var(--text-primary)' }}>{demoBgCount}</strong> demo budgets loaded.
          </p>
          {!confirmDemo
            ? <button className="btn btn-secondary" onClick={()=>setConfirmDemo(true)}>Remove Demo Data</button>
            : <div style={{ display:'flex',gap:8,alignItems:'center' }}>
                <span style={{ fontSize:13,color:'var(--red)' }}>Remove all demo/sample data?</span>
                <button className="btn btn-danger btn-sm" onClick={()=>{ onClearDemo(); setConfirmDemo(false); }}>Yes, Remove</button>
                <button className="btn btn-secondary btn-sm" onClick={()=>setConfirmDemo(false)}>Cancel</button>
              </div>
          }
        </div>
      )}

      {/* Category Management */}
      <div className="settings-section">
        <div className="settings-section-title">🏷️ Custom Categories</div>
        <p style={{ fontSize:13, color:'var(--text-secondary)', marginBottom:12 }}>
          Add your own categories. Built-in categories cannot be removed.
        </p>
        {/* Existing user categories */}
        {(userCategories ?? []).length > 0 && (
          <div style={{ display:'flex', flexWrap:'wrap', gap:8, marginBottom:12 }}>
            {userCategories.map(c => (
              <div key={c.name} style={{ display:'flex', alignItems:'center', gap:6, background:'var(--bg-raised)', borderRadius:8, padding:'5px 10px' }}>
                <span>{c.icon}</span>
                <span style={{ fontSize:13, color:'var(--text-primary)' }}>{c.name}</span>
                <button onClick={() => onDeleteUserCategory(c.name)} style={{ background:'none', border:'none', color:'var(--text-muted)', cursor:'pointer', fontSize:13 }}>✕</button>
              </div>
            ))}
          </div>
        )}
        {/* Add new category form */}
        <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
          <input type="text" placeholder="Category name" maxLength={30} value={newCatName} onChange={e => setNewCatName(e.target.value)} style={{ width:160 }} />
          <input type="text" placeholder="Icon" maxLength={4} value={newCatIcon} onChange={e => setNewCatIcon(e.target.value)} style={{ width:56, textAlign:'center' }} />
          <input type="color" value={newCatColor} onChange={e => setNewCatColor(e.target.value)} style={{ width:40, height:34, padding:2, borderRadius:6, border:'1px solid var(--bg-raised)', background:'transparent', cursor:'pointer' }} />
          <button className="btn btn-secondary" onClick={() => {
            const name = newCatName.trim();
            if (!name) return;
            const allNames = getAllCategories(userCategories).map(c => c.name);
            if (allNames.includes(name)) { alert('A category with that name already exists.'); return; }
            onAddUserCategory({ name, icon: newCatIcon || '📦', color: newCatColor });
            setNewCatName(''); setNewCatIcon('📦'); setNewCatColor('#94a3b8');
          }}>+ Add Category</button>
        </div>
      </div>

      {/* Recurring Rules (moved from its own nav page) */}
      <div className="settings-section">
        <div className="settings-section-title">🔁 Recurring Rules</div>
        <p style={{ fontSize:13, color:'var(--text-secondary)', marginBottom:12 }}>
          Rules that auto-generate transactions on a schedule (rent, salary, subscriptions).
          Generated transactions appear on the Transactions page with a 🔁 marker.
        </p>
        <Recurring
          embedded
          recurrences={recurrences}
          accounts={accounts}
          transactions={transactions}
          onAdd={onAddRecurrence}
          onEdit={onEditRecurrence}
          onDelete={onDeleteRecurrence}
          onToggle={onToggleRecurrence}
          userCategories={userCategories}
        />
      </div>

      {/* Investments (moved from its own nav page, collapsible) */}
      <div className="settings-section">
        <div
          className="settings-section-title"
          style={{ cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'space-between' }}
          onClick={() => setInvestmentsOpen(o => !o)}
        >
          <span>📈 Investments</span>
          <span style={{ fontSize:12, color:'var(--text-secondary)', fontWeight:400 }}>{investmentsOpen ? '▲ Collapse' : '▼ Expand'}</span>
        </div>
        {investmentsOpen && (
          <div style={{ marginTop:12 }}>
            <Equity
              embedded
              grants={grants}
              onAdd={onAddGrant}
              onEdit={onEditGrant}
              onDelete={onDeleteGrant}
              onAddTx={onAddTx}
              onVestToAccount={onVestToAccount}
              onUpdateGrantPrice={onUpdateGrantPrice}
              investmentAccounts={accounts.filter(a => a.type === 'investment' || a.type === 'brokerage')}
              finnhubKey={apiKeys.finnhub}
            />
          </div>
        )}
      </div>

      {/* Notifications */}
      <div className="settings-section">
        <div className="settings-section-title">🔔 Budget Notifications</div>
        <p style={{ fontSize:13, color:'var(--text-secondary)', marginBottom:12 }}>
          Get OS notifications when spending approaches or exceeds your monthly budget limits.
        </p>
        <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
          <label style={{ display:'flex', alignItems:'center', gap:10, cursor:'pointer' }}>
            <input type="checkbox" checked={budgetAlerts.enabled}
              onChange={e => onSaveBudgetAlerts?.({ enabled: e.target.checked })}
              style={{ width:15, height:15, accentColor:'var(--green)', cursor:'pointer' }} />
            <span style={{ fontSize:14, color:'var(--text-primary)' }}>Enable budget notifications</span>
          </label>
          {budgetAlerts.enabled && (
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, maxWidth:400 }}>
              <div className="form-group" style={{ margin:0 }}>
                <label className="form-label">Warning threshold (%)</label>
                <input type="number" min={1} max={99} value={budgetAlerts.warnAt}
                  onChange={e => onSaveBudgetAlerts?.({ warnAt: Math.max(1, Math.min(99, Number(e.target.value))) })}
                  style={{ fontSize:13 }} />
                <div style={{ fontSize:11, color:'var(--text-secondary)', marginTop:3 }}>Notify at this % of budget (e.g. 80)</div>
              </div>
              <div className="form-group" style={{ margin:0 }}>
                <label className="form-label">Alert threshold (%)</label>
                <input type="number" min={1} max={200} value={budgetAlerts.alertAt}
                  onChange={e => onSaveBudgetAlerts?.({ alertAt: Math.max(1, Number(e.target.value)) })}
                  style={{ fontSize:13 }} />
                <div style={{ fontSize:11, color:'var(--text-secondary)', marginTop:3 }}>Notify at this % (e.g. 100 = exceeded)</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Full reset */}
      <div className="settings-section" style={{ borderColor:'#7f1d1d44' }}>
        <div className="settings-section-title" style={{ color:'#fca5a5' }}>⚠️ Danger Zone</div>
        <p style={{ fontSize:14,color:'var(--text-secondary)',marginBottom:12 }}>Full reset deletes all transactions, accounts, budgets, and history. This cannot be undone.</p>
        {!confirmReset
          ? <button className="btn btn-danger" onClick={()=>setConfirmReset(true)}>Full Reset — Delete Everything</button>
          : <div style={{ display:'flex',gap:8,alignItems:'center',flexWrap:'wrap' }}>
              <span style={{ fontSize:13,color:'var(--red)' }}>⚠️ This is permanent and cannot be undone.</span>
              <button className="btn btn-danger" onClick={()=>{onReset();setConfirmReset(false);}}>Yes, delete everything</button>
              <button className="btn btn-secondary" onClick={()=>setConfirmReset(false)}>Cancel</button>
            </div>
        }
      </div>

    </div>

    {showPayStubModal && (
      <PayStubImportModal
        compensationProfile={compensationProfile}
        onSetCompensationProfile={onSetCompensationProfile}
        onClose={() => setShowPayStubModal(false)}
      />
    )}
    </>
  );
}
