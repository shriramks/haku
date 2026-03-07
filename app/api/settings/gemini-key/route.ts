import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export async function GET() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data } = await supabase
    .from('user_settings')
    .select('gemini_api_key')
    .eq('user_id', user.id)
    .maybeSingle()

  return NextResponse.json({ hasKey: !!(data?.gemini_api_key) })
}

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { key } = await req.json()

  if (key === null || key === '') {
    // Clear the key
    await supabase
      .from('user_settings')
      .upsert({ user_id: user.id, gemini_api_key: null, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
    return NextResponse.json({ success: true, hasKey: false })
  }

  if (typeof key !== 'string' || !key.startsWith('AIza')) {
    return NextResponse.json({ error: 'Invalid Gemini API key format' }, { status: 400 })
  }

  const { error } = await supabase
    .from('user_settings')
    .upsert({ user_id: user.id, gemini_api_key: key, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, hasKey: true })
}
