-- Add last_name_change column to profiles for display name cooldown (7-day limit)
-- Initial value set to created_at so existing users can change immediately
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS last_name_change TIMESTAMPTZ;

-- Backfill existing rows: set last_name_change = created_at so existing users aren't locked out
UPDATE profiles
  SET last_name_change = created_at
  WHERE last_name_change IS NULL;

-- Make it NOT NULL after backfill
ALTER TABLE profiles
  ALTER COLUMN last_name_change SET NOT NULL;

-- Default for future inserts: NOW()
ALTER TABLE profiles
  ALTER COLUMN last_name_change SET DEFAULT NOW();

-- RPC function: check if user can change display name (cooldown = 7 days)
CREATE OR REPLACE FUNCTION can_change_display_name(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT (
    SELECT last_name_change FROM profiles WHERE id = p_user_id
  ) <= NOW() - INTERVAL '7 days';
$$;

-- RPC function: get remaining cooldown in seconds for display name change
CREATE OR REPLACE FUNCTION get_display_name_cooldown(p_user_id UUID)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT GREATEST(
    0,
    EXTRACT(EPOCH FROM (
      (SELECT last_name_change FROM profiles WHERE id = p_user_id) + INTERVAL '7 days' - NOW()
    ))::INTEGER
  );
$$;
