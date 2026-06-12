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
  currentBalance: number
): number | null {
  return flowsXirr(buildCashflows(transactions, EPF_RULE), currentBalance)
}

export function computeEPFBalance(
  transactions: Pick<import('./portfolio-types').EPFTransaction, 'trade_type' | 'amount'>[]
): number {
  return transactions.reduce((sum, t) => sum + t.amount, 0)
}

// Compute PPF balance from stored transactions.
// If 'interest' rows exist (imported from passbook), sum deposits + interest directly.
// Otherwise fall back to month-by-month rate estimation using the RBI rule:
//   - Deposits on or before the 5th earn interest for that month.
//   - Interest accrues monthly, credited on 31 March each year.
export function computePPFBalance(
  transactions: Pick<import('./portfolio-types').PPFTransaction, 'trade_date' | 'trade_type' | 'amount'>[],
  asOfDate: Date = new Date()
): number {
  if (transactions.length === 0) return 0

  if (transactions.some(t => t.trade_type === 'interest')) {
    return transactions.reduce((sum, t) => {
      if (t.trade_type === 'deposit')    return sum + t.amount
      if (t.trade_type === 'withdrawal') return sum - t.amount
      if (t.trade_type === 'interest')   return sum + t.amount
      return sum
    }, 0)
  }

  // Legacy rate-based fallback (no interest rows stored yet)
  const RATE = 0.071
  const sorted = [...transactions].sort((a, b) => a.trade_date.localeCompare(b.trade_date))
  const first  = new Date(sorted[0].trade_date)

  let balance = 0
  let accrued = 0
  let y = first.getFullYear()
  let m = first.getMonth()

  while (y < asOfDate.getFullYear() || (y === asOfDate.getFullYear() && m <= asOfDate.getMonth())) {
    let interestBase = balance
    for (const t of sorted) {
      const d = new Date(t.trade_date)
      if (d.getFullYear() !== y || d.getMonth() !== m) continue
      const delta = t.trade_type === 'deposit' ? t.amount : -t.amount
      balance += delta
      if (d.getDate() <= 5) interestBase += delta
    }
    accrued += Math.max(0, interestBase) * (RATE / 12)
    if (m === 2) { balance += accrued; accrued = 0 }
    if (++m > 11) { m = 0; y++ }
  }

  return Math.max(0, balance + accrued)
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
