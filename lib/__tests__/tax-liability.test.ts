import { describe, it, expect } from 'vitest'
import {
  bucketGains, applySetOff, computeTax, dividendTDS,
  LTCG_EXEMPTION, RATE_EQUITY_LTCG, RATE_EQUITY_STCG, CESS_RATE, DIVIDEND_TDS_RATE,
} from '../tax-liability'
import type { RealisedGain, GainType } from '../tax-compute'
import type { BucketTotals } from '../tax-liability'

function gain(gainType: GainType, amount: number): RealisedGain {
  return {
    assetType: 'stock', symbol: 'X', sellDate: '2025-06-01', purchaseDate: '2024-01-01',
    holdingDays: 400, gainType, qty: 1, saleValue: amount, purchaseCost: 0, gain: amount,
  }
}

const ZERO: BucketTotals = { equityLTCG: 0, equitySTCG: 0, debtLTCG: 0, debtSTCG: 0 }
const NO_CF = { shortTerm: 0, longTerm: 0 }

// ── bucketGains ───────────────────────────────────────────────────────────────

describe('bucketGains', () => {
  it('sums equity pool into equityLTCG/STCG and debt pool into debtLTCG/STCG', () => {
    const equity = [gain('LTCG', 100), gain('LTCG', 50), gain('STCG', -20)]
    const debt   = [gain('STCG', 30), gain('LTCG', 200)]
    const totals = bucketGains(equity, debt)
    expect(totals).toEqual({ equityLTCG: 150, equitySTCG: -20, debtLTCG: 200, debtSTCG: 30 })
  })

  it('empty pools → all zero', () => {
    expect(bucketGains([], [])).toEqual(ZERO)
  })
})

// ── applySetOff — exemption ──────────────────────────────────────────────────

describe('applySetOff — exemption', () => {
  it('applies 1.25L exemption to equity LTCG before any loss', () => {
    const r = applySetOff({ ...ZERO, equityLTCG: 200_000 }, NO_CF, 30)
    expect(r.exemptionApplied).toBe(LTCG_EXEMPTION)
    expect(r.final.equityLTCG).toBeCloseTo(75_000)
  })

  it('exemption capped at the gain itself when gain < 1.25L', () => {
    const r = applySetOff({ ...ZERO, equityLTCG: 50_000 }, NO_CF, 30)
    expect(r.exemptionApplied).toBe(50_000)
    expect(r.final.equityLTCG).toBe(0)
  })

  it('no exemption when equity LTCG is already a net loss', () => {
    const r = applySetOff({ ...ZERO, equityLTCG: -10_000 }, NO_CF, 30)
    expect(r.exemptionApplied).toBe(0)
    expect(r.final.equityLTCG).toBe(-10_000)
  })
})

// ── applySetOff — short-term loss waterfall ──────────────────────────────────

describe('applySetOff — short-term loss waterfall', () => {
  it('ST loss consumes slab-rate debt STCG before the 12.5% tier', () => {
    const raw: BucketTotals = { equityLTCG: 0, equitySTCG: -50_120, debtLTCG: 390_000, debtSTCG: 11_200 }
    const r = applySetOff(raw, NO_CF, 30)
    expect(r.final.debtSTCG).toBeCloseTo(0)
    expect(r.final.debtLTCG).toBeCloseTo(390_000 - (50_120 - 11_200))
    expect(r.final.equitySTCG).toBe(-50_120)  // source bucket untouched
  })

  it('within the 12.5% tier, debt LTCG is consumed before equity LTCG', () => {
    const raw: BucketTotals = { equityLTCG: 100_000, equitySTCG: -60_000, debtLTCG: 50_000, debtSTCG: 0 }
    const r = applySetOff(raw, NO_CF, 30)
    // exemption first: equityLTCG 100,000 -> 0 (fully exempt, no tax room needed there yet)
    // ST loss 60,000: nothing in debtSTCG, so it hits debtLTCG (50,000) first, then equityLTCG (0, already exempt to 0)
    expect(r.final.debtLTCG).toBeCloseTo(0)
    expect(r.newCarryForward.shortTerm).toBeCloseTo(10_000)  // 60,000 - 50,000 absorbed, equityLTCG had no room left post-exemption
  })

  it('a single loss can split across multiple buckets, highest-rate first', () => {
    const raw: BucketTotals = { equityLTCG: 0, equitySTCG: -100_000, debtLTCG: 0, debtSTCG: 30_000 }
    const r = applySetOff(raw, NO_CF, 30)
    const toDebtSTCG = r.moves.find(m => m.from === 'equitySTCG' && m.to === 'debtSTCG')
    expect(toDebtSTCG?.amount).toBeCloseTo(30_000)
    expect(r.final.debtSTCG).toBeCloseTo(0)
    expect(r.newCarryForward.shortTerm).toBeCloseTo(70_000)
  })

  it('equity STCG (20%) is a valid ST-loss target when it is not itself the source', () => {
    // debt STCG loss at slab 10% (below 12.5% and 20%) — equity STCG (20%) should still be
    // eligible and, being the single highest rate here, absorb first.
    const raw: BucketTotals = { equityLTCG: 0, equitySTCG: 40_000, debtLTCG: 0, debtSTCG: -25_000 }
    const r = applySetOff(raw, NO_CF, 10)
    expect(r.final.equitySTCG).toBeCloseTo(15_000)
    expect(r.moves).toEqual([{ from: 'debtSTCG', to: 'equitySTCG', amount: 25_000 }])
  })
})

// ── applySetOff — long-term loss restricted to long-term gains ──────────────

