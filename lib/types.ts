// ── Database row types (mirror of supabase-schema.sql) ──────────────────────

export interface FiscalYear {
  id: string
  user_id?: string
  label: string
  start_date: string   // "YYYY-MM-DD"
  end_date: string
  total_budget_inr: number
  unallocated_carryover_inr: number | null
  deploy_capital_inr: number | null
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
  notes: string
  created_at?: string
}

export interface BuyBand {
  id: string
  user_id?: string
  symbol: string
  anchor_type: 'PE'
  eps: number | null
  pat_now: number | null
  pat_3yr_ago: number | null
  roce_3yr_avg: number | null
  mcap: number | null
  index_level: number | null
  index_pe: number | null
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
  risk_multiplier?: number | null
}

export interface Investability {
  id: string
  user_id?: string
  symbol: string
  assessed_at: string
  g1_moat: number
  g2_owner_earnings: number
  g3_capital_efficiency: number
  g4_innovation: number
  g5_execution_track: number
  g6_sector_winds: number
  g7_governance: number
  g8_supply_regulatory: number
  g9_market_cap: number
  g10_capital_discipline: number
  total_score: number
  investable: boolean
  notes: string
  rationale: Record<string, string>
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

export interface DividendTransaction {
  id: string
  user_id?: string
  symbol: string
  exchange: string
  ex_date: string    // "YYYY-MM-DD"
  per_share: number
  shares: number
  amount: number     // generated: per_share * shares
  created_at?: string
}

// ── Derived / UI types ───────────────────────────────────────────────────────


export const ALL_CATEGORIES = [
  'Nifty 50 Index',
  'Nifty Next 50 Index',
  'Cap-Light Infra',
  'Hospitals',
  'Branded Pharma',
  'Tobacco Corp',
  'Niche Cap Goods',
  'Jewellery',
] as const

export type StockCategory = typeof ALL_CATEGORIES[number]

/** Suggested category for well-known symbols — used as autocomplete hint only */
export const DEFAULT_CATEGORY: Record<string, StockCategory> = {
  CAMS:        'Cap-Light Infra',
  IEX:         'Cap-Light Infra',
  NARAYANAHRU: 'Hospitals',
  NIFTYBEES:   'Nifty 50 Index',
  JUNIORBEES:  'Nifty Next 50 Index',
  ITC:         'Tobacco Corp',
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
}
