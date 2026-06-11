import { useState, useEffect, useCallback, useRef } from 'react';
import { usePlaidLink } from 'react-plaid-link';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { start as startOauthServer, cancel as cancelOauthServer, onUrl as onOauthUrl } from '@fabianlars/tauri-plugin-oauth';
import {
  getPlaidCredentials,
  savePlaidCredentials,
  clearPlaidCredentials,
  getLinkedItems,
  addLinkedItem,
  updateLinkedItem,
  removeLinkedItem,
  mapPlaidTransaction,
  extractBalanceUpdates,
} from '../plaidLayer.js';
import { useCategoryMemory } from '../hooks/useCategoryMemory.js';
import { detectAndMarkTransferPairs, autoCategoryBusiness } from '../constants.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ── Transfer pattern matching ─────────────────────────────────────────────────
// Fallback name-pattern list for transactions that Plaid doesn't classify as
// transfers via personal_finance_category or the legacy category array.
const TRANSFER_PATTERNS = [
  /payment thank you/i,
  /payment to chase/i,
  /american express ach pmt/i,
  /apple card/i,
  /chase card payment/i,
  /credit card payment/i,
];

// ── OAuth redirect support ───────────────────────────────────────────────────
// OAuth institutions (Chase, Wells Fargo, …) hand off to the bank's site in
// the SYSTEM browser (Tauri routes Plaid's window.open there), and the bank
// redirects that browser to the redirect URI with an oauth_state_id query
// param. Before opening Link we start a loopback listener on a dynamic port
// (tauri-plugin-oauth) and register http://localhost:<port>/ as redirect_uri;
// the listener captures the full redirect URL and forwards it into the
// webview, where Link is re-initialized with the SAME link_token plus
// receivedRedirectUri to resume the flow.
//
// Plaid matches redirect URIs EXACTLY (verified live: dynamic ports are
// rejected with "OAuth redirect URI must be configured in the developer
// dashboard"), so the listener binds port 80 first — matching the
// registered http://localhost — and falls back to fixed ports when 80 is
// unavailable (e.g. taken, or Linux privilege rules). The fallback URIs
// http://localhost:58420 / :58421 / :58422 must be registered in the
// Plaid dashboard for the fallback to work.
//
// The link_token is also persisted to localStorage so the flow survives a
// page reload (e.g. if the app is restarted mid-OAuth).

const LINK_TOKEN_STORAGE_KEY = 'plaid_link_token';
const OAUTH_PORTS = [80, 58420, 58421, 58422]; // tried in order by the loopback listener
const redirectUriForPort = (port) => port === 80 ? 'http://localhost' : `http://localhost:${port}`;

// ── PlaidLink wrapper (rendered when we have a link_token) ───────────────────

