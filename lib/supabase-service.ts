import { createClient } from '@supabase/supabase-js'

// Service role client — bypasses RLS, server-only, never expose to client.
// Used inside unstable_cache callbacks where request cookies aren't available.
export function createSupabaseServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}
