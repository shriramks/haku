# Architecture

## Stack

- **Next.js 16** — App Router, Server + Client Components
- **TypeScript**, **Tailwind CSS 3**
- **Supabase** — auth + PostgreSQL with Row Level Security per user
- **Yahoo Finance** — live CMP + 52-week range
- **Gemini** — optional user-provided AI key for financial data refresh

---

## Core Tables

| Table | Purpose |
|---|---|
| `fiscal_years` | FY plans and budgets |
| `stock_allocations` | FY-scoped stock list with allocation % and category |
| `transactions` | Real buy/sell log; source of truth for deployment |
| `buy_bands` | Stored valuation inputs, generated bands, CMP, 52-week range |
| `buy_tranches` | FY-scoped planned buy levels |
| `user_settings` | Gemini API key plus `risk_free` |
| `investability` | 10-gate qualitative scorecard |

`buy_bands` is no longer versioned by inserting new rows. There is one row per `(user_id, symbol)`, updated in place.

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
- Uses Gemini to fetch raw inputs
- Stores the raw inputs in `buy_bands`
- Leaves existing band prices untouched
- Updates `last_updated_at`, which marks the row as stale until regeneration

Stored inputs:

- Stocks: `eps`, `pat_now`, `pat_3yr_ago`, `roce_3yr_avg`, `mcap`
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

## Route → Screen Map

| Route | Screen | Notes |
|---|---|---|
| `app/allocation/` | Allocation | Bottom nav tab 1 |
| `app/bands/` | Buy Bands | Bottom nav tab 2 |
| `app/portfolio/` | Portfolio | Bottom nav tab 3 |
| `app/add/` | Add Transaction | FAB (bottom nav center) |
| `app/transactions/` | Transactions | Bottom nav tab 4 |
| `app/plan/` | Plan | Accessed from the settings menu |
| `app/stocks/[symbol]/` | Stock Detail | Drill-down from Allocation or Buy Bands; URL e.g. `/stocks/ITC?fy=FY26` |
| `app/import/` | Zerodha Import | Zerodha transaction CSV import, launched from Transactions |
| `app/login/` | Login | Auth entry point |

---

## Key File Map

```text
middleware.ts                           auth guard — add new routes here if they need protection

app/
  actions.ts                            all server actions (DB writes + revalidateTag calls)
  api/
    bands/generate/[symbol]/route.ts    valuation + financial refresh
    tranches/generate/[symbol]/route.ts tranche regeneration from stored bands
    settings/gemini-key/route.ts        AI key + risk_free settings
  bands/
    BandsClient.tsx                     bands list
    [symbol]/BandDetailClient.tsx       stock detail, financials, tranches, investability
  portfolio/
    PortfolioClient.tsx                 portfolio summary and non-stock assets
  transactions/
    TransactionsClient.tsx              transaction list, filters, import entry point

lib/
  band-calculator.ts                    v9 band math
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
  FYPicker.tsx                          fiscal year selector
  TrancheSection.tsx                    tranche list + add/generate actions
  UserMenu.tsx                          settings menu, Gemini key, plan entry, screen-scoped settings actions
  icons.tsx                             all SVG icons — check here before adding inline SVGs

supabase/
  schema.sql                            canonical schema
  migrations/                           incremental DB changes
  seed.sql                              sample FY/allocations
  seed-bands.sql                        optional sample PE-only buy bands
```
