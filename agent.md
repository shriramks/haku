# Haku — Agent Reference

## Project

Personal finance app for Indian investors. Tracks stock allocation (FY-budgeted, band-based buying), MF/Gold/PPF/EPF portfolio, and all transactions across asset types.

---

## Docs

| File | What it covers |
|------|----------------|
| `docs/app-spec.md` | Screen-by-screen IA, vocabulary, investment math (spent vs currentCost, carryover) |
| `docs/design.md` | All UI/design rules — typography, colour, spacing, components, platform |
| `docs/architecture.md` | Data model, Supabase schema, server/client split |
| `docs/valuation-playbook.md` | Band calculation methodology, PE multiples by category |

**Before any UI change: read `docs/design.md` first. Before any logic change: read `docs/app-spec.md` first.**

---

## Key directories

| Path | Purpose |
|------|---------|
| `app/allocation/` | Allocation overview — FY deployment status per stock |
| `app/bands/` | Buy Bands screen; `[symbol]/` is Stock Detail |
| `app/plan/` | FY planning — allocation percentages, carryover |
| `app/transactions/` | Transaction history, all asset types |
| `app/portfolio/` | MF / Gold / PPF / EPF portfolio screen |
| `app/add/` | Add transaction (FAB) |
| `app/import/` | CSV import |
| `app/api/` | Server-side API routes (CMP, bands gen, investability, tranches) |
| `lib/` | Computation, types, data fetching, formatters |
| `components/` | Shared UI components |

---

## Key files

| File | Purpose |
|------|---------|
| `lib/types.ts` | Core types: `Transaction`, `FiscalYear`, `StockRow`, etc. |
| `lib/portfolio-types.ts` | `MFTransaction`, `SGBTransaction`, `PPFTransaction`, `EPFTransaction`, `MFund` |
| `lib/compute.ts` | Stock row computation: allocation, spent, currentCost, bands, XIRR |
| `lib/mf-compute.ts` | MF holding computation: units, cost, current value, XIRR |
| `lib/band-calculator.ts` | PE/PB/EV band price calculation by category |
| `lib/data.ts` | Supabase data fetching helpers |
| `lib/xirr.ts` | XIRR implementation |
| `lib/formatter.ts` | `formatPriceNum()`, `formatDate()`, compact Indian number formatting |
| `lib/screener.ts` | Screener.in HTML parsing for financials (EPS, PAT, ROCE, Mcap) |
| `lib/nse.ts` | NSE API for index level and PE |
| `lib/supabase-browser.ts` | Browser Supabase client (for client-side mutations) |
| `app/actions.ts` | Server actions for DB writes + `revalidateTag` cache invalidation |
| `components/icons.tsx` | All SVG icons — check here before adding SVGs inline |
| `components/Num.tsx` | Compact Indian number formatting component — use for all amounts |
| `app/globals.css` | CSS tokens, global styles, iOS body hack |
| `tailwind.config.ts` | Tailwind token extensions (colour, type scale) |

---

## Asset types

| Asset | Compute | DB tables |
|-------|---------|-----------|
| Stocks | `lib/compute.ts`, `lib/band-calculator.ts` | `transactions`, `stocks`, `fiscal_years` |
| Mutual Funds | `lib/mf-compute.ts` | `mf_funds`, `mf_transactions` |
| Gold / SGB | `app/portfolio/` | `sgb_transactions` |
| PPF | `app/portfolio/` | `ppf_transactions` |
| EPF | `app/portfolio/` | `epf_transactions` |
| Dividends | `app/dividends/`, `components/StockDividends.tsx` | `dividend_transactions` |

Stocks have buy bands, tranches, and an investability scorecard. MFs are portfolio-only — no bands or tranches.

---

## Data / caching

- DB writes go through server actions in `app/actions.ts`; always call `revalidateTag(tag)` after a write — otherwise `unstable_cache` serves stale data.
- DB queries: always select specific columns and add WHERE filters server-side — never fetch full table rows and filter client-side.

---

## Tax constants

### Equity capital gains (stocks + equity-oriented MFs)
- **STCG** (held < 365 days): taxed at 20%.
- **LTCG** (held ≥ 365 days): taxed at 12.5% on gains above the 1.25 L annual exemption (raised from 1 L by Budget 2024, effective FY 2024–25 onwards).
- **1.25 L exemption** applies only to equity LTCG — not to debt or gold.

