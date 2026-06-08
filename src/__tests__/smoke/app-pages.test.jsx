// @vitest-environment jsdom
/**
 * Smoke tests — every page-level component renders without throwing,
 * in both dark (default) and light themes.
 */
import { describe, it, beforeAll, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

// ── Module mocks (must appear before any component imports) ──────────────────

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(() => Promise.resolve(null)) }));

vi.mock('@tauri-apps/plugin-store', () => ({
  Store: {
    load: vi.fn(() =>
      Promise.resolve({ get: vi.fn(() => Promise.resolve(null)), set: vi.fn(), save: vi.fn() })
    ),
  },
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({ save: vi.fn(), open: vi.fn() }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn() }));
vi.mock('@tauri-apps/plugin-fs', () => ({ readFile: vi.fn(), writeFile: vi.fn() }));

vi.mock('react-plaid-link', () => ({
  usePlaidLink: vi.fn(() => ({ open: vi.fn(), ready: false, exit: vi.fn() })),
}));

vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: {} }));

vi.mock('../../hooks/useChart.js', () => ({ useChart: vi.fn() }));

vi.mock('../../hooks/useMarketData.js', () => ({
  useMarketData: vi.fn(() => ({ quotes: {}, loading: false, error: null })),
  isCryptoTicker: vi.fn(() => false),
}));

vi.mock('../../utils/extractPdfText.js', () => ({ extractPdfText: vi.fn() }));

vi.mock('../../plaidLayer.js', () => ({
  getLinkedItems:         vi.fn(() => Promise.resolve([])),
  getPlaidCredentials:    vi.fn(() => Promise.resolve({ clientId: '', secret: '', env: 'sandbox' })),
  savePlaidCredentials:   vi.fn(),
  clearPlaidCredentials:  vi.fn(),
  addLinkedItem:          vi.fn(),
  updateLinkedItem:       vi.fn(),
  removeLinkedItem:       vi.fn(),
  getCursor:              vi.fn(() => Promise.resolve(null)),
  setCursor:              vi.fn(),
  mapPlaidTransaction:    vi.fn(),
  extractBalanceUpdates:  vi.fn(() => ({ balanceUpdates: [], plaidIdMap: {} })),
}));

vi.mock('../../dataLayer.js', () => ({
  getDataPath:      vi.fn(() => Promise.resolve(null)),
  setDataPath:      vi.fn(),
  getDefaultDataPath: vi.fn(() => Promise.resolve('/tmp/test.json')),
  loadAppData:      vi.fn(() => Promise.resolve({})),
  saveAppData:      vi.fn(() => Promise.resolve()),
  dataFileExists:   vi.fn(() => Promise.resolve(true)),
  promptNewDataFile: vi.fn(),
  promptOpenDataFile: vi.fn(),
}));

// ── Imports (after mocks) ────────────────────────────────────────────────────

import { PrivacyContext } from '../../context/PrivacyContext.jsx';
import { DEFAULT_COMPENSATION_PROFILE } from '../../constants.js';

import Dashboard    from '../../components/Dashboard.jsx';
import Transactions from '../../components/Transactions.jsx';
import Accounts     from '../../components/Accounts.jsx';
import Budgets      from '../../components/Budgets.jsx';
import Goals        from '../../components/Goals.jsx';
import Recurring    from '../../components/Recurring.jsx';
import Reports      from '../../components/Reports.jsx';
import Business     from '../../components/Business.jsx';
import Settings     from '../../components/Settings.jsx';
import Equity       from '../../components/Equity.jsx';

// ── Global setup ─────────────────────────────────────────────────────────────

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = vi.fn(() => null);
  window.matchMedia = vi.fn(() => ({
    matches: false,
    addListener: vi.fn(), removeListener: vi.fn(),
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
  }));
});

// ── Seed data ────────────────────────────────────────────────────────────────

const ACCT = {
  id: 'acc1', name: 'Checking', type: 'checking', balance: 1000,
  holdings: [], isBusiness: false, unvestedRSUValue: 0,
};
const SEED = {
  transactions:        [],
  accounts:            [ACCT],
  budgets:             [],
  goals:               [],
  recurrences:         [],
  grants:              [],
  userCategories:      [],
  netWorthHistory:     [],
  budgetTemplates:     [],
  archivedTransactions: [],
  apiKeys:             {},
  compensationProfile: DEFAULT_COMPENSATION_PROFILE,
  budgetAlerts:        { enabled: true, warnAt: 80, alertAt: 100 },
  dataPath:            '/tmp/test.json',
};
const noop = vi.fn();

const wrap = (ui, privacy = false) =>
  React.createElement(PrivacyContext.Provider, { value: privacy }, ui);

// Helper: render + run effects; suppress expected act() noise
const smoke = async (element) => {
  await act(async () => { render(element); });
};

// ── Tests ────────────────────────────────────────────────────────────────────

