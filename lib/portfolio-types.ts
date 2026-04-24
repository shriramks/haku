// ── Database row types (portfolio tables) ────────────────────────────────────

export interface MFund {
  id: string
  user_id?: string
  scheme_code: string
  scheme_name: string
  scheme_type: string
  created_at?: string
}

export interface MFTransaction {
  id: string
  user_id?: string
  fund_id: string
  trade_date: string
  trade_type: 'buy' | 'sell'
  units: number
  nav: number
  amount: number
  created_at?: string
}

export interface SGBTransaction {
  id: string
  user_id?: string
  trade_date: string
  trade_type: 'buy' | 'sell'
  grams: number
  price_per_gram: number
  amount: number
  maturity_date: string | null
  gold_type: 'sgb' | 'etf' | 'physical'
  name: string | null
  created_at?: string
}

export interface PPFTransaction {
  id: string
  user_id?: string
  trade_date: string
  trade_type: 'deposit' | 'withdrawal'
  amount: number
  notes: string
  created_at?: string
}

export interface PPFBalanceOverride {
  id: string
  user_id?: string
  balance: number
  as_of_date: string
  updated_at?: string
}

// ── Derived/UI types ─────────────────────────────────────────────────────────

export interface MFHolding {
  fund: MFund
  transactions: MFTransaction[]
  units: number
  invested: number
  currentNav: number | null
  currentValue: number | null
  gain: number | null
  xirr: number | null
}

export interface SGBBatch {
  key: string               // date for SGB ("Nov 2021"), name for ETF/Physical
  transactions: SGBTransaction[]
  grams: number
  invested: number
  maturityDate: string | null
  currentValue: number | null
  gain: number | null
  xirr: number | null
  goldType: 'sgb' | 'etf' | 'physical'
  name: string | null
}

export interface EquitySummary {
  holdingsCount: number
  invested: number
  currentValue: number
}

export interface PPFSummary {
  transactions: PPFTransaction[]
  totalDeposited: number
  computedBalance: number
  currentBalance: number   // override if set, else computed
  override: PPFBalanceOverride | null
  xirr: number | null
}

// Passed from server to PortfolioClient
export interface PortfolioProps {
  mfFunds: MFund[]
  mfTransactions: MFTransaction[]
  sgbTransactions: SGBTransaction[]
  ppfTransactions: PPFTransaction[]
  ppfOverride: PPFBalanceOverride | null
}
