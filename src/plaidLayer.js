/**
 * plaidLayer.js
 * Handles storage of Plaid credentials and linked-item metadata.
 *
 * Secrets live in the OS credential manager (Windows Credential Manager /
 * macOS Keychain / Linux Secret Service) via the `secret_*` Tauri commands:
 *   plaid-credentials      – JSON { clientId, secret, env }
 *   plaid-token-<itemId>   – Plaid access_token for one linked item
 *
 * Non-secret metadata stays in tauri-plugin-store (plaid.json):
 *   items – Array of { itemId, institutionName, accounts: [{id, name, mask, type, subtype}], lastSync }
 *
 * Legacy installs stored everything in plaintext in plaid.json;
 * migrateLegacyPlaintext() moves those secrets into the credential manager
 * and scrubs them from the store the first time the layer is touched.
 */

import { invoke } from '@tauri-apps/api/core';
import { load } from '@tauri-apps/plugin-store';

const STORE_FILE = 'plaid.json';
const CREDS_KEY  = 'plaid-credentials';
const tokenKey   = (itemId) => `plaid-token-${itemId}`;

const EMPTY_CREDS = { clientId: '', secret: '', env: 'sandbox' };

async function getStore() {
  return await load(STORE_FILE, { autoSave: true });
}

// ── One-time migration of legacy plaintext secrets ───────────────────────────

let migrationPromise = null;

async function migrateLegacyPlaintext() {
  // Run at most once per app session; concurrent callers share the promise
  if (!migrationPromise) migrationPromise = doMigrate();
  return migrationPromise;
}

async function doMigrate() {
  const store = await getStore();
  let dirty = false;

  // Legacy credentials (client_id / secret / env as plaintext store keys)
  const legacyClientId = await store.get('client_id');
  const legacySecret   = await store.get('secret');
  if (legacyClientId || legacySecret) {
    await invoke('secret_set', {
      key:   CREDS_KEY,
      value: JSON.stringify({
        clientId: legacyClientId ?? '',
        secret:   legacySecret   ?? '',
        env:      (await store.get('env')) ?? 'sandbox',
      }),
    });
    await store.delete('client_id');
    await store.delete('secret');
    await store.delete('env');
    dirty = true;
  }

  // Legacy items with embedded plaintext access tokens
  const items = (await store.get('items')) ?? [];
  if (items.some(i => i.accessToken)) {
    for (const item of items) {
      if (item.accessToken) {
        await invoke('secret_set', { key: tokenKey(item.itemId), value: item.accessToken });
        delete item.accessToken;
      }
    }
    await store.set('items', items);
    dirty = true;
  }

  if (dirty) await store.save();
}

// ── Credentials ──────────────────────────────────────────────────────────────

export async function getPlaidCredentials() {
  await migrateLegacyPlaintext();
  const raw = await invoke('secret_get', { key: CREDS_KEY });
  if (!raw) return { ...EMPTY_CREDS };
  try {
    const parsed = JSON.parse(raw);
    return {
      clientId: parsed.clientId ?? '',
      secret:   parsed.secret   ?? '',
      env:      parsed.env      ?? 'sandbox',
    };
  } catch {
    return { ...EMPTY_CREDS };
  }
}

export async function savePlaidCredentials({ clientId, secret, env }) {
  await migrateLegacyPlaintext();
  await invoke('secret_set', {
    key:   CREDS_KEY,
    value: JSON.stringify({ clientId, secret, env: env ?? 'sandbox' }),
  });
}

export async function clearPlaidCredentials() {
  await invoke('secret_delete', { key: CREDS_KEY });
}

// ── Linked items ─────────────────────────────────────────────────────────────

/**
 * Each item (as returned to callers — accessToken is rehydrated from the
 * OS credential manager and only ever held in memory):
 * {
 *   itemId:          string,   // Plaid item_id
 *   accessToken:     string,   // Plaid access_token (keep on device only)
 *   institutionName: string,
 *   accounts: [{ id, name, mask, type, subtype }],
 *   lastSync:        string | null  // ISO date of most recent successful sync
 * }
 */
export async function getLinkedItems() {
  await migrateLegacyPlaintext();
  const store = await getStore();
  const items = (await store.get('items')) ?? [];
  return Promise.all(items.map(async (item) => ({
    ...item,
    accessToken: (await invoke('secret_get', { key: tokenKey(item.itemId) })) ?? '',
  })));
}

