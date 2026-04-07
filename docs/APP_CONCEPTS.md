# Haku — App Concepts

## Purpose

Haku answers two questions in daily use:
1. **How much have I allocated?** — total and per stock, FY and all-time
2. **Is any stock in its buy zone right now?**

It is not a portfolio tracker. P&L, unrealised gains, and market value are
secondary context — never the lead. Every screen's hierarchy follows from this.

---

## Vocabulary

Consistent terms across the entire app. Never mix these with synonyms.

| Term | Meaning | Never use |
|------|---------|-----------|
| **Allocation** | The planned amount for a stock (per FY or total) | Budget, limit |
| **Allocated** | Amount actually invested so far | Spent, deployed |
| **Remaining** | Allocation minus Allocated | Balance, left |
| **CMP** | Current Market Price | Price, LTP |
| **Signal** | Deep / Buy / Hold / Trim — derived from CMP vs bands | Zone, status |
| **Tranche** | A planned buy order at a specific price and qty | Order, lot |
| **Bands** | The PE/PB/EV-derived price zones for a stock | Levels, targets |
| **Financials** | EPS, BVPS, EBITDA inputs that generate bands | Fundamentals, data |

---

## Investment Math

### Two distinct "invested" concepts

The app tracks two different numbers that are both legitimately called "invested",
for different purposes. They must never be conflated.

#### `spent` — FY planning budget

`spent = max(0, FY_buy_amount - FY_sell_amount)`

- Used for: remaining budget calculation, carryover into next FY
- Scope: current FY only (filtered by `fy_id` / `advance_fy_id`)
- Clamped to 0 because negative spent would make remaining > budget, which
  gives a false "you have more budget than your plan" signal
- Tax harvest example: buy ₹1L then sell ₹2.5L in same FY → `spent = 0`,
  `remaining = full budget`. The ₹1.5L net proceeds freed up future budget,
  so 0 is correct for planning purposes.

#### `currentCost` — what you currently have deployed (display only)

`currentCost` = the cost of shares you currently hold, computed using the
**sequential average-cost method**. It is not a simple sum of all buy amounts.

**How it works — process transactions in date order:**

- **Buy:** add the buy amount to your running cost basis.
- **Sell:** a sell retires shares at the current average cost.
  `costBasis -= soldQty × (costBasis / heldQty)`
  The remaining shares keep the same per-share cost.

**Why sequential matters — the re-entry problem:**

If you bought ₹3L of CAMS, sold all of it, then re-bought ₹2.42L:
- Wrong (aggregate): `allTimeAvg = (3L + 2.42L) / allBuyQty = ₹X`, `currentCost = heldQty × X` → inflated, blends old and new buys
- Correct (sequential): after the full exit, cost basis drops to ₹0. The ₹2.42L re-entry is the only thing that matters. `currentCost = 2.42L` ✓

A sell permanently retires shares and their associated cost. It does not "net against" future buys.

**Scope:** all transactions across all FYs.

#### Why the split matters

| Scenario | `spent` | `currentCost` | Correct? |
|----------|---------|---------------|----------|
| Buy ₹1L, hold | ₹1L | ₹1L | ✓ same |
| Buy ₹1L, sell all ₹2.5L (harvest) | ₹0 | ₹0 | ✓ nothing held |
| Buy ₹1L, sell ₹2.5L, buy ₹75K | ₹0 (FY net still negative) | ₹75K | ✓ shows the live position |
| Buy ₹3L, sell all, re-buy ₹2.42L | FY net spend | ₹2.42L | ✓ old cost doesn't bleed in |

---

### FY budget and carryover (YNAB-style category debt)

Each stock gets a budget = `(allocation_pct / 100) × total_FY_budget + carryover`.

Carryover carries the *remaining* (not spent) from the previous FY into the next.
Remaining can be negative — this is called "carryover debt."

**Example:**
- FY24: ITC budget = ₹10L. You buy ₹20L (overspent by ₹10L).
  - FY24 remaining = ₹10L - ₹20L = **−₹10L**
- FY25: ITC allocation = 15% of ₹1Cr = ₹15L.
  - Carryover = −₹10L (the FY24 debt)
  - FY25 effective budget = ₹15L − ₹10L = **₹5L**

This is exactly how YNAB handles category overspending — the extra spend is a
loan from the future, not a free lunch. The debt shows up as reduced budget in
the next period.

**Orphan pool:** If a stock exits (no allocation in next FY), its remaining
(positive or negative) goes into a pool distributed proportionally by
`allocation_pct` among all next-FY stocks.

---

## Navigation Structure

```
Bottom nav (always visible)
├── Allocation      — Overview of all stocks + FY allocation status
├── Buy Bands       — All stocks with band bars, tranche management
├── + (FAB)         — Add transaction
├── Transactions    — Full transaction history, filterable
└── Plan            — FY planning, allocation percentages, carryover
```

**Stock Detail** is a drill-down from both Allocation and Buy Bands.
It is not in the bottom nav — it is always reached via tap on a stock row.

