# Progress

---

## Todo

### 37 — Tax Report — Session 3 — Details section
Files: `app/tax/TaxClient.tsx`, `lib/tax-compute.ts`
- Details section: flat list of realised-gain rows grouped by asset type (Stocks, Mutual Funds); `computeStockGains` + `computeMFGains` already done in Session 1
- Each row: symbol (headline) + LTCG/STCG badge + "Sold DD Mon YYYY · held N days" footnote + gain value with `+`/`−` prefix
- Tap row → BottomSheet showing the individual FIFO lots consumed: purchase date, qty, cost, sale value, holding days, LTCG/STCG per lot

### 38 — Tax Report — Session 4 — Harvesting section
Files: `app/tax/TaxClient.tsx`, `lib/tax-compute.ts`
- LTCG Availability: exemption-used DetailRow + remaining DetailRow + `--c-positive` progress bar (height 8, rounded-full, `--border-faint` track — matches allocation screen)
- Harvesting Availability: unrealised losses available + realised STCG to offset; requires scanning open lots from `computeStockGains`/`computeMFGains` unrealised output
- Harvesting Readiness: footnote explanation + countdown rows for holdings within 30 days of 365-day threshold; sorted ascending by days remaining

### 39 — Tax Report — Session 5 — Export (CSV + PDF)
Files: `app/tax/TaxClient.tsx`, `app/api/tax/export/route.ts`
- Single Export button (bg-tertiary pill) → BottomSheet with two options: CSV (table/grid icon, green) and PDF (document icon, red)
- Description text sits above the Export button
- CSV: lot-level rows — symbol, purchase date, purchase cost, sale date, sale proceeds, STCG, LTCG; grouped by asset type; generated client-side with a library (e.g. papaparse) or server route
- PDF: CAMS-style layout matching the capital gains statement format (fund/symbol header, folio/ISIN for MF, lot rows, fund total row); generated via server route returning a downloadable PDF
- Columns per screenshot reference in session notes: SNo, Units, Purchase Date, Purchase Value, Acquisition Value*, Redemption Date, Redemption Value, STCG, LTCG

---

## Done

### 36 — 2026-05-21 — Tax Report — Session 2 — Route shell + Summary section
Files: `app/tax/page.tsx`, `app/tax/TaxClient.tsx`, `components/UserMenu.tsx`, `middleware.ts`
- Single scrollable page; FY picker pill in sticky header reuses `FYPicker`; `/tax` added to middleware matcher
- Hero strip: exact `1fr 1px 1fr 1px 1fr` grid — Total Gains / LTCG / STCG, all signed `Num`, plain `--text-primary` (no colour)
- Four collapsible sections (Section component + `ChevronDownIcon` rotation); Summary expanded by default; Details/Harvesting/Export collapsed with placeholder
- Summary: LTCG group (Gains, Exemption 1.25 L muted, Taxable, Tax@12.5%), STCG group (Gains, Tax@20%), Dividend Income group (Received); no colour on values, signed +/− via `Num signed`
- UserMenu "Data" section gains "Tax Report" entry above Dividends; inline `TaxMenuIcon` SVG

### 35 — 2026-05-21 — Tax Report — Session 1 — Compute foundation
Files: `lib/tax-compute.ts`, `lib/__tests__/tax-compute.test.ts`
- FIFO lot matching for stocks, MF, and gold via shared `fifoConsume` engine; one `RealisedGain` per lot consumed per sell
- LTCG thresholds: 365 days (equity) / 1095 days (gold); `fyRange` required — realised output filtered to sells within that FY, FIFO state still advances for out-of-range sells
- Pre-2018 MF grandfathering: effective cost = `max(actual, min(fmvJan2018, salePrice))`; applied only to LTCG lots; `fmvJan2018: null` skips silently
- 27 tests covering FIFO ordering, partial/spanning sells, STCG/LTCG boundary, FY exclusion, grandfathering scenarios, gold 3-year threshold, loss lots