### Debt MF capital gains
Finance Act 2023 split debt MF treatment by purchase date (effective April 1, 2023):
- **Units bought before April 1, 2023:** old rules — LTCG threshold 3 years (1095 days), 20% with indexation; STCG at slab. BUT Budget 2024 (Finance Act 2024, effective July 23, 2024) removed indexation across capital assets; the only carve-out was real estate. So for pre-April 2023 debt units sold on/after July 23, 2024, indexation benefit is likely gone too — gains at slab.
- **Units bought on/after April 1, 2023:** LTCG benefit removed entirely — all gains taxed at slab rate regardless of holding period.
- The 1.25 L LTCG exemption does **not** apply to debt MF gains.
- **Indexation in this app:** We do not compute indexed cost. Debt gains are shown at purchase cost with a note to verify with a CA. Indexation requires a CBDT CII table (maintained annually each June) and the slab-rate outcome is user-specific anyway — false precision is worse than a clear disclaimer.

### Gold capital gains
- **LTCG threshold:** 1095 days (3 years).
- **SGB held to maturity:** fully exempt from capital gains tax.
- **SGB/ETF sold before maturity:** normal gold LTCG rules apply.

### Loss set-off rules
Equity, debt, and gold are separate capital gains buckets — losses cannot cross between them.
- **Equity STCG losses** can be set off against equity STCG gains **and** equity LTCG gains.
- **Equity LTCG losses** can only be set off against equity LTCG gains.
- Equity losses cannot offset debt MF gains or gold gains (and vice versa).
- Harvesting analysis therefore applies only to equity positions; debt and gold are reported separately.

---

## AI integration

- Gemini is used **only** for the investability scorecard (`/api/investability/generate/[symbol]`).
- Financial inputs (EPS, PAT, ROCE, Mcap) come from Screener.in via `lib/screener.ts`; index level and PE come from NSE API via `lib/nse.ts`.
- Always read the Gemini key from `user_settings` (decrypted) — never from env vars. If no key, return an error directing the user to Settings.

---

## Working approach

- **Plan before coding.** State the intended steps and wait for confirmation — no exceptions, no matter how small the change.
- **After completing any unit of work**, append an entry to `progress_haku.md`. Format rules:
  - Every entry (Todo and Done) has a globally sequential number. New entries continue the sequence (highest number = most recent).
  - Heading format: `### N — YYYY-MM-DD — Title` (Done) or `### N — Title` (Todo).
  - Done entries are ordered newest-first under `## Done` (highest number at top). Todo entries sit above `## Done` under `## Todo`.
  - Each entry: `Files:` line listing changed files, then 2–4 terse bullets on what changed and why.
  - When planning a multi-session task, add all sessions as numbered Todo entries first. When a session is completed, move it to Done (renumber if needed to stay sequential) and append the files + bullets.
  - "Local progress log", "update progress", or similar phrases always refer to this file — do not grep for it.
- **Mockups first for new UI.** Create a static HTML mockup in `mockups/` (gitignored) and get approval before writing component code. `mockups/` is gitignored — never commit files from it.
- **`npm run build` before committing** non-trivial changes (`build` already runs `vitest run`).
- **Schema changes:** push code first, then hand over migration SQL — never the reverse (live app crashes on dropped columns until code lands).
- **Git email:** always run `git config user.email "12730252+shriramks@users.noreply.github.com"` before committing.
- **Never override ignore rules.** No `git add -f`, never stage ignored files.
- **Diagnose bugs from code only.** If an error maps to a code line, that is the diagnosis — stop there. Never use `git log`/`git show` to corroborate something already clear from code.
- **Targeted reads only.** Use grep/glob for lookups; open files only when something is genuinely missing. Avoid full-codebase explore agents unless clearly needed.

---

## Debugging principle

**Fix the model, not the symptom.** When something displays wrong, first ask: what is the underlying model supposed to guarantee? A correct fix restores an invariant. A symptom fix moves the inconsistency elsewhere. Before changing any formula, write down the invariant it must satisfy, verify it holds after the change, and audit every other value that shares the same base.