**Financials Edit** is a sheet within Stock Detail — not a standalone screen.

---

## Daily Flow

```
Open app
  └── Allocation screen
        ├── Scan: which stocks have remaining FY allocation?
        ├── Scan: overall FY deployed vs remaining
        └── Tap stock → Stock Detail
              ├── See: is it in buy zone? (band bar + signal)
              ├── See: how much FY allocation remains?
              └── If in buy zone → go to Buy Bands tab
                    └── Add tranche or buy on trading platform
```

---

## Screen-by-Screen IA

### 1. Allocation Screen
**Purpose:** Daily overview — allocation status for all stocks.

**Priority order:**
1. FY selector (which year am I viewing)
2. FY summary strip — Total FY Allocation, Total Invested (currentCost), Remaining (FY)
3. Per-stock list rows — each row shows:
   - Primary: Stock symbol + signal dot
   - Secondary: Remaining (FY) + Invested (currentCost)
   - Bar fill: currentCost as % of FY budget
4. Completed / exited stocks — collapsed by default

**What is NOT here:** Band bars, tranche details, CMP, P&L.

---

### 2. Buy Bands Screen
**Purpose:** Scanning and acting — which stocks are in buy zone, add tranches.

**Priority order:**
1. FY selector
2. Per-stock rows (expanded view) — each card shows:
   - Primary: Stock symbol + signal badge + CMP
   - Key visual: Band bar with CMP position
   - Secondary: Band ranges (Deep / Buy / Mid / Trim prices)
   - Action: Tranches — Generate / Add / list
3. Scenario toggle (Bear / Normal / Bull) — affects band calculations

**What is NOT here:** Allocation amounts, P&L.

---

### 3. Stock Detail Screen
**Purpose:** Drill-down on one stock — band position + allocation context.

**Priority order:**
1. Stock name + signal badge (header — always visible)
2. Band bar with CMP pin + zone label — always visible, not collapsible
3. CMP value + Refresh button (auto-fetches on load)
4. **FY section** (this year's planning view):
   - FY Remaining (most important — drives next action)
   - FY Invested (spent, for planning)
   - FY Total Allocation
   - Shares + Avg Cost
5. **All-Time section** (honest deployed capital):
   - Total Invested (currentCost = allTimeQty × allTimeAvg)
   - Total Allocation across all FYs
   - Shares held (all-time net qty)
   - Avg Cost
6. Tranches — Generate / Add / list
7. Edit Financials button — opens sheet (rarely needed)

**What is NOT here:** Transactions, P&L hero, manual CMP input.

---

### 4. Transactions Screen
**Purpose:** Record-keeping — what did I buy/sell and when.

**Priority order:**
1. Filter by stock (optional)
2. Grouped by month
3. Per-transaction: Symbol, qty × price, date, amount

**Note:** Transactions are NOT shown inline on Stock Detail. Users who want
transaction history for a stock filter the Transactions tab.

---

### 5. Plan Screen
**Purpose:** FY setup — set allocation percentages, review carryover.

**Priority order:**
1. FY selector + total FY corpus
2. Per-stock allocation % and absolute amount
3. Carryover from previous FY
4. Investability gates (per stock)

---

## Information That Appears on Multiple Screens

Some information is shown in more than one place. This is intentional but
must be consistent — same label, same format, same precision.

| Information | Allocation | Buy Bands | Stock Detail | Plan |
|-------------|-----------|-----------|--------------|------|
| Signal | dot | badge | badge | — |
| FY Remaining | ✓ (per row) | — | ✓ (prominent) | — |
| FY Invested | ✓ (per row) | — | ✓ | — |
| All-Time Invested | — | — | ✓ | — |
| Band bar | — | ✓ | ✓ | — |
| CMP | — | ✓ | ✓ | — |
| Tranches | — | ✓ | ✓ | — |
| Allocation % | ✓ | — | — | ✓ |

**Rule:** When the same number appears on two screens, it must use the same
label word (see Vocabulary above) and the same format (e.g. ₹3.8L not ₹3,80,000).

---

## Number Formatting

| Type | Format | Example |
|------|--------|---------|
| Large amounts (≥ ₹1L) | ₹XL or ₹X.XL | ₹3.8L, ₹18.2L |
| Medium amounts (₹1K–₹99K) | ₹XX.XK | ₹47.9K |
| Small amounts (< ₹1K) | ₹XXX | ₹842 |
| Prices (per share) | ₹XXX | ₹262, ₹1,041 |
| Shares | X,XXX (Indian comma) | 1,856 |
| Percentages | X.X% | 12.5%, -0.1% |
| All financial numbers | tabular-nums (tabnum class) | always |

---

## Empty and Loading States

| Screen | Empty state | Loading |
|--------|-------------|---------|
| Allocation | "No stocks in plan — add one in Plan" | Skeleton rows |
| Buy Bands | "No bands yet — add financials to generate" | Skeleton rows |
| Stock Detail | Shows header + "No bands yet" + Edit Financials button | Inline |
| Transactions | "No transactions yet" | Skeleton rows |
