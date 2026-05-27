import { useState, useMemo, useEffect } from 'react';
import { download, getAllCategories, thisMonth } from '../constants.js';
import { promptNewDataFile } from '../dataLayer.js';
import PlaidSync from './PlaidSync.jsx';

export default function Settings({ transactions, accounts, budgets, goals, netWorthHistory, dataPath, onReset, onClearDemo, onImport, onChangeDataFile, userCategories, onAddUserCategory, onDeleteUserCategory, apiKeys = {}, onSaveApiKeys, archivedTransactions = [], onArchive, onRestoreArchive, onImportNetWorthHistory, onPlaidImport }) {
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmDemo,  setConfirmDemo]  = useState(false);
  const [importError,  setImportError]  = useState('');
  const [importOk,     setImportOk]     = useState(false);
  const [newCatName,  setNewCatName]  = useState('');
  const [newCatIcon,  setNewCatIcon]  = useState('📦');
  const [newCatColor, setNewCatColor] = useState('#94a3b8');
  const [finnhubInput, setFinnhubInput] = useState(apiKeys.finnhub ?? '');
  const [apiKeySaved,  setApiKeySaved]  = useState(false);

  // Keep the input in sync if apiKeys prop is updated externally
  useEffect(() => { setFinnhubInput(apiKeys.finnhub ?? ''); }, [apiKeys.finnhub]);
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
    <div className="fade-in" style={{ padding:'24px 28px' }}>
      <div className="section-header">
        <div><div className="section-title">Settings</div><div className="section-sub">Data management and preferences</div></div>
      </div>

      {/* API Keys */}
      <div className="settings-section">
        <div className="settings-section-title">🔑 API Keys</div>
        <p style={{ fontSize:13, color:'#94a3b8', marginBottom:12 }}>
          Add a <strong style={{ color:'#e2e8f0' }}>Finnhub</strong> API key to enable live stock price fetching on the Investments page.
          {' '}<a href="https://finnhub.io/register" target="_blank" rel="noreferrer"
            style={{ color:'#7fa88b', textDecoration:'none', borderBottom:'1px dashed #7fa88b44' }}>
            Get a free key at finnhub.io
          </a>{' '}(free tier: 60 req/min). Crypto prices via CoinGecko require no key.
        </p>
        <div style={{ display:'flex', gap:8, alignItems:'center', maxWidth:500 }}>
          <input
            type="password"
            placeholder="Finnhub API key (sk_…)"
            value={finnhubInput}
            onChange={e => { setFinnhubInput(e.target.value); setApiKeySaved(false); }}
            style={{ flex:1, fontFamily:'monospace', fontSize:13 }}
            autoComplete="off"
          />
          <button
            className="btn btn-primary"
            onClick={() => {
              if (onSaveApiKeys) onSaveApiKeys({ finnhub: finnhubInput.trim() });
              setApiKeySaved(true);
            }}>
            Save
          </button>
          {finnhubInput.trim() && (
            <button className="btn btn-ghost btn-sm" style={{ color:'#c2735a' }}
              onClick={() => { setFinnhubInput(''); if (onSaveApiKeys) onSaveApiKeys({ finnhub: '' }); setApiKeySaved(false); }}>
              Clear
            </button>
          )}
        </div>
        {apiKeySaved && <p style={{ color:'#4ade80', fontSize:12, marginTop:6 }}>✅ API key saved.</p>}
        <p style={{ fontSize:11, color:'#475569', marginTop:8 }}>Keys are stored locally in your data file — never uploaded or shared.</p>
      </div>

      {/* Bank Sync */}
      <div className="settings-section">
        <div className="settings-section-title">🏦 Bank Sync (Plaid)</div>
        <p style={{ fontSize:13, color:'#94a3b8', marginBottom:16 }}>
          Connect your bank accounts to automatically import transactions via Plaid.
          You'll need a free <a href="https://dashboard.plaid.com/signup" target="_blank" rel="noreferrer"
            style={{ color:'#7fa88b', textDecoration:'none', borderBottom:'1px dashed #7fa88b44' }}>
            Plaid developer account
          </a> (Trial plan: free, up to 10 linked items, no credit card).
          Enter your sandbox credentials to test, or switch to production when ready.
        </p>
        <PlaidSync
          accounts={accounts}
          existingTxs={transactions}
          onImport={rows => onPlaidImport?.(rows)}
        />
      </div>

      {/* Data Health */}
      <div className="settings-section">
        <div className="settings-section-title">🩺 Data Health</div>
        <div style={{ display:'flex', flexWrap:'wrap', gap:10 }}>
          {/* Total transactions */}
          <div style={{ background:'#0d1117', borderRadius:8, padding:'8px 14px', fontSize:12, color:'#4ade80', border:'1px solid #14532d44' }}>
            ✅ {dataHealth.totalTxs} transactions
            {dataHealth.oldestTx && dataHealth.newestTx && (
              <span style={{ color:'#64748b', marginLeft:6 }}>({dataHealth.oldestTx} → {dataHealth.newestTx})</span>
            )}
          </div>
          {/* Uncleared old */}
          <div style={{ background:'#0d1117', borderRadius:8, padding:'8px 14px', fontSize:12, color: dataHealth.unclearedOld > 0 ? '#f59e0b' : '#4ade80', border: dataHealth.unclearedOld > 0 ? '1px solid #f59e0b44' : '1px solid #14532d44' }}>
            {dataHealth.unclearedOld > 0 ? '⚠' : '✅'} {dataHealth.unclearedOld} uncleared expense{dataHealth.unclearedOld !== 1 ? 's' : ''} older than 30 days
          </div>
          {/* Accounts with no activity */}
          <div style={{ background:'#0d1117', borderRadius:8, padding:'8px 14px', fontSize:12, color: dataHealth.accountsNoActivity > 0 ? '#f59e0b' : '#4ade80', border: dataHealth.accountsNoActivity > 0 ? '1px solid #f59e0b44' : '1px solid #14532d44' }}>
            {dataHealth.accountsNoActivity > 0 ? '⚠' : '✅'} {dataHealth.accountsNoActivity} account{dataHealth.accountsNoActivity !== 1 ? 's' : ''} with no activity in 60 days
          </div>
          {/* Budgets with no spending */}
          <div style={{ background:'#0d1117', borderRadius:8, padding:'8px 14px', fontSize:12, color: dataHealth.budgetsNoSpend > 0 ? '#f59e0b' : '#4ade80', border: dataHealth.budgetsNoSpend > 0 ? '1px solid #f59e0b44' : '1px solid #14532d44' }}>
            {dataHealth.budgetsNoSpend > 0 ? '⚠' : '✅'} {dataHealth.budgetsNoSpend} budget{dataHealth.budgetsNoSpend !== 1 ? 's' : ''} with no spending this month
          </div>
          {/* Untagged expenses */}
          <div style={{ background:'#0d1117', borderRadius:8, padding:'8px 14px', fontSize:12, color:'#94a3b8', border:'1px solid #1e2736' }}>
            📌 {dataHealth.untagged} expense transaction{dataHealth.untagged !== 1 ? 's' : ''} without tags
          </div>
        </div>
      </div>

      {/* Data file location */}
      <div className="settings-section">
        <div className="settings-section-title">📁 Data File</div>
        <p style={{ fontSize:13, color:'#94a3b8', marginBottom:12 }}>
          All Pocket Watch data is stored locally in a single JSON file you control. You can put it in Dropbox, iCloud Drive, or any folder — it stays on your devices.
        </p>
        <div style={{ background:'#0d1117', borderRadius:8, padding:'10px 14px', fontFamily:'monospace', fontSize:12, color:'#7fa88b', marginBottom:12, wordBreak:'break-all' }}>
          {dataPath ?? 'Loading…'}
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <button className="btn btn-secondary" onClick={handleMoveDataFile}>📂 Move Data File…</button>
        </div>
        <p style={{ fontSize:12,color:'#475569',marginTop:10 }}>Moving the data file copies all data to the new location and updates the remembered path.</p>
      </div>

      {/* Storage stats */}
      <div className="settings-section">
        <div className="settings-section-title">📊 Storage Overview</div>
        <div style={{ display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:12 }}>
          {[['Transactions',transactions.length],['Accounts',accounts.length],['Budgets',budgets.length],['Goals',(goals??[]).length],['NW Snapshots',netWorthHistory.length]].map(([label,count])=>(
            <div key={label} className="card-sm" style={{ textAlign:'center',padding:14 }}>
              <div style={{ fontSize:22,fontWeight:800,color:'#e2e8f0' }}>{count}</div>
              <div style={{ fontSize:12,color:'#64748b',marginTop:4 }}>{label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Net Worth History Import */}
      <div className="settings-section">
        <div className="settings-section-title">📈 Import Historical Net Worth</div>
        <p style={{ fontSize:13, color:'#94a3b8', marginBottom:12 }}>
          Upload a CSV file with past net worth snapshots to populate the historical chart.
          Accepted columns (case-insensitive): <code style={{ fontSize:11, color:'#7fa88b' }}>date, net_worth</code> or
          {' '}<code style={{ fontSize:11, color:'#7fa88b' }}>date, assets, debts</code>.
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
        {nwImportError  && <p style={{ color:'#c2735a',fontSize:13,marginTop:8 }}>❌ {nwImportError}</p>}
        {nwImportResult && <p style={{ color:'#4ade80',fontSize:13,marginTop:8 }}>{nwImportResult}</p>}
        <p style={{ fontSize:11,color:'#475569',marginTop:8 }}>
          Currently {netWorthHistory.length} snapshots stored.
          {netWorthHistory.length > 0 && ` Oldest: ${netWorthHistory[0]?.date}. Latest: ${netWorthHistory[netWorthHistory.length-1]?.date}.`}
        </p>
      </div>

      {/* Archive */}
      <div className="settings-section">
        <div className="settings-section-title">🗃️ Transaction Archive</div>
        <p style={{ fontSize:13, color:'#94a3b8', marginBottom:12 }}>
          Move old transactions to an archive to keep your active dataset small and fast. Archived transactions are still saved in your data file and can be restored at any time.
        </p>
        <div style={{ display:'flex