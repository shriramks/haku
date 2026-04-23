import { NextResponse } from 'next/server'

// Fetches 999-purity gold closing price from IBJA (ibjarates.com).
// IBJA quotes per 10g; we divide to get ₹/gram — the unit SGB redemption uses.
// Proxied server-side to avoid CORS.
export async function GET() {
  try {
    const res = await fetch('https://ibjarates.com/', {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; HakuApp/1.0)' },
      next: { revalidate: 3600 }, // cache 1 hour — IBJA updates twice daily
    })
    if (!res.ok) throw new Error(`IBJA ${res.status}`)

    const html = await res.text()

    // Primary: closing (PM) price for 999 purity
    const pmMatch = html.match(/id="lblGold999_PM"[^>]*>([\d,]+)<\/span>/)
    // Fallback: opening (AM) price
    const amMatch = html.match(/id="lblGold999_AM"[^>]*>([\d,]+)<\/span>/)

    const raw = pmMatch?.[1] ?? amMatch?.[1]
    if (!raw) throw new Error('price not found in IBJA page')

    const per10g      = parseFloat(raw.replace(/,/g, ''))
    const pricePerGram = per10g / 10

    return NextResponse.json({ pricePerGram, per10g, source: 'IBJA 999 purity' })
  } catch (err) {
    return NextResponse.json(
      { error: String(err), pricePerGram: null },
      { status: 502 }
    )
  }
}
