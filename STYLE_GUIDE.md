# Haku — Style Guide

Mobile-first, iOS native feel. Every screen is a phone screen. Decisions default to Apple HIG
where unspecified. Inspiration: Stocks.app (information density), SpendStack (financial hierarchy),
Apple Wallet (colour discipline).

---

## 1. Typography

### The principle
Type communicates hierarchy before the user reads a word. A financial screen carries 3–4 tiers of
information in every row. The eye should land on the primary, scan to the secondary, and ignore
the rest unless it wants it. Size alone does not create hierarchy — size + weight + colour together
do. A 13px muted label reads as clearly tertiary as an 11px one, with better legibility.

### Scale

| Role | Size | Weight | Colour default | Use |
|------|------|--------|----------------|-----|
| `display` | 32px | 700 | text-primary | Hero numbers: total portfolio value, large P&L |
| `title-1` | 22px | 700 | text-primary | Screen titles ("Buy Bands") |
| `title-2` | 20px | 600 | text-primary | Card / section titles |
| `headline` | 17px | 600 | text-primary | Primary list item: stock symbol, tranche amount |
| `body` | 15px | 400 | text-primary | Standard readable content, band prices |
| `subheadline` | 13px | 400 | text-2 | Supporting context: signal label, date, lot size |
| `footnote` | 11px | 400 | text-faint | Dense metadata in lists: category, anchor type |

### Rules
- **Never use footnote for standalone text.** It only works when anchored next to headline or
  body text that provides contrast. A screen of footnote-sized text is unreadable.
- **Footnote is acceptable in dense list rows** (Plans, Transactions) where the primary text is
  headline size and the metadata is genuinely tertiary. The contrast between 17px and 11px is
  sufficient for hierarchy.
- **Numbers that users act on** (CMP, P&L, tranche amount) are never below `body` (15px).
  Prices are at minimum `body`, ideally `headline`.
- **tabnum** class on all financial numbers — prevents layout shift as digits change.
- Line heights: display/title 1.1–1.2, everything else 1.4.

### What this looks like in a Plans list row
```
NIFTYBEES                    ←  headline (17px, semibold, text-primary)
Large Cap · ₹2.4L budget     ←  footnote (11px, text-faint)
```
The contrast between these two is the hierarchy. The category does not need to be 13px — it needs
to be visually subordinate to the symbol, which it is at 11px given the 17px primary.

---

## 2. Colour

### Philosophy
One colour per semantic meaning. Never two shades of green meaning the same thing.
Raw hex values and rgba() never appear in component code — only tokens.

### Tokens (CSS variables — already in globals.css)

**Backgrounds**
```
--bg-primary    Page background
--bg-secondary  Card / sheet surface
--bg-tertiary   Input background, inactive toggles
--bg-nav        Nav bar (with blur)
```

**Text**
```
--text-primary  Primary content (100% opacity equivalent)
--text-2        Secondary content (~60% opacity)
--text-muted    Supporting (~40% opacity)
--text-faint    Metadata / disabled (~25% opacity)
```

**Structure**
```
--border        Standard border
--border-faint  Subtle dividers
--divider       List row separators
```

### Action / signal colours (Tailwind tokens — in tailwind.config.ts)

| Token | Value | Use |
|-------|-------|-----|
| `color.positive` | #34C759 | Gains, allocated, buy confirmed |
| `color.negative` | #FF3B30 | Losses, sell, trim signal |
| `color.accent` | #0A84FF | Interactive elements, CTAs, links |
| `color.warning` | #FF9500 | Mid/hold signal, caution states |
| `color.deep` | #30D158 | Deep value zone (distinct from buy — darker/richer) |

**Signal colours** (for band zone labels, used at lower opacity for fills)
```
signal.buy   → color.positive
signal.hold  → color.warning
signal.trim  → color.negative
signal.deep  → color.deep
```

### Rules
- Zone fills: signal colour at 28–35% opacity (`rgba(...)` or Tailwind `/30`)
- Zone labels (text inside the bar): signal colour at full opacity
- P&L positive: `color.positive`. P&L negative: `color.negative`. Never green-500/red-400.
- Interactive elements (buttons with actions, links): `color.accent` only. Not green, not the
  signal colours.
- `color.deep` and `color.positive` are intentionally different. Deep value is a stronger buy
  signal than buy — it deserves a visually distinct colour.

---

## 3. Spacing

