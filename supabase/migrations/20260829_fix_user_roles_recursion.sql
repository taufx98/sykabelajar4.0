-- ============================================================
-- FIX: Remove self-referencing RLS policy on user_roles
-- This caused "infinite recursion detected in policy"
-- ============================================================

-- Drop the problematic admin policy that queries user_roles itself
DO $$ BEGIN
  DROP POLICY IF EXISTS "Admin manage roles" ON user_roles;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Also drop and recreate the users policy (simpler, no recursion)
DO $$ BEGIN
  DROP POLICY IF EXISTS "Users can view own roles" ON user_roles;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Simple policy: users can only read their own roles (no admin check needed here)
CREATE POLICY "Users can view own roles" ON user_roles
  FOR SELECT USING (auth.uid() = user_id);

-- No admin policy on user_roles itself — admin management
-- is handled through the app's backend/service role, not RLS.
-- This prevents the infinite recursion.
