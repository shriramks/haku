# Progress

---

## Todo

---

## Done

### 2026-05-18 — Bugfix: Snowball stale after Regen Financials
Files: `app/bands/[symbol]/BandDetailClient.tsx`
- Added `router.refresh()` after a successful `action === 'financials'` response so the server component re-fetches and `initialSnapshot`/`initialPriorSnapshot` props update in place — previously the Snowball stayed stale until a manual page reload

### 2026-05-17 — Bugfix: FinancialsSheet snapshot label auto-derived
Files: `app/bands/[symbol]/FinancialsSheet.tsx`
- Removed manual Label input field from the financials form; was inconsistent with the API route which already auto-derived the label
- Added `fiscalQuarterLabel(new Date())` inline (same logic as the route) so the manual save path now derives the label from the current date (Indian FY, Apr–Mar quarters)
- Dropped `snapshotLabel` state

### 2026-05-17 — Snowball: Session 4 — Snowball UI on stock detail page
Files: `lib/data.ts`, `lib/fetchStockDetailProps.ts`, `app/bands/[symbol]/page.tsx`, `app/stocks/[symbol]/page.tsx`, `components/detail-rows.tsx`, `app/bands/[symbol]/SnowballSheet.tsx`, `app/bands/[symbol]/BandDetailClient.tsx`
- `lib/data.ts`: added `getLatestSnapshots` (fetches up to 2 most-recent snapshots for a symbol — needed to provide current + prior values for cond2/cond3)
- `fetchStockDetailProps`: calls `getLatestSnapshots`, adds `initialSnapshot` / `initialPriorSnapshot` to `StockDetailProps` and returns them; both page routes pass them to `BandDetailClient`
- `CompRow`: added optional `valueColor` prop so PASS/FAIL/INSUFFICIENT_DATA and zone names render in the correct token color — one place, no ad-hoc styles
- `SnowballSheet.tsx`: read-only `BottomSheet` with signal badge (large `color-mix` pill, same pattern as investability verdict), Zone / Conditions / Entry Strength / Prior Session sections using `SectionLabel` + `CompRow`; missing prior snapshot shows inline "No prior snapshot — save financials to start tracking"
- `BandDetailClient`: added `showSnowball` state, `useMemo`-computed `snowball` result from risk-adjusted band prices + snapshots; Snowball tappable row inserted between Risk Overlay and Investability (gated `allTimeQty > 0`), compact signal pill on right; `SnowballSheet` mounted in sheets section

### 2026-05-17 — Snowball: Session 3 — Financials sheet extension
Files: `app/bands/[symbol]/FinancialsSheet.tsx`, `lib/screener.ts`, `app/api/bands/generate/[symbol]/route.ts`
- `FinancialsSheet`: added `opProfitCr`, `revenueCr`, `snapshotLabel` state + `useEffect` sync; added Op Profit, Revenue, and Label inputs below `pat_3yr_ago` in the `!isIndex` block; `FinInput` now accepts optional `type` prop for text fields
- On Save: includes `op_profit_cr`/`revenue_cr` in the `buy_bands` upsert; calls `saveSnapshotIfChanged` with computed `g_computed`/`op_margin` and the user-supplied label
- `lib/screener.ts`: `ScreenerData` extended with `opProfitCr`/`revenueCr`; `fetchScreenerData` parses `Operating Profit` and `Sales` rows from `#profit-loss`
- `generate/[symbol]/route.ts`: financials action stores `op_profit_cr`/`revenue_cr` to `buy_bands`; calls `saveSnapshotIfChanged` server-side with auto-derived fiscal quarter label (`fiscalQuarterLabel` helper, Indian FY Apr–Mar)

---

### 2026-05-17 — Snowball: Session 2 — Backfill script + tests
Files: `scripts/backfill-snapshots.ts`, `lib/__tests__/snowball.test.ts`
- `scripts/backfill-snapshots.ts`: fetches all `(user_id, symbol)` from `buy_bands`, calls Screener for each (consolidated → standalone fallback), parses penultimate annual column for Net Profit / Operating Profit / Sales, computes `g_computed=(pat[-2]/pat[-5])^(1/3)-1` and `op_margin=op_profit[-2]/sales[-2]`, inserts into `buy_band_snapshots` with `label='FY25'`; continues on per-symbol failure, logs result per symbol
- `lib/__tests__/snowball.test.ts`: 30 unit tests covering zone classification (all 5 zones + boundary values), TRIM short-circuit, cond1/cond2/cond3 (PASS/FAIL/INSUFFICIENT_DATA for each), INSUFFICIENT_DATA signal propagation, WAIT in MID/WATCH, entry strength 0–3 → ADD_AGGRESSIVE/ADD_MEASURED/WAIT, DEEP_VALUE parity

