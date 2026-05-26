# Pocket Watch — Claude Context Document
*Last updated: May 25, 2026*

---

## Project Overview

**Pocket Watch** is a local-first personal finance desktop app built with:
- **Frontend**: React 19 + Vite 7 + Chart.js
- **Backend/Shell**: Tauri 2.x (Rust)
- **Package manager**: pnpm 9
- **Data storage**: Single JSON file on user's machine (no cloud, no server)
- **Auto-save**: 600ms debounce after any state change
- **Backup**: `.backup.json` written alongside data file on every app load

**Repository**: `https://github.com/wombat-slayer/pocket-watch`
**User**: Noah Miller — nhm6499@gmail.com
**Project path**: `C:\Dev\pocket-watch`
**Latest release**: v0.1.3 (published on GitHub, live)

---

## Tech Stack Details

### Tauri 2.x Plugins in use
- `tauri-plugin-store` — KV store for data path preference
- `tauri-plugin-dialog` — file open/save dialogs
- `tauri-plugin-fs` — file system read/write
- `tauri-plugin-opener` — open URLs in browser
- `tauri-plugin-updater` — auto-update via GitHub releases

### Auto-updater configuration
- Endpoint: `https://github.com/wombat-slayer/pocket-watch/releases/latest/download/latest.json`
- Signing key: stored in `C:\Users\Noah Miller\.tauri\pocket-watch.key`
- Public key: stored in `src-tauri/tauri.conf.json` under `plugins.updater.pubkey`
- GitHub secrets set: `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
- Updater config lives in `plugins` block (NOT `app` block) — Tauri 2.x requirement
- After install, app shows "restart to complete" message (no plugin-process dependency)

### GitHub Actions release workflow
- File: `.github/workflows/release.yml`
- Trigger: push of tag matching `v*.*.*`
- Matrix: macos-latest (aarch64), macos-latest (x86_64), ubuntu-22.04, windows-latest
- Uses: `actions/checkout@v4`, `actions/setup-node@v4`, `pnpm/action-setup@v3` (NOT v4 — v4 breaks workspace detection), `dtolnay/rust-toolchain@stable`, `tauri-apps/tauri-action@v0`
- Known issue fixed: `pnpm-workspace.yaml` must have `packages: ['.']` field or pnpm install fails in CI

### pnpm-workspace.yaml (critical)
```yaml
packages:
  - '.'
allowBuilds:
  esbuild: true
```

---

## Source File Map

```
src/
  App.jsx                    — Root: state, handlers, nav, sidebar, modals
  App.css                    — Global styles
  constants.js               — Categories, account types, helpers, formatters, CSV utils
  seed.js                    — Demo/seed data
  dataLayer.js               — File I/O via Tauri (load/save/path management)
  
  components/
    Dashboard.jsx            — Main dashboard: charts, spending insights, net worth
    Transactions.jsx         — Transaction list, inline edit, bulk delete, CSV import
    Budgets.jsx              — Budget management, templates, annual view, rollover
    Accounts.jsx             — Accounts, net worth chart, reconcile, statement import, holdings
    Goals.jsx                — Savings goals linked to accounts
    Recurring.jsx            — Recurring transaction rules
    Reports.jsx              — Spending reports, export, category drill-down
    Settings.jsx             — Data management, updater, custom categories, danger zone
    QuickAddBar.jsx          — NEW: Natural language quick transaction input in sidebar
    StatementImport.jsx      — NEW: Account-native CSV/OFX/QFX statement import
    CSVImport.jsx            — Generic CSV import (used from Transactions page)
    TransactionForm.jsx      — Full transaction add/edit form
    TransferForm.jsx         — Account-to-account transfer form
    AdjustmentForm.jsx       — Manual balance adjustment form
    Modal.jsx                — Generic modal wrapper
    CommandPalette.jsx       — Ctrl+K search palette
    MonthClose.jsx           — Month-end close wizard
    OnboardingWizard.jsx     — First-run account/budget setup
    Calendar.jsx             — Calendar view (removed from nav, file kept)

  hooks/
    useCategoryMemory.js     — Learns category from past transactions, suggest(desc) → category
                               REQUIRES transactions array as argument
    useChart.js              — Chart.js lazy loader with cancellation flag

  [Equity.jsx removed from nav and imports — file exists but is dead code]
