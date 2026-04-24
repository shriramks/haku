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
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, label)
);

-- Stock allocations per fiscal year
CREATE TABLE IF NOT EXISTS stock_allocations (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fy_id                UUID NOT NULL REFERENCES fiscal_years(id) ON DELETE CASCADE,
    user_id              UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    symbol               TEXT NOT NULL,
    exchange             TEXT NOT NULL DEFAULT 'NSE',
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
    notes       TEXT NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Buy bands (valuation zones per stock)
CREATE TABLE IF NOT EXISTS buy_bands (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    symbol          TEXT NOT NULL,
    anchor_type     TEXT NOT NULL DEFAULT 'PE'
                        CHECK (anchor_type IN ('PE', 'PB', 'EV_EBITDA', 'P_EV')),
    -- Raw financial inputs
    eps             NUMERIC(10,2),
    bvps            NUMERIC(10,2),
    ebitda          NUMERIC(14,2),
    net_debt        NUMERIC(14,2),
    shares          NUMERIC(10,2),
    embedded_value  NUMERIC(14,2),
    -- Computed band prices (₹)
    buy_low         NUMERIC(10,2),
    buy_high        NUMERIC(10,2),
    mid_low         NUMERIC(10,2),
    mid_high        NUMERIC(10,2),
    trim_price      NUMERIC(10,2),
    -- Current market price (manual entry)
    manual_cmp      NUMERIC(10,2),
    last_updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    notes           TEXT NOT NULL DEFAULT '',
    UNIQUE (user_id, symbol)
);

-- Investability assessment (12-gate checklist per stock)
CREATE TABLE IF NOT EXISTS investability (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                 UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    symbol                  TEXT NOT NULL,
    assessed_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- 12 gates
    sector_winds            TEXT NOT NULL DEFAULT 'caution' CHECK (sector_winds IN ('pass','caution','fail')),
    sector_winds_note       TEXT NOT NULL DEFAULT '',
    circle_of_competence    TEXT NOT NULL DEFAULT 'caution' CHECK (circle_of_competence IN ('pass','caution','fail')),
    circle_note             TEXT NOT NULL DEFAULT '',
    moat                    TEXT NOT NULL DEFAULT 'caution' CHECK (moat IN ('pass','caution','fail')),
    moat_note               TEXT NOT NULL DEFAULT '',
    owner_earnings          TEXT NOT NULL DEFAULT 'caution' CHECK (owner_earnings IN ('pass','caution','fail')),
    owner_earnings_note     TEXT NOT NULL DEFAULT '',
    capital_efficiency      TEXT NOT NULL DEFAULT 'caution' CHECK (capital_efficiency IN ('pass','caution','fail')),
    capital_efficiency_note TEXT NOT NULL DEFAULT '',
    innovation_velocity     TEXT NOT NULL DEFAULT 'caution' CHECK (innovation_velocity IN ('pass','caution','fail')),
    innovation_note         TEXT NOT NULL DEFAULT '',
    governance              TEXT NOT NULL DEFAULT 'caution' CHECK (governance IN ('pass','caution','fail')),
    governance_note         TEXT NOT NULL DEFAULT '',
    execution_track         TEXT NOT NULL DEFAULT 'caution' CHECK (execution_track IN ('pass','caution','fail')),
    execution_note          TEXT NOT NULL DEFAULT '',
    supply_chain_risk       TEXT NOT NULL DEFAULT 'caution' CHECK (supply_chain_risk IN ('pass','caution','fail')),
    supply_chain_note       TEXT NOT NULL DEFAULT '',
    regulatory_signal       TEXT NOT NULL DEFAULT 'caution' CHECK (regulatory_signal IN ('pass','caution','fail')),
    regulatory_note         TEXT NOT NULL DEFAULT '',
    thesis_breaker          TEXT NOT NULL DEFAULT 'caution' CHECK (thesis_breaker IN ('pass','caution','fail')),
    thesis_breaker_note     TEXT NOT NULL DEFAULT '',
    capital_discipline      TEXT NOT NULL DEFAULT 'caution' CHECK (capital_discipline IN ('pass','caution','fail')),
    capital_discipline_note TEXT NOT NULL DEFAULT '',
    investable              BOOLEAN NOT NULL DEFAULT false,
    notes                   TEXT NOT NULL DEFAULT '',
    UNIQUE (user_id, symbol)
);

-- Buy tranches (planned buy tranches per stock)
CREATE TABLE IF NOT EXISTS buy_tranches (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    symbol      TEXT NOT NULL,
    qty         NUMERIC(12,4) NOT NULL,
    price       NUMERIC(12,4) NOT NULL,
    allocated   BOOLEAN NOT NULL DEFAULT false,
    sort_order  INT NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
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