### 34 — 2026-05-19 — Snowball: current vs prior fundamentals comparison table
Files: `app/bands/[symbol]/SnowballSheet.tsx`
- Replaced "Prior Session" section + trailing footnote with a 3-column grid under "Fundamentals"
- Shows Growth and Op Margin side-by-side for current and prior snapshots; Snapshot labels on a third row
- Prior column uses `--text-muted`; current uses `--text-primary`; both fall back to `—` when data is absent

### 33 — 2026-05-18 — Stock detail: remove dividends section
Files: `lib/fetchStockDetailProps.ts`, `app/bands/[symbol]/BandDetailClient.tsx`, `app/bands/[symbol]/page.tsx`, `app/stocks/[symbol]/page.tsx`
- Removed `StockDividends` from the per-stock page — dividends now only on the dedicated dividends page
- Removed `getDividendsForSymbol` from data fetch pipeline and `initialDividends` prop from `BandDetailClient`

### 32 — 2026-05-18 — Buy Levels: fix "At CMP" label
Files: `components/TrancheSection.tsx`
- "At CMP" was triggering for any tranche below CMP, incorrectly labelling all lower dip-buy levels
- Restricted to ±1% of CMP (`Math.abs(distPct) <= 1`)

### 31 — 2026-05-18 — Buy Levels: remove misleading "Bought at this price" sublabel
Files: `components/TrancheSection.tsx`, `app/bands/[symbol]/TranchesSheet.tsx`, `app/bands/[symbol]/BandDetailClient.tsx`
- Sublabel fired when any transaction was within 5% of a tranche price, not at it — factually wrong
- Removed `matchedBuy` logic, `fmtDay` helper, `MONTHS` constant, and `recentBuys` prop threading

### 30 — 2026-05-18 — Buy Levels: Option B conviction matrix
Files: `lib/band-calculator.ts`, `app/api/tranches/generate/[symbol]/route.ts`, `app/bands/[symbol]/TranchesSheet.tsx`, `app/bands/[symbol]/BandDetailClient.tsx`, `lib/__tests__/band-calculator.test.ts`, `docs/valuation-playbook.md`
- Added `convictionMatrix(zone, signal, buyLow, buyHigh)` — maps 5×2 zone×signal grid to `{ trancheCount, weightMode, deepExtension, ceilingOverride }`
- `computeTrancheAmounts`: replaced `equal: boolean` with `weightMode`; added cubic branch `(i+1)³`
- `computeTranchePrices`: added `ceilingOverride` and `deepExtension`; removed hardcoded count-cap-at-3 in deep zone
- Tranche route: fetches 2 latest snapshots, computes Snowball, calls `convictionMatrix`, handles blocked with early return

### 29 — 2026-05-18 — Buy Levels: remove warning colour from tranche sublabels
Files: `components/TrancheSection.tsx`
- "At CMP" and "Bought at this price" sublabels were incorrectly coloured `color.warning` — contextual metadata, not caution signals
- Removed orange left border, background tint, and orange text; sublabels now render in `text-muted`

### 28 — 2026-05-18 — Docs: catch up to current codebase
Files: `docs/architecture.md`, `docs/app-spec.md`, `docs/walkthrough.md`
- `architecture.md`: added Screener.in + NSE, `buy_band_snapshots`, all `[symbol]/` sheet modules, Snowball Model section
- `app-spec.md`: added Snowball Signal to vocabulary; updated Stock Detail IA
- `walkthrough.md`: fixed Regen Bands description; added Snowball Check section; fixed band bar zone labels (HOLD → MID)

### 27 — 2026-05-18 — Snowball signals rename + shared helpers + Buy Levels descriptor
Files: `lib/snowball.ts`, `lib/__tests__/snowball.test.ts`, `app/bands/[symbol]/BandDetailClient.tsx`, `app/bands/[symbol]/TranchesSheet.tsx`, `app/bands/[symbol]/SnowballSheet.tsx`
- Renamed signals: `ADD_AGGRESSIVE` → `ADD_AGGRESSIVELY`, `ADD_MEASURED` → `ADD_SLOWLY`, `BLOCK` → `TRIM`
- Added `signalLabel()`, `signalColor()`, `signalStrategyWord()` to `lib/snowball.ts` — single source of truth; removed 3 local duplicates
- `TranchesSheet`: added descriptor line "{n} tranches · Aggressive" below sheet header

