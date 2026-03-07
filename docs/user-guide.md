# User Guide

A walkthrough for new users — what each screen does and the order to set things up.

---

## Table of Contents

1. [First-time setup](#1-first-time-setup)
2. [Create your first plan](#2-create-your-first-plan)
3. [Allocation screen](#3-allocation-screen)
4. [Buy Bands](#4-buy-bands)
   - [AI band generation](#ai-band-generation)
   - [Reading the band bar](#reading-the-band-bar)
   - [Tranches](#tranches)
5. [Logging transactions](#5-logging-transactions)
6. [Plan management](#6-plan-management)
   - [Editing allocations](#editing-allocations)
   - [Starting a new fiscal year](#starting-a-new-fiscal-year)
7. [Settings](#7-settings)

---

## 1. First-time setup

Sign up at the login screen with your email and password. Once in, you land on the **Allocation** screen — which will be empty until you create a plan.

The five tabs at the bottom are your main navigation:

| Tab | What it does |
|-----|-------------|
| Allocation | Home screen — deployment status per stock |
| Buy Bands | Valuation zones + planned buy orders |
| + | Log a new transaction |
| Transactions | Full buy/sell history |
| Plan | Manage your annual plan |

---

## 2. Create your first plan

Go to **Plan** → tap **+ Add Plan**.

Fill in:
- **Fiscal Year label** — use the year the FY *starts* in. FY26 = Apr 2026 – Mar 2027. FY25 = Apr 2025 – Mar 2026.
- **Total Budget (₹)** — your total capital for the year, e.g. `2400000` for ₹24L.

Tap **Create**. Your plan appears. Now add stocks:

1. Tap **+ Add Stock**
2. Enter the NSE symbol (e.g. `INFY`, `BEL`, `CAMS`)
3. Set the **allocation %** — what share of your budget goes to this stock
4. Choose a **category** — this drives which valuation model is used for buy bands (see [Buy Bands](#4-buy-bands))
5. Tap **Add Stock**

Repeat until your allocations sum to 100%. The header shows `X% · Y% left` as you go.

> **Tip:** You don't have to hit exactly 100% — but it's a good forcing function to be deliberate about every rupee.

---

## 3. Allocation screen

Once your plan is set up, the **Allocation** tab shows the deployment status for the current fiscal year.

Each stock row shows:
- **Allocated budget** — your % × total budget
- **Deployed** — total spent (sum of buy transactions minus sells)
- **Remaining** — budget left to deploy
- **P&L** — unrealised gain/loss if a CMP is available

Stocks are sorted with the most under-deployed at the top, so you can see at a glance where budget is still available.

---

## 4. Buy Bands

The **Buy Bands** tab shows valuation zones for each stock — price ranges where the stock is cheap, fairly valued, or expensive based on your playbook rules.

### AI band generation

The easiest way to generate bands is the **Generate All Bands** button at the top. This uses Gemini AI with Google Search to:

1. Fetch EPS, operating profit, borrowings, cash, and shares from Screener.in
2. Apply your stock's category-specific PE or EV/EBITDA multiple ranges
3. Compute Buy / Mid / Trim price zones and save them

You need a Gemini API key for this to work — see [Settings](#7-settings).

You can also generate bands for a single stock: expand the stock card → **Regenerate**.

**Two qualifier toggles** adjust the bands after generation:
- **2 Weak Quarters** — recent results have been soft; tightens all band prices by 10% (more conservative)
- **2 Strong Quarters** — recent results are strong; applies premium multiples for eligible categories (Capital-light)

These are stock-specific and saved per allocation.

### Reading the band bar

```
|  BUY (green)  |  MID (orange)  |  TRIM (red)  |
                ↑
               CMP (white line)
```

| Zone | What it means |
|------|--------------|
| **Buy** | Stock is cheap; good time to deploy budget |
| **Mid / Hold** | Fairly valued; hold existing position, avoid adding |
| **Trim** | Stock is expensive relative to fundamentals; consider reducing |

The white vertical line shows the current market price (CMP). Tap **Refresh CMP** to update it from Yahoo Finance.

### Tranches

Tranches let you plan *how* you want to buy within the Buy zone — breaking a position into multiple orders at different price points.

In an expanded stock card, scroll to **Tranches** and tap **+ Add**:
- **Qty** — number of shares
- **Price ₹** — your target price

Added tranches show a pending total. Tap the circle to mark a tranche as **allocated** (bought). The stock header shows a "N to buy" badge when there are open tranches.

Tranches are scoped to your current fiscal year plan — they don't carry over.

---

## 5. Logging transactions

Tap the **+** button in the bottom nav to log a trade.

1. Tap the stock chip (loaded from your current plan)
2. Select **Buy** or **Sell**
3. Set the date, quantity, and price
4. Tap the Buy/Sell button to save

The amount is computed automatically. The transaction is linked to the fiscal year whose date range contains the trade date.

Once logged, the **Allocation** screen updates the Deployed and Remaining numbers for that stock.

---

## 6. Plan management

### Editing allocations

From the **Plan** tab:
- **Edit budget** — tap Edit next to the budget figure
- **Change allocation %** — tap a stock row, edit the % field, tap away to save
- **Change category** — expand a stock row (chevron) → Category dropdown
- **Remove a stock** — expand → Remove from Plan (transactions are kept)
- **Add a stock** — tap + Add Stock at the top of the list

The header always shows the live total % so you know if you're over or under.

### Starting a new fiscal year

At the end of a fiscal year, tap **+ Add Plan** in the Plan tab.

- Enter the new FY label (e.g. `FY27` for Apr 2027 – Mar 2028)
- Set a new budget
- Optionally **copy stocks** from your current plan — allocation %s and categories carry over
- Carryover is computed automatically: unspent budget per stock flows into the new plan as a bonus on top of the new budget

The previous plan stays accessible via the FY selector in the Plan and Buy Bands tabs.

---

## 7. Settings

Tap the **profile icon** (top right on any screen) to open the account menu.

### Gemini API key

Required for AI band generation. Without it, the Generate Bands button returns an error.

**How to get a free key:**
1. Go to [aistudio.google.com](https://aistudio.google.com)
2. Sign in with a Google account
3. Create an API key (free tier has generous limits)
4. Copy the key (starts with `AIza…`)

**How to add it in the app:**
1. Tap the profile icon → **Add Key** under AI Settings
2. Paste your key → **Save**

The key is stored securely in the database and is only used server-side to call Gemini — it is never returned to your browser after saving. See [architecture.md](architecture.md#user-api-key-security) for the full security model.

To update or remove the key, tap **Update Key** in the same menu.
