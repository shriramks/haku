# Spend Stock

A personal Indian stock portfolio tracker — mobile-first PWA built with Next.js 15.

## What it does

- **Portfolio dashboard** — per-stock budget allocation, deployment progress, unrealised P&L
- **Buy bands** — valuation zones (PE / PB / EV-EBITDA / P/EV) with a visual range bar and signal (Buy / Mid / Trim)
- **Tranche planning** — per-stock checklist of planned buy tranches; tap to mark allocated
- **Transaction log** — chronological trade log grouped by month with inline delete
- **Investability gates** — 12-gate qualitative checklist per stock
- **Fiscal year support** — Apr–Mar cycle (FY25, FY26+), per-FY allocation and budget

## Stack

- **Next.js 15** (App Router, server + client components)
- **Supabase** (Postgres + Auth + RLS)
- **Tailwind CSS** (iOS-inspired dark theme)
- **TypeScript**

## Setup

### 1. Supabase

Create a new project at [supabase.com](https://supabase.com). Run the SQL files in order via Dashboard → SQL Editor:

```
supabase/schema.sql        — tables, RLS policies, indexes
supabase/seed.sql          — FY25 + FY26 + allocations  (replace YOUR_USER_UUID)
supabase/seed-bands.sql    — buy band values for all 12 stocks
supabase/seed-tranches.sql — planned buy tranches        (replace YOUR_USER_UUID)
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
npm run dev
# open http://localhost:3000
```

Sign up → redirected to dashboard. Your user UUID is at Supabase → Authentication → Users.

## Install to iPhone (PWA)

1. Open the deployed URL in **Safari**
2. Share → **Add to Home Screen**
3. Done — tap the Spend Stock icon, already logged in

## Deploy

```bash
npx vercel
# Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in Vercel env settings
```

## Database schema

| Table | Purpose |
|---|---|
| `fiscal_years` | Apr–Mar FY with total budget |
| `stock_allocations` | % allocation per stock per FY |
| `transactions` | Manual buy/sell entries |
| `buy_bands` | Valuation band inputs + computed price ranges |
| `buy_tranches` | Planned buy tranches with allocated toggle |
| `investability` | 12-gate qualitative assessment per stock |

All tables use Row Level Security — users see only their own rows.

## Screens

| Route | Purpose |
|---|---|
| `/dashboard` | FY overview, per-stock budget + P&L |
| `/bands` | All stocks — band signal, range bar, tranches |
| `/txns` | Full transaction log |
| `/stocks/[symbol]` | Overview · Bands · Transactions · Gates |
| `/settings` | FY management, allocations, sign out |

## Band calculator

Computed client-side in `lib/band-calculator.ts` using one of four anchors:

- **PE** — EPS × multiple range
- **PB** — BVPS × multiple range
- **EV/EBITDA** — enterprise value back-calculated to share price
- **P/EV** — embedded value anchor (insurance stocks)

Uses "stricter of two anchors" logic, with modifiers for weak quarters, hospital ramp phase, etc.
