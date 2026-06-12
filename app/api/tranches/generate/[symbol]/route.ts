import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { generateTranchesForSymbol } from '@/lib/tranche-pipeline'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ symbol: string }> }
) {
  const { symbol } = await params
  const upperSymbol = symbol.toUpperCase()
  const { fyId, remainingInr } = await req.json().catch(() => ({})) as { fyId?: string; remainingInr?: number }

  if (!fyId) return NextResponse.json({ error: 'fyId required' }, { status: 400 })

  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const result = await generateTranchesForSymbol(supabase, user.id, upperSymbol, fyId, remainingInr)

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

  if (result.blocked) {
    return NextResponse.json({
      symbol: upperSymbol,
      tranches: [],
      blocked: true,
      reason: result.reason,
    })
  }

  return NextResponse.json({
    symbol: upperSymbol,
    tranches: result.tranches,
    warning: result.warning,
    _debug: result.debug,
  })
}
