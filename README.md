# Spend Stock

A personal Indian stock portfolio planning app — mobile-first PWA built with Next.js.

---

## The Problem

Planning investments for the year is messy. The process is currently split across:
- An Excel sheet tracking per-stock allocation budgets
- Apple Shortcuts for quick buy/sell logging
- Notes scattered across devices for buy band targets and playbook rules
- No single place to see: what's the plan, how much is left, and is the current price a buy?

The result: too much friction, repeated context-switching, and a process that's hard to follow consistently year after year.

---

## The Solution

Spend Stock brings the entire annual investment workflow into one place:

1. **Plan your year** — set a total budget, add stocks, assign allocation percentages
2. **Know your prices** — buy bands auto-computed from your playbook rules per stock category
3. **Log transactions** — manual entry, grouped by month with buy/sell totals
4. **Track deployment** — see exactly how much of each stock's budget is deployed vs remaining
5. **One playbook** — your investment rules live in-app, editable, always accessible

No brokerage integration. No auto-sync. Intentionally simple and manual — because good investing is deliberate.

---

## App Flow

### Allocation
The home screen. Shows the current fiscal year's deployment status:
- Total budget vs deployed vs remaining
- Per-stock deployment bars with P&L (if CMP available)
- Highlights stocks in "Buy" or "Deep Value" signal zones
- Two-column layout on wider screens

### Buy Bands
Per-stock valuation zones computed from your playbook:
- Collapsible stock cards (default collapsed for quick scanning)
- Visual band bar: Buy zone (green) / Mid zone (orange) / Trim+ (red)
- Current market price (CMP) fetched live from Yahoo Finance (NSE)
- Two Weak Quarters toggle — tightens bands per playbook rules
- Tranches — plan your buy orders with qty + price, mark as allocated
- Two-column layout on wider screens

### Transactions
All buy/sell transactions, grouped by month. Tap + to log a new trade.

### Plan
Where the annual plan is created and managed:
- **FY Plan**: total budget, stock list with % allocations — all editable
- Add/remove stocks (transactions are preserved if a stock is removed)
- "Add New Plan" to start a new fiscal year, optionally copying stocks from the previous year
- Refresh All CMPs to update live prices for buy band signals
- **Playbook**: your personal investment rules — stored privately in the database, editable in-app

---

## Stack

- **Next.js 16** (App Router, Turbopack)
- **TypeScript**, **Tailwind CSS 3**
- **Supabase** — auth + PostgreSQL with Row Level Security per user
- **Yahoo Finance** (free, no API key) — live NSE stock prices
- Mobile-first PWA — iOS safe-area support, OS-based light/dark theme, installable

---

## Setup

### 1. Supabase

Create a new project at supabase.com. Run the SQL files in order via SQL Editor:

```
supabase/schema.sql       — tables, RLS policies, indexes
supabase/migration-v2.sql — buy_bands versioning + playbook table
supabase/seed.sql         — FY + allocations (replace YOUR_USER_UUID)
supabase/seed-bands.sql   — buy band values
```

### 2. Environment

Create `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
```

### 3. Run locally

```bash
npm install
npm run dev   # http://localhost:3000
```

---

## Install as iPhone App (PWA)

1. Open in Safari → Share → **Add to Home Screen**
2. Done — tap the icon, already logged in, full-screen

---

## Deploy

```bash
npx vercel
# Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in Vercel env settings
```

---

## Database Schema

| Table | Purpose |
|---|---|
| `fiscal_years` | One row per FY plan (Apr–Mar cycle, e.g. FY26) |
| `stock_allocations` | User-defined stock list + % per FY |
| `transactions` | Manual buy/sell log; `amount` is a generated column |
| `buy_bands` | Valuation band inputs + computed price ranges (versioned with `is_current`) |
| `buy_tranches` | Planned buy orders per stock with allocated toggle |
| `playbook` | One row per user — private investment rules text |
| `investability` | 12-gate qualitative checklist per stock |

All tables use Row Level Security — users see only their own rows.

---

## Band Calculator

Implemented in `lib/band-calculator.ts`, derived from the Playbook (Part B — Price-Band Decision):

- **PE** — EPS × multiple range (FMCG, Electricals, Market Infra)
- **PB** — BVPS × multiple range (Banks, Asset-heavy)
- **EV/EBITDA** — enterprise value back-calculated to per-share price (Defence, Retail, Auto)
- **P/EV** — embedded value anchor (Insurance)
- Stricter-of-two-anchors logic where applicable
- Tightening modifier for Two Weak Quarters
- Hospital ramp phase uses EV/EBITDA instead of PE
