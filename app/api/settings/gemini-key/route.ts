import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { encrypt } from '@/lib/encrypt'

export async function GET() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data } = await supabase
    .from('user_settings')
    .select('gemini_api_key, claude_api_key, ai_provider')
    .eq('user_id', user.id)
    .maybeSingle()

  const provider = data?.ai_provider ?? 'gemini'
  const hasKey = provider === 'claude'
    ? !!(data?.claude_api_key)
    : !!(data?.gemini_api_key)

  return NextResponse.json({ hasKey, provider })
}

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { key, provider = 'gemini' } = await req.json()

  if (provider !== 'gemini' && provider !== 'claude') {
    return NextResponse.json({ error: 'Invalid provider' }, { status: 400 })
  }

  const keyField = provider === 'claude' ? 'claude_api_key' : 'gemini_api_key'

  if (key === null || key === '') {
    await supabase.from('user_settings').upsert(
      { user_id: user.id, [keyField]: null, ai_provider: provider, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    )
    return NextResponse.json({ success: true, hasKey: false, provider })
  }

  if (provider === 'gemini' && !key.startsWith('AIza')) {
    return NextResponse.json({ error: 'Invalid Gemini API key — should start with AIza' }, { status: 400 })
  }
  if (provider === 'claude' && !key.startsWith('sk-ant-')) {
    return NextResponse.json({ error: 'Invalid Claude API key — should start with sk-ant-' }, { status: 400 })
  }

  const encryptedKey = await encrypt(key)
  const { error } = await supabase.from('user_settings').upsert(
    { user_id: user.id, [keyField]: encryptedKey, ai_provider: provider, updated_at: new Date().toISOString() },
    { onConflict: 'user_id' }
  )

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, hasKey: true, provider })
}
