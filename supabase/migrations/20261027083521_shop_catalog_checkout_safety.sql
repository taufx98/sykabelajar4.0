-- Keep the Shop catalog aligned with the checkout and fulfillment flows that are currently implemented.
-- Shop supports manual-fulfillment digital products and donation items. Plan/coin/feature-unlock
-- products require separate entitlement handlers and must not be sold through this generic checkout.

create or replace function public.admin_save_product(
  p_product_id uuid,
  p_code text,
  p_slug text,
  p_name text,
  p_short_description text default null,
  p_description text default null,
  p_product_type text default 'DIGITAL_ITEM',
  p_audiences text[] default array['student']::text[],
  p_price numeric default 0,
  p_currency text default 'IDR',
  p_image_url text default null,
  p_is_active boolean default false,
  p_is_featured boolean default false,
  p_sort_order integer default 0,
  p_metadata jsonb default '{}'::jsonb
) returns public.commerce_products
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_before public.commerce_products;
  v_after public.commerce_products;
  v_product_type text := upper(trim(coalesce(p_product_type, 'DIGITAL_ITEM')));
  v_audiences text[] := coalesce(p_audiences, array[]::text[]);
  v_price numeric := coalesce(p_price, 0);
begin
  if not private.current_user_is_admin() then raise exception 'ACCESS_DENIED'; end if;
  if nullif(trim(coalesce(p_name, '')), '') is null then raise exception 'NAME_REQUIRED'; end if;
  if nullif(trim(coalesce(p_code, '')), '') is null then raise exception 'CODE_REQUIRED'; end if;
  if nullif(trim(coalesce(p_slug, '')), '') is null then raise exception 'SLUG_REQUIRED'; end if;
  if v_product_type not in ('DIGITAL_ITEM', 'DONATION') then raise exception 'PRODUCT_TYPE_NOT_SUPPORTED'; end if;
  if cardinality(v_audiences) = 0 then raise exception 'AUDIENCE_REQUIRED'; end if;
  if not (v_audiences <@ array['student', 'teacher', 'organizer']::text[]) then raise exception 'AUDIENCE_INVALID'; end if;
  if v_price < 0 then raise exception 'PRICE_INVALID'; end if;
  if coalesce(p_is_active, false) and v_price <= 0 then raise exception 'ACTIVE_PRODUCT_PRICE_REQUIRED'; end if;
  if nullif(trim(coalesce(p_image_url, '')), '') is not null and trim(p_image_url) !~* '^https?://' then raise exception 'IMAGE_URL_INVALID'; end if;

  if p_product_id is null then
    insert into public.commerce_products(
      code, slug, name, short_description, description, product_type, audiences, price, currency,
      image_url, is_active, is_featured, sort_order, metadata
    ) values (
      trim(p_code), trim(p_slug), trim(p_name), nullif(trim(coalesce(p_short_description, '')), ''),
      nullif(trim(coalesce(p_description, '')), ''), v_product_type, v_audiences, v_price,
      coalesce(nullif(trim(p_currency), ''), 'IDR'), nullif(trim(coalesce(p_image_url, '')), ''),
      coalesce(p_is_active, false), coalesce(p_is_featured, false), greatest(coalesce(p_sort_order, 0), 0),
      coalesce(p_metadata, '{}'::jsonb)
    ) returning * into v_after;
    perform private.write_audit('admin.product_create', 'commerce_product', v_after.id::text, 'Admin panel', null, to_jsonb(v_after), null);
  else
    select * into v_before from public.commerce_products where id = p_product_id for update;
    if not found then raise exception 'PRODUCT_NOT_FOUND'; end if;
    update public.commerce_products set
      code = trim(p_code),
      slug = trim(p_slug),
      name = trim(p_name),
      short_description = nullif(trim(coalesce(p_short_description, '')), ''),
      description = nullif(trim(coalesce(p_description, '')), ''),
      product_type = v_product_type,
      audiences = v_audiences,
      price = v_price,
      currency = coalesce(nullif(trim(p_currency), ''), 'IDR'),
      image_url = nullif(trim(coalesce(p_image_url, '')), ''),
      is_active = coalesce(p_is_active, false),
      is_featured = coalesce(p_is_featured, false),
      sort_order = greatest(coalesce(p_sort_order, 0), 0),
      metadata = coalesce(p_metadata, '{}'::jsonb),
      updated_at = now()
    where id = p_product_id returning * into v_after;
    perform private.write_audit('admin.product_update', 'commerce_product', v_after.id::text, 'Admin panel', to_jsonb(v_before), to_jsonb(v_after), null);
  end if;

  return v_after;
