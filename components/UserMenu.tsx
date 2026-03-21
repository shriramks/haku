'use client'
import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabaseBrowser } from '@/lib/supabase-browser'

export default function UserMenu() {
  const [email, setEmail]           = useState<string | null>(null)
  const [open, setOpen]             = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [hasKey, setHasKey]             = useState<boolean | null>(null)
  const [aiProvider, setAiProvider]     = useState<'gemini' | 'claude'>('gemini')
  const [keyInput, setKeyInput]         = useState('')
  const [showKeyInput, setShowKeyInput] = useState(false)
  const [savingKey, setSavingKey]       = useState(false)
  const [keyError, setKeyError]         = useState('')
  const ref    = useRef<HTMLDivElement>(null)
  const router = useRouter()

  useEffect(() => {
    getSupabaseBrowser().auth.getUser().then(({ data }) => {
      setEmail(data.user?.email ?? null)
    })
  }, [])

  useEffect(() => {
    if (!open) return
    fetch('/api/settings/gemini-key').then(r => r.json()).then(d => {
      setHasKey(d.hasKey ?? false)
      setAiProvider(d.provider ?? 'gemini')
    }).catch(() => {})
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
        setShowKeyInput(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  async function signOut() {
    setSigningOut(true)
    await getSupabaseBrowser().auth.signOut()
    router.push('/login')
  }

  async function saveKey() {
    setSavingKey(true)
    setKeyError('')
    try {
      const res = await fetch('/api/settings/gemini-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: keyInput.trim(), provider: aiProvider }),
      })
      const json = await res.json()
      if (!res.ok) {
        setKeyError(json.error ?? 'Failed to save')
      } else {
        setHasKey(json.hasKey)
        setKeyInput('')
        setShowKeyInput(false)
      }
    } catch {
      setKeyError('Network error')
    }
    setSavingKey(false)
  }

  async function clearKey() {
    setSavingKey(true)
    await fetch('/api/settings/gemini-key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: '', provider: aiProvider }),
    })
    setHasKey(false)
    setShowKeyInput(false)
    setSavingKey(false)
  }

  return (
    <div className="flex items-center gap-2">
      <a
        href="/docs.html"
        target="_blank"
        rel="noopener noreferrer"
        className="w-11 h-11 rounded-full flex items-center justify-center transition-opacity active:opacity-60"
        style={{ background: 'var(--border)', color: 'var(--text-2)' }}
        aria-label="Help & Docs">
        <BookIcon className="w-4 h-4" />
      </a>
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(v => !v)}
        className="w-11 h-11 rounded-full flex items-center justify-center transition-opacity active:opacity-60"
        style={{ background: 'var(--border)', color: 'var(--text-2)' }}>
        <PersonIcon className="w-4 h-4" />
      </button>

      {open && (
        <div
          className="absolute right-0 top-10 w-72 rounded-2xl p-4 z-50 shadow-xl"
          style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
          <p className="text-[11px] uppercase tracking-widest mb-1"
             style={{ color: 'var(--text-muted)' }}>Account</p>
          <p className="text-[14px] font-medium truncate mb-4"
             style={{ color: 'var(--text-primary)' }}>
            {email ?? '…'}
          </p>

          {/* AI Settings */}
          <div className="mb-4 pb-4 border-b" style={{ borderColor: 'var(--border-faint)' }}>
            <p className="text-[11px] uppercase tracking-widest mb-2"
               style={{ color: 'var(--text-muted)' }}>AI Settings</p>

            {/* Provider toggle */}
            <div className="flex rounded-xl overflow-hidden border mb-2" style={{ borderColor: 'var(--border)' }}>
              {(['gemini', 'claude'] as const).map(p => (
                <button key={p} onClick={() => { setAiProvider(p); setShowKeyInput(false); setKeyInput(''); setKeyError('') }}
                  className="flex-1 py-2 text-[12px] font-medium transition-colors"
                  style={aiProvider === p
                    ? { background: '#0A84FF', color: '#fff' }
                    : { background: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}>
                  {p === 'gemini' ? 'Gemini' : 'Claude'}
                </button>
              ))}
            </div>
            {aiProvider === 'gemini' && (
              <p className="text-[10px] mb-2 text-center" style={{ color: '#34C759' }}>★ Recommended for band generation</p>
            )}

            <div className="flex items-center justify-between mb-1.5">
              <p className="text-[13px]" style={{ color: 'var(--text-2)' }}>
                {aiProvider === 'gemini' ? 'Gemini' : 'Claude'} API Key
              </p>
              <span className={`text-[11px] px-1.5 py-0.5 rounded-md ${hasKey ? 'text-green-500' : ''}`}
                    style={hasKey ? { background: 'rgba(52,199,89,0.12)' } : { color: 'var(--text-faint)' }}>
                {hasKey === null ? '…' : hasKey ? 'Set' : 'Not set'}
              </span>
            </div>

            {!showKeyInput ? (
              <button
                onClick={() => setShowKeyInput(true)}
                className="w-full py-2 rounded-xl text-[13px]"
                style={{ background: 'var(--bg-tertiary)', color: '#0A84FF', border: '1px solid var(--border)' }}>
                {hasKey ? 'Update Key' : 'Add Key'}
              </button>
            ) : (
              <div className="space-y-2">
                <input
                  type="password"
                  placeholder={aiProvider === 'claude' ? 'sk-ant-…' : 'AIzaSy…'}
                  value={keyInput}
                  onChange={e => setKeyInput(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl text-[13px] outline-none"
                  style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
                  autoFocus
                />
                {keyError && <p className="text-[11px] text-red-400">{keyError}</p>}
                <div className="flex gap-2">
                  <button onClick={() => { setShowKeyInput(false); setKeyInput(''); setKeyError('') }}
                    className="flex-1 py-1.5 rounded-xl text-[13px]"
                    style={{ background: 'var(--border)', color: 'var(--text-muted)' }}>
                    Cancel
                  </button>
                  {hasKey && (
                    <button onClick={clearKey} disabled={savingKey}
                      className="flex-1 py-1.5 rounded-xl text-[13px] text-red-400 disabled:opacity-40"
                      style={{ background: 'rgba(255,59,48,0.10)' }}>
                      Clear
                    </button>
                  )}
                  <button onClick={saveKey} disabled={savingKey || !keyInput.trim()}
                    className="flex-1 py-1.5 rounded-xl text-[13px] font-semibold text-[#0A84FF] disabled:opacity-40"
                    style={{ background: 'rgba(10,132,255,0.15)' }}>
                    {savingKey ? '…' : 'Save'}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Data */}
          <div className="mb-4 pb-4 border-b" style={{ borderColor: 'var(--border-faint)' }}>
            <p className="text-[11px] uppercase tracking-widest mb-2"
               style={{ color: 'var(--text-muted)' }}>Data</p>
            <a
              href="/import"
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 w-full rounded-xl text-[15px] font-medium"
              style={{
                minHeight: 44,
                padding: '0 12px',
                background: 'var(--bg-tertiary)',
                color: 'var(--text-2)',
                border: '1px solid var(--border)',
                display: 'flex',
                alignItems: 'center',
                textDecoration: 'none',
              }}>
              <UploadIcon className="w-5 h-5 flex-shrink-0 text-[#0A84FF]" />
              Import from Zerodha CSV
            </a>
          </div>

          <button
            onClick={signOut}
            disabled={signingOut}
            className="w-full py-2.5 rounded-xl text-[15px] font-semibold text-red-400 disabled:opacity-40"
            style={{ background: 'rgba(255,59,48,0.10)' }}>
            {signingOut ? 'Signing out…' : 'Sign Out'}
          </button>
        </div>
      )}
    </div>
    </div>
  )
}

function PersonIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
    </svg>
  )
}

function BookIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
    </svg>
  )
}

function UploadIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
    </svg>
  )
}
