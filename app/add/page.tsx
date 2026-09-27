import { getAllStockSymbols } from '@/lib/data'
import AddClient from './AddClient'

export default async function AddPage() {
  const planSymbols = await getAllStockSymbols()

  return <AddClient planSymbols={planSymbols} />
}
