-- User-facing order history actions and admin visibility for order items.
-- Orders and payment intents remain the financial source of truth; users may archive their view without deleting records.

DROP POLICY IF EXISTS order_items_admin_read ON public.order_items;
CREATE POLICY order_items_admin_read
  ON public.order_items
  FOR SELECT
  TO authenticated
  USING (private.current_user_is_admin());

CREATE TABLE IF NOT EXISTS public.user_order_history_archives (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  archived_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, order_id)
);

ALTER TABLE public.user_order_history_archives ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_order_history_archives_select_own ON public.user_order_history_archives;
CREATE POLICY user_order_history_archives_select_own
  ON public.user_order_history_archives
  FOR SELECT
  TO authenticated
  USING ((select auth.uid()) = user_id);

GRANT SELECT ON public.user_order_history_archives TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.user_order_history_archives FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.cancel_my_pending_order(p_order_id uuid)
RETURNS public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_catalog'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_order public.orders%rowtype;
  v_item public.order_items%rowtype;
  v_intent_status text;
  v_before jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id AND user_id = v_uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND';
  END IF;

  IF v_order.status <> 'PENDING_PAYMENT' THEN
    RAISE EXCEPTION 'ORDER_NOT_CANCELLABLE';
  END IF;

  IF upper(coalesce(v_order.payment_proof_status, '')) = 'SUBMITTED'
     OR nullif(trim(coalesce(v_order.payment_proof_url, '')), '') IS NOT NULL THEN
    RAISE EXCEPTION 'PAYMENT_PROOF_SUBMITTED';
  END IF;

  SELECT upper(coalesce(pi.status, '')) INTO v_intent_status
  FROM public.payment_intents pi
  WHERE pi.order_id = v_order.id
  ORDER BY pi.updated_at DESC
  LIMIT 1;

  IF v_intent_status IS NOT NULL
     AND v_intent_status NOT IN ('FAILED', 'EXPIRED', 'CANCELLED', 'REJECTED') THEN
    RAISE EXCEPTION 'PAYMENT_SESSION_ACTIVE';
  END IF;

  SELECT * INTO v_item
  FROM public.order_items
  WHERE order_id = v_order.id
  ORDER BY created_at
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_ITEM_NOT_FOUND';
  END IF;

  IF NOT (
    v_item.product_type IN ('EDU_COIN_TOPUP', 'BADGE', 'CERTIFICATE_SERIALS', 'DONATION')
    OR (
      v_item.product_type = 'DIGITAL_ITEM'
      AND v_item.product_ref <> 'COLLECTIVE_CERTIFICATE'
      AND v_item.metadata ? 'shop_metadata'
    )
  ) THEN
    RAISE EXCEPTION 'ORDER_NOT_CANCELLABLE';
  END IF;

  v_before := to_jsonb(v_order);
  UPDATE public.orders
  SET status = 'CANCELLED', updated_at = now()
  WHERE id = v_order.id
  RETURNING * INTO v_order;

  INSERT INTO public.audit_logs(actor_user_id, action, entity_type, entity_id, reason, before_data, after_data)
  VALUES (
    v_uid,
    'USER_ORDER_CANCELLED',
    'order',
    v_order.id::text,
    'Pemilik membatalkan pesanan yang belum dibayar dan tidak memiliki sesi pembayaran aktif',
    v_before,
    to_jsonb(v_order)
  );

  RETURN v_order;
END;
$function$;

REVOKE ALL ON FUNCTION public.cancel_my_pending_order(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_my_pending_order(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.archive_my_order_history(p_order_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_status text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  SELECT status::text INTO v_status
  FROM public.orders
  WHERE id = p_order_id AND user_id = v_uid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND';
  END IF;

  IF upper(coalesce(v_status, '')) NOT IN ('PAID', 'COMPLETED', 'CANCELLED', 'CANCELED', 'REFUNDED') THEN
    RAISE EXCEPTION 'ORDER_NOT_ARCHIVABLE';
  END IF;

  INSERT INTO public.user_order_history_archives(user_id, order_id)
  VALUES (v_uid, p_order_id)
  ON CONFLICT (user_id, order_id)
  DO UPDATE SET archived_at = now();

  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.archive_my_order_history(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.archive_my_order_history(uuid) TO authenticated;
