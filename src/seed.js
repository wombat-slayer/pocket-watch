import { uid, today, thisMonth } from './constants.js';

export const seedGoals = () => [
  { id: uid(), name: 'Emergency Fund',  emoji: '🛡️', target: 10000, current: 3200, targetDate: '', color: '#10b981', _seeded: true },
  { id: uid(), name: 'Vacation Fund',   emoji: '✈️', target: 3000,  current: 850,  targetDate: '', color: '#3b82f6', _seeded: true },
  { id: uid(), name: 'New Laptop',      emoji: '💻', target: 1500,  current: 600,  targetDate: '', color: '#8b5cf6', _seeded: true },
];

export const seedTransactions = () => {
  const now = new Date();
  const templates = [
    ['Housing','Rent payment',-1850],['Food & Dining','Whole Foods market',-112],
    ['Transportation','Shell gas station',-58],['Subscriptions','Netflix',-15.99],
    ['Food & Dining','Chipotle',-13.50],['Utilities','Electric bill',-94],
    ['Shopping','Amazon order',-67],['Healthcare','CVS pharmacy',-28],
    ['Food & Dining','Starbucks',-6.50],['Subscriptions','Spotify',-9.99],
    ['Transportation','Uber',-22],['Food & Dining','Sushi restaurant',-78],
    ['Entertainment','AMC Theaters',-24],['Personal Care','Hair salon',-55],
    ['Income','Direct deposit paycheck',4200],['Income','Freelance consulting',800],
    ['Shopping','Target',-43],['Food & Dining','DoorDash',-38],
    ['Utilities','Internet bill',-79],['Travel','Hotel booking',-189],
  ];
  const items = [];
  for (let i = 0; i < 35; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - Math.floor(Math.random() * 75));
    const [cat, desc, amt] = templates[Math.floor(Math.random() * templates.length)];
    items.push({ id: uid(), date: d.toISOString().split('T')[0], description: desc, category: cat, amount: amt, account: 'seed-checking', type: amt > 0 ? 'income' : 'expense', notes: '', _seeded: true });
  }
  return items.sort((a, b) => b.date.localeCompare(a.date));
};

export const seedAccounts = () => [
  { id: 'seed-checking',   name: 'Chase Checking',    type: 'checking',   balance: 4820.50, _seeded: true },
  { id: 'seed-savings',    name: 'Ally Savings',       type: 'savings',    balance: 12300,   _seeded: true },
  { id: 'seed-credit',     name: 'Visa Credit Card',   type: 'credit',     balance: 1240.80, _seeded: true },
  { id: 'seed-investment', name: 'Fidelity 401k',      type: 'investment', balance: 48000,   _seeded: true },
];

export const seedBudgets = () => [
  { id: uid(), category: 'Housing',       amount: 2000, month: thisMonth(), _seeded: true },
  { id: uid(), category: 'Food & Dining', amount: 600,  month: thisMonth(), _seeded: true },
  { id: uid(), category: 'Transportation',amount: 300,  month: thisMonth(), _seeded: true },
  { id: uid(), category: 'Entertainment', amount: 100,  month: thisMonth(), _seeded: true },
  { id: uid(), category: 'Utilities',     amount: 150,  month: thisMonth(), _seeded: true },
  { id: uid(), category: 'Shopping',      amount: 200,  month: thisMonth(), _seeded: true },
  { id: uid(), category: 'Healthcare',    amount: 100,  month: thisMonth(), _seeded: true },
  { id: uid(), category: 'Subscriptions', amount: 50,   month: thisMonth(), _seeded: true },
];
