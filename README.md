# Folio

A personal Indian stock portfolio planning app — mobile-first PWA.

---

## Contents

- [The Problem](#the-problem)
- [The Solution](#the-solution)
- [App Flow](#app-flow)
- [AI Features](#ai-features)
- [Security](#security)
- [Docs](#docs)

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

## AI Features

Band generation uses **Gemini 2.5 Flash** with Google Search grounding:
- **Stocks**: fetches EPS, operating profit, borrowings, cash, shares from Screener.in → applies category-specific PE/EV-EBITDA/PB multiples
- **Index/ETFs**: fetches Nifty PE + ETF price → derives implied EPS → applies PE band
- **Auto-tranches**: generates up to 5 buy tranches per stock, distributed within the Buy zone (skewed toward lower prices), qty sized from remaining FY budget

To use AI generation, add your own Gemini API key in **Settings** (tap the profile icon). Free keys available at [aistudio.google.com](https://aistudio.google.com).

---

## Security

- All data stored in Supabase with Row Level Security (RLS) — users can only access their own data
- Gemini API keys stored encrypted at rest, never returned to the client after save
- No third-party analytics or tracking

---

## Docs

| Document | Description |
|----------|-------------|
| [docs/user-guide.md](docs/user-guide.md) | New user walkthrough — setup, screens, and flow |
| [docs/install.md](docs/install.md) | Self-hosting setup |
| [docs/architecture.md](docs/architecture.md) | Technical details — schema, band calculator, AI flow, security |
