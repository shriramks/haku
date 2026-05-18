import { describe, it, expect } from 'vitest'
import { computeSnowball } from '../snowball'
import type { SnowballInput } from '../snowball'

// Shared band fixture: buyLow=100, buyHigh=150, midLow=151, midHigh=200, trim=250
const BASE: Omit<SnowballInput, 'cmp'> = {
  buyLow: 100, buyHigh: 150,
  midLow: 151, midHigh: 200,
  trim: 250,
  g: 0.15,            // 15% CAGR — passes cond1
  opMarginNow: 0.22,
  gPrior: 0.10,
  opMarginPrior: 0.18,
}

// ── Zone classification ────────────────────────────────────────────────────────

describe('zone classification', () => {
  it('DEEP_VALUE when cmp < buyLow', () => {
    expect(computeSnowball({ ...BASE, cmp: 80 }).zone).toBe('DEEP_VALUE')
  })
  it('BUY when cmp is within buyLow..buyHigh', () => {
    expect(computeSnowball({ ...BASE, cmp: 125 }).zone).toBe('BUY')
  })
  it('BUY at buyLow boundary', () => {
    expect(computeSnowball({ ...BASE, cmp: 100 }).zone).toBe('BUY')
  })
  it('BUY at buyHigh boundary', () => {
    expect(computeSnowball({ ...BASE, cmp: 150 }).zone).toBe('BUY')
  })
  it('MID when cmp is within midLow..midHigh', () => {
    expect(computeSnowball({ ...BASE, cmp: 175 }).zone).toBe('MID')
  })
  it('WATCH when cmp is between buyHigh and midLow', () => {
    // gap between 150 and 151 — construct bands with a gap
    const input = { ...BASE, buyHigh: 140, midLow: 160, cmp: 150 }
    expect(computeSnowball(input).zone).toBe('WATCH')
  })
  it('TRIM when cmp > trim', () => {
    expect(computeSnowball({ ...BASE, cmp: 260 }).zone).toBe('TRIM')
  })
})

// ── TRIM short-circuit ─────────────────────────────────────────────────────────

describe('TRIM short-circuit', () => {
  it('returns TRIM signal when in TRIM zone regardless of conditions', () => {
    const result = computeSnowball({ ...BASE, cmp: 260 })
    expect(result.signal).toBe('TRIM')
    expect(result.entryStrength).toBeNull()
    expect(result.entryStrengthLabel).toBeNull()
  })
  it('still evaluates conditions when TRIM (they are returned for display)', () => {
    const result = computeSnowball({ ...BASE, cmp: 260 })
    expect(result.cond1).toBe('PASS')  // g=0.15 > 0.12
  })
})

// ── Condition evaluation ───────────────────────────────────────────────────────

describe('cond1 — g > 12% CAGR', () => {
  it('PASS when g > 0.12', () => {
    expect(computeSnowball({ ...BASE, cmp: 125, g: 0.13 }).cond1).toBe('PASS')
  })
  it('FAIL when g <= 0.12', () => {
    expect(computeSnowball({ ...BASE, cmp: 125, g: 0.12 }).cond1).toBe('FAIL')
    expect(computeSnowball({ ...BASE, cmp: 125, g: 0.05 }).cond1).toBe('FAIL')
  })
  it('INSUFFICIENT_DATA when g is null', () => {
    expect(computeSnowball({ ...BASE, cmp: 125, g: null }).cond1).toBe('INSUFFICIENT_DATA')
  })
})

describe('cond2 — opMargin improving (now > prior)', () => {
  it('PASS when opMarginNow > opMarginPrior', () => {
    expect(computeSnowball({ ...BASE, cmp: 125, opMarginNow: 0.25, opMarginPrior: 0.20 }).cond2).toBe('PASS')
  })
  it('FAIL when opMarginNow <= opMarginPrior', () => {
    expect(computeSnowball({ ...BASE, cmp: 125, opMarginNow: 0.20, opMarginPrior: 0.20 }).cond2).toBe('FAIL')
    expect(computeSnowball({ ...BASE, cmp: 125, opMarginNow: 0.18, opMarginPrior: 0.22 }).cond2).toBe('FAIL')
  })
  it('INSUFFICIENT_DATA when opMarginNow is null', () => {
    expect(computeSnowball({ ...BASE, cmp: 125, opMarginNow: null }).cond2).toBe('INSUFFICIENT_DATA')
  })
  it('INSUFFICIENT_DATA when opMarginPrior is null', () => {
    expect(computeSnowball({ ...BASE, cmp: 125, opMarginPrior: null }).cond2).toBe('INSUFFICIENT_DATA')
  })
})

