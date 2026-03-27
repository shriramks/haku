// ── Database row types (mirror of supabase-schema.sql) ──────────────────────

export interface FiscalYear {
  id: string
  user_id?: string
  label: string
  start_date: string   // "YYYY-MM-DD"
  end_date: string
  total_budget_inr: number
  unallocated_carryover_inr: number
  deploy_capital_inr?: number | null
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
  two_weak_quarters: boolean
  two_strong_quarters: boolean
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
  anchor_type: 'PE' | 'PB' | 'EV_EBITDA' | 'P_EV'
  eps: number | null
  bvps: number | null
  ebitda: number | null
  net_debt: number | null
  shares: number | null
  embedded_value: number | null
  buy_low: number | null
  buy_high: number | null
  mid_low: number | null
  mid_high: number | null
  trim_price: number | null
  manual_cmp: number | null
  last_updated_at: string
  generated_at: string
  is_current: boolean
  notes: string
}

export interface Investability {
  id: string
  user_id?: string
  symbol: string
  assessed_at: string
  sector_winds: GateSignal
  sector_winds_note: string
  circle_of_competence: GateSignal
  circle_note: string
  moat: GateSignal
  moat_note: string
  owner_earnings: GateSignal
  owner_earnings_note: string
  capital_efficiency: GateSignal
  capital_efficiency_note: string
  innovation_velocity: GateSignal
  innovation_note: string
  governance: GateSignal
  governance_note: string
  execution_track: GateSignal
  execution_note: string
  supply_chain_risk: GateSignal
  supply_chain_note: string
  regulatory_signal: GateSignal
  regulatory_note: string
  thesis_breaker: GateSignal
  thesis_breaker_note: string
  capital_discipline: GateSignal
  capital_discipline_note: string
  investable: boolean
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

export interface Playbook {
  id: string
  user_id?: string
  content: string
  updated_at: string
}

// ── Derived / UI types ───────────────────────────────────────────────────────

export type GateSignal = 'pass' | 'caution' | 'fail'

export type BandSignal = 'buy' | 'hold' | 'trim' | 'deep' | 'unknown'

export type StockCategory =
  | 'Nifty 50 Index'
  | 'Nifty Next 50 Index'
  | 'Commodity'
  | 'Cap-Light Infra'
  | 'Hospitals'
  | 'FMCG'
  | 'Tobacco Corp'

export const ALL_CATEGORIES: StockCategory[] = [
  'Nifty 50 Index',
  'Nifty Next 50 Index',
  'Commodity',
  'Cap-Light Infra',
  'Hospitals',
  'FMCG',
  'Tobacco Corp',
]

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
  spent: number
  remaining: number
  pctRemaining: number
  qty: number
  avgCost: number
  cmp: number | null
  unrealisedPnL: number | null
  unrealisedPnLPct: number | null
  bandSignal: BandSignal
}
