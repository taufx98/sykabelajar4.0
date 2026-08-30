-- ============================================================
-- Bulk Currency Award: XP & EDU Coin for multiple users
-- ============================================================

-- 1. RPC: Bulk adjust currency for multiple users + auto-notify
CREATE OR REPLACE FUNCTION admin_bulk_adjust_currency(
  p_user_ids      uuid[],
  p_currency_type text,   -- 'xp' or 'edu_coin'
  p_delta         bigint, -- positive = add, negative = subtract
  p_reason        text DEFAULT 'Bulk admin adjustment'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_admin_id    uuid := auth.uid();
  v_is_admin    boolean := false;
  v_column      text;
  v_success     int := 0;
  v_failed      int := 0;
  v_skipped     int := 0;
  v_results     jsonb := '[]'::jsonb;
  v_uid         uuid;
  v_old         bigint;
  v_new         bigint;
  v_username    text;
  v_display     text;
BEGIN
  -- Validate
  IF p_currency_type NOT IN ('xp', 'edu_coin') THEN
    RAISE EXCEPTION 'Invalid currency_type: %', p_currency_type;
  END IF;
  IF p_delta = 0 THEN
    RAISE EXCEPTION 'Delta must not be zero.';
  END IF;
  IF trim(p_reason) = '' THEN
    RAISE EXCEPTION 'Reason must not be empty.';
  END IF;
  IF array_length(p_user_ids, 1) IS NULL OR array_length(p_user_ids, 1) = 0 THEN
    RAISE EXCEPTION 'No users selected.';
  END IF;

  -- Check admin
  SELECT EXISTS(
    SELECT 1 FROM user_roles
    WHERE user_id = v_admin_id AND role = 'admin' AND is_active = true
  ) INTO v_is_admin;
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Unauthorized: only admins can bulk adjust currency.';
  END IF;

  IF p_currency_type = 'xp' THEN v_column := 'total_xp';
  ELSE v_column := 'edu_coin'; END IF;

  -- Process each user
  FOREACH v_uid IN ARRAY p_user_ids LOOP
    BEGIN
      -- Get current balance
      EXECUTE format('SELECT COALESCE(%I, 0) FROM profiles WHERE id = $1', v_column)
        INTO v_old USING v_uid;

      IF v_old IS NULL THEN
        v_failed := v_failed + 1;
        v_results := v_results || jsonb_build_object('user_id', v_uid, 'status', 'not_found');
        CONTINUE;
      END IF;

      v_new := v_old + p_delta;
      IF v_new < 0 THEN
        v_skipped := v_skipped + 1;
        v_results := v_results || jsonb_build_object('user_id', v_uid, 'status', 'insufficient', 'balance', v_old);
        CONTINUE;
      END IF;

      -- Update balance
      EXECUTE format('UPDATE profiles SET %I = $1, updated_at = now() WHERE id = $2', v_column)
        USING v_new, v_uid;

      -- Log
      INSERT INTO currency_adjustment_logs
        (admin_id, target_user_id, currency_type, delta, reason, balance_before, balance_after)
      VALUES
        (v_admin_id, v_uid, p_currency_type, p_delta, p_reason, v_old, v_new);

      -- Get username for notification
      SELECT username, COALESCE(full_name, username, 'Pengguna')
        INTO v_username, v_display
        FROM profiles WHERE id = v_uid;

      -- Auto-create notification
      INSERT INTO notifications (user_id, type, title, body, data)
      VALUES (
        v_uid,
        'rank-up',
        CASE WHEN p_delta > 0 THEN 'Selamat! Kamu menerima ' || p_delta || ' ' || CASE WHEN p_currency_type = 'xp' THEN 'XP' ELSE 'Coin EDU' END
             ELSE 'Penyesuaian ' || CASE WHEN p_currency_type = 'xp' THEN 'XP' ELSE 'Coin EDU' END || ' oleh Admin'
        END,
        CASE WHEN p_delta > 0 THEN 'Kamu menerima +' || p_delta || ' ' || CASE WHEN p_currency_type = 'xp' THEN 'XP' ELSE 'Coin EDU' END || ' dari Admin. Alasan: ' || p_reason
             ELSE 'Saldo kamu dikurangi ' || abs(p_delta) || ' ' || CASE WHEN p_currency_type = 'xp' THEN 'XP' ELSE 'Coin EDU' END || ' oleh Admin. Alasan: ' || p_reason
        END,
        jsonb_build_object('link', '/leaderboard', 'icon', 'coins')
      );

      v_success := v_success + 1;
      v_results := v_results || jsonb_build_object(
        'user_id', v_uid,
        'username', v_username,
        'status', 'ok',
        'old', v_old,
        'new', v_new
      );
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
      v_results := v_results || jsonb_build_object('user_id', v_uid, 'status', 'error', 'message', SQLERRM);
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'success', v_success,
    'failed', v_failed,
    'skipped', v_skipped,
    'total', array_length(p_user_ids, 1),
    'results', v_results
  );
END;
$$;
