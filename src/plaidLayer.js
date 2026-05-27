/**
 * plaidLayer.js
 * Handles secure storage of Plaid credentials and linked-item metadata
 * via tauri-plugin-store (separate from the main pocket-watch.json).
 *
 * Stored keys:
 *   client_id  – Plaid client_id
 *   secret     – Plaid secret (sandbox / development / production)
 *   env        – "sandbox" | "development" | "production"
 *   items      – Array of { itemId, accessToken, institutionName, accounts: [{id, name, mask, type}], lastSync }
 */

import { load } from '@tauri-apps/plugin-store';

const STORE_FILE = 'plaid.json';

async function getStore() {
  return await load(STORE_FILE, { autoSave: true });
}

// ── Credentials ──────────────────────────────────────────────────────────────

export async function getPlaidCredentials() {
  const store = await getStore();
  return {
    clientId: (await store.get('client_id')) ?? '',
    secret:   (await store.get('secret'))    ?? '',
    env:      (await store.get('env'))       ?? 'sandbox',
  };
}

export async function savePlaidCredentials({ clientId, secret, env }) {
  const store = await getStore();
  await store.set('client_id', clientId);
  await store.set('secret',    secret);
  await store.set('env',       env ?? 'sandbox');
  await store.save();
}

export async function clearPlaidCredentials() {
  const store = await getStore();
  await store.delete('client_id');
  await store.delete('secret');
  await store.delete('env');
  await store.save();
}

// ── Linked items ─────────────────────────────────────────────────────────────

/**
 * Each item:
 * {
 *   itemId:          string,   // Plaid item_id
 *   accessToken:     string,   // Plaid access_token (keep on device only)
 *   institutionName: string,
 *   accounts: [{ id, name, mask, type, subtype }],
 *   lastSync:        string | null  // ISO date of most recent successful sync
 * }
 */
export async function getLinkedItems() {
  const store = await getStore();
  return (await store.get('items')) ?? [];
}

export async function addLinkedItem(item) {
  const store = await getStore();
  const items = (await store.get('items')) ?? [];
  // Replace if itemId already exists, otherwise append
  const idx = items.findIndex(i => i.itemId === item.itemId);
  if (idx >= 0) {
    items[idx] = { ...items[idx], ...item };
  } else {
    items.push(item);
  }
  await store.set('items', items);
  await store.save();
}

export async function updateLinkedItem(itemId, patch) {
  const store = await getStore();
  const items = (await store.get('items')) ?? [];
  const idx = items.findIndex(i => i.itemId === itemId);
  if (idx >= 0) {
    items[idx] = { ...items[idx], ...patch };
    await store.set('items', items);
    await store.save();
  }
}

export async function removeLinkedItem(itemId) {
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

  const amount = -(plaidTx.amount);           // Plaid: positive = debit; PW: positive = income
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
    amount:      Math.abs(amount),
    type,
    account:     acct,
    category,
    notes:       '',
    tags:        [],
    cleared:     true,
    _plaid:      true,
  };
}

/**
 * Map Plaid personal_finance_category primary values to Pocket Watch categories.
 * Falls back to 'Other' for unknown values.
 */
function mapPlaidCategory(primary) {
  const map = {
    INCOME:                  'Income',
    TRANSFER_IN:             'Transfer',
    TRANSFER_OUT:            'Transfer',
    LOAN_PAYMENTS:           'Debt Payment',
    BANK_FEES:               'Fees & Charges',
    ENTERTAINMENT:           'Entertainment',
    FOOD_AND_DRINK:          'Food & Dining',
    GENERAL_MERCHANDISE:     'Shopping',
    HOME_IMPROVEMENT:        'Home',
    MEDICAL:                 'Healthcare',
    PERSONAL_CARE:           'Personal Care',
    GENERAL_SERVICES:        'Services',
    GOVERNMENT_AND_NON_PROFIT: 'Other',
    TRANSPORTATION:          'Transportation',
    TRAVEL:                  'Travel',
    RENT_AND_UTILITIES:      'Bills & Utilities',
  };
  return map[primary] ?? 'Other';
}
