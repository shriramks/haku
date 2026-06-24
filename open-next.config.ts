import { defineCloudflareConfig } from '@opennextjs/cloudflare'
import r2IncrementalCache from '@opennextjs/cloudflare/overrides/incremental-cache/r2-incremental-cache'
import doShardedTagCache from '@opennextjs/cloudflare/overrides/tag-cache/do-sharded-tag-cache'

// R2-backed incremental cache for `unstable_cache` reads.
export default defineCloudflareConfig({
  incrementalCache: r2IncrementalCache,
  // Durable-Objects sharded tag cache so `revalidateTag` actually invalidates on
  // Workers. Without it `tagCache` defaults to a no-op ("dummy"), and every write
  // would serve stale data on all unstable_cache routes (/transactions, /bands, …).
  // Strongly consistent (KV would lag up to 60s); the DO class is auto-exported by
  // the generated worker, so no dashboard infra is needed — just the wrangler binding.
  tagCache: doShardedTagCache({ baseShardSize: 4 }),
})
