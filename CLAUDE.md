# Claude Code Instructions — Haku

This file is loaded automatically at the start of every session.

---

## Before making any UI change

Read these files first — in this order:

1. `docs/STYLE_GUIDE.md` — typography scale, colour tokens, spacing, component contracts, IA→visual mapping
2. `tailwind.config.ts` — available semantic classes (text-accent, text-positive, etc.)
3. `app/globals.css` — CSS custom properties (the single source of truth for all tokens)

**Rules enforced by the style guide:**
- Never use raw hex or raw px in JSX — only token classes or `var(--token)`
- All Tailwind colors reference CSS vars (`var(--accent)` not `#0A84FF`) — adding a new token means adding to `globals.css` first, then referencing from `tailwind.config.ts`
- Minimum `text-body` (15px) for interactive buttons, 44px tap targets
- Prices: use `formatPrice()` from `lib/formatter.ts` — no commas below ₹10,000

## Before making any data or caching change

Read `docs/architecture.md`. Key rule: any DB write must be followed by `revalidateTag(tag)` via a server action — otherwise `unstable_cache` serves stale data.

## Before building any new UI pattern

1. Create a mockup in `mockups/` and get approval before writing component code
2. Check `docs/INFORMATION_ARCHITECTURE.md` for where new information fits in the hierarchy
3. Check `components/icons.tsx` before adding new SVGs inline

## Build discipline

- Run `npm run build` before committing non-trivial changes
- Run `npm test` after touching anything in `lib/`

## Non-negotiable constraints

- `body` must keep `min-height: calc(100dvh + 1px)` — iOS position:fixed compositing depends on it
- Never remove or work around this — see `docs/STYLE_GUIDE.md` §iOS constraints
