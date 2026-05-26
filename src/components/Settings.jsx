import { useState, useMemo } from 'react';
import { download, CATEGORIES, getAllCategories } from '../constants.js';
import { promptNewDataFile } from '../dataLayer.js';


export default function Settings({ transactions, accounts, budgets, goals, netWorthHistory, dataPath, onReset, onClearDemo, onImport, onChangeDataFile, userCategories, onAddUserCategory, onDeleteUserCategory }) {
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmDemo,  setConfirmDemo]  = useState(false);
  const [importError,  setImportError]  = useState('');
  const [importOk,     setImportOk]     = useState(false);
  const [changingFile, setChangingFile] = useState(false);
  const [newCatName,  setNewCatName]  = useState('');
  const [newCatIcon,  setNewCatIcon]  = useState('📦');
  const [newCatColor, setNewCatColor] = useState('#94a3b8');


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
    setChangingFile(false);
  };

  const handleCheckUpdate = () => {
    // Auto-updater not configured — open GitHub Releases page
    window.open('https://github.com/nhm6499/pocket-watch/releases', '_blank');
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
      budgetsNoSpend: budgets.filter(b => !transactions.some(t=>t.category===b.category && t.date.startsWith(b.month))).length,
      untagged: transactions.filter(t=>(!t.tags||t.tags.length===0) && t.type==='expense').length,
    };
  }, [transactions, accounts, budgets]);

  return (
    <div className="fade-in" style={{ padding:'24px 28px' }}>
      <div className="section-header">
        <div><div className="section-title">Settings</div><div className="section-sub">Data management and preferences</div></div>
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

      {/* Export */}
      <div className="settings-section">
        <div className="settings-section-title">📤 Export Data</div>
        <div style={{ display:'flex',gap:10,flexWrap:'wrap' }}>
          <button className="btn btn-secondary" onClick={exportTransactionsCSV}>⬇ Transactions CSV</button>
          <button className="btn btn-secondary" onClick={exportJSON}>⬇ Full Backup (JSON)</button>
        </div>
        <p style={{ fontSize:12,color:'#475569',marginTop:10 }}>The CSV export works with Excel and Google Sheets. The JSON backup includes everything and can be restored below.</p>
      </div>

      {/* Import */}
      <div className="settings-section">
        <div className="settings-section-title">📥 Restore from Backup</div>
        <label className="file-label" htmlFor="json-restore">📂 Choose JSON Backup File</label>
        <input id="json-restore" type="file" accept=".json" onChange={handleImport} />
        {importError && <p style={{ color:'#c2735a',fontSize:13,marginTop:8 }}>❌ {importError}</p>}
        {importOk    && <p style={{ color:'#4ade80',fontSize:13,marginTop:8 }}>✅ Backup restored successfully.</p>}
        <p style={{ fontSize:12,color:'#475569',marginTop:10 }}>⚠️ Restoring replaces all current data with the backup contents.</p>
      </div>

      {/* Updates */}
      <div className="settings-section">
        <div className="settings-section-title">🔄 Updates</div>
        <p style={{ fontSize:13,color:'#94a3b8',marginBottom:12 }}>
          Check for the latest version of Pocket Watch.
          {' '}<span style={{ color:'#334155', fontSize:11 }}>
            Endpoint: <code style={{ fontSize:10, color:'#475569' }}>https://releases.pocketwatch.app/...</code>
            {' '}— deploy a GitHub Release with a signed <code style={{ fontSize:10, color:'#475569' }}>latest.json</code> manifest to activate.
          </span>
        </p>
        <div style={{ display:'flex',gap:10,alignItems:'center',flexWrap:'wrap' }}>
          <button className="btn btn-secondary" onClick={handleCheckUpdate}>🔍 View Releases on GitHub</button>
        </div>
      </div>

      {/* Demo data */}
      {demoTotal > 0 && (
        <div className="settings-section">
          <div className="settings-section-title">🧹 Clear Demo Data</div>
          <p style={{ fontSize:14,color:'#94a3b8',marginBottom:12 }}>
            You have <strong style={{ color:'#e2e8f0' }}>{demoTxCount}</strong> demo transactions,{' '}
            <strong style={{ color:'#e2e8f0' }}>{demoAccCount}</strong> demo accounts, and{' '}
            <strong style={{ color:'#e2e8f0' }}>{demoBgCount}</strong> demo budgets loaded.
          </p>
          {!confirmDemo
            ? <button className="btn btn-secondary" onClick={()=>setConfirmDemo(true)}>Remove Demo Data</button>
            : <div style={{ display:'flex',gap:8,alignItems:'center' }}>
                <span style={{ fontSize:13,color:'#c2735a' }}>Remove all demo/sample data?</span>
                <button className="btn btn-danger btn-sm" onClick={()=>{ onClearDemo(); setConfirmDemo(false); }}>Yes, Remove</button>
                <button className="btn btn-secondary btn-sm" onClick={()=>setConfirmDemo(false)}>Cancel</button>
              </div>
          }
        </div>
      )}

      {/* Category Management */}
      <div className="settings-section">
        <div className="settings-section-title">🏷️ Custom Categories</div>
        <p style={{ fontSize:13, color:'#94a3b8', marginBottom:12 }}>
          Add your own categories. Built-in categories cannot be removed.
        </p>
        {/* Existing user categories */}
        {(userCategories ?? []).length > 0 && (
          <div style={{ display:'flex', flexWrap:'wrap', gap:8, marginBottom:12 }}>
            {userCategories.map(c => (
              <div key={c.name} style={{ display:'flex', alignItems:'center', gap:6, background:'#1e2736', borderRadius:8, padding:'5px 10px' }}>
                <span>{c.icon}</span>
                <span style={{ fontSize:13, color:'#e2e8f0' }}>{c.name}</span>
                <button onClick={() => onDeleteUserCategory(c.name)} style={{ background:'none', border:'none', color:'#475569', cursor:'pointer', fontSize:13 }}>✕</button>
              </div>
            ))}
          </div>
        )}
        {/* Add new category form */}
        <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
          <input type="text" placeholder="Category name" maxLength={30} value={newCatName} onChange={e => setNewCatName(e.target.value)} style={{ width:160 }} />
          <input type="text" placeholder="Icon" maxLength={4} value={newCatIcon} onChange={e => setNewCatIcon(e.target.value)} style={{ width:56, textAlign:'center' }} />
          <input type="color" value={newCatColor} onChange={e => setNewCatColor(e.target.value)} style={{ width:40, height:34, padding:2, borderRadius:6, border:'1px solid #1e2736', background:'transparent', cursor:'pointer' }} />
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

      {/* Full reset */}
      <div className="settings-section" style={{ borderColor:'#7f1d1d44' }}>
        <div className="settings-section-title" style={{ color:'#fca5a5' }}>⚠️ Danger Zone</div>
        <p style={{ fontSize:14,color:'#94a3b8',marginBottom:12 }}>Full reset deletes all transactions, accounts, budgets, and history. This cannot be undone.</p>
        {!confirmReset
          ? <button className="btn btn-danger" onClick={()=>setConfirmReset(true)}>Full Reset — Delete Everything</button>
          : <div style={{ display:'flex',gap:8,alignItems:'center',flexWrap:'wrap' }}>
              <span style={{ fontSize:13,color:'#c2735a' }}>⚠️ This is permanent and cannot be undone.</span>
              <button className="btn btn-danger btn-sm" onClick={()=>{ onReset(); setConfirmReset(false); }}>Yes, Delete Everything</button>
              <button className="btn btn-secondary btn-sm" onClick={()=>setConfirmReset(false)}>Cancel</button>
            </div>
        }
      </div>
    </div>
  );
}
