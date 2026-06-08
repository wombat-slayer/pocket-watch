import { useState } from 'react';
import { uid, parseAmount, ACCOUNT_TYPES } from '../constants.js';

// Names must match CATEGORIES in constants.js exactly
const BUDGET_CATEGORIES = [
  { name: 'Food & Dining',   icon: '🍔', placeholder: '500' },
  { name: 'Housing',         icon: '🏠', placeholder: '1500' },
  { name: 'Transportation',  icon: '🚗', placeholder: '300' },
  { name: 'Entertainment',   icon: '🎬', placeholder: '100' },
];

const S = {
  overlay: {
    position: 'fixed',
    inset: 0,
    zIndex: 9999,
    background: 'rgba(0,0,0,0.75)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '16px',
  },
  card: {
    background: 'var(--bg-raised)',
    border: '1px solid var(--bg-raised)',
    borderRadius: '16px',
    width: '100%',
    maxWidth: '480px',
    padding: '40px 36px 32px',
    display: 'flex',
    flexDirection: 'column',
    gap: '24px',
    boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
    position: 'relative',
  },
  stepDots: {
    display: 'flex',
    gap: '8px',
    justifyContent: 'center',
  },
  dot: (active) => ({
    width: active ? '24px' : '8px',
    height: '8px',
    borderRadius: '4px',
    background: active ? 'var(--red)' : '#2d3f5f',
    transition: 'all 0.25s ease',
  }),
  heading: {
    fontSize: '24px',
    fontWeight: 700,
    color: 'var(--text-primary)',
    margin: 0,
    lineHeight: 1.2,
  },
  sub: {
    fontSize: '14px',
    color: 'var(--text-secondary)',
    margin: 0,
    lineHeight: 1.6,
  },
  label: {
    display: 'block',
    fontSize: '12px',
    fontWeight: 600,
    color: 'var(--text-secondary)',
    marginBottom: '6px',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  input: {
    width: '100%',
    background: 'var(--bg-page)',
    border: '1px solid var(--bg-raised)',
    borderRadius: '8px',
    padding: '10px 12px',
    color: 'var(--text-primary)',
    fontSize: '14px',
    boxSizing: 'border-box',
    outline: 'none',
  },
  select: {
    width: '100%',
    background: 'var(--bg-page)',
    border: '1px solid var(--bg-raised)',
    borderRadius: '8px',
    padding: '10px 12px',
    color: 'var(--text-primary)',
    fontSize: '14px',
    boxSizing: 'border-box',
    outline: 'none',
    cursor: 'pointer',
  },
  row: {
    display: 'flex',
    gap: '12px',
  },
  col: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
  },
  btnPrimary: {
    background: 'var(--red)',
    color: '#fff',
    border: 'none',
    borderRadius: '8px',
    padding: '12px 24px',
    fontSize: '15px',
    fontWeight: 600,
    cursor: 'pointer',
    width: '100%',
    transition: 'opacity 0.15s',
  },
  btnSecondary: {
    background: 'var(--bg-raised)',
    color: 'var(--text-primary)',
    border: '1px solid var(--border-default)',
    borderRadius: '8px',
    padding: '12px 24px',
    fontSize: '15px',
    fontWeight: 600,
    cursor: 'pointer',
    width: '100%',
    transition: 'opacity 0.15s',
  },
  btnRow: {
    display: 'flex',
    gap: '10px',
    flexDirection: 'column',
  },
  skipLink: {
    textAlign: 'center',
    fontSize: '13px',
    color: 'var(--text-secondary)',
    cursor: 'pointer',
    textDecoration: 'underline',
    background: 'none',
    border: 'none',
    padding: 0,
    marginTop: '4px',
  },
  summaryItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '10px 14px',
    background: 'var(--bg-page)',
    borderRadius: '8px',
    fontSize: '14px',
    color: 'var(--text-primary)',
  },
  dot2: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    background: 'var(--green)',
    flexShrink: 0,
  },
};

function StepDots({ step, total }) {
  return (
    <div style={S.stepDots}>
      {Array.from({ length: total }, (_, i) => (
        <div key={i} style={S.dot(i === step)} />
      ))}
    </div>
  );
}

function StepWelcome({ onNext }) {
  return (
    <>
      <div style={{ textAlign: 'center', fontSize: '48px', lineHeight: 1 }}>⌚</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', textAlign: 'center' }}>
        <h1 style={S.heading}>Welcome to Pocket Watch</h1>
        <p style={S.sub}>
          Your personal finance companion for tracking accounts, budgets, and goals —
          all stored locally on your device.
        </p>
        <p style={S.sub}>
          This quick setup takes about a minute and gets you started with your first account and budget.
        </p>
      </div>
      <button style={S.btnPrimary} onClick={onNext}>Get Started →</button>
    </>
  );
}