---

### 2026-05-17 — Snowball: Session 1 — Schema + data layer + compute
Files: `supabase/migrations/20260517_buy_band_snapshots.sql`, `lib/types.ts`, `lib/data.ts`, `app/actions.ts`, `lib/snowball.ts`
- Migration: `buy_band_snapshots` table (pat_now, pat_3yr_ago, op_profit_cr, revenue_cr, g_computed, op_margin, label, snapshotted_at) with RLS and `(user_id, symbol, snapshotted_at desc)` index; `op_profit_cr` + `revenue_cr` columns added to `buy_bands`
- `BuyBandSnapshot` interface added to types; `BuyBand` extended with `op_profit_cr`/`revenue_cr`
- `getLatestSnapshot(symbol)` in data.ts: `unstable_cache` + `cache()` wrapper, tag `buy_band_snapshots`, single-row `.limit(1).maybeSingle()` query
- `saveSnapshotIfChanged(symbol, snap, label)` in actions.ts: diffs 6 numeric fields against latest snapshot, inserts only on change, calls `revalidateTag`
- `lib/snowball.ts`: pure `computeSnowball()` — zone classification (DEEP_VALUE/BUY/MID/WATCH/TRIM), three conditions (cond1: g>12%, cond2: margin improving, cond3: g>gPrior), entryStrength 0–3 with STRONG/MODERATE/WEAK label, signal ADD_AGGRESSIVE/ADD_MEASURED/WAIT/BLOCK/INSUFFICIENT_DATA

---

### 2026-05-17 — Session 0: Split BandDetailClient into modules
Files: `app/bands/[symbol]/BandDetailClient.tsx`, `app/bands/[symbol]/RiskOverlaySheet.tsx`, `app/bands/[symbol]/FinancialsSheet.tsx`, `app/bands/[symbol]/BandComputationSheet.tsx`, `app/bands/[symbol]/TranchesSheet.tsx`, `app/bands/[symbol]/InvestabilitySheet.tsx`, `app/bands/[symbol]/KeyPromptSheet.tsx`, `components/detail-rows.tsx`
- Extracted `DetailRow`, `CompRow`, `SectionLabel` into `components/detail-rows.tsx` (shared primitives, no hooks)
- Moved each of the 6 sheet components to its own file under `app/bands/[symbol]/`; `MarketCapRuleModal`/`MarketCapRuleRow` moved alongside `BandComputationSheet` (only used there)
- `BandDetailClient.tsx` reduced from 1345 → 280 lines — orchestrator only (state, layout, wiring)
- No behavior change; `npm run build` clean

---

### 2026-05-17 — Dividends: UI consistency overhaul
Files: `app/dividends/DividendsClient.tsx`
- Nav: refresh button gets `rounded-full bg-tertiary` pill + `gap-2` between refresh and settings icons
- Filter system: replaced scrollable per-symbol chips with a single Filter pill (matching `/txns` pattern); bottom sheet has Stock + Year sections with `CheckIcon` + row-tint selection; active filters appear as removable tag chips; both filters gate all derived data
- Summary strip: replaced single `text-display` hero with two-column grid (`text-title-2 font-bold uppercase-label`) matching allocation strip — Total received + Dividends count, both filtered
- By Stock rows: removed exchange from footnote (was "NSE · 3 payments", now "3 payments"); list and totals now derived from `filteredSymbolTotals/Counts`
- Timeline rows: symbol promoted to `text-headline font-semibold` primary; date + per_share + shares collapsed to single `text-footnote` line
- Stock detail sheet header: replaced hand-rolled div with `SheetHeader` (correct border, centered title, standard Done button)
- Fixed `var(--destructive)` (non-existent token) → `text-negative` class on error banner
- Added empty-state variant for "no results match filters"

### 2026-05-17 — Dividends: bulk refresh all stocks
Files: `app/dividends/DividendsClient.tsx`
- Added `RefreshIcon` button to the `/dividends` nav bar; spins while fetching
- `handleRefreshAll` fires `Promise.allSettled` across all symbols from `allTxns`, diffs each against saved dividends, aggregates new entries
- Bulk confirm sheet (same skip-toggle / shares-input / amount pattern as per-stock flow) with symbol + date on each row
- `handleBulkSave` calls existing `saveDividends` server action, merges saved rows into local state
- Exchange falls back from dividends map → first `allTxns` entry for the symbol
- Partial failures shown inline ("Some stocks failed to fetch"); "Already up to date" if no new entries
- Empty state text updated to point users to the new button

