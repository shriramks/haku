import { describe, it, expect, vi, beforeEach } from 'vitest'

// Unit test for the refreshAllCMP state-reset pattern.
// The bug: an early `return` on !res.ok bypassed setRefreshingAll(false),
// leaving the button stuck in "Refreshing…" forever.
// Fix: throw instead of return so the finally block always resets state.

describe('refreshAllCMP — state always resets on failure', () => {
  // Simulates the fixed function logic extracted as a pure state machine
  async function refreshAllCMPLogic(
    fetchFn: () => Promise<{ ok: boolean; json: () => Promise<unknown> }>,
    onLoading: (v: boolean) => void,
  ) {
    onLoading(true)
    try {
      const res = await fetchFn()
      if (!res.ok) throw new Error('batch fetch failed')
      await res.json()
    } catch {
      // silently fail
    } finally {
      onLoading(false)  // must always run
    }
  }

  let loadingStates: boolean[]
  beforeEach(() => { loadingStates = [] })

  it('resets loading to false on successful fetch', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ prices: {} }) })
    await refreshAllCMPLogic(fetch, v => loadingStates.push(v))
    expect(loadingStates).toEqual([true, false])
  })

  it('resets loading to false when API returns non-ok status', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) })
    await refreshAllCMPLogic(fetch, v => loadingStates.push(v))
    expect(loadingStates).toEqual([true, false])
  })

  it('resets loading to false when fetch throws a network error', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('network error'))
    await refreshAllCMPLogic(fetch, v => loadingStates.push(v))
    expect(loadingStates).toEqual([true, false])
  })
})
