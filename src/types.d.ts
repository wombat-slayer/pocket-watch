/**
 * Pocket Watch — Core Data Model Type Declarations
 *
 * This file provides TypeScript/JSDoc types for the core data model.
 * It does NOT require a full TS migration — import these types as
 * JSDoc annotations in JS files:  @param {Transaction} tx
 */

// ─── Primitives ───────────────────────────────────────────────────────────────

/** ISO date string, e.g. "2025-06-15" */
export type DateString = string;

/** UUID string produced by crypto.randomUUID() */
export type UID = string;

/** Currency amount in USD. Positive = income, Negative = expense. */
export type Dollars = number;

// ─── Transaction ──────────────────────────────────────────────────────────────

export type TransactionType = 'income' | 'expense' | 'adjustment';

export interface SplitItem {
  category: string;
  amount: Dollars;
  notes?: string;
}

export interface Transaction {
  id: UID;
  date: DateString;
  description: string;
  amount: Dollars;
  type: TransactionType;
  category: string;
  account: UID;
  /** Tax-deductible and other custom tags */
  tags: string[];
  cleared: boolean;
  notes?: string;
  /** Present when this transaction was auto-generated from a recurrence */
  recurringId?: UID;
  /** Present for one leg of a transfer pair */
  transferId?: UID;
  transferDirection?: 'from' | 'to';
  /** Present when the transaction is split across categories */
  splits?: SplitItem[];
}

// ─── Account ──────────────────────────────────────────────────────────────────

export type AccountType =
  | 'checking'
  | 'savings'
  | 'credit'
  | 'investment'
  | 'brokerage'
  | 'asset'
  | 'loan'
  | 'cash'
  | 'other';

export interface HoldingItem {
  ticker: string;
  shares: number;
  costBasis: number;
  acquiredDate?: DateString;
}

export interface Account {
  id: UID;
  name: string;
  type: AccountType;
  /** Manual balance (used for investment/asset accounts) */
  balance: Dollars;
  /** Transactions are used to compute balance for cash-flow accounts */
  computedBalance?: Dollars | null;
  color?: string;
  notes?: string;
  /** Investment account holdings ledger */
  holdings: HoldingItem[];
  statementDate?: DateString;
}

// ─── Budget ───────────────────────────────────────────────────────────────────

export interface Budget {
  id: UID;
  category: string;
  amount: Dollars;
  /** YYYY-MM — if set, budget applies only to this month */
  month?: string;
  rollover: boolean;
  /** Accumulated rollover from previous months */
  rolledOver?: Dollars;
}

// ─── Goal ─────────────────────────────────────────────────────────────────────

export interface Goal {
  id: UID;
  name: string;
  target: Dollars;
  current: Dollars;
  deadline?: DateString;
  color?: string;
  linkedAccountId?: UID | null;
}

// ─── Recurring Rule ───────────────────────────────────────────────────────────

export type RecurFrequency = 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly';

export interface RecurringRule {
  id: UID;
  description: string;
  amount: Dollars;
  type: 'income' | 'expense';
  category: string;
  account: UID;
  frequency: RecurFrequency;
  startDate: DateString;
  active: boolean;
  lastGenerated: DateString | null;
  notes?: string;
}

// ─── Equity Grant ─────────────────────────────────────────────────────────────

export type GrantType = 'rsu' | 'option' | 'espp';

export interface VestEvent {
  date: DateString;
  shares: number;
  vested: boolean;
}

export interface Grant {
  id: UID;
  name: string;
  ticker?: string;
  type: GrantType;
  totalShares: number;
  vestedShares: number;
  grantDate: DateString;
  grantPrice: Dollars;
  currentPrice?: Dollars;
  vestSchedule: VestEvent[];
  notes?: string;
}

// ─── Net Worth Snapshot ───────────────────────────────────────────────────────

export interface NetWorthSnapshot {
  id: UID;
  date: DateString;
  /** Computed as assets minus debts */
  netWorth: Dollars;
  assets?: Dollars;
  debts?: Dollars;
}

// ─── Budget Template ─────────────────────────────────────────────────────────

export interface BudgetTemplate {
  id: UID;
  name: string;
  budgets: Pick<Budget, 'category' | 'amount'>[];
  autoApply: boolean;
}

// ─── App Data (persisted JSON) ────────────────────────────────────────────────

export interface AppData {
  version: number;
  transactions: Transaction[];
  accounts: Account[];
  budgets: Budget[];
  goals: Goal[];
  recurrences: RecurringRule[];
  grants: Grant[];
  userCategories: Array<{ name: string; icon: string; color: string }>;
  netWorthHistory: NetWorthSnapshot[];
  budgetTemplates: BudgetTemplate[];
  archivedTransactions: Transaction[];
  apiKeys: { finnhub: string };
  onboardingComplete: boolean;
}
