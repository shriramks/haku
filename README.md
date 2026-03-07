# Folio

A personal Indian stock portfolio planning app — mobile-first PWA.

---

## The Problem

Planning investments for the year is messy. The process ends up split across:
- An Excel sheet tracking per-stock allocation budgets
- Notes scattered across devices for buy band targets
- No single place to see: what's the plan, how much is left, and is the current price a buy?

The result: too much friction, repeated context-switching, and a process that's hard to follow consistently year after year.

---

## The Solution

Folio brings the entire annual investment workflow into one place:

1. **Plan your year** — set a total budget, add stocks, assign allocation percentages by category
2. **AI-powered buy bands** — Gemini AI fetches live financials and computes valuation zones per stock
3. **Log transactions** — manual entry, grouped by month with buy/sell totals
4. **Track deployment** — see exactly how much of each stock's budget is deployed vs remaining
5. **Carryover** — unspent budget from one FY carries into the next plan automatically

No brokerage integration. No auto-sync. Intentionally deliberate.

---

## App Flow

### Allocation
The home screen. Shows the current fiscal year's deployment status:
- Total budget vs deployed vs remaining
- Per-stock deployment bars with P&L (if CMP available)
- Highlights stocks in "Buy" or "Deep Value" signal zones
- Two-column layout on wider screens

### Buy Bands
Per-stock valuation zones computed from sector-specific multiples:
- Collapsible stock cards (default collapsed for quick scanning)
- Visual band bar: Buy zone (green) / Mid zone (orange) / Trim+ (red)
- Current market price (CMP) fetched from Yahoo Finance (NSE)
- **AI band generation** — uses Gemini 2.5 Flash with Google Search grounding to fetch EPS, EBITDA, net debt from Screener.in and compute bands automatically
- Two Weak Quarters toggle — tightens all bands by 10%
- Two Strong Quarters toggle — applies premium overlay for eligible categories
- Tranches — plan buy orders with qty + price, mark as allocated, scoped per FY
- Two-column layout on wider screens (independent columns, no height coupling)

### Transactions
All buy/sell transactions, grouped by month. Tap + to log a new trade.

### Plan
Where the annual plan is created and managed:
- Total budget with carryover from previous FY
- Stock list with % allocations and categories — all editable inline
- Add/remove stocks (transactions preserved if stock is removed)
- Category summary with sector-type breakdown (Defensive / Cyclical / Growth / Passive)
- "Add New Plan" to start a new fiscal year, optionally copying stocks with computed carryover

---

## AI Features

Band generation uses **Gemini 2.5 Flash** with Google Search grounding:
- **Stocks**: fetches EPS, operating profit, borrowings, cash, shares from Screener.in → applies category-specific PE/EV-EBITDA/PB multiples
- **Index/ETFs**: fetches Nifty PE + ETF price → derives implied EPS → applies PE band

To use AI generation, add your own Gemini API key in **Settings** (tap the profile icon). Free keys available at [aistudio.google.com](https://aistudio.google.com).

---

## Security

- All data stored in Supabase with Row Level Security (RLS) — users can only access their own data
- Gemini API keys stored encrypted at rest, never returned to the client after save
- No third-party analytics or tracking

---

See [docs/install.md](docs/install.md) for setup and [docs/architecture.md](docs/architecture.md) for technical details.
