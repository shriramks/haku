-- ============================================================
-- Folio — Database Schema
-- Run this FIRST in Supabase SQL Editor on a fresh project.
-- Then run seed.sql, then seed-bands.sql.
-- ============================================================

-- ── Enable UUID generation ────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ══════════════════════════════════════════════════════════════
-- TABLES
-- ══════════════════════════════════════════════════════════════

-- Fiscal years (Apr–Mar cycle, e.g. FY26 = 2025-04-01 → 2026-03-31)
CREATE TABLE IF NOT EXISTS fiscal_years (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    label            TEXT NOT NULL,              -- "FY26"
    start_date       DATE NOT NULL,
    end_date         DATE NOT NULL,
    total_budget_inr NUMERIC(14,2) NOT NULL DEFAULT 0,
    unallocated_carryover_inr NUMERIC(14,2) DEFAULT 0,
    deploy_capital_inr NUMERIC(14,2) DEFAULT 0,
    -- Sleeve split of the pool, in % (#180). The defaults make an FY "all Equity".
    equity_pct       NUMERIC(5,2) NOT NULL DEFAULT 100,
    debt_pct         NUMERIC(5,2) NOT NULL DEFAULT 0,
    gold_pct         NUMERIC(5,2) NOT NULL DEFAULT 0,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fiscal_years_sleeve_pct_chk CHECK (equity_pct >= 0 AND debt_pct >= 0 AND gold_pct >= 0
        AND equity_pct + debt_pct + gold_pct <= 100),
    UNIQUE (user_id, label)
);

-- Stock allocations per fiscal year
CREATE TABLE IF NOT EXISTS stock_allocations (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fy_id                UUID NOT NULL REFERENCES fiscal_years(id) ON DELETE CASCADE,
    user_id              UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    symbol               TEXT NOT NULL,
    exchange             TEXT NOT NULL DEFAULT 'NSE',
    -- What the row is (#180): 'stock' (every Equity row), 'ppf' (the PPF row, symbol 'PPF'), 'mf' (a fund row, #181).
    kind                 TEXT NOT NULL DEFAULT 'stock' CONSTRAINT stock_allocations_kind_chk CHECK (kind IN ('stock', 'ppf', 'mf')),
    -- % of the row's sleeve, not of the whole pool.
    allocation_pct       NUMERIC(5,2) NOT NULL DEFAULT 0,
    category             TEXT NOT NULL,
    two_weak_quarters    BOOLEAN NOT NULL DEFAULT false,
    is_hospital_ramp_phase BOOLEAN NOT NULL DEFAULT false,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (fy_id, user_id, symbol)
);

-- Transactions (manual entry only)
CREATE TABLE IF NOT EXISTS transactions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    symbol      TEXT NOT NULL,
    exchange    TEXT NOT NULL DEFAULT 'NSE',
    trade_date  DATE NOT NULL,
    trade_type  TEXT NOT NULL CHECK (trade_type IN ('buy', 'sell')),
    quantity    NUMERIC(12,4) NOT NULL,
    price       NUMERIC(12,4) NOT NULL,
    amount      NUMERIC(16,4) GENERATED ALWAYS AS (quantity * price) STORED,
    fy_id       UUID REFERENCES fiscal_years(id) ON DELETE SET NULL,
    advance_fy_id UUID REFERENCES fiscal_years(id) ON DELETE SET NULL,
    notes       TEXT NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Buy bands (valuation zones per stock)
CREATE TABLE IF NOT EXISTS buy_bands (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    symbol          TEXT NOT NULL,
    anchor_type     TEXT NOT NULL DEFAULT 'PE'
                        CHECK (anchor_type IN ('PE')),
    -- Raw financial inputs
    eps             NUMERIC(10,2),
    pat_now         NUMERIC(14,2),
    pat_3yr_ago     NUMERIC(14,2),
    roce_3yr_avg    NUMERIC(7,2),
    mcap            NUMERIC(14,2),
    index_level     NUMERIC(10,2),
    index_pe        NUMERIC(6,2),
    -- Computed band prices (₹)
    buy_low         NUMERIC(10,2),
    buy_high        NUMERIC(10,2),
    mid_low         NUMERIC(10,2),
    mid_high        NUMERIC(10,2),
    trim_price      NUMERIC(10,2),
    -- Current market price (manual entry)
    cmp      NUMERIC(10,2),
    week_52_low     NUMERIC(10,2),
    week_52_high    NUMERIC(10,2),
    last_updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    generated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    is_current      BOOLEAN NOT NULL DEFAULT true,
    notes           TEXT NOT NULL DEFAULT '',
    risk_multiplier NUMERIC(5,4),
    UNIQUE (user_id, symbol)
);

-- Investability assessment (10-gate scorecard per stock)
CREATE TABLE IF NOT EXISTS investability (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                 UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    symbol                  TEXT NOT NULL,
    assessed_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    g1_moat                 INTEGER NOT NULL DEFAULT 0,
    g2_owner_earnings       INTEGER NOT NULL DEFAULT 0,
    g3_capital_efficiency   INTEGER NOT NULL DEFAULT 0,
    g4_innovation           INTEGER NOT NULL DEFAULT 0,
    g5_execution_track      INTEGER NOT NULL DEFAULT 0,
    g6_sector_winds         INTEGER NOT NULL DEFAULT 0,
    g7_governance           INTEGER NOT NULL DEFAULT 0,
    g8_supply_regulatory    INTEGER NOT NULL DEFAULT 0,
    g9_market_cap           INTEGER NOT NULL DEFAULT 0,
    g10_capital_discipline  INTEGER NOT NULL DEFAULT 0,
    total_score             INTEGER NOT NULL DEFAULT 0,
    investable              BOOLEAN NOT NULL DEFAULT false,
    notes                   TEXT NOT NULL DEFAULT '',
    rationale               JSONB NOT NULL DEFAULT '{}',
    UNIQUE (user_id, symbol)
);

-- Buy tranches (planned buy tranches per stock)
CREATE TABLE IF NOT EXISTS buy_tranches (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    symbol      TEXT NOT NULL,
    qty         NUMERIC(12,4) NOT NULL,
    price       NUMERIC(12,4) NOT NULL,
    fy_id       UUID REFERENCES fiscal_years(id) ON DELETE CASCADE,
    sort_order  INT NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_settings (
    user_id                 UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    gemini_api_key          TEXT,
    claude_api_key          TEXT,
    ai_provider             TEXT NOT NULL DEFAULT 'gemini',
    risk_free               NUMERIC(6,4) NOT NULL DEFAULT 0.07,
    risk_free_updated_at    TIMESTAMPTZ,
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ══════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY
-- ══════════════════════════════════════════════════════════════

ALTER TABLE fiscal_years     ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE buy_bands         ENABLE ROW LEVEL SECURITY;
ALTER TABLE investability     ENABLE ROW LEVEL SECURITY;
ALTER TABLE buy_tranches      ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_settings     ENABLE ROW LEVEL SECURITY;

-- fiscal_years
CREATE POLICY "Users see own fiscal years"
    ON fiscal_years FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- stock_allocations
CREATE POLICY "Users see own allocations"
    ON stock_allocations FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- transactions
CREATE POLICY "Users see own transactions"
    ON transactions FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- buy_bands
CREATE POLICY "Users see own bands"
    ON buy_bands FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- investability
CREATE POLICY "Users see own investability"
    ON investability FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- buy_tranches
CREATE POLICY "Users see own tranches"
    ON buy_tranches FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users see own settings"
    ON user_settings FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- ══════════════════════════════════════════════════════════════
-- INDEXES
-- ══════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_allocations_fy     ON stock_allocations(fy_id);
CREATE INDEX IF NOT EXISTS idx_allocations_user   ON stock_allocations(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_user  ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_fy    ON transactions(fy_id);
CREATE INDEX IF NOT EXISTS idx_transactions_date  ON transactions(trade_date DESC);
CREATE INDEX IF NOT EXISTS idx_buy_bands_user     ON buy_bands(user_id);
CREATE INDEX IF NOT EXISTS idx_investability_user ON investability(user_id);
CREATE INDEX IF NOT EXISTS idx_tranches_user      ON buy_tranches(user_id);
CREATE INDEX IF NOT EXISTS idx_tranches_symbol    ON buy_tranches(user_id, symbol);
CREATE INDEX IF NOT EXISTS idx_user_settings_user ON user_settings(user_id);
