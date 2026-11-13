// AMFI scheme master (`mf_schemes`, progress log #177): one row per AMFI scheme code so the Add
// Transaction sheet can search every fund by name and create a first-time holding. Shared
// reference data like `stocks`, read and written only here via the service-role client.
// Uncached on purpose: a sync must be visible to the very next search.
import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAmfiSchemes } from './amfi'
import { mfAssetClass } from './tax-compute'

export interface MfSchemeResult {
  code: string
  name: string
  type: string
}

export const SCHEME_STALE_DAYS = 7
export const SEARCH_LIMIT = 20
export const MIN_QUERY_CHARS = 3
const MAX_TERMS = 5
const MAX_QUERY_CHARS = 80
const UPSERT_CHUNK = 1000

/** True when the master was never synced, or its newest `synced_at` is over SCHEME_STALE_DAYS old. */
export function needsSchemeSync(latestSyncedAt: string | null, now: Date = new Date()): boolean {
  if (!latestSyncedAt) return true
  const ageMs = now.getTime() - new Date(latestSyncedAt).getTime()
  return !(ageMs <= SCHEME_STALE_DAYS * 86_400_000)
}

/**
 * Splits a typed query into lowercase terms that must all match. LIKE wildcards and the
 * characters PostgREST reads as filter syntax are dropped, so a term is always a plain
 * substring; terms are capped so a pasted paragraph cannot build a huge filter.
 */
export function searchTerms(query: string): string[] {
  return query
    .slice(0, MAX_QUERY_CHARS)
    .toLowerCase()
    .replace(/[%_\\,()*]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, MAX_TERMS)
}

/**
 * "Debt · Liquid Fund": the class the Portfolio will file it under (same rule as `mfAssetClass`)
 * plus the category after AMFI's "<Class> Scheme - " prefix. Hybrid and Other schemes show their
 * own category, never a guessed one.
 */
export function schemeTypeLine(scheme: { name: string; type: string }): string {
  const cls = mfAssetClass({ scheme_type: scheme.type, scheme_name: scheme.name })
  // Older close-ended headers are a bare word ("Growth", "Income") with no category — show the class alone.
  const category = scheme.type.includes(' - ') ? scheme.type.split(' - ').slice(1).join(' - ') : ''
  const label = cls === 'debt' ? 'Debt' : 'Equity'
  return category ? `${label} · ${category}` : label
}

/**
 * The name a new holding is saved under: a Direct Plan - Growth scheme drops that suffix
 * ("Example Liquid Fund - Direct Plan - Growth" -> "Example Liquid Fund"), matching how held funds
 * are named across the app. Any other plan or option keeps its suffix so Regular and IDCW
 * variants of one fund stay distinguishable.
 */
export function holdingName(schemeName: string): string {
  return schemeName.replace(/\s+-\s+Direct Plan\s+-\s+Growth$/i, '')
}

/** Replaces the master with AMFI's current list. Throws on any failure; a failed sync leaves the table as it was. */
export async function syncMfSchemes(service: SupabaseClient, now: Date = new Date()): Promise<void> {
  const schemes = await fetchAmfiSchemes()
  const syncedAt = now.toISOString()
  const rows = schemes.map(s => ({
    scheme_code: s.schemeCode,
    scheme_name: s.schemeName,
    scheme_type: s.schemeType,
    synced_at: syncedAt,
  }))
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const { error } = await service.from('mf_schemes').upsert(rows.slice(i, i + UPSERT_CHUNK), { onConflict: 'scheme_code' })
    if (error) throw new Error(error.message)
  }
}

async function latestSyncedAt(service: SupabaseClient): Promise<string | null> {
  const { data, error } = await service
    .from('mf_schemes')
    .select('synced_at')
    .order('synced_at', { ascending: false })
    .limit(1)
  if (error) throw new Error(error.message)
  return (data?.[0]?.synced_at as string | undefined) ?? null
}

/**
 * Top SEARCH_LIMIT schemes whose name contains every typed term. Syncs first when the master is
 * empty or stale; a failed sync of a stale (non-empty) master is swallowed so search keeps working
 * on the old list, while a failed first sync throws since there is nothing to search.
 */
export async function searchMfSchemes(service: SupabaseClient, query: string, now: Date = new Date()): Promise<MfSchemeResult[]> {
  const terms = searchTerms(query)
  if (terms.join(' ').length < MIN_QUERY_CHARS) return []

  const synced = await latestSyncedAt(service)
  if (needsSchemeSync(synced, now)) {
    try {
      await syncMfSchemes(service, now)
    } catch (err) {
      if (synced === null) throw err
      console.error('mf_schemes sync failed, searching the stale list:', err instanceof Error ? err.message : err)
    }
  }

  let q = service.from('mf_schemes').select('scheme_code, scheme_name, scheme_type')
  for (const t of terms) q = q.ilike('scheme_name', `%${t}%`)
  const { data, error } = await q.order('scheme_name').limit(SEARCH_LIMIT)
  if (error) throw new Error(error.message)
  return ((data ?? []) as { scheme_code: string; scheme_name: string; scheme_type: string }[])
    .map(r => ({ code: r.scheme_code, name: r.scheme_name, type: r.scheme_type }))
}
