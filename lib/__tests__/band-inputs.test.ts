import { describe, it, expect } from 'vitest'
import { checkBandReadiness, deriveBandInputs } from '../band-calculator'
import { buildBandsPayload, buildFinancialsEditFields, buildFinancialsPayload } from '../band-generate'

const fin = { patNow: 1200, pat3yrAgo: 1000, roce3yrAvg: 25, opProfitCr: 300, revenueCr: 1500 }

describe('deriveBandInputs', () => {
  it('derives growth, margin and snapshot from the financials', () => {
    const r = deriveBandInputs('Cap-Light Infra', fin)
    expect(r.g).toBeCloseTo(Math.pow(1.2, 1 / 3) - 1)
    expect(r.growthSource).toBe('calculated_3y_pat_cagr')
    expect(r.opMargin).toBeCloseTo(0.2)
    expect(r.snapshot).toEqual({ pat_now: 1200, pat_3yr_ago: 1000, op_profit_cr: 300, revenue_cr: 1500, g_computed: r.g, op_margin: r.opMargin })
  })

  it('applies the Hospitals growth floor when ROCE is high and CAGR low', () => {
    const r = deriveBandInputs('Hospitals', { ...fin, patNow: 1050, roce3yrAvg: 20 })
    expect(r.g).toBe(0.15)
    expect(r.growthSource).toBe('hospital_expansion_phase_floor')
  })

  it('has no margin on zero or missing revenue, and no snapshot without both PAT figures', () => {
    expect(deriveBandInputs('Jewellery', { ...fin, revenueCr: 0 }).opMargin).toBeNull()
    expect(deriveBandInputs('Jewellery', { ...fin, opProfitCr: null }).opMargin).toBeNull()
    expect(deriveBandInputs('Jewellery', { ...fin, pat3yrAgo: null }).snapshot).toBeNull()
  })
})

describe('checkBandReadiness', () => {
  const ok = { eps: 50, patNow: 1200, pat3yrAgo: 1000, roce3yrAvg: 25, mcap: 20000, cmp: 1000 }

  it('passes with complete stock inputs', () => {
    expect(checkBandReadiness('ABC', 'Cap-Light Infra', ok)).toBeNull()
  })
  it('asks for financials when any stock input is missing', () => {
    expect(checkBandReadiness('ABC', 'Cap-Light Infra', { ...ok, mcap: null })).toBe('No saved financials for ABC. Use Regen Financials first.')
    expect(checkBandReadiness('ABC', 'Cap-Light Infra', { ...ok, eps: null })).toContain('No saved financials')
  })
  it('asks for a fresh index fetch when index eps is missing; needs no financials', () => {
    const idx = { eps: null, patNow: null, pat3yrAgo: null, roce3yrAvg: null, mcap: null, cmp: null }
    expect(checkBandReadiness('NIFTYBEES', 'Nifty 50 Index', idx)).toBe('Missing CMP/PE for NIFTYBEES. Run Regen Bands to fetch fresh index data.')
    expect(checkBandReadiness('NIFTYBEES', 'Nifty 50 Index', { ...idx, eps: 12 })).toBeNull()
  })
  it('blocks a PE above the category guard (Hospitals 80x) only', () => {
    expect(checkBandReadiness('ABC', 'Hospitals', { ...ok, cmp: 50 * 81 })).toBe('PE unreliable (81×) — EV/EBITDA override needed for ABC')
    expect(checkBandReadiness('ABC', 'Hospitals', { ...ok, cmp: 50 * 80 })).toBeNull()
    expect(checkBandReadiness('ABC', 'Cap-Light Infra', { ...ok, cmp: 50 * 200 })).toBeNull()
  })
})

describe('buy_bands payloads', () => {
  const now = '2026-01-01T00:00:00.000Z'

  it('financials payload keeps the existing cmp and generated_at, leaves band prices out', () => {
    const p = buildFinancialsPayload('u1', 'ABC', { eps: 18, asOf: 'FY26 Q2', ...fin, mcap: 5000 }, { cmp: 99, generated_at: 'earlier' }, now)
    expect(p).toMatchObject({ user_id: 'u1', symbol: 'ABC', eps: 18, cmp: 99, notes: 'FY26 Q2', generated_at: 'earlier', last_updated_at: now, mcap: 5000 })
    expect(p).not.toHaveProperty('buy_low')
    expect(buildFinancialsPayload('u1', 'ABC', { eps: 18, asOf: '', ...fin, mcap: 1 }, null, now)).toMatchObject({ cmp: null, generated_at: now })
  })

  it('bands payload takes cmp from the fresh index state for indexes, the stored cmp for stocks', () => {
    const result = { buyLow: 1, buyHigh: 2, midLow: 3, midHigh: 4, trimPrice: 5 } as never
    const stored = { pat_now: null, pat_3yr_ago: null, roce_3yr_avg: null, mcap: null, cmp: 10, notes: null }
    const index = { indexLevel: 22000, indexPE: 22, indexCmp: 250, indexEps: 11 }
    const idx = buildBandsPayload({ userId: 'u1', symbol: 'N', isIndex: true, eps: 11, stored, index, result, now })
    expect(idx).toMatchObject({ cmp: 250, index_pe: 22, index_level: 22000, buy_low: 1, trim_price: 5, notes: '', generated_at: now })
    expect(buildBandsPayload({ userId: 'u1', symbol: 'A', isIndex: false, eps: 5, stored, index, result, now })).toMatchObject({ cmp: 10 })
  })
})

describe('buildFinancialsEditFields', () => {
  const now = '2026-01-01T00:00:00.000Z'
  it('index: persists the (CMP, PE) pair and derives eps', () => {
    expect(buildFinancialsEditFields({ kind: 'index', cmp: 250, indexPe: 25 }, now)).toEqual({ eps: 10, index_pe: 25, cmp: 250, last_updated_at: now })
    expect(buildFinancialsEditFields({ kind: 'index', cmp: 250, indexPe: null }, now)).toMatchObject({ eps: null })
  })
  it('equity: writes the financial columns and no index columns', () => {
    const f = buildFinancialsEditFields({ kind: 'equity', eps: 18, patNow: 1, pat3yrAgo: 2, opProfitCr: 3, revenueCr: 4, roce3yrAvg: 5, mcap: 6 }, now)
    expect(f).toEqual({ eps: 18, pat_now: 1, pat_3yr_ago: 2, op_profit_cr: 3, revenue_cr: 4, roce_3yr_avg: 5, mcap: 6, last_updated_at: now })
  })
})
