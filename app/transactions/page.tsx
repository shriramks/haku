import { getTransactions, getFiscalYears, getCurrentFY } from '@/lib/data'
import TransactionsClient from './TransactionsClient'
import BottomNav from '@/components/BottomNav'

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{ symbol?: string; fy?: string }>
}) {
  const { symbol, fy: fyParam } = await searchParams
  const fiscalYears = await getFiscalYears()

  const selectedFY = getCurrentFY(fiscalYears, fyParam)

  const transactions = await getTransactions(selectedFY?.id)

  return (
    <>
      <TransactionsClient
        key={selectedFY?.id ?? 'no-fy'}
        transactions={transactions}
        fiscalYears={fiscalYears}
        selectedFY={selectedFY ?? null}
        filterSymbol={symbol?.toUpperCase()}
      />
      <BottomNav />
    </>
  )
}
