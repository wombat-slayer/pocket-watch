# Security Audit — v0.15.2 Remediation Tracker

Audit run on the v0.15.2 tag. 42 findings total: 3 Critical, 11 High, 16 Medium, 12 Low.
This document tracks remediation status. Findings not listed here are addressed in the
sprint commit messages or are acknowledged as accepted risk for the local-only desktop
threat model.

---

## Key findings — v0.15.3 sprint

| ID  | Severity | Summary                                   | Status                    | Fixed in          |
|-----|----------|-------------------------------------------|---------------------------|-------------------|
| H1  | High     | UTC date helpers off-by-one after ~8pm ET | **Fixed**                 | Wave 2 (v0.15.3)  |
| H2  | High     | Plaid cursor saves before disk flush      | **Partial / Deferred**    | Wave 2 (v0.15.3)  |
| H3  | High     | autoCategory receives pre-flip amount     | **Fixed**                 | Wave 1 (v0.15.3)  |
| H4  | High     | Receipt commands bypass DataDirState      | **Fixed**                 | Wave 2 (v0.15.3)  |
| H5  | High     | OFX double-flip on credit import          | **Fixed**                 | Wave 1 (v0.15.3)  |
| H6  | High     | Plaid pending→posted tx silently dropped  | **Fixed**                 | Wave 1 (v0.15.3)  |
| M2  | Medium   | Dupe detection all-or-nothing, no visibility | **Fixed**              | Wave 3 (v0.15.3)  |
| M3  | Medium   | Dupe flags stale when flipSign toggles    | **Fixed**                 | Wave 3 (v0.15.3)  |
| M6  | Medium   | autoCategory rule shadowing (Insurance/Shopping/Housing) | **Fixed** | Wave 3 (v0.15.3) |
| M9  | Medium   | Recurring month-end overflow (Jan 31+1mo→Mar 3) | **Fixed**          | Wave 3 (v0.15.3)  |
| M10 | Medium   | Plaid stale existingTxs across multi-item sync | **Fixed**            | Wave 3 (v0.15.3)  |
| M14 | Medium   | Finnhub key in rotation backups           | **Fixed**                 | Wave 3 (v0.15.3)  |
| L7  | Low      | Tray-quit flush (edit in 600ms debounce lost) | **Fixed**             | Wave 3 (v0.15.3)  |
| L14 | Low      | NW backfill includes adjustment rows      | **Fixed**                 | Wave 3 (v0.15.3)  |

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
