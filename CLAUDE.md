# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Pocket Watch — a local-first personal finance desktop app. React 19 + Vite 7 frontend inside a Tauri 2.x (Rust) shell. No server: all data lives in a single JSON file on the user's machine. Package manager is **pnpm**.

## Commands

```sh
pnpm install            # pnpm-workspace.yaml must keep `packages: ['.']` — CI install fails without it
pnpm tauri dev          # run the full desktop app (frontend + Rust shell)
pnpm dev                # Vite dev server only (Tauri IPC calls will fail — limited usefulness)
pnpm build              # vite build (frontend only)
pnpm tauri build        # full installer build
pnpm test               # vitest run (all tests)
pnpm test:watch         # vitest watch mode
pnpm vitest run -t "name"                    # single test by name
pnpm vitest run src/__tests__/core.test.js   # single test file
```

Tests live in `src/__tests__/` (node environment, globals on) and cover the pure utilities in `src/constants.js`. There is no linter configured.

## Architecture

### State and persistence flow

`src/App.jsx` is the hub — there is no state library or router. It holds every data slice as separate `useState` (transactions, accounts, budgets, goals, recurrences, userCategories, netWorthHistory, budgetTemplates, archivedTransactions, …), passes them with handlers down to page components, and switches pages via a `page` string state.

Persistence chain:
1. A `useEffect` in App.jsx watches all state slices and auto-saves with a **600ms debounce**.
2. `src/dataLayer.js` remembers the user-chosen data-file path in a `config.json` Tauri store, then calls Rust commands via `invoke()`.
3. `src-tauri/src/lib.rs` implements `load_data` / `save_data` / `data_file_exists` / `get_default_data_path`. Paths are validated (absolute, no `..`, must end in `.json`).
4. On load, App.jsx runs `migrateData` (data model is versioned, currently v4) and writes a `.backup.json` alongside the data file.

Undo/redo is a 40-level snapshot stack in `useRef` covering transactions/accounts/budgets/goals.

The window close button **hides to tray** instead of exiting (`on_window_event` in lib.rs); the tray icon restores it.

### Plaid bank sync (no backend)

The app talks to the Plaid API directly from Rust — `plaid_create_link_token`, `plaid_exchange_token`, `plaid_fetch_transactions`, `plaid_remove_item` in lib.rs use reqwest against sandbox/development/production base URLs. Secrets (Plaid client_id/secret and per-item access tokens) are stored in the OS credential manager via the `keyring` crate (`secret_set`/`secret_get`/`secret_delete` commands); only non-secret metadata lives in the `plaid.json` Tauri store. `src/plaidLayer.js` wraps both and silently migrates legacy plaintext secrets out of `plaid.json`. Disconnecting an institution must call `plaid_remove_item` (Plaid bills an item until `/item/remove` succeeds). UI is `src/components/PlaidSync.jsx` with `react-plaid-link`.

### Frontend conventions

- Pages are flat in `src/components/` (Dashboard, Transactions, Accounts, Budgets, Goals, Recurring, Reports, Settings, plus `Equity.jsx` = the Investments nav page and `Calendar.jsx` = the Cashflow nav page).
- `src/constants.js` is the shared utility module: categories, formatters, CSV parsing, `monthlyEquivalent`, `computeBalance`, `getNextRecurDate`, etc. Add cross-page helpers here, not in components.
- `useCategoryMemory(transactions)` — the transactions array argument is required.
- `useChart.js` lazy-loads Chart.js with a `let cancelled = false` cancellation guard; follow that pattern for new charts.
- `useMarketData.js` fetches quotes: Finnhub for stocks (needs user API key, stored in app state `apiKeys.finnhub`), CoinGecko for crypto (no key).
- Statement import (CSV/OFX/QFX) lives inside Accounts.jsx as a per-account modal; the generic CSV import on the Transactions page is `CSVImport.jsx`.

## Releases / CI

`.github/workflows/release.yml` builds installers on tag push (`v*.*.*`) across macOS (arm64 + x64), Ubuntu, Windows via `tauri-apps/tauri-action`.

- `pnpm-workspace.yaml` must keep `packages: ['.']` or pnpm install fails in CI.
- The Ubuntu job needs `libdbus-1-dev` in its apt deps (keyring crate / Secret Service backend).
- Auto-updater (`tauri-plugin-updater`) config lives in the `plugins` block of `src-tauri/tauri.conf.json` (Tauri 2.x requirement — not the `app` block); endpoint is the `latest.json` asset on the latest GitHub release. Signing key secrets: `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
- After pushing a tag, wait for **all** matrix jobs to finish, then publish the **tauri-action draft release** (has the installers + `latest.json`) — not the auto-generated source-only release GitHub creates for the tag.
