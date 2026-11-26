-- Stage 7 public shop-promo banner RPC caller acceptance.
-- PostgreSQL 17.6 disposable schema restore only; fixtures are transaction-scoped.
-- Browser roles receive no direct table ACL. Public reads/events are narrowly
-- mediated by the two reviewed SECURITY DEFINER RPCs.

\set ON_ERROR_STOP on
BEGIN;

DO $stage7_banner_fixture_preflight$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.shop_promo_banners
    WHERE id IN (
      '00000000-0000-4000-8000-00000000b711'::uuid,
      '00000000-0000-4000-8000-00000000b712'::uuid,
      '00000000-0000-4000-8000-00000000b713'::uuid
    )
  ) OR EXISTS (
    SELECT 1 FROM public.shop_promo_banner_events
    WHERE banner_id IN (
      '00000000-0000-4000-8000-00000000b711'::uuid,
      '00000000-0000-4000-8000-00000000b712'::uuid,
      '00000000-0000-4000-8000-00000000b713'::uuid
    )
  ) THEN
    RAISE EXCEPTION 'STAGE7_BANNER_FIXTURE_UUID_COLLISION';
  END IF;
END;
$stage7_banner_fixture_preflight$;

INSERT INTO public.shop_promo_banners (
  id,image_url,target_url,slide_duration_seconds,slide_position,is_active,views_count,clicks_count
)
VALUES
  (
    '00000000-0000-4000-8000-00000000b711',
    'https://res.cloudinary.com/stage7-disposable/image/upload/v1/stage7/banner-a.png',
    'https://sykabelajar.my.id/shop',
    5,2,TRUE,0,0
  ),
  (
    '00000000-0000-4000-8000-00000000b712',
    'https://res.cloudinary.com/stage7-disposable/image/upload/v1/stage7/banner-inactive.png',
    NULL,
    6,1,FALSE,0,0
  ),
  (
    '00000000-0000-4000-8000-00000000b713',
    'https://res.cloudinary.com/stage7-disposable/image/upload/v1/stage7/banner-b.png',
    'https://sykabelajar.my.id/lomba',
    7,4,TRUE,0,0
  );

DO $stage7_banner_rpc_acl_preflight$
BEGIN
  IF NOT has_function_privilege('anon',
       'public.list_active_shop_promo_banners()'::regprocedure,'EXECUTE')
     OR NOT has_function_privilege('anon',
       'public.record_shop_promo_banner_event(uuid,text,text)'::regprocedure,'EXECUTE') THEN
    RAISE EXCEPTION 'STAGE7_BANNER_PUBLIC_RPC_EXECUTE_MISSING';
  END IF;
  IF has_table_privilege('anon','public.shop_promo_banners','SELECT')
     OR has_table_privilege('anon','public.shop_promo_banner_events','SELECT')
     OR has_table_privilege('anon','public.shop_promo_banner_events','INSERT')
     OR has_table_privilege('authenticated','public.shop_promo_banners','SELECT')
     OR has_table_privilege('authenticated','public.shop_promo_banner_events','INSERT') THEN
    RAISE EXCEPTION 'STAGE7_BANNER_DIRECT_BROWSER_TABLE_ACCESS_REMAINS';
  END IF;
END;
$stage7_banner_rpc_acl_preflight$;

SET LOCAL ROLE anon;
SELECT pg_catalog.set_config('request.jwt.claims','{"role":"anon"}',true);
SELECT pg_catalog.set_config('request.jwt.claim.role','anon',true);

DO $stage7_banner_public_rpc$
DECLARE
  v_ids uuid[];
  v_result boolean;
  v_denied boolean;
