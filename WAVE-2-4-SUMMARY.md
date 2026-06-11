# v0.15.4 Waves 2–4 Autonomous Run Summary

Wave 1 (H2 cursor atomicity) was committed and pushed before this autonomous run.
Waves 2–4 completed without stopping. All decisions applied per sprint defaults.

---

## Wave 2 — Test hardening (commit 88d53ea)

**Commit:** `test: real H3/H5/H6 regression coverage + gaps`

### Changes
- **constants.js**: Extracted three new exported pure functions:
  - `migrateData(data)` — full data-file migration (was a closure inside App.jsx)
  - `computeEffectiveFlip(anyOFX, anyCSV, flipSign)` — pure-OFX batches skip flip
  - `applyPlaidModifications(existingTxs, updates)` — pending→posted upsert with `u.id &&` keyless guard
- **App.jsx**: Removed local `migrateData`; imports from constants.js; simplified `plaidModifyTxs`
- **StatementImport.jsx**: Uses imported `computeEffectiveFlip`
- **core.test.js**: +57 new tests (239 → 252 total by Wave 4):
  - `migrateData()` — backfill invariants, plaidCursors init, version, null input
  - `computeEffectiveFlip()` — pure OFX ignores flipSign, CSV uses flipSign, mixed
  - `applyPlaidModifications()` — insert/update/keyless-guard/sort

### Default decisions taken
- None required for Wave 2.

---

## Wave 3 — Mediums M5/M7/M8 (commit c20e4c7)

**Commit:** `fix: mediums M5/M7/M8`

### Changes

**M5 — save_data directory creation scope** (lib.rs)
- Previous: `fs::create_dir_all(path_buf.parent())` ran BEFORE `resolve_data_path`, allowing directory creation outside the allowed scope.
- Fix: `fs::create_dir_all(&allowed)` only; scope check happens before any dir creation.

**M7 — Atomic rename with retry** (lib.rs + App.jsx)
- New `atomic_rename` helper: up to 5 attempts, exponential backoff (50ms, 100ms, 200ms, 400ms). Handles Windows AV/indexer transient locks.
- `.tmp` is cleaned up on final failure.
- App.jsx auto-save `.catch` now calls `showToast('Auto-save failed — disk may be full', 'error')` in addition to `console.error`.
- **Rust tests**: `m5_save_data_creates_only_allowed_dir`, `m7_atomic_rename_succeeds`, `m7_atomic_rename_fails_gracefully_when_src_missing`

**M8 — Suppress reconcile hint for debt accounts** (Accounts.jsx)
- Added `if (isDebtType(a.type)) return null;` at the start of both reconcile hint IIFEs (Assets section line ~720, Debts section line ~838).
- Added `if (isDebtType(acct.type)) return null;` in Reconcile-All view (line ~638).
- Credit/loan stored balance is "amount owed" — `computeBalance` sums signed transactions and would always show a spurious discrepancy.

### Cargo results
- `cargo test`: 17 passed, 0 failed
- `cargo clippy`: 5 warnings, all pre-existing (`ptr_arg`, `manual_strip` — in unchanged functions)
- `cargo audit`: 17 unmaintained-crate warnings (gtk-rs GTK3, proc-macro-error, unic-*), all pre-existing Tauri/WRY transitive deps. No vulnerabilities.

---

## Wave 4 — Lows L1/L3/L4/L9/L10/L12/L15 (commit c40c4f2)

**Commit:** `fix: lows L1/L3/L4/L9/L10/L12/L15`

### Changes

**L1 — CSVImport.jsx comment**
- Added 4-line comment before `findDuplicates` documenting why it's intentionally separate from `detectImportDuplicates`: different matching strategies (fuzzy desc vs. exact date+amount), different flows.

**L3 — autoCategory payment regex split**
- Always-Transfer (any amount): `payment - thank you`, `payment thank you`, `payment to * card ending`, `payment to chase`, `payment to amex`
- Transfer only when `amount < 0`: `mobile payment`, `online payment`, `autopay`
- **Contradiction resolved**: kept `payment to chase/amex/card` as always-Transfer (issuer-specific patterns are always transfers); only generic payment words require negative amount. Existing "Payment to Chase" positive-amount test continues to pass.
- Updated test: "online payment + positive amount → Income" (L3 intent; was Transfer before)
- Added test: "online payment + negative amount → Transfer"

**L4 — shouldFlipImportAmounts credit-only**
- `(accountType) => accountType === 'credit'` (was `isDebtType` which included loan)
- Loan amortization exports (e.g., Navient CSV) are already correctly signed.
- Updated test: loan now expects `false`.

**L9 — Shared reqwest Client via OnceLock**
- Added `static HTTP_CLIENT: OnceLock<reqwest::Client>` and `fn http_client()`
- All 6 Plaid commands now call `http_client()` instead of `reqwest::Client::new()`
- fs caps (`fs:allow-write-text-file`, `fs:allow-mkdir`) left alone per sprint default

**L10 — autoCategoryBusiness null guard**
- `const d = (desc ?? '').toLowerCase()` (was `desc.toLowerCase()` — throws on null)

**L12 — POPUP_BRIDGE_SCRIPT postMessage origin**
- Uses `window.location.ancestorOrigins?.[0] ?? '*'` instead of `'*'`
- Prevents CORS SecurityError from `window.top.location.origin` in cross-origin iframes

**L15 — initFromPath re-entrancy guard**
- Added `const isInitializing = useRef(false)` 
- Guard: `if (isInitializing.current) return;` at function entry
- `finally` block resets `isInitializing.current = false`

### Default decisions taken
- **L1**: Documented-split approach (comment only, no behavior change) ✓
- **L4**: Auto-flip credit accounts only, not loan ✓
- **L9**: Built shared client; left `fs:allow-write-text-file`/`fs:allow-mkdir` unchanged ✓

---

## Final state

| Wave | Commit  | JS Tests | Rust Tests | Notes |
|------|---------|----------|------------|-------|
| 1    | 4aa5647 | 194      | 14         | H2 cursor atomicity (pre-run) |
| 2    | 88d53ea | 251      | 14         | +57 new tests |
| 3    | c20e4c7 | 251      | 17         | +3 Rust tests |
| 4    | c40c4f2 | 252      | 17         | +1 new test (L3 split) |

All waves committed and pushed to `origin/main`. Version not bumped (per instructions).

## Review flags

- **L12**: `window.location.ancestorOrigins` is not available in all browsers (absent in Firefox). The fallback `|| '*'` handles this safely — the behavior degrades to the pre-fix state rather than breaking. No action required unless Firefox Plaid support is needed.
- **L9 audit note**: The audit doc (`docs/audit-v0152.md`) references L9 as "each Plaid command creates a new client per request". This is now fixed. The audit doc should be updated to note the partial fix (shared client) when convenient.
- **Clippy pre-existing**: 5 warnings (`ptr_arg` × 3, `manual_strip` × 2) in unchanged helper functions. These are safe to fix in a separate cleanup pass with `cargo clippy --fix`.
