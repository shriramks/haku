import type { NextConfig } from 'next'

const config: NextConfig = {
  experimental: {
    staleTimes: { dynamic: 0 },
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
