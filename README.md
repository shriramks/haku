# Folio Web (PWA)

Mobile-first PWA for tracking a personal Indian stock portfolio.
Install to iPhone home screen — tap icon, already logged in.

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env.local
# Fill in values from your spend-stock app (same Supabase project)

# 3. Run Supabase schema (one-time, if not done already)
# Go to: Supabase Dashboard → SQL Editor
# Paste and run: /Users/shriramks/Projects/Folio/supabase-schema.sql
# Then run the seed file after signing up

# 4. Start dev server
npm run dev
# Open http://localhost:3000 on your phone (same WiFi) or use ngrok
```

## Deploy to Vercel

```bash
# Different project from spend-stock — separate Vercel project
npx vercel
# Add the same NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY env vars
```

## Install to iPhone

1. Open the deployed URL in Safari on iPhone
2. Tap the Share button (box with arrow)
3. Tap "Add to Home Screen"
4. Done — tap the Folio icon, already logged in

## Screens

| Route | Purpose |
|-------|---------|
| `/dashboard` | FY overview, per-stock budget + P&L |
| `/add` | **Primary action** — add buy/sell transaction |
| `/bands` | All stocks, band signal, price ranges |
| `/stocks/[symbol]` | Overview · Bands · Transactions · Gates |
| `/settings` | FY management, allocations, sign out |

## Band calculation

TypeScript port of the playbook in `lib/band-calculator.ts`.
Same logic as the Swift BandCalculator — all 10 categories, stricter anchor selection, tightening.
