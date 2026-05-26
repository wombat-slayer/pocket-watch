import { useState } from 'react';
import { fmt, uid, sanitizeText, safeNum } from '../constants.js';
import Modal from './Modal.jsx';

function GoalForm({ goal, accounts, onSave, onClose }) {
  const [form, setForm] = useState(goal ?? { name:'', emoji:'🎯', target:1000, current:0, targetDate:'', color:'#3b82f6', linkedAccountId:null });
  const set = (k,v) => setForm(f=>({...f,[k]:v}));
  const COLORS = ['#3b82f6','#10b981','#f59e0b','#8b5cf6','#c2735a','#06b6d4','#ec4899','#84cc16'];
  const EMOJIS = ['🎯','🏠','✈️','💻','🚗','💍','📚','🛡️','🏖️','💰','🎓','🏋️'];
  const handleSave = () => {
    if (!form.name.trim()) return;
    onSave({ ...form, name: sanitizeText(form.name, 60), target: safeNum(form.target,1000), current: safeNum(form.current,0), id: form.id ?? uid(), linkedAccountId: form.linkedAccountId || null });
  };
  return (
    <div style={{ display:'flex',flexDirection:'column',gap:14 }}>
      <div className="form-group">
        <label className="form-label">Goal Name</label>
        <input type="text" maxLength={60} placeholder="e.g. Emergency Fund" value={form.name} onChange={e=>set('name',e.target.value)} />
      </div>
      <div style={{ display:'flex',gap:6,flexWrap:'wrap',marginTop:-4 }}>
        {EMOJIS.map(e=><button key={e} className="btn btn-secondary btn-sm" style={{ fontSize:18,padding:'4px 8px',opacity:form.emoji===e?1:0.5,transform:form.emoji===e?'scale(1.2)':'none' }} onClick={()=>set('emoji',e)}>{e}</button>)}
      </div>
      <div className="form-grid form-grid-2">
        <div className="form-group">
          <label className="form-label">Target Amount</label>
          <input type="number" min={1} step={100} value={form.target} onChange={e=>set('target',e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">Current Saved</label>
          <input type="number" min={0} step={50} value={form.current} onChange={e=>set('current',e.target.value)}
            disabled={!!form.linkedAccountId} title={form.linkedAccountId ? 'Synced from linked account' : ''} />
        </div>
      </div>
      <div className="form-group">
        <label className="form-label">Target Date (optional)</label>
        <input type="date" value={form.targetDate} onChange={e=>set('targetDate',e.target.value)} />
      </div>
      <div className="form-group">
        <label className="form-label">Link to Account (optional)</label>
        <select value={form.linkedAccountId ?? ''} onChange={e=>set('linkedAccountId',e.target.value||null)}>
          <option value="">— No linked account —</option>
          {(accounts ?? []).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        {form.linkedAccountId && (
          <div style={{ fontSize:12, color:'#7fa88b', marginTop:4 }}>🔗 Progress will sync from account balance</div>
        )}
      </div>
      <div className="form-group">
        <label className="form-label">Color</label>
        <div style={{ display:'flex',gap:8 }}>
          {COLORS.map(c=>(
            <div key={c} onClick={()=>set('color',c)} style={{ width:24,height:24,borderRadius:'50%',background:c,cursor:'pointer',outline:form.color===c?'2px solid #e2e8f0':'none',outlineOffset:2 }} />
          ))}
        </div>
      </div>
      <div style={{ display:'flex',gap:8,justifyContent:'flex-end' }}>
        <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={handleSave}>{goal ? 'Update Goal' : 'Add Goal'}</button>
      </div>
    </div>
  );
}

export default function Goals({ goals, accounts, onAdd, onEdit, onDelete, onDeposit }) {
  const [showAdd,     setShowAdd]     = useState(false);
  const [editGoal,    setEditGoal]    = useState(null);
  const [depositGoal, setDepositGoal] = useState(null);
  const [depositAmt,  setDepositAmt]  = useState('');

  // Resolve current value: if linked to account, use account balance
  const resolvedCurrent = (g) => {
    if (g.linkedAccountId) {
      const acct = (accounts ?? []).find(a => a.id === g.linkedAccountId);
      return acct?.balance ?? g.current;
    }
    return g.current;
  };

  const totalTarget = goals.reduce((s,g)=>s+g.target,0);
  const totalSaved  = goals.reduce((s,g)=>s+resolvedCurrent(g),0);
  const totalPct    = totalTarget > 0 ? Math.min(100, totalSaved/totalTarget*100) : 0;

  const handleDeposit = (goal, sign) => {
    const amt = safeNum(depositAmt, 0);
    if (amt <= 0) return;
    if (sign < 0 && amt > goal.current) {
      if (!confirm(`Withdrawing ${fmt(amt)} would reduce this goal below $0. The balance will be set to $0. Continue?`)) return;
    }
    onDeposit(goal.id, sign * amt);
    setDepositGoal(null);
    setDepositAmt('');
  };

  return (
    <div className="fade-in" style={{ padding:'24px 28px' }}>
      <div className="section-header">
        <div>
          <div className="section-title">Goals</div>
          <div className="section-sub">Track savings targets and financial milestones</div>
        </div>
        <button className="btn btn-primary" onClick={()=>setShowAdd(true)}>+ New Goal</button>
      </div>

      {goals.length > 0 && (
        <div className="card" style={{ marginBottom:20,display:'flex',alignItems:'center',gap:20,padding:'16px 20px' }}>
          <div style={{ flex:1 }}>
            <div style={{ display:'flex',justifyContent:'space-between',marginBottom:8 }}>
              <span style={{ fontSize:13,color:'#94a3b8' }}>Overall progress across {goals.length} goal{goals.length!==1?'s':''}</span>
              <span style={{ fontSize:13,fontWeight:600,color:'#e2e8f0' }}>{fmt(totalSaved)} / {fmt(totalTarget)}</span>
            </div>
            <div className="goal-progress"><div className="goal-fill" style={{ width:`${totalPct}%`,background:'linear-gradient(90deg,#3b82f6,#8b5cf6)' }} /></div>
            <div style={{ fontSize:12,color:'#64748b',marginTop:4 }}>{totalPct.toFixed(0)}% funded · {fmt(totalTarget-totalSaved)} remaining</div>
          </div>
        </div>
      )}

      {goals.length === 0
        ? <div className="empty-state"><div className="empty-icon">🎯</div><p>No goals yet. Create one to start tracking your savings!</p></div>
        : <div style={{ display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(300px,1fr))',gap:16 }}>
            {goals.map(g => {
              const current  = resolvedCurrent(g);
              const linked   = !!g.linkedAccountId;
              const linkedAcct = linked ? (accounts ?? []).find(a => a.id === g.linkedAccountId) : null;
              const pct = g.target > 0 ? Math.min(100, current/g.target*100) : 0;
              const daysLeft = g.targetDate ? Math.ceil((new Date(g.targetDate)-new Date())/86400000) : null;
              return (
                <div key={g.id} className="goal-card">
                  <div style={{ display:'flex',alignItems:'flex-start',justifyContent:'space-between' }}>
                    <div style={{ display:'flex',alignItems:'center',gap:10 }}>
                      <div style={{ fontSize:28 }}>{g.emoji}</div>
                      <div>
                        <div style={{ fontWeight:600,color:'#e2e8f0',fontSize:15 }}>
                          {g.name}
                          {linked && <span title={`Linked to ${linkedAcct?.name ?? 'account'}`} style={{ marginLeft:6,fontSize:13 }}>🔗</span>}
                        </div>
                        {linked && linkedAcct && (
                          <div style={{ fontSize:11,color:'#7fa88b',marginTop:2 }}>Synced from {linkedAcct.name}</div>
                        )}
                        {daysLeft !== null && (
                          <div style={{ fontSize:11,color: daysLeft<30?'#c2735a':'#64748b',marginTop:2 }}>
                            {daysLeft > 0 ? `${daysLeft} days left` : 'Past target date'}
                          </div>
                        )}
                      </div>
                    </div>
                    <div style={{ display:'flex',gap:4 }}>
                      <button className="btn btn-ghost btn-sm" onClick={()=>setEditGoal(g)} title="Edit">✏️</button>
                      <button className="btn btn-ghost btn-sm" onClick={()=>onDelete(g.id)} style={{ color:'#c2735a' }} title="Delete">✕</button>
                    </div>
                  </div>
                  <div className="goal-progress"><div className="goal-fill" style={{ width:`${pct}%`,background:g.color }} /></div>
                  <div style={{ display:'flex',justifyContent:'space-between',fontSize:13 }}>
                    <span style={{ color:'#94a3b8' }}>{fmt(current)} saved</span>
                    <span style={{ color:'#64748b' }}>{pct.toFixed(0)}% of {fmt(g.target)}</span>
                  </div>
                  {!linked && (
                    <div style={{ marginTop:12,display:'flex',gap:6 }}>
                      {depositGoal?.id === g.id
                        ? <>
                            <input type="number" min={1} placeholder="Amount" value={depositAmt} onChange={e=>setDepositAmt(e.target.value)}
                              style={{ flex:1,padding:'6px 10px',fontSize:13 }} autoFocus onKeyDown={e=>e.key==='Enter'&&handleDeposit(g,1)} />
                            <button className="btn btn-green btn-sm" onClick={()=>handleDeposit(g,1)}>Add</button>
                            <button className="btn btn-danger btn-sm" onClick={()=>handleDeposit(g,-1)}>Withdraw</button>
                            <button className="btn btn-ghost btn-sm" onClick={()=>{setDepositGoal(null);setDepositAmt('');}}>✕</button>
                          </>
                        : <button className="btn btn-secondary btn-sm" style={{ flex:1 }} onClick={()=>setDepositGoal(g)}>💰 Update Balance</button>
                      }
                    </div>
                  )}
                </div>
              );
            })}
          </div>
      }

      {(showAdd || editGoal) && (
        <Modal title={editGoal ? 'Edit Goal' : 'New Goal'} onClose={()=>{ setShowAdd(false); setEditGoal(null); }}>
          <GoalForm goal={editGoal} accounts={accounts} onSave={g=>{ editGoal ? onEdit(g) : onAdd(g); setShowAdd(false); setEditGoal(null); }} onClose={()=>{ setShowAdd(false); setEditGoal(null); }} />
        </Modal>
      )}
    </div>
  );
}
