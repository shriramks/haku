// XIRR: Extended IRR that accounts for irregular transaction timing.
// Uses Newton-Raphson iteration.

interface Cashflow {
  date: Date
  amount: number
}

const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000

export function xirr(cashflows: Cashflow[], guess = 0.1): number | null {
  if (cashflows.length < 2) return null

  const sorted = [...cashflows].sort((a, b) => a.date.getTime() - b.date.getTime())
  const t0 = sorted[0].date.getTime()
  const times   = sorted.map(cf => (cf.date.getTime() - t0) / MS_PER_YEAR)
  const amounts = sorted.map(cf => cf.amount)

  let r = guess
  for (let iter = 0; iter < 200; iter++) {
    let f = 0, df = 0
    for (let i = 0; i < amounts.length; i++) {
      const t      = times[i]
      const factor = Math.pow(1 + r, t)
      f  += amounts[i] / factor
      df -= amounts[i] * t / (factor * (1 + r))
    }
    if (Math.abs(df) < 1e-12) return null
    const delta = f / df
    r -= delta
    if (Math.abs(delta) < 1e-7) return r
  }
  return null
}

// Build XIRR cashflows from MF transactions + notional current value sale today.
// Buys are negative (cash out), sells and current value are positive (cash in).
export function mfXirr(
  transactions: Pick<import('./portfolio-types').MFTransaction, 'trade_date' | 'trade_type' | 'amount'>[],
  currentValue: number
): number | null {
  const flows: Cashflow[] = [
    ...transactions.map(t => ({ date: new Date(t.trade_date), amount: t.trade_type === 'buy' ? -t.amount : t.amount })),
    { date: new Date(), amount: currentValue },
  ]
  if (!flows.some(f => f.amount > 0) || !flows.some(f => f.amount < 0)) return null
  return xirr(flows)
}

export function sgbXirr(
  transactions: Pick<import('./portfolio-types').SGBTransaction, 'trade_date' | 'trade_type' | 'amount'>[],
  currentValue: number
): number | null {
  const flows: Cashflow[] = [
    ...transactions.map(t => ({ date: new Date(t.trade_date), amount: t.trade_type === 'buy' ? -t.amount : t.amount })),
    { date: new Date(), amount: currentValue },
  ]
  if (!flows.some(f => f.amount > 0) || !flows.some(f => f.amount < 0)) return null
  return xirr(flows)
}

export function ppfXirr(
  transactions: Pick<import('./portfolio-types').PPFTransaction, 'trade_date' | 'trade_type' | 'amount'>[],
  currentBalance: number
): number | null {
  const flows: Cashflow[] = [
    ...transactions.map(t => ({ date: new Date(t.trade_date), amount: t.trade_type === 'deposit' ? -t.amount : t.amount })),
    { date: new Date(), amount: currentBalance },
  ]
  if (!flows.some(f => f.amount > 0) || !flows.some(f => f.amount < 0)) return null
  return xirr(flows)
}

// Compound each deposit at 7.1% p.a. to estimate PPF balance.
// Simplified — actual PPF compounds annually on minimum monthly balance.
export function computePPFBalance(
  transactions: Pick<import('./portfolio-types').PPFTransaction, 'trade_date' | 'trade_type' | 'amount'>[]
): number {
  const today = Date.now()
  let balance = 0
  for (const t of transactions) {
    const years  = (today - new Date(t.trade_date).getTime()) / MS_PER_YEAR
    const sign   = t.trade_type === 'deposit' ? 1 : -1
    balance += sign * t.amount * Math.pow(1.071, Math.max(0, years))
  }
  return Math.max(0, balance)
}