export async function addLinkedItem(item) {
  await migrateLegacyPlaintext();
  const { accessToken, ...meta } = item;
  if (accessToken) {
    await invoke('secret_set', { key: tokenKey(item.itemId), value: accessToken });
  }
  const store = await getStore();
  const items = (await store.get('items')) ?? [];
  // Replace if itemId already exists, otherwise append
  const idx = items.findIndex(i => i.itemId === item.itemId);
  if (idx >= 0) {
    items[idx] = { ...items[idx], ...meta };
  } else {
    items.push(meta);
  }
  await store.set('items', items);
  await store.save();
}

export async function updateLinkedItem(itemId, patch) {
  await migrateLegacyPlaintext();
  const { accessToken, ...metaPatch } = patch;
  if (accessToken) {
    await invoke('secret_set', { key: tokenKey(itemId), value: accessToken });
  }
  if (Object.keys(metaPatch).length === 0) return;
  const store = await getStore();
  const items = (await store.get('items')) ?? [];
  const idx = items.findIndex(i => i.itemId === itemId);
  if (idx >= 0) {
    items[idx] = { ...items[idx], ...metaPatch };
    await store.set('items', items);
    await store.save();
  }
}

export async function removeLinkedItem(itemId) {
  await invoke('secret_delete', { key: tokenKey(itemId) });
  const store = await getStore();
  const items = ((await store.get('items')) ?? []).filter(i => i.itemId !== itemId);
  await store.set('items', items);
  await store.save();
}

// ── Transaction mapping ──────────────────────────────────────────────────────

/**
 * Map a raw Plaid transaction object to a Pocket Watch transaction row.
 * Returns null for pending transactions (no transaction_id yet guaranteed).
 */
export function mapPlaidTransaction(plaidTx, accountMap = {}) {
  if (plaidTx.pending) return null;

  // Plaid: positive = debit (money out). Pocket Watch stores SIGNED amounts
  // (expense negative, income positive — same convention as TransactionForm,
  // computeBalance, and the transaction list coloring), so negate and keep
  // the sign. Math.abs here would make every expense show as green income.
  const amount = -(plaidTx.amount);
  const type   = amount < 0 ? 'expense' : 'income';
  const acct   = accountMap[plaidTx.account_id] ?? plaidTx.account_id;

  // Best-effort category from Plaid's personal_finance_category
  const pfc = plaidTx.personal_finance_category?.primary ?? '';
  const category = mapPlaidCategory(pfc);

  return {
    id:          plaidTx.transaction_id,
    fitid:       plaidTx.transaction_id,   // reuse same field for dedup
    date:        plaidTx.date,             // already YYYY-MM-DD
    description: plaidTx.merchant_name || plaidTx.name || '',
    amount,
    type,
    account:     acct,
    category,
    notes:       '',
    tags:        [],
    cleared:     true,
    _plaid:      true,
  };
}

// ── Balance sync ─────────────────────────────────────────────────────────────

// Plaid account.type → compatible Pocket Watch account types. Keeps a credit
// card's Plaid balance from overwriting a checking account that merely shares
// the institution name in the user's account naming.
const PLAID_TYPE_COMPAT = {
  depository: ['checking', 'savings', 'cash', 'other'],
  credit:     ['credit'],
  loan:       ['loan'],
  investment: ['investment'],
  brokerage:  ['investment'],
};

// Tokens too generic to disambiguate account names ("account" appears in
// nearly every Plaid account name, "card" in any credit card's — matching on
// them produces false positives like "CREDIT CARD" → "Discover Card").
const MATCH_STOP_TOKENS = new Set([
  'account', 'accounts', 'plan', 'the', 'of', 'my',
  'card', 'credit', 'debit', 'bank', 'banking', 'financial', 'services',
  'total', 'cash',
]);

