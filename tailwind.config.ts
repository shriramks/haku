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
        // Semantic UI colours — reference CSS vars so globals.css is the single
        // source of truth. text-accent and var(--accent) will always agree.
        positive: 'var(--c-positive)',
        negative: 'var(--c-negative)',
        accent:   'var(--accent)',
        warning:  'var(--c-warning)',
        equity:   'var(--c-equity)',
        gold:     'var(--c-gold)',

        signal: {
          buy:  'var(--signal-buy)',
          hold: 'var(--signal-hold)',
          trim: 'var(--signal-trim)',
          deep: 'var(--signal-deep)',
        },
      },

      // ── Typography ─────────────────────────────────────────────────────────
      // Use these role names, never raw px values in components. See docs/design.md §1.
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
