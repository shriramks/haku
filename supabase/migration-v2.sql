-- ============================================================
-- Migration v2: buy_bands versioning + playbook table
-- Run in Supabase SQL Editor after schema.sql
-- ============================================================

-- 1. buy_bands: drop UNIQUE constraint to allow history rows
ALTER TABLE buy_bands DROP CONSTRAINT IF EXISTS buy_bands_user_id_symbol_key;

-- 2. Add versioning columns
ALTER TABLE buy_bands
  ADD COLUMN IF NOT EXISTS generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS is_current   BOOLEAN     NOT NULL DEFAULT true;

-- Mark all existing rows as current
UPDATE buy_bands SET generated_at = last_updated_at, is_current = true;

-- Mark previous rows as not-current when a new one is inserted
-- (handled in application logic via UPDATE before INSERT)

-- Efficient index for "get current band for a stock"
CREATE INDEX IF NOT EXISTS idx_buy_bands_current
  ON buy_bands(user_id, symbol, generated_at DESC);

-- 3. Playbook table (one per user, upsertable)
CREATE TABLE IF NOT EXISTS playbook (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content    TEXT        NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);

ALTER TABLE playbook ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own playbook"
  ON playbook FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_playbook_user ON playbook(user_id);
