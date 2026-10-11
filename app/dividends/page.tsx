import { getAllDividends, getTransactions } from '@/lib/data'
import { getStocks } from '@/lib/stock-master'
import { inrTransactions } from '@/lib/trade-fx'
import DividendsClient from './DividendsClient'

export default async function DividendsPage() {
  const [dividends, allTxns] = await Promise.all([
    getAllDividends(),
    getTransactions(),
  ])

  // Dividend lookups are by NSE symbol, so non-INR instruments are left out (#161 covers foreign-listed).
  const stocks = await getStocks([...new Set(allTxns.map(t => t.symbol))])

  return (
    <>
      <DividendsClient dividends={dividends} allTxns={inrTransactions(allTxns, stocks)} />
    </>
  )
}