BEGIN
  SELECT array_agg(b.id ORDER BY b.slide_position)
    INTO v_ids
  FROM public.list_active_shop_promo_banners() b
  WHERE b.id IN (
    '00000000-0000-4000-8000-00000000b711'::uuid,
    '00000000-0000-4000-8000-00000000b712'::uuid,
    '00000000-0000-4000-8000-00000000b713'::uuid
  );
  IF v_ids IS DISTINCT FROM ARRAY[
    '00000000-0000-4000-8000-00000000b711'::uuid,
    '00000000-0000-4000-8000-00000000b713'::uuid
  ] THEN
    RAISE EXCEPTION 'STAGE7_BANNER_ACTIVE_ONLY_LIST_FAILED:%',v_ids;
  END IF;

  v_result := public.record_shop_promo_banner_event(
    '00000000-0000-4000-8000-00000000b711'::uuid,
    'VIEW',
    'stage7-banner-view-0000001'
  );
  IF v_result IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'STAGE7_BANNER_VALID_VIEW_NOT_RECORDED';
  END IF;

  v_result := public.record_shop_promo_banner_event(
    '00000000-0000-4000-8000-00000000b711'::uuid,
    'VIEW',
    'stage7-banner-view-0000001'
  );
  IF v_result IS DISTINCT FROM FALSE THEN
    RAISE EXCEPTION 'STAGE7_BANNER_DUPLICATE_VIEW_NOT_IDEMPOTENT';
  END IF;

  v_result := public.record_shop_promo_banner_event(
    '00000000-0000-4000-8000-00000000b711'::uuid,
    'CLICK',
    'stage7-banner-click-000001'
  );
  IF v_result IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'STAGE7_BANNER_VALID_CLICK_NOT_RECORDED';
  END IF;

  v_result := public.record_shop_promo_banner_event(
    '00000000-0000-4000-8000-00000000b712'::uuid,
    'VIEW',
    'stage7-banner-inactive-00001'
  );
  IF v_result IS DISTINCT FROM FALSE THEN
    RAISE EXCEPTION 'STAGE7_BANNER_INACTIVE_EVENT_ACCEPTED';
  END IF;

  v_result := public.record_shop_promo_banner_event(
    '00000000-0000-4000-8000-00000000b799'::uuid,
    'VIEW',
    'stage7-banner-missing-00001'
  );
  IF v_result IS DISTINCT FROM FALSE THEN
    RAISE EXCEPTION 'STAGE7_BANNER_MISSING_EVENT_TARGET_ACCEPTED';
  END IF;

  v_denied := FALSE;
  BEGIN
    PERFORM public.record_shop_promo_banner_event(
      '00000000-0000-4000-8000-00000000b711'::uuid,
      'DELETE',
      'stage7-banner-invalid-type-01'
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'INVALID_BANNER_EVENT' THEN
      v_denied := TRUE;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'STAGE7_BANNER_INVALID_EVENT_TYPE_ACCEPTED'; END IF;

  v_denied := FALSE;
  BEGIN
    PERFORM public.record_shop_promo_banner_event(
      '00000000-0000-4000-8000-00000000b711'::uuid,
      'VIEW',
      'short'
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'INVALID_VISITOR_KEY' THEN
      v_denied := TRUE;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'STAGE7_BANNER_INVALID_VISITOR_KEY_ACCEPTED'; END IF;
END;
$stage7_banner_public_rpc$;

RESET ROLE;

DO $stage7_banner_rpc_postflight$
DECLARE
  v_events integer;
  v_views bigint;
  v_clicks bigint;
BEGIN
  SELECT count(*)::integer INTO v_events
  FROM public.shop_promo_banner_events
  WHERE banner_id='00000000-0000-4000-8000-00000000b711'::uuid;
  SELECT views_count,clicks_count INTO v_views,v_clicks
  FROM public.shop_promo_banners
  WHERE id='00000000-0000-4000-8000-00000000b711'::uuid;
  IF v_events <> 2 OR v_views <> 1 OR v_clicks <> 1 THEN
    RAISE EXCEPTION 'STAGE7_BANNER_EVENT_LEDGER_OR_COUNTER_DRIFT:events %, views %, clicks %',v_events,v_views,v_clicks;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.shop_promo_banner_events
    WHERE banner_id IN (
      '00000000-0000-4000-8000-00000000b712'::uuid,
      '00000000-0000-4000-8000-00000000b713'::uuid
    )
  ) THEN
    RAISE EXCEPTION 'STAGE7_BANNER_INACTIVE_OR_UNTESTED_EVENT_WRITTEN';
  END IF;
END;
$stage7_banner_rpc_postflight$;

ROLLBACK;