### 26 — 2026-05-18 — Buy Levels: Snowball pill + stale level indicators
Files: `app/bands/[symbol]/BandDetailClient.tsx`, `app/bands/[symbol]/TranchesSheet.tsx`, `components/TrancheSection.tsx`
- `TranchesSheet`: Snowball signal pill inline in sheet header
- `TrancheSection / TrancheRow`: amber warning state — (1) CMP ≥ tranche price → "At CMP"; (2) buy txn within 5% → "Bought at this price on DD Mon"; (3) otherwise existing distance label

### 25 — 2026-05-18 — Snowball sheet copy + Risk Overlay text contrast fix
Files: `app/bands/[symbol]/SnowballSheet.tsx`, `app/bands/[symbol]/RiskOverlaySheet.tsx`
- Renamed signals to "Add Aggressively", "Add Slowly", "Trim" — match band vocabulary and convey sizing intent
- Added always-visible explanation paragraph below sheet header
- Both sheets now use `text-muted` (40%) for explanatory text instead of `text-faint` (25%)

### 24 — 2026-05-18 — Bugfix: Snowball stale after Regen Financials
Files: `app/bands/[symbol]/BandDetailClient.tsx`
- Added `router.refresh()` after successful `action === 'financials'` response so server component re-fetches snapshots in place
- Previously the Snowball stayed stale until a manual page reload

### 23 — 2026-05-17 — Bugfix: FinancialsSheet snapshot label auto-derived
Files: `app/bands/[symbol]/FinancialsSheet.tsx`
- Removed manual Label input field — was inconsistent with API route which already auto-derived the label
- Manual save path now derives label from `fiscalQuarterLabel(new Date())`; dropped `snapshotLabel` state

### 22 — 2026-05-17 — Snowball: Session 4 — Snowball UI on stock detail page
Files: `lib/data.ts`, `lib/fetchStockDetailProps.ts`, `app/bands/[symbol]/page.tsx`, `app/stocks/[symbol]/page.tsx`, `components/detail-rows.tsx`, `app/bands/[symbol]/SnowballSheet.tsx`, `app/bands/[symbol]/BandDetailClient.tsx`
- `getLatestSnapshots` added to data.ts (fetches up to 2 most-recent snapshots for cond2/cond3)
- `SnowballSheet.tsx`: read-only BottomSheet with signal badge, Zone / Conditions / Entry Strength / Prior Session sections
- `BandDetailClient`: Snowball tappable row between Risk Overlay and Investability (gated `allTimeQty > 0`); compact signal pill on right

### 21 — 2026-05-17 — Snowball: Session 3 — Financials sheet extension
Files: `app/bands/[symbol]/FinancialsSheet.tsx`, `lib/screener.ts`, `app/api/bands/generate/[symbol]/route.ts`
- `FinancialsSheet`: added Op Profit, Revenue inputs; on Save calls `saveSnapshotIfChanged` with computed `g_computed`/`op_margin`
- `lib/screener.ts`: `ScreenerData` extended with `opProfitCr`/`revenueCr`; parses `Operating Profit` and `Sales` rows from `#profit-loss`
- `generate/[symbol]/route.ts`: calls `saveSnapshotIfChanged` server-side with auto-derived fiscal quarter label

### 20 — 2026-05-17 — Snowball: Session 2 — Backfill script + tests
Files: `scripts/backfill-snapshots.ts`, `lib/__tests__/snowball.test.ts`
- Backfill script: fetches all `(user_id, symbol)` from `buy_bands`, calls Screener for each, computes `g_computed` and `op_margin`, inserts into `buy_band_snapshots` with `label='FY25'`
- 30 unit tests covering zone classification, TRIM short-circuit, cond1/cond2/cond3, INSUFFICIENT_DATA propagation, entry strength 0–3

