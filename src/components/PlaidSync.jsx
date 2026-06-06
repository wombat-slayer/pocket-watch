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
} from '../plaidLayer.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function today() {
  return new Date().toISOString().slice(0, 10);
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

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

function PlaidLinkButton({ linkToken, receivedRedirectUri, onSuccess, onExit }) {
  const config = {
    token: linkToken,
    receivedRedirectUri: receivedRedirectUri || undefined,
    onSuccess: (public_token, metadata) => onSuccess(public_token, metadata),
    onExit: (err) => { if (err) console.error('Plaid exit:', err); onExit?.(); },
    // Diagnostic trail for OAuth handoff debugging (OPEN_OAUTH, HANDOFF, ERROR…)
    onEvent: (eventName, metadata) => {
      console.log('[plaid-link]', eventName, metadata?.view_name ?? '', metadata?.error_code ?? '');
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

export default function PlaidSync({ accounts, existingTxs, onImport, onToast }) {
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
  const [syncStatus, setSyncStatus] = useState({}); // { [itemId]: 'idle'|'syncing'|'done'|'error' }
  const [syncMsg,    setSyncMsg]    = useState({}); // { [itemId]: string }
  const warnedUnmatched = useRef(new Set());        // itemIds already warned about unmatched accounts

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
      // Fresh loopback listener for this Link session. The bank's OAuth page
      // opens in the system browser and redirects there on completion.
      await stopOauthServer();
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

      const token = await invoke('plaid_create_link_token', {
        clientId:    creds.clientId,
        secret:      creds.secret,
        env:         creds.env,
        userId:      'pocket-watch-user',
        redirectUri: redirectUriForPort(port),
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

  // ── Sync transactions for one item ────────────────────────────────────────
  const handleSync = async (item, daysBack = 30) => {
    setSyncStatus(s => ({ ...s, [item.itemId]: 'syncing' }));
    setSyncMsg(s => ({ ...s, [item.itemId]: '' }));

    try {
      const raw = await invoke('plaid_fetch_transactions', {
        clientId:    creds.clientId,
        secret:      creds.secret,
        env:         creds.env,
        accessToken: item.accessToken,
        startDate:   daysAgo(daysBack),
        endDate:     today(),
      });

      const payload = JSON.parse(raw);
      const plaidTxs = payload.transactions ?? [];

      // Build account id → PW account id map
      const accountMap = {};
      const unmatched  = [];
      for (const pa of item.accounts) {
        const match = accounts.find(a =>
          a.name?.toLowerCase().includes(pa.name?.toLowerCase()) ||
          a.name?.toLowerCase().includes(item.institutionName?.toLowerCase())
        );
        if (match) {
          accountMap[pa.id] = match.id;
        } else {
          accountMap[pa.id] = pa.id; // fallback — import with Plaid account id
          unmatched.push(`${pa.name}${pa.mask ? ` (…${pa.mask})` : ''}`);
        }
      }
      // One-time warning per institution: unmatched accounts import under the
      // raw Plaid account id and won't show up under any existing PW account.
      if (unmatched.length > 0 && !warnedUnmatched.current.has(item.itemId)) {
        warnedUnmatched.current.add(item.itemId);
        onToast?.(
          `No matching Pocket Watch account for ${unmatched.join(', ')} from ${item.institutionName}. ` +
          `Their transactions were imported under the raw Plaid account id. ` +
          `Rename your accounts to include "${item.institutionName}" (or the bank account name) so future syncs match.`,
          'warning'
        );
      }

      // Map and dedup
      const existingFitids = new Set(existingTxs.map(t => t.fitid).filter(Boolean));
      const existingIds    = new Set(existingTxs.map(t => t.id));

      const newTxs = plaidTxs
        .map(pt => mapPlaidTransaction(pt, accountMap))
        .filter(t => t !== null)
        .filter(t => !existingFitids.has(t.fitid) && !existingIds.has(t.id));

      if (newTxs.length > 0) {
        onImport(newTxs);
      }

      const now = today();
      await updateLinkedItem(item.itemId, { lastSync: now });
      setItems(prev => prev.map(i => i.itemId === item.itemId ? { ...i, lastSync: now } : i));

      setSyncStatus(s => ({ ...s, [item.itemId]: 'done' }));
      setSyncMsg(s => ({
        ...s,
        [item.itemId]: newTxs.length > 0
          ? `✅ Imported ${newTxs.length} new transaction${newTxs.length !== 1 ? 's' : ''}.`
          : '✅ All up to date — no new transactions.',
      }));
    } catch (e) {
      setSyncStatus(s => ({ ...s, [item.itemId]: 'error' }));
      setSyncMsg(s => ({ ...s, [item.itemId]: '❌ ' + String(e) }));
    }
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

  return (
    <div>
      {/* ── Credentials section ───────────────────────────────────────────── */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <span style={{ fontSize: 13, color: '#94a3b8', fontWeight: 600 }}>Plaid API Credentials</span>
          {hasCreds && !credEditing && (
            <button className="btn btn-ghost btn-sm" onClick={() => setCredEditing(true)}>Edit</button>
          )}
          {hasCreds && (
            <button className="btn btn-ghost btn-sm" style={{ color: '#c2735a' }} onClick={handleClearCreds}>
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
            {credSaved && <span style={{ color: '#4ade80', fontSize: 12 }}>✅ Saved.</span>}
          </div>
        ) : (
          <div style={{ fontSize: 12, color: '#475569', fontFamily: 'monospace' }}>
            Environment: <span style={{ color: '#7fa88b' }}>{creds.env}</span>
            &nbsp;·&nbsp;
            Client ID: <span style={{ color: '#7fa88b' }}>{creds.clientId.slice(0, 8)}…</span>
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
            <p style={{ color: '#c2735a', fontSize: 12, marginTop: 8 }}>❌ {linkError}</p>
          )}
        </div>
      )}

      {/* ── Connected items ───────────────────────────────────────────────── */}
      {items.length > 0 && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <span style={{ fontSize: 13, color: '#94a3b8', fontWeight: 600 }}>
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
          </div>
          {items.map(item => {
            const status = syncStatus[item.itemId] ?? 'idle';
            const msg    = syncMsg[item.itemId] ?? '';
            return (
              <div
                key={item.itemId}
                style={{
                  background: '#0d1117',
                  border: '1px solid #1e2736',
                  borderRadius: 10,
                  padding: '14px 16px',
                  marginBottom: 12,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontWeight: 700, color: '#e2e8f0', fontSize: 14 }}>
                      🏦 {item.institutionName}
                    </div>
                    <div style={{ fontSize: 11, color: '#475569', marginTop: 2 }}>
                      {item.accounts.map(a => `${a.name} (…${a.mask ?? ''})`).join(' · ')}
                    </div>
                    {item.lastSync && (
                      <div style={{ fontSize: 11, color: '#334155', marginTop: 2 }}>
                        Last synced: {item.lastSync}
                      </div>
                    )}
                  </div>
                  <button
                    className="btn btn-ghost btn-sm"
                    style={{ color: '#475569', fontSize: 11 }}
                    onClick={() => handleRemoveItem(item)}
                  >
                    ✕ Disconnect
                  </button>
                </div>

                <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                  <button
                    className="btn btn-primary btn-sm"
                    disabled={status === 'syncing'}
                    onClick={() => handleSync(item, 30)}
                  >
                    {status === 'syncing' ? '⏳ Syncing…' : '↻ Sync Last 30 Days'}
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    disabled={status === 'syncing'}
                    onClick={() => handleSync(item, 90)}
                  >
                    90 days
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    disabled={status === 'syncing'}
                    onClick={() => handleSync(item, 365)}
                  >
                    1 year
                  </button>
                  {msg && (
                    <span style={{ fontSize: 12, color: status === 'error' ? '#c2735a' : '#4ade80' }}>
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
        <div style={{ fontSize: 13, color: '#334155', padding: '16px 0' }}>
          No banks connected yet. Click "Connect Another Account" to link your first institution.
        </div>
      )}

      {/* ── Privacy note ──────────────────────────────────────────────────── */}
      {hasCreds && (
        <div style={{
          marginTop: 20,
          fontSize: 11,
          color: '#334155',
          borderTop: '1px solid #1e2736',
          paddingTop: 12,
          lineHeight: 1.6,
        }}>
          🔒 Your Plaid credentials and access tokens are stored encrypted in your operating
          system's credential manager (Windows Credential Manager / macOS Keychain), never in
          plaintext files and never uploaded to any server. Transactions are fetched directly
          from Plaid and written to your local data file. You can audit or revoke this app's
          access any time at my.plaid.com.
          {creds.env === 'sandbox' && (
            <span style={{ color: '#f59e0b', marginLeft: 4 }}>
              ⚠ Sandbox mode — using test data only.
            </span>
          )}
        </div>
      )}
    </div>
  );
}
