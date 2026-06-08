import { useState, useEffect, useRef } from 'react';
import { acctEmoji, acctLabel, catIcon, fmt, fmtDate } from '../constants.js';

export default function CommandPalette({ transactions, accounts, goals, onClose, onNavigate, onCloseMonth }) {
  const [query,  setQuery]  = useState('');
  const [selIdx, setSelIdx] = useState(0);
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const pages = [
    { id:'dashboard',    label:'Dashboard',    icon:'🏠', type:'page' },
    { id:'transactions', label:'Transactions', icon:'💸', type:'page' },
    { id:'accounts',     label:'Accounts',     icon:'🏦', type:'page' },
    { id:'budgets',      label:'Budgets',      icon:'🎯', type:'page' },
    { id:'reports',      label:'Reports',      icon:'📊', type:'page' },
    { id:'settings',     label:'Settings',     icon:'⚙️', type:'page' },
  ];

  const actions = [
    { id:'close-month', label:'Close Month…', icon:'📅', type:'action', run: onCloseMonth },
  ].filter(a => a.run);

  const q = query.toLowerCase().trim();
  const matchPages   = pages.filter(p => !q || p.label.toLowerCase().includes(q));
  const matchActions = actions.filter(a => !q || a.label.toLowerCase().includes(q));
  const matchAccts = accounts.filter(a => !q || a.name.toLowerCase().includes(q)).slice(0,4).map(a=>({...a,acctType:a.type,type:'account',label:a.name,icon:acctEmoji(a.type)}));
  const matchGoals = goals.filter(g => !q || g.name.toLowerCase().includes(q)).slice(0,4).map(g=>({...g,type:'goal',label:g.name}));
  const matchTxs   = q ? transactions.filter(t=>t.description.toLowerCase().includes(q)||t.category.toLowerCase().includes(q)).slice(0,5).map(t=>({...t,type:'tx',label:t.description,icon:catIcon(t.category)})) : [];

  const items = [
    ...matchPages.map(p=>({...p,section:'Pages'})),
    ...matchActions.map(a=>({...a,section:'Actions'})),
    ...matchAccts.map(a=>({...a,section:'Accounts'})),
    ...matchGoals.map(g=>({...g,section:'Goals'})),
    ...matchTxs.map(t=>({...t,section:'Transactions'})),
  ];

  const handleKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelIdx(i=>Math.min(i+1,items.length-1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSelIdx(i=>Math.max(i-1,0)); }
    else if (e.key === 'Enter' && items[selIdx]) { activate(items[selIdx]); }
    else if (e.key === 'Escape') { onClose(); }
  };

  const activate = (item) => {
    if      (item.type === 'action')  { item.run(); return; } // action handles its own close
    if      (item.type === 'page')    onNavigate(item.id);
    else if (item.type === 'account') onNavigate('accounts');
    else if (item.type === 'goal')    onNavigate('dashboard'); // goals live on the Dashboard now
    else if (item.type === 'tx')      onNavigate('transactions');
    onClose();
  };

  let lastSection = '';
  return (
    <div className="palette-overlay" onClick={onClose}>
      <div className="palette-box" onClick={e=>e.stopPropagation()}>
        <input ref={inputRef} className="palette-input" placeholder="Search pages, accounts, transactions…"
          value={query} onChange={e=>{setQuery(e.target.value);setSelIdx(0);}} onKeyDown={handleKey} />
        <div className="palette-results">
          {items.length === 0
            ? <div style={{ padding:'24px',textAlign:'center',color:'var(--text-muted)',fontSize:14 }}>No results</div>
            : items.map((item,i) => {
                const showSec = item.section !== lastSection;
                lastSection = item.section;
                return (
                  <div key={item.id+''+i}>
                    {showSec && <div className="palette-section">{item.section}</div>}
                    <div className={`palette-item${i===selIdx?' selected':''}`} onClick={()=>activate(item)}>
                      <span style={{ fontSize:18,width:24,textAlign:'center' }}>{item.icon ?? '📄'}</span>
                      <div style={{ flex:1 }}>
                        <div style={{ fontSize:14,color:'var(--text-primary)',fontWeight:500 }}>{item.label}</div>
                        {item.type==='account' && <div style={{ fontSize:12,color:'var(--text-secondary)' }}>{acctLabel(item.acctType??item.type)} · {fmt(item.balance)}</div>}
                        {item.type==='tx'      && <div style={{ fontSize:12,color:'var(--text-secondary)' }}>{fmtDate(item.date)} · <span style={{ color:item.amount>=0?'var(--green)':'var(--red)' }}>{fmt(item.amount)}</span></div>}
                        {item.type==='goal'    && <div style={{ fontSize:12,color:'var(--text-secondary)' }}>{fmt(item.current)} / {fmt(item.target)}</div>}
                      </div>
                      {item.type==='page' && <span style={{ fontSize:11,color:'var(--text-muted)' }}>Go to ↵</span>}
                    </div>
                  </div>
                );
              })
          }
        </div>
        <div style={{ padding:'8px 16px',borderTop:'1px solid var(--bg-raised)',display:'flex',gap:16,fontSize:11,color:'var(--text-muted)' }}>
          <span>↑↓ navigate</span><span>↵ open</span><span>esc close</span>
        </div>
      </div>
    </div>
  );
}
