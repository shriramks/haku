// ── Database row types (mirror of supabase-schema.sql) ──────────────────────

export interface FiscalYear {
  id: string
  user_id?: string
  label: string
  start_date: string   // "YYYY-MM-DD"
  end_date: string
  total_budget_inr: number
  unallocated_carryover_inr: number
  deploy_capital_inr: number
  created_at?: string
}

export interface StockAllocation {
  id: string
  fy_id: string
  user_id?: string
  symbol: string
  exchange: string
  allocation_pct: number
  category: string
  quality: number
  stress: number
}

export interface Transaction {
  id: string
  user_id?: string
  symbol: string
  exchange: string
  trade_date: string   // "YYYY-MM-DD"
  trade_type: 'buy' | 'sell'
  quantity: number
  price: number
  amount: number       // generated: quantity * price
  fy_id: string | null
  advance_fy_id: string | null
  notes: string
  created_at?: string
}

export interface BuyBand {
  id: string
  user_id?: string
  symbol: string
  anchor_type: 'PE'
  eps: number | null
  buy_low: number | null
  buy_high: number | null
  mid_low: number | null
  mid_high: number | null
  trim_price: number | null
  manual_cmp: number | null
  week_52_low: number | null
  week_52_high: number | null
  last_updated_at: string
  generated_at: string
  is_current: boolean
  notes: string
}

export interface BuyTranche {
  id: string
  user_id?: string
  symbol: string
  qty: number
  price: number
  sort_order: number
  fy_id?: string | null
  created_at?: string
}

// ── Derived / UI types ───────────────────────────────────────────────────────

export type BandSignal = 'buy' | 'hold' | 'trim' | 'deep' | 'unknown'

export const ALL_CATEGORIES = [
  'Nifty 50 Index',
  'Nifty Next 50 Index',
  'Commodity',
  'Cap-Light Infra',
  'Hospitals',
  'FMCG',
  'Tobacco Corp',
] as const

export type StockCategory = typeof ALL_CATEGORIES[number]

/** Suggested category for well-known symbols — used as autocomplete hint only */
export const DEFAULT_CATEGORY: Record<string, StockCategory> = {
  CAMS:        'Cap-Light Infra',
  IEX:         'Cap-Light Infra',
  NARAYANAHRU: 'Hospitals',
  NIFTYBEES:   'Nifty 50 Index',
  JUNIORBEES:  'Nifty Next 50 Index',
  SETFGOLD:    'Commodity',
  GOLDBEES:    'Commodity',
  ITC:         'Tobacco Corp',
  HUL:         'FMCG',
  NESTLEIND:   'FMCG',
}

// ── Computed row (dashboard) ─────────────────────────────────────────────────

export interface StockRow {
  symbol: string
  allocationPct: number
  budget: number
  /** FY net spend (clamped ≥ 0) — drives remaining/carryover/planning only */
  spent: number
  remaining: number
  pctRemaining: number
  qty: number
  avgCost: number
  /** FY-scoped sequential cost (seqCost on this FY's transactions) — drives bar fill and FY deployed % */
  currentCost: number
  cmp: number | null
  unrealisedPnL: number | null
  unrealisedPnLPct: number | null
  bandSignal: BandSignal
}
