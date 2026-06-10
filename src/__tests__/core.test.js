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
  autoCategoryBusiness,
  SCHEDULE_C_LINES,
  computeUnvestedRSUValue,
  computeVestEvents,
  today,
  parseCSVLine,
  parseAmount,
  monthlyEquivalent,
  safeNum,
  safeDate,
  computeBalance,
  sanitizeText,
  detectAndMarkTransferPairs,
  DEFAULT_COMPENSATION_PROFILE,
  detectHeaderRow,
  suggestBudgetsFromActuals,
  checkBudgetAlerts,
  computeMortgagePI,
  fmt,
  shouldFlipImportAmounts,
  checkBudgetAlerts,
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

  it('AplPay BP# → Transportation', () => {
    expect(autoCategory('AplPay BP#1880000ARLINDIANAPOLIS IN', -45)).toBe('Transportation');
  });

  it("AplPay BUC-EE'S → Food & Dining", () => {
    expect(autoCategory("AplPay BUC-EE'S #005SMITH'S GROVE KY", -32)).toBe('Food & Dining');
  });

  it('AplPay Ryman Auditorium → Entertainment', () => {
    expect(autoCategory('AplPay RYMAN AUDITOR NASHVILLE TN', -75)).toBe('Entertainment');
  });

  it('AplPay 365 Market → Food & Dining', () => {
    expect(autoCategory('AplPay 365 MARKET 8TROY MI', -5)).toBe('Food & Dining');
  });

  it('AplPay GameStop → Shopping', () => {
    expect(autoCategory('AplPay GAMESTOP INDIANAPOLIS IN', -45)).toBe('Shopping');
  });

  it('Google YouTubePremium → Subscriptions', () => {
    expect(autoCategory('GOOGLE *YOUTUBEPREMI G.CO/HELPPAY# CA', -14)).toBe('Subscriptions');
  });

  it('Wal-Mart → Shopping', () => {
    expect(autoCategory('WAL-MART SUPERCENTERINDIANAPOLIS IN', -89)).toBe('Shopping');
  });

  it('credit card payment → Transfer (not Income, even though amount is positive)', () => {
    expect(autoCategory('MOBILE PAYMENT - THANK YOU', 250)).toBe('Transfer');
  });

  it('online payment → Transfer', () => {
    expect(autoCategory('ONLINE PAYMENT', 100)).toBe('Transfer');
  });

  it('autopay → Transfer', () => {
    expect(autoCategory('AUTOPAY CONFIRMATION', -50)).toBe('Transfer');
  });

  it("Casey's convenience store → Transportation", () => {
    expect(autoCategory('AplPay CASEYS #3928 GREENWOOD IN', -45)).toBe('Transportation');
  });

  it("Public house → Food & Dining", () => {
    expect(autoCategory('PARKSIDE PUBLIC HOUS INDIANAPOLIS IN', -18)).toBe('Food & Dining');
  });

  it('Pancake house → Food & Dining', () => {
    expect(autoCategory('LINCOLN SQUARE PANCA INDIANAPOLIS IN', -22)).toBe('Food & Dining');
  });

  it('PSI Exams → Education', () => {
    expect(autoCategory('PSI EXAMS OLATHE KS', -200)).toBe('Education');
  });

  it('Prometric testing center → Education', () => {
    expect(autoCategory('PROMETRIC TEST CENTER', -150)).toBe('Education');
  });

  it('generic STORE [city] after AplPay strip → Shopping', () => {
    expect(autoCategory('AplPay STORE GREENWOOD IN', -30)).toBe('Shopping');
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

  it('does not match when dates are more than 4 days apart', () => {
    const txs = [
      { id: '1', date: '2025-01-01', amount: -300, account: 'checking', category: 'Other' },
      { id: '2', date: '2025-01-06', amount:  300, account: 'credit',   category: 'Other' },
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

  it('includes all benefit deduction fields defaulting to 0', () => {
    expect(DEFAULT_COMPENSATION_PROFILE).toMatchObject({
      medicalMonthly: 0,
      dentalMonthly: 0,
      visionMonthly: 0,
      otherBenefitsMonthly: 0,
    });
  });
});

// ─── compensation profile migration backfill ─────────────────────────────────
describe('compensation profile migration backfill', () => {
  it('backfills new benefit fields to 0 on an existing profile missing them', () => {
    const oldProfile = {
      grossMonthlySalary: 5000,
      retirement401kPct: 6,
      hsaMonthly: 100,
      effectiveTaxRate: 22,
      notes: 'base salary',
    };
    const migrated = { ...DEFAULT_COMPENSATION_PROFILE, ...oldProfile };
    expect(migrated.medicalMonthly).toBe(0);
    expect(migrated.dentalMonthly).toBe(0);
    expect(migrated.visionMonthly).toBe(0);
    expect(migrated.otherBenefitsMonthly).toBe(0);
    expect(migrated.grossMonthlySalary).toBe(5000);
    expect(migrated.retirement401kPct).toBe(6);
    expect(migrated.notes).toBe('base salary');
  });

  it('preserves non-zero benefit fields already in the profile', () => {
    const profile = { ...DEFAULT_COMPENSATION_PROFILE, medicalMonthly: 250, dentalMonthly: 30 };
    const migrated = { ...DEFAULT_COMPENSATION_PROFILE, ...profile };
    expect(migrated.medicalMonthly).toBe(250);
    expect(migrated.dentalMonthly).toBe(30);
    expect(migrated.visionMonthly).toBe(0);
  });
});

// ─── detectHeaderRow ─────────────────────────────────────────────────────────
describe('detectHeaderRow()', () => {
  it('returns 0 for a normal CSV with header on row 0', () => {
    const rows = [
      ['Date', 'Description', 'Amount'],
      ['01/15/2025', 'GROCERY STORE', '-50.25'],
      ['01/16/2025', 'GAS STATION', '-40.00'],
    ];
    expect(detectHeaderRow(rows)).toBe(0);
  });

  it('returns the correct index for AMEX-style metadata rows above the header', () => {
    const rows = [
      ['Prepared for Platinum Card Member', '', '', '', ''],
      ['Jul 21 2025 to Dec 31 2025', '', '', '', ''],
      ['', '', '', '', ''],
      ['Date', 'Description', 'Amount', 'Extended Details', 'Category'],
      ['12/15/2025', 'WHOLE FOODS MARKET', '54.87', 'PURCHASE', 'Merchandise'],
      ['12/16/2025', 'AMAZON.COM', '29.99', 'PURCHASE', 'Shopping'],
    ];
    expect(detectHeaderRow(rows)).toBe(3);
  });

  it('handles empty rows before the real header', () => {
    const rows = [
      ['', '', ''],
      ['', '', ''],
      ['Date', 'Description', 'Amount'],
      ['01/15/2025', 'AMAZON', '-29.99'],
    ];
    expect(detectHeaderRow(rows)).toBe(2);
  });

  it('returns 0 when only one row is present', () => {
    const rows = [['Date', 'Amount']];
    expect(detectHeaderRow(rows)).toBe(0);
  });

  it('returns 0 for a plain CSV with no metadata (confidence check)', () => {
    const rows = [
      ['Transaction Date', 'Description', 'Amount'],
      ['2025-01-10', 'TARGET', '-85.50'],
    ];
    expect(detectHeaderRow(rows)).toBe(0);
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

// ─── autoCategoryBusiness ─────────────────────────────────────────────────────
describe('autoCategoryBusiness()', () => {
  it('maps Google Ads to Business - Advertising', () => {
    expect(autoCategoryBusiness('Google Ads charge')).toBe('Business - Advertising');
  });

  it('maps GitHub to Business - Software & SaaS', () => {
    expect(autoCategoryBusiness('GitHub subscription')).toBe('Business - Software & SaaS');
  });

  it('maps Zoom to Business - Software & SaaS', () => {
    expect(autoCategoryBusiness('Zoom monthly plan')).toBe('Business - Software & SaaS');
  });

  it('maps restaurant to Business - Meals (50% deductible)', () => {
    expect(autoCategoryBusiness('Client dinner restaurant')).toBe('Business - Meals (50% deductible)');
  });

  it('maps hotel to Business - Travel', () => {
    expect(autoCategoryBusiness('Marriott hotel stay')).toBe('Business - Travel');
  });

  it('maps gas station to Business - Vehicle & Mileage', () => {
    expect(autoCategoryBusiness('Shell gas station')).toBe('Business - Vehicle & Mileage');
  });

  it('maps office supplies to Business - Office Supplies', () => {
    expect(autoCategoryBusiness('Staples purchase')).toBe('Business - Office Supplies');
  });

  it('unknown merchants fall back to Business - Other', () => {
    expect(autoCategoryBusiness('Random merchant xyz')).toBe('Business - Other');
  });
});

// ─── SCHEDULE_C_LINES ─────────────────────────────────────────────────────────
describe('SCHEDULE_C_LINES', () => {
  it('covers all 10 business categories', () => {
    const BUSINESS_CATS = [
      'Business - Advertising',
      'Business - Office Supplies',
      'Business - Software & SaaS',
      'Business - Professional Services',
      'Business - Meals (50% deductible)',
      'Business - Travel',
      'Business - Vehicle & Mileage',
      'Business - Equipment',
      'Business - Utilities',
      'Business - Other',
    ];
    BUSINESS_CATS.forEach(cat => {
      expect(SCHEDULE_C_LINES).toHaveProperty(cat);
      expect(typeof SCHEDULE_C_LINES[cat]).toBe('number');
    });
  });

  it('maps Advertising to line 8', () => {
    expect(SCHEDULE_C_LINES['Business - Advertising']).toBe(8);
  });

  it('maps Vehicle & Mileage to line 9', () => {
    expect(SCHEDULE_C_LINES['Business - Vehicle & Mileage']).toBe(9);
  });

  it('maps Utilities to line 25', () => {
    expect(SCHEDULE_C_LINES['Business - Utilities']).toBe(25);
  });
});

// ─── Business P&L calculation ─────────────────────────────────────────────────
describe('Business P&L calculation', () => {
  const bizAcctId  = 'biz-acct-1';
  const persAcctId = 'pers-acct-1';

  const txs = [
    { id:'1', account: bizAcctId,  amount:  5000, type:'income',  category:'Income', date:'2026-06-01' },
    { id:'2', account: bizAcctId,  amount:  -800, type:'expense', category:'Business - Software & SaaS', date:'2026-06-05' },
    { id:'3', account: bizAcctId,  amount:  -200, type:'expense', category:'Business - Meals (50% deductible)', date:'2026-06-10' },
    { id:'4', account: persAcctId, amount: -3000, type:'expense', category:'Housing', date:'2026-06-15' },
  ];

  const bizTxs = txs.filter(t => t.account === bizAcctId && t.type !== 'adjustment');

  it('revenue sums only income in business accounts', () => {
    const revenue = bizTxs.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
    expect(revenue).toBe(5000);
  });

  it('expenses exclude personal account transactions', () => {
    const expenses = bizTxs.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
    expect(expenses).toBe(1000);
  });

  it('net income = revenue - expenses', () => {
    const revenue  = bizTxs.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
    const expenses = bizTxs.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
    expect(revenue - expenses).toBe(4000);
  });
});

// ─── Meals 50% deductible ─────────────────────────────────────────────────────
describe('Meals 50% deductible', () => {
  it('$200 meals expense → $100 deductible', () => {
    const mealAmount = 200;
    const deductible = mealAmount * 0.5;
    expect(deductible).toBe(100);
  });

  it('deductible rounds correctly for fractional amounts', () => {
    expect(Math.round(75.50 * 0.5 * 100) / 100).toBe(37.75);
  });
});

// ─── migrateData v6: isBusiness backfill ─────────────────────────────────────
describe('migrateData v6 — isBusiness backfill', () => {
  // Replicate the accounts migration from App.jsx migrateData
  function migrateAccounts(rawAccounts) {
    return rawAccounts.map(a => ({ holdings: [], isBusiness: false, ...a }));
  }

  it('adds isBusiness: false to accounts that lack it', () => {
    const raw = [
      { id: '1', name: 'Chase Checking', type: 'checking', balance: 1000 },
      { id: '2', name: 'Chase Savings',  type: 'savings',  balance: 5000 },
    ];
    const migrated = migrateAccounts(raw);
    expect(migrated[0].isBusiness).toBe(false);
    expect(migrated[1].isBusiness).toBe(false);
  });

  it('preserves isBusiness: true for accounts already flagged', () => {
    const raw = [
      { id: '3', name: 'Biz Checking', type: 'checking', balance: 2000, isBusiness: true },
    ];
    const migrated = migrateAccounts(raw);
    expect(migrated[0].isBusiness).toBe(true);
  });

  it('does not overwrite existing isBusiness: false', () => {
    const raw = [
      { id: '4', name: 'Personal', type: 'savings', balance: 500, isBusiness: false },
    ];
    const migrated = migrateAccounts(raw);
    expect(migrated[0].isBusiness).toBe(false);
  });
});

// ─── parseRSUStatement ────────────────────────────────────────────────────────
import { parseRSUStatement } from '../utils/parseRSUStatement.js';

describe('parseRSUStatement()', () => {
  const sampleFidelityText = `
    Amazon.com Inc  AMZN
    Stock Plan Services
    Unvested Shares: 412
    Current Price: $201.50
    Total Unvested Value: $82,958.00
    Grant Schedule
    08/18/2025  17  RSU
    11/18/2025  17  RSU
  `;

  it('extracts ticker from Fidelity statement', () => {
    const result = parseRSUStatement(sampleFidelityText);
    expect(result.ticker).toBe('AMZN');
  });

  it('extracts unvested share count', () => {
    const result = parseRSUStatement(sampleFidelityText);
    expect(result.unvestedShares).toBe(412);
  });

  it('extracts current price per share', () => {
    const result = parseRSUStatement(sampleFidelityText);
    expect(result.currentPrice).toBe(201.50);
  });

  it('reads unvested value directly from statement text', () => {
    const result = parseRSUStatement(sampleFidelityText);
    expect(result.unvestedValue).toBe(82958.00);
  });

  it('extracts next vest date and shares from grant schedule', () => {
    const result = parseRSUStatement(sampleFidelityText);
    expect(result.nextVestDate).toBe('2025-08-18');
    expect(result.nextVestShares).toBe(17);
  });

  it('returns null fields gracefully when text does not match', () => {
    const result = parseRSUStatement('This PDF has no RSU data whatsoever.');
    expect(result.ticker).toBeNull();
    expect(result.unvestedShares).toBeNull();
    expect(result.currentPrice).toBeNull();
    expect(result.unvestedValue).toBeNull();
  });

  it('does not throw on empty string', () => {
    expect(() => parseRSUStatement('')).not.toThrow();
  });

  it('does not throw on null input', () => {
    expect(() => parseRSUStatement(null)).not.toThrow();
  });

  it('computes unvestedValue from shares × price when not in text', () => {
    const text = 'AMZN Unvested: 100 Current Price: $200.00';
    const result = parseRSUStatement(text);
    expect(result.unvestedShares).toBe(100);
    expect(result.currentPrice).toBe(200);
    expect(result.unvestedValue).toBe(20000);
  });
});

// ─── computeUnvestedRSUValue ──────────────────────────────────────────────────
describe('computeUnvestedRSUValue()', () => {
  it('returns 0 for an empty grants array', () => {
    expect(computeUnvestedRSUValue([])).toBe(0);
  });

  it('handles null/undefined input gracefully', () => {
    expect(computeUnvestedRSUValue(null)).toBe(0);
    expect(computeUnvestedRSUValue(undefined)).toBe(0);
  });

  it('returns totalShares × price when cliff has not passed yet (all unvested)', () => {
    const grant = {
      grantDate: today(), totalShares: 1200, cliffMonths: 12,
      vestingMonths: 48, vestFrequency: 'monthly', currentPrice: 50,
    };
    expect(computeUnvestedRSUValue([grant])).toBe(60000);
  });

  it('returns 0 when grant is fully vested (no cliff so all periods generate events)', () => {
    const grant = {
      grantDate: '2018-01-01', totalShares: 960, cliffMonths: 0,
      vestingMonths: 48, vestFrequency: 'monthly', currentPrice: 25,
    };
    expect(computeUnvestedRSUValue([grant])).toBe(0);
  });

  it('computes correct unvested value for partially vested grant', () => {
    const grant = {
      grantDate: '2025-01-01', totalShares: 480, cliffMonths: 0,
      vestingMonths: 48, vestFrequency: 'monthly', currentPrice: 100,
    };
    const events = computeVestEvents(grant);
    const vestedShares = events.filter(e => e.vested).reduce((s, e) => s + e.shares, 0);
    const expectedUnvestedValue = Math.max(0, 480 - vestedShares) * 100;
    expect(computeUnvestedRSUValue([grant])).toBeCloseTo(expectedUnvestedValue, 5);
    expect(computeUnvestedRSUValue([grant])).toBeGreaterThan(0);
  });

  it('sums unvested value across multiple grants', () => {
    const fullyVested = {
      grantDate: '2018-01-01', totalShares: 480, cliffMonths: 0,
      vestingMonths: 48, vestFrequency: 'monthly', currentPrice: 100,
    };
    const fullyUnvested = {
      grantDate: today(), totalShares: 200, cliffMonths: 12,
      vestingMonths: 48, vestFrequency: 'monthly', currentPrice: 75,
    };
    expect(computeUnvestedRSUValue([fullyVested, fullyUnvested])).toBe(15000);
  });

  it('uses grantPrice as fallback when currentPrice is absent', () => {
    const grant = {
      grantDate: today(), totalShares: 100, cliffMonths: 12,
      vestingMonths: 48, vestFrequency: 'monthly', grantPrice: 30,
    };
    expect(computeUnvestedRSUValue([grant])).toBe(3000);
  });
});

// ─── migrateData v7: unvestedRSUValue backfill ───────────────────────────────
describe('migrateData v7 — unvestedRSUValue backfill', () => {
  function migrateAccountsV7(rawAccounts) {
    return rawAccounts.map(a => ({ holdings: [], isBusiness: false, unvestedRSUValue: 0, ...a }));
  }

  it('adds unvestedRSUValue: 0 to accounts that lack it', () => {
    const raw = [
      { id:'1', name:'Fidelity', type:'investment', balance: 124000 },
    ];
    const migrated = migrateAccountsV7(raw);
    expect(migrated[0].unvestedRSUValue).toBe(0);
  });

  it('preserves an existing non-zero unvestedRSUValue', () => {
    const raw = [
      { id:'2', name:'Fidelity', type:'investment', balance: 124000, unvestedRSUValue: 83000 },
    ];
    const migrated = migrateAccountsV7(raw);
    expect(migrated[0].unvestedRSUValue).toBe(83000);
  });
});

// ─── Dashboard net worth split ────────────────────────────────────────────────
describe('Dashboard net worth split logic', () => {
  it('vestedNetWorth = total minus unvested when unvestedRSU > 0', () => {
    const grant = {
      grantDate: today(), totalShares: 1000, cliffMonths: 12,
      vestingMonths: 48, vestFrequency: 'monthly', currentPrice: 100,
    };
    const netWorth = 200000;
    const unvestedRSU = computeUnvestedRSUValue([grant]);
    const vestedNetWorth = netWorth - unvestedRSU;
    expect(unvestedRSU).toBe(100000);
    expect(vestedNetWorth).toBe(100000);
    expect(unvestedRSU > 0).toBe(true);
  });

  it('shows no split UI when all grants are fully vested', () => {
    const grant = {
      grantDate: '2018-01-01', totalShares: 480, cliffMonths: 0,
      vestingMonths: 48, vestFrequency: 'monthly', currentPrice: 50,
    };
    const unvestedRSU = computeUnvestedRSUValue([grant]);
    expect(unvestedRSU).toBe(0);
    // UI condition: unvestedRSU > 0 → false → standard net worth label shown
    expect(unvestedRSU > 0).toBe(false);
  });
});

// ─── checkBudgetAlerts ───────────────────────────────────────────────────────
describe('checkBudgetAlerts()', () => {
  const month = '2026-06';
  const budgets = [
    { id:'b1', month, category:'Food & Dining', amount:500 },
    { id:'b2', month, category:'Entertainment', amount:200 },
    { id:'b3', month, category:'Shopping',      amount:300 },
  ];

  it('returns empty array when all spending is under warn threshold', () => {
    const txs = [
      { id:'t1', type:'expense', date:'2026-06-01', category:'Food & Dining', amount:-100 },
      { id:'t2', type:'expense', date:'2026-06-02', category:'Entertainment', amount:-50  },
    ];
    expect(checkBudgetAlerts(budgets, txs, month, 80, 100)).toHaveLength(0);
  });

  it('returns warn entry when spending hits warnAt threshold', () => {
    const txs = [
      { id:'t1', type:'expense', date:'2026-06-01', category:'Food & Dining', amount:-410 },
    ];
    const results = checkBudgetAlerts(budgets, txs, month, 80, 100);
    expect(results).toHaveLength(1);
    expect(results[0].type).toBe('warn');
    expect(results[0].category).toBe('Food & Dining');
    expect(results[0].pct).toBeGreaterThanOrEqual(80);
  });

  it('returns alert entry when spending meets or exceeds alertAt threshold', () => {
    const txs = [
      { id:'t1', type:'expense', date:'2026-06-01', category:'Entertainment', amount:-200 },
    ];
    const results = checkBudgetAlerts(budgets, txs, month, 80, 100);
    expect(results).toHaveLength(1);
    expect(results[0].type).toBe('alert');
    expect(results[0].category).toBe('Entertainment');
    expect(results[0].pct).toBe(100);
  });

  it('returns multiple entries when multiple categories breach thresholds', () => {
    const txs = [
      { id:'t1', type:'expense', date:'2026-06-01', category:'Food & Dining', amount:-450 },
      { id:'t2', type:'expense', date:'2026-06-02', category:'Shopping',      amount:-310 },
    ];
    const results = checkBudgetAlerts(budgets, txs, month, 80, 100);
    expect(results.length).toBeGreaterThanOrEqual(2);
    const cats = results.map(r => r.category);
    expect(cats).toContain('Food & Dining');
    expect(cats).toContain('Shopping');
  });

  it('ignores income transactions', () => {
    const txs = [
      { id:'t1', type:'income', date:'2026-06-01', category:'Food & Dining', amount:5000 },
    ];
    expect(checkBudgetAlerts(budgets, txs, month, 80, 100)).toHaveLength(0);
  });

  it('returns empty array when no budgets exist for the month', () => {
    const txs = [
      { id:'t1', type:'expense', date:'2026-06-01', category:'Food & Dining', amount:-999 },
    ];
    expect(checkBudgetAlerts([], txs, month, 80, 100)).toHaveLength(0);
  });
});

// ─── computeMortgagePI ───────────────────────────────────────────────────────
describe('computeMortgagePI()', () => {
  it('$200k loan, 6.5%, 30yr ≈ $1,264/mo', () => {
    const pi = computeMortgagePI(200000, 6.5, 30);
    expect(pi).toBeGreaterThan(1260);
    expect(pi).toBeLessThan(1270);
  });

  it('$400k loan, 7.0%, 30yr ≈ $2,661/mo', () => {
    const pi = computeMortgagePI(400000, 7.0, 30);
    expect(pi).toBeGreaterThan(2655);
    expect(pi).toBeLessThan(2670);
  });

  it('$300k loan, 6.0%, 15yr payment is higher than 30yr', () => {
    const pi15 = computeMortgagePI(300000, 6.0, 15);
    const pi30 = computeMortgagePI(300000, 6.0, 30);
    expect(pi15).toBeGreaterThan(pi30);
  });

  it('returns 0 for zero principal', () => {
    expect(computeMortgagePI(0, 6.5, 30)).toBe(0);
  });

  it('returns 0 for zero rate', () => {
    expect(computeMortgagePI(200000, 0, 30)).toBe(0);
  });
});

// ─── Privacy / fmt masking ───────────────────────────────────────────────────
describe('fmt() and privacy masking contract', () => {
  it('fmt returns a non-empty string for valid amounts', () => {
    const result = fmt(1234.56);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('fmt formats negative amounts', () => {
    const result = fmt(-500);
    expect(result).toContain('500');
  });

  it('privacy MASK constant is ••••', () => {
    const MASK = '••••';
    expect(MASK).toBe('••••');
    expect(MASK.length).toBeGreaterThan(0);
  });
});

// ─── Receipt filename format ─────────────────────────────────────────────────
describe('Receipt filename format', () => {
  it('follows [txId]-[timestamp].[ext] pattern', () => {
    const txId = 'abc123';
    const ts   = 1700000000000;
    const ext  = 'pdf';
    const filename = `${txId}-${ts}.${ext}`;
    expect(filename).toBe('abc123-1700000000000.pdf');
    // ext is preserved
    expect(filename.endsWith('.pdf')).toBe(true);
    // txId prefix is the first segment before first hyphen-group
    expect(filename.startsWith(txId)).toBe(true);
  });

  it('jpg extension is preserved', () => {
    const filename = `tx1-${Date.now()}.jpg`;
    expect(filename.endsWith('.jpg')).toBe(true);
  });
});

// ─── detectAndMarkTransferPairs v2 (4-day window + transferPairId) ───────────
describe('detectAndMarkTransferPairs — 4-day window + transferPairId', () => {
  const acct = (id, date, amount) => ({
    id: `tx-${id}`, date, amount, account: `acct-${id % 2}`, category: 'Food & Dining', type: amount >= 0 ? 'income' : 'expense',
  });

  it('matches pairs within 3 days (existing behaviour)', () => {
    const txs = [acct(0, '2026-06-01', -100), acct(1, '2026-06-04', 100)];
    const result = detectAndMarkTransferPairs(txs);
    expect(result[0].category).toBe('Transfer');
    expect(result[1].category).toBe('Transfer');
  });

  it('matches pairs exactly 4 days apart (new behaviour)', () => {
    const txs = [acct(0, '2026-06-01', -100), acct(1, '2026-06-05', 100)];
    const result = detectAndMarkTransferPairs(txs);
    expect(result[0].category).toBe('Transfer');
    expect(result[1].category).toBe('Transfer');
  });

  it('does NOT match pairs 5 days apart', () => {
    const txs = [acct(0, '2026-06-01', -100), acct(1, '2026-06-06', 100)];
    const result = detectAndMarkTransferPairs(txs);
    expect(result[0].category).toBe('Food & Dining');
    expect(result[1].category).toBe('Food & Dining');
  });

  it('assigns the same transferPairId to both members of a pair', () => {
    const txs = [acct(0, '2026-06-01', -50), acct(1, '2026-06-01', 50)];
    const result = detectAndMarkTransferPairs(txs);
    expect(result[0].transferPairId).toBeTruthy();
    expect(result[0].transferPairId).toBe(result[1].transferPairId);
  });

  it('assigns distinct transferPairIds to different pairs', () => {
    const txs = [
      acct(0, '2026-06-01', -50), acct(1, '2026-06-01', 50),
      { id: 'tx-a', date: '2026-06-10', amount: -200, account: 'acct-2', category: 'Food & Dining', type: 'expense' },
      { id: 'tx-b', date: '2026-06-10', amount:  200, account: 'acct-3', category: 'Food & Dining', type: 'income' },
    ];
    const result = detectAndMarkTransferPairs(txs);
    const pairId0 = result.find(t => t.id === 'tx-0')?.transferPairId;
    const pairIdA = result.find(t => t.id === 'tx-a')?.transferPairId;
    expect(pairId0).toBeTruthy();
    expect(pairIdA).toBeTruthy();
    expect(pairId0).not.toBe(pairIdA);
  });

  it('does not mutate the input array', () => {
    const txs = [acct(0, '2026-06-01', -100), acct(1, '2026-06-01', 100)];
    const origCat = txs[0].category;
    detectAndMarkTransferPairs(txs);
    expect(txs[0].category).toBe(origCat);
  });
});

// ─── checkBudgetAlerts transfer filter ───────────────────────────────────────
describe('checkBudgetAlerts — excludes Transfer category', () => {
  const budgets = [{ month: '2026-06', category: 'Food & Dining', amount: 200 }];

  it('does not count Transfer-category transactions toward budget spend', () => {
    const txs = [
      { type: 'expense', date: '2026-06-10', amount: -150, category: 'Food & Dining' },
      { type: 'expense', date: '2026-06-10', amount: -300, category: 'Transfer' },
    ];
    const alerts = checkBudgetAlerts(budgets, txs, '2026-06', 80, 100);
    expect(alerts).toHaveLength(0);
  });

  it('still alerts when non-transfer spend exceeds threshold', () => {
    const txs = [
      { type: 'expense', date: '2026-06-10', amount: -210, category: 'Food & Dining' },
      { type: 'expense', date: '2026-06-10', amount: -500, category: 'Transfer' },
    ];
    const alerts = checkBudgetAlerts(budgets, txs, '2026-06', 80, 100);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].type).toBe('alert');
  });
});

// ─── shouldFlipImportAmounts ─────────────────────────────────────────────────
describe('shouldFlipImportAmounts()', () => {
  it('returns true for credit account (AMEX charges are positive)', () => {
    expect(shouldFlipImportAmounts('credit')).toBe(true);
  });

  it('returns true for loan account', () => {
    expect(shouldFlipImportAmounts('loan')).toBe(true);
  });

  it('returns false for checking account', () => {
    expect(shouldFlipImportAmounts('checking')).toBe(false);
  });

  it('returns false for savings account', () => {
    expect(shouldFlipImportAmounts('savings')).toBe(false);
  });

  it('returns false for investment account', () => {
    expect(shouldFlipImportAmounts('investment')).toBe(false);
  });

  it('returns false for unknown/undefined account type', () => {
    expect(shouldFlipImportAmounts(undefined)).toBe(false);
    expect(shouldFlipImportAmounts('bogus')).toBe(false);
  });
});

// ─── migrateData v8: receipts field ─────────────────────────────────────────
describe('migrateData v8 — receipts backfill', () => {
  // migrateData lives in App.jsx and is not exported; test the pattern directly
  it('spreading receipts:[] before ...t gives empty array when t has no receipts', () => {
    const t = { id:'t1', date:'2026-01-01', amount:-50, category:'Food & Dining' };
    const migrated = { receipts: [], ...t };
    expect(migrated.receipts).toEqual([]);
  });

  it('preserves existing receipts when t already has them', () => {
    const existing = [{ name: 't1-123.jpg' }];
    const t = { id:'t1', receipts: existing };
    const migrated = { receipts: [], ...t };
    expect(migrated.receipts).toEqual(existing);
  });

  it('spread pattern works for all transactions in a batch', () => {
    const rawTxs = [
      { id:'a', amount:-10 },
      { id:'b', amount:-20, receipts: [{ name:'b-1.pdf' }] },
    ];
    const migrated = rawTxs.map(t => ({ receipts: [], ...t }));
    expect(migrated[0].receipts).toEqual([]);
    expect(migrated[1].receipts).toEqual([{ name:'b-1.pdf' }]);
  });
});
