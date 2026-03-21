import { getFiscalYears, getAllocations, getTransactions, getBuyBands, getBuyTranches } from '@/lib/data'
import { computeStockRows } from '@/lib/compute'
import BandsClient from './BandsClient'
import BottomNav from '@/components/BottomNav'

export default async function BandsPage({
  searchParams,
}: {
  searchParams: Promise<{ fy?: string }>
}) {
  const fiscalYears = await getFiscalYears()
  const { fy: fyParam } = await searchParams
  const today = new Date()

  const fy = fyParam
    ? (fiscalYears.find(f => f.label === fyParam) ?? fiscalYears[0])
    : (fiscalYears.find(f => new Date(f.start_date) <= today && today <= new Date(f.end_date)) ?? fiscalYears[fiscalYears.length - 1])

  const [allocations, transactions, bands, tranches] = fy
    ? await Promise.all([getAllocations(fy.id), getTransactions(fy.id), getBuyBands(), getBuyTranches(fy.id)])
    : [[], [], [], []]

  const rows = computeStockRows(allocations, transactions, bands, fy?.total_budget_inr ?? 0, fy?.id)

  const sorted = [...rows].sort((a, b) => {
    const aAll      = tranches.filter(t => t.symbol === a.symbol)
    const bAll      = tranches.filter(t => t.symbol === b.symbol)
    const aPending  = aAll.filter(t => !t.allocated).length
    const bPending  = bAll.filter(t => !t.allocated).length
    // group 0 = no tranches yet (top), 1 = has pending, 2 = all done (bottom)
    const aGroup = aAll.length === 0 ? 0 : aPending > 0 ? 1 : 2
    const bGroup = bAll.length === 0 ? 0 : bPending > 0 ? 1 : 2
    if (aGroup !== bGroup) return aGroup - bGroup
    if (aPending !== bPending) return bPending - aPending
    return a.symbol.localeCompare(b.symbol)
  })

  return (
    <>
      <BandsClient
          rows={sorted}
          bands={bands}
          allocations={allocations}
          initialTranches={tranches}
          fyId={fy?.id ?? ''}
          fyLabel={fy?.label}
          fiscalYears={fiscalYears}
          selectedFY={fy ?? null}
      />
      <BottomNav />
    </>
  )
}