```

---

## Current Navigation (8 items)
1. Dashboard (key: 1)
2. Transactions (key: 2)
3. Accounts (key: 3)
4. Budgets (key: 4)
5. Goals (key: 5)
6. Recurring (key: 6)
7. Reports (key: 7)
8. Settings (key: 8)

Removed from nav: Equity (scrapped this session), Calendar (kept file, removed from nav)

---

## Data Model (v4)

```js
{
  version: 4,
  transactions: [{
    id, date, description, amount, category, account,
    type,           // 'income' | 'expense' | 'adjustment'
    notes, tags,    // tags: string[]
    cleared,        // boolean
    recurringId,    // optional
    transferId,     // optional
    transferDirection, splits, _seeded
  }],
  accounts: [{
    id, name, type, balance,
    holdings: [],   // NEW in v4 — investment account positions
    lastStatementDate,
    _seeded
  }],
  budgets: [{ id, month, category, amount, rollover, _seeded }],
  goals: [{ id, name, target, current, deadline, linkedAccountId, _seeded }],
  recurrences: [{ id, description, amount, category, account, type, frequency, startDate, lastGenerated, active, notes }],
  grants: [],        // kept for backwards compat, UI removed
  userCategories: [{ name, icon, color }],
  netWorthHistory: [{ id, date, netWorth, assets, debts }],
  budgetTemplates: [{ name, budgets: [], autoApply: bool }],
  onboardingComplete: bool
}
```

### Holdings model (per investment account)
```js
holdings: [{
  id, ticker, shares, costBasis, currentPrice
}]
```

### migrateData versioning
- v1→v2: backfilled transaction fields (tags, cleared, type, etc.)
- v2→v3: backfilled budget rollover, goal linkedAccountId
- v3→v4 (current): backfilled `holdings: []` on all accounts

---

## Key Architectural Decisions

**Local-first**: All data in one JSON file. No accounts, no login, no server.
**Auto-save**: 600ms debounce in App.jsx useEffect watching all state slices.
**Undo/redo**: 40-level stack in useRef, snapshots transactions/accounts/budgets/goals.
**Category memory**: `useCategoryMemory(transactions)` — must pass transactions array.
**Chart loading**: Lazy dynamic import with `let cancelled = false` cancellation guard.
**monthlyEquivalent**: Centralized in constants.js — used by Dashboard, Accounts, Recurring.
**Statement import**: Lives inside Accounts.jsx as a per-account modal (not a separate page).
**Holdings**: Stored directly on account object, edited via `onEdit(updatedAccount)`.

---

## Sidebar Footer Layout (QuickAddBar)
- `QuickAddBar` component receives `accounts`, `transactions`, `onAdd`, `onOpenFull`
- Uses `useCategoryMemory(transactions)` — transactions prop is required (defaults to [])
- Natural language parser: extracts amount token, remainder is description, income keywords flip sign
- Three compact secondary action buttons: Transfer, Balance, Close
- Two utility buttons: ⌘K (palette), ⌨️ ? (shortcuts), + conditional Undo

---

## Known File Truncation Issue
The Edit/Write tools frequently produce null byte padding or truncate file tails on large files.
**Detection**: Babel syntax check via `/tmp/parsecheck/index.cjs` (installed in sandbox).
**Fix pattern**:
1. Strip nulls: `data.rstrip(b'\x00')` via Python binary read/write
2. Tail truncation: `data.rfind(marker)` then append correct tail as encoded bytes

**Syntax check command** (run from bash sandbox):
```bash
python3 -c "
import subprocess, os
files = ['src/App.jsx', 'src/constants.js', ...]  # list all files
base = '/sessions/.../mnt/pocket-watch'
for rel in files:
    r = subprocess.run(['node', '/tmp/parsecheck/index.cjs', os.path.join(base, rel)], capture_output=True, text=True)
    print(('PASS' if r.returncode==0 else 'FAIL') + ': ' + rel)
"
```
Parser lives at `/tmp/parsecheck/` with its own `package.json` (not inside the project, avoids ESM conflict).

---

## Completed Feature Sprints (this session)

| Sprint | Feature | Status |
|--------|---------|--------|
| A | QuickAdd natural language input | ✅ |
| B | Account-native statement import (CSV/OFX/QFX) | ✅ |
| C | Equity scrapped, Investment holdings panel | ✅ |
| D | Nav from 10→8 items, sidebar redesign | ✅ |

---

## Pending / Roadmap Items

### Near-term (next session)
- [ ] Empty states with CTAs and guidance copy on all pages
- [ ] Transaction entry UX polish (tab order, auto-focus, category confidence)
- [ ] Success/failure feedback states (save confirmations, import success)
- [ ] Accessibility audit (keyboard nav, focus management, screen reader)
- [ ] Window resize / responsive layout pass

### Mid-term
- [ ] Tax year reporting + export (TurboTax-compatible CSV)
- [ ] Debt payoff calculators (snowball / avalanche)
- [ ] Investment price feeds (Alpha Vantage API, optional)
- [ ] Receipt/document attachment per transaction
- [ ] Advanced budget analytics (3-month rolling trend per category)

### Long-term
- [ ] Optional E2E encrypted cloud sync (multi-device)
- [ ] Mobile companion app
- [ ] Bank connection via Plaid (opt-in)
- [ ] App store distribution (Windows Store, Mac App Store)
- [ ] Data encryption at rest (AES + Tauri Keychain)

### Uncovered angles
- [ ] Monetization model (one-time purchase recommended)
- [ ] In-app feedback / bug report mechanism
- [ ] Versioned data migration chain (currently single function, will become fragile)
- [ ] Financial disclaimer / liability copy in Settings
- [ ] First-run onboarding completion measurement
- [ ] Performance testing at scale (5,000+ transactions)

---

## Release Process
```bash
# Make changes, commit, push
git add .
git commit -m "description"
git push origin main

# Tag to trigger GitHub Actions build
git tag v0.x.x
git push origin v0.x.x

# Wait for ALL 4 jobs to complete in GitHub Actions
# Then go to Releases, find the tauri-action draft, and Publish it
# DO NOT publish the auto-generated GitHub release (source code only)
```

**Critical**: Do not touch the Releases page until the Actions workflow finishes completely. GitHub auto-creates a source-only release when a tag is pushed. The tauri-action creates a separate draft with the binary installers. Publish the draft, not the auto-generated one.

---

## Environment Notes
- Node.js 20 deprecation warnings in CI are harmless until September 2026
- `pnpm/action-setup@v3` is correct (v4 breaks workspace detection)
- Tauri config: updater in `plugins` block, NOT `app` block
- All 22 source files pass Babel JSX syntax check as of end of session
