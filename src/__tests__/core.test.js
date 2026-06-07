/**
 * Core unit tests — Pocket Watch
 * Run with: pnpm test  (or: pnpm vitest)
 *
 * Covers: uid, getNextRecurDate, autoCategory, parseCSVLine,
 *         parseAmount, monthlyEquivalent, safeNum, safeDate,
 *         computeBalance, archive roundtrip logic
 */

import { describe, it, expect } from 'vitest';

// Polyfill crypto.randomUUID for Node (available from Node 19+; vitest usually brings it)
if (!globalThis.self) globalThis.self = globalThis;
if (!globalThis.self.crypto) {
  const { webcrypto } = await import('node:crypto');
  globalThis.self.crypto = webcrypto;
}

import {
  uid,
  getNextRecurDate,
  autoCategory,
  parseCSVLine,
  parseAmount,
  monthlyEquivalent,
  safeNum,
  safeDate,
  computeBalance,
  sanitizeText,
  detectAndMarkTransferPairs,
  DEFAULT_COMPENSATION_PROFILE,
  suggestBudgetsFromActuals,
} from '../constants.js';

import { parsePayStub, toMonthly, calcEffectiveTaxRate } from '../utils/parsePayStub.js';

// ─── uid ──────────────────────────────────────────────────────────────────────
describe('uid()', () => {
  it('returns a non-empty string', () => {
    expect(typeof uid()).toBe('string');
    expect(uid().length).toBeGreaterThan(0);
  });

  it('is unique across many calls', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => uid()));
    expect(ids.size).toBe(1000);
  });

  it('matches UUID v4 format', () => {
    const uuid = uid();
    expect(uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });
});

// ─── getNextRecurDate ─────────────────────────────────────────────────────────
describe('getNextRecurDate()', () => {
  it('weekly adds 7 days', () => {
    expect(getNextRecurDate('2025-01-01', 'weekly')).toBe('2025-01-08');
  });

  it('biweekly adds 14 days', () => {
    expect(getNextRecurDate('2025-01-01', 'biweekly')).toBe('2025-01-15');
  });

  it('monthly increments month', () => {
    expect(getNextRecurDate('2025-01-31', 'monthly')).toBe('2025-03-03'); // JS Date overflow
    expect(getNextRecurDate('2025-01-15', 'monthly')).toBe('2025-02-15');
  });

  it('quarterly adds 3 months', () => {
    expect(getNextRecurDate('2025-01-01', 'quarterly')).toBe('2025-04-01');
  });

  it('yearly adds 1 year', () => {
    expect(getNextRecurDate('2025-01-01', 'yearly')).toBe('2026-01-01');
  });

  it('unknown frequency returns same date', () => {
    expect(getNextRecurDate('2025-06-01', 'unknown')).toBe('2025-06-01');
  });
});

// ─── autoCategory ─────────────────────────────────────────────────────────────
describe('autoCategory()', () => {
  it('positive amounts → Income', () => {
    expect(autoCategory('Direct deposit payroll', 2500)).toBe('Income');
  });

  it('rent → Housing', () => {
    expect(autoCategory('Monthly Rent', -1200)).toBe('Housing');
  });

  it('Starbucks → Food & Dining', () => {
    expect(autoCategory('Starbucks Coffee', -6)).toBe('Food & Dining');
  });

  it('Netflix → Subscriptions', () => {
    expect(autoCategory('Netflix subscription', -15)).toBe('Subscriptions');
  });

  it('Shell gas → Transportation', () => {
    expect(autoCategory('Shell station', -55)).toBe('Transportation');
  });

  it('Walgreens → Healthcare', () => {
    expect(autoCategory('Walgreens pharmacy', -30)).toBe('Healthcare');
  });

  it('Amazon → Shopping', () => {
    expect(autoCategory('Amazon.com order', -89)).toBe('Shopping');
  });

  it('Hotel → Travel', () => {
    expect(autoCategory('Hilton Hotel', -210)).toBe('Travel');
  });

  it('fallback → Other', () => {
    expect(autoCategory('Zz random vendor xyz', -10)).toBe('Other');
  });
});