end;
$$;

create or replace function public.create_product_order(
  p_product_id uuid,
  p_quantity integer default 1
) returns public.orders
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_product public.commerce_products;
  v_order public.orders;
  v_qty integer := p_quantity;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if v_qty is null or v_qty < 1 or v_qty > 100 then raise exception 'INVALID_QUANTITY'; end if;

  select * into v_product
  from public.commerce_products
  where id = p_product_id and is_active = true
  for share;
  if not found then raise exception 'PRODUCT_NOT_AVAILABLE'; end if;
  if v_product.product_type not in ('DIGITAL_ITEM', 'DONATION') then raise exception 'PRODUCT_TYPE_NOT_SUPPORTED'; end if;
  if v_product.price <= 0 then raise exception 'ACTIVE_PRODUCT_PRICE_REQUIRED'; end if;
  if cardinality(coalesce(v_product.audiences, array[]::text[])) = 0 then raise exception 'PRODUCT_NOT_AVAILABLE'; end if;
  if not private.current_user_is_admin() and not exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid() and ur.is_active = true
      and (
        (ur.role::text = 'student' and 'student' = any(v_product.audiences))
        or (ur.role::text = 'teacher' and 'teacher' = any(v_product.audiences))
        or (ur.role::text = 'organizer_member' and 'organizer' = any(v_product.audiences))
      )
  ) then raise exception 'PRODUCT_NOT_AVAILABLE'; end if;

  insert into public.orders(user_id, status, subtotal, discount, shipping_cost, total, currency)
  values(auth.uid(), 'DRAFT', v_product.price * v_qty, 0, 0, v_product.price * v_qty, v_product.currency)
  returning * into v_order;

  insert into public.order_items(order_id, product_type, product_ref, name, quantity, unit_price, line_total, metadata)
  values(v_order.id, v_product.product_type, v_product.id::text, v_product.name, v_qty, v_product.price, v_product.price * v_qty,
    jsonb_build_object('product_code', v_product.code, 'metadata', v_product.metadata));

  perform private.write_audit('commerce.order_created', 'order', v_order.id::text, 'Draft catalog order created by user', null, to_jsonb(v_order), null);
  return v_order;
end;
$$;

