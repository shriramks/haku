import { fetchStockDetailProps } from '@/lib/fetchStockDetailProps'
import BandDetailClient from '@/app/bands/[symbol]/BandDetailClient'
import BottomNav from '@/components/BottomNav'

export default async function StockDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ symbol: string }>
  searchParams: Promise<{ fy?: string }>
}) {
  const { symbol } = await params
  const { fy: fyParam } = await searchParams

  const { fy, fyRow, band, allocation, tranches, allTimeQty, allTimeCost, hasKey, aiProvider, investability } =
    await fetchStockDetailProps(symbol, fyParam)

  const backHref = fyParam ? `/allocation?fy=${encodeURIComponent(fyParam)}` : '/allocation'

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
        fyLabel={fy?.label ?? ''}
        backHref={backHref}
        backLabel="Allocation"
        initialHasKey={hasKey}
        initialAiProvider={aiProvider}
        initialInvestability={investability}
      />
      <BottomNav />
    </>
  )
}
