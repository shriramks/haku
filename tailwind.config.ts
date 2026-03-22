import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  darkMode: 'media',
  theme: {
    extend: {
      // ── Colours ────────────────────────────────────────────────────────────
      colors: {
        // Semantic UI colours — use these, never raw hex in JSX
        positive: '#34C759',  // gains, buy, allocated
        negative: '#FF3B30',  // losses, trim
        accent:   '#0A84FF',  // interactive, CTAs
        warning:  '#FF9500',  // mid/hold

        // Signal colours — band zones. buy/hold/trim map to positive/warning/negative.
        // deep is intentionally distinct from buy (stronger signal, different visual).
        signal: {
          buy:  '#34C759',
          hold: '#FF9500',
          trim: '#FF3B30',
          deep: '#30D158',
        },
      },

      // ── Typography ─────────────────────────────────────────────────────────
      // Use these role names, never raw px values in components. See STYLE_GUIDE.md §1.
      fontSize: {
        'display':     ['32px', { lineHeight: '1.1',  letterSpacing: '-0.02em' }],
        'title-1':     ['22px', { lineHeight: '1.2',  letterSpacing: '-0.01em' }],
        'title-2':     ['20px', { lineHeight: '1.25', letterSpacing: '-0.01em' }],
        'headline':    ['17px', { lineHeight: '1.35' }],
        'body':        ['15px', { lineHeight: '1.45' }],
        'subheadline': ['13px', { lineHeight: '1.4'  }],
        'footnote':    ['11px', { lineHeight: '1.4'  }],
      },

      // ── Font families ──────────────────────────────────────────────────────
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'monospace'],
      },

      // ── Tap targets ────────────────────────────────────────────────────────
      spacing: {
        'tap': '44px',
      },
      minHeight: {
        'tap': '44px',
      },
      minWidth: {
        'tap': '44px',
      },

      // ── Border radius ──────────────────────────────────────────────────────
      borderRadius: {
        '2xl': '16px',
        '3xl': '24px',
      },
    },
  },
  plugins: [],
}

export default config
