import { defineCloudflareConfig } from '@opennextjs/cloudflare'
import r2IncrementalCache from '@opennextjs/cloudflare/overrides/incremental-cache/r2-incremental-cache'

// OpenNext keeps Next's cache layer as-is. The R2-backed incremental cache makes
// the Worker cache-ready from the first deploy, so `unstable_cache`/`revalidateTag`
// behave the same as on Vercel — no changes to lib/data.ts or app/actions.ts.
export default defineCloudflareConfig({
  incrementalCache: r2IncrementalCache,
})
