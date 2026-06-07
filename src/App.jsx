import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import './App.css';

import { isDebtType, today, uid, fmt, getNextRecurDate, detectAndMarkTransferPairs, DEFAULT_COMPENSATION_PROFILE, checkBudgetAlerts } from './constants.js';
import { PrivacyContext } from './context/PrivacyContext.jsx';
import { seedTransactions, seedAccounts, seedBudgets, seedGoals } from './seed.js';
import {
  getDataPath, setDataPath, getDefaultDataPath,
  loadAppData, saveAppData, dataFileExists,
  promptNewDataFile, promptOpenDataFile,
} from './dataLayer.js';
import { invoke } from '@tauri-apps/api/core';

import Business       from './components/Business.jsx';
import Dashboard      from './components/Dashboard.jsx';
import Transactions   from './components/Transactions.jsx';
import Budgets        from './components/Budgets.jsx';
import Accounts       from './components/Accounts.jsx';
import Reports        from './components/Reports.jsx';
import Settings       from './components/Settings.jsx';
import Modal          from './components/Modal.jsx';
import TransactionForm  from './components/TransactionForm.jsx';
import TransferForm     from './components/TransferForm.jsx';
import AdjustmentForm   from './components/AdjustmentForm.jsx';
import CommandPalette   from './components/CommandPalette.jsx';
import OnboardingWizard  from './components/OnboardingWizard.jsx';
import MonthClose        from './components/MonthClose.jsx';

// ─── First-run setup screen ───────────────────────────────────────────────────
function FirstRunScreen({ onChoose, onDefault, error }) {
  return (
    <div className="firstrun-overlay">
      <div className="firstrun-box">
        <div style={{ fontSize:48, marginBottom:16 }}>⌚</div>
        <div style={{ fontFamily:'DM Serif Display, serif', fontSize:32, color:'#7fa88b', marginBottom:8 }}>Pocket Watch</div>
        <p style={{ color:'#64748b', fontSize:15, marginBottom:32, lineHeight:1.6 }}>
          Your personal long-term financial record.<br />
          Where would you like to store your data?
        </p>
        <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
          <button className="btn btn-primary" style={{ justifyContent:'center', fontSize:15, padding:'12px 24px' }} onClick={onDefault}>
            📂 Use default location
          </button>
          <button className="btn btn-secondary" style={{ justifyContent:'center', fontSize:15, padding:'12px 24px' }} onClick={onChoose}>
            🗂️ Choose my own location (Dropbox, iCloud…)
          </button>
        </div>
        {error && (
          <p style={{ color:'#c2735a', fontSize:12, marginTop:16, background:'#c2735a11', padding:'8px 12px', borderRadius:8 }}>
            ⚠️ {error}
          </p>
        )}
        <p style={{ color:'#334155', fontSize:12, marginTop:20 }}>
          You can move the file any time in Settings.
        </p>
      </div>
    </div>
  );
}

