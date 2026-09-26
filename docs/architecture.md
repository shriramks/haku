# Architecture

## Stack

- **Next.js 16** — App Router, Server + Client Components
- **TypeScript**, **Tailwind CSS 3**
- **Supabase** — auth + PostgreSQL with Row Level Security per user
- **Yahoo Finance** — live CMP + 52-week range
- **Screener.in** — HTML parsing for financial inputs (EPS, PAT, ROCE, op margin, revenue, mcap) via `lib/screener.ts`
- **NSE API** — index level and PE for ETF bands via `lib/nse.ts`
- **Gemini** — optional user-provided AI key for investability scoring only

---

## Core Tables

| Table | Purpose |
|---|---|
| `fiscal_years` | FY plans and budgets |
| `stock_allocations` | FY-scoped stock list with allocation % and category |
| `transactions` | Real buy/sell log; source of truth for deployment |
| `buy_bands` | Stored valuation inputs (eps, pat_now, pat_3yr_ago, roce_3yr_avg, mcap, op_profit_cr, revenue_cr, index_level, index_pe), generated bands, CMP, 52-week range, risk multiplier |
| `buy_tranches` | FY-scoped planned buy levels |
| `buy_band_snapshots` | Time-series of financial inputs (EPS, g, op margin) per symbol — used for Snowball trend conditions |
| `user_settings` | Gemini API key plus `risk_free` |
| `investability` | 10-gate qualitative scorecard |
| `dividend_transactions` | Per-stock dividend income records (ex_date, per_share, shares, generated amount) |
| `stock_prices` | Last-fetched CMP + previous close per NSE symbol, plus gold (INR/gram) under the reserved key `_GOLD_INR_PER_GRAM` (public market data, not user-scoped; written only by the Portfolio Prices button's refresh route) — see "Price Fetch Flow" |
| `mf_navs` | Latest + previous AMFI NAV per scheme code (`nav`, `prev_nav`, `nav_date`; public market data, not user-scoped; written only by `syncMfNav` from the Portfolio Prices button's refresh route) — see "MF NAV Fetch Flow" |

`buy_bands` is no longer versioned by inserting new rows. There is one row per `(user_id, symbol)`, updated in place.

---

## Data Caching & Writes

Server pages fetch through `lib/data.ts`. Fetchers wrapped in `unstable_cache` persist across requests and are invalidated by `revalidateTag` from server actions:

| Fetcher | Tag | Fallback TTL | Invalidated by |
|---|---|---|---|
| `getFiscalYears` | `fiscal_years` | 1 h | plan create/edit, sell-proceeds redeploy |
| `getBuyBands` | `buy_bands` | 5 min | band generate, CMP upsert, risk overlay save |
| `getBuyTranches` | `buy_tranches` | 2 min | tranche generate/CRUD |
| `getTransactions`, `getTransactionsBySymbol` | `transactions` | 1 h | stock txn add/edit/delete/import |
| `getDividendsForSymbol`, `getAllDividends` | `dividend_transactions` | 5 min | dividend save |
| `getLatestSnapshot(s)` | `buy_band_snapshots` | 5 min | snapshot save |
| `getMFFunds` | `mf_funds` | 1 h | fund upsert |
| `getMFTransactions` | `mf_transactions` | 1 h | txn add, or client edit/delete + `revalidateMFTransactions()` |
| `getSGBTransactions` | `sgb_transactions` | 1 h | txn add, or client edit/delete + `revalidateSGBTransactions()` |
| `getPPFTransactions` | `ppf_transactions` | 1 h | txn add, or client edit/delete + `revalidatePPFTransactions()` |
| `getPPFOverride` | `ppf_balance_override` | 1 h | balance override save |
| `getEPFTransactions` | `epf_transactions` | 1 h | txn add, or client edit/delete + `revalidateEPFTransactions()` |

Among the portfolio/allocation tables, `getAllocations` (`stock_allocations`), `getMFNavs` (`mf_navs`) and `getStockPrices` (`stock_prices`) are left on genuinely per-request reads — see "MF NAV Fetch Flow" and "Price Fetch Flow" for why the two market-data tables deliberately skip `unstable_cache` (a refresh must show on the very next render). (`user_settings` and `investability` fetchers are also per-request-only, but aren't part of this write-revalidation concern — no browser writes to those tables.)

**Write paths:** every write to a cached table must revalidate the matching tag — an unrevalidated browser write serves stale data for up to the TTL. Preferred: server actions that write and revalidate together — `app/actions.ts` for stock/dividend/snapshot tables (or API routes for bands/tranches), `app/portfolio/actions.ts` for MF/gold/PPF/EPF tables. Stock transaction writes (`addStockTransaction`, `updateStockTransaction`, `deleteStockTransaction`, `importStockTransactions`, `redeployToFY`) follow this; `fy_id` is always derived server-side from `trade_date`. PlanClient still writes `fiscal_years` from the browser but pairs each write with `revalidateFiscalYears()`. `stock_allocations` is the one table genuinely uncached and written from the browser under RLS with nothing to revalidate.

**`/transactions` lazy-load pattern:** The RSC ships only current-FY stock transactions (`getTransactions(currentFY.id)`). Portfolio tables (MF/Gold/PPF/EPF + mf_funds) are excluded from the RSC payload and fetched client-side via the browser Supabase client on mount. Older stock history is fetched on demand via the `loadAllStockTransactions()` server action when the date filter extends beyond the current FY. The `?symbol=` view always loads all-time transactions for that stock (no slice).

---

## PWA / Service Worker Caching

`public/sw.js` is registered by `components/ServiceWorkerRegistrar.tsx` on production only (skipped on `localhost`).

Cache name: `haku-v2` (old versions deleted on activate).

| Request type | Strategy |
|---|---|
| `/_next/static/*` | Cache-first — content-hashed filenames, safe forever |
| Icons, manifest, favicons | Stale-while-revalidate — serve cached copy instantly, update in background |
| Navigations (`mode === 'navigate'`) | Network-first → `/offline` fallback |
| Non-GET, cross-origin, `/_next/` non-static, `?_rsc=` | Pass-through (no SW involvement) |
| Everything else | Pass-through |

Dynamic data (Supabase, RSC fetches, API routes) is never intercepted — no risk of stale financial numbers.

---

## Snowball Model

`lib/snowball.ts` combines price zone with three fundamental conditions to produce an entry signal.

**Inputs:** CMP, all five band prices (buyLow/buyHigh/midLow/midHigh/trim), current and prior snapshot values (g, op margin).

**Conditions:**
- `cond1` — earnings growth g > 12% CAGR
- `cond2` — op margin improving (now > prior snapshot)
- `cond3` — growth momentum holding (g > gPrior)

**Signals:**

| Signal | When |
|--------|------|
| `ADD_AGGRESSIVELY` | BUY or DEEP_VALUE zone + all 3 conditions pass |
| `ADD_SLOWLY` | BUY or DEEP_VALUE zone + 1–2 conditions pass |
| `WAIT` | MID or WATCH zone, or 0/3 conditions in buy zone |
| `TRIM` | CMP above trim price |
| `INSUFFICIENT_DATA` | Any condition lacks prior snapshot data |

Signal display uses shared helpers `signalLabel()`, `signalColor()`, `signalStrategyWord()` from `lib/snowball.ts` — never duplicated in components.

---

## Valuation Model

`lib/band-calculator.ts` implements the v9 playbook.

Supported categories:

- `Cap-Light Infra`
- `Hospitals`
- `Branded Pharma`
- `Tobacco Corp`
- `Nifty 50 Index`
- `Nifty Next 50 Index`

Stock bands are PE-based with a factor computed from:

- `g` from 3-year PAT CAGR
- `Ke = risk_free + 5%`
- Path A intrinsic PE clamp, or Path B size modifier
- optional ROCE premium

Index ETF bands are also PE-based, but `factor = 1.00` and `eps` is derived from:

- `index_level / index_pe / 100`

---

## Financial Refresh Flow

`app/api/bands/generate/[symbol]/route.ts` serves two actions:

1. `financials`
2. `bands`

### `financials`

- Reads allocation category
- Fetches raw inputs from Screener.in (`lib/screener.ts`) for stocks, NSE API (`lib/nse.ts`) for index ETFs
- Stores raw inputs in `buy_bands` and a new snapshot row in `buy_band_snapshots`
- Leaves existing band prices untouched
- Updates `last_updated_at`, which marks the row as stale until regeneration

Stored inputs:

- Stocks: `eps`, `pat_now`, `pat_3yr_ago`, `roce_3yr_avg`, `mcap`, `op_profit_cr`, `revenue_cr`
- Index ETFs: `index_level`, `index_pe`, derived `eps`

### `bands`

- Reads the stored financial inputs from `buy_bands`
- Recomputes `buy_low`, `buy_high`, `mid_low`, `mid_high`, `trim_price`
- Updates `generated_at`
- Regenerates FY tranches for the selected stock

Band signals and tranche generation use the stored generated values, not a fresh in-memory recomputation from allocations.

---

## Stale-State Rules

Bands are considered stale when:

- financial inputs were edited manually
- financials were refreshed from AI
- global `risk_free` changed for non-index stocks

The stale UI is intentionally light:

- the stock detail row shows `Bands need regen`
- the financials sheet shows a single warning until `Regen Bands` is run

Changing `risk_free` marks non-index `buy_bands.last_updated_at` forward so the user is prompted to regenerate without silently changing stored bands.

---

## MF NAV Fetch Flow

One source end to end: our own `mf_navs` table (`scheme_code` pk, `nav`, `prev_nav`, `nav_date`), one row per scheme, kept in sync with AMFI's official feed — the same model as `stock_prices`. No per-scheme third-party API, no cross-source reconciliation (progress log #116, #117, #118, #119, #120.c — a two-source design with `mfapi.in` was tried and retired, and #117–#119's dated `mf_nav_history` table was replaced by this one; see git history on this section if you need the old rationale).

- **Sync** (`syncMfNav(service)` in `lib/mf-nav-sync.ts`, `lib/amfi.ts` `fetchAmfiLatestNavs()` / `fetchAmfiNavHistory()`): upserts one `mf_navs` row per scheme, filtered to scheme codes in `mf_funds` (all users, not just currently-held funds — the Tax screen needs sold funds' NAVs too). A scheme absent from AMFI's response keeps its saved row. **Only the Portfolio Prices button triggers it**: `POST /api/portfolio/prices/refresh` calls it in-process, in parallel with the Yahoo fetches, and only when the caller has any `mf_funds` rows. There is no watermark, no mount-time sync and no separate route — the button is the manual "fetch latest, upsert into DB" trigger. A failed sync is logged and never fails the stock/gold save; the refresh response carries no NAV figures. Tapping before AMFI publishes (~9–11 pm IST) legitimately brings no new NAV. Two paths (progress log #128):
  - **Fast path** — AMFI's latest-only feed `spages/NAVAll.txt` (~1.5 MB, ~0.3 s), fetched alongside the known schemes' saved `mf_navs` rows. `planNavUpdates` compares each scheme's **NAV date** with its saved date (never tap time, so next-morning publishers like PPFAS Flexi Cap are fine): equal or older → skip; the next trading day after the saved date (1 calendar day, or Fri → Mon) → roll forward (`nav` = feed, `prev_nav` = saved nav, `nav_date` = feed); anything else → fallback. Blind roll-forward is not safe: saved Tue, feed Thu would label a 2-day move "1D" and can flip its sign. Accepted edge: a fund that publishes on weekends (overnight/liquid) can get a Fri → Mon `prev_nav`.
  - **Fallback** — only for schemes with no saved row or a gap the fast path can't prove is one trading day (a skipped tap day, an exchange holiday): the dated history report (`DownloadNAVHistoryReport_Po.aspx`, fixed 10-day window, ~9 MB / 2–5 s), reduced by `latestNavRows` to each such scheme's newest NAV plus the one before it. Exact, slower, rare. If it fails, the fast path's rolled-forward rows are still saved and the failure is then thrown (and logged by the route).
  - Either fetch throws on an HTTP 200 that parses to zero rows: AMFI sometimes answers with a ~13 KB HTML form page instead of a report, which must not pass for "nothing new".
- **Read** (`getMFNavs(schemeCodes)` in `lib/data.ts`): filters `mf_navs` by scheme code and maps the columns. Deliberately uncached (no `unstable_cache`) so a refresh is visible on the very next render. Returns `{ nav, prevNav, navDate }` per scheme; schemes with no saved row are absent. `prev_nav` is already null-guarded at write time: `latestNavRows` nulls it when the two newest rows are more than `isNavStale`'s 4-day threshold apart (a genuine 1-day move, not a stuck feed — keeps stale-feed gaps out of the portfolio 1D gain / 1D %; this guard is what stopped #112's 202% XIRR bug from recurring), or when only one row exists.

**Call sites**, all server-side props, no client fetch: `app/portfolio/page.tsx` (current + previous NAV, for 1D gain), `app/portfolio/mf/[fundId]/page.tsx` (current + previous NAV, for the fund detail's 1D gain and "as of" date), `app/tax/page.tsx` (current NAV only, for Harvesting's unrealised-loss figure — no 1D gain shown there).

---
## Price Fetch Flow

Stock and gold prices on the Portfolio screen change **only when the Prices button is tapped** (progress log #120). Everything else reads the last saved price from the `stock_prices` table (`symbol` pk, `cmp`, `prev_close`, `fetched_at`), so every screen and device agrees. MF NAVs ride the same tap into their own table, `mf_navs` — see "MF NAV Fetch Flow".

- **Refresh** (`POST /api/portfolio/prices/refresh`): auth-checked, takes no body. Derives the symbols to fetch server-side from the caller's own transactions (`heldSymbols` — net qty > 0), fetches them with `fetchCmpBatch`, diffs against the saved rows and upserts. Only symbols that returned a price are written — a Yahoo failure never overwrites a good saved price. Returns `{ fetchedAt, stocks: { requested, updated, moved, failed[] }, gold: 'skipped' | 'updated' | 'failed' }`. Prices are written server-side only: nothing client-supplied reaches a table every user reads.
- **Gold**: one more row in `stock_prices` under `GOLD_PRICE_KEY` (`_GOLD_INR_PER_GRAM`, `lib/stock-prices.ts`) — `cmp` is INR per gram, `prev_close` the prior per-gram price; the leading underscore can't collide with an NSE ticker. The refresh route fetches it (`fetchGoldPrice` in `lib/market-data.ts`: Yahoo `GC=F` × `USDINR=X`, uncached so a tap gets the live price) only when the caller has any `sgb_transactions`, in the same upsert as the stock rows. Same failure rule as stocks: a failed fetch writes no row, so the last saved gold price (and its returns) stays. Reads: `getGoldPrice()` in `lib/data.ts`, uncached. Until the first successful tap there is no row → gold values at cost and overall XIRR is unavailable.
- **Read** (`getStockPrices(symbols)` in `lib/data.ts`): uncached, filtered by symbol. Symbols with no saved row are absent — callers go through `resolveCmp` (`lib/stock-prices.ts`), which falls back to `buy_bands.cmp` (a stored snapshot that only updates on Bands regen). The Portfolio list and the stock detail page both use it, so they can't show different prices.
- **Why not `buy_bands.cmp`:** it is user-scoped, only covers stocks that have bands, and the Bands screen's own CMP upsert could race a portfolio write.
- **Untouched:** `GET /api/cmp/batch` and `/api/cmp/[symbol]` — still used live by the Bands screen (Tax moved to saved prices in #124).
- **Freshness on the Portfolio screen** (progress log #121.b; pure helpers in `lib/price-freshness.ts`). No caption line — the **Prices button is the status**. `page.tsx` computes `pricesStale` on the server (so the clock read can't differ between render and hydration): the newest saved stock/gold `fetched_at` predates the last Mon–Fri 3:30 pm IST close (`lastMarketClose`; exchange holidays ignored), or there is none — and only when the user holds stocks or gold, since an MF-only user has nothing to go stale. The client turns that into an amber dot on the button; the refresh response drives the rest (`Updating…`, a ~2 s `Updated` check, and `Retry` + dot when `stocks.failed` is non-empty, `gold` is `'failed'` or the request itself failed). Separately, any holding whose price is **older than the rest's** shows its own date in place of "1D" on its row: a fund's `nav_date` (`mfNavDates`, from `getMFNavs`) against the newest among held funds, a stock's `fetched_at` IST day (`istDay`) against the newest among held stocks (`laggingDates`). The summary 1D Gain is unaffected — each holding still contributes its own latest one-day move.

**Call sites:** `app/portfolio/page.tsx` (list — stocks + gold), `app/portfolio/stock/[symbol]/page.tsx` (stock detail), `app/portfolio/gold/[key]/page.tsx` (gold detail), `app/tax/page.tsx` (Harvesting's unrealised-loss figure — open-position symbols only, via `resolveCmp` with the band snapshot as fallback; Tax has no Prices button, so its prices move only when Portfolio's is tapped).

---

## Route → Screen Map

| Route | Screen | Notes |
|---|---|---|
| `app/allocation/` | Allocation | Bottom nav tab 1 |
| `app/bands/` | Buy Bands | Bottom nav tab 2 |
| `app/portfolio/` | Portfolio | Bottom nav tab 3 |
| `app/add/` | Add Transaction | FAB (bottom nav center) |
| `app/transactions/` | Transactions | Bottom nav tab 4 |
| `app/plan/` | Plan | Accessed from the settings menu |
| `app/dividends/` | Dividends | By Stock / Timeline view; accessed from the settings menu |
| `app/stocks/[symbol]/` | Stock Detail | Drill-down from Allocation or Buy Bands; URL e.g. `/stocks/ITC?fy=FY26` |
| `app/import/` | Zerodha Import | Zerodha transaction CSV import, launched from Transactions |
| `app/login/` | Login | Auth entry point |

---

## Key File Map

```text
proxy.ts                                auth guard — add new routes here if they need protection

app/
  actions.ts                            all server actions (DB writes + revalidateTag calls)
  api/
    bands/generate/[symbol]/route.ts    valuation + financial refresh
    tranches/generate/[symbol]/route.ts tranche regeneration from stored bands
    settings/gemini-key/route.ts        AI key + risk_free settings
    portfolio/prices/refresh/route.ts   Prices button: fetch + save stock/gold prices and sync MF NAVs — see "Price Fetch Flow"
  bands/
    BandsClient.tsx                     bands list
    [symbol]/BandDetailClient.tsx       stock detail orchestrator — computes snowball, wires all sheets
    [symbol]/FinancialsSheet.tsx        financial inputs editor + Regen Financials / Regen Bands buttons
    [symbol]/BandComputationSheet.tsx   band computation breakdown (factor, path, ROCE premium)
    [symbol]/InvestabilitySheet.tsx     10-gate scorecard sheet
    [symbol]/RiskOverlaySheet.tsx       risk multiplier configuration sheet
    [symbol]/SnowballSheet.tsx          Snowball conditions + signal detail sheet
    [symbol]/TranchesSheet.tsx          Buy Levels sheet (signal pill + descriptor + TrancheSection)
  portfolio/
    PortfolioClient.tsx                 portfolio summary, holdings lists (HoldingRow + HoldingsToolbar) and PPF/EPF
  transactions/
    TransactionsClient.tsx              transaction list, filters, import entry point
  dividends/
    page.tsx                            server page — loads getAllDividends + getTransactions
    DividendsClient.tsx                 By Stock / Timeline segments, symbol filter, StockDividends sheet

lib/
  amfi.ts                                AMFI NAV history parsing + staleness guard — see "MF NAV Fetch Flow" above
  mf-nav-sync.ts                        syncMfNav + latestNavRows: AMFI window → mf_navs — see "MF NAV Fetch Flow"
  band-calculator.ts                    v9 band math
  snowball.ts                           Snowball signal model + shared display helpers (signalLabel, signalColor, signalStrategyWord)
  stock-prices.ts                       saved-price helpers: heldSymbols, resolveCmp, buildPriceUpdate — see "Price Fetch Flow"
  price-freshness.ts                    lastMarketClose, pricesAreStale, laggingDates, istDay — Prices-button status + per-row dates ("Price Fetch Flow")
  holdings-sort.ts                      Portfolio list sort (sortHoldings, nextSort) + returnMetric
  compute.ts                            dashboard row computation + band signals
  data.ts                               cached Supabase fetchers
  fetchStockDetailProps.ts              server-side stock detail loader
  formatter.ts                          formatPrice() and all number formatting
  fy-utils.ts                           FY date ranges, fy_id helpers, carryover logic
  market-data.ts                        Yahoo Finance CMP + 52-week range fetching
  types.ts                              DB and UI types

components/
  AddTxnModal.tsx                       add transaction bottom sheet (all asset types)
  BandBar.tsx                           band bar visualisation with CMP pin
  BottomNav.tsx                         fixed bottom navigation
  detail-rows.tsx                       DetailRow, CompRow, SectionLabel — shared label:value layout primitives
  FYPicker.tsx                          fiscal year selector
  TrancheSection.tsx                    tranche list + add/generate actions
  StockDividends.tsx                    dividend list + refresh/confirm sheet for a single symbol
  UserMenu.tsx                          settings menu, Gemini key, plan entry, screen-scoped settings actions
  icons.tsx                             all SVG icons — check here before adding inline SVGs

supabase/
  schema.sql                            canonical schema
  migrations/                           incremental DB changes
  seed.sql                              sample FY/allocations
  seed-bands.sql                        optional sample PE-only buy bands
```
