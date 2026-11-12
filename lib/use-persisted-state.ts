'use client'
import { useCallback, useEffect, useState } from 'react'

/**
 * `useState` that remembers its value in this browser's localStorage.
 * Renders with `initial` first and swaps in the stored value after mount, so
 * server and client markup match. A stored value that fails `isValid` (stale
 * or hand-edited) is ignored. Storage being unavailable (private mode) just
 * means the value isn't remembered.
 */
export function usePersistedState<T extends string | number>(
  key: string, initial: T, isValid: (v: unknown) => v is T,
): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(initial)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(key)
      if (raw === null) return
      const parsed: unknown = JSON.parse(raw)
      if (isValid(parsed)) setValue(parsed)
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const set = useCallback((v: T) => {
    setValue(v)
    try { localStorage.setItem(key, JSON.stringify(v)) } catch {}
  }, [key])

  return [value, set]
}
