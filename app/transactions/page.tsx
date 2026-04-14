import { getTransactions, getFiscalYears, getCurrentFY } from '@/lib/data'
import TransactionsClient from './TransactionsClient'
import BottomNav from '@/components/BottomNav'

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{ symbol?: string }>
}) {
  const { symbol } = await searchParams
  const fiscalYears = await getFiscalYears()
  const currentFY = getCurrentFY(fiscalYears) ?? null
  const transactions = await getTransactions()

  return (
    <>
      <TransactionsClient
        transactions={transactions}
        fiscalYears={fiscalYears}
        currentFY={currentFY}
        filterSymbol={symbol?.toUpperCase()}
      />
      <BottomNav />
    </>
  )
}
