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
| `fiscal_years` | One row per FY plan (Apr–Mar cycle, e.g. FY26 = Apr 2025–Mar 2026) |
| `stock_allocations` | User-defined stock list + % per FY, with weak/strong quarter flags |
| `transactions` | Manual buy/sell log; `amount` is a generated column (`qty × price`) |
| `buy_bands` | Valuation band inputs + computed price ranges (versioned with `is_current`) |
| `buy_tranches` | Planned buy orders per stock, scoped to a FY via `fy_id` |
| `user_settings` | One row per user — stores optional Gemini API key |
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

## AI Band Generation

`app/api/bands/generate/[symbol]/route.ts` — POST endpoint called per stock.

Uses **Gemini 2.5 Flash** with Google Search grounding to fetch live financial data and compute buy bands automatically.

**Flow:**
1. Resolves the Gemini API key (user's personal key from `user_settings` takes priority; falls back to `GEMINI_API_KEY` env var)
2. Reads `stock_allocations` for the stock's category and qualifier flags
3. Sends a grounded prompt to Gemini to fetch from Screener.in: EPS, operating profit, borrowings, cash, shares outstanding
4. For Index/ETF: fetches Nifty PE + ETF price instead, derives implied EPS
5. Parses JSON from Gemini response, computes `netDebt = borrowings − cash`
6. Runs `calculateBands()` with the financial inputs and allocation flags
7. Saves to `buy_bands`: marks existing `is_current=true` rows to `false`, inserts new with `is_current=true`

**Insurance note:** P/EV requires embedded value which Gemini cannot reliably find. Falls back to PE using FMCG multiples as a proxy.

---

## User API Key Security

Users can optionally supply their own Gemini API key (for their own quota). Here is how it is kept secure:

| Concern | Mitigation |
|---|---|
| Key leakage to other users | `user_settings` has RLS: `auth.uid() = user_id` on all operations |
| Key exposed to client JS | The `GET /api/settings/gemini-key` endpoint returns only `{ hasKey: boolean }` — never the raw key |
| Key in transit | Sent over HTTPS from browser → Next.js API route → Supabase |
| Key at rest | Stored in Supabase Postgres, encrypted at rest by the hosting layer |
| Key in API responses | The generate route reads the key server-side only; it never appears in the JSON response |

The server-side `GEMINI_API_KEY` env var acts as a shared fallback (useful for self-hosted deployments where all users share one key).

---

## Key File Map

```
app/
  api/
    cmp/[symbol]/route.ts              — Yahoo Finance CMP proxy (60s cache)
    bands/generate/[symbol]/route.ts   — Gemini AI band generation (POST)
    settings/gemini-key/route.ts       — GET hasKey, POST save/clear key
  dashboard/                           — Allocation screen
  bands/                               — Buy Bands screen (FY-scoped tranches)
  txns/                                — Transactions screen
  plan/                                — FY Plan management
  stocks/[symbol]/                     — Stock detail

lib/
  band-calculator.ts                   — Band math (PE / EV-EBITDA / PB / P_EV)
  compute.ts                           — Dashboard row computations
  data.ts                              — Server-side Supabase fetchers
  types.ts                             — All TS types
  formatter.ts                         — formatINR, formatPct, formatDate
  supabase-server.ts                   — Server Component Supabase client
  supabase-browser.ts                  — Browser Supabase singleton

components/
  BottomNav.tsx                        — 5-tab fixed bottom nav
  UserMenu.tsx                         — Account dropdown (email, Gemini key, sign out)
  AllocationsSheet.tsx                 — Bottom sheet for allocation editing
  AddTxnModal.tsx                      — Transaction entry modal

supabase/
  schema.sql                           — Initial schema
  migration-v2.sql through v7          — Incremental migrations
  fix-tranches-fy.sql                  — One-time fix if tranches ended up in wrong FY
```