// ─── parseCSVLine ─────────────────────────────────────────────────────────────
describe('parseCSVLine()', () => {
  it('parses simple CSV', () => {
    expect(parseCSVLine('a,b,c')).toEqual(['a', 'b', 'c']);
  });

  it('handles quoted fields with commas', () => {
    expect(parseCSVLine('"hello, world",foo')).toEqual(['hello, world', 'foo']);
  });

  it('handles escaped inner quotes', () => {
    expect(parseCSVLine('"say ""hi""",bar')).toEqual(['say "hi"', 'bar']);
  });

  it('trims whitespace', () => {
    expect(parseCSVLine(' a , b , c ')).toEqual(['a', 'b', 'c']);
  });

  it('handles empty fields', () => {
    expect(parseCSVLine('a,,c')).toEqual(['a', '', 'c']);
  });
});

// ─── parseAmount ──────────────────────────────────────────────────────────────
describe('parseAmount()', () => {
  it('parses plain number', () => {
    expect(parseAmount('123.45')).toBe(123.45);
  });

  it('parses negative', () => {
    expect(parseAmount('-50.00')).toBe(-50);
  });

  it('parses parentheses as negative', () => {
    expect(parseAmount('(75.00)')).toBe(-75);
  });

  it('strips dollar sign and commas', () => {
    expect(parseAmount('$1,234.56')).toBe(1234.56);
  });

  it('strips dollar sign with parens', () => {
    expect(parseAmount('($1,234.56)')).toBe(-1234.56);
  });

  it('returns NaN for empty string', () => {
    expect(parseAmount('')).toBeNaN();
  });

  it('returns NaN for non-numeric', () => {
    expect(parseAmount('abc')).toBeNaN();
  });
});

// ─── monthlyEquivalent ────────────────────────────────────────────────────────
describe('monthlyEquivalent()', () => {
  const rec = (amount, frequency) => ({ amount, frequency });

  it('weekly × 52/12', () => {
    expect(monthlyEquivalent(rec(100, 'weekly'))).toBeCloseTo(433.33, 1);
  });

  it('biweekly × 26/12', () => {
    expect(monthlyEquivalent(rec(500, 'biweekly'))).toBeCloseTo(1083.33, 1);
  });

  it('monthly unchanged', () => {
    expect(monthlyEquivalent(rec(1500, 'monthly'))).toBe(1500);
  });

  it('quarterly ÷ 3', () => {
    expect(monthlyEquivalent(rec(300, 'quarterly'))).toBe(100);
  });

  it('yearly ÷ 12', () => {
    expect(monthlyEquivalent(rec(1200, 'yearly'))).toBe(100);
  });
});

// ─── safeNum ──────────────────────────────────────────────────────────────────
describe('safeNum()', () => {
  it('passes valid numbers', () => {
    expect(safeNum(42)).toBe(42);
    expect(safeNum(-3.14)).toBe(-3.14);
  });

  it('returns fallback for NaN/undefined', () => {
    expect(safeNum(NaN)).toBe(0);
    expect(safeNum(undefined)).toBe(0);
    expect(safeNum('abc', -1)).toBe(-1);
  });

  it('parses numeric strings', () => {
    expect(safeNum('3.5')).toBe(3.5);
  });
});

