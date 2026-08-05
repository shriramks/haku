import type { FiscalYear, Transaction } from './types'
import type { MFund, MFTransaction, SGBTransaction } from './portfolio-types'
import { isFYClosed } from './fy-utils'
import { gatherBucketedGains } from './tax-compute'
import { bucketGains, applySetOff, sumCarryForward, consumeCarryForward } from './tax-liability'
import type { CarryForwardRow, CarryForwardDecrement } from './tax-liability'

// ── Carryforward ledger reconciliation ──────────────────────────────────────
// `capital_loss_carryforward` only gets written for a closed FY once this
// plan runs against it — nothing else in the app ever calls
// consumeCarryForward()/buildNewCarryForwardRows() for real. Runs against
// every closed FY oldest-first in one pass so a later FY's incoming
// carryforward is always correct even if an earlier FY was never viewed
// before (visit order must not matter for correctness).

/** Any fixed rate works here — applySetOff()'s `newCarryForward` (leftover
 * unabsorbed loss) and `carryForwardUsed` (incoming pool consumed) totals are
 * slab-rate-invariant: `absorb()` always drains every available target before
 * stopping, so the total absorbed from a pool is exactly
 * min(pool, sum of eligible target values) regardless of which order rate-based
 * sorting visits sources/targets in — only the *distribution* across buckets
 * depends on rate, which reconciliation doesn't persist. */
const RECONCILE_SLAB_RATE = 30

export interface ReconcileInputs {
  fiscalYears:  FiscalYear[]
  existingRows: CarryForwardRow[]
  stockMap:     Map<string, Transaction[]>
  mfMap:        Map<string, MFTransaction[]>
  mfFunds:      MFund[]
  goldMap:      Map<string, SGBTransaction[]>
  asOfToday:    string
}

/** One row to upsert on (user_id, fy_id, loss_type) — always written in pairs
 * (short + long) per newly-reconciled FY, even at 0, so a zero-carryforward
 * FY still leaves a marker distinguishing "reconciled, nothing left over"
 * from "never reconciled". Keyed by `fyStartDate`, not `fy_id` — the caller
 * (which already has the fiscal_years list) maps this back to a real fy_id. */
export interface CarryForwardUpsert {
  fyStartDate: string
  lossType:    'short' | 'long'
  amount:      number
  remaining:   number
}

export interface ReconcilePlan {
  /** Decrements against rows that already exist in the DB (real ids from `existingRows`). */
  decrements: CarryForwardDecrement[]
  /** New rows to upsert — one FY's own generated carryforward. */
  upserts:    CarryForwardUpsert[]
}

/**
 * Computes every DB write needed to bring the carryforward ledger up to date:
 * for each closed FY that has no row yet, run the #77 set-off pipeline over
 * that FY's own gains, decrement whatever incoming carryforward it consumed,
 * and record its own leftover loss as a new row. Processed oldest-first so a
 * FY generated *and* partially consumed within this same pass never emits a
 * decrement against a row that doesn't exist in the DB yet — that row's own
 * upsert just carries the already-net `remaining` instead.
 */
export function planCarryForwardReconciliation(inputs: ReconcileInputs): ReconcilePlan {
  const { fiscalYears, existingRows, stockMap, mfMap, mfFunds, goldMap, asOfToday } = inputs

  const closedFYs = fiscalYears
    .filter(fy => isFYClosed(fy, asOfToday))
    .sort((a, b) => a.start_date < b.start_date ? -1 : a.start_date > b.start_date ? 1 : 0)

  const rows: CarryForwardRow[] = existingRows.map(r => ({ ...r }))
  const decrementsById       = new Map<string, number>()
  const pendingByPlaceholder = new Map<string, CarryForwardUpsert>()
  const upserts: CarryForwardUpsert[] = []

  for (const fy of closedFYs) {
    if (rows.some(r => r.fyStartDate === fy.start_date)) continue  // already reconciled

    const priorRows = rows.filter(r => r.fyStartDate < fy.start_date)
    const incoming  = sumCarryForward(priorRows)

    const fyRange       = { start: fy.start_date, end: fy.end_date }
    const { equity, debt } = gatherBucketedGains({ stockMap, mfMap, mfFunds, goldMap, fyRange, asOf: fy.end_date })
    const raw            = bucketGains(equity, debt)
    const { newCarryForward, carryForwardUsed } = applySetOff(raw, incoming, RECONCILE_SLAB_RATE)

    for (const dec of consumeCarryForward(priorRows, carryForwardUsed)) {
      const pending = pendingByPlaceholder.get(dec.id)
      if (pending) {
        pending.remaining = dec.newRemaining  // not yet in the DB — fold into its own upsert
      } else {
        decrementsById.set(dec.id, dec.newRemaining)
      }
      const row = rows.find(r => r.id === dec.id)
      if (row) row.remaining = dec.newRemaining
    }

    for (const lossType of ['short', 'long'] as const) {
      const amount       = lossType === 'short' ? newCarryForward.shortTerm : newCarryForward.longTerm
      const upsert        = { fyStartDate: fy.start_date, lossType, amount, remaining: amount }
      const placeholderId = `pending:${fy.start_date}:${lossType}`
      upserts.push(upsert)
      pendingByPlaceholder.set(placeholderId, upsert)
      rows.push({ id: placeholderId, fyStartDate: fy.start_date, lossType, remaining: amount })
    }
  }

  return {
    decrements: [...decrementsById.entries()].map(([id, newRemaining]) => ({ id, newRemaining })),
    upserts,
  }
}
