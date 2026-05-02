# Haku — Agent Instructions

## Working approach

- **Start from agent.md + memory before reading files.** Use Grep/Glob for targeted lookups. Only open files when something is genuinely missing. Avoid full-codebase Explore agents unless the question clearly needs it.
- **Walk the user through the plan before coding.** Never jump straight to implementation without first stating the intended steps.
- **Diagnose bugs from code only.** If an error message maps to a code line, that is the diagnosis — stop there. Never use `git log`/`git show` to corroborate something already clear from code.
- **Never override ignore rules.** Never use `git add -f`, never stage ignored files, and never commit anything excluded by `.gitignore` or `.git/info/exclude`.
- Create an HTML mockup in `mockups/` and get approval before writing component code. Static HTML + inline CSS is sufficient — no JS needed; just show layout and hierarchy. Check `docs/product.md` for IA priority and `docs/design.md` for tokens. `mockups/` is gitignored — never commit files from it.
- `npm run build` before committing non-trivial changes (`build` already runs `vitest run` first, so no need to run `npm test` separately).
- Schema changes: push code first, then hand over migration SQL — never the reverse (live app will crash on the dropped columns until code lands).

## UI rules

- **Before any UI/design change, read `docs/design.md` first.** Match its component contracts and visual rules before inventing a local pattern.
- No raw hex or raw px in JSX — only token classes (`text-accent`) or `var(--token)`
- All screens should be designed for iPhone 16/17 widths as the default target viewport
- Primary action rows must not wrap; if actions do not fit on one row at iPhone 16/17 width, reduce, regroup, or demote actions instead of allowing a second line
- Settings menus may include screen-specific actions, but those actions must be demoted under the settings icon rather than promoted into primary action rows when space is tight
- In settings menus, use dividers only within sections that contain multiple items; do not add a horizontal divider after every section
- Financial numbers: `tabnum` class always; actionable numbers (CMP, P&L) minimum `text-body` (15px)
- Prices: `formatPrice()` from `lib/formatter.ts` — no commas below ₹10,000
- Interactive elements: `color.accent` only — never signal colours
- Dimming (opacity): allocation-done state only — never for buy/hold/trim signal
- Min 44px tap target on all interactive elements; use `min-h-[44px] min-w-[44px]` wrapper if needed
- **MUST keep `body { min-height: calc(100dvh + 1px) }` in `app/globals.css`** — removing it breaks iOS fixed nav

## Colour tokens

| Meaning | Class |
|---|---|
| Gains / buy / allocated | `text-positive` |
| Loss / sell / trim | `text-negative` |
| CTA / links / interactive | `text-accent` |
| Hold / caution | `text-warning` |
| Deep value zone | `text-signal-deep` |

New token: add CSS var to `app/globals.css`, then reference in `tailwind.config.ts`.

## Component patterns

| Container | Radius | Padding |
|---|---|---|
| Card | `rounded-2xl` | `p-4` |
| Button | `rounded-xl` | min 44px height |
| Bottom sheet | `rounded-t-3xl` | `px-5 pt-5` |

- Page padding: `px-4` only — never `px-3` or `px-5`
- List rows: `py-3` (gives 44px tap target with headline text)
- Check `components/icons.tsx` before adding SVGs inline

## Asset types

- **Stocks** — buy bands, tranches, investability scorecard; computed via `lib/band-calculator.ts` and `lib/compute.ts`
- **Mutual Funds (MF)** — portfolio-only asset type; no bands or tranches; computed via `lib/mf-compute.ts`; handled in `app/portfolio/`

## Data / caching

DB write → `revalidateTag(tag)` via server action — otherwise `unstable_cache` serves stale data.

DB queries: always select specific columns and add WHERE filters server-side — never fetch full table rows and process client-side.
