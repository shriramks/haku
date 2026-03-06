-- Drop user_settings table (created in v5, no longer used)
-- Run in Supabase SQL Editor

DROP TABLE IF EXISTS user_settings;

NOTIFY pgrst, 'reload schema';