### 2026-05-17 — Dividends: bugfix — broken per-stock refresh
Files: `lib/nse.ts`, `app/api/dividends/fetch/[symbol]/route.ts`, `components/StockDividends.tsx`
- Screener removed their `#dividends` HTML section; `parseDividendHistory` silently returned `[]` for all symbols
- Replaced with NSE corporate actions API (`/api/corporates-corporateActions?index=equities&symbol=X&series=EQ`)
- `fetchNseDividends` in `lib/nse.ts`: filters dividend entries, sums multiple per-share amounts from combined subjects, parses `DD-Mon-YYYY` date format
- Fixed silent failure in `StockDividends.handleRefresh`: now sets `fetchError` state and shows "Failed to fetch dividends — try again" on non-OK response

### 2026-05-17 — Dividends: Session 3 — `/dividends` page + wiring
Files: `app/dividends/page.tsx`, `app/dividends/DividendsClient.tsx`, `lib/fetchStockDetailProps.ts`, `app/bands/[symbol]/page.tsx`, `app/bands/[symbol]/BandDetailClient.tsx`, `app/stocks/[symbol]/page.tsx`, `middleware.ts`, `components/UserMenu.tsx`, `docs/architecture.md`, `agent.md`
- `app/dividends/` page: server loads `getAllDividends` + `getTransactions`; `DividendsClient` has By Stock / Timeline segments, symbol filter chips, hero total that updates with filter
- Stock row tap → `BottomSheet` containing `StockDividends` for the selected symbol (uses allTxns grouped by symbol)
- `StockDividends` wired inline below Buy Levels in `BandDetailClient` (and `stocks/[symbol]` page); exchange derived from `allocation?.exchange ?? symbolTxns[0]?.exchange`
- `fetchStockDetailProps` now fetches `getDividendsForSymbol` + returns `dividends` and `symbolTxns`; fy-absent branch uses `Promise.all` so dividends/symbolTxns still load
- `middleware.ts`: `/dividends/:path*` added to matcher
- `UserMenu`: "Data" section with Dividends link (currency circle icon)
- `docs/architecture.md` + `agent.md`: dividends table, route, key files, asset types row

---

### 2026-05-17 — Dividends: Session 2 — StockDividends component
Files: `components/StockDividends.tsx`
- Client component: props `symbol`, `exchange`, `initialDividends`, `initialTransactions`
- Payment list: rows sorted by ex_date desc with date / per-share / shares / amount; empty state prompt
- Refresh: fetches `/api/dividends/fetch/[symbol]`, diffs by ex_date, opens confirm sheet for new entries only; "Already up to date" inline message if no diff
- `sharesAtDate(date)` computes cumulative holdings from `initialTransactions` at the given date
- Confirm sheet (BottomSheet + SheetHeader): per-row skip toggle + editable shares input; pre-filled from holdings, pre-skipped if 0 shares; Save N button disabled when nothing to save
- On save: calls `saveDividends` server action, optimistically merges new rows into dividends state

---

### 2026-05-17 — Dividends: Session 1 — Backend + data layer
Files: `supabase/migrations/20260517_dividend_transactions.sql`, `lib/types.ts`, `lib/screener.ts`, `app/api/dividends/fetch/[symbol]/route.ts`, `lib/data.ts`, `app/actions.ts`
- Migration: `dividend_transactions` table with generated `amount` column, unique on `(user_id, symbol, ex_date)`, RLS + indexes
- `DividendTransaction` interface added to `lib/types.ts`
- `parseDividendHistory(html)` parses Screener `#dividends tbody` rows; date parser handles "DD Mon YYYY" and "Mon YYYY" formats; `fetchScreenerHtml` exported for reuse
- GET `/api/dividends/fetch/[symbol]` fetches Screener HTML + runs parser, returns `{ex_date, per_share}[]`
- `getDividendsForSymbol` + `getAllDividends` in `lib/data.ts` with `unstable_cache` + tag `dividend_transactions`
- `saveDividends(rows)` in `app/actions.ts` — upsert on `(user_id, symbol, ex_date)` + `revalidateTag`

---

