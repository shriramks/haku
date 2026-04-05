-- Add 52W low/high to buy_bands so they survive navigation
ALTER TABLE buy_bands
  ADD COLUMN IF NOT EXISTS week_52_low  NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS week_52_high NUMERIC(10,2);
