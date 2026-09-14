import { getTransactions, getFiscalYears, getCurrentFY } from '@/lib/data'
import TransactionsClient from './TransactionsClient'
import BottomNav from '@/components/BottomNav'

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{ symbol?: string; fund?: string }>
}) {
  const { symbol, fund } = await searchParams

  const fiscalYears = await getFiscalYears()
  const currentFY = getCurrentFY(fiscalYears) ?? null

  // ?symbol=/?fund= views load all-time transactions for that holding.
  // Main view loads only the current FY; older history is lazy-loaded client-side.
  const transactions = await getTransactions(symbol ? undefined : currentFY?.id)

  return (
    <>
      <TransactionsClient
        transactions={transactions}
        fiscalYears={fiscalYears}
        currentFY={currentFY}
        filterSymbol={symbol?.toUpperCase()}
        filterFundId={fund}
        initialFyId={(symbol || fund) ? undefined : currentFY?.id}
      />
      <BottomNav />
    </>
  )
}