create or replace function public.create_product_order_with_proof(
  p_product_id uuid,
  p_quantity integer default 1,
  p_whatsapp text default null,
  p_payment_method text default 'MANUAL_TRANSFER',
  p_proof_url text default null,
  p_proof_public_id text default null,
  p_proof_width integer default null,
  p_proof_height integer default null,
  p_proof_version text default null,
  p_proof_resource_type text default null
) returns public.orders
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_product public.commerce_products;
  v_order public.orders;
  v_qty integer := p_quantity;
  v_total numeric(14,2);
  v_payment_method text := upper(trim(coalesce(p_payment_method, 'BANK_TRANSFER')));
  v_proof_url text := nullif(trim(coalesce(p_proof_url, '')), '');
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if v_qty is null or v_qty < 1 or v_qty > 100 then raise exception 'INVALID_QUANTITY'; end if;
  if nullif(trim(coalesce(p_whatsapp, '')), '') is null then raise exception 'WHATSAPP_REQUIRED'; end if;
  if v_payment_method not in ('BANK_TRANSFER', 'MANUAL_TRANSFER', 'QRIS', 'EWALLET') then raise exception 'INVALID_PAYMENT_METHOD'; end if;
  if v_proof_url is not null and v_proof_url !~* '^https?://' then raise exception 'PAYMENT_PROOF_URL_INVALID'; end if;

  select * into v_product
  from public.commerce_products
  where id = p_product_id and is_active = true;
  if not found then raise exception 'PRODUCT_NOT_AVAILABLE'; end if;
  if v_product.product_type not in ('DIGITAL_ITEM', 'DONATION') then raise exception 'PRODUCT_TYPE_NOT_SUPPORTED'; end if;
  if v_product.price <= 0 then raise exception 'ACTIVE_PRODUCT_PRICE_REQUIRED'; end if;
  if cardinality(coalesce(v_product.audiences, array[]::text[])) = 0 then raise exception 'PRODUCT_NOT_AVAILABLE'; end if;
  if not private.current_user_is_admin() and not exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid() and ur.is_active = true
      and (
        (ur.role::text = 'student' and 'student' = any(v_product.audiences))
        or (ur.role::text = 'teacher' and 'teacher' = any(v_product.audiences))
        or (ur.role::text = 'organizer_member' and 'organizer' = any(v_product.audiences))
      )
  ) then raise exception 'PRODUCT_NOT_AVAILABLE'; end if;
  if v_product.price > 0 and v_proof_url is null then raise exception 'PAYMENT_PROOF_REQUIRED'; end if;

  v_total := v_product.price * v_qty;
  insert into public.orders(
    user_id, status, subtotal, discount, shipping_cost, total, currency, contact_whatsapp,
    payment_method, payment_proof_url, payment_proof_public_id, payment_proof_width, payment_proof_height,
    payment_proof_version, payment_proof_resource_type, payment_proof_status
  ) values (
    auth.uid(), 'PENDING_PAYMENT', v_total, 0, 0, v_total, v_product.currency, trim(p_whatsapp),
    v_payment_method, v_proof_url, p_proof_public_id, p_proof_width, p_proof_height,
    p_proof_version, p_proof_resource_type,
    case when v_proof_url is null then 'NOT_SUBMITTED' else 'SUBMITTED' end
  ) returning * into v_order;

  insert into public.order_items(order_id, product_type, product_ref, name, quantity, unit_price, line_total, metadata)
  values(v_order.id, v_product.product_type, v_product.id::text, v_product.name, v_qty, v_product.price, v_total,
    jsonb_build_object('commerce_product_id', v_product.id, 'product_code', v_product.code, 'metadata', v_product.metadata));

  perform private.write_audit('commerce.order_created', 'order', v_order.id::text, 'Shop checkout submitted for payment review', null, to_jsonb(v_order), null);
  return v_order;
end;
$$;

create or replace function public.admin_review_manual_order(
  p_order_id uuid,
  p_decision text,
  p_reason text default null
) returns public.orders
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare
  v public.orders;
  v_before public.orders;
  i public.order_items;
  v_org uuid;
  v_plan text;
  v_period text;
  v_voucher_id uuid;
  v_voucher public.organizer_vouchers;
  v_claim public.organizer_voucher_claims;
  v_collective_registration_id uuid;