function nameTokens(s) {
  return new Set(
    (s ?? '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(t => t.length >= 2 && !MATCH_STOP_TOKENS.has(t))
  );
}

/**
 * Build authoritative balance updates for app accounts from a Plaid accounts
 * array (/accounts/get or /transactions/get response).
 *
 * balances.current is authoritative; balances.available is the fallback
 * (some credit cards report current as null). Plaid reports credit/loan
 * balances as POSITIVE amounts owed — Pocket Watch stores debt balances
 * positive too (net worth = assets − debts, see Accounts.jsx), so the value
 * is written as-is, no sign change.
 *
 * Matching, in priority order against type-compatible app accounts only:
 *   1. last-4 mask appearing in the app account name — strongest; rename
 *      accounts like "Fidelity HSA 3654" for guaranteed matching
 *   2. distinctive-token overlap between the app account name (institution
 *      words removed) and the Plaid name + subtype, e.g.
 *      "Fidelity HSA" ∩ ("Health Savings Account" + "hsa") = {hsa}
 *   3. institution name — ONLY when the institution reports a single account
 *      of that type group; with several, "name contains 'Fidelity'" would
 *      assign balances by Plaid's response order (live Fidelity item put the
 *      RSU brokerage balance on the HSA account this way)
 * Each app account is claimed by at most one Plaid account. No match → no
 * update: a stale balance is recoverable, a wrong one is misinformation.
 *
 * Returns [{ id, balance }] for the app accounts that matched.
 */
export function extractBalanceUpdates(plaidAccounts, appAccounts, institutionName = '') {
  const balanceUpdates = [];
  const plaidIdMap = {}; // plaid account_id → app account id
  const claimed = new Set();
  const instTokens = nameTokens(institutionName);
  const groupOf = (t) => (t === 'brokerage' ? 'investment' : t);
  // Accounts per type group, to gate the institution fallback to singletons
  const groupCounts = {};
  for (const pa of plaidAccounts ?? []) {
    const g = groupOf(pa.type);
    groupCounts[g] = (groupCounts[g] ?? 0) + 1;
  }

  for (const pa of plaidAccounts ?? []) {
    const compat = PLAID_TYPE_COMPAT[pa.type] ?? null;
    const candidates = (appAccounts ?? []).filter(a =>
      !claimed.has(a.id) && (compat === null || compat.includes(a.type))
    );

    const byMask = pa.mask ? candidates.find(a => a.name?.includes(pa.mask)) : undefined;

    const paTokens = nameTokens(pa.name);
    if (pa.subtype) paTokens.add(String(pa.subtype).toLowerCase());
    const overlapCount = (a) => {
      let n = 0;
      for (const t of nameTokens(a.name)) if (!instTokens.has(t) && paTokens.has(t)) n++;
      return n;
    };
    let byTokens, byTokensScore = 0;
    for (const a of candidates) {
      const n = overlapCount(a);
      if (n > byTokensScore) { byTokens = a; byTokensScore = n; }
    }

    const instLc = (institutionName ?? '').toLowerCase();
    const fallbackAllowed = groupCounts[groupOf(pa.type)] === 1;
    const byInst = fallbackAllowed && instLc
      ? candidates.find(a => a.name?.toLowerCase().includes(instLc))
      : undefined;

    const match = byMask || byTokens || byInst || null;
    if (!match) continue;
    claimed.add(match.id);
    plaidIdMap[pa.account_id] = match.id;
    const bal = pa.balances?.current ?? pa.balances?.available;
    if (bal != null) balanceUpdates.push({ id: match.id, balance: +Number(bal).toFixed(2) });
  }

  return { balanceUpdates, plaidIdMap };
}

// ── Sync cursors ─────────────────────────────────────────────────────────────
// Cursors are stored in plaid.json under the key 'syncCursors' (object keyed
// by Plaid item_id). A null/absent cursor means "no prior sync" — Plaid will
// return all available history on the first /transactions/sync call.

export async function getCursor(itemId) {
  const store = await getStore();
  const cursors = (await store.get('syncCursors')) ?? {};
  return cursors[itemId] ?? null;
}

export async function setCursor(itemId, cursor) {
  const store = await getStore();
  const cursors = (await store.get('syncCursors')) ?? {};
  cursors[itemId] = cursor;
  await store.set('syncCursors', cursors);
  await store.save();
}

/**
 * Map Plaid personal_finance_category primary values to Pocket Watch categories.
 * Falls back to 'Other' for unknown values.
 */
function mapPlaidCategory(primary) {
  // Values must be real category names from CATEGORIES in constants.js —
  // anything else silently orphans imported transactions in the UI.
  const map = {
    INCOME:                  'Income',
    TRANSFER_IN:             'Transfer',
    TRANSFER_OUT:            'Transfer',
    LOAN_PAYMENTS:           'Other',
    BANK_FEES:               'Other',
    ENTERTAINMENT:           'Entertainment',
    FOOD_AND_DRINK:          'Food & Dining',
    GENERAL_MERCHANDISE:     'Shopping',
    HOME_IMPROVEMENT:        'Housing',
    MEDICAL:                 'Healthcare',
    PERSONAL_CARE:           'Personal Care',
    GENERAL_SERVICES:        'Other',
    GOVERNMENT_AND_NON_PROFIT: 'Other',
    TRANSPORTATION:          'Transportation',
    TRAVEL:                  'Travel',
    RENT_AND_UTILITIES:      'Utilities',
  };
  return map[primary] ?? 'Other';
}