### 2026-05-15 — Next.js upgrade to 16.2.6
Files: `package.json`, `package-lock.json`
- Upgraded `next` from 16.2.3 → 16.2.6 to resolve all 13 GitHub-flagged advisories
- Fixes: 5 high (DoS, SSRF, middleware bypass), 4 moderate (XSS, cache poisoning), 2 low, 2 info

---

### 2026-05-15 — Codebase cleanup: dead code + duplicate removal
Files: `lib/formatter.ts`, `lib/portfolio-types.ts`, `app/portfolio/actions.ts`
- Removed 3 unused formatter exports: `shortMonthYear`, `formatPnLFine`, `formatGainPct`
- Deleted unused `PortfolioProps` interface from `portfolio-types.ts` (superseded by inline `Props` in PortfolioClient)
- Removed duplicate `getUserId()` from `portfolio/actions.ts`; now imports the cached version from `lib/data`

---

### 2026-05-15 — Transactions: Session 3 — PPF + EPF edit support
Files: `app/transactions/TransactionsClient.tsx`
- Added `rawPPF` / `rawEPF` to `DisplayTxn`; populated in `allDisplayTxns` (now uses `ppfTxns`/`epfTxns` state)
- Added `ppfTxns`/`epfTxns` state + `updatePPFTxn`/`updateEPFTxn` helpers; `handleDelete` now routes 'ppf'/'epf' to correct state lists
- Extended `ActiveEdit` union with `PPFEditState` and `EPFEditState` (amount, date, trade_type, notes)
- PPF edit UI: Amount + Date (2-col), Type segmented control (Deposit/Withdrawal/Interest), Notes
- EPF edit UI: Amount + Date (2-col), Type segmented control (Deposit/Interest), Notes
- Edit header badge and dot colour update dynamically as trade_type changes
- `doDelete` routes to `ppf_transactions` / `epf_transactions` for respective asset types

---

### 2026-05-15 — Transactions: Session 2 — MF + SGB edit support
Files: `app/transactions/TransactionsClient.tsx`
- Added `rawMF` / `rawSGB` to `DisplayTxn`; populated in `allDisplayTxns` (now uses `mfTxns`/`sgbTxns` state instead of raw props)
- Added `mfTxns`/`sgbTxns` state in parent with `updateMFTxn`/`updateSGBTxn` helpers and prop-sync `useEffect`
- Changed `onDelete(id)` → `onDelete(id, asset)` for asset-aware routing; TxnRow picks correct Supabase table (`mf_transactions` / `sgb_transactions`)
- Replaced `EditState` with `ActiveEdit` discriminated union (`StockEditState | MFEditState | SGBEditState`)
- MF edit fields: Units + NAV (2-col), Date; SGB edit fields: Grams + Price/g (2-col), Date + Name
- Pencil icon now shown for MF and SGB rows

---

### 2026-05-15 — Transactions: Session 1 refactor (no behavior change)
Files: `app/transactions/TransactionsClient.tsx`
- Removed dead `fiscalYears` prop from `TxnRow` and its call site
- Extracted `EditField` helper (label + input wrapper) and `EditActions` helper (Save/Cancel/Delete button row)
- Consolidated 6 separate edit state vars into `EditState | null` discriminated union
- Renamed `onSaved` → `onSavedStock` in preparation for Session 2 MF/SGB callbacks

---

### 2026-05-15 — Transactions: neutral monochrome asset badge
Files: `app/transactions/TransactionsClient.tsx`
- Replaced faint uppercase asset tag with a neutral monochrome badge (border-faint bg, border outline, text-muted label)
- Uses existing tokens — light/dark mode automatic

---

## 2026-05-15 (2)

### Transactions screen: all asset types + filter overhaul
Files: `app/transactions/page.tsx`, `app/transactions/TransactionsClient.tsx`
- Page now fetches mf_funds, mf_transactions, sgb_transactions, ppf_transactions, epf_transactions in parallel alongside stock transactions
- Introduced `DisplayTxn` unified type normalising all 5 asset types; stocks retain `rawStock` reference for edit/delete; others are read-only
- Added multi-select asset filter (sub-sheet with checkmarks): Stocks / MF / Gold / PPF / EPF — separate options, no colour coding
- Stock picker row in filter sheet hides when asset filter excludes stocks
- Type filter (Buys/Sells) maps to `direction` field: buy+deposit→in, sell+withdrawal→out, interest→neutral (neutral only shows in All)
- Month summary: removed `mr-[52px]` offset (Option B — right-flush), relabelled "bought/sold" → "invested/withdrawn"; interest excluded from both totals
- Asset tag shown in sub-line (e.g. "MF · 10.5 units · NAV 52.30") when multiple types visible; hidden when filtered to single type

