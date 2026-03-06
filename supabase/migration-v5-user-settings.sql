-- Migration v5: per-user settings (Gemini API key, etc.)
-- Run in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS user_settings (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  gemini_api_key TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own settings" ON user_settings
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