describe('cond3 — growth momentum (g > gPrior)', () => {
  it('PASS when g > gPrior', () => {
    expect(computeSnowball({ ...BASE, cmp: 125, g: 0.20, gPrior: 0.15 }).cond3).toBe('PASS')
  })
  it('FAIL when g <= gPrior', () => {
    expect(computeSnowball({ ...BASE, cmp: 125, g: 0.15, gPrior: 0.15 }).cond3).toBe('FAIL')
    expect(computeSnowball({ ...BASE, cmp: 125, g: 0.10, gPrior: 0.15 }).cond3).toBe('FAIL')
  })
  it('INSUFFICIENT_DATA when g is null', () => {
    expect(computeSnowball({ ...BASE, cmp: 125, g: null }).cond3).toBe('INSUFFICIENT_DATA')
  })
  it('INSUFFICIENT_DATA when gPrior is null', () => {
    expect(computeSnowball({ ...BASE, cmp: 125, gPrior: null }).cond3).toBe('INSUFFICIENT_DATA')
  })
})

// ── INSUFFICIENT_DATA signal ───────────────────────────────────────────────────

describe('INSUFFICIENT_DATA signal', () => {
  it('returns INSUFFICIENT_DATA signal (not WAIT) in BUY zone when any condition lacks data', () => {
    const result = computeSnowball({ ...BASE, cmp: 125, g: null })
    expect(result.signal).toBe('INSUFFICIENT_DATA')
    expect(result.entryStrength).toBeNull()
    expect(result.entryStrengthLabel).toBeNull()
  })
  it('INSUFFICIENT_DATA in DEEP_VALUE zone too', () => {
    const result = computeSnowball({ ...BASE, cmp: 80, opMarginPrior: null })
    expect(result.signal).toBe('INSUFFICIENT_DATA')
  })
})

// ── WAIT in MID / WATCH ────────────────────────────────────────────────────────

describe('WAIT signal in MID and WATCH zones', () => {
  it('returns WAIT in MID zone even when all conditions pass', () => {
    const result = computeSnowball({ ...BASE, cmp: 175 })
    expect(result.signal).toBe('WAIT')
    expect(result.entryStrength).toBeNull()
    expect(result.entryStrengthLabel).toBeNull()
  })
  it('returns WAIT in WATCH zone', () => {
    const input = { ...BASE, buyHigh: 140, midLow: 160, cmp: 150 }
    expect(computeSnowball(input).signal).toBe('WAIT')
  })
})

// ── Entry strength + signal in BUY / DEEP_VALUE ───────────────────────────────

describe('entry strength and signal', () => {
  it('STRONG (3/3) → ADD_AGGRESSIVELY', () => {
    // cond1 PASS (g=0.15>0.12), cond2 PASS (0.22>0.18), cond3 PASS (0.15>0.10)
    const result = computeSnowball({ ...BASE, cmp: 125 })
    expect(result.entryStrength).toBe(3)
    expect(result.entryStrengthLabel).toBe('STRONG')
    expect(result.signal).toBe('ADD_AGGRESSIVELY')
  })
  it('MODERATE (2/3) → ADD_SLOWLY', () => {
    // cond1 FAIL (g=0.10 ≤ 0.12), cond2 PASS, cond3 FAIL (g=0.10 ≤ gPrior=0.10)
    const result = computeSnowball({ ...BASE, cmp: 125, g: 0.10 })
    expect(result.entryStrength).toBe(1)
    expect(result.entryStrengthLabel).toBe('WEAK')
    expect(result.signal).toBe('ADD_SLOWLY')
  })
  it('MODERATE (2/3) → ADD_SLOWLY (cond3 fails)', () => {
    // cond1 PASS, cond2 PASS, cond3 FAIL (g=0.15 = gPrior=0.15)
    const result = computeSnowball({ ...BASE, cmp: 125, g: 0.15, gPrior: 0.15 })
    expect(result.entryStrength).toBe(2)
    expect(result.entryStrengthLabel).toBe('MODERATE')
    expect(result.signal).toBe('ADD_SLOWLY')
  })
  it('WEAK (1/3) → ADD_SLOWLY', () => {
    // cond1 PASS, cond2 FAIL, cond3 FAIL
    const result = computeSnowball({ ...BASE, cmp: 125, opMarginNow: 0.15, opMarginPrior: 0.20, g: 0.15, gPrior: 0.20 })
    expect(result.entryStrength).toBe(1)
    expect(result.entryStrengthLabel).toBe('WEAK')
    expect(result.signal).toBe('ADD_SLOWLY')
  })
  it('0/3 → WAIT', () => {
    // cond1 FAIL, cond2 FAIL, cond3 FAIL
    const result = computeSnowball({
      ...BASE, cmp: 125,
      g: 0.05, gPrior: 0.10,
      opMarginNow: 0.15, opMarginPrior: 0.20,
    })
    expect(result.entryStrength).toBe(0)
    expect(result.entryStrengthLabel).toBe('WEAK')
    expect(result.signal).toBe('WAIT')
  })
  it('works the same in DEEP_VALUE zone', () => {
    const result = computeSnowball({ ...BASE, cmp: 80 })
    expect(result.zone).toBe('DEEP_VALUE')
    expect(result.entryStrength).toBe(3)
    expect(result.signal).toBe('ADD_AGGRESSIVELY')
  })
})