// ─── safeDate ─────────────────────────────────────────────────────────────────
describe('safeDate()', () => {
  it('passes valid YYYY-MM-DD', () => {
    expect(safeDate('2025-06-15')).toBe('2025-06-15');
  });

  it('returns today for invalid input', () => {
    const result = safeDate('not-a-date');
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

// ─── sanitizeText ─────────────────────────────────────────────────────────────
describe('sanitizeText()', () => {
  it('strips HTML tags', () => {
    expect(sanitizeText('<script>alert(1)</script>Hello')).toBe('Hello');
  });

  it('limits length', () => {
    expect(sanitizeText('a'.repeat(600), 500)).toHaveLength(500);
  });

  it('handles null/undefined', () => {
    expect(sanitizeText(null)).toBe('');
    expect(sanitizeText(undefined)).toBe('');
  });
});

// ─── computeBalance ──────────────────────────────────────────────────────────
describe('computeBalance()', () => {
  const txs = [
    { id: '1', account: 'acc1', amount:  1000, type: 'income'  },
    { id: '2', account: 'acc1', amount:  -200, type: 'expense' },
    { id: '3', account: 'acc1', amount:    50, type: 'adjustment' }, // excluded
    { id: '4', account: 'acc2', amount: -9999, type: 'expense' }, // different account
  ];

  it('sums income - expenses, excludes adjustments', () => {
    expect(computeBalance('acc1', txs, 'checking')).toBe(800);
  });

  it('returns null for investment accounts', () => {
    expect(computeBalance('acc1', txs, 'investment')).toBeNull();
  });

  it('returns null for asset accounts', () => {
    expect(computeBalance('acc1', txs, 'asset')).toBeNull();
  });

  it('returns 0 for unknown account', () => {
    expect(computeBalance('acc999', txs, 'checking')).toBe(0);
  });
});

// ─── Archive / restore roundtrip ─────────────────────────────────────────────
describe('archive roundtrip logic', () => {
  const allTxs = [
    { id: 'a', date: '2022-01-15', amount: -100 },
    { id: 'b', date: '2023-06-10', amount: -200 },
    { id: 'c', date: '2024-11-01', amount: -300 },
    { id: 'd', date: '2025-03-20', amount: -400 },
  ];

  it('archive before date moves correct records', () => {
    const cutoff = '2024-01-01';
    const archived = allTxs.filter(t => t.date < cutoff);
    const active   = allTxs.filter(t => t.date >= cutoff);
    expect(archived.map(t => t.id)).toEqual(['a', 'b']);
    expect(active.map(t => t.id)).toEqual(['c', 'd']);
  });

  it('restore merges back without duplicates', () => {
    const active   = [allTxs[2], allTxs[3]];
    const archived = [allTxs[0], allTxs[1]];
    const restored = [...active, ...archived].sort((a, b) => b.date.localeCompare(a.date));
    expect(restored.map(t => t.id)).toEqual(['d', 'c', 'b', 'a']);
  });
});

// ─── detectAndMarkTransferPairs ───────────────────────────────────────────────
describe('detectAndMarkTransferPairs()', () => {
  it('marks both sides of a matching pair as Transfer', () => {
    const txs = [
      { id: '1', date: '2025-01-01', amount: -500,  account: 'checking', category: 'Food & Dining' },
      { id: '2', date: '2025-01-02', amount:  500,  account: 'credit',   category: 'Other' },
    ];
    const result = detectAndMarkTransferPairs(txs);
    expect(result[0].category).toBe('Transfer');
    expect(result[1].category).toBe('Transfer');
    expect(result[0]._transferPair).toBe(true);
    expect(result[1]._transferPair).toBe(true);
  });

  it('does not match when amounts differ by more than $0.01', () => {
    const txs = [
      { id: '1', date: '2025-01-01', amount: -500,    account: 'checking', category: 'Other' },
      { id: '2', date: '2025-01-01', amount:  499.98, account: 'credit',   category: 'Other' },
    ];
    const result = detectAndMarkTransferPairs(txs);
    expect(result[0].category).toBe('Other');
    expect(result[1].category).toBe('Other');
  });

  it('does not override an already-Transfer side', () => {
    const txs = [
      { id: '1', date: '2025-01-01', amount: -200, account: 'checking', category: 'Transfer' },
      { id: '2', date: '2025-01-01', amount:  200, account: 'credit',   category: 'Shopping' },
    ];
    const result = detectAndMarkTransferPairs(txs);
    // tx '1' already Transfer → skipped in outer loop; tx '2' never paired
    expect(result[1].category).toBe('Shopping');
  });

  it('does not match transactions on the same account', () => {
    const txs = [
      { id: '1', date: '2025-06-01', amount: -100, account: 'checking', category: 'Other' },
      { id: '2', date: '2025-06-01', amount:  100, account: 'checking', category: 'Other' },
    ];
    const result = detectAndMarkTransferPairs(txs);
    expect(result[0].category).toBe('Other');
    expect(result[1].category).toBe('Other');
  });

  it('does not match when dates are more than 3 days apart', () => {
    const txs = [
      { id: '1', date: '2025-01-01', amount: -300, account: 'checking', category: 'Other' },
      { id: '2', date: '2025-01-05', amount:  300, account: 'credit',   category: 'Other' },
    ];
    const result = detectAndMarkTransferPairs(txs);
    expect(result[0].category).toBe('Other');
    expect(result[1].category).toBe('Other');
  });

  it('does not mutate the input array', () => {
    const txs = [
      { id: '1', date: '2025-01-01', amount: -100, account: 'a', category: 'Other' },
      { id: '2', date: '2025-01-01', amount:  100, account: 'b', category: 'Other' },
    ];
    detectAndMarkTransferPairs(txs);
    expect(txs[0].category).toBe('Other');
    expect(txs[1].category).toBe('Other');
  });
});

// ─── DEFAULT_COMPENSATION_PROFILE ─────────────────────────────────────────────
describe('DEFAULT_COMPENSATION_PROFILE', () => {
  it('has all required keys with numeric/string defaults', () => {
    expect(DEFAULT_COMPENSATION_PROFILE).toMatchObject({
      grossMonthlySalary: 0,
      retirement401kPct: 0,
      hsaMonthly: 0,
      effectiveTaxRate: 0,
      notes: '',
    });
  });

  it('is a plain object (not frozen, can be spread)', () => {
    const copy = { ...DEFAULT_COMPENSATION_PROFILE, grossMonthlySalary: 5000 };
    expect(copy.grossMonthlySalary).toBe(5000);
    expect(DEFAULT_COMPENSATION_PROFILE.grossMonthlySalary).toBe(0);
  });
});

// ─── suggestBudgetsFromActuals ────────────────────────────────────────────────
describe('suggestBudgetsFromActuals()', () => {
  const txs = [
    { type: 'expense', date: '2025-01-05', category: 'Food & Dining',  amount: -300 },
    { type: 'expense', date: '2025-01-15', category: 'Transportation', amount: -120 },
    { type: 'expense', date: '2025-02-05', category: 'Food & Dining',  amount: -360 },
    { type: 'expense', date: '2025-02-20', category: 'Transportation', amount: -80  },
    { type: 'expense', date: '2025-03-05', category: 'Food & Dining',  amount: -240 },
    { type: 'income',  date: '2025-01-01', category: 'Income',         amount:  5000 },
  ];

  it('averages spending over reference months and rounds to nearest $5', () => {
    const result = suggestBudgetsFromActuals(txs, ['2025-01', '2025-02', '2025-03']);
    const food = result.find(r => r.category === 'Food & Dining');
    // (300 + 360 + 240) / 3 = 300 → rounds to 300
    expect(food.suggested).toBe(300);
    const transport = result.find(r => r.category === 'Transportation');
    // (120 + 80 + 0) / 3 = 66.67 → rounds to nearest 5 = 65
    expect(transport.suggested).toBe(65);
  });

  it('excludes income transactions', () => {
    const result = suggestBudgetsFromActuals(txs, ['2025-01']);
    expect(result.find(r => r.category === 'Income')).toBeUndefined();
  });

  it('returns results sorted by suggested amount descending', () => {
    const result = suggestBudgetsFromActuals(txs, ['2025-01', '2025-02', '2025-03']);
    const amounts = result.map(r => r.suggested);
    expect(amounts).toEqual([...amounts].sort((a, b) => b - a));
  });

  it('returns empty array when no matching transactions', () => {
    expect(suggestBudgetsFromActuals(txs, ['2020-01'])).toEqual([]);
  });

  it('returns empty array for empty transaction list', () => {
    expect(suggestBudgetsFromActuals([], ['2025-01'])).toEqual([]);
  });
});

// ─── parsePayStub ─────────────────────────────────────────────────────────────
const mockAdpText = `
  Regular 4,807.69 28,846.14
  Total Gross 4,807.69 28,846.14
  401(k) 288.46 1,730.76
  HSA 100.00 600.00
  Federal Income Tax 812.34 4,874.04
  State Income Tax 165.23 991.38
  Net Pay 3,200.00 19,200.00
`;

describe('parsePayStub()', () => {
  it('extracts all fields from mock ADP text', () => {
    const result = parsePayStub(mockAdpText);
    expect(result.grossPerPeriod).toBeCloseTo(4807.69);
    expect(result.retirement401k).toBeCloseTo(288.46);
    expect(result.hsa).toBeCloseTo(100.00);
    expect(result.federalTax).toBeCloseTo(812.34);
    expect(result.stateTax).toBeCloseTo(165.23);
    expect(result.netPay).toBeCloseTo(3200.00);
  });

  it('returns null for fields not present in text', () => {
    const result = parsePayStub('nothing relevant here');
    expect(result.grossPerPeriod).toBeNull();
    expect(result.retirement401k).toBeNull();
    expect(result.hsa).toBeNull();
    expect(result.federalTax).toBeNull();
    expect(result.stateTax).toBeNull();
    expect(result.netPay).toBeNull();
  });

  it('returns null for all fields on empty string', () => {
    const result = parsePayStub('');
    expect(Object.values(result).every(v => v === null)).toBe(true);
  });
});

// ─── toMonthly ────────────────────────────────────────────────────────────────
describe('toMonthly()', () => {
  it('biweekly: amount × 26 / 12', () => {
    expect(toMonthly(1000, 'biweekly')).toBeCloseTo(1000 * 26 / 12);
  });

  it('semimonthly: amount × 2', () => {
    expect(toMonthly(2000, 'semimonthly')).toBe(4000);
  });

  it('weekly: amount × 52 / 12', () => {
    expect(toMonthly(500, 'weekly')).toBeCloseTo(500 * 52 / 12);
  });

  it('monthly: unchanged', () => {
    expect(toMonthly(3000, 'monthly')).toBe(3000);
  });

  it('returns 0 for null/undefined amount', () => {
    expect(toMonthly(null, 'biweekly')).toBe(0);
    expect(toMonthly(undefined, 'monthly')).toBe(0);
  });
});

// ─── calcEffectiveTaxRate ─────────────────────────────────────────────────────
describe('calcEffectiveTaxRate()', () => {
  it('computes (federal + state) / gross × 100 rounded to 1 decimal', () => {
    // (812.34 + 165.23) / 4807.69 * 100 ≈ 20.3
    expect(calcEffectiveTaxRate(812.34, 165.23, 4807.69)).toBeCloseTo(20.3, 0);
  });

  it('handles null state tax (federal only)', () => {
    expect(calcEffectiveTaxRate(500, null, 2500)).toBeCloseTo(20.0, 1);
  });

  it('returns 0 when gross is 0', () => {
    expect(calcEffectiveTaxRate(500, 100, 0)).toBe(0);
  });

  it('returns 0 when gross is null', () => {
    expect(calcEffectiveTaxRate(500, 100, null)).toBe(0);
  });
});
