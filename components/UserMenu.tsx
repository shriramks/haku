'use client'
import type { ReactNode } from 'react'
import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabaseBrowser } from '@/lib/supabase-browser'
import { ChevronRightIcon } from '@/components/icons'

interface MenuAction {
  label: string
  icon: ReactNode
  onClick: () => void
  hint?: string
  trailing?: ReactNode
}

interface MenuSection {
  title: string
  items: MenuAction[]
}

interface Props {
  extraSections?: MenuSection[]
}

export default function UserMenu({ extraSections = [] }: Props) {
  const [email, setEmail]               = useState<string | null>(null)
  const [open, setOpen]                 = useState(false)
  const [signingOut, setSigningOut]     = useState(false)
  const [hasKey, setHasKey]             = useState<boolean | null>(null)
  const [keyInput, setKeyInput]         = useState('')
  const [showKeyInput, setShowKeyInput] = useState(false)
  const [savingKey, setSavingKey]       = useState(false)
  const [keyError, setKeyError]         = useState('')
  const [theme, setTheme]               = useState<'auto' | 'light' | 'dark'>('auto')
  const ref                             = useRef<HTMLDivElement>(null)
  const router                          = useRouter()

  useEffect(() => {
    getSupabaseBrowser().auth.getUser().then(({ data }) => {
      setEmail(data.user?.email ?? null)
    })
    try {
      const saved = localStorage.getItem('haku-theme')
      if (saved === 'dark' || saved === 'light') setTheme(saved)
    } catch {}
  }, [])

  useEffect(() => {
    if (!open) return
    fetch('/api/settings/gemini-key').then(r => r.json()).then(d => {
      setHasKey(d.hasKey ?? false)
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
        body: JSON.stringify({ key: keyInput.trim() }),
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
      body: JSON.stringify({ key: '' }),
    })
    setHasKey(false)
    setShowKeyInput(false)
    setSavingKey(false)
  }

  function selectTheme(t: 'auto' | 'light' | 'dark') {
    setTheme(t)
    try { localStorage.setItem('haku-theme', t) } catch {}
    if (t === 'auto') {
      delete document.documentElement.dataset.theme
    } else {
      document.documentElement.dataset.theme = t
    }
  }

  function runMenuAction(action: () => void) {
    setOpen(false)
    setShowKeyInput(false)
    action()
  }

  function renderMenuSection(title: string, items: MenuAction[]) {
    if (items.length === 0) return null

    return (
      <div className="space-y-1">
        <p className="text-footnote uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
          {title}
        </p>
        <div>
          {items.map((item, i) => (
            <button
              key={item.label}
              onClick={() => runMenuAction(item.onClick)}
              className="flex items-center gap-3 w-full text-left tap-row"
              style={{
                minHeight: 44,
                padding: '12px 16px',
                background: 'transparent',
                color: 'var(--text-primary)',
                borderBottom: i < items.length - 1 ? '1px solid var(--divider)' : undefined,
              }}>
              <span className="w-5 h-5 flex items-center justify-center flex-shrink-0 text-accent">
                {item.icon}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-body font-medium" style={{ color: 'var(--text-primary)' }}>{item.label}</p>
                {item.hint && (
                  <p className="text-footnote mt-0.5" style={{ color: 'var(--text-muted)' }}>{item.hint}</p>
                )}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {item.trailing}
                <ChevronRightIcon className="w-3.5 h-3.5" style={{ color: 'var(--text-faint)' }} />
              </div>
            </button>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(v => !v)}
        className="w-11 h-11 rounded-full flex items-center justify-center transition-opacity active:opacity-60"
        style={{ background: 'var(--bg-tertiary)', color: 'var(--text-2)' }}>
        <CogIcon className="w-4 h-4" />
      </button>

      {open && (
        <div
          className="absolute right-0 top-10 w-72 rounded-2xl p-4 z-50 shadow-xl"
          style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
          <p className="text-footnote uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>
            Account
          </p>
          <p className="text-body font-medium truncate mb-4" style={{ color: 'var(--text-primary)' }}>
            {email ?? '…'}
          </p>

          <div className="space-y-5">

            {/* Appearance */}
            <div className="space-y-1">
              <p className="text-footnote uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
                Appearance
              </p>
              <div className="flex rounded-xl p-0.5 gap-0.5" style={{ background: 'var(--bg-tertiary)' }}>
                {(['auto', 'light', 'dark'] as const).map(t => (
                  <button
                    key={t}
                    onClick={() => selectTheme(t)}
                    className="flex-1 flex flex-col items-center justify-center gap-0.5 rounded-[10px] transition-all"
                    style={{
                      minHeight: 52,
                      background: theme === t ? 'var(--bg-secondary)' : 'transparent',
                      boxShadow: theme === t ? '0 1px 4px rgba(0,0,0,0.12)' : undefined,
                      color: theme === t ? 'var(--accent)' : 'var(--text-muted)',
                    }}>
                    <span className="w-5 h-5 flex items-center justify-center">
                      {t === 'auto'  && <ThemeAutoIcon />}
                      {t === 'light' && <ThemeLightIcon />}
                      {t === 'dark'  && <ThemeDarkIcon />}
                    </span>
                    <span className="text-[11px] font-medium leading-none capitalize">{t}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              {renderMenuSection('AI Settings', [
                {
                  label: 'Gemini API Key',
                  hint: 'Used for band generation and investability checks',
                  icon: <SparkIcon className="w-5 h-5" />,
                  trailing: (
                    <span className="text-subheadline"
                          style={{ color: hasKey === null ? 'var(--text-faint)' : hasKey ? 'var(--c-positive)' : 'var(--text-muted)' }}>
                      {hasKey === null ? '…' : hasKey ? 'Set' : 'Not set'}
                    </span>
                  ),
                  onClick: () => setShowKeyInput(v => !v),
                },
              ])}

              {showKeyInput && (
                <div className="space-y-3 pt-3">
                  <input
                    type="password"
                    placeholder="AIzaSy…"
                    value={keyInput}
                    onChange={e => setKeyInput(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl text-body outline-none"
                    style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
                    autoFocus
                  />
                  {keyError && <p className="text-footnote text-negative">{keyError}</p>}
                  <div className="flex gap-2">
                    <button
                      onClick={() => { setShowKeyInput(false); setKeyInput(''); setKeyError('') }}
                      className="flex-1 min-h-[44px] rounded-xl text-subheadline"
                      style={{ background: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}>
                      Cancel
                    </button>
                    {hasKey && (
                      <button
                        onClick={clearKey}
                        disabled={savingKey}
                        className="flex-1 min-h-[44px] rounded-xl text-subheadline text-negative disabled:opacity-40"
                        style={{ background: 'rgba(255,59,48,0.10)' }}>
                        Clear
                      </button>
                    )}
                    <button
                      onClick={saveKey}
                      disabled={savingKey || !keyInput.trim()}
                      className="flex-1 min-h-[44px] rounded-xl text-subheadline font-semibold text-accent disabled:opacity-40"
                      style={{ background: 'var(--bg-tertiary)' }}>
                      {savingKey ? '…' : hasKey ? 'Update' : 'Save'}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {extraSections.map(section => (
              <div key={section.title}>
                {renderMenuSection(section.title, section.items)}
              </div>
            ))}

            {renderMenuSection('Resources', [
              {
                label: 'Docs',
                icon: <BookIcon className="w-5 h-5" />,
                onClick: () => window.open('/docs.html', '_blank', 'noopener,noreferrer'),
              },
            ])}

            <button
              onClick={signOut}
              disabled={signingOut}
              className="w-full py-2.5 rounded-xl text-body font-semibold text-negative disabled:opacity-40"
              style={{ background: 'rgba(255,59,48,0.10)' }}>
              {signingOut ? 'Signing out…' : 'Sign Out'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function CogIcon({ className, ...props }: React.SVGProps<SVGSVGElement>) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} {...props}>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  )
}

function BookIcon({ className, ...props }: React.SVGProps<SVGSVGElement>) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} {...props}>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
    </svg>
  )
}


function ThemeAutoIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
      <path d="M12 3a9 9 0 0 0 0 18V3z" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="9" />
    </svg>
  )
}

function ThemeLightIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
      <circle cx="12" cy="12" r="4" />
      <line x1="12" y1="2"  x2="12" y2="5" />
      <line x1="12" y1="19" x2="12" y2="22" />
      <line x1="4.22" y1="4.22"   x2="6.34" y2="6.34" />
      <line x1="17.66" y1="17.66" x2="19.78" y2="19.78" />
      <line x1="2"  y1="12" x2="5"  y2="12" />
      <line x1="19" y1="12" x2="22" y2="12" />
      <line x1="4.22" y1="19.78"  x2="6.34" y2="17.66" />
      <line x1="17.66" y1="6.34"  x2="19.78" y2="4.22" />
    </svg>
  )
}

function ThemeDarkIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
    </svg>
  )
}


function SparkIcon({ className, ...props }: React.SVGProps<SVGSVGElement>) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z" />
    </svg>
  )
}

