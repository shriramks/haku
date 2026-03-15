// Static display names for NSE symbols.
// Purely presentational — shown as small muted text below the symbol.
// Add new entries here as stocks are added to the watchlist.

const NAMES: Record<string, string> = {
  BEL:       'Bharat Electronics',
  CAMS:      'CAMS',
  DMART:     'Avenue Supermarts',
  HAL:       'Hindustan Aeronautics',
  HDFCBANK:  'HDFC Bank',
  ICICIBANK: 'ICICI Bank',
  IEX:       'Indian Energy Exchange',
  ITC:       'ITC Limited',
  LT:        'Larsen & Toubro',
  NH:        'Narayana Hrudayalaya',
  POLYCAB:   'Polycab India',
  SBILIFE:   'SBI Life Insurance',
  TMCV:      'Tata Motors CV',
  ZYDUSLIFE: 'Zydus Lifesciences',
}

/** Returns the display name for a symbol, or undefined if not in the dictionary. */
export function getStockName(symbol: string): string | undefined {
  return NAMES[symbol.toUpperCase()]
}
