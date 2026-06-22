import type { NextConfig } from 'next'

const config: NextConfig = {
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

// OpenNext (Cloudflare Workers) dev hook — inert to Vercel/prod `next build`.
// When running `next dev` under wrangler it wires up the Cloudflare bindings
// (R2 cache, env). The adapter guards this so it only activates in dev.
import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare'
initOpenNextCloudflareForDev()
