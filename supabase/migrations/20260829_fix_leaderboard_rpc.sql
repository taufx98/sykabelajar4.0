-- ============================================================
-- FIX: Leaderboard RPC — correct column names
-- public_profiles uses 'id' not 'user_id'
-- Adds total_xp and edu_coin columns if they don't exist
-- ============================================================

-- Add xp/coin columns to public_profiles if missing
DO $$ BEGIN
  ALTER TABLE public_profiles ADD COLUMN IF NOT EXISTS total_xp bigint DEFAULT 0;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public_profiles ADD COLUMN IF NOT EXISTS edu_coin bigint DEFAULT 0;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Drop and recreate functions
DROP FUNCTION IF EXISTS get_public_leaderboard(int);
DROP FUNCTION IF EXISTS get_public_coin_leaderboard(int);

-- XP leaderboard (exclude admin)
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
      p.id AS user_id,
      p.username,
      COALESCE(p.full_name, p.username, 'Pengguna') AS display_name,
      p.institution,
      p.avatar_url,
      COALESCE(p.total_xp, 0)::bigint AS xp,
      ROW_NUMBER() OVER (ORDER BY COALESCE(p.total_xp, 0) DESC) AS rn
    FROM public_profiles p
    LEFT JOIN user_roles ur ON ur.user_id = p.id AND ur.role = 'admin' AND ur.is_active = true
    WHERE ur.id IS NULL
  )
  SELECT user_id, username, display_name, institution, avatar_url, xp, rn::int, 'same', 0::bigint
  FROM ranked
  WHERE rn <= p_limit
  ORDER BY rn;
$$;

-- Coin leaderboard (exclude admin)
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
      p.id AS user_id,
      p.username,
      COALESCE(p.full_name, p.username, 'Pengguna') AS display_name,
      p.institution,
      p.avatar_url,
      COALESCE(p.edu_coin, 0)::bigint AS edu_coin,
      ROW_NUMBER() OVER (ORDER BY COALESCE(p.edu_coin, 0) DESC) AS rn
    FROM public_profiles p
    LEFT JOIN user_roles ur ON ur.user_id = p.id AND ur.role = 'admin' AND ur.is_active = true
    WHERE ur.id IS NULL
  )
  SELECT user_id, username, display_name, institution, avatar_url, edu_coin, rn::int
  FROM ranked
  WHERE rn <= p_limit
  ORDER BY rn;
$$;
