-- ============================================================
-- COMPLETE: Add columns to profiles + create leaderboard functions
-- Run ALL of this in Supabase SQL Editor
-- ============================================================

-- Step 1: Add xp/coin columns to profiles table
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS total_xp bigint DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS edu_coin bigint DEFAULT 0;

-- Step 2: Drop old functions
DROP FUNCTION IF EXISTS get_public_leaderboard(int);
DROP FUNCTION IF EXISTS get_public_coin_leaderboard(int);

-- Step 3: Create XP leaderboard function
CREATE OR REPLACE FUNCTION get_public_leaderboard(p_limit int DEFAULT 10)
RETURNS TABLE (
  user_id uuid,
  username text,
  display_name text,
  institution text,
  avatar_url text,
  xp bigint,
  rank int,
  rank_change text,
  point_change bigint
)
LANGUAGE sql
AS $$
  WITH ranked AS (
    SELECT
      pr.id AS user_id,
      pr.username,
      COALESCE(pr.full_name, pr.username, 'Pengguna') AS display_name,
      pr.institution,
      pr.avatar_url,
      COALESCE(pr.total_xp, 0)::bigint AS xp,
      ROW_NUMBER() OVER (ORDER BY COALESCE(pr.total_xp, 0) DESC) AS rn
    FROM profiles pr
    LEFT JOIN user_roles ur ON ur.user_id = pr.id AND ur.role = 'admin' AND ur.is_active = true
    WHERE ur.user_id IS NULL
  )
  SELECT user_id, username, display_name, institution, avatar_url, xp, rn::int, 'same', 0::bigint
  FROM ranked
  WHERE rn <= p_limit
  ORDER BY rn;
$$;

-- Step 4: Create Coin leaderboard function
CREATE OR REPLACE FUNCTION get_public_coin_leaderboard(p_limit int DEFAULT 10)
RETURNS TABLE (
  user_id uuid,
  username text,
  display_name text,
  institution text,
  avatar_url text,
  edu_coin bigint,
  rank int
)
LANGUAGE sql
AS $$
  WITH ranked AS (
    SELECT
      pr.id AS user_id,
      pr.username,
      COALESCE(pr.full_name, pr.username, 'Pengguna') AS display_name,
      pr.institution,
      pr.avatar_url,
      COALESCE(pr.edu_coin, 0)::bigint AS edu_coin,
      ROW_NUMBER() OVER (ORDER BY COALESCE(pr.edu_coin, 0) DESC) AS rn
    FROM profiles pr
    LEFT JOIN user_roles ur ON ur.user_id = pr.id AND ur.role = 'admin' AND ur.is_active = true
    WHERE ur.user_id IS NULL
  )
  SELECT user_id, username, display_name, institution, avatar_url, edu_coin, rn::int
  FROM ranked
  WHERE rn <= p_limit
  ORDER BY rn;
$$;
