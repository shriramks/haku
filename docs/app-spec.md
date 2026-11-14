# Haku — Product

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
| **Snowball Signal** | Add Aggressively / Add Slowly / Wait / Trim — derived from zone + 3 fundamental conditions | Conviction, score |
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

#### `currentCost` — what you have deployed this FY (display only)

`currentCost` = the cost of shares bought this FY that you still hold,
computed using the **sequential average-cost method** on this FY's transactions only.

**Same scope as everything else on the allocation screen** — budget, remaining,
bar fill, donut — all FY-scoped. `currentCost` is no different.

**How it works — process this FY's transactions in date order:**

- **Buy:** add the buy amount to a running cost basis.
- **Sell:** retire `soldQty × currentAvg` from the cost basis.
  The remaining shares keep the same per-share cost.

**Why sequential, not just sum(buys) − sum(sells):**

If you bought ₹1L of ITC, harvested for ₹2.5L (full exit), then re-bought ₹75K:
- Wrong (net): buys − sells = 1.075L − 2.5L = −1.425L → clamped to 0. Re-entry invisible.
- Correct (sequential): after the full exit, cost basis drops to ₹0. Re-entry of ₹75K → `currentCost = 75K` ✓

A sell permanently retires shares and their cost. Subsequent buys start fresh.

**What about holdings from a prior FY?**

`currentCost = 0` if there were no transactions this FY — even if you hold
shares from last year. Those show up in `qty` / `avgCost` (all-time) which
drives unrealised P&L on the bands screen, not the allocation screen.

**`qty` and `avgCost` are all-time** (using all transactions, not FY-filtered).
They are only used for unrealised P&L calculations, not for the allocation screen.

#### `fy_id` is always derived from `trade_date`

A transaction's `fy_id` is computed from its trade date (Apr–Mar cycle) via
`lib/fy-utils.ts` — on insert, on CSV import, **and on every edit**. A date edit
can move a transaction into a different FY, so the stored `fy_id` is never
carried over.

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

**Adding a mutual fund** (FAB → Mutual Fund): the Fund field searches every AMFI scheme by name — type 3+ characters, all words must match — with funds you already hold listed first. Each result shows the plan and a type line (`Debt · Liquid Fund`); picking one creates the holding on its first buy. A new fund appears in Portfolio → Mutual Funds as soon as it has units, filed under Debt or Equity by the same rule the Portfolio uses (liquid, overnight, arbitrage, debt, gilt and similar categories are Debt). Its NAV arrives with the next Prices tap. Detail: `docs/architecture.md` "MF Scheme Search".

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
**Purpose:** Daily overview — allocation status across the plan, by sleeve.