begin
  if not private.current_user_is_admin() then raise exception 'ACCESS_DENIED'; end if;

  select * into v from public.orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if upper(trim(p_decision)) not in ('APPROVE', 'REJECT') then raise exception 'INVALID_DECISION'; end if;
  if v.status <> 'PENDING_PAYMENT' then raise exception 'ORDER_NOT_REVIEWABLE:%', v.status; end if;

  select * into i from public.order_items where order_id = v.id order by created_at limit 1;

  if i.product_type = 'COLLECTIVE_REGISTRATION' then
    v_collective_registration_id := nullif(i.metadata->>'collective_registration_id', '')::uuid;
    if v_collective_registration_id is null then raise exception 'COLLECTIVE_REGISTRATION_LINK_MISSING'; end if;

    if upper(trim(p_decision)) = 'REJECT' then
      update public.orders set status = 'CANCELLED', payment_proof_status = 'REJECTED',
        admin_review_note = nullif(trim(p_reason), ''), reviewed_at = now(), updated_at = now()
      where id = v.id returning * into v;
      update public.collective_registrations set status = 'REJECTED', updated_at = now()
      where id = v_collective_registration_id and status = 'PENDING_PAYMENT';
      insert into public.notifications(user_id, type, title, body, data)
      values(v.user_id, 'ORDER_PAYMENT', 'Pembayaran perlu diperbaiki',
        coalesce(nullif(trim(p_reason), ''), 'Bukti pembayaran belum dapat disetujui.'),
        jsonb_build_object('order_id', v.id, 'collective_registration_id', v_collective_registration_id));
      return v;
    end if;

    update public.orders set status = 'PAID', payment_proof_status = 'APPROVED',
      admin_review_note = nullif(trim(p_reason), ''), reviewed_at = now(), updated_at = now()
    where id = v.id returning * into v;
    update public.collective_registrations set status = 'PAID', updated_at = now()
    where id = v_collective_registration_id and status = 'PENDING_PAYMENT';
    perform private.provision_collective_registration(v_collective_registration_id);
    insert into public.notifications(user_id, type, title, body, data)
    values(v.user_id, 'ORDER_PAYMENT', 'Pendaftaran kolektif berhasil',
      'Pembayaran telah diverifikasi dan peserta siap mengakses lomba.',
      jsonb_build_object('order_id', v.id, 'collective_registration_id', v_collective_registration_id));
    return v;
  end if;

  if upper(trim(p_decision)) = 'REJECT' then
    update public.orders set status = 'CANCELLED', payment_proof_status = 'REJECTED',
      admin_review_note = nullif(trim(p_reason), ''), reviewed_at = now(), updated_at = now()
    where id = v.id returning * into v;

    v_voucher_id := nullif(i.metadata->>'voucher_id', '')::uuid;
    if v_voucher_id is not null then
      select * into v_claim from public.organizer_voucher_claims
      where voucher_id = v_voucher_id and used_order_id = v.id for update;
      if found then
        update public.organizer_voucher_claims set status = 'CLAIMED', used_at = null, used_order_id = null where id = v_claim.id;
        update public.organizer_vouchers set used_count = greatest(used_count - 1, 0), used_at = null, is_active = true, updated_at = now()
        where id = v_voucher_id;
      end if;
    end if;

    insert into public.notifications(user_id, type, title, body, data)
    values(v.user_id, 'ORDER_PAYMENT', 'Pembayaran perlu diperbaiki',
      coalesce(nullif(trim(p_reason), ''), 'Bukti pembayaran belum dapat disetujui.'),
      jsonb_build_object('order_id', v.id));
    return v;
  end if;

  -- A normal Shop product does not represent an organizer subscription.
  if i.product_type in ('DIGITAL_ITEM', 'DONATION') then
    v_before := v;
    update public.orders set status = 'PAID', payment_proof_status = 'APPROVED',
      admin_review_note = nullif(trim(p_reason), ''), reviewed_at = now(), updated_at = now()
    where id = v.id returning * into v;

    perform private.write_audit('commerce.order_payment_approved', 'order', v.id::text,
      coalesce(nullif(trim(p_reason), ''), 'Shop payment approved'), to_jsonb(v_before), to_jsonb(v), null);

    insert into public.notifications(user_id, type, title, body, data)
    values(
      v.user_id,
      'ORDER_PAYMENT',
      case when i.product_type = 'DONATION' then 'Donasi berhasil diverifikasi' else 'Pembayaran produk berhasil' end,
      case when i.product_type = 'DONATION'
        then 'Terima kasih atas dukunganmu. Donasi telah diverifikasi oleh tim SYKABELAJAR.'
        else 'Pembayaran telah diverifikasi. Tim SYKABELAJAR akan memproses pesananmu.'
      end,
      jsonb_build_object('order_id', v.id, 'product_type', i.product_type, 'product_ref', i.product_ref, 'product_name', i.name)
    );
    return v;
  end if;

  if i.product_type in ('EDU_COIN_TOPUP', 'FEATURE_UNLOCK') then raise exception 'PRODUCT_FULFILLMENT_NOT_CONFIGURED'; end if;

  -- Preserve the existing organizer subscription flow and its voucher handling.
  v_plan := i.metadata->>'plan_code';
  v_period := i.metadata->>'billing_period';
  v_org := (i.metadata->>'organizer_id')::uuid;
  v_voucher_id := nullif(i.metadata->>'voucher_id', '')::uuid;
  if v_org is null or v_plan is null then raise exception 'INVALID_ORGANIZER_PLAN_ORDER'; end if;

  if v_voucher_id is not null then
    select * into v_voucher from public.organizer_vouchers where id = v_voucher_id for update;
    if not found or not v_voucher.is_active or v_voucher.used_count >= v_voucher.max_uses then raise exception 'VOUCHER_EXHAUSTED'; end if;
    if v_voucher.benefit_type = 'FREE_PLAN' and upper(coalesce(v_voucher.free_plan_code, '')) <> upper(coalesce(v_plan, '')) then raise exception 'VOUCHER_FREE_PLAN_MISMATCH'; end if;
  end if;

  update public.orders set status = 'PAID', payment_proof_status = 'APPROVED',
    admin_review_note = nullif(trim(p_reason), ''), reviewed_at = now(), updated_at = now()
  where id = v.id returning * into v;

  update public.organizer_plans set is_active = false where organizer_id = v_org and is_active = true;
  insert into public.organizer_plans(organizer_id, plan_code, starts_at, ends_at, is_active)
  values(v_org, v_plan, now(), case when v_period = 'MONTHLY' then now() + interval '1 month' when v_period = 'YEARLY' then now() + interval '1 year' else null end, true);

  if v_voucher_id is not null then
    select * into v_claim from public.organizer_voucher_claims
    where voucher_id = v_voucher_id and organizer_id = v_org and status in ('CLAIMED', 'USED') for update;
    if found then
      if v_claim.status = 'CLAIMED' then
        update public.organizer_voucher_claims set status = 'USED', used_at = now(), used_order_id = v.id where id = v_claim.id;
        update public.organizer_vouchers set used_count = used_count + 1, used_at = now(), is_active = ((used_count + 1) < max_uses), updated_at = now()
        where id = v_voucher_id;
      end if;
    else
      insert into public.organizer_voucher_claims(voucher_id, organizer_id, claimed_by, status, claimed_at, used_at, used_order_id)
      values(v_voucher_id, v_org, v.user_id, 'USED', now(), now(), v.id);
      update public.organizer_vouchers set claim_count = claim_count + 1, used_count = used_count + 1,
        used_at = now(), is_active = ((used_count + 1) < max_uses), updated_at = now()
      where id = v_voucher_id;
    end if;
  end if;

  insert into public.notifications(user_id, type, title, body, data)
  values(v.user_id, 'ORDER_PAYMENT', 'Pembayaran berhasil',
    'Pembayaran telah diverifikasi. Paket organizer Anda sekarang aktif.',
    jsonb_build_object('order_id', v.id, 'plan_code', v_plan));
  return v;
end;
$$;

-- Keep these APIs authenticated-only; their own bodies also enforce the required role and ownership checks.
revoke execute on function public.admin_save_product(uuid,text,text,text,text,text,text,text[],numeric,text,text,boolean,boolean,integer,jsonb) from public, anon;
grant execute on function public.admin_save_product(uuid,text,text,text,text,text,text,text[],numeric,text,text,boolean,boolean,integer,jsonb) to authenticated;
revoke execute on function public.create_product_order(uuid,integer) from public, anon;
grant execute on function public.create_product_order(uuid,integer) to authenticated;
revoke execute on function public.create_product_order_with_proof(uuid,integer,text,text,text,text,integer,integer,text,text) from public, anon;
grant execute on function public.create_product_order_with_proof(uuid,integer,text,text,text,text,integer,integer,text,text) to authenticated;
revoke execute on function public.admin_review_manual_order(uuid,text,text) from public, anon;
grant execute on function public.admin_review_manual_order(uuid,text,text) to authenticated;
