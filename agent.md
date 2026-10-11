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
| `docs/tax-rules.md` | Capital-gains constants and loss set-off rules |

**Before any UI change: read `docs/design.md` first. Before any logic change: read `docs/app-spec.md` first. Before any tax change: read `docs/tax-rules.md` first.**

---

## Layout

Routes and files: see `docs/architecture.md` "Route → Screen Map" and "Key File Map". Pointers that matter when writing code:

- `app/actions.ts` — server actions for DB writes + `revalidateTag`; `app/portfolio/actions.ts` for the portfolio tables.
- `lib/band-calculator.ts` — implements `docs/valuation-playbook.md`; `lib/tranche-pipeline.ts` is shared by the tranches and bands generate routes.
- `lib/formatter.ts` (`formatPriceNum()`, compact Indian notation) and `components/Num.tsx` — use `Num` for all amounts.
- `components/icons.tsx` — check here before adding an inline SVG.
- `lib/supabase-browser.ts` — browser client, for client-side mutations only (see Data / caching).

---

## Asset types

| Asset | Compute | DB tables |
|-------|---------|-----------|
| Stocks | `lib/compute.ts`, `lib/band-calculator.ts` | `transactions`, `stock_allocations`, `buy_bands`, `fiscal_years` |
| Mutual Funds | `lib/mf-compute.ts` | `mf_funds`, `mf_transactions` |
| Gold / SGB | `app/portfolio/` | `sgb_transactions` |
| PPF | `app/portfolio/` | `ppf_transactions` |
| EPF | `app/portfolio/` | `epf_transactions` |
| Dividends | `app/dividends/`, `components/StockDividends.tsx` | `dividend_transactions` |
| USD stocks / ETFs | same as Stocks (`transactions.fx_rate`, `stocks` master); `lib/trade-fx.ts` | `transactions` (+ `stocks`, `fx_rates`); plan rows in `stock_allocations` |

Stocks have buy bands, tranches, and an investability scorecard. MFs are portfolio-only — no bands or tranches. USD holdings are Stocks rows in INR, portfolio-only (no bands or tranches).

---

## Data / caching

- Every write to a cached table must revalidate its tag, or `unstable_cache` serves stale data. The tag-per-fetcher table and the write paths are in `docs/architecture.md` "Data Caching & Writes". Prefer a server action that writes and revalidates together; a browser write is only OK when immediately followed by the matching revalidate action. `stock_allocations` is the one uncached table and may be written client-side under RLS.
- Stock transaction writes use `addStockTransaction` / `updateStockTransaction` / `deleteStockTransaction` / `importStockTransactions`; `fy_id` is derived server-side from `trade_date`.
- `stock_prices` (`getStockPrices`) is deliberately uncached and written only by `POST /api/portfolio/prices/refresh`; display prices go through `resolveCmp` (`lib/stock-prices.ts`), never `buy_bands.cmp` directly.
- DB queries: always select specific columns and add WHERE filters server-side — never fetch full table rows and filter client-side.

---

## AI integration

- Gemini is used **only** for the investability scorecard (`/api/investability/generate/[symbol]`).
- Financial inputs (EPS, PAT, ROCE, Mcap) come from Screener.in via `lib/screener.ts`; index level and PE come from NSE API via `lib/nse.ts`.
- Always read the Gemini key from `user_settings` (decrypted) — never from env vars. If no key, return an error directing the user to Settings.

---

## Working approach

- **Plan before coding.** State the intended steps and wait for confirmation — no exceptions, no matter how small the change.
- **Always split work into vertical slices.** Each session delivers one thin, user-visible, end-to-end slice (schema + data + compute + UI + docs for that slice), never a horizontal layer (all the data work, then all the compute, then all the UI). Every slice is shippable and usable on its own.
- **Always do the correct architectural fix — never a stopgap.** When a bug or slow path has both a quick patch and a proper structural fix, implement the proper fix, even if it touches more files or takes longer. If a stopgap genuinely has to ship first (e.g. time pressure), say so explicitly and get sign-off before taking it — never default to the smaller diff just because it's smaller.
- **After completing any unit of work**, append an entry to `progress_haku.md`. This file is gitignored — never stage or commit it. Format rules:
  - Every entry (Todo and Done) has a globally sequential number, assigned once at creation. Numbers are permanent identifiers — never renumbered, never reused. This is so a session can always be referred to by its number. Number Todo entries in the order they will be executed, so ascending number is the order of work; a Todo that nothing has yet referenced (no commit, code comment or doc cites it) may be renumbered once to restore that order.
  - Splitting work into sessions: when planning, give each session its own top-level number, in execution order. A letter suffix (`79.a`, `79.b`) is only for a Todo already in flight or already referenced that has to split mid-session.
  - Heading format: `### N — YYYY-MM-DD — Title` (Done) or `### N — Title` (Todo).
  - Done entries are ordered by actual completion recency, most-recent-at-top — not by number. Todo entries sit above `## Done` under `## Todo`.
  - Each entry: `Files:` line listing changed files, then 2–4 terse bullets on what changed and why.
  - When planning a multi-session task, add all sessions as numbered Todo entries first, in execution order. When a session is completed, move it to Done under its existing number/suffix and append the files + bullets.
  - "Local progress log", "update progress", or similar phrases always refer to this file — do not grep for it.
  - A **Done** entry requires its tracked (non-gitignored) files to be committed and pushed to `main`. Work that's implemented and tested but not yet committed stays under `## Todo` — do not mark something Done on the strength of a passing build alone. This never justifies overriding ignore rules to get there: gitignored files (this file itself, `mockups/`, `supabase/migrations/`) are never committed regardless of Done status; for a session that only touches gitignored files, Done means the work is finished, full stop.
