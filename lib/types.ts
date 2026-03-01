// ── Database row types (mirror of supabase-schema.sql) ──────────────────────

export interface FiscalYear {
  id: string
  user_id: string
  label: string
  start_date: string   // "YYYY-MM-DD"
  end_date: string
  total_budget_inr: number
  created_at?: string
}

export interface StockAllocation {
  id: string
  fy_id: string
  user_id: string
  symbol: string
  exchange: string
  allocation_pct: number
  category: string
  two_weak_quarters: boolean
  is_hospital_ramp_phase: boolean
}

export interface Transaction {
  id: string
  user_id: string
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
  user_id: string
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
  notes: string
}

export interface Investability {
  id: string
  user_id: string
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

// ── Derived / UI types ───────────────────────────────────────────────────────

export type GateSignal = 'pass' | 'caution' | 'fail'

export type BandSignal = 'buy' | 'hold' | 'trim' | 'deep' | 'unknown'

export type StockCategory =
  | 'Capital-light Market Infra/Services'
  | 'Retail'
  | 'Defence'
  | 'Insurance'
  | 'Electricals/Capital Goods'
  | 'Asset-heavy Infra/Platforms'
  | 'Hospitals'
  | 'FMCG'
  | 'Auto OEM'
  | 'Pharma'

export const PORTFOLIO_SYMBOLS = [
  'BEL', 'CAMS', 'DMART', 'HAL', 'IEX', 'ITC',
  'NARAYANAHRU', 'POLYCAB', 'SBILIFE', 'TATAMOTORS', 'ZYDUSLIFE', 'LT',
] as const

export const DEFAULT_CATEGORY: Record<string, StockCategory> = {
  CAMS:        'Capital-light Market Infra/Services',
  IEX:         'Capital-light Market Infra/Services',
  DMART:       'Retail',
  BEL:         'Defence',
  HAL:         'Defence',
  SBILIFE:     'Insurance',
  POLYCAB:     'Electricals/Capital Goods',
  LT:          'Asset-heavy Infra/Platforms',
  NARAYANAHRU: 'Hospitals',
  ITC:         'FMCG',
  TATAMOTORS:  'Auto OEM',
  ZYDUSLIFE:   'Pharma',
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
