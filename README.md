# Spend Stock

A personal Indian stock portfolio planning app — mobile-first PWA.

---

## The Problem

Planning investments for the year is messy. The process ends up split across:
- An Excel sheet tracking per-stock allocation budgets
- Notes scattered across devices for buy band targets and playbook rules
- No single place to see: what's the plan, how much is left, and is the current price a buy?

The result: too much friction, repeated context-switching, and a process that's hard to follow consistently year after year.

---

## The Solution

Spend Stock brings the entire annual investment workflow into one place:

1. **Plan your year** — set a total budget, add stocks, assign allocation percentages
2. **Know your prices** — buy bands auto-computed from playbook rules per stock category
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
- Bands auto-generated from Yahoo Finance financials + deterministic sector mapping
- Two Weak Quarters toggle — tightens bands per playbook rules
- Two Strong Quarters toggle — applies premium overlay for eligible categories
- Tranches — plan your buy orders with qty + price, mark as allocated
- Two-column layout on wider screens

### Transactions
All buy/sell transactions, grouped by month. Tap + to log a new trade.

### Plan
Where the annual plan is created and managed:
- **FY Plan**: total budget, stock list with % allocations — all editable inline
- Add/remove stocks (transactions are preserved if a stock is removed)
- "Add New Plan" to start a new fiscal year, optionally copying stocks from the previous year
- **Playbook**: your personal investment rules — stored privately in the database, editable in-app

---

See [docs/install.md](docs/install.md) for setup and [docs/architecture.md](docs/architecture.md) for technical details.