### 19 — 2026-05-17 — Snowball: Session 1 — Schema + data layer + compute
Files: `supabase/migrations/20260517_buy_band_snapshots.sql`, `lib/types.ts`, `lib/data.ts`, `app/actions.ts`, `lib/snowball.ts`
- Migration: `buy_band_snapshots` table with RLS and `(user_id, symbol, snapshotted_at desc)` index; `op_profit_cr` + `revenue_cr` columns added to `buy_bands`
- `getLatestSnapshot(symbol)` in data.ts with `unstable_cache` + `cache()` wrapper
- `saveSnapshotIfChanged(symbol, snap, label)` in actions.ts: diffs 6 numeric fields, inserts only on change
- `lib/snowball.ts`: pure `computeSnowball()` — zone classification (DEEP_VALUE/BUY/MID/WATCH/TRIM), three conditions, entryStrength 0–3, signal ADD_AGGRESSIVE/ADD_MEASURED/WAIT/BLOCK/INSUFFICIENT_DATA

### 18 — 2026-05-17 — Session 0: Split BandDetailClient into modules
Files: `app/bands/[symbol]/BandDetailClient.tsx`, `app/bands/[symbol]/RiskOverlaySheet.tsx`, `app/bands/[symbol]/FinancialsSheet.tsx`, `app/bands/[symbol]/BandComputationSheet.tsx`, `app/bands/[symbol]/TranchesSheet.tsx`, `app/bands/[symbol]/InvestabilitySheet.tsx`, `app/bands/[symbol]/KeyPromptSheet.tsx`, `components/detail-rows.tsx`
- Extracted `DetailRow`, `CompRow`, `SectionLabel` into `components/detail-rows.tsx` (shared primitives, no hooks)
- Moved each of the 6 sheet components to its own file under `app/bands/[symbol]/`
- `BandDetailClient.tsx` reduced from 1345 → 280 lines — orchestrator only; no behavior change

### 17 — 2026-05-17 — Dividends: UI consistency overhaul
Files: `app/dividends/DividendsClient.tsx`
- Filter system: replaced scrollable per-symbol chips with a single Filter pill; bottom sheet with `CheckIcon` + row-tint selection; active filters appear as removable tag chips
- Summary strip: two-column grid (`text-title-2 font-bold`) — Total received + Dividends count, both filtered
- Timeline rows: symbol promoted to `text-headline font-semibold`; date + per_share + shares collapsed to single footnote line
- Fixed `var(--destructive)` (non-existent token) → `text-negative` on error banner

### 16 — 2026-05-17 — Dividends: bulk refresh all stocks
Files: `app/dividends/DividendsClient.tsx`
- Added `RefreshIcon` button; `handleRefreshAll` fires `Promise.allSettled` across all symbols, diffs, aggregates new entries
- Bulk confirm sheet with symbol + date on each row; `handleBulkSave` calls `saveDividends`, merges into local state
- Partial failures shown inline; "Already up to date" if no new entries

### 15 — 2026-05-17 — Dividends: bugfix — broken per-stock refresh
Files: `lib/nse.ts`, `app/api/dividends/fetch/[symbol]/route.ts`, `components/StockDividends.tsx`
- Screener removed their `#dividends` HTML section; `parseDividendHistory` silently returned `[]` for all symbols
- Replaced with NSE corporate actions API (`/api/corporates-corporateActions?index=equities&symbol=X&series=EQ`)
- Fixed silent failure in `StockDividends.handleRefresh`: now sets `fetchError` state on non-OK response

### 14 — 2026-05-17 — Dividends: Session 3 — `/dividends` page + wiring
Files: `app/dividends/page.tsx`, `app/dividends/DividendsClient.tsx`, `lib/fetchStockDetailProps.ts`, `app/bands/[symbol]/page.tsx`, `app/bands/[symbol]/BandDetailClient.tsx`, `app/stocks/[symbol]/page.tsx`, `middleware.ts`, `components/UserMenu.tsx`, `docs/architecture.md`, `agent.md`
- `DividendsClient` has By Stock / Timeline segments, symbol filter chips, hero total that updates with filter
- Stock row tap → `BottomSheet` containing `StockDividends` for the selected symbol
- `UserMenu`: "Data" section with Dividends link; `middleware.ts`: `/dividends/:path*` added to matcher
- `docs/architecture.md` + `agent.md`: dividends table, route, key files, asset types row

