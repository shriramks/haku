# Haku — Design

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
| `display` | 32px | 700 | text-primary | Page header titles ("Allocation", "Buy Bands") |
| `title-1` | 22px | 700 | text-primary | Important secondary numbers: CMP, stat amounts, section titles |
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
- **Never use the ₹ symbol in UI or mockups.** Amounts use compact Indian notation via the
  `Num` component (e.g. `2.41 L`, `25 K`). Prices use `formatPriceNum()` from
  `lib/formatter.ts` — also no ₹ symbol.

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
- **Interactive elements** (buttons, links, any tappable element): `color.accent` only — never
  signal colours (positive/negative/warning).
- `color.deep` and `color.positive` are intentionally different. Deep value is a stronger buy
  signal than buy — it deserves a visually distinct colour.
- **Dimming (reduced opacity)**: allocation-done state only — never use opacity to indicate
  buy/hold/trim signal.
- **No raw hex or rgba() in JSX component code.** Use token classes (`text-accent`,
  `bg-positive`) or `var(--token)` CSS variables only. Raw values belong only in
  `globals.css` and `tailwind.config.ts`.

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
| `rounded-full` | pill | Badges, avatars |
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

### DetailRow (label left, value right — used in Stock Detail and similar drill-down screens)
```
[body label, text-2]          [headline value, text-primary, tabnum]
Height: min 44px (py-2.5)
Padding: px-4
Divider: border-b --divider between rows within a group
Group header: footnote uppercase, text-faint, px-4 py-2 (SectionDivider)
Background: none (rows sit on page bg; groups separated by a sep line)
```

Rules for DetailRow:
- Label is always body (15px), colour text-2. Never bold.
- Value is always headline (17px), colour text-primary, tabnum. Semibold.
- Colour exceptions: positive values → text-positive, negative → text-negative,
  warning → text-warning. The label colour never changes.
- Stack variant (two values right-aligned): primary value headline, secondary value
  footnote text-muted below it.
- Groups are separated by a full-width sep line (--divider), not by background colour.
- Group header (SectionDivider) labels the group above its first row.

### SettingsMenu
```
[Section label]
[One or more menu items]

Menu item: min 44px height, rounded-xl if standalone
Grouped items: single bordered group with internal dividers only between items
Section spacing: vertical gap only; no horizontal rule after every section
```

Rules for SettingsMenu:
- Global but non-primary actions may live here when they should not compete with a screen's main CTA row.
- **Screen-specific actions** may be included, but must be demoted under the settings icon — never promoted into the primary action row when space is tight.
- **Dividers**: only within sections that contain multiple items. Do not add a horizontal divider after every section.
- If a section has one item, render it as a standalone card/button without an extra divider.
- If a section has multiple items, use one shared group container with internal dividers.

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

## 9. IA → Visual Mapping

This section connects `app-spec.md` to the style decisions above.
The IA defines *what* appears and in *what priority*. This section defines *how*
that priority is expressed visually.

### The core rule
**Priority in IA maps directly to size and colour in the style guide.**
If the IA says something is primary, it gets headline or larger + text-primary.
If it's secondary, it gets body + text-2. If it's metadata, it gets footnote + text-faint.
Never let visual weight conflict with IA priority — a footnote-sized element
should never be more important than a headline-sized one on the same screen.

### Screen-type → component mapping

| Screen type | Primary info pattern | Secondary info pattern | Layout component |
|-------------|---------------------|----------------------|-----------------|
| Overview list (Allocation, Buy Bands) | headline symbol + signal | body/subheadline allocation | ListRow |
| Detail drill-down (Stock Detail) | Band bar + signal badge | Label:value groups | DetailRow |
| Summary strip (FY totals) | display/title-1 number | subheadline label below | MetricCard |
| Edit/input (Financials sheet) | body labels + headline inputs | footnote hints | BottomSheet |
| Planning (Plan screen) | headline allocation % | subheadline absolute amount | ListRow |

### How IA priority maps to type roles

| IA priority | Type role | Colour |
|-------------|-----------|--------|
| Hero / most important number | `display` or `title-1` | text-primary or semantic |
| Primary field in a detail group | `headline` | text-primary (or positive/negative) |
| Label for a primary field | `body` | text-2 |
| Supporting context | `subheadline` | text-2 or text-muted |
| Metadata (category, date, anchor) | `footnote` | text-faint |
| Group header | `footnote` uppercase | text-faint |

