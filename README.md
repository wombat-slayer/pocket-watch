# Pocket Watch

A local-first personal finance desktop app — no accounts, no servers, no subscriptions.

## Features

- **Transactions** — import via CSV/OFX/QFX, manual entry, or live Plaid bank sync
- **Accounts** — net worth tracking, investment holdings, reconciliation, statement import
- **Budgets** — monthly budgets with rollover, templates, and over-budget alerts
- **Goals** — savings goals with progress tracking and linked accounts
- **Reports** — spending trends, net worth history, category drill-down
- **Business** — P&L summary, Schedule C line mapping, and CSV export for sole proprietors
- **Compensation Profile** — salary and tax breakdown; PDF pay stub import
- **Equity / Investments** — RSU / option grant tracking with real-time prices (Finnhub / CoinGecko)
- **Auto-updater** — in-app update notifications via Tauri

## Tech Stack

- [Tauri 2.x](https://tauri.app/) (Rust shell + WebView)
- [React 19](https://react.dev/) + [Vite 7](https://vitejs.dev/)
- [pnpm](https://pnpm.io/) workspaces
- Data stored in a single JSON file on your machine — no cloud, no account required

## Getting Started

```sh
# Install dependencies
pnpm install

# Run in development mode (Tauri dev server + hot reload)
pnpm tauri dev

# Run tests
pnpm test
```

## Plaid Bank Sync

Pocket Watch talks directly to the Plaid API from the Rust backend — no middleman server. To enable bank sync:

1. Create a [Plaid developer account](https://dashboard.plaid.com/signup).
2. Obtain a **Client ID** and **Secret** for Sandbox (free) or Development/Production.
3. Enter your credentials in **Settings → Bank Sync**.

Secrets are stored in the OS credential manager (Keychain on macOS, Windows Credential Manager on Windows) — never in plaintext files.

## Building

```sh
# Frontend-only build (Vite)
pnpm build

# Full installer (produces platform-native installer in src-tauri/target/release/bundle/)
pnpm tauri build
```

CI builds run on every `v*.*.*` tag via GitHub Actions (`.github/workflows/release.yml`) across macOS (arm64 + x64), Ubuntu, and Windows.

## Testing

```sh
pnpm test             # run all tests once
pnpm test:watch       # watch mode
pnpm vitest run -t "name"   # single test by name
```

Tests are in `src/__tests__/` and cover pure utility functions in `src/constants.js` and `src/utils/`.

## Data & Privacy

All data lives in a single `.json` file you choose on first launch. The app reads and writes only that file (plus a `.backup.json` alongside it). No telemetry, no analytics, no network calls except to Plaid (if configured) and market data APIs (Finnhub / CoinGecko, optional).

## License

MIT — see [LICENSE](LICENSE).
