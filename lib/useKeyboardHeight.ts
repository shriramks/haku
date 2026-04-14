'use client'
import { useState, useEffect } from 'react'

/**
 * Returns the current on-screen keyboard height in pixels.
 * Uses visualViewport.resize + scroll to detect keyboard open/close on iOS.
 * Read-only — never mutates document.body styles.
 */
export function useKeyboardHeight(): number {
  const [kh, setKh] = useState(0)

  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return

    let raf = 0
    const update = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        // vv.offsetTop: non-zero when Safari URL bar animates simultaneously.
        // Subtracting it prevents the sheet from overshooting.
        setKh(Math.max(0, window.innerHeight - vv.height - vv.offsetTop))
      })
    }

    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update) // iOS sometimes pans vv instead of resizing
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
      cancelAnimationFrame(raf)
    }
  }, [])

  return kh
}
