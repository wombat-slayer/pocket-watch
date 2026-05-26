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
} from '../constants.js';

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
