import { useState, useEffect, useCallback } from 'react';
import { usePlaidLink } from 'react-plaid-link';
import { invoke } from '@tauri-apps/api/core';
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

// ── PlaidLink wrapper (rendered when we have a link_token) ───────────────────

function PlaidLinkButton({ linkToken, onSuccess, onExit }) {
  const config = {
    token: linkToken,
    onSuccess: (public_token, metadata) => onSuccess(public_token, metadata),
    onExit: (err) => { if (err) console.error('Plaid exit:', err); onExit?.(); },
  };
  const { open, ready } = usePlaidLink(config);
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

export default function PlaidSync({ accounts, existingTxs, onImport }) {
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

  // ── Sync state ─────────────────────────────────────────────────────────────
  const [syncStatus, setSyncStatus] = useState({}); // { [itemId]: 'idle'|'syncing'|'done'|'error' }
  const [syncMsg,    setSyncMsg]    = useState({}); // { [itemId]: string }

  // ── Load saved state on mount ──────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      const saved = await getPlaidCredentials();
      setCreds(saved);
      setCredInput(saved);
      setCredEditing(!saved.clientId); // show form if no creds yet
      const savedItems = await getLinkedItems();
      setItems(savedItems);
    })();
  }, []);

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
    if (!confirm('Remove Plaid credentials and disconnect all linked accounts?')) return;
    await clearPlaidCredentials();
    for (const item of items) await removeLinkedItem(item.itemId);
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
      const token = await invoke('plaid_create_link_token', {
        clientId: creds.clientId,
        secret:   creds.secret,
        env:      creds.env,
        userId:   'pocket-watch-user',
      });
      setLinkToken(token);
    } catch (e) {
      setLinkError(String(e));
    } finally {
      setLinking(false);
    }
  };

  // ── Handle successful Link flow ────────────────────────────────────────────
  const handleLinkSuccess = useCallback(async (publicToken, metadata) => {
    setLinkToken(null);
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
      for (const pa of item.accounts) {
        const match = accounts.find(a =>
          a.name?.toLowerCase().includes(pa.name?.toLowerCase()) ||
          a.name?.toLowerCase().includes(item.institutionName?.toLowerCase())
        );
        if (match) accountMap[pa.id] = match.id;
        else accountMap[pa.id] = pa.id; // fallback — import with Plaid account id
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
  const handleRemoveItem = async (itemId) => {
    if (!confirm('Disconnect this bank? Transactions already imported will remain.')) return;
    await removeLinkedItem(itemId);
    setItems(prev => prev.filter(i => i.itemId !== itemId));
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
              linkToken={linkToken}
              onSuccess={handleLinkSuccess}
              onExit={() => setLinkToken(null)}
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
          <div style={{ fontSize: 13, color: '#94a3b8', fontWeight: 600, marginBottom: 10 }}>
            Connected Institutions
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
                    onClick={() => handleRemoveItem(item.itemId)}
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
          🔒 Your Plaid access tokens are stored only on this device, never uploaded to any server.
          Transactions are fetched directly from Plaid and written to your local data file.
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
