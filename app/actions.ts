'use server'
import { revalidateTag } from 'next/cache'

export async function revalidateFiscalYears() {
  revalidateTag('fiscal_years', {})
}