### The two layout patterns and when to use them

**MetricCard** — use when you have 1–3 numbers that need to be immediately
scannable at a glance. Examples: FY Remaining in a summary strip, total portfolio
value. Not for detail views with 6+ fields.

**DetailRow** — use for all detail screens with 4+ fields. Every field gets
the same visual weight; hierarchy comes only from grouping (section headers)
and colour (positive/negative values). This is the pattern for Stock Detail.

SpendStack uses DetailRow exclusively in its detail views and reserves MetricCard
for its dashboard summary only. This is why SpendStack feels clear and easy
to read despite showing a lot of information: there is no visual competition
between a big card and surrounding rows — everything is at the same structural
weight, and the eye scans top to bottom.

### Signal and colour as a second hierarchy axis

Beyond size, colour communicates priority in a second dimension:
- A `positive` coloured value in a DetailRow draws the eye even though it is
  the same size as other values. Use this intentionally — only for values the
  user needs to act on (FY Remaining, signal zone, P&L).
- `text-muted` or `text-faint` values recede. Use for reference numbers the
  user doesn't act on (Total Allocation ceiling, avg cost when not relevant).

### What SpendStack does that validates Option B (DetailRow)

SpendStack's detail screens (budget category drill-down) use:
- All-caps small section headers above groups of rows
- Label left (body weight, secondary colour) + value right (semibold, primary colour)
- Positive values in green, negative in red, reference values in muted
- No metric cards in detail views — cards only on the overview/dashboard

The result: a screen with 8–10 fields reads clearly because the structure is
uniform and hierarchy comes from grouping + colour, not from competing visual
sizes. This is exactly why Option B (DetailRow) was chosen for Stock Detail
over Option A (metric cards mixed with rows).

---

## 10. Token Reference

Raw values for all design tokens. Already defined in `app/globals.css` and `tailwind.config.ts` — this section is a quick lookup, not the source of truth.

### Font stack

```css
font-family: -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
```

System font — SF Pro on iOS/macOS, Segoe UI on Windows, Roboto on Android. No web font loaded.

### CSS variables

```css
:root {
  --bg-primary:   #F2F2F7;
  --bg-secondary: #FFFFFF;
  --bg-tertiary:  #E5E5EA;
  --bg-nav:       rgba(242,242,247,0.90);
  --text-primary: #000000;
  --text-2:       rgba(0,0,0,0.60);
  --text-muted:   rgba(0,0,0,0.40);
  --text-faint:   rgba(0,0,0,0.25);
  --border:       rgba(0,0,0,0.10);
  --border-faint: rgba(0,0,0,0.06);
  --tap-active:   rgba(0,0,0,0.04);
  --divider:      rgba(0,0,0,0.08);
  --nav-h:        64px;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg-primary:   #000000;
    --bg-secondary: #1C1C1E;
    --bg-tertiary:  #2C2C2E;
    --bg-nav:       rgba(0,0,0,0.90);
    --text-primary: #FFFFFF;
    --text-2:       rgba(255,255,255,0.60);
    --text-muted:   rgba(255,255,255,0.40);
    --text-faint:   rgba(255,255,255,0.25);
    --border:       rgba(255,255,255,0.10);
    --border-faint: rgba(255,255,255,0.05);
    --tap-active:   rgba(255,255,255,0.06);
    --divider:      rgba(255,255,255,0.08);
  }
}
```

### Accent fills (tinted backgrounds)

```css
rgba(10,  132, 255, 0.15)  /* accent / blue  */
rgba(52,  199,  89, 0.12)  /* positive / green */
rgba(255,  59,  48, 0.10)  /* negative / red  */
rgba(255, 149,   0, 0.15)  /* warning / amber */
```

---

## 11. Platform

### Viewport
Design for **iPhone 16/17 width (393pt)** as the default target. Every layout decision — wrapping, font size, tap targets — is evaluated at this width first.

### Action rows
**Primary action rows must not wrap.** If actions do not fit on one row at iPhone 16/17 width, reduce, regroup, or demote actions — never allow a second line.

### iOS fixed nav
`body { min-height: calc(100dvh + 1px) }` in `app/globals.css` is required. It forces the WebKit scrollable-document compositing path so `position: fixed` nav renders correctly on iOS. **Never remove this line.**

### New design tokens
To add a token: define the CSS variable in `app/globals.css` (light + dark), then reference it in `tailwind.config.ts`.
