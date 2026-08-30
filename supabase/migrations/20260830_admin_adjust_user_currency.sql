-- ============================================================
-- Admin Currency Adjustment: XP & EDU Coin
-- Run this in Supabase SQL Editor
-- ============================================================

-- 1. Audit log table for all admin currency adjustments
CREATE TABLE IF NOT EXISTS currency_adjustment_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id    uuid NOT NULL REFERENCES auth.users(id),
  target_user_id uuid NOT NULL REFERENCES profiles(id),
  currency_type text NOT NULL CHECK (currency_type IN ('xp', 'edu_coin')),
  delta       bigint NOT NULL,
  reason      text NOT NULL DEFAULT '',
  balance_before bigint NOT NULL DEFAULT 0,
  balance_after  bigint NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Index for fast lookups by target user and admin
CREATE INDEX IF NOT EXISTS idx_currency_adj_target ON currency_adjustment_logs(target_user_id);
CREATE INDEX IF NOT EXISTS idx_currency_adj_admin  ON currency_adjustment_logs(admin_id);
CREATE INDEX IF NOT EXISTS idx_currency_adj_created ON currency_adjustment_logs(created_at DESC);

-- 2. RLS: only service-role can insert, but we allow SELECT for admin
ALTER TABLE currency_adjustment_logs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Admins can read adjustment logs" ON currency_adjustment_logs;
  DROP POLICY IF EXISTS "Service can insert adjustment logs" ON currency_adjustment_logs;
END $$;

CREATE POLICY "Admins can read adjustment logs"
  ON currency_adjustment_logs
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
        AND user_roles.role = 'admin'
        AND user_roles.is_active = true
    )
  );

-- 3. RPC: Admin adjusts XP or edu_coin for a target user
CREATE OR REPLACE FUNCTION admin_adjust_user_currency(
  p_target_user_id uuid,
  p_currency_type  text,   -- 'xp' or 'edu_coin'
  p_delta           bigint, -- positive = add, negative = subtract
  p_reason          text DEFAULT 'Admin adjustment'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_admin_id      uuid := auth.uid();
  v_is_admin      boolean := false;
  v_column        text;
  v_old_balance   bigint := 0;
  v_new_balance   bigint := 0;
  v_row           jsonb;
BEGIN
  -- Validate currency type
  IF p_currency_type NOT IN ('xp', 'edu_coin') THEN
    RAISE EXCEPTION 'Invalid currency_type: %. Must be "xp" or "edu_coin".', p_currency_type;
  END IF;

  -- Validate delta is not zero
  IF p_delta = 0 THEN
    RAISE EXCEPTION 'Delta must not be zero.';
  END IF;

  -- Validate reason not empty
  IF trim(p_reason) = '' THEN
    RAISE EXCEPTION 'Reason must not be empty.';
  END IF;

  -- Check caller is admin
  SELECT EXISTS(
    SELECT 1 FROM user_roles
    WHERE user_id = v_admin_id
      AND role = 'admin'
      AND is_active = true
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Unauthorized: only admins can adjust currency.';
  END IF;

  -- Determine column name
  IF p_currency_type = 'xp' THEN
    v_column := 'total_xp';
  ELSE
    v_column := 'edu_coin';
  END IF;

  -- Read current balance (with FOR UPDATE to prevent race)
  EXECUTE format('SELECT COALESCE(%I, 0) FROM profiles WHERE id = $1 FOR UPDATE', v_column)
    INTO v_old_balance
    USING p_target_user_id;

  IF v_old_balance IS NULL THEN
    RAISE EXCEPTION 'User not found: %', p_target_user_id;
  END IF;

  -- Prevent negative balance
  v_new_balance := v_old_balance + p_delta;
  IF v_new_balance < 0 THEN
    RAISE EXCEPTION 'Insufficient %: current %, delta % would result in %.',
      p_currency_type, v_old_balance, p_delta, v_new_balance;
  END IF;

  -- Update balance
  EXECUTE format('UPDATE profiles SET %I = $1, updated_at = now() WHERE id = $2', v_column)
    USING v_new_balance, p_target_user_id;

  -- Insert audit log
  INSERT INTO currency_adjustment_logs
    (admin_id, target_user_id, currency_type, delta, reason, balance_before, balance_after)
  VALUES
    (v_admin_id, p_target_user_id, p_currency_type, p_delta, p_reason, v_old_balance, v_new_balance)
  RETURNING to_jsonb(currency_adjustment_logs.*) INTO v_row;

  RETURN v_row;
END;
$$;

-- 4. RPC: Get adjustment logs for a target user (admin only)
CREATE OR REPLACE FUNCTION get_user_currency_logs(
  p_target_user_id uuid,
  p_limit          int DEFAULT 50
)
RETURNS TABLE (
  id           uuid,
  admin_id     uuid,
  target_user_id uuid,
  currency_type text,
  delta        bigint,
  reason       text,
  balance_before bigint,
  balance_after  bigint,
  created_at   timestamptz
)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT
    l.id, l.admin_id, l.target_user_id,
    l.currency_type, l.delta, l.reason,
    l.balance_before, l.balance_after, l.created_at
  FROM currency_adjustment_logs l
  WHERE l.target_user_id = p_target_user_id
  ORDER BY l.created_at DESC
  LIMIT p_limit;
$$;

-- 5. RPC: Get all recent adjustment logs (admin overview)
CREATE OR REPLACE FUNCTION get_all_currency_logs(
  p_limit          int DEFAULT 100
)
RETURNS TABLE (
  id           uuid,
  admin_id     uuid,
  target_user_id uuid,
  target_username text,
  currency_type text,
  delta        bigint,
  reason       text,
  balance_before bigint,
  balance_after  bigint,
  created_at   timestamptz
)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT
    l.id, l.admin_id, l.target_user_id,
    COALESCE(p.username, 'unknown') AS target_username,
    l.currency_type, l.delta, l.reason,
    l.balance_before, l.balance_after, l.created_at
  FROM currency_adjustment_logs l
  LEFT JOIN profiles p ON p.id = l.target_user_id
  ORDER BY l.created_at DESC
  LIMIT p_limit;
$$;
