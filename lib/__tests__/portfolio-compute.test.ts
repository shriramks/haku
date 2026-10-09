import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { vi } from 'vitest'
import { buildPortfolio, type PortfolioInput, type StockTxn } from '../portfolio-compute'
import type {
  EPFTransaction, MFTransaction, MFund, PPFBalanceOverride, PPFTransaction, SGBTransaction, UsHolding, UsTransaction,
} from '../portfolio-types'

// XIRR reads the clock; pin it so results are repeatable.
beforeAll(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-26T06:00:00Z')) })
afterAll(() => { vi.useRealTimers() })

const buyStock = (symbol: string, trade_date: string, quantity: number, price: number): StockTxn =>
  ({ symbol, trade_date, trade_type: 'buy', quantity, amount: quantity * price })

const fund = (id: string, scheme_code: string, scheme_name: string, scheme_type: string): MFund =>
  ({ id, scheme_code, scheme_name, scheme_type })

const mfBuy = (fund_id: string, trade_date: string, units: number, nav: number): MFTransaction =>
  ({ id: `${fund_id}-${trade_date}`, fund_id, trade_date, trade_type: 'buy', units, nav, amount: units * nav })

const sgbBuy = (trade_date: string, grams: number, price_per_gram: number): SGBTransaction => ({
  id: `sgb-${trade_date}`, trade_date, trade_type: 'buy', grams, price_per_gram, amount: grams * price_per_gram,
  maturity_date: '2032-01-10', gold_type: 'sgb', name: null,
})

const ppf = (trade_date: string, trade_type: PPFTransaction['trade_type'], amount: number): PPFTransaction =>
  ({ id: `ppf-${trade_date}-${trade_type}`, trade_date, trade_type, amount, notes: '' })

const epf = (trade_date: string, trade_type: EPFTransaction['trade_type'], amount: number): EPFTransaction =>
  ({ id: `epf-${trade_date}-${trade_type}`, trade_date, wage_month: null, trade_type, amount, notes: '' })

const EMPTY: PortfolioInput = {
  stockTxns: [], bandCmps: {}, stockPrices: {}, mfFunds: [], mfTransactions: [], mfNavs: {},
  sgbTransactions: [], goldPrice: null, prevGoldPrice: null, ppfTransactions: [], ppfOverride: null,
  epfTransactions: [],
  usHoldings: [], usTransactions: [], usdInr: null,
}

const stockPrices = {
  AAA: { cmp: 120, prevClose: 118, fetchedAt: '2026-09-25T10:00:00Z' },
  BBB: { cmp: 190, prevClose: 195, fetchedAt: '2026-09-24T10:00:00Z' },   // a day behind AAA
}

// AAA 10 @100 → 1200 now; BBB 5 @200 → 950 now; CCC 4 @50 has no price anywhere.
const stockInput: Partial<PortfolioInput> = {
  stockTxns: [
    buyStock('AAA', '2025-01-10', 10, 100),
    buyStock('BBB', '2025-02-10', 5, 200),
    buyStock('CCC', '2025-03-10', 4, 50),
  ],
  stockPrices,
}

const mfInput: Partial<PortfolioInput> = {
  mfFunds: [
    fund('f1', '100', 'Alpha Flexi Cap Fund', 'Equity Scheme - Flexi Cap'),
    fund('f2', '200', 'Beta Liquid Fund', 'Debt Scheme - Liquid Fund'),
  ],
  mfTransactions: [mfBuy('f1', '2025-01-05', 100, 50), mfBuy('f2', '2025-01-06', 10, 1000)],
  mfNavs: {
    '100': { nav: 60, prevNav: 59, navDate: '2026-09-25' },
    '200': { nav: 1010, prevNav: 1009, navDate: '2026-09-24' },        // NAV a day late
  },
}

const goldInput: Partial<PortfolioInput> = {
  sgbTransactions: [sgbBuy('2024-01-10', 10, 6000)],
  goldPrice: 7000,
  prevGoldPrice: 6900,
}

const build = (...parts: Partial<PortfolioInput>[]) => buildPortfolio(Object.assign({}, EMPTY, ...parts))

describe('buildPortfolio — stocks', () => {
  const d = build(stockInput)

  it('one row per open position, sorted by symbol, with the saved price applied', () => {
    expect(d.stocks.rows.map(r => r.name)).toEqual(['AAA', 'BBB', 'CCC'])
    const aaa = d.stocks.rows[0]
    expect(aaa.value).toBeCloseTo(1200)
    expect(aaa.pnl).toBeCloseTo(200)
    expect(aaa.day?.amount).toBeCloseTo(20)               // 10 × (120 − 118)
    expect(aaa.day?.pct).toBeCloseTo((120 / 118 - 1) * 100)
    expect(aaa.dayPct).toBeCloseTo((120 / 118 - 1) * 100)
    expect(aaa.href).toBe('/portfolio/stock/AAA')
    expect(aaa.retLabel).toBe('XIRR')
  })

  it('a position with no price shows empty figures but counts at cost in the header', () => {
    const ccc = d.stocks.rows[2]
    expect(ccc.value).toBeNull()
    expect(ccc.pnl).toBeNull()
    expect(ccc.day?.amount).toBeNull()
    expect(ccc.retLabel).toBe('Return')
    expect(ccc.retPct).toBeNull()
    // 1200 + 950 + 200 (CCC at cost)
    expect(d.stocks.currentValue).toBeCloseTo(2350)
    expect(d.stocks.invested).toBeCloseTo(1000 + 1000 + 200)
    expect(d.stocks.gainPct).toBeCloseTo((2350 - 2200) / 2200 * 100)
  })

  it('the band snapshot is used only when there is no saved price', () => {
    const withBand = build(stockInput, { bandCmps: { CCC: 60, AAA: 999 } })
    expect(withBand.stocks.rows[0].value).toBeCloseTo(1200)   // AAA: saved price wins over the snapshot
    expect(withBand.stocks.rows[2].value).toBeCloseTo(240)    // CCC: 4 × 60
  })

  it('a holding priced a day behind the rest carries its own date', () => {
    expect(d.stocks.rows.map(r => r.staleDate)).toEqual([undefined, '24 Sep', undefined])
  })

  it('exited positions are not rows', () => {
    const sold = build({
      stockTxns: [
        buyStock('AAA', '2025-01-10', 10, 100),
        { symbol: 'AAA', trade_date: '2025-06-10', trade_type: 'sell', quantity: 10, amount: 1500 },
      ],
    })
    expect(sold.stocks.rows).toEqual([])
    expect(sold.stocks.invested).toBeNull()
    expect(sold.stocks.currentValue).toBeNull()
    expect(sold.stocks.gainPct).toBeNull()
  })
})

describe('buildPortfolio — mutual funds', () => {
  const d = build(mfInput)

  it('rows are sorted by name and carry class, value and per-row NAV date', () => {
    expect(d.mf.rows.map(r => r.name)).toEqual(['Alpha Flexi Cap Fund', 'Beta Liquid Fund'])
    expect(d.mf.rows.map(r => r.assetClass)).toEqual(['equity', 'debt'])
    expect(d.mf.rows[0].value).toBeCloseTo(6000)
    expect(d.mf.rows[0].day?.amount).toBeCloseTo(100)     // 100 units × (60 − 59)
    expect(d.mf.rows[0].href).toBe('/portfolio/mf/f1')
    expect(d.mf.rows.map(r => r.staleDate)).toEqual([undefined, '24 Sep'])
  })

  it('header sums value and cost; eqPct is equity’s share of MF value', () => {
    expect(d.mf.currentValue).toBeCloseTo(6000 + 10100)
    expect(d.mf.invested).toBeCloseTo(5000 + 10000)
    expect(d.mf.eqPct).toBe(Math.round(6000 / 16100 * 100))
  })

  it('a fund with no saved NAV has no value but counts at cost', () => {
    const noNav = build(mfInput, { mfNavs: { '100': { nav: 60, prevNav: 59, navDate: '2026-09-25' } } })
    expect(noNav.mf.rows[1].value).toBeNull()
    expect(noNav.mf.currentValue).toBeCloseTo(6000 + 10000)
  })

  it('a fund with no transactions is not a row', () => {
    const extra = build(mfInput, {
      mfFunds: [...(mfInput.mfFunds as MFund[]), fund('f3', '300', 'Gamma Fund', 'Equity')],
    })
    expect(extra.mf.rows).toHaveLength(2)
  })
})

describe('buildPortfolio — gold', () => {
  it('a batch row with meta in place of the 1D figure, and grams in the header', () => {
    const d = build(goldInput)
    expect(d.gold.rows).toHaveLength(1)
    const r = d.gold.rows[0]
    expect(r.name).toBe('SGB Jan 2024')
    expect(r.meta).toBe('10g · Jan 2032')
    expect(r.day).toBeUndefined()
    expect(r.value).toBeCloseTo(70000)
    expect(r.pnl).toBeCloseTo(10000)
    expect(d.gold.grams).toBeCloseTo(10)
    expect(d.gold.currentValue).toBeCloseTo(70000)
  })

  it('before the first Prices tap (no gold price) the row has no value and the batch counts at cost', () => {
    const d = build(goldInput, { goldPrice: null, prevGoldPrice: null })
    expect(d.gold.rows[0].value).toBeNull()
    expect(d.gold.currentValue).toBeCloseTo(60000)
    expect(d.gold.gainPct).toBeNull()
  })
})

describe('buildPortfolio — PPF and EPF', () => {
  const ppfTxns = [ppf('2024-04-05', 'deposit', 50000), ppf('2025-04-05', 'deposit', 50000), ppf('2025-03-31', 'interest', 7000)]
  const epfTxns = [epf('2025-04-01', 'deposit', 10000), epf('2025-05-01', 'deposit', 10000), epf('2025-03-31', 'interest', 500)]

  it('PPF: invested is deposits only, balance includes interest, gain is a plain %', () => {
    const d = build({ ppfTransactions: ppfTxns })
    expect(d.ppf.invested).toBeCloseTo(100000)
    expect(d.ppf.currentValue).toBeCloseTo(107000)
    expect(d.ppf.gainPct).toBeCloseTo(7)
  })

  it('PPF: a balance override replaces the computed balance', () => {
    const override: PPFBalanceOverride = { id: 'o', balance: 120000, as_of_date: '2026-09-01' }
    const d = build({ ppfTransactions: ppfTxns, ppfOverride: override })
    expect(d.ppf.currentValue).toBeCloseTo(120000)
    expect(d.ppf.gainPct).toBeCloseTo(20)
  })

  it('EPF: invested is deposits only, balance is every credit, gain is the XIRR', () => {
    const d = build({ epfTransactions: epfTxns })
    expect(d.epf.invested).toBeCloseTo(20000)
    expect(d.epf.currentValue).toBeCloseTo(20500)
    expect(d.epf.gainPct).not.toBeNull()
    expect(Number.isFinite(d.epf.gainPct as number)).toBe(true)
  })

  it('empty PPF / EPF draw nothing', () => {
    const d = build()
    expect(d.ppf).toEqual({ invested: null, gainPct: null, currentValue: null })
    expect(d.epf).toEqual({ invested: null, gainPct: null, currentValue: null })
  })
})

describe('buildPortfolio — summary', () => {
  const all: Partial<PortfolioInput>[] = [
    stockInput, mfInput, goldInput,
    { ppfTransactions: [ppf('2024-04-05', 'deposit', 50000)], epfTransactions: [epf('2025-04-01', 'deposit', 10000)] },
  ]
  const d = build(...all)

  it('totals are the sum of the sections (no-price holdings at cost) and gain is current − invested', () => {
    const current = 2350 + 16100 + 70000 + 50000 + 10000
    const invested = 2200 + 15000 + 60000 + 50000 + 10000
    expect(d.summary.totalCurrent).toBeCloseTo(current)
    expect(d.summary.totalInvested).toBeCloseTo(invested)
    expect(d.summary.totalGain).toBeCloseTo(current - invested)
  })

  it('1D gain rolls in stocks + MF + gold; 1D % is against yesterday’s total', () => {
    // stocks: AAA +20, BBB 5 × (190 − 195) = −25, CCC none; MF: +100 and 10 × 1 = +10; gold: 10 × 100 = +1000
    const gain1d = 20 - 25 + 110 + 1000
    expect(d.summary.totalGain1d).toBeCloseTo(gain1d)
    expect(d.summary.dayPct).toBeCloseTo(gain1d / (d.summary.totalCurrent - gain1d) * 100)
  })

  it('allocation percentages always add up to 100', () => {
    const { eqPct, debtPct, goldPct } = d.summary
    expect(eqPct + debtPct + goldPct).toBe(100)
    // equity = stocks + equity MF; debt = debt MF + PPF + EPF; gold = the rest
    const total = d.summary.totalCurrent
    expect(eqPct).toBe(Math.round((2350 + 6000) / total * 100))
    expect(debtPct).toBe(Math.round((10100 + 50000 + 10000) / total * 100))
  })

  it('overall XIRR is computed when everything is priced', () => {
    expect(d.summary.xirr).not.toBeNull()
    expect(Number.isFinite(d.summary.xirr as number)).toBe(true)
  })

  it('overall XIRR waits for the gold price when gold is held', () => {
    const noGold = build(...all, { goldPrice: null, prevGoldPrice: null })
    expect(noGold.summary.xirr).toBeNull()
  })

  it('overall XIRR ignores a missing gold price when no gold is held', () => {
    const noGoldHeld = build(stockInput, mfInput)
    expect(noGoldHeld.summary.xirr).not.toBeNull()
  })

  it('an empty portfolio is all zero / null', () => {
    const e = build()
    expect(e.summary).toMatchObject({
      totalCurrent: 0, totalInvested: 0, totalGain: 0, totalGain1d: 0, dayPct: null, xirr: null,
    })
    expect(e.stocks.rows).toEqual([])
    expect(e.mf.rows).toEqual([])
    expect(e.gold.rows).toEqual([])
  })

  it('region split: India + US equals the pie total; a US-named fund moves its value to US', () => {
    const usFund = build(stockInput, {
      mfFunds: [fund('f9', '900', 'Edelweiss US Technology Equity FoF', 'Equity Scheme - Other')],
      mfTransactions: [mfBuy('f9', '2025-01-05', 100, 50)],
      mfNavs: { '900': { nav: 60, prevNav: 59, navDate: '2026-09-25' } },
    })
    expect(usFund.region.usValue).toBeCloseTo(6000)
    expect(usFund.region.indiaValue + usFund.region.usValue).toBeCloseTo(usFund.summary.totalCurrent)
    expect(usFund.region.indiaPct + usFund.region.usPct).toBeCloseTo(100)
    const eq = usFund.region.equity.reduce((s, g) => s + g.value, 0)
    expect(eq).toBeCloseTo(usFund.region.equity[0].value + usFund.region.equity[1].value + 6000)
    expect(usFund.region.equity[3].value).toBeCloseTo(6000)         // the US fund; stocks + MFs = pie equity
    expect(d.region.usValue).toBe(0)                               // no US-named fund in the default mix
    expect(d.region.indiaValue).toBeCloseTo(d.summary.totalCurrent)
  })

  it('output is plain data — it survives a JSON round-trip unchanged (it crosses the RSC boundary)', () => {
    expect(JSON.parse(JSON.stringify(d))).toEqual(d)
  })
})

// VUAA: 10 units bought at $100 when USD->INR was 80 → cost 80,000. Now $120 at 85 → 102,000.
const vuaa: UsHolding = { id: 'u1', symbol: 'VUAA', yahoo_symbol: 'VUAA.L', name: 'Vanguard S&P 500 UCITS ETF', region: 'us' }
const usBuy = (trade_date: string, quantity: number, price: number, fx_rate: number): UsTransaction => ({
  id: `u1-${trade_date}`, holding_id: 'u1', trade_date, trade_type: 'buy', quantity, price, fx_rate,
  amount: quantity * price, amount_inr: quantity * price * fx_rate,
})
const usPrices = { 'US:VUAA.L': { cmp: 120, prevClose: 118, fetchedAt: '2026-09-25T10:00:00Z' } }
const usInput: Partial<PortfolioInput> = {
  usHoldings: [vuaa],
  usTransactions: [usBuy('2025-01-10', 10, 100, 80)],
  usdInr: { rate: 85, prevRate: 84 },
  stockPrices: usPrices,
}
// stockInput and usInput each carry stockPrices; merge them when both are used.
const both = { ...stockInput, ...usInput, stockPrices: { ...stockPrices, ...usPrices } }

describe('buildPortfolio — direct USD holdings (#131)', () => {
  it('is a row in Stocks with INR figures, the native line and its own href', () => {
    const d = build(usInput)
    expect(d.stocks.rows).toHaveLength(1)
    expect(d.stocks.rows[0]).toMatchObject({
      key: 'us:u1', name: 'Vanguard S&P 500 UCITS ETF', href: '/portfolio/us/u1',
      value: 102_000, pnl: 22_000, native: '$120.00 · 10 units', retLabel: 'XIRR',
    })
    expect(d.stocks.rows[0].day?.amount).toBeCloseTo(10 * (120 * 85 - 118 * 84))
  })

  it('the Stocks header and every total include it alongside Indian stocks', () => {
    const d = build(both)
    expect(d.stocks.rows.map(r => r.name)).toEqual(['AAA', 'BBB', 'CCC', 'Vanguard S&P 500 UCITS ETF'])
    expect(d.stocks.invested).toBeCloseTo(2200 + 80_000)
    expect(d.stocks.currentValue).toBeCloseTo(2350 + 102_000)
    expect(d.summary.totalInvested).toBeCloseTo(2200 + 80_000)
    expect(d.summary.totalCurrent).toBeCloseTo(2350 + 102_000)
    expect(d.summary.totalGain1d).toBeCloseTo(20 - 25 + 2880)   // AAA + BBB + VUAA
    expect(d.summary.eqPct).toBe(100)
  })

  it('counts as US in the region split without breaking India + US = total', () => {
    const d = build(both)
    expect(d.region.usValue).toBeCloseTo(102_000)
    expect(d.region.indiaValue + d.region.usValue).toBeCloseTo(d.summary.totalCurrent)
    expect(d.region.equity.find(g => g.key === 'us-stocks')?.value).toBeCloseTo(102_000)
    expect(d.region.usHoldings.map(h => h.href)).toEqual(['/portfolio/us/u1'])
  })

  it('overall XIRR runs on the INR cash flows (currency gain counts)', () => {
    const weaker = build(usInput, { usdInr: { rate: 95, prevRate: 95 } })
    const flat = build(usInput, { usdInr: { rate: 80, prevRate: 80 }, stockPrices: { 'US:VUAA.L': { cmp: 100, prevClose: 100, fetchedAt: '2026-09-25T10:00:00Z' } } })
    expect(flat.summary.xirr!).toBeCloseTo(0, 2)
    expect(weaker.summary.xirr!).toBeGreaterThan(0.2)
  })

  it('without a USD->INR rate the row has no value but counts at cost', () => {
    const d = build(usInput, { usdInr: null })
    expect(d.stocks.rows[0]).toMatchObject({ value: null, pnl: null, retLabel: 'Return', native: '$120.00 · 10 units' })
    expect(d.stocks.currentValue).toBeCloseTo(80_000)
  })

  it('without a price the native line shows units only', () => {
    const d = build(usInput, { stockPrices: {} })
    expect(d.stocks.rows[0].native).toBe('10 units')
  })

  it('a price a day behind the rest carries its own date, like stocks', () => {
    const d = build(both, { stockPrices: { ...stockPrices, 'US:VUAA.L': { cmp: 120, prevClose: 118, fetchedAt: '2026-09-23T10:00:00Z' } } })
    expect(d.stocks.rows.find(r => r.key === 'us:u1')?.staleDate).toBe('23 Sep')
  })

  it('a fully sold holding is not a row and adds nothing', () => {
    const d = build(usInput, { usTransactions: [usBuy('2025-01-10', 10, 100, 80), { ...usBuy('2025-06-10', 10, 110, 82), trade_type: 'sell' }] })
    expect(d.stocks.rows).toEqual([])
    expect(d.stocks.currentValue).toBeNull()
    expect(d.region.usValue).toBe(0)
  })
})
