# Backlog

Items too small for a sprint ticket but worth tracking. Severity: Critical / High / Medium / Low.

---

## Low

### Reconcile hint misfires on debt accounts (M8 — cosmetic)

**File:** `src/components/Accounts.jsx` — lines 720, 837, 639

**Context:** `computeBalance` sums signed transaction amounts (charges are negative), while `a.balance` stores debt as a positive value (net worth = assets − debts). For any credit or loan account the two will always differ, so the amber "tx total differs — reconcile" hint fires permanently. No balance is ever wrong — the displayed balance is always `a.balance`, which is correct.

**Fix direction:** Before showing the reconcile hint, skip debt accounts (`isDebtType(a.type)`) or apply the sign flip so the comparison uses the same convention.

**Introduced:** present since reconcile hint was added; identified in v0.15.2 audit.

---

### `postMessage` send-side uses `'*'` origin (L12 — defense-in-depth)

**File:** `src-tauri/src/lib.rs` — line 555 (popup-bridge script injected into the OAuth popup)

**Context:** The injected script sends `postMessage({…, url}, '*')`. The payload contains only a flag and the Plaid OAuth redirect URL (non-secret). The receiver in `PlaidSync.jsx:169` validates the origin. The `'*'` on the send side is a defense-in-depth gap, not an exploitable leak.

**Fix direction:** Restrict to `window.opener.location.origin` (or the known Tauri custom-protocol origin) on the send side.

**Target:** v0.15.4

---

### Two divergent duplicate-detection engines (L1)

**File:** `src/components/CSVImport.jsx:59-79` (`findDuplicates`) vs `src/constants.js` (`detectImportDuplicates`)

**Context:** The Transactions-page generic CSV importer (`CSVImport.jsx`) uses a description token-overlap heuristic (60% overlap within 2 days). The per-account Statement importer (`StatementImport.jsx`) uses the date+amount keyed `detectImportDuplicates`. Users see different dedup behavior depending on which importer they open. The v0.15.2 prompt described the description matcher as removed, but it persists on the CSVImport path.

**Fix direction:** Consolidate CSVImport.jsx onto `detectImportDuplicates`, or explicitly document the split (CSVImport has no account context so description overlap may be the right fallback there).

---

## Medium

### Per-file flip in mixed OFX+CSV import batches

**File:** `src/components/StatementImport.jsx` — `handleFiles`

**Context:** The current `effectiveFlip` logic uses a single batch-wide flag: if any CSV file is present (`anyCSV=true`), `effectiveFlip` falls back to `flipSign`, and that flip is applied uniformly to every row in the batch — including OFX/QFX rows whose amounts are already correctly signed per the OFX spec.

**Impact:** Users who drop a mix of OFX and CSV files in one import batch on a credit/loan account will get OFX rows incorrectly sign-flipped. Uncommon in practice (most users import one format at a time), but silently wrong when it happens.

**Fix direction:** Track format per parsed row (e.g., add a `_format: 'ofx' | 'csv'` annotation during parse), then apply flip only to rows where `_format === 'csv'` and `effectiveFlip` is true. Strip the annotation before saving.

**Introduced:** v0.15.2 (H5 OFX double-flip fix)

---

### save_receipt parent-dir canonicalization (H4 optional hardening)

**File:** `src-tauri/src/lib.rs` — `save_receipt`

**Context:** `save_receipt` can't canonicalize the full path because the file doesn't exist yet. It relies on the extension allowlist + filename traversal check + DataDirState scope check. This is acceptable for now.

**Optional hardening:** After `receipts_dir` is created via `fs::create_dir_all`, canonicalize the receipts dir itself and verify the joined path's parent equals it. Catches any traversal the filename validator might miss without requiring the file to exist first.

```rust
let dir = receipts_dir(&allowed);
fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
let canonical_dir = friendly_canonical(&dir)?;
let full_path = dir.join(&filename);
if full_path.parent().map(|p| friendly_canonical(p).ok()).flatten() != Some(canonical_dir) {
    return Err("Receipt path resolves outside receipts directory".to_string());
}
```

---

### Plaid cursor atomicity (H2)

**File:** `src/components/PlaidSync.jsx` — `syncItem`

**Context:** `setCursor` is now saved after `onImport` (v0.15.3 H2 fix), which prevents the cursor advancing before processing starts. However, `onImport` only enqueues an in-memory state update (App.jsx 600ms debounced save). A crash between `setCursor` returning and the debounce flushing to disk still leaves the cursor advanced but the transactions not persisted.

**Fix direction:** Store the Plaid cursor inside the main data file as `account.plaidCursor`, so it is written atomically with the transactions in the same `save_data` call. This eliminates the debounce window entirely.
