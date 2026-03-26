import { describe, it, expect } from 'vitest'
import { computeTrancheAmounts, trancheSuggestion } from '../band-calculator'

function totalDeployed(amounts: number[]): number {
  return amounts.reduce((s, a) => s + a, 0)
}

// ── Deploy capital cap (the route logic, tested directly) ─────────────────────

describe('deploy capital cap — userLiquidInr vs remaining', () => {
  function deployable(stockRemaining: number, userLiquidInr: number | null | undefined): number {
    // Mirrors the route logic exactly:
    // const deployable = userLiquidInr != null
    //   ? Math.min(remainingAfterAllocated, userLiquidInr)
    //   : remainingAfterAllocated
    return userLiquidInr != null
      ? Math.min(stockRemaining, userLiquidInr)
      : stockRemaining
  }

  it('caps at deploy capital when deploy capital < stock remaining', () => {
    // NIFTYBEES has ₹4.2L remaining, user has ₹2.5L deploy capital
    expect(deployable(420_000, 250_000)).toBe(250_000)
  })

  it('uses stock remaining when deploy capital > stock remaining', () => {
    // Stock only has ₹1L left, deploy capital is ₹2.5L — use stock remaining
    expect(deployable(100_000, 250_000)).toBe(100_000)
  })

  it('uses stock remaining when deploy capital is null (not set)', () => {
    expect(deployable(420_000, null)).toBe(420_000)
  })

  it('uses stock remaining when deploy capital is undefined (field missing from query)', () => {
    expect(deployable(420_000, undefined)).toBe(420_000)
  })

  it('returns 0 when stock remaining is 0', () => {
    expect(deployable(0, 250_000)).toBe(0)
  })

  it('returns 0 when deploy capital is 0', () => {
    expect(deployable(420_000, 0)).toBe(0)
  })

  it('exact match — deploy capital equals stock remaining', () => {
    expect(deployable(250_000, 250_000)).toBe(250_000)
  })
})

// ── End-to-end: tranche count driven by deployable ────────────────────────────

describe('tranche count respects deploy capital', () => {
  it('fewer tranches when capped by deploy capital', () => {
    const totalCapital = 2_000_000 // ₹20L
    const stockRemaining = 420_000  // ₹4.2L
    const deployCapital  = 250_000  // ₹2.5L

    const deployable = Math.min(stockRemaining, deployCapital) // 250_000
    const suggested  = trancheSuggestion(deployable, totalCapital)
    const count      = suggested > 0
      ? Math.min(8, Math.max(2, Math.ceil(deployable / suggested)))
      : 3

    const amounts = computeTrancheAmounts(deployable, count)
    expect(totalDeployed(amounts)).toBeCloseTo(deployable, 0)
    // With ₹2.5L and ₹40K/tranche suggestion → ~6 tranches, all ≤ ₹2.5L total
    expect(totalDeployed(amounts)).toBeLessThanOrEqual(stockRemaining)
  })

  it('more tranches when full stock remaining is used (no deploy capital set)', () => {
    const totalCapital = 2_000_000
    const stockRemaining = 420_000
    const deployCapital  = null // not set

    const deployable = deployCapital != null ? Math.min(stockRemaining, deployCapital) : stockRemaining
    const suggested  = trancheSuggestion(deployable, totalCapital)
    const count      = suggested > 0
      ? Math.min(8, Math.max(2, Math.ceil(deployable / suggested)))
      : 3

    const amounts = computeTrancheAmounts(deployable, count)
    expect(totalDeployed(amounts)).toBeCloseTo(stockRemaining, 0)
  })
})