**Priority order:**
1. FY selector (which year am I viewing)
2. FY summary strip — **Plan** (the sum of the rows' budgets, not the FY pool), **Left**, **Invested**, with a bar. Tapping Plan opens the Plan screen.
3. One **section per sleeve that has rows** (Equity, Debt, Gold order; a sleeve with no rows has no section here). The section header is the strip one step down — the sleeve's own Left and Invested, summed over its rows — and collapses its rows; open/closed is remembered per device (`haku_alloc_<sleeve>`).
4. **Rows** under their header (alphabetical): each shows
   - Primary: the name (stock symbol, PPF, or a fund's short name)
   - Left (muted): Remaining (FY) + its %
   - Invested (hero, bold): Invested (currentCost) + its % — matches the bar
   - Bar fill: currentCost as % of the row's budget (green)
   A row with nothing left reads **Complete**, dimmed. There is no separate completed group. Rows have no caret; a stock row opens its Stock Detail, the PPF row opens Portfolio, a fund row opens that fund's Portfolio page (Portfolio itself while the fund has no holding yet).

**Pinning:** the page header always sticks. Once the full strip has scrolled away, a trimmed strip (Plan | Left | Invested + bar, no "Edit plan", no %) joins it, and the current section's header pins beneath both, so the totals and the sleeve you are in stay in view. Collapsing sections does not unpin the strip.

**Fund rows (#181):** a row of kind `mf` in the Debt sleeve; its `symbol` is the AMFI scheme code and its name is the fund's short name (`fundDisplayName`). Plan = its % of the Debt sleeve; Invested and Left come from the FY's net MF buys (buys minus redemptions dated in the FY, floored at 0 — the stock rule), so Invested = Spent.

**PPF row:** Plan = its % of the Debt sleeve; Invested and Left come from the FY's PPF deposits (no sells, so Invested = deposited). Stock rows are unchanged: a stock's budget is its % of the Equity sleeve.

**Invested / Left semantics (strip and rows):** Invested amount **and** its %
derive from `currentCost`; Left amount **and** its % derive from
`budget − spent` (remaining). These are different measures (see Investment Math
above), so the two percentages need not sum to 100 — never force them to by
computing one as `100 − other`.

**What is NOT here:** Band bars, tranche details, CMP, P&L. Free (unallocated) money in a sleeve or the pool — that is on the Plan screen.

---

### 2. Buy Bands Screen
**Purpose:** Scanning and acting — which stocks are in buy zone, add tranches.

**Priority order:**
1. FY selector
2. Primary action row — operational actions only (`Refresh CMP`, `Regen Bands`); global valuation settings such as `Set 10Y Yield` belong under the settings icon, not in this row. `Regen Financials` lives inside the Financials sheet (per-stock), not in this row.
3. Per-stock rows (expanded view) — each card shows:
   - Primary: Stock symbol + signal badge + CMP
   - Key visual: Band bar with CMP position
   - Secondary: Band ranges (Deep / Buy / Mid / Trim prices)
   - Action: Tranches — Generate / Add / list
4. Scenario toggle (Bear / Normal / Bull) — affects band calculations

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
6. **Snowball Check** — tappable row (shown only when holding shares); opens Snowball sheet with zone, 3 conditions, entry strength, and prior-snapshot comparison. Signal pill shown inline on the row.
7. Tranches — Generate / Add / list; Buy Levels sheet header shows Snowball signal pill + descriptor line ("{n} tranches · Aggressive / Measured") when tranches exist
8. Edit Financials button — opens sheet (rarely needed)

**What is NOT here:** Transactions, P&L hero, manual CMP input.

---

### 4. Transactions Screen
**Purpose:** Record-keeping — what did I buy/sell and when.

**Priority order:**
1. Filter by stock (optional)
2. Grouped by month
3. Per-transaction: Symbol, qty × price, date, amount

**Views (#176):** a `Log ⌄` / `Yearly ⌄` menu at the left of the control row (Filter and Import sit at the right; applied filters get their own line below). **Log** is the default: the month-grouped list above. **Yearly** is one row per Indian FY (Apr–Mar, by trade date), newest first: `+in` (green), `−out` (red), net (`in − out`, bold, primary colour; a net-selling year shows a minus). Tapping a year opens its Equity / Debt / Gold lines, which add up to the year. Classes follow the Portfolio pie: stocks and equity funds are Equity; debt funds, PPF and EPF are Debt; all gold is Gold. PPF/EPF interest rows count as neither in nor out. Yearly applies the Asset / Type / Stock filters, ignores the Date filter, and is not offered on a single-stock or single-fund view. Math: `lib/invested-by-year.ts`.

**Note:** Transactions are NOT shown inline on Stock Detail. Users who want
transaction history for a stock filter the Transactions tab.

---

### 5. Plan Screen
**Purpose:** FY setup — set the pool, split it into sleeves, set each row's share, review carryover.

**Priority order:**
1. FY selector + **Plan** (the pool: FY budget + carryover; carryover footnote under it)
2. **Sleeves** — Equity, Debt, Gold — each a collapsible section: its name, its share of the pool (blue) and its amount. Tapping the header edits the split; only the caret collapses
3. **Rows** inside each sleeve, one line each: name, its share of the sleeve (blue) and its amount (muted). No company name and no per-row carryover split (carryover is stated once, under Plan). No caret on a row — the row taps (Portfolio's convention); the caret is only on a section header, where it means collapse
4. Investability gates (per stock)

**One grid:** every line — column heads, sleeve headers, rows, unassigned lines — uses the same columns as Allocation: name | share (centred) | amount (right), heads "Share" and "Amount". A share is always its share of its parent (a sleeve of the pool, a row of its sleeve), so shares and amounts line up all the way down. **Free money is a line, not a badge:** after a sleeve's rows, "Unassigned N%  amount" (muted) when they fall short of the sleeve, or "Over −N%  −amount" (red) when they overshoot; after the three sleeves, the same line for the pool. Nothing is shown at exactly 100.

**Sleeves (#180):** the three sleeves are always listed (a sleeve at 0% with no rows is just a header, and tapping it edits the split like any other). The **Plan** figure at the top is one full-width row (an "Edit budget" cue on its right edge) that opens the budget sheet. Tapping any sleeve header opens the **Split** sheet: Equity, Debt and Gold steppers (1 point per tap, or type a value) with each amount, and the Plan total. Nothing is blocked — a total over 100 shows red and saves. Section open/closed is remembered per device (`haku_plan_<sleeve>`). The model, defaults and formula are in "Plan sleeves (#180)" above.

**Add to Plan:** one row at the bottom opens the Add sheet — one sheet, so switching Type changes only its body and the sheet does not re-open. Its **Type** control is Equity | Debt; both types are always offered. Equity adds a stock (symbol, Market, %, category — unchanged). Debt has an **Instrument** control, PPF | Fund (PPF is offered only while the FY has no PPF row). PPF is just its % of the Debt sleeve, one row per FY (symbol `PPF`). Fund opens a search of AMFI schemes limited to debt and arbitrage funds (arbitrage is Debt in the plan only; the Portfolio pie keeps `mfAssetClass`); a fund already in the plan shows dimmed with "In plan" and cannot be picked; once picked the same % control and figures follow, with a Change link. Funds edit and remove like any row, without Category or Rename. Gold rows arrive with #182.

**Edit / Add sheets (#165):**
- The stepper's − / + always move **0.1**. The slider moves in 0.1 steps when the range is 25 or less, and in **1** steps when it is wider (`pctStep` in `lib/sleeves.ts` — a 0–100 slider in 0.1 steps is 1,000 positions and jumps under the finger); any value can be typed to the 0.1. Stored as `NUMERIC(5,2)`, shown with at most one decimal, totals rounded to 0.1 so they add up exactly.
- Under the %, a figures table: **Planned** (the row's % of its sleeve amount), **Invested** (the FY `spent`, net buys floored at 0, same as Allocation; for PPF, the FY's deposits), **Left** (Planned − Invested, red when negative), then **<Sleeve> total** — Equity total / Debt total — (% of the sleeve allocated across its rows, counting this row at its new %; red over 100). Edit has **Was** and **Now** columns for Planned and Left; Invested and Plan total show the current value only. Add has Now only.
- Cutting a stock below what is invested is allowed; Left goes negative. Changing a % does not regenerate tranches — that stays manual.

---

### Portfolio: region exposure (tap the allocation pie)

The Portfolio screen's pie is asset class (equity / debt / gold). Tapping it opens a sheet with the
same money cut by region: India vs US, as a stacked bar with share of total and amount.

- **Region rule:** Indian stocks, gold / SGB, PPF and EPF are India. A stock's region is the `region` of its `stocks` master row (`india`, or `us` for VUAA) — never inferred from its name. A mutual fund is US when its scheme name
  contains the whole word "US" (or "U.S."), "S&P" (any spacing / `&amp;` / "S and P" / "SnP"), or
  "Nasdaq" — `mfRegion` in `lib/exposure.ts`. Everything else is India. Overseas funds that carry none
  of those words (global, China, emerging) count as India until a keyword is added.
- **Invariant:** India + US = total current value = the pie's total. A US fund with no NAV counts at cost,
  exactly as in the pie.
- **Equity by region** (below the bar): India stocks / India MFs / US stocks & ETFs / US MFs, each with value, share of
  equity and XIRR. Equity = stocks + direct holdings + equity-class MFs (`mfAssetClass`), so the groups sum to the pie's
  equity value. An India-region direct holding counts in India stocks. XIRR is `stockXirr` / `mfXirr` over the group's transactions; "—" when the group has no
  value or no transactions. Empty groups are hidden. A debt-class fund inferred US counts in the
  India / US bar but not here.
- **US funds & ETFs** (below Equity by region): one row per US-region MF of any class and per US-region stock — name, value, share of
  total portfolio, XIRR — largest first; row links to its detail page (`/portfolio/mf/[id]` or `/portfolio/stock/[symbol]`). Values sum to the bar's US
  amount. Hidden when there are none.

### Portfolio: USD instruments (#131, unified in #153)

A USD stock / ETF (e.g. VUAA via IBKR) is an ordinary stock: its trades are `transactions` rows with a trade-date `fx_rate`, and its currency and region come from the `stocks` master. It is **equity**, so it is a row in the **Stocks** section, not a
section of their own — Portfolio sections are asset classes, region is a separate lens (the region sheet).
- **Currency:** INR is the base everywhere. Cost is fixed at each trade's USD->INR rate (`amount` = quantity × price × `fx_rate`); value =
  qty × latest USD price × today's rate; P&L is one total INR gain (price + currency together); XIRR runs on the INR
  cash flows. With no price or no rate yet, the row has no value and counts at cost, like an MF without a NAV.
- **Row:** the standard HoldingRow, named by the master's name, plus one muted line under it — `$110.42 · 62 units` (or just `62 units`
  without a price). No ₹ symbol anywhere. Rows are ordered by symbol like every other stock.
- **Totals:** the Stocks header, portfolio totals, 1D change, overall XIRR and the donut (as equity) all include them.
- **Add / edit:** a US holding is planned first (Plan, below), then bought from the Stocks Add modal like any plan
  stock — VUAA is a chip once it is in the plan. A non-INR instrument takes a price in its currency and a rate to INR, auto-filled from
  the trade-date close and overridable (editable on an existing trade too). The master row is created on the first buy. In Transactions they are Stocks
  rows (INR amount, trade-date rate in the detail line) with inline edit / delete. The Redeploy-proceeds toggle is not offered for them.
- **Detail:** the same `/portfolio/stock/[symbol]` page as any stock; value is qty × price × today's rate and the price shows in USD.
- **Scope:** portfolio-only — no bands, tranches or investability. Taxed in their own Foreign LTCG / Foreign STCG buckets on the Tax report (`docs/tax-rules.md`); excluded from harvesting.
  It does take a yearly budget (below).

### Plan / Allocation: overseas instrument budget (#146, #154)

An overseas instrument (VUAA) is a normal `stock_allocations` row in the FY plan, next to the stocks; its `exchange`
is the venue from the `stocks` master (`LSE`), not `NSE`.
- **Plan:** Add Stock has a Market control, **IND** (default) or **Other**. IND is the Indian-stock flow: type the
  symbol, a category, a %; the venue and `.NS` ticker are resolved automatically. Other asks for the Yahoo symbol
  (`VUAA.L`); after typing pauses, a server action quote-checks it and shows name, venue, currency and last price,
  and Add stays disabled until it resolves (unknown ticker: "No quote found"; non-USD: not supported). Add then
  creates the shared `stocks` master row (region `us`) from a fresh server-side quote, and the plan row with the chosen
  category (the Category picker is the same as for stocks; VUAA defaults to `S&P 500 Index`). The symbol must equal the Yahoo ticker's base (`VUAA` for `VUAA.L`) and must not already
  resolve as an NSE listing, since the master row is shared by every user. The % total, the 100% badge, the budget, Remove, and copying a plan into the next FY treat it
  like any row. Rename is not offered for an overseas row.
- **Allocation:** the same row as a stock (Left, Invested, progress bar) with no band or signal; it opens the stock
  detail page (`/stocks/[symbol]`) like any row, with or without transactions. Plan / Left / Invested totals include it.
- **Unrealised P&L** (`computeStockRows`): the native price is converted at today's USD->INR before it is compared with
  the INR average cost; with no rate saved the figure is absent, never mixed-currency.
- **Spent** = INR cost of the FY's buys minus INR sell proceeds, from `amount` (INR at the trade-date rate); FY
  membership is by trade date. Same spent / left maths as stocks.
- **Carryover:** a closed FY's unallocated carryover deducts US net spend (buys minus sells, INR) as well as stock
  net spend.

---

### Plan sleeves (#180)

The FY pool (budget + carryover) is split into three **sleeves** by %: Equity, Debt, Gold (`fiscal_years.equity_pct` / `debt_pct` / `gold_pct`, default 100 / 0 / 0). A plan row takes a % of **its own sleeve**, so:

`row budget = row % x sleeve % x pool` — one definition, `rowBudget` / `sleeveBudget` in `lib/sleeves.ts`, used by Allocation, Bands, Stock Detail and tranche generation.

- **No split set = all Equity.** Every stock budget is then exactly `row % x pool`, as before sleeves. A missing value (an FY cached before the columns existed) reads as the default.
- **Sleeves may total under 100.** The rest of the pool is unassigned. A sleeve may be 0% (Gold usually is).
- **Row kinds.** `stock` rows are Equity, `ppf` and `mf` rows are Debt. Features that only make sense for a stock (bands, tranches, price refresh, Stock Detail, investability) read stock rows only.
- **PPF invested** = deposits in `ppf_transactions` dated inside the FY. Interest and withdrawals are not invested money.
- **Fund invested** = net buys minus redemptions in `mf_transactions` dated inside the FY, per scheme, floored at 0.
- **Carryover** = pool - (net stock spend + PPF deposits + net fund buys). A PPF deposit or fund buy reduces carryover exactly as a stock buy does.
- **Allocation counts allocated money only:** its Plan figure is the sum of the rows' budgets, not the pool (unchanged from before sleeves).

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
