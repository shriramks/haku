import { getAllDividends, getTransactions } from '@/lib/data'
import DividendsClient from './DividendsClient'
import BottomNav from '@/components/BottomNav'

export default async function DividendsPage() {
  const [dividends, allTxns] = await Promise.all([
    getAllDividends(),
    getTransactions(),
  ])

  return (
    <>
      <DividendsClient dividends={dividends} allTxns={allTxns} />
      <BottomNav />
    </>
  )
}
