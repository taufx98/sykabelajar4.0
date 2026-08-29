-- ============================================================
-- MIGRATION: RPC functions for leaderboard + admin filtering
-- Run this in Supabase SQL Editor
-- ============================================================

-- Drop existing functions if they exist (to recreate with admin filter)
DROP FUNCTION IF EXISTS get_public_leaderboard(int);
DROP FUNCTION IF EXISTS get_public_coin_leaderboard(int);

-- ============================================================
-- 1. get_public_leaderboard — XP leaderboard (exclude admin)
-- Uses public_profiles table with COALESCE for safety
-- ============================================================
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
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  WITH ranked AS (
    SELECT
      pl.user_id,
      pl.username,
      COALESCE(pl.full_name, pl.username, 'Pengguna') AS display_name,
      pl.institution,
      pl.avatar_url,
      COALESCE(
        CASE WHEN EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'public_profiles' AND column_name = 'total_xp'
        ) THEN pl.total_xp ELSE 0 END,
        0
      ) AS xp,
      ROW_NUMBER() OVER (
        ORDER BY COALESCE(
          CASE WHEN EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'public_profiles' AND column_name = 'total_xp'
          ) THEN pl.total_xp ELSE 0 END,
          0
        ) DESC
      ) AS rn
    FROM public_profiles pl
    WHERE NOT EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = pl.user_id
        AND ur.role = 'admin'
        AND ur.is_active = true
    )
  )
  SELECT
    r.user_id,
    r.username,
    r.display_name,
    r.institution,
    r.avatar_url,
    r.xp,
    r.rn::int AS rank,
    'same' AS rank_change,
    0::bigint AS point_change
  FROM ranked r
  WHERE r.rn <= p_limit
  ORDER BY r.rn;
END;
$$;

-- ============================================================
-- 2. get_public_coin_leaderboard — Edu Coin leaderboard (exclude admin)
-- ============================================================
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
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  WITH ranked AS (
    SELECT
      pl.user_id,
      pl.username,
      COALESCE(pl.full_name, pl.username, 'Pengguna') AS display_name,
      pl.institution,
      pl.avatar_url,
      COALESCE(
        CASE WHEN EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'public_profiles' AND column_name = 'edu_coin'
        ) THEN pl.edu_coin ELSE 0 END,
        0
      ) AS edu_coin,
      ROW_NUMBER() OVER (
        ORDER BY COALESCE(
          CASE WHEN EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'public_profiles' AND column_name = 'edu_coin'
          ) THEN pl.edu_coin ELSE 0 END,
          0
        ) DESC
      ) AS rn
    FROM public_profiles pl
    WHERE NOT EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = pl.user_id
        AND ur.role = 'admin'
        AND ur.is_active = true
    )
  )
  SELECT
    r.user_id,
    r.username,
    r.display_name,
    r.institution,
    r.avatar_url,
    r.edu_coin,
    r.rn::int AS rank
  FROM ranked r
  WHERE r.rn <= p_limit
  ORDER BY r.rn;
END;
$$;

-- ============================================================
-- 3. Create chat system tables (if not exist)
-- ============================================================
CREATE TABLE IF NOT EXISTS chat_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  rating int CHECK (rating BETWEEN 1 AND 5),
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE chat_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any
DO $$ BEGIN
  DROP POLICY IF EXISTS "User view own thread" ON chat_threads;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
DO $$ BEGIN
  DROP POLICY IF EXISTS "User create own thread" ON chat_threads;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
DO $$ BEGIN
  DROP POLICY IF EXISTS "User update own thread" ON chat_threads;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
DO $$ BEGIN
  DROP POLICY IF EXISTS "Admin manage threads" ON chat_threads;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
DO $$ BEGIN
  DROP POLICY IF EXISTS "User view own messages" ON chat_messages;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
DO $$ BEGIN
  DROP POLICY IF EXISTS "User send own messages" ON chat_messages;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
DO $$ BEGIN
  DROP POLICY IF EXISTS "Admin manage messages" ON chat_messages;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- RLS: Users can see their own thread
CREATE POLICY "User view own thread" ON chat_threads
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "User create own thread" ON chat_threads
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "User update own thread" ON chat_threads
  FOR UPDATE USING (auth.uid() = user_id);

-- RLS: Admin full access to threads
CREATE POLICY "Admin manage threads" ON chat_threads
  FOR ALL USING (EXISTS (
    SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'admin' AND is_active = true
  ));

-- RLS: Users see messages in their own thread
CREATE POLICY "User view own messages" ON chat_messages
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM chat_threads WHERE id = thread_id AND user_id = auth.uid())
  );
CREATE POLICY "User send own messages" ON chat_messages
  FOR INSERT WITH CHECK (
    auth.uid() = sender_id AND
    EXISTS (SELECT 1 FROM chat_threads WHERE id = thread_id AND user_id = auth.uid())
  );

-- RLS: Admin full access to messages
CREATE POLICY "Admin manage messages" ON chat_messages
  FOR ALL USING (EXISTS (
    SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'admin' AND is_active = true
  ));

-- Indexes
CREATE INDEX IF NOT EXISTS idx_chat_threads_user_id ON chat_threads(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_thread_id ON chat_messages(thread_id);

-- ============================================================
-- 4. Create ad_banners table (if not exists)
-- ============================================================
CREATE TABLE IF NOT EXISTS ad_banners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  image_url text NOT NULL,
  link_url text,
  is_active boolean DEFAULT true,
  sort_order int DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE ad_banners ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Public read active banners" ON ad_banners;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
DO $$ BEGIN
  DROP POLICY IF EXISTS "Admin manage banners" ON ad_banners;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

CREATE POLICY "Public read active banners" ON ad_banners
  FOR SELECT USING (is_active = true);
CREATE POLICY "Admin manage banners" ON ad_banners
  FOR ALL USING (EXISTS (
    SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'admin' AND is_active = true
  ));

-- ============================================================
-- 5. Ensure user_roles table exists with admin role
-- ============================================================
CREATE TABLE IF NOT EXISTS user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('admin', 'organizer_member', 'pelajar')),
  is_active boolean DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, role)
);

ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Users can view own roles" ON user_roles;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
DO $$ BEGIN
  DROP POLICY IF EXISTS "Admin manage roles" ON user_roles;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

CREATE POLICY "Users can view own roles" ON user_roles
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Admin manage roles" ON user_roles
  FOR ALL USING (EXISTS (
    SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'admin' AND is_active = true
  ));