### 13 — 2026-05-17 — Dividends: Session 2 — StockDividends component
Files: `components/StockDividends.tsx`
- Client component: props `symbol`, `exchange`, `initialDividends`, `initialTransactions`
- Payment list sorted by ex_date desc; refresh diffs by ex_date, opens confirm sheet for new entries only
- `sharesAtDate(date)` computes cumulative holdings from `initialTransactions` at the given date
- Confirm sheet: per-row skip toggle + editable shares input; pre-filled from holdings, pre-skipped if 0 shares

### 12 — 2026-05-17 — Dividends: Session 1 — Backend + data layer
Files: `supabase/migrations/20260517_dividend_transactions.sql`, `lib/types.ts`, `lib/screener.ts`, `app/api/dividends/fetch/[symbol]/route.ts`, `lib/data.ts`, `app/actions.ts`
- Migration: `dividend_transactions` table with generated `amount` column, unique on `(user_id, symbol, ex_date)`, RLS + indexes
- `DividendTransaction` interface added to `lib/types.ts`
- GET `/api/dividends/fetch/[symbol]` fetches Screener HTML + runs parser, returns `{ex_date, per_share}[]`
- `getDividendsForSymbol` + `getAllDividends` in `lib/data.ts` with `unstable_cache` + tag `dividend_transactions`
- `saveDividends(rows)` in `app/actions.ts` — upsert on `(user_id, symbol, ex_date)` + `revalidateTag`

### 11 — 2026-05-15 — Next.js upgrade to 16.2.6
Files: `package.json`, `package-lock.json`
- Upgraded `next` from 16.2.3 → 16.2.6 to resolve all 13 GitHub-flagged advisories
- Fixes: 5 high (DoS, SSRF, middleware bypass), 4 moderate (XSS, cache poisoning), 2 low, 2 info

### 10 — 2026-05-15 — Codebase cleanup: dead code + duplicate removal
Files: `lib/formatter.ts`, `lib/portfolio-types.ts`, `app/portfolio/actions.ts`
- Removed 3 unused formatter exports: `shortMonthYear`, `formatPnLFine`, `formatGainPct`
- Deleted unused `PortfolioProps` interface from `portfolio-types.ts`
- Removed duplicate `getUserId()` from `portfolio/actions.ts`

### 9 — 2026-05-15 — Transactions: Session 3 — PPF + EPF edit support
Files: `app/transactions/TransactionsClient.tsx`
- Added `rawPPF` / `rawEPF` to `DisplayTxn`; extended `ActiveEdit` union with `PPFEditState` and `EPFEditState`
- PPF edit UI: Amount + Date (2-col), Type segmented control (Deposit/Withdrawal/Interest), Notes
- EPF edit UI: Amount + Date (2-col), Type segmented control (Deposit/Interest), Notes
- Edit header badge and dot colour update dynamically as trade_type changes

### 8 — 2026-05-15 — Transactions: Session 2 — MF + SGB edit support
Files: `app/transactions/TransactionsClient.tsx`
- Added `rawMF` / `rawSGB` to `DisplayTxn`; populated in `allDisplayTxns`
- Added `mfTxns`/`sgbTxns` state with `updateMFTxn`/`updateSGBTxn` helpers and prop-sync `useEffect`
- Replaced `EditState` with `ActiveEdit` discriminated union (`StockEditState | MFEditState | SGBEditState`)
- MF edit fields: Units + NAV (2-col), Date; SGB edit fields: Grams + Price/g (2-col), Date + Name

### 7 — 2026-05-15 — Transactions: Session 1 refactor (no behavior change)
Files: `app/transactions/TransactionsClient.tsx`
- Removed dead `fiscalYears` prop from `TxnRow` and its call site
- Extracted `EditField` helper (label + input wrapper) and `EditActions` helper (Save/Cancel/Delete button row)
- Consolidated 6 separate edit state vars into `EditState | null` discriminated union
- Renamed `onSaved` → `onSavedStock` in preparation for Session 2 MF/SGB callbacks

