import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Signal colors — only used for semantic meaning, never decorative
        signal: {
          buy:  '#22c55e',   // green-500
          hold: '#f97316',   // orange-500
          trim: '#ef4444',   // red-500
          deep: '#f97316',   // orange-500 (deep value = investigate)
        },
      },
      fontFamily: {
        // System font stack — SF Pro on iOS/macOS, no custom fonts
        sans: ['-apple-system', 'BlinkMacSystemFont', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'monospace'],
      },
    },
  },
  plugins: [],
}

export default config