- **Playbook and code stay in sync.** `docs/valuation-playbook.md` is the spec for `lib/band-calculator.ts`. Any playbook change that alters thresholds, ranges, formulas or categories ships in the same session as the matching code and test change, and the progress entry records both. If the code can't be updated in that session, say so explicitly and add a numbered Todo before committing the playbook.
- **No helper text in the UI.** No hints, notes, explanations or disclaimers — labels, values and actions only (`docs/design.md`).
- **Mockups first for new UI.** Create a static HTML mockup in `mockups/` (gitignored) and get approval before writing component code. `mockups/` is gitignored — never commit files from it, and never put mocks in `public/` or any other folder. Open them with `open <absolute-path>` as a `file://` URL.
- **`npm run build` before committing** non-trivial changes (`build` already runs `vitest run`).
- **Schema changes:** an additive migration (new table or column; nothing the live app reads is removed) is handed over and run first, so code that reads it can ship. A destructive one (drop, rename, tighten) goes the other way: push code first, then hand over the SQL — the live app crashes on a dropped column until code lands.
- **Commit directly to `main`.** Push straight to `main` — never create a feature branch or open a PR for ordinary work.
- **Git email:** always run `git config user.email "12730252+shriramks@users.noreply.github.com"` before committing.
- **Never override ignore rules.** No `git add -f`, never stage ignored files.
- **This repo is public — check every change for PII or sensitive data before committing.** Look at the staged diff, including screenshots, mocks, test fixtures, seed or sample data, docs examples and comments, for: secrets and keys, emails or personal identifiers, user or project IDs, real holdings, balances or transaction data, and anything that identifies the owner. Use illustrative values in examples and fixtures. If something sensitive is found, stop and raise it before committing; a commit is permanent once pushed.
- **PWA status bar: keep `statusBarStyle: 'default'` in `app/layout.tsx`.** Never `black-translucent` + `viewportFit: 'cover'` — iOS draws a system blur over the top of the page and no CSS fixes it. `themeColor` must match `--bg-primary`. Detail: `docs/design.md` "PWA status bar".
- **`npm run dev` is risky on this 8 GB machine.** Confirm it is actually killed before ending a session (`lsof -ti:3000`, not just closing the tab); never leave it running long-lived. Evidence and the `turbopack.root` pin: `docs/architecture.md` "Local Development".

---

## Investigating (bugs, questions, features)

- **Understand before concluding.** Before diagnosing, answering or proposing a change, build your own model of the area: trace every writer and reader of the data, the UI controls that trigger it, and the tests that pin it. A reader of a value is never reported as a problem until its writer and the controls that update it have been found. Say what is wrong only after that.
- **Label confidence.** Mark each finding "traced end to end" or "inferred from search". An inferred finding is not presented as fact and is not written into a plan as a defect — it goes in as "to check".
- **Docs vs code.** When a doc or rule disagrees with the code, find out which is stale; the doc does not win by default.
- **Read what the question needs.** Grep to locate, then open the files on the path. "Targeted" means no codebase dumps or full-codebase explore agents unless clearly needed — it does not mean stopping at the first match.
- **Diagnose from code, not git history.** Once an error is traced to a code line, that is the diagnosis; never use `git log`/`git show` to corroborate what is already clear from code.
- **Ask for a screenshot before a second guess.** If the user reports a UI/number mismatch and you cannot verify visually, don't reverse-engineer a fix from approximate numbers typed in chat — ask for a screenshot (or exact on-screen text) first. Escalating the fix's scope on a second guess only compounds the risk of being wrong twice.
- **Fix the model, not the symptom.** When something displays wrong, ask what the underlying model is supposed to guarantee. A correct fix restores an invariant; a symptom fix moves the inconsistency elsewhere. Before changing any formula, write down the invariant it must satisfy, verify it holds after the change, and audit every other value that shares the same base.
