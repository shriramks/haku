'use client'
import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabaseBrowser } from '@/lib/supabase-browser'

export default function UserMenu() {
  const [email, setEmail]           = useState<string | null>(null)
  const [open, setOpen]             = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [hasGeminiKey, setHasGeminiKey] = useState<boolean | null>(null)
  const [geminiInput, setGeminiInput]   = useState('')
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
      setHasGeminiKey(d.hasKey ?? false)
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

  async function saveGeminiKey() {
    setSavingKey(true)
    setKeyError('')
    try {
      const res = await fetch('/api/settings/gemini-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: geminiInput.trim() }),
      })
      const json = await res.json()
      if (!res.ok) {
        setKeyError(json.error ?? 'Failed to save')
      } else {
        setHasGeminiKey(json.hasKey)
        setGeminiInput('')
        setShowKeyInput(false)
      }
    } catch {
      setKeyError('Network error')
    }
    setSavingKey(false)
  }

  async function clearGeminiKey() {
    setSavingKey(true)
    await fetch('/api/settings/gemini-key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: '' }),
    })
    setHasGeminiKey(false)
    setShowKeyInput(false)
    setSavingKey(false)
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(v => !v)}
        className="w-8 h-8 rounded-full flex items-center justify-center transition-opacity active:opacity-60"
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

            <div className="flex items-center justify-between mb-1.5">
              <p className="text-[13px]" style={{ color: 'var(--text-2)' }}>Gemini API Key</p>
              <span className={`text-[11px] px-1.5 py-0.5 rounded-md ${hasGeminiKey ? 'text-green-500' : ''}`}
                    style={hasGeminiKey ? { background: 'rgba(52,199,89,0.12)' } : { color: 'var(--text-faint)' }}>
                {hasGeminiKey === null ? '…' : hasGeminiKey ? 'Set' : 'Not set'}
              </span>
            </div>

            {!showKeyInput ? (
              <button
                onClick={() => setShowKeyInput(true)}
                className="w-full py-2 rounded-xl text-[13px]"
                style={{ background: 'var(--bg-tertiary)', color: '#0A84FF', border: '1px solid var(--border)' }}>
                {hasGeminiKey ? 'Update Key' : 'Add Key'}
              </button>
            ) : (
              <div className="space-y-2">
                <input
                  type="password"
                  placeholder="AIzaSy…"
                  value={geminiInput}
                  onChange={e => setGeminiInput(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl text-[13px] outline-none"
                  style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
                  autoFocus
                />
                {keyError && <p className="text-[11px] text-red-400">{keyError}</p>}
                <div className="flex gap-2">
                  <button onClick={() => { setShowKeyInput(false); setGeminiInput(''); setKeyError('') }}
                    className="flex-1 py-1.5 rounded-xl text-[13px]"
                    style={{ background: 'var(--border)', color: 'var(--text-muted)' }}>
                    Cancel
                  </button>
                  {hasGeminiKey && (
                    <button onClick={clearGeminiKey} disabled={savingKey}
                      className="flex-1 py-1.5 rounded-xl text-[13px] text-red-400 disabled:opacity-40"
                      style={{ background: 'rgba(255,59,48,0.10)' }}>
                      Clear
                    </button>
                  )}
                  <button onClick={saveGeminiKey} disabled={savingKey || !geminiInput.trim()}
                    className="flex-1 py-1.5 rounded-xl text-[13px] font-semibold text-[#0A84FF] disabled:opacity-40"
                    style={{ background: 'rgba(10,132,255,0.15)' }}>
                    {savingKey ? '…' : 'Save'}
                  </button>
                </div>
              </div>
            )}
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