// ─── Root App ─────────────────────────────────────────────────────────────────
export default function App() {
  // ── State ──────────────────────────────────────────────────────────────────
  const [transactions,    setTransactions]    = useState([]);
  const [accounts,        setAccounts]        = useState([]);
  const [budgets,         setBudgets]         = useState([]);
  const [goals,           setGoals]           = useState([]);
  const [recurrences,     setRecurrences]     = useState([]);
  const [grants,          setGrants]          = useState([]);
  const [userCategories,  setUserCategories]  = useState([]);
  const [netWorthHistory, setNetWorthHistory] = useState([]);
  const [page,            setPage]            = useState('dashboard');
  const [showAdd,         setShowAdd]         = useState(false);
  const [showTransfer,    setShowTransfer]    = useState(false);
  const [showAdjustment,  setShowAdjustment]  = useState(false);
  const [showPalette,     setShowPalette]     = useState(false);
  const [showHelp,        setShowHelp]        = useState(false);
  const [sidebarCollapsed,setSidebarCollapsed]= useState(false);
  const [txCatFilter,     setTxCatFilter]     = useState('All');
  const [budgetTemplates,       setBudgetTemplates]       = useState([]);
  const [archivedTransactions, setArchivedTransactions] = useState([]);
  const [apiKeys,         setApiKeys]         = useState({ finnhub: '' });
  const [onboardingDone,  setOnboardingDone]  = useState(true);
  const [showMonthClose,  setShowMonthClose]  = useState(false);
  const [toasts,          setToasts]          = useState([]);
  const [lastSyncResult,  setLastSyncResult]  = useState(null); // { count, uncategorized } after a Plaid sync
  const [reportsInitialTab, setReportsInitialTab] = useState('trend');
  const [compensationProfile, setCompensationProfile] = useState(DEFAULT_COMPENSATION_PROFILE);
  const [budgetAlerts, setBudgetAlerts] = useState({ enabled: true, warnAt: 80, alertAt: 100 });
  const [privacyMode,  setPrivacyMode]  = useState(() => localStorage.getItem('pw_privacy') === '1');
  const [theme, setTheme] = useState(() => localStorage.getItem('pw-theme') ?? 'dark');
  useEffect(() => {
    document.documentElement.classList.toggle('light', theme === 'light');
    localStorage.setItem('pw-theme', theme);
  }, [theme]);
  const notifiedThresholds = useRef(new Set());

  // ── Data loading status ────────────────────────────────────────────────────
  const [dataPath,        setDataPathState]   = useState(null);
  const [appStatus,       setAppStatus]       = useState('loading'); // 'loading' | 'firstrun' | 'ready'
  const [firstRunError,   setFirstRunError]   = useState('');

  // ── Undo / Redo ────────────────────────────────────────────────────────────
  const undoStack = useRef([]);
  const redoStack = useRef([]);
  const recurGenerated = useRef(false);
  const transferPairFixRef = useRef(false);
  const [undoLen, setUndoLen] = useState(0);
  const snapshot = useCallback(() => ({ transactions, accounts, budgets, goals }), [transactions, accounts, budgets, goals]);

  const pushUndo = useCallback(() => {
    undoStack.current.push(snapshot());
    if (undoStack.current.length > 40) undoStack.current.shift();
    redoStack.current = [];
    setUndoLen(undoStack.current.length);
  }, [snapshot]);

  const handleUndo = useCallback(() => {
    if (!undoStack.current.length) return;
    redoStack.current.push(snapshot());
    const prev = undoStack.current.pop();
    setTransactions(prev.transactions);
    setAccounts(prev.accounts);
    setBudgets(prev.budgets);
    setGoals(prev.goals);
    setUndoLen(undoStack.current.length);
  }, [snapshot]);

  const handleRedo = useCallback(() => {
    if (!redoStack.current.length) return;
    undoStack.current.push(snapshot());
    const next = redoStack.current.pop();
    setTransactions(next.transactions);
    setAccounts(next.accounts);
    setBudgets(next.budgets);
    setGoals(next.goals);
    setUndoLen(undoStack.current.length);
  }, [snapshot]);

  // ── Init: load data from file on mount ────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        let path = await getDataPath();
        if (!path) {
          setAppStatus('firstrun');
          return;
        }
        await initFromPath(path);
      } catch (err) {
        console.error('Failed to load data path:', err);
        setAppStatus('firstrun');
      }
    })();
  }, []);

  const migrateData = (data) => {
    // Backfill transaction fields added in v2/v3
    const accounts = (data.accounts ?? []).map(a => ({
      holdings: [],
      isBusiness: false,
      unvestedRSUValue: 0,
      ...a,
    }));
    const transactions = (data.transactions ?? []).map(t => ({
      tags: [],
      splits: undefined,
      recurringId: undefined,
      transferId: undefined,
      transferDirection: undefined,
      type: t.amount >= 0 ? 'income' : 'expense',
      cleared: false,
      receipts: [],
      ...t,
    }));
    // Backfill budget fields
    const budgets = (data.budgets ?? []).map(b => ({
      rollover: false,
      ...b,
    }));
    // Backfill goal fields
    const goals = (data.goals ?? []).map(g => ({
      linkedAccountId: null,
      ...g,
    }));
    return {
      ...data, accounts, transactions, budgets, goals,
      compensationProfile: data.compensationProfile ?? DEFAULT_COMPENSATION_PROFILE,
      budgetAlerts: data.budgetAlerts ?? { enabled: true, warnAt: 80, alertAt: 100 },
      version: 8,
    };
  };

  const initFromPath = async (path) => {
    setDataPathState(path);
    try {
      const exists = await dataFileExists(path);
      if (exists) {
        // Backup before migration
        try {
          const rawStr = await invoke('load_data', { path });
          const bakPath = path.replace(/\.json$/, '') + '.backup.json';
          await invoke('save_data', { path: bakPath, data: rawStr });
        } catch (_) { /* non-fatal — backup failure shouldn't block load */ }

        const raw = await loadAppData(path);
        const data = migrateData(raw);
        setTransactions(data.transactions  ?? seedTransactions());
        setAccounts(data.accounts          ?? seedAccounts());
        setBudgets(data.budgets            ?? seedBudgets());
        setGoals(data.goals                ?? seedGoals());
        setRecurrences(data.recurrences    ?? []);
        setNetWorthHistory(data.netWorthHistory ?? []);
        setGrants(data.grants              ?? []);
        setUserCategories(data.userCategories ?? []);
        setBudgetTemplates(data.budgetTemplates ?? []);
        setArchivedTransactions(data.archivedTransactions ?? []);
        setApiKeys(data.apiKeys             ?? { finnhub: '' });
        setCompensationProfile(data.compensationProfile ?? DEFAULT_COMPENSATION_PROFILE);
        setBudgetAlerts(data.budgetAlerts ?? { enabled: true, warnAt: 80, alertAt: 100 });
        setOnboardingDone(data.onboardingComplete !== false);
      } else {
        // New file location — seed demo data
        setTransactions(seedTransactions());
        setAccounts(seedAccounts());
        setBudgets(seedBudgets());
        setGoals(seedGoals());
        setRecurrences([]);
        setNetWorthHistory([]);
        setGrants([]);
        setUserCategories([]);
        setBudgetTemplates([]);
        setOnboardingDone(false);
      }
    } catch (err) {
      console.error('Failed to load app data:', err);
      setTransactions(seedTransactions());
      setAccounts(seedAccounts());
      setBudgets(seedBudgets());
      setGoals(seedGoals());
      setRecurrences([]);
      setGrants([]);
      setUserCategories([]);
      setBudgetTemplates([]);
    }
    setAppStatus('ready');
  };

  // ── First-run handlers ────────────────────────────────────────────────────
  const handleFirstRunDefault = async () => {
    setFirstRunError('');
    try {
      const path = await getDefaultDataPath();
      await setDataPath(path);
      await initFromPath(path);
    } catch (err) {
      console.error('Failed to set default data path:', err);
      setFirstRunError(String(err?.message ?? err));
    }
  };

  const handleFirstRunChoose = async () => {
    setFirstRunError('');
    try {
      const path = await promptNewDataFile();
      if (!path) return;
      await setDataPath(path);
      await initFromPath(path);
    } catch (err) {
      console.error('Failed to choose data path:', err);
      setFirstRunError(String(err?.message ?? err));
    }
  };

  // ── One-time transfer pair backfill on mount after data loads ────────────
  useEffect(() => {
    if (appStatus !== 'ready' || transferPairFixRef.current) return;
    transferPairFixRef.current = true;
    setTransactions(prev => {
      const marked = detectAndMarkTransferPairs(prev);
      const changed = marked.some((t, i) => t.category !== prev[i]?.category);
      return changed ? marked : prev;
    });
  }, [appStatus]); // eslint-disable-line

  // ── Auto-save: debounced 600ms whenever state changes ────────────────────
  const saveTimer = useRef(null);
  useEffect(() => {
    if (appStatus !== 'ready' || !dataPath) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveAppData(dataPath, { transactions, accounts, budgets, goals, recurrences, grants, userCategories, netWorthHistory, budgetTemplates, archivedTransactions, apiKeys, compensationProfile, budgetAlerts, onboardingComplete: onboardingDone, version: 8 })
        .catch(err => console.error('Auto-save failed:', err));
    }, 600);
    return () => clearTimeout(saveTimer.current);
  }, [transactions, accounts, budgets, goals, recurrences, grants, userCategories, netWorthHistory, budgetTemplates, archivedTransactions, apiKeys, compensationProfile, budgetAlerts, onboardingDone, dataPath, appStatus]);

  // ── Move data file ────────────────────────────────────────────────────────
  const handleChangeDataFile = async (newPath) => {
    await saveAppData(newPath, { transactions, accounts, budgets, goals, recurrences, grants, userCategories, netWorthHistory, budgetTemplates, archivedTransactions, apiKeys, compensationProfile, budgetAlerts, onboardingComplete: onboardingDone, version: 8 });
    await setDataPath(newPath);
    setDataPathState(newPath);
  };

  // ── Net worth daily snapshot ───────────────────────────────────────────────
  useEffect(() => {
    if (appStatus !== 'ready' || !accounts.length) return;
    const todayStr = today();
    if (netWorthHistory.some(h=>h.date===todayStr)) return;
    const assets = accounts.filter(a=>!isDebtType(a.type)).reduce((s,a)=>s+a.balance,0);
    const debts  = accounts.filter(a=> isDebtType(a.type)).reduce((s,a)=>s+a.balance,0);
    setNetWorthHistory(h=>[...h,{ id:uid(), date:todayStr, netWorth:assets-debts, assets, debts }]);
  }, [accounts, appStatus]); // eslint-disable-line

  // ── Recurring auto-generation (runs once when app becomes ready) ──────────
  useEffect(() => {
    if (appStatus !== 'ready') return;
    if (recurGenerated.current) return; // guard against StrictMode double-fire
    recurGenerated.current = true;
    const todayStr = today();
    let generated = [];
    const updatedRecs = recurrences.map(rec => {
      if (!rec.active) return rec;
      let next = rec.lastGenerated
        ? getNextRecurDate(rec.lastGenerated, rec.frequency)
        : rec.startDate;
      let lastGenerated = rec.lastGenerated;
      while (next <= todayStr) {
        generated.push({
          id: uid(), date: next, description: rec.description,
          amount: rec.amount, category: rec.category, type: rec.type,
          account: rec.account, notes: rec.notes ?? '',
          recurringId: rec.id, tags: [], cleared: false,
        });
        lastGenerated = next;
        next = getNextRecurDate(next, rec.frequency);
      }
      return lastGenerated !== rec.lastGenerated ? { ...rec, lastGenerated } : rec;
    });
    if (generated.length) {
      setTransactions(ts => [...generated, ...ts].sort((a, b) => b.date.localeCompare(a.date)));
      setRecurrences(updatedRecs);
    }
    // Budget auto-apply: if no budgets exist for current month and a template is set to auto-apply, apply it
    const currentMonth = today().slice(0, 7);
    setBudgets(prev => {
      const hasCurrentBudgets = prev.some(b => b.month === currentMonth);
      if (hasCurrentBudgets) return prev;
      const autoTemplate = budgetTemplates.find(t => t.autoApply);
      if (!autoTemplate) return prev;
      const newBuds = autoTemplate.budgets.map(b => ({ ...b, id: uid(), month: currentMonth }));
      return [...prev, ...newBuds];
    });
  }, [appStatus]); // eslint-disable-line

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e) => {
      // Ignore when focus is inside an input/textarea/select
      const tag = document.activeElement?.tagName;
      const inInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      if ((e.ctrlKey||e.metaKey) && e.key==='k') { e.preventDefault(); setShowPalette(p=>!p); return; }
      if ((e.ctrlKey||e.metaKey) && e.key==='z' && !e.shiftKey) { e.preventDefault(); handleUndo(); return; }
      if ((e.ctrlKey||e.metaKey) && (e.key==='y' || (e.key==='z' && e.shiftKey))) { e.preventDefault(); handleRedo(); return; }
      if (inInput) return;
      const navKeys = {'1':'dashboard','2':'transactions','3':'accounts','4':'budgets','5':'reports','6':'settings'};
      if (navKeys[e.key]) { setPage(navKeys[e.key]); return; }
      if (e.key === 'n' || e.key === 'N') { setShowAdd(true); return; }
      if (e.key === 't' || e.key === 'T') { setShowTransfer(true); return; }
      if (e.key === 'b' || e.key === 'B') { setShowAdjustment(true); return; }
      if (e.key === '?') { setShowHelp(h => !h); return; }
      if (e.key === 'Escape') { setShowHelp(false); setShowPalette(false); return; }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleUndo, handleRedo]);

  // ── Toast helper ───────────────────────────────────────────────────────────
  // type: 'success' | 'warning' | 'error' | 'info'
  const showToast = useCallback((msg, type = 'success') => {
    const id = uid();
    setToasts(prev => [...prev, { id, msg, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3500);
  }, []);

  // ── Transfer handler ───────────────────────────────────────────────────────
  const handleTransfer = (tx1, tx2) => {
    pushUndo();
    setTransactions(ts => [tx1, tx2, ...ts].sort((a,b) => b.date.localeCompare(a.date)));
    setAccounts(as => as.map(a => {
      if (a.id === tx1.account) return { ...a, balance: +(a.balance + tx1.amount).toFixed(2) };
      if (a.id === tx2.account) return { ...a, balance: +(a.balance + tx2.amount).toFixed(2) };
      return a;
    }));
    showToast('Transfer recorded');
  };

  // ── Transaction handlers ───────────────────────────────────────────────────
  const addTx      = (tx)  => { pushUndo(); setTransactions(ts=>[tx,...ts].sort((a,b)=>b.date.localeCompare(a.date))); showToast('Transaction added'); };
  const editTx     = (tx)  => { pushUndo(); setTransactions(ts=>ts.map(t=>t.id===tx.id?tx:t)); showToast('Transaction updated'); };
  const deleteTx   = (id)  => {
    pushUndo();
    const target = transactions.find(t => t.id === id);
    if (target?.transferId) {
      const both = transactions.filter(t => t.transferId === target.transferId);
      setAccounts(as => as.map(a => {
        const side = both.find(t => t.account === a.id);
        return side ? { ...a, balance: +(a.balance - side.amount).toFixed(2) } : a;
      }));
      setTransactions(ts => ts.filter(t => t.transferId !== target.transferId));
    } else {
      setTransactions(ts => ts.filter(t => t.id !== id));
    }
    showToast('Transaction deleted', 'info');
  };
  const bulkDelete = (ids) => { pushUndo(); const s=new Set(ids); setTransactions(ts=>ts.filter(t=>!s.has(t.id))); showToast(`${ids.length} transactions deleted`, 'info'); };
  const importTxs  = (rows)=> { pushUndo(); setTransactions(ts=>[...rows,...ts].sort((a,b)=>b.date.localeCompare(a.date))); showToast(`${rows.length} transaction${rows.length!==1?'s':''} imported`); };
  const plaidModifyTxs = (updates) => {
    if (!updates?.length) return;
    setTransactions(ts => ts.map(t => {
      const u = updates.find(u => u.id === t.fitid || u.id === t.id);
      return u ? { ...t, ...u } : t;
    }));
  };
  const plaidRemoveTxs = (ids) => {
    if (!ids?.length) return;
    const idSet = new Set(ids);
    setTransactions(ts => ts.filter(t => !idSet.has(t.id) && !idSet.has(t.fitid)));
  };

  // ── Account handlers ────────────────────────────────────────────────────────
  const addAcct    = (a)   => { pushUndo(); setAccounts(as=>[...as,a]); showToast(`Account "${a.name}" added`); };
  // Plaid sync writes authoritative balances straight from the bank — no undo
  // entry (the paired transaction import already pushed one).
  const updateAcctBalances = (updates) => {
    if (!updates?.length) return;
    const now = new Date().toISOString();
    setAccounts(as => as.map(a => {
      const u = updates.find(x => x.id === a.id);
      return u ? { ...a, balance: u.balance, lastPlaidSync: now } : a;
    }));
  };
  const editAcct   = (a)   => { pushUndo(); setAccounts(as=>as.map(x=>x.id===a.id?a:x)); showToast('Account updated'); };
  const deleteAcct = (id)  => { pushUndo(); setAccounts(as=>as.filter(a=>a.id!==id)); showToast('Account removed', 'info'); };

  // ── Budget handlers ─────────────────────────────────────────────────────────
  const addBudget    = (b) => { pushUndo(); setBudgets(bs=>[...bs,b]); showToast('Budget added'); };
  const editBudget   = (b) => { pushUndo(); setBudgets(bs=>bs.map(x=>x.id===b.id?b:x)); showToast('Budget updated'); };
  const deleteBudget = (id)=> { pushUndo(); setBudgets(bs=>bs.filter(b=>b.id!==id)); showToast('Budget removed', 'info'); };

  // ── Goal handlers ────────────────────────────────────────────────────────────
  const addGoal     = (g)       => { pushUndo(); setGoals(gs=>[...gs,g]); showToast(`Goal "${g.name}" created`); };
  const editGoal    = (g)       => { pushUndo(); setGoals(gs=>gs.map(x=>x.id===g.id?g:x)); showToast('Goal updated'); };
  const deleteGoal  = (id)      => { pushUndo(); setGoals(gs=>gs.filter(g=>g.id!==id)); showToast('Goal removed', 'info'); };
  const depositGoal = (id, amt) => { pushUndo(); setGoals(gs=>gs.map(g=>g.id===id?{...g,current:Math.max(0,g.current+amt)}:g)); showToast('Deposit recorded'); };

  // ── Balance Adjustment handler ────────────────────────────────────────────────
  const handleAdjustment = (acctId, newBalance, date, notes) => {
    pushUndo();
    const acct = accounts.find(a => a.id === acctId);
    if (!acct) return;
    const delta = newBalance - acct.balance;
    const tx = {
      id: uid(), date, description: `Balance update: ${acct.name}`,
      amount: delta, category: 'Adjustment', account: acctId,
      type: 'adjustment', notes, tags: [], cleared: false,
    };
    setTransactions(ts => [tx, ...ts].sort((a,b) => b.date.localeCompare(a.date)));
    setAccounts(as => as.map(a => a.id === acctId ? { ...a, balance: newBalance } : a));
    showToast('Balance updated');
  };

  // ── Reconciliation handlers ───────────────────────────────────────────────────
  const toggleCleared = (txId) => {
    setTransactions(prev => prev.map(t => t.id === txId ? { ...t, cleared: !t.cleared } : t));
  };
  const handleReconcile = (accountId, clearedTxIds) => {
    setTransactions(prev => prev.map(t =>
      clearedTxIds.includes(t.id) ? { ...t, cleared: true } : t
    ));
  };

  // ── Grant (equity) handlers ───────────────────────────────────────────────────
  const addGrant    = (g)  => setGrants(gs => [...gs, g]);
  const editGrant   = (g)  => setGrants(gs => gs.map(x => x.id === g.id ? g : x));
  const deleteGrant = (id) => setGrants(gs => gs.filter(g => g.id !== id));

  // ── Equity vest + price handlers ─────────────────────────────────────────────
  const vestToAccount = useCallback((accountId, amount) =>
    setAccounts(prev => prev.map(a => a.id === accountId ? { ...a, balance: +(a.balance + amount).toFixed(2) } : a))
  , []);
  const updateGrantPrice = useCallback((grantId, price) =>
    setGrants(prev => prev.map(g => g.id === grantId ? { ...g, currentPrice: +price } : g))
  , []);

  // ── Budget template handlers ──────────────────────────────────────────────────
  const handleSaveTemplate = (name, buds) => {
    setBudgetTemplates(prev => [...prev.filter(t => t.name !== name), { name, budgets: buds }]);
    showToast(`Template "${name}" saved`);
  };
  const handleLoadTemplate = (tpl) => {
    const tm = today().slice(0, 7);
    setBudgets(prev => {
      const newBuds = tpl.budgets.map(b => ({ ...b, id: uid(), month: tm }));
      return [...prev.filter(b => b.month !== tm), ...newBuds];
    });
    showToast(`Template "${tpl.name}" applied`);
  };
  const handleBudgetAlert = (category, pct) => {
    const msg = `${category} has reached ${pct}% of its limit.`;
    showToast(msg, 'warning');
  };

  const handleToggleTemplateAutoApply = (name) =>
    setBudgetTemplates(prev => prev.map(t => t.name === name ? { ...t, autoApply: !t.autoApply } : t));

  const handleUpdateStatementDate = (acctId, date) =>
    setAccounts(as => as.map(a => a.id === acctId ? { ...a, lastStatementDate: date } : a));

  // ── Archive handlers ──────────────────────────────────────────────────────────
  const handleArchive = useCallback((beforeDate) => {
    const toArchive = transactions.filter(t => t.date < beforeDate);
    if (!toArchive.length) return 0;
    setArchivedTransactions(prev => [...prev, ...toArchive]);
    setTransactions(prev => prev.filter(t => t.date >= beforeDate));
    return toArchive.length;
  }, [transactions]);

  const handleRestoreArchive = useCallback(() => {
    setTransactions(prev => [...prev, ...archivedTransactions].sort((a,b) => b.date.localeCompare(a.date)));
    setArchivedTransactions([]);
  }, [archivedTransactions]);

  // ── API key handler ───────────────────────────────────────────────────────────
  const handleSaveApiKeys = (keys) => setApiKeys(prev => ({ ...prev, ...keys }));

  // ── User category handlers ──────────────────────────────────────────────────
  const addUserCategory    = (c)    => setUserCategories(cs => [...cs, c]);
  const deleteUserCategory = (name) => setUserCategories(cs => cs.filter(c => c.name !== name));

  // ── Recurrence handlers ───────────────────────────────────────────────────────
  const addRecurrence    = (r)  => setRecurrences(rs => [...rs, r]);
  const editRecurrence   = (r)  => setRecurrences(rs => rs.map(x => x.id === r.id ? r : x));
  const deleteRecurrence = (id) => setRecurrences(rs => rs.filter(r => r.id !== id));
  const toggleRecurrence = (id) => setRecurrences(rs => rs.map(r => r.id === id ? { ...r, active: !r.active } : r));

  // ── Plaid sync result (drives the post-sync review banner) ───────────────────
  const handleSyncComplete = useCallback((count, uncategorized) => {
    setLastSyncResult(count > 0 ? { count, uncategorized } : null);
  }, []);

  // ── Settings handlers ────────────────────────────────────────────────────────
  // ── Net worth history import ──────────────────────────────────────────────────
  const handleImportNetWorthHistory = (rows) => {
    setNetWorthHistory(prev => {
      const existing = new Set(prev.map(h => h.date));
      const newRows  = rows.filter(r => !existing.has(r.date));
      return [...prev, ...newRows].sort((a, b) => a.date.localeCompare(b.date));
    });
  };

  const handleReset = () => {
    pushUndo();
    setTransactions([]); setAccounts([]); setBudgets([]); setGoals([]); setRecurrences([]); setGrants([]); setNetWorthHistory([]);
  };
  const handleClearDemo = () => {
    pushUndo();
    setTransactions(ts=>ts.filter(t=>!t._seeded));
    setAccounts(as=>as.filter(a=>!a._seeded));
    setBudgets(bs=>bs.filter(b=>!b._seeded));
    setGoals(gs=>gs.filter(g=>!g._seeded));
  };
  const handleImport = (data) => {
    pushUndo();
    setTransactions(data.transactions  ?? []);
    setAccounts(data.accounts          ?? []);
    setBudgets(data.budgets            ?? []);
    setGoals(data.goals                ?? []);
    setRecurrences(data.recurrences    ?? []);
    setGrants(data.grants              ?? []);
    setNetWorthHistory(data.netWorthHistory ?? []);
  };

  // ── Budget notifications ─────────────────────────────────────────────────────
  useEffect(() => {
    if (appStatus !== 'ready' || !budgetAlerts.enabled) return;
    const m = today().slice(0, 7);
    const alerts = checkBudgetAlerts(budgets, transactions, m, budgetAlerts.warnAt, budgetAlerts.alertAt);
    alerts.forEach(a => {
      const key = `${m}:${a.category}:${a.type}`;
      if (notifiedThresholds.current.has(key)) return;
      notifiedThresholds.current.add(key);
      const title = a.type === 'alert' ? `Budget Exceeded: ${a.category}` : `Budget Warning: ${a.category}`;
      const body  = `${a.category} is at ${a.pct}% of its ${fmt(a.budget)} budget this month.`;
      if (!('Notification' in window)) return;
      if (Notification.permission === 'granted') {
        new Notification(title, { body });
      } else if (Notification.permission !== 'denied') {
        Notification.requestPermission().then(perm => {
          if (perm === 'granted') new Notification(title, { body });
        });
      }
    });
  }, [transactions, budgets, budgetAlerts.enabled, budgetAlerts.warnAt, budgetAlerts.alertAt, appStatus]); // eslint-disable-line

  const handleSaveBudgetAlerts = (patch) => setBudgetAlerts(prev => ({ ...prev, ...patch }));

  // ── Budget alerts ────────────────────────────────────────────────────────────
  const overBudgetCount = useMemo(() => {
    const m = today().slice(0, 7);
    const monthBudgets = budgets.filter(b => b.month === m);
    if (!monthBudgets.length) return 0;
    const spend = {};
    transactions
      .filter(t => t.type === 'expense' && t.date.startsWith(m))
      .forEach(t => { spend[t.category] = (spend[t.category] || 0) + Math.abs(t.amount); });
    return monthBudgets.filter(b => (spend[b.category] || 0) > b.amount).length;
  }, [budgets, transactions]);

  // ── Nav items ────────────────────────────────────────────────────────────────
  const nav = [
    { id:'dashboard',    icon:'🏠', label:'Dashboard'   },
    { id:'transactions', icon:'💸', label:'Transactions' },
    { id:'accounts',     icon:'🏦', label:'Accounts'     },
    { id:'budgets',      icon:'🎯', label:'Budgets'      },
    { id:'reports',      icon:'📊', label:'Reports'      },
    { id:'business',     icon:'🏢', label:'Business'     },
    { id:'settings',     icon:'⚙️', label:'Settings'     },
  ];

  // ── Render: Loading ──────────────────────────────────────────────────────────
  if (appStatus === 'loading') {
    return (
      <div style={{ height:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'#0d1117' }}>
        <div style={{ textAlign:'center', color:'#475569' }}>
          <div style={{ fontFamily:'DM Serif Display, serif', fontSize:28, color:'#7fa88b', marginBottom:12 }}>Pocket Watch</div>
          <div style={{ fontSize:14 }}>Loading your data…</div>
        </div>
      </div>
    );
  }

  // ── Render: First run ────────────────────────────────────────────────────────
  if (appStatus === 'firstrun') {
    return <FirstRunScreen onDefault={handleFirstRunDefault} onChoose={handleFirstRunChoose} error={firstRunError} />;
  }

  // ── Render: Main app ─────────────────────────────────────────────────────────
  return (
    <PrivacyContext.Provider value={privacyMode}>
    <div className="layout">
      {/* Sidebar */}
      <div className={`sidebar${sidebarCollapsed?' collapsed':''}`}>
        <div className="logo" style={{ display:'flex',alignItems:'center',justifyContent:'space-between',paddingRight:8 }}>
          {!sidebarCollapsed && (
            <div>
              <div className="logo-text">Pocket Watch</div>
              <div className="logo-sub">Personal Finance</div>
            </div>
          )}
          <button className="sidebar-toggle" onClick={()=>setSidebarCollapsed(c=>!c)} title={sidebarCollapsed?'Expand sidebar':'Collapse sidebar'}>
            {sidebarCollapsed ? '»' : '«'}
          </button>
        </div>
        <div style={{ height:1,background:'#1e2736',margin:'0 16px 8px' }} />
        <nav style={{ flex:1, padding:'4px 0' }}>
          {nav.map(n=>(
            <div key={n.id} className={`nav-item${page===n.id?' active':''}`} onClick={()=>setPage(n.id)} title={n.label}>
              <span className="nav-icon" style={{ position:'relative' }}>
                {n.icon}
                {n.id === 'budgets' && overBudgetCount > 0 && (
                  <span style={{ position:'absolute', top:-5, right:-7, background:'#c2735a', color:'#fff', borderRadius:'50%', fontSize:9, fontWeight:700, width:15, height:15, display:'flex', alignItems:'center', justifyContent:'center' }}>
                    {overBudgetCount}
                  </span>
                )}
              </span>
              {!sidebarCollapsed && <span className="nav-label">{n.label}</span>}
            </div>
          ))}
        </nav>
        {!sidebarCollapsed && (
          <div style={{ padding: '10px 16px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }} className="sidebar-footer">
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Pocket Watch</span>
            <button
              className="btn-ghost btn-sm"
              onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              style={{ fontSize: 16, padding: '4px 8px', lineHeight: 1 }}
            >
              {theme === 'dark' ? '☀' : '☾'}
            </button>
          </div>
        )}
      </div>

      {/* Main content */}
      <div className="main">
        <div style={{ position:'sticky', top:0, zIndex:10, display:'flex', justifyContent:'flex-end', padding:'5px 16px', background:'#0d1117', borderBottom:'1px solid #1e273640' }}>
          <button className="btn btn-ghost btn-sm" style={{ fontSize:11, opacity:0.75 }}
            title={privacyMode ? 'Show amounts' : 'Hide amounts'}
            onClick={() => { const n = !privacyMode; setPrivacyMode(n); localStorage.setItem('pw_privacy', n ? '1' : '0'); }}>
            {privacyMode ? '👁‍🗨 Show' : '👁 Hide'}
          </button>
        </div>
        {page==='dashboard'    && <Dashboard    transactions={transactions} accounts={accounts} budgets={budgets} recurrences={recurrences} grants={grants} netWorthHistory={netWorthHistory} goals={goals} onAddTx={()=>setShowAdd(true)} onAddGoal={addGoal} onEditGoal={editGoal} onDeleteGoal={deleteGoal} onDeposit={depositGoal} onGoToBudgets={()=>setPage('budgets')} compensationProfile={compensationProfile} onCategoryClick={cat=>{ setTxCatFilter(cat); setPage('transactions'); }} onGoToReports={(tab) => { setReportsInitialTab(tab ?? 'trend'); setPage('reports'); }} />}
        {page==='transactions' && <Transactions transactions={transactions} accounts={accounts} onAdd={addTx} onEdit={editTx} onDelete={deleteTx} onBulkDelete={bulkDelete} onCSVImport={importTxs} existingTxs={transactions} initialCatFilter={txCatFilter} onClearCatFilter={()=>setTxCatFilter('All')} userCategories={userCategories} archivedTransactions={archivedTransactions} onRestoreArchive={handleRestoreArchive} recurrences={recurrences} lastSyncResult={lastSyncResult} onDismissSyncResult={()=>setLastSyncResult(null)} dataPath={dataPath} />}
        {page==='budgets'      && <Budgets      transactions={transactions} budgets={budgets} onAdd={addBudget} onEdit={editBudget} onDelete={deleteBudget} userCategories={userCategories} budgetTemplates={budgetTemplates} onSaveTemplate={handleSaveTemplate} onLoadTemplate={handleLoadTemplate} onBudgetAlert={handleBudgetAlert} onToggleTemplateAutoApply={handleToggleTemplateAutoApply} onCloseMonth={()=>setShowMonthClose(true)} />}
        {page==='accounts'     && <Accounts     accounts={accounts} transactions={transactions} netWorthHistory={netWorthHistory} recurrences={recurrences} onAdd={addAcct} onEdit={editAcct} onDelete={deleteAcct} onToggleCleared={toggleCleared} onReconcile={handleReconcile} onUpdateStatementDate={handleUpdateStatementDate} onImportStatement={importTxs} />}
        {page==='reports'      && <Reports      transactions={transactions} accounts={accounts} budgets={budgets} netWorthHistory={netWorthHistory} onCategoryDrillDown={cat => { setTxCatFilter(cat); setPage('transactions'); }} initialTab={reportsInitialTab} />}
        {page==='business'     && <Business     accounts={accounts} transactions={transactions} onUpdateTransaction={editTx} />}
        {page==='settings'     && <Settings     transactions={transactions} accounts={accounts} budgets={budgets} goals={goals} netWorthHistory={netWorthHistory} dataPath={dataPath} onReset={handleReset} onClearDemo={handleClearDemo} onImport={handleImport} onChangeDataFile={handleChangeDataFile} userCategories={userCategories} onAddUserCategory={addUserCategory} onDeleteUserCategory={deleteUserCategory} apiKeys={apiKeys} onSaveApiKeys={handleSaveApiKeys} archivedTransactions={archivedTransactions} onArchive={handleArchive} onRestoreArchive={handleRestoreArchive} onImportNetWorthHistory={handleImportNetWorthHistory} onPlaidImport={importTxs} onPlaidBalances={updateAcctBalances} onToast={showToast} onPlaidSyncComplete={handleSyncComplete} onPlaidModify={plaidModifyTxs} onPlaidRemove={plaidRemoveTxs} recurrences={recurrences} onAddRecurrence={addRecurrence} onEditRecurrence={editRecurrence} onDeleteRecurrence={deleteRecurrence} onToggleRecurrence={toggleRecurrence} grants={grants} onAddGrant={addGrant} onEditGrant={editGrant} onDeleteGrant={deleteGrant} onAddTx={addTx} onVestToAccount={vestToAccount} onUpdateGrantPrice={updateGrantPrice} compensationProfile={compensationProfile} onSetCompensationProfile={setCompensationProfile} budgetAlerts={budgetAlerts} onSaveBudgetAlerts={handleSaveBudgetAlerts} />}
      </div>

      {showAdd && (
        <Modal title="Add Transaction" onClose={()=>setShowAdd(false)}>
          <TransactionForm accounts={accounts} existingTransactions={transactions} onSave={tx=>{ addTx(tx); setShowAdd(false); }} onClose={()=>setShowAdd(false)} userCategories={userCategories} dataPath={dataPath} />
        </Modal>
      )}
      {showTransfer && (
        <Modal title="Account Transfer" onClose={()=>setShowTransfer(false)}>
          <TransferForm accounts={accounts} onSave={(tx1,tx2)=>{ handleTransfer(tx1,tx2); setShowTransfer(false); }} onClose={()=>setShowTransfer(false)} />
        </Modal>
      )}
      {showAdjustment && (
        <Modal title="Update Account Balance" onClose={()=>setShowAdjustment(false)}>
          <AdjustmentForm accounts={accounts} onSave={(a,b,d,n)=>{ handleAdjustment(a,b,d,n); setShowAdjustment(false); }} onClose={()=>setShowAdjustment(false)} />
        </Modal>
      )}
      {showPalette && (
        <CommandPalette transactions={transactions} accounts={accounts} goals={goals}
          onClose={()=>setShowPalette(false)} onNavigate={(p)=>{ setPage(p); setShowPalette(false); }}
          onCloseMonth={()=>{ setShowMonthClose(true); setShowPalette(false); }} />
      )}
      {showHelp && (
        <div style={{ position:'fixed',inset:0,background:'#00000088',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center' }} onClick={()=>setShowHelp(false)}>
          <div style={{ background:'#161d2b',border:'1px solid #1e2736',borderRadius:12,padding:'24px 28px',minWidth:340,maxWidth:440 }} onClick={e=>e.stopPropagation()}>
            <div style={{ fontWeight:700,fontSize:16,color:'#e2e8f0',marginBottom:16 }}>⌨️ Keyboard Shortcuts</div>
            {[
              ['1–9',         'Navigate to page'],
              ['N',           'New transaction'],
              ['T',           'New transfer'],
              ['B',           'Update balance'],
              ['Enter',       'Quick Add (in sidebar input)'],
              ['Ctrl+K',      'Command palette'],
              ['Ctrl+Z',      'Undo'],
              ['Ctrl+Y',      'Redo'],
              ['?',           'Toggle this help'],
              ['Escape',      'Close modals / palette'],
            ].map(([key, label]) => (
              <div key={key} style={{ display:'flex',justifyContent:'space-between',alignItems:'center',padding:'6px 0',borderBottom:'1px solid #1e273640' }}>
                <kbd style={{ background:'#1e2736',border:'1px solid #334155',borderRadius:5,padding:'2px 8px',fontSize:12,color:'#94a3b8',fontFamily:'monospace' }}>{key}</kbd>
                <span style={{ fontSize:13,color:'#64748b' }}>{label}</span>
              </div>
            ))}
            <div style={{ marginTop:14,textAlign:'center' }}>
              <button className="btn btn-ghost btn-sm" onClick={()=>setShowHelp(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
      {showMonthClose && (
        <MonthClose
          transactions={transactions}
          accounts={accounts}
          budgets={budgets}
          netWorthHistory={netWorthHistory}
          userCategories={userCategories}
          onEditTx={editTx}
          onAdjustBalance={(acctId, newBal) => handleAdjustment(acctId, newBal, today(), '')}
          onClose={()=>setShowMonthClose(false)}
        />
      )}
      {!onboardingDone && (
        <OnboardingWizard onComplete={(accts, buds) => {
          if (accts?.length)  setAccounts(accts);
          if (buds?.length)   setBudgets(buds);
          setOnboardingDone(true);
        }} />
      )}

      {/* Toast notifications */}
      <div style={{ position:'fixed', bottom:24, right:24, display:'flex', flexDirection:'column', gap:8, zIndex:9999, pointerEvents:'none' }}>
        {toasts.map(t => (
          <div key={t.id} style={{
            background:'#1e2736',
            border:`1px solid ${
              t.type==='success' ? '#22c55e'
              : t.type==='warning' ? '#f59e0b'
              : t.type==='error'   ? '#ef4444'
              : '#60a5fa'
            }`,
            borderRadius:8,
            padding:'10px 16px',
            fontSize:13,
            color:'#e2e8f0',
            boxShadow:'0 4px 12px #00000066',
            pointerEvents:'none',
            animation:'fadeIn 0.2s ease',
            maxWidth:320,
          }}>
            {t.type==='success' ? '✓ ' : t.type==='warning' ? '⚠ ' : t.type==='error' ? '✕ ' : 'ℹ '}{t.msg}
          </div>
        ))}
      </div>
    </div>
    </PrivacyContext.Provider>
  );
}