### 6 — 2026-05-15 — Transactions: neutral monochrome asset badge
Files: `app/transactions/TransactionsClient.tsx`
- Replaced faint uppercase asset tag with a neutral monochrome badge (border-faint bg, border outline, text-muted label)
- Uses existing tokens — light/dark mode automatic

### 5 — 2026-05-15 — Transactions screen: all asset types + filter overhaul
Files: `app/transactions/page.tsx`, `app/transactions/TransactionsClient.tsx`
- Page now fetches mf_funds, mf_transactions, sgb_transactions, ppf_transactions, epf_transactions in parallel
- Introduced `DisplayTxn` unified type normalising all 5 asset types; stocks retain `rawStock` reference for edit/delete
- Added multi-select asset filter (sub-sheet with checkmarks): Stocks / MF / Gold / PPF / EPF
- Type filter maps to `direction`: buy+deposit→in, sell+withdrawal→out, interest→neutral
- Month summary relabelled "invested/withdrawn"; interest excluded from both totals

### 4 — 2026-05-15 — Allocation screen hierarchy fix + signal dot removal
Files: `app/allocation/DashboardClient.tsx`, `lib/compute.ts`, `lib/types.ts`, `lib/__tests__/compute.test.ts`, `docs/app-spec.md`, `docs/design.md`
- Flipped row visual hierarchy: Invested is now `text-headline font-bold` (trailing hero) and Left is `text-body font-medium text-2` (secondary)
- Changed both allocation bars from `--bar-fill` (blue) to `--c-positive` (green) so fill reads as deployed capital
- Removed `BandSignal` type, `bandSignal` field from `StockRow`, `getBandSignal` function, and 4 bandSignal tests — feature was never rendered

### 3 — 2026-05-13 — G7 governance gate — forensic rubric upgrade
Files: `docs/valuation-playbook.md`, `app/api/investability/generate/[symbol]/route.ts`
- Replaced single-line vague G7 descriptor with a 3-check forensic scoring rubric (max 5, any veto = hard 0)
- Checks: OCF/PAT 3yr avg · RPT value/revenue · promoter holding trend over 8 quarters
- Updated Gemini prompt with explicit check instructions so AI can derive scores from web-searched data
- Veto triggers: OCF/PAT <30%, loans to promoters present, >5% promoter decline in any 18m window

### 2 — 2026-05-13 — Carryover model redesign (full rewrite)
Files: `lib/types.ts`, `lib/compute.ts`, `lib/data.ts`, `app/actions.ts`, `lib/fetchStockDetailProps.ts`, `app/bands/page.tsx`, `app/allocation/page.tsx`, `app/allocation/DashboardClient.tsx`, `app/plan/PlanClient.tsx`, `app/transactions/TransactionsClient.tsx`, `app/api/tranches/generate/[symbol]/route.ts`, `lib/__tests__/compute.test.ts`
- Root cause: old per-stock orphan-pool carryover was bleeding negative amounts onto FY26 stocks that were never in FY25 (e.g. KALYANKJIL showing negative carryover)
- New model — single FY-level `unallocated_carryover_inr` on `fiscal_years`; `pool = total_budget_inr + carryover`; `net_deployed = all buys − all sells`; auto-applied via `useEffect` in PlanClient once prev FY end date passes
- UI: budget strip footnote `80L base + 3.74L carryover from FY25`; per-stock Plan row `+1.68L from FY25` footnote; no banner, no manual button
- Removed `advance_fy_id` field, "Count toward a different FY" toggle, `→ FY26` tag, and all old carryover compute code

### 1 — 2026-05-12 — Add Jewellery category
Files: `lib/types.ts`, `lib/band-calculator.ts`, `docs/valuation-playbook.md`
- Added `'Jewellery'` to `ALL_CATEGORIES`
- PE multiples: buy 24–32×, mid 33–42×, trim 43×
- Midpoint PE: 28.0, ROCE threshold: 18%
- Playbook updated: ROCE list, midpoint PE list, category #6 bands, Kalyan Jewellers worked example