---

## 2026-05-15

### Allocation screen hierarchy fix + signal dot removal
Files: `app/allocation/DashboardClient.tsx`, `lib/compute.ts`, `lib/types.ts`, `lib/__tests__/compute.test.ts`, `docs/app-spec.md`, `docs/design.md`
- Flipped row visual hierarchy: Invested is now `text-headline font-bold` (trailing hero) and Left is `text-body font-medium text-2` (secondary) — bold number now matches what the green bar shows
- Changed both allocation bars (summary strip + per-row) from `--bar-fill` (blue) to `--c-positive` (green) so fill reads as deployed capital, not a CTA
- Removed `BandSignal` type, `bandSignal` field from `StockRow`, `getBandSignal` function, and 4 bandSignal tests — feature was never rendered in any UI
- Updated `docs/app-spec.md`: removed signal dot from Allocation screen IA, updated row description to reflect new Invested-first hierarchy
- Updated `docs/design.md`: removed "signal dots" from border-radius table

---

## 2026-05-13

### G7 governance gate — forensic rubric upgrade
Files: `docs/valuation-playbook.md`, `app/api/investability/generate/[symbol]/route.ts`

- Replaced single-line vague G7 descriptor with a 3-check forensic scoring rubric (max 5, any veto = hard 0)
- Checks: OCF/PAT 3yr avg · RPT value/revenue · promoter holding trend over 8 quarters
- Added G7 detail block in playbook between scorecard and Part B; scorecard row kept to one compact line
- Updated Gemini prompt with explicit check instructions so AI can derive scores from web-searched data (Screener OCF, BSE shareholding, AR RPT notes)
- Veto triggers: OCF/PAT <30%, loans to promoters present, >5% promoter decline in any 18m window
- Promoter pledge >30% flagged in rationale but not a veto trigger

---

## 2026-05-13

### Carryover model redesign (full rewrite)
Files: `lib/types.ts`, `lib/compute.ts`, `lib/data.ts`, `app/actions.ts`, `lib/fetchStockDetailProps.ts`, `app/bands/page.tsx`, `app/allocation/page.tsx`, `app/allocation/DashboardClient.tsx`, `app/plan/PlanClient.tsx`, `app/transactions/TransactionsClient.tsx`, `app/api/tranches/generate/[symbol]/route.ts`, `lib/__tests__/compute.test.ts`

Root cause: old per-stock orphan-pool carryover was bleeding negative amounts onto FY26 stocks that were never in FY25 (e.g. KALYANKJIL showing negative carryover).

New model — single FY-level number:
- `unallocated_carryover_inr` on `fiscal_years` = `pool − net_deployed` for prev FY
- `pool = total_budget_inr + unallocated_carryover_inr` (prev FY's effective budget)
- `net_deployed = all buys − all sells` across all symbols in the FY
- Sells automatically reduce deployed — no manual marking required
- Carryover can be negative (over-investing reduces next year's budget)
- Auto-applied via `useEffect` in PlanClient once prev FY end date passes

UI changes:
- Budget strip: right-aligned footnote `80L base + 3.74L carryover from FY25` (muted, not green)
- Per-stock row in Plan: `36.00L base` + muted footnote `+1.68L from FY25`
- No banner, no manual "Apply carryover" button

Removed `advance_fy_id` field entirely:
- Migration SQL (to run in Supabase): `UPDATE transactions SET fy_id = advance_fy_id WHERE advance_fy_id IS NOT NULL; ALTER TABLE transactions DROP COLUMN advance_fy_id;`
- Removed "Count toward a different FY" toggle from transaction edit UI
- Removed `→ FY26` display tag on transactions

Removed old code: `computeCarryover`, `CarryoverBreakdown`, `CarryoverResult` types, `carryoverMap` param from `computeStockRows`, `CollapsibleSection`/`CarryoverSection` in DashboardClient, all related tests

---

## 2026-05-12

### Add Jewellery category
Files: `lib/types.ts`, `lib/band-calculator.ts`, `docs/valuation-playbook.md`
- Added `'Jewellery'` to `ALL_CATEGORIES`
- PE multiples: buy 24–32×, mid 33–42×, trim 43×
- Midpoint PE: 28.0, ROCE threshold: 18%
- Playbook updated: ROCE list, midpoint PE list, category #6 bands, Kalyan Jewellers worked example