function StepAccount({ onNext }) {
  const [name,    setName]    = useState('');
  const [type,    setType]    = useState('checking');
  const [balance, setBalance] = useState('');
  const [error,   setError]   = useState('');

  const handleAdd = () => {
    if (!name.trim()) { setError('Please enter an account name.'); return; }
    const bal = parseAmount(balance || '0');
    if (isNaN(bal)) { setError('Please enter a valid balance.'); return; }
    onNext([{ id: uid(), name: name.trim(), type, balance: Math.abs(bal) }]);
  };

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <h2 style={{ ...S.heading, fontSize: '20px' }}>Add your first account</h2>
        <p style={S.sub}>Where do you keep your money? Add a bank account, card, or wallet to get started.</p>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div>
          <label style={S.label}>Account Name</label>
          <input
            style={S.input}
            type="text"
            placeholder="e.g. Chase Checking"
            value={name}
            onChange={e => { setName(e.target.value); setError(''); }}
          />
        </div>
        <div style={S.row}>
          <div style={S.col}>
            <label style={S.label}>Type</label>
            <select style={S.select} value={type} onChange={e => setType(e.target.value)}>
              {ACCOUNT_TYPES.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
          <div style={S.col}>
            <label style={S.label}>Starting Balance ($)</label>
            <input
              style={S.input}
              type="text"
              placeholder="0.00"
              value={balance}
              onChange={e => { setBalance(e.target.value); setError(''); }}
            />
          </div>
        </div>
        {error && <p style={{ margin: 0, fontSize: '13px', color: 'var(--red)' }}>{error}</p>}
      </div>
      <div style={S.btnRow}>
        <button style={S.btnPrimary} onClick={handleAdd}>Add Account</button>
        <button style={S.btnSecondary} onClick={() => onNext([])}>Skip for now</button>
      </div>
    </>
  );
}

function StepBudgets({ onNext, onSkip }) {
  const [amounts, setAmounts] = useState(
    Object.fromEntries(BUDGET_CATEGORIES.map(c => [c.name, '']))
  );

  const handleSave = () => {
    const budgets = BUDGET_CATEGORIES
      .map(c => ({ category: c.name, amount: parseAmount(amounts[c.name] || '0') }))
      .filter(b => !isNaN(b.amount) && b.amount > 0);
    onNext(budgets);
  };

  const handleSkip = () => onNext([]);

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <h2 style={{ ...S.heading, fontSize: '20px' }}>Set a monthly budget</h2>
        <p style={S.sub}>Set spending limits for common categories. You can always adjust these later.</p>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {BUDGET_CATEGORIES.map(cat => (
          <div key={cat.name} style={S.row}>
            <div style={{
              width: '36px',
              height: '36px',
              background: 'var(--bg-page)',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '18px',
              flexShrink: 0,
              alignSelf: 'flex-end',
              marginBottom: '0',
            }}>
              {cat.icon}
            </div>
            <div style={{ flex: 1 }}>
              <label style={S.label}>{cat.name}</label>
              <input
                style={S.input}
                type="text"
                placeholder={`$${cat.placeholder}`}
                value={amounts[cat.name]}
                onChange={e => setAmounts(a => ({ ...a, [cat.name]: e.target.value }))}
              />
            </div>
          </div>
        ))}
      </div>
      <div style={S.btnRow}>
        <button style={S.btnPrimary} onClick={handleSave}>Save Budgets</button>
        <button style={S.btnSecondary} onClick={handleSkip}>Skip for now</button>
      </div>
    </>
  );
}

function StepDone({ accounts, budgets, onComplete }) {
  const summary = [];
  if (accounts.length > 0) {
    accounts.forEach(a => summary.push(`${a.name} (${a.type}) — $${a.balance.toFixed(2)}`));
  }
  if (budgets.length > 0) {
    budgets.forEach(b => summary.push(`${b.category} budget — $${b.amount.toFixed(2)}/mo`));
  }
  if (summary.length === 0) {
    summary.push('You can add accounts and budgets any time from the sidebar.');
  }

  return (
    <>
      <div style={{ textAlign: 'center', fontSize: '48px', lineHeight: 1 }}>🎉</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', textAlign: 'center' }}>
        <h2 style={{ ...S.heading, fontSize: '22px' }}>You're all set!</h2>
        <p style={S.sub}>Here's what was added to your account:</p>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {summary.map((item, i) => (
          <div key={i} style={S.summaryItem}>
            <div style={S.dot2} />
            <span>{item}</span>
          </div>
        ))}
      </div>
      <button style={S.btnPrimary} onClick={onComplete}>Open Dashboard →</button>
    </>
  );
}

export default function OnboardingWizard({ onComplete }) {
  const [step,     setStep]     = useState(0);
  const [accounts, setAccounts] = useState([]);
  const [budgets,  setBudgets]  = useState([]);

  const skipAll = () => onComplete([], []);

  const handleAccountNext = (accts) => {
    setAccounts(accts);
    setStep(2);
  };

  const handleBudgetNext = (bdgts) => {
    setBudgets(bdgts);
    setStep(3);
  };

  const handleDone = () => {
    onComplete(accounts, budgets);
  };

  return (
    <div style={S.overlay}>
      <div style={S.card}>
        <StepDots step={step} total={4} />

        {step === 0 && <StepWelcome onNext={() => setStep(1)} />}
        {step === 1 && <StepAccount onNext={handleAccountNext} />}
        {step === 2 && <StepBudgets onNext={handleBudgetNext} />}
        {step === 3 && <StepDone accounts={accounts} budgets={budgets} onComplete={handleDone} />}

        {step < 3 && (
          <button style={S.skipLink} onClick={skipAll}>
            Skip setup
          </button>
        )}
      </div>
    </div>
  );
}
