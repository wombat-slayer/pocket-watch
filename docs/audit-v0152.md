# Security Audit — v0.15.2 Remediation Tracker

Audit run on the v0.15.2 tag. Locked finding count (union of both audits):
Critical 0 · High 6 · Medium 9 · Low 22. Plus 8 test-coverage gaps.

Reconciliation note: findings are anchored by title/file:line, not by L-number.
The two reviewers' Low numbering did not align positionally (e.g. reviewer-2's L-9 =
our L5; our L9 is a different finding). Do not match by number alone.

---

## Key findings — v0.15.3 sprint

| ID  | Severity | Summary                                         | Status                 | Fixed in            |
|-----|-----------|-------------------------------------------------|------------------------|---------------------|
| H1  | High      | UTC date helpers off-by-one after ~8pm ET       | **Fixed**              | Wave 2 (v0.15.3)    |
| H2  | High      | Plaid cursor saves before disk flush            | **Partial / Deferred** | Wave 2 (v0.15.3)    |
| H3  | High      | autoCategory receives pre-flip amount           | **Fixed**              | Wave 1 (v0.15.3)    |
| H4  | High      | Receipt commands bypass DataDirState            | **Fixed**              | Wave 2 (v0.15.3)    |
| H5  | High      | OFX double-flip on credit import                | **Fixed**              | Wave 1 (v0.15.3)    |
| H6  | High      | Plaid pending→posted tx silently dropped        | **Fixed**              | Wave 1 (v0.15.3)    |
| M1  | Medium    | parseAmount / computeBalance float precision    | **Fixed**              | Wave 5 (v0.15.3)    |
| M2  | Medium    | Dupe detection all-or-nothing, no visibility    | **Fixed**              | Wave 3 (v0.15.3)    |
| M3  | Medium    | Dupe flags stale when flipSign toggles          | **Fixed**              | Wave 3 (v0.15.3)    |
| M6  | Medium    | autoCategory rule shadowing                     | **Fixed**              | Wave 3 (v0.15.3)    |
| M7  | Medium    | Windows atomic-rename failure swallowed         | **Accepted**           | L18 ordering (Wave 4); save_data propagates errors; rotate_backups swallows intentionally |
| M8  | Medium    | computeBalance sign mismatch on debt accounts   | **INVALID / BACKLOG**  | Not a balance bug — cosmetic reconcile hint only; see BACKLOG.md |
| M9  | Medium    | Recurring month-end overflow (Jan 31+1mo→Mar 3) | **Fixed**              | Wave 3 (v0.15.3)    |
| M10 | Medium    | Plaid stale existingTxs across multi-item sync  | **Fixed**              | Wave 3 (v0.15.3)    |
| M14 | Medium    | Finnhub key in rotation backups                 | **Fixed**              | Wave 3 (v0.15.3)    |
| L7  | Low       | Tray-quit flush (edit in 600ms debounce lost)   | **Fixed**              | Wave 3 (v0.15.3)    |
| L12 | Low       | postMessage send-side uses `'*'` origin         | **Accepted / BACKLOG** | Valid, non-secret payload; receiver validates origin; tighten in v0.15.4 |
| L14 | Low       | NW backfill includes adjustment rows            | **Fixed**              | Wave 3 (v0.15.3)    |

---

## H2 — Partial / Deferred detail

**Finding:** Plaid cursor was saved before processing the synced transactions, so a crash
between sync and processing silently advanced the cursor and permanently lost those
transactions.

**Wave 2 fix:** Cursor is now saved AFTER `onImport(markedNewTxs)` returns. This closes
the "cursor advances before processing starts" case.

**Remaining gap:** `onImport` only enqueues a React state update (600ms debounced save to
disk). A crash between `setCursor` returning and the debounce flushing still leaves the
cursor advanced but the transactions not on disk. This is not "fixed" — it is an improvement
with a documented residual window.

**Full fix deferred:** Store the Plaid cursor inside the main data file (`account.plaidCursor`),
written atomically with the transactions in the same `save_data` call. See BACKLOG.md for
the tracked item.

**Do not mark H2 as fully fixed in future audits until the atomic cursor write is shipped.**

---

## Wave 4 Lows (v0.15.3)

Wave 4 addresses L2, L5/L9, L6, L8, L13, L18, L19, L20, L21, L22 plus test-coverage gaps.
See the Wave 4 commit for details.

---

## Full Low disposition (v0.15.3)

| Finding (by title/anchor)                                   | Status           | Wave   |
|-------------------------------------------------------------|------------------|--------|
| Transfer pair window comment "3 days" vs `> 4` code (L2)   | Fixed            | 4      |
| autoCategory null-desc test gap (L3/test-gap)               | Fixed            | 3/4    |
| Recur-overflow test asserted wrong value (L4/test-gap)      | Fixed            | 3      |
| mutex .unwrap() panics on poison — set_allowed_data_dir (L5)| Fixed            | 4      |
| PDF export interpolates category names unescaped (L6)       | Fixed            | 4      |
| Tray-quit 600ms debounce flush (L7)                         | Fixed            | 3      |
| CLAUDE.md data-model version "v4" (L8)                      | Fixed            | 4      |
| mutex .unwrap() — load_data / save_data / data_file_exists (L9) | Fixed        | 4      |
| Unguarded desc.replace/toLowerCase in autoCategory (L10)    | Fixed            | 3      |
| Rotation backups retain Finnhub key (L11 = M14)             | Fixed            | 3      |
| postMessage send-side `'*'` origin (L12)                    | Accepted/BACKLOG | —      |
| Plaid env not allowlisted (L13)                             | Fixed            | 4      |
| NW backfill includes adjustment transactions (L14)          | Fixed            | 3      |
| initFromPath no re-entrancy guard (L15)                     | Not addressed    | —      |
| StatementImport/CSVImport divergent dedup engines (L1/L16)  | BACKLOG          | —      |
| Informational: undo stale-closure, memory growth, Plaid refetch (L17) | Acknowledged | —  |
| Backup rotation write ordering (L18)                        | Fixed            | 4      |
| sanitizeText doesn't decode HTML entities (L19)             | Partial/comment  | 4      |
| aplpay strip misses no-space variant (L20)                  | Fixed            | 3      |
| Math.abs in budget calcs masks sign errors (L21)            | Fixed            | 4      |
| Dead acctEmoji import (L22)                                 | Fixed            | 4      |

Test-coverage gaps: L-3 null-desc (fixed Wave 3/4), L-4 recur-overflow (fixed Wave 3),
L-5 migrateData untested (not addressed), L-6 dupes-step component test (not addressed).
