# Haku Design System

iOS-style dark/light PWA. Mobile-first, system font, no custom typeface.

---

## Colours

All colours are CSS variables that auto-switch between light and dark via `prefers-color-scheme`.

| Token | Light | Dark | Usage |
|---|---|---|---|
| `--bg-primary` | `#F2F2F7` | `#000000` | Page background |
| `--bg-secondary` | `#FFFFFF` | `#1C1C1E` | Cards, sheets |
| `--bg-tertiary` | `#E5E5EA` | `#2C2C2E` | Inputs, chips, subtle fills |
| `--bg-nav` | `rgba(242,242,247,0.90)` | `rgba(0,0,0,0.90)` | Bottom nav / sticky headers (blur backdrop) |
| `--text-primary` | `#000000` | `#FFFFFF` | Headings, primary labels |
| `--text-2` | `rgba(0,0,0,0.60)` | `rgba(255,255,255,0.60)` | Secondary labels |
| `--text-muted` | `rgba(0,0,0,0.40)` | `rgba(255,255,255,0.40)` | Tertiary / placeholder |
| `--text-faint` | `rgba(0,0,0,0.25)` | `rgba(255,255,255,0.25)` | Disabled, decorative |
| `--border` | `rgba(0,0,0,0.10)` | `rgba(255,255,255,0.10)` | Card borders, dividers |
| `--border-faint` | `rgba(0,0,0,0.06)` | `rgba(255,255,255,0.05)` | Subtle inner dividers |
| `--tap-active` | `rgba(0,0,0,0.04)` | `rgba(255,255,255,0.06)` | Row tap highlight |
| `--divider` | `rgba(0,0,0,0.08)` | `rgba(255,255,255,0.08)` | List separators |

### Accent colours (fixed, not theme-switched)

| Name | Hex | Usage |
|---|---|---|
| Blue | `#0A84FF` | Primary CTA, active tabs, links |
| Green | `#34C759` | Positive, success, buy signal |
| Amber | `#FF9F0A` | Warning, hold signal |
| Red | `#FF3B30` | Destructive, error, trim signal |
| Grey | `#8E8E93` | Passive / neutral |

### Accent fills (for tinted backgrounds)

```css
rgba(10, 132, 255, 0.15)   /* blue tint  */
rgba(52, 199,  89, 0.12)   /* green tint */
rgba(255,  59,  48, 0.10)  /* red tint   */
rgba(255, 159,  10, 0.15)  /* amber tint */
```

---

## Typography

**Font stack:**
```css
font-family: -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
```
Uses the OS system font (SF Pro on Apple, Segoe UI on Windows, Roboto on Android). No web font loaded — zero font flash, fast load.

### Type scale (Tailwind / px)

| Role | Size | Weight | Notes |
|---|---|---|---|
| Page title | `28px` | 700 | e.g. "Plan", "Bands" |
| Section heading | `22px` | 700 | Card amounts |
| Body / list item | `15px` | 400 | Standard text |
| Label / button | `14px` | 500–600 | CTAs, row labels |
| Small label | `13px` | 400 | Secondary info |
| Caption | `12px` | 400 | Meta, timestamps |
| Micro / badge | `11px` | 400–600 | Chips, tags, status |
| Tiny / section header | `10px` | 500 | Tab labels |

**Uppercase section labels:**
```css
font-size: 11px;
text-transform: uppercase;
letter-spacing: 0.08em;
font-weight: 600;
color: var(--text-muted);
```

**Tabular numbers** (for all financial figures):
```css
font-variant-numeric: tabular-nums;
font-feature-settings: "tnum";
```
Apply via `.tabnum` utility class.

---

## Spacing & Layout

- **Page padding:** `px-4` (16px horizontal)
- **Card border-radius:** `rounded-2xl` (16px)
- **Button border-radius:** `rounded-xl` (12px)
- **Chip/badge border-radius:** `rounded-lg` (8px)
- **Card padding:** `p-4` (16px)
- **Section gap:** `mt-3` / `mt-4` between cards
- **Bottom nav height:** `64px` (`--nav-h`)
- **Body bottom padding:** `calc(64px + safe-area-inset-bottom)`

---

## Components

### Card
```css
background: var(--bg-secondary);
border: 1px solid var(--border);
border-radius: 16px;
padding: 16px;
```

### Primary button
```css
background: #0A84FF;
color: #fff;
border-radius: 12px;
padding: 10px 20px;
font-size: 15px;
font-weight: 600;
```

### Destructive button
```css
background: rgba(255,59,48,0.10);
color: #FF3B30;
border-radius: 12px;
```

### Input
```css
background: var(--bg-tertiary);
color: var(--text-primary);
border: 1px solid var(--border);
border-radius: 12px;
padding: 10px 12px;
font-size: 14px;
outline: none;
```

### Section header row
```css
font-size: 11px;
text-transform: uppercase;
letter-spacing: 0.08em;
font-weight: 600;
color: var(--text-muted);
```

### Sticky header / nav blur
```css
position: sticky;
top: 0;
background: var(--bg-nav);   /* semi-transparent */
backdrop-filter: blur(20px);
-webkit-backdrop-filter: blur(20px);
border-bottom: 1px solid var(--border);
```

---

## Animations

| Name | Usage |
|---|---|
| `slideUp` — `0.32s cubic-bezier(0.32, 0.72, 0, 1)` | Bottom sheets sliding up |
| `spin` — `0.8s linear infinite` | Loading spinners |
| `animate-ping` (Tailwind) | Pulse dots (onboarding nudges) |

---

## CSS variables (copy-paste)

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