function PlaidLinkButton({ linkToken, receivedRedirectUri, onSuccess, onExit, onOauthError }) {
  const config = {
    token: linkToken,
    receivedRedirectUri: receivedRedirectUri || undefined,
    onSuccess: (public_token, metadata) => onSuccess(public_token, metadata),
    onExit: (err) => {
      if (err) console.error('Plaid exit:', err);
      if (err?.error_code === 'OAUTH_ERROR') onOauthError?.();
      onExit?.();
    },
    // Diagnostic trail for OAuth handoff debugging (OPEN_OAUTH, HANDOFF, ERROR…)
    onEvent: (eventName, metadata) => {
      console.log('[plaid-link]', eventName, metadata?.view_name ?? '', metadata?.error_code ?? '');
      if (metadata?.error_code === 'OAUTH_ERROR') onOauthError?.();
    },
  };
  const { open, ready } = usePlaidLink(config);

  // OAuth continuation: resume Link automatically instead of waiting for a click
  useEffect(() => {
    if (receivedRedirectUri && ready) open();
  }, [receivedRedirectUri, ready, open]);

  return (
    <button
      className="btn btn-primary"
      onClick={() => open()}
      disabled={!ready}
      style={{ minWidth: 180 }}
    >
      {ready ? '🏦 Connect a Bank Account' : '⏳ Loading…'}
    </button>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export default function PlaidSync({ accounts, existingTxs, onImport, onToast, onSyncComplete, onUpdateBalances, onModifyTxs, onRemoveTxs, plaidCursors = {}, onSetCursor }) {
  // ── Credentials state ──────────────────────────────────────────────────────
  const [creds, setCreds] = useState({ clientId: '', secret: '', env: 'sandbox' });
  const [credInput, setCredInput] = useState({ clientId: '', secret: '', env: 'sandbox' });
  const [credSaved, setCredSaved] = useState(false);
  const [credEditing, setCredEditing] = useState(false);

  // ── Linked items state ─────────────────────────────────────────────────────
  const [items, setItems] = useState([]);

  // ── Link flow state ────────────────────────────────────────────────────────
  const [linkToken, setLinkToken] = useState(null);
  const [linking,   setLinking]   = useState(false);
  const [linkError, setLinkError] = useState('');
  const [oauthRedirectUri, setOauthRedirectUri] = useState(null); // set when resuming an OAuth flow
  const oauthPort     = useRef(null); // loopback listener port, while one is running
  const oauthUnlisten = useRef(null); // unsubscribe fn for the oauth://url event

  // ── Sync state ─────────────────────────────────────────────────────────────
  const [syncStatus,    setSyncStatus]    = useState({}); // { [itemId]: 'idle'|'syncing'|'done'|'error' }
  const [syncMsg,       setSyncMsg]       = useState({}); // { [itemId]: string }
  const [syncingAll,    setSyncingAll]    = useState(false);
  const [syncAllMsg,    setSyncAllMsg]    = useState('');
  const [syncTimeframe, setSyncTimeframe] = useState({}); // { [itemId]: 'cursor'|'30d'|'90d'|'180d'|'1y' }
  const warnedUnmatched = useRef(new Set());              // itemIds already warned about unmatched accounts

  // Category memory: user's explicit past categorization choices per merchant.
  // Used in handleSync to override Plaid's suggested categories.
  const { suggest: suggestCategory } = useCategoryMemory(existingTxs);

  // ── Load saved state on mount ──────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      const saved = await getPlaidCredentials();
      setCreds(saved);
      setCredInput(saved);
      setCredEditing(!saved.clientId); // show form if no creds yet
      const savedItems = await getLinkedItems();
      setItems(savedItems);

      // OAuth redirect continuation (fallback path): the webview itself was
      // navigated with oauth_state_id in the URL — re-initialize Link with
      // the persisted link_token and the full redirect URL. The primary
      // path is the loopback listener below, which never reloads the page.
      if (window.location.href.includes('oauth_state_id')) {
        const storedToken = localStorage.getItem(LINK_TOKEN_STORAGE_KEY);
        if (storedToken) {
          setOauthRedirectUri(window.location.href);
          setLinkToken(storedToken);
        } else {
          setLinkError('Returned from bank OAuth, but no pending link session was found. Please start the connection again.');
        }
      }
    })();
    // Shut the loopback listener down if the user navigates away mid-flow
    return () => { stopOauthServer(); };
  }, []);

  // ── Popup bridge receiver ────────────────────────────────────────────────────
  // The webview denies window.open() from Plaid's cross-origin Link iframe,
  // so an init script (popup_bridge in lib.rs) forwards the OAuth popup URL
  // here via postMessage. We open it in the system browser; the bank then
  // redirects that browser to the loopback listener to resume the flow.
  useEffect(() => {
    const onMessage = (e) => {
      if (e.origin !== 'https://cdn.plaid.com') return; // only trust Link's frame
      const data = e.data;
      if (!data || data.__pocket_watch_open_external !== true) return;
      if (typeof data.url !== 'string' || !data.url.startsWith('https://')) return;
      openUrl(data.url);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  // ── Loopback listener teardown ───────────────────────────────────────────────
  const stopOauthServer = async () => {
    if (oauthUnlisten.current) {
      oauthUnlisten.current();
      oauthUnlisten.current = null;
    }
    if (oauthPort.current != null) {
      const port = oauthPort.current;
      oauthPort.current = null;
      try { await cancelOauthServer(port); } catch { /* already stopped */ }
    }
  };

  // ── OAuth session cleanup (after Link finishes or is abandoned) ─────────────
  const endLinkSession = () => {
    stopOauthServer();
    localStorage.removeItem(LINK_TOKEN_STORAGE_KEY);
    setOauthRedirectUri(null);
    setLinkToken(null);
    // Strip oauth_state_id etc. from the webview URL
    if (window.location.search) {
      window.history.replaceState({}, '', window.location.pathname);
    }
  };

  // ── Save credentials ───────────────────────────────────────────────────────
  const handleSaveCreds = async () => {
    const cleaned = {
      clientId: credInput.clientId.trim(),
      secret:   credInput.secret.trim(),
      env:      credInput.env,
    };
    await savePlaidCredentials(cleaned);
    setCreds(cleaned);
    setCredSaved(true);
    setCredEditing(false);
    setTimeout(() => setCredSaved(false), 3000);
  };

  const handleClearCreds = async () => {
    if (!confirm('Remove Plaid credentials and disconnect all linked accounts?\n\nThis also revokes access at Plaid (/item/remove) so billing stops for each item.')) return;
    // Revoke each item at Plaid before deleting local state — Plaid keeps
    // billing an item until /item/remove is called.
    const failed = [];
    for (const item of items) {
      try {
        await invoke('plaid_remove_item', {
          clientId:    creds.clientId,
          secret:      creds.secret,
          env:         creds.env,
          accessToken: item.accessToken,
        });
      } catch {
        failed.push(item.institutionName);
      }
      await removeLinkedItem(item.itemId);
    }
    if (failed.length > 0) {
      alert(
        `Could not revoke access at Plaid for: ${failed.join(', ')}.\n\n` +
        'Plaid continues billing an item until it is removed on their side. ' +
        'Please remove these items manually in the Plaid Dashboard (https://dashboard.plaid.com).'
      );
    }
    await clearPlaidCredentials();
    setCreds({ clientId: '', secret: '', env: 'sandbox' });
    setCredInput({ clientId: '', secret: '', env: 'sandbox' });
    setItems([]);
    setLinkToken(null);
    setCredEditing(true);
  };

  // ── Create link token ──────────────────────────────────────────────────────
  const handleStartLink = async () => {
    setLinkError('');
    setLinking(true);
    try {
      await stopOauthServer();
      // Plaid production rejects http:// redirect URIs ("redirect_uri must
      // use HTTPS"), so the localhost loopback OAuth flow only works in
      // sandbox. Outside sandbox we skip the listener and omit redirect_uri
      // entirely — non-OAuth banks work; OAuth banks (Chase, Wells Fargo, …)
      // fail with OAUTH_ERROR, which we surface with a friendly message.
      let redirectUri = null;
      if (creds.env === 'sandbox') {
        // Fresh loopback listener for this Link session. The bank's OAuth page
        // opens in the system browser and redirects there on completion.
        const port = await startOauthServer({ ports: OAUTH_PORTS });
        oauthPort.current = port;
        oauthUnlisten.current = await onOauthUrl((url) => {
          // The localhost port is unprotected — verify this is really the
          // Plaid OAuth redirect before acting on it.
          let parsed;
          try { parsed = new URL(url); } catch { return; }
          if (parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') return;
          if (!parsed.searchParams.get('oauth_state_id')) return;
          oauthPort.current = null; // listener shuts itself down after one capture
          setOauthRedirectUri(url); // re-initializes Link → auto-resumes the flow
        });
        redirectUri = redirectUriForPort(port);
      }

      const token = await invoke('plaid_create_link_token', {
        clientId:    creds.clientId,
        secret:      creds.secret,
        env:         creds.env,
        userId:      'pocket-watch-user',
        redirectUri,
      });
      // Persist so the flow survives an app restart mid-OAuth.
      localStorage.setItem(LINK_TOKEN_STORAGE_KEY, token);
      setLinkToken(token);
    } catch (e) {
      setLinkError(String(e));
      await stopOauthServer();
    } finally {
      setLinking(false);
    }
  };

  // ── Handle successful Link flow ────────────────────────────────────────────
  const handleLinkSuccess = useCallback(async (publicToken, metadata) => {
    endLinkSession();
    setLinkError('');
    try {
      const accessToken = await invoke('plaid_exchange_token', {
        clientId:    creds.clientId,
        secret:      creds.secret,
        env:         creds.env,
        publicToken,
      });

      const newItem = {
        itemId:          metadata.institution?.institution_id ?? crypto.randomUUID(),
        accessToken,
        institutionName: metadata.institution?.name ?? 'Unknown Bank',
        accounts: (metadata.accounts ?? []).map(a => ({
          id:      a.id,
          name:    a.name,
          mask:    a.mask,
          type:    a.type,
          subtype: a.subtype,
        })),
        lastSync: null,
      };

      await addLinkedItem(newItem);
      setItems(prev => {
        const idx = prev.findIndex(i => i.itemId === newItem.itemId);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = newItem;
          return next;
        }
        return [...prev, newItem];
      });
    } catch (e) {
      setLinkError('Token exchange failed: ' + String(e));
    }
  }, [creds]);

  // ── Sync transactions for one item (cursor-based, no 500-tx cap) ──────────
  // M10: accepts optional accumulated dedup sets from handleSyncAll so that when
  // multiple items are synced in sequence, item 2 doesn't dedup against a stale
  // snapshot that pre-dates item 1's newly imported transactions.
  const handleSync = async (item, accFitids = null, accIds = null) => {
    setSyncStatus(s => ({ ...s, [item.itemId]: 'syncing' }));
    setSyncMsg(s => ({ ...s, [item.itemId]: '' }));

    try {
      // Fetch accounts first so matching drives both transaction routing and
      // balance updates in one pass.
      let plaidAccounts = [];
      try {
        const rawAccounts = await invoke('plaid_fetch_accounts', {
          clientId:    creds.clientId,
          secret:      creds.secret,
          env:         creds.env,
          accessToken: item.accessToken,
        });
        plaidAccounts = JSON.parse(rawAccounts).accounts ?? [];
      } catch (e) {
        console.warn('Plaid accounts fetch failed:', e);
      }

      const { balanceUpdates, plaidIdMap } = extractBalanceUpdates(plaidAccounts, accounts, item.institutionName);

      // plaidIdMap keys are Plaid account_ids; values are matched PW account ids.
      const accountMap = {};
      const unmatched  = [];
      for (const pa of item.accounts) {
        if (plaidIdMap[pa.id]) {
          accountMap[pa.id] = plaidIdMap[pa.id];
        } else {
          accountMap[pa.id] = pa.id;
          unmatched.push(`${pa.name}${pa.mask ? ` (…${pa.mask})` : ''}`);
        }
      }
      if (unmatched.length > 0 && !warnedUnmatched.current.has(item.itemId)) {
        warnedUnmatched.current.add(item.itemId);
        onToast?.(
          `No matching Pocket Watch account for ${unmatched.join(', ')} from ${item.institutionName}. ` +
          `Their transactions were imported under the raw Plaid account id. ` +
          `Rename your accounts to include "${item.institutionName}" (or the bank account name) so future syncs match.`,
          'warning'
        );
      }

      // Cursor-based /transactions/sync loop.
      // First call (cursor = null) pulls all available history; subsequent
      // calls are incremental — only added/modified/removed since last cursor.
      let cursor = plaidCursors[item.itemId] ?? null;
      const allAdded    = [];
      const allModified = [];
      const allRemoved  = [];
      let hasMore = true;

      while (hasMore) {
        const raw = await invoke('plaid_sync_transactions', {
          clientId:    creds.clientId,
          secret:      creds.secret,
          env:         creds.env,
          accessToken: item.accessToken,
          cursor:      cursor || null,
        });
        const page = JSON.parse(raw);
        allAdded.push(...(page.added ?? []));
        allModified.push(...(page.modified ?? []));
        allRemoved.push(...(page.removed ?? []));
        cursor = page.next_cursor;
        hasMore = page.has_more === true;
      }
      // Handle removed: delete matching transactions by Plaid transaction_id
      if (allRemoved.length > 0) {
        const removedIds = allRemoved.map(r => r.transaction_id);
        onRemoveTxs?.(removedIds);
      }

      // Handle modified: update matching transactions in place
      if (allModified.length > 0) {
        const updates = allModified
          .map(pt => mapPlaidTransaction(pt, accountMap))
          .filter(Boolean);
        onModifyTxs?.(updates);
      }

      // Dedup added against existing transactions (merge with accumulated set if provided).
      const existingFitids = accFitids ?? new Set(existingTxs.map(t => t.fitid).filter(Boolean));
      const existingIds    = accIds    ?? new Set(existingTxs.map(t => t.id));

      const newTxs = allAdded
        .map(pt => mapPlaidTransaction(pt, accountMap))
        .filter(t => t !== null)
        .filter(t => !existingFitids.has(t.fitid) && !existingIds.has(t.id))
        .map(t => {
          // Priority 1: category memory — user's explicit past choices win always
          const memorized = suggestCategory(t.description);
          if (memorized) return { ...t, category: memorized };

          // Priority 2: Plaid personal_finance_category (already mapped in
          // mapPlaidTransaction). Keep if it resolved to something other than Other.
          if (t.category !== 'Other') return t;

          // Re-examine raw Plaid data for legacy category array and name patterns.
          const rawPt = allAdded.find(p => p.transaction_id === t.id);

          // Priority 3: Plaid legacy category[0] is 'Transfer' or 'Payment'
          const cat0 = rawPt?.category?.[0];
          if (cat0 === 'Transfer' || cat0 === 'Payment') {
            return { ...t, category: 'Transfer' };
          }

          // Priority 4: description matches a known transfer name pattern
          if (TRANSFER_PATTERNS.some(re => re.test(t.description))) {
            return { ...t, category: 'Transfer' };
          }

          // Priority 5: business account — apply business categorization
          const destAcct = accounts.find(a => a.id === accountMap[rawPt?.account_id]);
          if (destAcct?.isBusiness) {
            return { ...t, category: autoCategoryBusiness(t.description) };
          }

          return t;
        });

      // Auto-detect transfer pairs across the full combined transaction set.
      // Pairs already in existingTxs (marked Transfer) won't be overridden.
      const combined    = detectAndMarkTransferPairs([...existingTxs, ...newTxs]);
      const newIds      = new Set(newTxs.map(t => t.id));
      const markedNewTxs = combined.filter(t => newIds.has(t.id));

      if (markedNewTxs.length > 0) {
        onImport(markedNewTxs);
      }

      // Cursor is updated via onSetCursor, which updates React state in App.jsx.
      // The cursor state and the transaction state are both included in the same
      // 600ms debounced saveAppData call, so they persist atomically (H2). If the
      // save is interrupted, neither the new transactions nor the advanced cursor
      // reach disk, and the next sync re-pulls the same delta.
      onSetCursor?.(item.itemId, cursor);

      onSyncComplete?.(markedNewTxs.length, markedNewTxs.filter(t => t.category === 'Other').length);
      if (balanceUpdates.length > 0) onUpdateBalances?.(balanceUpdates);

      const now = today();
      await updateLinkedItem(item.itemId, { lastSync: now });
      setItems(prev => prev.map(i => i.itemId === item.itemId ? { ...i, lastSync: now } : i));

      setSyncStatus(s => ({ ...s, [item.itemId]: 'done' }));
      const balNote = balanceUpdates.length > 0
        ? ` ${balanceUpdates.length} balance${balanceUpdates.length !== 1 ? 's' : ''} updated.`
        : '';
      setSyncMsg(s => ({
        ...s,
        [item.itemId]: (markedNewTxs.length > 0
          ? `✅ Imported ${markedNewTxs.length} new transaction${markedNewTxs.length !== 1 ? 's' : ''}.`
          : '✅ All up to date — no new transactions.') + balNote,
      }));

      return true;
    } catch (e) {
      setSyncStatus(s => ({ ...s, [item.itemId]: 'error' }));
      setSyncMsg(s => ({ ...s, [item.itemId]: '❌ ' + String(e) }));
      return false;
    }
  };

  // ── Fetch by date range using /transactions/get ────────────────────────────
  const handleFetchRange = async (item, timeframe) => {
    setSyncStatus(s => ({ ...s, [item.itemId]: 'syncing' }));
    setSyncMsg(s => ({ ...s, [item.itemId]: '' }));

    try {
      const endDate   = today();
      const msPerDay  = 86400 * 1000;
      const daysMap   = { '30d': 30, '90d': 90, '180d': 180, '1y': 365 };
      const days      = daysMap[timeframe] ?? 30;
      const startDate = new Date(Date.now() - days * msPerDay).toISOString().slice(0, 10);

      let plaidAccounts = [];
      try {
        const rawAccounts = await invoke('plaid_fetch_accounts', {
          clientId:    creds.clientId,
          secret:      creds.secret,
          env:         creds.env,
          accessToken: item.accessToken,
        });
        plaidAccounts = JSON.parse(rawAccounts).accounts ?? [];
      } catch (e) {
        console.warn('Plaid accounts fetch failed:', e);
      }

      const { balanceUpdates, plaidIdMap } = extractBalanceUpdates(plaidAccounts, accounts, item.institutionName);
      const accountMap = {};
      for (const pa of item.accounts) {
        accountMap[pa.id] = plaidIdMap[pa.id] ?? pa.id;
      }

      const raw   = await invoke('plaid_fetch_transactions', {
        clientId:    creds.clientId,
        secret:      creds.secret,
        env:         creds.env,
        accessToken: item.accessToken,
        startDate,
        endDate,
      });
      const fetched = JSON.parse(raw).transactions ?? [];

      const existingFitids = new Set(existingTxs.map(t => t.fitid).filter(Boolean));
      const existingIds    = new Set(existingTxs.map(t => t.id));

      const newTxs = fetched
        .map(pt => mapPlaidTransaction(pt, accountMap))
        .filter(t => t !== null)
        .filter(t => !existingFitids.has(t.fitid) && !existingIds.has(t.id))
        .map(t => {
          const memorized = suggestCategory(t.description);
          if (memorized) return { ...t, category: memorized };
          if (t.category !== 'Other') return t;
          const rawPt  = fetched.find(p => p.transaction_id === t.id);
          const cat0   = rawPt?.category?.[0];
          if (cat0 === 'Transfer' || cat0 === 'Payment') return { ...t, category: 'Transfer' };
          if (TRANSFER_PATTERNS.some(re => re.test(t.description))) return { ...t, category: 'Transfer' };
          const destAcct = accounts.find(a => a.id === accountMap[rawPt?.account_id]);
          if (destAcct?.isBusiness) return { ...t, category: autoCategoryBusiness(t.description) };
          return t;
        });

      const combined     = detectAndMarkTransferPairs([...existingTxs, ...newTxs]);
      const newIds       = new Set(newTxs.map(t => t.id));
      const markedNewTxs = combined.filter(t => newIds.has(t.id));

      if (markedNewTxs.length > 0) onImport(markedNewTxs);
      onSyncComplete?.(markedNewTxs.length, markedNewTxs.filter(t => t.category === 'Other').length);
      if (balanceUpdates.length > 0) onUpdateBalances?.(balanceUpdates);

      const now = today();
      await updateLinkedItem(item.itemId, { lastSync: now });
      setItems(prev => prev.map(i => i.itemId === item.itemId ? { ...i, lastSync: now } : i));

      setSyncStatus(s => ({ ...s, [item.itemId]: 'done' }));
      const balNote = balanceUpdates.length > 0
        ? ` ${balanceUpdates.length} balance${balanceUpdates.length !== 1 ? 's' : ''} updated.`
        : '';
      setSyncMsg(s => ({
        ...s,
        [item.itemId]: (markedNewTxs.length > 0
          ? `✅ Imported ${markedNewTxs.length} new transaction${markedNewTxs.length !== 1 ? 's' : ''}.`
          : '✅ All up to date — no new transactions.') + balNote,
      }));

      return markedNewTxs;
    } catch (e) {
      setSyncStatus(s => ({ ...s, [item.itemId]: 'error' }));
      setSyncMsg(s => ({ ...s, [item.itemId]: '❌ ' + String(e) }));
      return false;
    }
  };

  // ── Sync all institutions in sequence ─────────────────────────────────────
  const handleSyncAll = async () => {
    if (syncingAll || !items.length) return;
    setSyncingAll(true);
    setSyncAllMsg('');
    // Accumulate seen fitids/ids across items so a tx imported from item N
    // is not re-imported as a duplicate when item N+1 syncs (M10).
    const seenFitids = new Set(existingTxs.map(t => t.fitid).filter(Boolean));
    const seenIds    = new Set(existingTxs.map(t => t.id));
    let errorCount = 0;
    for (let i = 0; i < items.length; i++) {
      setSyncAllMsg(`Syncing ${items[i].institutionName} (${i + 1}/${items.length})…`);
      const imported = await handleSync(items[i], seenFitids, seenIds);
      if (imported === false) {
        errorCount++;
      } else if (imported?.length) {
        imported.forEach(t => {
          if (t.fitid) seenFitids.add(t.fitid);
          seenIds.add(t.id);
        });
      }
    }
    setSyncAllMsg(
      errorCount > 0
        ? `Done — ${errorCount} institution${errorCount !== 1 ? 's' : ''} had errors.`
        : '✅ All institutions synced.'
    );
    setSyncingAll(false);
  };

  // ── Remove a linked item ───────────────────────────────────────────────────
  const handleRemoveItem = async (item) => {
    if (!confirm(`Disconnect ${item.institutionName}? This revokes Pocket Watch's access at Plaid and stops billing for this connection. Transactions already imported will remain.`)) return;
    // Revoke at Plaid first — billing for an item continues until
    // /item/remove succeeds. If it fails, let the user remove locally
    // anyway but tell them to clean up via the Plaid dashboard.
    try {
      await invoke('plaid_remove_item', {
        clientId:    creds.clientId,
        secret:      creds.secret,
        env:         creds.env,
        accessToken: item.accessToken,
      });
    } catch (e) {
      const proceed = confirm(
        `Could not revoke access at Plaid:\n${String(e)}\n\n` +
        'Remove the connection from Pocket Watch anyway?\n\n' +
        'Important: Plaid continues billing this item until it is removed on their side. ' +
        'Please remove it manually in the Plaid Dashboard (https://dashboard.plaid.com).'
      );
      if (!proceed) return;
    }
    await removeLinkedItem(item.itemId);
    setItems(prev => prev.filter(i => i.itemId !== item.itemId));
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  const hasCreds = !!(creds.clientId && creds.secret);
  const anySyncing = syncingAll || Object.values(syncStatus).some(s => s === 'syncing');

  return (
    <div>
      {/* ── Credentials section ───────────────────────────────────────────── */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <span style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 600 }}>Plaid API Credentials</span>
          {hasCreds && !credEditing && (
            <button className="btn btn-ghost btn-sm" onClick={() => setCredEditing(true)}>Edit</button>
          )}
          {hasCreds && (
            <button className="btn btn-ghost btn-sm" style={{ color: 'var(--red)' }} onClick={handleClearCreds}>
              Disconnect All
            </button>
          )}
        </div>

        {credEditing ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 480 }}>
            <select
              value={credInput.env}
              onChange={e => setCredInput(p => ({ ...p, env: e.target.value }))}
              style={{ fontSize: 13, width: 160 }}
            >
              <option value="sandbox">Sandbox (testing)</option>
              <option value="development">Development</option>
              <option value="production">Production</option>
            </select>
            <input
              type="text"
              placeholder="Client ID"
              value={credInput.clientId}
              onChange={e => setCredInput(p => ({ ...p, clientId: e.target.value }))}
              autoComplete="off"
              style={{ fontFamily: 'monospace', fontSize: 13 }}
            />
            <input
              type="password"
              placeholder="Secret"
              value={credInput.secret}
              onChange={e => setCredInput(p => ({ ...p, secret: e.target.value }))}
              autoComplete="off"
              style={{ fontFamily: 'monospace', fontSize: 13 }}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className="btn btn-primary btn-sm"
                disabled={!credInput.clientId.trim() || !credInput.secret.trim()}
                onClick={handleSaveCreds}
              >
                Save Credentials
              </button>
              {hasCreds && (
                <button className="btn btn-ghost btn-sm" onClick={() => { setCredInput(creds); setCredEditing(false); }}>
                  Cancel
                </button>
              )}
            </div>
            {credSaved && <span style={{ color: 'var(--green)', fontSize: 12 }}>✅ Saved.</span>}
          </div>
        ) : (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
            Environment: <span style={{ color: 'var(--green)' }}>{creds.env}</span>
            &nbsp;·&nbsp;
            Client ID: <span style={{ color: 'var(--green)' }}>{creds.clientId.slice(0, 8)}…</span>
          </div>
        )}
      </div>

      {/* ── Connect button ────────────────────────────────────────────────── */}
      {hasCreds && (
        <div style={{ marginBottom: 24 }}>
          {linkToken ? (
            <PlaidLinkButton
              key={oauthRedirectUri ?? 'initial'}
              linkToken={linkToken}
              receivedRedirectUri={oauthRedirectUri}
              onSuccess={handleLinkSuccess}
              onExit={endLinkSession}
              onOauthError={() => {
                // Only relevant outside sandbox, where no redirect_uri is
                // registered and OAuth institutions cannot complete Link.
                if (creds.env !== 'sandbox') {
                  setLinkError(
                    "This bank requires OAuth which isn't supported in production yet. " +
                    'Try a different bank or use sandbox mode for testing.'
                  );
                }
              }}
            />
          ) : (
            <button
              className="btn btn-secondary"
              onClick={handleStartLink}
              disabled={linking}
              style={{ minWidth: 200 }}
            >
              {linking ? '⏳ Getting link token…' : '＋ Connect Another Account'}
            </button>
          )}
          {linkError && (
            <p style={{ color: 'var(--red)', fontSize: 12, marginTop: 8 }}>❌ {linkError}</p>
          )}
        </div>
      )}

      {/* ── Connected items ───────────────────────────────────────────────── */}
      {items.length > 0 && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 600 }}>
              Connected Institutions
            </span>
            <button
              className="btn btn-ghost btn-sm"
              style={{ fontSize: 11 }}
              title="Audit or revoke Pocket Watch's access from your Plaid account"
              onClick={() => openUrl('https://my.plaid.com')}
            >
              🔗 Manage at Plaid
            </button>
            {items.length > 1 && (
              <button
                className="btn btn-secondary btn-sm"
                disabled={anySyncing}
                onClick={handleSyncAll}
                style={{ fontSize: 12 }}
              >
                {syncingAll ? '⏳ Syncing All…' : '↻ Sync All'}
              </button>
            )}
          </div>
          {syncAllMsg && (
            <div style={{
              fontSize: 12,
              color: syncingAll ? 'var(--text-secondary)' : (syncAllMsg.startsWith('✅') ? 'var(--green)' : 'var(--red)'),
              marginBottom: 8,
            }}>
              {syncAllMsg}
            </div>
          )}
          {items.map(item => {
            const status = syncStatus[item.itemId] ?? 'idle';
            const msg    = syncMsg[item.itemId] ?? '';
            return (
              <div
                key={item.itemId}
                style={{
                  background: 'var(--bg-page)',
                  border: '1px solid var(--bg-raised)',
                  borderRadius: 10,
                  padding: '14px 16px',
                  marginBottom: 12,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: 14 }}>
                      🏦 {item.institutionName}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                      {item.accounts.map(a => `${a.name} (…${a.mask ?? ''})`).join(' · ')}
                    </div>
                    {item.lastSync && (
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                        Last synced: {item.lastSync}
                      </div>
                    )}
                  </div>
                  <button
                    className="btn btn-ghost btn-sm"
                    style={{ color: 'var(--text-muted)', fontSize: 11 }}
                    onClick={() => handleRemoveItem(item)}
                  >
                    ✕ Disconnect
                  </button>
                </div>

                <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                  <select
                    value={syncTimeframe[item.itemId] ?? 'cursor'}
                    disabled={status === 'syncing' || syncingAll}
                    onChange={e => setSyncTimeframe(s => ({ ...s, [item.itemId]: e.target.value }))}
                    style={{
                      background: 'var(--bg-raised)', color: 'var(--text-primary)',
                      border: '1px solid var(--border-default)', borderRadius: 6,
                      padding: '4px 8px', fontSize: 12, cursor: 'pointer',
                    }}
                  >
                    <option value="cursor">New only</option>
                    <option value="30d">Last 30 days</option>
                    <option value="90d">Last 90 days</option>
                    <option value="180d">Last 6 months</option>
                    <option value="1y">Last 1 year</option>
                  </select>
                  <button
                    className="btn btn-primary btn-sm"
                    disabled={status === 'syncing' || syncingAll}
                    onClick={() => {
                      const tf = syncTimeframe[item.itemId] ?? 'cursor';
                      if (tf === 'cursor') handleSync(item);
                      else handleFetchRange(item, tf);
                    }}
                  >
                    {status === 'syncing' ? '⏳ Syncing…' : '↻ Sync'}
                  </button>
                  {msg && (
                    <span style={{ fontSize: 12, color: status === 'error' ? 'var(--red)' : 'var(--green)' }}>
                      {msg}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Empty state ───────────────────────────────────────────────────── */}
      {hasCreds && items.length === 0 && !linkToken && (
        <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '16px 0' }}>
          No banks connected yet. Click "Connect Another Account" to link your first institution.
        </div>
      )}

      {/* ── Privacy note ──────────────────────────────────────────────────── */}
      {hasCreds && (
        <div style={{
          marginTop: 20,
          fontSize: 11,
          color: 'var(--text-muted)',
          borderTop: '1px solid var(--bg-raised)',
          paddingTop: 12,
          lineHeight: 1.6,
        }}>
          🔒 Your Plaid credentials and access tokens are stored encrypted in your operating
          system's credential manager (Windows Credential Manager / macOS Keychain), never in
          plaintext files and never uploaded to any server. Transactions are fetched directly
          from Plaid and written to your local data file. You can audit or revoke this app's
          access any time at my.plaid.com.
          {creds.env === 'sandbox' && (
            <span style={{ color: 'var(--amber)', marginLeft: 4 }}>
              ⚠ Sandbox mode — using test data only.
            </span>
          )}
        </div>
      )}
    </div>
  );
}
