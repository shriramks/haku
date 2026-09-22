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

// ── Cashflow builders ─────────────────────────────────────────────────────────
// All asset-class XIRRs reduce to the same shape: transactions become signed
// cashflows (outflow type negative), plus a notional terminal value on asOfDate.

type FlowTxn = { trade_date: string; trade_type: string; amount: number }

interface FlowRule {
  out: string        // trade_type that is a cash outflow (negative)
  skip?: string[]    // trade_types that are not cash flows at all
  onlyOut?: boolean  // keep only outflow rows (EPF: deposits only, interest is in the balance)
}

const TRADE_RULE: FlowRule = { out: 'buy' }
// Interest rows are not cash flows — they're already reflected in the balance
const PPF_RULE: FlowRule = { out: 'deposit', skip: ['interest'] }
const EPF_RULE: FlowRule = { out: 'deposit', onlyOut: true }

function buildCashflows(txns: FlowTxn[], rule: FlowRule): Cashflow[] {
  return txns
    .filter(t => rule.onlyOut ? t.trade_type === rule.out : !rule.skip?.includes(t.trade_type))
    .map(t => ({ date: new Date(t.trade_date), amount: t.trade_type === rule.out ? -t.amount : t.amount }))
}

// Append the terminal value and run XIRR; needs at least one flow of each sign.
function flowsXirr(flows: Cashflow[], terminalValue: number, asOfDate = new Date()): number | null {
  const all = [...flows, { date: asOfDate, amount: terminalValue }]
  if (!all.some(f => f.amount > 0) || !all.some(f => f.amount < 0)) return null
  return xirr(all)
}

export function mfXirr(
  transactions: Pick<import('./portfolio-types').MFTransaction, 'trade_date' | 'trade_type' | 'amount'>[],
  currentValue: number
): number | null {
  return flowsXirr(buildCashflows(transactions, TRADE_RULE), currentValue)
}

export function sgbXirr(
  transactions: Pick<import('./portfolio-types').SGBTransaction, 'trade_date' | 'trade_type' | 'amount'>[],
  currentValue: number
): number | null {
  return flowsXirr(buildCashflows(transactions, TRADE_RULE), currentValue)
}

export function ppfXirr(
  transactions: Pick<import('./portfolio-types').PPFTransaction, 'trade_date' | 'trade_type' | 'amount'>[],
  currentBalance: number
): number | null {
  return flowsXirr(buildCashflows(transactions, PPF_RULE), currentBalance)
}

export function epfXirr(
  transactions: Pick<import('./portfolio-types').EPFTransaction, 'trade_date' | 'trade_type' | 'amount'>[],
  currentBalance: number,
  asOfDate: Date = new Date()
): number | null {
  return flowsXirr(buildCashflows(transactions, EPF_RULE), currentBalance, asOfDate)
}

export function computeEPFBalance(
  transactions: Pick<import('./portfolio-types').EPFTransaction, 'trade_type' | 'amount'>[]
): number {
  return transactions.reduce((sum, t) => sum + t.amount, 0)
}

// PPF balance is the sum of stored rows: deposits and interest add, withdrawals subtract.
// Interest is never estimated — it is whatever the passbook credited, entered as 'interest' rows.
export function computePPFBalance(
  transactions: Pick<import('./portfolio-types').PPFTransaction, 'trade_type' | 'amount'>[]
): number {
  return transactions.reduce((sum, t) => sum + (t.trade_type === 'withdrawal' ? -t.amount : t.amount), 0)
}

// Stock XIRR: buys are negative (cash out), sells positive (cash in),
// remaining position valued at currentValue on asOfDate.
export function stockXirr(
  transactions: Pick<import('./types').Transaction, 'trade_date' | 'trade_type' | 'amount'>[],
  currentValue: number,
  asOfDate: Date = new Date()
): number | null {
  return flowsXirr(buildCashflows(transactions, TRADE_RULE), currentValue, asOfDate)
}

// 1D XIRR: today's blended portfolio return, annualised. Feeds the existing xirr()
// engine two cashflows exactly 1 day apart — yesterday's total (today − 1D gain) as
// an outflow, today's total as an inflow — which reduces to (today/yesterday)^365 − 1.
// A single-day gap makes the exponent in xirr()'s Newton-Raphson tiny (~1/365.25), so
// the function is nearly flat in r and the solver's default guess (10%) doesn't
// converge for a loss. The exact root has a closed form here — pass it as the guess
// so the shared solver still runs, but lands in one step instead of drifting.
export function oneDayXirr(
  currentValue: number,
  gain1d: number,
  asOfDate: Date = new Date()
): number | null {
  const previousValue = currentValue - gain1d
  if (currentValue <= 0 || previousValue <= 0) return null
  const yesterday = new Date(asOfDate)
  yesterday.setDate(yesterday.getDate() - 1)
  const t = (asOfDate.getTime() - yesterday.getTime()) / MS_PER_YEAR
  const guess = Math.pow(currentValue / previousValue, 1 / t) - 1
  return xirr([
    { date: yesterday, amount: -previousValue },
    { date: asOfDate,  amount: currentValue },
  ], guess)
}

// Portfolio-level XIRR across all asset classes.
// totalCurrentValue must equal the sum of equity + MF + gold + PPF current values
// used in the portfolio summary — consistency between cashflows and terminal value matters.
export function portfolioXirr(
  stockTxns: Pick<import('./types').Transaction, 'trade_date' | 'trade_type' | 'amount'>[],
  mfTxns:    Pick<import('./portfolio-types').MFTransaction,  'trade_date' | 'trade_type' | 'amount'>[],
  sgbTxns:   Pick<import('./portfolio-types').SGBTransaction, 'trade_date' | 'trade_type' | 'amount'>[],
  ppfTxns:   Pick<import('./portfolio-types').PPFTransaction, 'trade_date' | 'trade_type' | 'amount'>[],
  epfTxns:   Pick<import('./portfolio-types').EPFTransaction, 'trade_date' | 'trade_type' | 'amount'>[],
  totalCurrentValue: number,
  asOfDate: Date = new Date()
): number | null {
  return flowsXirr([
    ...buildCashflows(stockTxns, TRADE_RULE),
    ...buildCashflows(mfTxns,    TRADE_RULE),
    ...buildCashflows(sgbTxns,   TRADE_RULE),
    ...buildCashflows(ppfTxns,   PPF_RULE),
    ...buildCashflows(epfTxns,   EPF_RULE),
  ], totalCurrentValue, asOfDate)
}
