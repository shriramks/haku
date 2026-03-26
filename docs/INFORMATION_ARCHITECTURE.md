# Haku — Information Architecture

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
2. FY summary strip — Total FY Allocation, Total Allocated, Remaining
3. Per-stock list rows — each row shows:
   - Primary: Stock symbol + signal dot
   - Secondary: Allocated so far + Remaining
   - Tertiary: Category + allocation %
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
4. **FY Allocation group:**
   - FY Remaining (most important — drives next action)
   - FY Allocated
   - FY Total Allocation
5. **All-Time group:**
   - Total Allocated (to avoid over-buying in future FYs)
   - Total Allocation
6. **Position group** (smallest, least important):
   - Shares held
   - Avg cost
7. Tranches — Generate / Add / list
8. Edit Financials button — opens sheet (rarely needed)

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
| FY Allocated | ✓ (per row) | — | ✓ | — |
| Band bar | — | ✓ | ✓ | — |
| CMP | — | ✓ | ✓ | — |
| Tranches | — | ✓ | ✓ | — |
| Allocation % | ✓ | — | — | ✓ |
| Total Allocated | — | — | ✓ | — |

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
