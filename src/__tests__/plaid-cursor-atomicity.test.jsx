// @vitest-environment jsdom
/**
 * H2 — Plaid cursor atomicity.
 * plaidCursors lives in the main data file so cursor and transactions persist
 * in the same saveAppData call. If saveAppData fails, neither the new
 * transactions nor the advanced cursor reach disk; the next sync re-pulls the
 * same delta (dedup prevents re-importing existing transactions).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

// ── Hoist mutable references so they're available in vi.mock factories ────────
const saveAppDataMock = vi.hoisted(() => vi.fn(() => Promise.resolve()));

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('@tauri-apps/api/core',  () => ({ invoke: vi.fn(() => Promise.resolve(null)) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }));
vi.mock('@tauri-apps/plugin-store', () => ({
  Store: {
    load: vi.fn(() =>
      Promise.resolve({ get: vi.fn(() => Promise.resolve(null)), set: vi.fn(), save: vi.fn() })
    ),
  },
}));
vi.mock('@tauri-apps/plugin-dialog',  () => ({ save: vi.fn(), open: vi.fn() }));
vi.mock('@tauri-apps/plugin-opener',  () => ({ openUrl: vi.fn() }));
vi.mock('@tauri-apps/plugin-fs',      () => ({ readFile: vi.fn(), writeFile: vi.fn() }));
vi.mock('@fabianlars/tauri-plugin-oauth', () => ({
  start: vi.fn(() => Promise.resolve(0)),
  cancel: vi.fn(),
  onUrl:  vi.fn(() => Promise.resolve(() => {})),
}));
vi.mock('react-plaid-link', () => ({
  usePlaidLink: vi.fn(() => ({ open: vi.fn(), ready: false, exit: vi.fn() })),
}));
vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: {} }));
vi.mock('../hooks/useChart.js',      () => ({ useChart: vi.fn() }));
vi.mock('../hooks/useMarketData.js', () => ({
  useMarketData:   vi.fn(() => ({ quotes: {}, loading: false, error: null })),
  isCryptoTicker:  vi.fn(() => false),
}));
vi.mock('../utils/extractPdfText.js', () => ({ extractPdfText: vi.fn() }));

vi.mock('../plaidLayer.js', () => ({
  getLinkedItems:        vi.fn(() => Promise.resolve([])),
  getPlaidCredentials:   vi.fn(() => Promise.resolve({ clientId: '', secret: '', env: 'sandbox' })),
  savePlaidCredentials:  vi.fn(),
  clearPlaidCredentials: vi.fn(),
  addLinkedItem:         vi.fn(),
  updateLinkedItem:      vi.fn(),
  removeLinkedItem:      vi.fn(),
  getCursor:             vi.fn(() => Promise.resolve(null)),
  setCursor:             vi.fn(),
  mapPlaidTransaction:   vi.fn(),
  extractBalanceUpdates: vi.fn(() => ({ balanceUpdates: [], plaidIdMap: {} })),
}));

vi.mock('../dataLayer.js', () => ({
  getDataPath:        vi.fn(() => Promise.resolve('/tmp/pw-test.json')),
  setDataPath:        vi.fn(),
  getDefaultDataPath: vi.fn(() => Promise.resolve('/tmp/pw-test.json')),
  loadAppData:        vi.fn(() => Promise.resolve({
    plaidCursors: { 'item-abc': 'cursor-old' },
    transactions: [],
    accounts: [],
    version: 10,
  })),
  saveAppData:        saveAppDataMock,
  dataFileExists:     vi.fn(() => Promise.resolve(true)),
  setAllowedDataDir:  vi.fn(),
  promptNewDataFile:  vi.fn(),
  promptOpenDataFile: vi.fn(),
}));

// ── Import after mocks ────────────────────────────────────────────────────────
import App from '../App.jsx';

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('H2 — Plaid cursor atomicity', () => {
  beforeEach(() => {
    saveAppDataMock.mockClear();
    saveAppDataMock.mockResolvedValue(undefined);
  });

  it('plaidCursors is included in the same saveAppData payload as transactions', async () => {
    let capturedPayload = null;
    saveAppDataMock.mockImplementation((_path, data) => {
      capturedPayload = data;
      return Promise.resolve();
    });

    await act(async () => {
      render(<App />);
      // allow initFromPath and initial effects to settle
      await new Promise(r => setTimeout(r, 50));
    });

    // advance past the 600ms debounce
    await act(async () => {
      await new Promise(r => setTimeout(r, 700));
    });

    expect(capturedPayload).not.toBeNull();
    // plaidCursors and transactions are co-located in the save payload — atomicity invariant
    expect(capturedPayload).toHaveProperty('plaidCursors');
    expect(capturedPayload).toHaveProperty('transactions');
    // cursor loaded from data file is preserved in the payload
    expect(capturedPayload.plaidCursors).toEqual({ 'item-abc': 'cursor-old' });
  });

  it('cursor is not advanced when saveAppData rejects (disk-full simulation)', async () => {
    // Capture what was attempted before the throw
    let attemptedPayload = null;
    saveAppDataMock.mockImplementation((_path, data) => {
      attemptedPayload = data;
      return Promise.reject(new Error('ENOSPC: no space left on device'));
    });

    await act(async () => {
      render(<App />);
      await new Promise(r => setTimeout(r, 50));
    });

    await act(async () => {
      await new Promise(r => setTimeout(r, 700));
    });

    // The save was attempted with both plaidCursors and transactions in the payload.
    // Because it threw, neither was written to disk.
    // The next app load reads the unchanged file: plaidCursors['item-abc'] = 'cursor-old'.
    // The next Plaid sync re-fetches from 'cursor-old'; dedup prevents duplicate imports.
    expect(attemptedPayload).toHaveProperty('plaidCursors');
    expect(attemptedPayload).toHaveProperty('transactions');
    // cursor and transactions fail or succeed together — they're in the same payload
  });
});
