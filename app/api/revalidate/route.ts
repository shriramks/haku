import { NextRequest, NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase-server'

const VALID_TAGS = new Set([
  'fiscal_years', 'allocations', 'transactions', 'transactions_all',
  'buy_bands', 'buy_tranches', 'investability', 'playbook',
])

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { tags } = await req.json() as { tags: string[] }
  for (const tag of tags) {
    if (VALID_TAGS.has(tag)) revalidateTag(tag, {})
  }
  return NextResponse.json({ ok: true })
}
