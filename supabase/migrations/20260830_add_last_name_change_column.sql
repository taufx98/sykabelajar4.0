-- Add last_name_change column to profiles for the 7-day display name cooldown
-- Safe to run multiple times (IF NOT EXISTS)
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS last_name_change TIMESTAMPTZ;

-- Backfill: treat existing users as never having changed → NULL means "eligible to change now"
-- No UPDATE needed; NULL is the default for existing rows.

-- Optional: RPC helper that returns seconds remaining before the user can change name again
CREATE OR REPLACE FUNCTION public.get_name_change_cooldown(p_user_id UUID)
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

-- Grant execute to authenticated users (they'll call it for their own user)
GRANT EXECUTE ON FUNCTION public.get_name_change_cooldown(UUID) TO authenticated;
