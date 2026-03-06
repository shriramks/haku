'use client'
import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabaseBrowser } from '@/lib/supabase-browser'

export default function UserMenu() {
  const [email, setEmail]           = useState<string | null>(null)
  const [open, setOpen]             = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const ref    = useRef<HTMLDivElement>(null)
  const router = useRouter()

  useEffect(() => {
    getSupabaseBrowser().auth.getUser().then(({ data }) => {
      setEmail(data.user?.email ?? null)
    })
  }, [])

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  async function signOut() {
    setSigningOut(true)
    await getSupabaseBrowser().auth.signOut()
    router.push('/login')
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
          className="absolute right-0 top-10 w-60 rounded-2xl p-4 z-50 shadow-xl"
          style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
          <p className="text-[11px] uppercase tracking-widest mb-1"
             style={{ color: 'var(--text-muted)' }}>Account</p>
          <p className="text-[14px] font-medium truncate mb-4"
             style={{ color: 'var(--text-primary)' }}>
            {email ?? '…'}
          </p>
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
