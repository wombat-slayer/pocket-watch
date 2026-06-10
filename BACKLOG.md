# Backlog

Items too small for a sprint ticket but worth tracking. Severity: Critical / High / Medium / Low.

---

## Medium

### Per-file flip in mixed OFX+CSV import batches

**File:** `src/components/StatementImport.jsx` — `handleFiles`

**Context:** The current `effectiveFlip` logic uses a single batch-wide flag: if any CSV file is present (`anyCSV=true`), `effectiveFlip` falls back to `flipSign`, and that flip is applied uniformly to every row in the batch — including OFX/QFX rows whose amounts are already correctly signed per the OFX spec.

**Impact:** Users who drop a mix of OFX and CSV files in one import batch on a credit/loan account will get OFX rows incorrectly sign-flipped. Uncommon in practice (most users import one format at a time), but silently wrong when it happens.

**Fix direction:** Track format per parsed row (e.g., add a `_format: 'ofx' | 'csv'` annotation during parse), then apply flip only to rows where `_format === 'csv'` and `effectiveFlip` is true. Strip the annotation before saving.

**Introduced:** v0.15.2 (H5 OFX double-flip fix)

---

### Plaid cursor atomicity (H2)

**File:** `src/components/PlaidSync.jsx` — `syncItem`

**Context:** `setCursor` is now saved after `onImport` (v0.15.3 H2 fix), which prevents losing transactions on a mid-sync crash. However, there is still a window: if the app crashes between `onImport` and `setCursor`, the next sync will re-fetch and re-import the same transactions (benign duplicates if `detectImportDuplicates` is applied, but currently it's not applied to the Plaid path).

**Fix direction:** Store the Plaid cursor inside the main data file as `account.plaidCursor`, so it is written atomically with the transactions in the same `save_data` call. This eliminates both the window and the separate `plaid.json` store dependency for cursors.
