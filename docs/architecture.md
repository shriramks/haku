# Architecture

## Stack

- **Next.js 16** — App Router, Turbopack, Server + Client Components
- **TypeScript**, **Tailwind CSS 3**
- **Supabase** — auth + PostgreSQL with Row Level Security per user
- **Yahoo Finance** (free, no API key) — live NSE prices + financial data
- Mobile-first PWA — iOS safe-area support, OS-based light/dark theme, installable

---

## Database Schema

| Table | Purpose |
|---|---|
| `fiscal_years` | One row per FY plan (Apr–Mar cycle, e.g. FY26) |
| `stock_allocations` | User-defined stock list + % per FY, with weak/strong quarter flags |
| `transactions` | Manual buy/sell log; `amount` is a generated column (`qty × price`) |
| `buy_bands` | Valuation band inputs + computed price ranges (versioned with `is_current`) |
| `buy_tranches` | Planned buy orders per stock with allocated toggle |
| `playbook` | One row per user — private investment rules text |
| `investability` | 12-gate qualitative checklist per stock |

All tables use Row Level Security — users see only their own rows.

---

## Band Calculator

`lib/band-calculator.ts` — implements the Playbook (Part B: Price-Band Decision).

**Anchors:**
- **PE** — `EPS × multiple range` (FMCG, Electricals, Market Infra, Defence, Retail, Auto OEM)
- **EV/EBITDA** — `(multiple × EBITDA − net_debt) / shares` (Defence, Retail, Auto OEM, Hospitals ramp, Pharma, Asset-heavy)
- **PB** — `BVPS × multiple range` (Asset-heavy Infra fallback)
- **P/EV** — `embedded_value / shares × multiple` (Insurance; falls back to PE if EV unavailable)

**Modifiers:**
- Two Weak Quarters → tighten all band prices by 10%
- Two Strong Quarters → apply premium multiples for eligible categories (Capital-light Market Infra/Services: PE 32–48 vs normal 28–45)
- Hospital Ramp Phase → use EV/EBITDA instead of PE
- Stricter-of-two-anchors where multiple apply

---

## Auto Band Generation

`app/api/bands/generate/[symbol]/route.ts` — POST endpoint called per stock.

1. Fetches `quoteSummary` from Yahoo Finance (modules: `financialData`, `defaultKeyStatistics`, `incomeStatementHistory`, `balanceSheetHistory`, `assetProfile`)
2. Extracts EPS, BVPS, EBITDA (₹Cr), net debt (₹Cr), shares (Cr), sector, industry
3. Calls `categoryFromSector()` (`lib/sector-map.ts`) for deterministic sector → category mapping
4. Falls back to existing `stock_allocations.category` if auto-detection fails
5. Runs `calculateBands()` with current allocation flags (weak/strong quarters, hospital ramp)
6. Saves to `buy_bands`: marks existing `is_current=true` rows to `false`, inserts new with `is_current=true`

**Insurance note:** P/EV is skipped (no embedded value from free APIs). Falls back to PE if EPS is available, using FMCG multiples as a proxy for high-quality financial companies.

---

## Sector → Category Mapping

`lib/sector-map.ts` — deterministic lookup from Yahoo Finance sector/industry strings.

Rules are evaluated in order; first match wins. Matching is case-insensitive substring. Each rule can match on `sector`, `industry`, or both. Covers all 10 categories: Defence, Insurance, Hospitals, Pharma, Auto OEM, Retail, FMCG, Electricals/Capital Goods, Asset-heavy Infra/Platforms, Capital-light Market Infra/Services.

---

## Key File Map

```
app/
  api/
    cmp/[symbol]/route.ts          — Yahoo Finance CMP proxy (60s cache)
    bands/generate/[symbol]/route.ts — Auto band generation (POST)
  dashboard/                        — Allocation screen
  bands/                            — Buy Bands screen
  transactions/                     — Transactions screen
  plan/                             — FY Plan + Playbook
  stocks/[symbol]/                  — Stock detail (4 tabs)

lib/
  band-calculator.ts                — Band math
  sector-map.ts                     — Sector → category lookup
  compute.ts                        — Dashboard row computations
  data.ts                           — Server-side Supabase fetchers
  types.ts                          — All TS types
  formatter.ts                      — formatINR, formatPnL, formatDate
  supabase-server.ts                — Server Component Supabase client
  supabase-browser.ts               — Browser Supabase singleton

components/
  BottomNav.tsx                     — 5-tab fixed bottom nav
  BandRangeBar.tsx                  — Buy/Mid/Trim CSS bar with CMP pin
  AllocationsSheet.tsx              — Bottom sheet for allocation editing
  AddTxnModal.tsx                   — Transaction entry modal

supabase/
  schema.sql                        — Initial schema
  migration-v2.sql                  — buy_bands versioning + playbook table
  migration-v3.sql                  — two_strong_quarters column
```
