import { fetchStockDetailProps } from '@/lib/fetchStockDetailProps'
import BandDetailClient from './BandDetailClient'
import BottomNav from '@/components/BottomNav'

export default async function BandDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ symbol: string }>
  searchParams: Promise<{ fy?: string }>
}) {
  const { symbol } = await params
  const { fy: fyParam } = await searchParams

  const { fy, fyRow, band, allocation, tranches, allTimeQty, allTimeCost, hasKey, investability, symbolTxns, initialSnapshot, initialPriorSnapshot } =
    await fetchStockDetailProps(symbol, fyParam, true)

  const fyLabel = fy?.label
  const backHref = fyLabel ? `/bands?fy=${encodeURIComponent(fyLabel)}` : '/bands'

  return (
    <>
      <BandDetailClient
        symbol={symbol}
        band={band}
        allocation={allocation}
        fyRow={fyRow}
        allTimeQty={allTimeQty}
        allTimeCost={allTimeCost}
        tranches={tranches}
        fyId={fy?.id ?? ''}
        fyLabel={fyLabel ?? ''}
        backHref={backHref}
        backLabel="Bands"
        initialHasKey={hasKey}
        initialInvestability={investability}
        symbolTxns={symbolTxns}
        initialSnapshot={initialSnapshot}
        initialPriorSnapshot={initialPriorSnapshot}
      />
      <BottomNav />
    </>
  )
}