### Scale
```
4px   — tight internal gaps (icon-to-label, badge padding)
8px   — within a component (gap between lines in a row)
12px  — between related elements (gap between rows in a group)
16px  — section padding, standard card padding (px-4, py-4)
20px  — between components within a view
24px  — between major sections
32px  — between views / large structural breaks
```

### Rules
- **Horizontal page padding is always 16px (px-4).** No px-3 or px-5 in main content.
  Exception: modals/sheets use px-5 (20px) for the slightly more focused feel.
- **Card internal padding is always 16px (p-4).**
- **List rows use py-3 (12px) vertical padding** — gives 44px minimum tap target when combined
  with headline text.
- Section divider labels (e.g. "Completed", "Bear") get `px-4 py-2` — they are structural,
  not content.

---

## 4. Shape

### Border radius
| Token | Size | Use |
|-------|------|-----|
| `rounded-full` | pill | Badges, avatars, signal dots |
| `rounded-lg` | 8px | Small chips, tags, inline pills |
| `rounded-xl` | 12px | Buttons, inputs, toggles |
| `rounded-2xl` | 16px | Cards, collapsed rows |
| `rounded-3xl` | 24px | Bottom sheets (top corners only) |

### Rules
- All cards: `rounded-2xl`
- All buttons: `rounded-xl`
- All inputs: `rounded-xl`
- Bottom sheets: `rounded-t-3xl`
- Never mix radii within the same component

---

## 5. Tap Targets

HIG minimum is 44×44pt. Every interactive element must meet this.

### How to achieve it without visual bloat
A button that looks small can still have a 44px tap target:
```tsx
// The text is small but the surrounding div catches taps
<div className="flex items-center justify-center" style={{ minHeight: 44, minWidth: 44 }}>
  <span className="text-subheadline">Edit</span>
</div>
```

### Minimum sizes by element type
- Button (primary): 50px height, full-width or min 120px wide
- Button (secondary/ghost): 44px height
- List row: 48px height minimum (py-3 + headline text = ~44px, py-3.5 = safe)
- Toggle switch: 51×31px visual, but always wrapped in 44px touch target
- Icon button: 44×44px touch area (icon itself can be 24px)
- Filter chip: 36px height acceptable (small, but chips are supplementary UI)

---

## 6. Component Contracts

Recurring patterns that must be consistent across the app.

### ListRow
```
[Icon zone 40px] [Content flex-1]         [Trailing]
                  headline (symbol)        body/headline (value)
                  footnote (metadata)      subheadline (secondary value)

Height: min 48px (py-3)
Padding: px-4
Divider: border-b using --divider
```

### MetricCard (a number with a label)
```
[display or title-1 number, tabnum]
[subheadline label, text-muted, mt-1]

Alignment: context-dependent (center in summary strips, left in detail cards)
```

### SectionDivider
```
[subheadline text, text-faint]
Padding: px-4 py-2
Background: none (sits on page bg)
```

### Card
```
Background: --bg-secondary
Radius: rounded-2xl
Padding: p-4
Border: 1px --border (optional, use for interactive/elevated cards)
```

### ValueLabel (inline pair — e.g. band range labels below the bar)
```
[subheadline value, colour-coded]
[footnote label, text-faint]
Alignment: context-dependent
```

### BottomSheet
```
Background: --bg-secondary
Radius: rounded-t-3xl
Padding: px-5 pt-5 pb-[safe-bottom + 24px]
Handle: 4×36px rounded-full --bg-tertiary, centered, mt-2 mb-4
```

---

## 7. Motion

- Sheet slide-up: 320ms, `cubic-bezier(0.32, 0.72, 0, 1)` — already in globals.css
- Tap feedback: `--tap-active` background on active — already in globals.css
- No other animations. Financial data does not benefit from decorative motion.

---

## 8. What This Guide Does Not Cover

- **Icons**: Use SF Symbols naming conventions mentally; implement with SVG or lucide-react.
  Size: 20px in list rows, 24px in navigation, 28px in empty states.
- **Charts/visualisations**: BandBar, allocation bars — follow colour tokens but sizing is
  contextual.
- **Loading states**: Skeleton screens preferred over spinners for content areas.

---

## Applying This Guide

When building or editing a component, ask in order:

1. **What role is this text?** → pick from the scale, don't pick a size.
2. **What does this colour mean?** → use a token, never a raw value.
3. **Is this tappable?** → ensure 44px minimum touch target.
4. **What kind of container is this?** → card, row, sheet — use the contract.
5. **What spacing am I in?** → internal (8px), between related (12px), section (16px).
