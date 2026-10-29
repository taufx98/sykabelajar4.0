-- Admin-confirmation override for a pending gateway order, with required reason and immutable audit trail.
-- Reuses the existing order fulfillment path and never grants direct table-update access to the browser.

DO $migration$
DECLARE
  v_definition text;
  v_old_decision text := $old_decision$  if upper(trim(p_decision)) not in ('APPROVE','REJECT') then raise exception 'INVALID_DECISION'; end if;$old_decision$;
  v_new_decision text := $new_decision$  if upper(trim(p_decision)) not in ('APPROVE','REJECT','ADMIN_CONFIRM') then raise exception 'INVALID_DECISION'; end if;$new_decision$;
  v_old_status text := $old_status$  if v.status<>'PENDING_PAYMENT' then raise exception 'ORDER_NOT_REVIEWABLE:%',v.status; end if;
  v_before := v;
  select * into i from public.order_items where order_id=v.id order by created_at limit 1;$old_status$;
  v_new_status text := $new_status$  if upper(trim(p_decision))='ADMIN_CONFIRM' then
    if length(trim(coalesce(p_reason,''))) < 8 then raise exception 'ADMIN_CONFIRM_REASON_REQUIRED'; end if;
    if not (
      upper(coalesce(v.payment_provider,'')) in ('GLOBAL','MIDTRANS','XENITHPAY')
      or exists (
        select 1 from public.organizer_payment_methods m
        where m.id=v.payment_method_id and m.details->>'global_gateway'='true'
      )
    ) then raise exception 'ADMIN_CONFIRM_GATEWAY_ONLY'; end if;
  end if;
  if v.status<>'PENDING_PAYMENT' then raise exception 'ORDER_NOT_REVIEWABLE:%',v.status; end if;
  if upper(trim(p_decision))='ADMIN_CONFIRM' then
    update public.payment_intents pi
    set status='PAID',
        raw_meta=coalesce(pi.raw_meta,'{}'::jsonb) || jsonb_build_object(
          'admin_override', jsonb_build_object(
            'source','ADMIN_MANUAL_CONFIRMATION',
            'confirmed_by',auth.uid(),
            'confirmed_at',now(),
            'reason',trim(p_reason),
            'prior_status',pi.status
          )
        ),
        updated_at=now()
    where pi.order_id=v.id;
    if not found then raise exception 'PAYMENT_INTENT_NOT_FOUND'; end if;
    p_reason := '[KONFIRMASI MANUAL ADMIN] ' || trim(p_reason);
  end if;
  v_before := v;
  select * into i from public.order_items where order_id=v.id order by created_at limit 1;$new_status$;
BEGIN
  SELECT pg_get_functiondef('public.admin_review_manual_order(uuid,text,text)'::regprocedure)
  INTO v_definition;

  IF position(v_old_decision in v_definition) = 0
     OR position(v_old_status in v_definition) = 0
  THEN
    RAISE EXCEPTION 'ADMIN_PAYMENT_OVERRIDE_MIGRATION_ANCHOR_MISMATCH';
  END IF;

  v_definition := replace(v_definition, v_old_decision, v_new_decision);
  v_definition := replace(v_definition, v_old_status, v_new_status);
  EXECUTE v_definition;
END;
$migration$;

CREATE OR REPLACE FUNCTION public.admin_force_complete_pending_order(
  p_order_id uuid,
  p_reason text
)
RETURNS public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_catalog'
AS $function$
DECLARE
  v_before public.orders;
  v_after public.orders;
  v_reason text := trim(coalesce(p_reason,''));
BEGIN
  IF NOT private.current_user_is_admin() THEN
    RAISE EXCEPTION 'ACCESS_DENIED';
  END IF;
  IF length(v_reason) < 8 THEN
    RAISE EXCEPTION 'ADMIN_CONFIRM_REASON_REQUIRED';
  END IF;

  SELECT * INTO v_before
  FROM public.orders
  WHERE id=p_order_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND';
  END IF;
  IF v_before.status <> 'PENDING_PAYMENT' THEN
    RAISE EXCEPTION 'ORDER_NOT_REVIEWABLE:%',v_before.status;
  END IF;
  IF NOT (
    upper(coalesce(v_before.payment_provider,'')) IN ('GLOBAL','MIDTRANS','XENITHPAY')
    OR EXISTS (
      SELECT 1
      FROM public.organizer_payment_methods m
      WHERE m.id=v_before.payment_method_id
        AND m.details->>'global_gateway'='true'
    )
  ) THEN
    RAISE EXCEPTION 'ADMIN_CONFIRM_GATEWAY_ONLY';
  END IF;

  -- The existing fulfillment RPC retains all product-specific validation and side effects.
  v_after := public.admin_review_manual_order(p_order_id,'ADMIN_CONFIRM',v_reason);

  INSERT INTO public.audit_logs(
    actor_user_id, action, entity_type, entity_id, reason, before_data, after_data
  )
  VALUES (
    auth.uid(),
    'ADMIN_PAYMENT_CONFIRMED',
    'order',
    p_order_id::text,
    'Admin confirmed a pending gateway payment after independent verification: ' || v_reason,
    to_jsonb(v_before),
    to_jsonb(v_after)
  );

  RETURN v_after;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_force_complete_pending_order(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_force_complete_pending_order(uuid,text) TO authenticated;

DROP POLICY IF EXISTS payment_events_admin_read ON public.payment_events;
CREATE POLICY payment_events_admin_read
  ON public.payment_events
  FOR SELECT
  TO authenticated
  USING (private.current_user_is_admin());

GRANT SELECT ON public.payment_events TO authenticated;

CREATE INDEX IF NOT EXISTS idx_orders_status_created_at
  ON public.orders (status, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_orders_created_at_id
  ON public.orders (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_payment_events_intent_created_at
  ON public.payment_events (payment_intent_id, created_at DESC);
