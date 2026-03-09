'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabaseBrowser } from '@/lib/supabase-browser'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isSignUp, setIsSignUp] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const supabase = getSupabaseBrowser()

    const { error } = isSignUp
      ? await supabase.auth.signUp({ email, password })
      : await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }
    router.push('/dashboard')
    router.refresh()
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 bg-[#F2F2F7] dark:bg-black [padding-bottom:0!important]">
      {/* Logo */}
      <div className="text-center mb-12">
        <div className="text-6xl mb-4">📈</div>
        <h1 className="text-3xl font-bold tracking-tight text-black dark:text-white">Haku</h1>
        <p className="text-sm mt-1 text-black/40 dark:text-white/50">Your Indian stock playbook</p>
      </div>

      {/* Form */}
      <form onSubmit={submit} className="w-full max-w-sm space-y-3">
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          required
          autoComplete="email"
          className="w-full px-4 py-3.5 rounded-xl outline-none text-base
                     bg-white dark:bg-[#1C1C1E]
                     text-black dark:text-white
                     placeholder:text-black/30 dark:placeholder:text-white/30
                     border border-black/10 dark:border-white/10"
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          required
          minLength={6}
          autoComplete={isSignUp ? 'new-password' : 'current-password'}
          className="w-full px-4 py-3.5 rounded-xl outline-none text-base
                     bg-white dark:bg-[#1C1C1E]
                     text-black dark:text-white
                     placeholder:text-black/30 dark:placeholder:text-white/30
                     border border-black/10 dark:border-white/10"
        />

        {error && (
          <p className="text-red-400 text-sm text-center">{error}</p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full py-3.5 rounded-xl font-bold text-base disabled:opacity-40 active:scale-95 transition-transform
                     bg-black text-white dark:bg-white dark:text-black"
        >
          {loading ? '…' : isSignUp ? 'Create account' : 'Sign in'}
        </button>

        <button
          type="button"
          onClick={() => { setIsSignUp(v => !v); setError(null) }}
          className="w-full text-sm py-2 text-black/40 dark:text-white/40"
        >
          {isSignUp ? 'Already have an account? Sign in' : 'New here? Create account'}
        </button>
      </form>
    </div>
  )
}
