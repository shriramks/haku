import type { NextConfig } from 'next'

const config: NextConfig = {
  // Pin the workspace root to this repo — without this, Turbopack's
  // auto-detection walks up to ~/Projects/package-lock.json (an unrelated
  // stray lockfile) and scopes its dev-server file watcher to the entire
  // ~/Projects tree (15+ sibling repos) instead of just this one. Real bug,
  // plausible contributor to the dev-server resource blowups tracked in
  // agent.md — not confirmed as the sole cause.
  turbopack: {
    root: __dirname,
  },
  // Headers for PWA and security
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ]
  },
}

export default config
