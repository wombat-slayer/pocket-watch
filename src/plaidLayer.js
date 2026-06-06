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