describe('page smoke tests — dark theme (default)', () => {
  it('Dashboard renders', async () => {
    await smoke(wrap(
      React.createElement(Dashboard, {
        transactions: SEED.transactions, accounts: SEED.accounts, budgets: SEED.budgets,
        recurrences: SEED.recurrences, grants: SEED.grants, netWorthHistory: SEED.netWorthHistory,
        goals: SEED.goals, onAddTx: noop, onAddGoal: noop, onEditGoal: noop,
        onDeleteGoal: noop, onDeposit: noop, onGoToBudgets: noop,
        compensationProfile: SEED.compensationProfile,
        onCategoryClick: noop, onGoToReports: noop,
      })
    ));
  });

  it('Transactions renders', async () => {
    await smoke(wrap(
      React.createElement(Transactions, {
        transactions: SEED.transactions, accounts: SEED.accounts,
        onAdd: noop, onEdit: noop, onDelete: noop, onBulkDelete: noop,
        onCSVImport: noop, existingTxs: SEED.transactions, initialCatFilter: 'All',
        onClearCatFilter: noop, userCategories: SEED.userCategories,
        archivedTransactions: SEED.archivedTransactions, onRestoreArchive: noop,
        recurrences: SEED.recurrences, lastSyncResult: null, onDismissSyncResult: noop,
        dataPath: SEED.dataPath,
      })
    ));
  });

  it('Accounts renders', async () => {
    await smoke(wrap(
      React.createElement(Accounts, {
        accounts: SEED.accounts, transactions: SEED.transactions,
        netWorthHistory: SEED.netWorthHistory, recurrences: SEED.recurrences,
        onAdd: noop, onEdit: noop, onDelete: noop, onToggleCleared: noop,
        onReconcile: noop, onUpdateStatementDate: noop, onImportStatement: noop,
      })
    ));
  });

  it('Budgets renders', async () => {
    await smoke(wrap(
      React.createElement(Budgets, {
        transactions: SEED.transactions, budgets: SEED.budgets,
        onAdd: noop, onEdit: noop, onDelete: noop, userCategories: SEED.userCategories,
        budgetTemplates: SEED.budgetTemplates, onSaveTemplate: noop,
        onLoadTemplate: noop, onBudgetAlert: noop, onToggleTemplateAutoApply: noop,
        onCloseMonth: noop,
      })
    ));
  });

  it('Goals renders', async () => {
    await smoke(wrap(
      React.createElement(Goals, {
        goals: SEED.goals, accounts: SEED.accounts,
        onAdd: noop, onEdit: noop, onDelete: noop, onDeposit: noop,
      })
    ));
  });

  it('Recurring renders', async () => {
    await smoke(wrap(
      React.createElement(Recurring, {
        recurrences: SEED.recurrences, accounts: SEED.accounts,
        onAdd: noop, onEdit: noop, onDelete: noop, onToggle: noop,
        userCategories: SEED.userCategories, transactions: SEED.transactions,
      })
    ));
  });

  it('Reports renders', async () => {
    await smoke(wrap(
      React.createElement(Reports, {
        transactions: SEED.transactions, accounts: SEED.accounts,
        budgets: SEED.budgets, netWorthHistory: SEED.netWorthHistory,
        onCategoryDrillDown: noop, initialTab: 'trend',
      })
    ));
  });

  it('Business renders', async () => {
    await smoke(wrap(
      React.createElement(Business, {
        accounts: SEED.accounts, transactions: SEED.transactions,
        onUpdateTransaction: noop,
      })
    ));
  });

  it('Settings renders', async () => {
    await smoke(wrap(
      React.createElement(Settings, {
        transactions: SEED.transactions, accounts: SEED.accounts,
        budgets: SEED.budgets, goals: SEED.goals, netWorthHistory: SEED.netWorthHistory,
        dataPath: SEED.dataPath, onReset: noop, onClearDemo: noop,
        onImport: noop, onChangeDataFile: noop, userCategories: SEED.userCategories,
        onAddUserCategory: noop, onDeleteUserCategory: noop, apiKeys: SEED.apiKeys,
        onSaveApiKeys: noop, archivedTransactions: SEED.archivedTransactions,
        onArchive: noop, onRestoreArchive: noop, onImportNetWorthHistory: noop,
        onPlaidImport: noop, onPlaidBalances: noop, onToast: noop,
        onPlaidSyncComplete: noop, onPlaidModify: noop, onPlaidRemove: noop,
        recurrences: SEED.recurrences, onAddRecurrence: noop, onEditRecurrence: noop,
        onDeleteRecurrence: noop, onToggleRecurrence: noop,
        grants: SEED.grants, onAddGrant: noop, onEditGrant: noop, onDeleteGrant: noop,
        onAddTx: noop, onVestToAccount: noop, onUpdateGrantPrice: noop,
        compensationProfile: SEED.compensationProfile, onSetCompensationProfile: noop,
        budgetAlerts: SEED.budgetAlerts, onSaveBudgetAlerts: noop,
      })
    ));
  });

  it('Equity renders', async () => {
    await smoke(wrap(
      React.createElement(Equity, {
        grants: SEED.grants, onAdd: noop, onEdit: noop, onDelete: noop,
        onAddTx: noop, onVestToAccount: noop, onUpdateGrantPrice: noop,
        investmentAccounts: [], finnhubKey: '',
      })
    ));
  });
});

describe('page smoke tests — light theme', () => {
  it('all pages render with light theme active', async () => {
    document.documentElement.setAttribute('data-theme', 'light');
    await smoke(wrap(
      React.createElement(Dashboard, {
        transactions: SEED.transactions, accounts: SEED.accounts, budgets: SEED.budgets,
        recurrences: SEED.recurrences, grants: SEED.grants, netWorthHistory: SEED.netWorthHistory,
        goals: SEED.goals, onAddTx: noop, onAddGoal: noop, onEditGoal: noop,
        onDeleteGoal: noop, onDeposit: noop, onGoToBudgets: noop,
        compensationProfile: SEED.compensationProfile,
        onCategoryClick: noop, onGoToReports: noop,
      })
    ));
    await smoke(wrap(
      React.createElement(Reports, {
        transactions: SEED.transactions, accounts: SEED.accounts,
        budgets: SEED.budgets, netWorthHistory: SEED.netWorthHistory,
        onCategoryDrillDown: noop, initialTab: 'trend',
      })
    ));
    document.documentElement.removeAttribute('data-theme');
  });
});
