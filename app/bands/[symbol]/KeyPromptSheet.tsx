'use client'
import { useState } from 'react'
import BottomSheet from '@/components/BottomSheet'
import SheetHeader from '@/components/SheetHeader'

export default function KeyPromptSheet({ onClose, onSaved }: {
  onClose: () => void
  onSaved: () => void
}) {
  const [key, setKey]       = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')

  async function save() {
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/settings/gemini-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: key.trim() }),
      })
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? 'Failed to save'); setSaving(false); return }
      onSaved()
      onClose()
    } catch {
      setError('Network error')
    }
    setSaving(false)
  }

  return (
    <BottomSheet onClose={onClose}>
      <SheetHeader
        title="AI API Key"
        left={<button onClick={onClose} className="text-accent text-headline" style={{ minHeight: 44 }}>Cancel</button>}
        right={
          <button onClick={save} disabled={saving || !key.trim()}
            className="text-accent text-headline font-semibold disabled:opacity-40" style={{ minHeight: 44 }}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        }
      />
      <div className="px-5 pt-4 space-y-4">
        <p className="text-subheadline text-center text-positive">
          ★ Gemini is used for investability scoring
        </p>
        <input
          type="password" placeholder="AIzaSy…" value={key}
          onChange={e => setKey(e.target.value)}
          className="w-full px-4 py-3.5 rounded-2xl text-headline outline-none"
          style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
          autoFocus
        />
        {error && <p className="text-negative text-subheadline">{error}</p>}
        <div className="rounded-2xl p-3.5"
             style={{ background: 'rgba(10,132,255,0.07)', border: '1px solid rgba(10,132,255,0.18)' }}>
          <p className="text-subheadline leading-relaxed" style={{ color: 'var(--text-2)' }}>
            <span className="font-semibold text-accent">Stored securely.</span>{' '}
            Your API key lives in your database and is locked to your login via row-level security.
            Band generation runs entirely on the server — your browser never sees the key again after you save it.
          </p>
        </div>
        <p className="text-subheadline text-center" style={{ color: 'var(--text-muted)' }}>
          Get a key at <span className="text-accent">aistudio.google.com</span>
        </p>
      </div>
    </BottomSheet>
  )
}
