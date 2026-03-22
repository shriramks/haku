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
      colors: {
        // Semantic UI colours — use these, never raw hex in JSX
        positive: '#34C759',  // gains, buy, allocated
        negative: '#FF3B30',  // losses, trim
        accent:   '#0A84FF',  // interactive, CTAs
        warning:  '#FF9500',  // mid/hold

        // Signal colors — semantic only, never decorative
        signal: {
          buy:  '#22c55e',
          hold: '#f97316',
          trim: '#ef4444',
          deep: '#f97316',
        },
      },
      fontSize: {
        // Type scale — use these classes, NEVER text-[Npx]
        'display':     ['32px', { lineHeight: '1.1',  letterSpacing: '-0.02em' }],
        'title-1':     ['22px', { lineHeight: '1.2',  letterSpacing: '-0.01em' }],
        'title-2':     ['20px', { lineHeight: '1.25', letterSpacing: '-0.01em' }],
        'headline':    ['17px', { lineHeight: '1.35' }],
        'body':        ['15px', { lineHeight: '1.45' }],
        'subheadline': ['13px', { lineHeight: '1.4'  }],
        'footnote':    ['11px', { lineHeight: '1.4'  }],
      },
      spacing: {
        'tap': '44px',  // minimum tap target
      },
      minHeight: {
        'tap': '44px',
      },
      minWidth: {
        'tap': '44px',
      },
      borderRadius: {
        '2xl': '16px',
        '3xl': '24px',
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'monospace'],
      },
    },
  },
  plugins: [],
}

export default config