describe('applySetOff — long-term loss waterfall', () => {
  it('LT loss offsets debt LTCG but never touches ST buckets', () => {
    const raw: BucketTotals = { equityLTCG: -40_000, equitySTCG: 20_000, debtLTCG: 100_000, debtSTCG: 20_000 }
    const r = applySetOff(raw, NO_CF, 30)
    expect(r.final.debtLTCG).toBeCloseTo(60_000)
    expect(r.final.equitySTCG).toBe(20_000)  // untouched — LT loss can't reach ST buckets
    expect(r.final.debtSTCG).toBe(20_000)
    expect(r.newCarryForward.longTerm).toBe(0)
  })

  it('LT loss exceeding all LT room carries forward, ignoring available ST room', () => {
    const raw: BucketTotals = { equityLTCG: -200_000, equitySTCG: 50_000, debtLTCG: 30_000, debtSTCG: 0 }
    const r = applySetOff(raw, NO_CF, 30)
    expect(r.final.debtLTCG).toBe(0)
    expect(r.final.equitySTCG).toBe(50_000)  // never touched by the LT loss
    expect(r.newCarryForward.longTerm).toBeCloseTo(170_000)
  })
})

// ── applySetOff — incoming carryforward ──────────────────────────────────────

describe('applySetOff — incoming carryforward', () => {
  it('prior-year ST carryforward absorbs into this year’s remaining room after intra-year setoff', () => {
    const raw: BucketTotals = { equityLTCG: 0, equitySTCG: 0, debtLTCG: 0, debtSTCG: 40_000 }
    const r = applySetOff(raw, { shortTerm: 15_000, longTerm: 0 }, 30)
    expect(r.final.debtSTCG).toBeCloseTo(25_000)
    expect(r.carryForwardUsed.shortTerm).toBeCloseTo(15_000)
    expect(r.moves).toContainEqual({ from: 'carryForwardShort', to: 'debtSTCG', amount: 15_000 })
  })

  it('carryforward left unabsorbed when there is no room stays in carryForwardUsed as the smaller consumed amount', () => {
    const r = applySetOff(ZERO, { shortTerm: 15_000, longTerm: 5_000 }, 30)
    expect(r.carryForwardUsed).toEqual({ shortTerm: 0, longTerm: 0 })
  })

  it('this year’s own loss takes priority over incoming carryforward for the same room', () => {
    const raw: BucketTotals = { equityLTCG: 0, equitySTCG: -10_000, debtLTCG: 0, debtSTCG: 10_000 }
    const r = applySetOff(raw, { shortTerm: 5_000, longTerm: 0 }, 30)
    expect(r.final.debtSTCG).toBe(0)               // fully consumed by this year's own loss
    expect(r.newCarryForward.shortTerm).toBe(0)     // own loss fully absorbed
    expect(r.carryForwardUsed.shortTerm).toBe(0)    // no room left for incoming carryforward
  })
})

// ── computeTax ────────────────────────────────────────────────────────────────

describe('computeTax', () => {
  it('rates: equity LTCG/debt LTCG at 12.5%, equity STCG at 20%, debt STCG + dividends at slab', () => {
    const final: BucketTotals = { equityLTCG: 10_000, equitySTCG: 10_000, debtLTCG: 10_000, debtSTCG: 10_000 }
    const r = computeTax(final, 10_000, 30)
    const byBucket = Object.fromEntries(r.lines.map(l => [l.bucket, l]))
    expect(byBucket.equityLTCG.tax).toBeCloseTo(10_000 * RATE_EQUITY_LTCG)
    expect(byBucket.equitySTCG.tax).toBeCloseTo(10_000 * RATE_EQUITY_STCG)
    expect(byBucket.debtLTCG.tax).toBeCloseTo(10_000 * RATE_EQUITY_LTCG)
    expect(byBucket.debtSTCG.tax).toBeCloseTo(10_000 * 0.30)
    expect(byBucket.dividends.tax).toBeCloseTo(10_000 * 0.30)
  })

  it('a bucket left net negative after set-off contributes no tax line', () => {
    const final: BucketTotals = { equityLTCG: 0, equitySTCG: -50_000, debtLTCG: 0, debtSTCG: 0 }
    const r = computeTax(final, 0, 30)
    expect(r.lines.find(l => l.bucket === 'equitySTCG')).toBeUndefined()
  })

  it('a bucket reduced to exactly zero by set-off still shows a zero tax line', () => {
    const final: BucketTotals = { equityLTCG: 0, equitySTCG: 0, debtLTCG: 0, debtSTCG: 0 }
    const r = computeTax(final, 0, 30)
    expect(r.lines.find(l => l.bucket === 'debtSTCG')?.tax).toBe(0)
  })

  it('total = sum of bucket tax + 4% cess', () => {
    const final: BucketTotals = { equityLTCG: 100_000, equitySTCG: 0, debtLTCG: 0, debtSTCG: 0 }
    const r = computeTax(final, 0, 30)
    expect(r.tax).toBeCloseTo(100_000 * RATE_EQUITY_LTCG)
    expect(r.cess).toBeCloseTo(r.tax * CESS_RATE)
    expect(r.total).toBeCloseTo(r.tax + r.cess)
  })
})

// ── dividendTDS ───────────────────────────────────────────────────────────────

describe('dividendTDS', () => {
  it('flat 10%, independent of slab rate', () => {
    expect(dividendTDS(11_300)).toBeCloseTo(11_300 * DIVIDEND_TDS_RATE)
  })
})
