-- Safe Edu Coin checkout for Shop-priced products.
-- Payment, wallet debit, ledger, order creation, and supported fulfillment share one transaction.

alter table public.commerce_products
  drop constraint if exists commerce_products_shop_currency_coin_check;

alter table public.commerce_products
  add constraint commerce_products_shop_currency_coin_check
  check (
    currency in ('IDR', 'EDU_COIN')
    and (
      currency <> 'EDU_COIN'
      or (
        product_type in ('DIGITAL_ITEM', 'DONATION', 'BADGE', 'CERTIFICATE_SERIALS')
        and price >= 1
        and price <= 1000000000
        and price = trunc(price)
      )
    )
  ) not valid;

alter table public.commerce_products
  validate constraint commerce_products_shop_currency_coin_check;

create or replace function public.create_product_order_with_edu_coin(
  p_product_id uuid,
  p_quantity integer default 1,
  p_whatsapp text default null,
  p_target_organizer_id uuid default null
) returns public.orders
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_product public.commerce_products%rowtype;
  v_order public.orders%rowtype;
  v_qty integer := p_quantity;
  v_unit_price bigint;
  v_total bigint;
  v_balance_before bigint;
  v_balance_after bigint;
  v_profile_status text;
  v_whatsapp text := nullif(trim(coalesce(p_whatsapp, '')), '');
  v_badge_id uuid;
  v_user_badge_id uuid;
  v_org uuid := p_target_organizer_id;
  v_org_name text;
  v_org_words text[];
  v_org_suffix text;
  v_middle text;
  v_serial_code text;
  v_qr_payload text;
  v_serial_id uuid;
  v_serial_quantity integer;
  v_serial_created boolean;
  v_attempt integer;
  i integer;
  j integer;
begin
  if v_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if v_qty is null or v_qty < 1 or v_qty > 100 then raise exception 'INVALID_QUANTITY'; end if;

  select * into v_product
  from public.commerce_products p
  where p.id = p_product_id and p.is_active = true
  for share;
  if not found then raise exception 'PRODUCT_NOT_AVAILABLE'; end if;

  if v_product.currency <> 'EDU_COIN' then raise exception 'PRODUCT_CURRENCY_NOT_SUPPORTED'; end if;
  if v_product.product_type not in ('DIGITAL_ITEM', 'DONATION', 'BADGE', 'CERTIFICATE_SERIALS') then
    raise exception 'PRODUCT_TYPE_NOT_SUPPORTED';
  end if;
  if v_product.price < 1
     or v_product.price > 1000000000
     or v_product.price <> trunc(v_product.price) then
    raise exception 'COIN_PRICE_INVALID';
  end if;

  if cardinality(coalesce(v_product.audiences, array[]::text[])) = 0 then
    raise exception 'PRODUCT_NOT_AVAILABLE';
  end if;
  if not private.current_user_is_admin() and not exists (
    select 1
    from public.user_roles ur
    where ur.user_id = v_user_id
      and ur.is_active = true
      and (
        (ur.role::text = 'student' and 'student' = any(v_product.audiences))
        or (ur.role::text = 'teacher' and 'teacher' = any(v_product.audiences))
        or (ur.role::text = 'organizer_member' and 'organizer' = any(v_product.audiences))
      )
  ) then
    raise exception 'PRODUCT_NOT_AVAILABLE';
  end if;

  if v_product.product_type in ('BADGE', 'CERTIFICATE_SERIALS') and v_qty <> 1 then
    raise exception 'SINGLE_PACKAGE_ONLY';
  end if;
  if v_product.product_type in ('DIGITAL_ITEM', 'DONATION') and v_whatsapp is null then
    raise exception 'WHATSAPP_REQUIRED';
  end if;

  if v_product.product_type = 'BADGE' then
    if coalesce(v_product.metadata->>'badge_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'BADGE_NOT_AVAILABLE';
    end if;
    v_badge_id := (v_product.metadata->>'badge_id')::uuid;
    if not exists (
      select 1 from public.badges b
      where b.id = v_badge_id
        and b.status = 'ACTIVE'
        and b.is_purchasable = true
        and b.award_type = 'MANUAL'
    ) then
      raise exception 'BADGE_NOT_AVAILABLE';
    end if;
    if exists (
      select 1 from public.user_badges ub
      where ub.user_id = v_user_id and ub.badge_id = v_badge_id
    ) then
      raise exception 'BADGE_ALREADY_OWNED';
    end if;
    if v_org is not null then raise exception 'UNEXPECTED_ORGANIZER'; end if;
  elsif v_product.product_type = 'CERTIFICATE_SERIALS' then
    if coalesce(v_product.metadata->>'serial_quantity', '') !~ '^[0-9]+$' then
      raise exception 'SERIAL_QUANTITY_INVALID';
    end if;
    v_serial_quantity := (v_product.metadata->>'serial_quantity')::integer;
    if v_serial_quantity < 1 or v_serial_quantity > 1000 then raise exception 'SERIAL_QUANTITY_INVALID'; end if;
    if v_org is null then raise exception 'ORGANIZER_REQUIRED'; end if;
    if not (
      private.current_user_is_admin()
      or private.current_user_can_manage_organizer(v_org)
    ) then
      raise exception 'ORGANIZER_ACCESS_DENIED';
    end if;
    if not exists (
      select 1 from public.organizers o
      where o.id = v_org and o.status = 'ACTIVE'
    ) then
      raise exception 'ORGANIZER_NOT_AVAILABLE';
    end if;
  elsif v_org is not null then
    raise exception 'UNEXPECTED_ORGANIZER';
  end if;

  v_unit_price := v_product.price::bigint;
  v_total := v_unit_price * v_qty;
  if v_total < 1 or v_total > 100000000000 then raise exception 'COIN_PRICE_INVALID'; end if;

  -- Serialize all spend operations for this wallet, then validate the current server balance.
  select coalesce(p.edu_coin, 0)::bigint, p.status::text
    into v_balance_before, v_profile_status
  from public.profiles p
  where p.id = v_user_id
  for update;
  if not found then raise exception 'PROFILE_NOT_FOUND'; end if;
  if v_profile_status <> 'ACTIVE' then raise exception 'ACCOUNT_NOT_ACTIVE'; end if;
  if v_balance_before < v_total then
    raise exception 'INSUFFICIENT_EDU_COIN'
      using detail = jsonb_build_object('required', v_total, 'balance', v_balance_before)::text;
  end if;

  insert into public.orders(
    user_id, status, subtotal, discount, shipping_cost, total, currency,
    contact_whatsapp, payment_method, payment_provider, payment_proof_status
  ) values (
    v_user_id, 'PENDING_PAYMENT', v_total, 0, 0, v_total, 'EDU_COIN',
    v_whatsapp, 'EDU_COIN', 'EDU_COIN', 'NOT_SUBMITTED'
  ) returning * into v_order;

  insert into public.order_items(
    order_id, product_type, product_ref, name, quantity, unit_price, line_total, metadata
  ) values (
    v_order.id,
    v_product.product_type,
    v_product.id::text,
    v_product.name,
    v_qty,
    v_unit_price,
    v_total,
    jsonb_build_object(
      'commerce_product_id', v_product.id,
      'product_code', v_product.code,
      'shop_metadata', coalesce(v_product.metadata, '{}'::jsonb)
    ) || case when v_org is not null then jsonb_build_object('organizer_id', v_org) else '{}'::jsonb end
  );

  update public.profiles
  set edu_coin = coalesce(edu_coin, 0) - v_total,
      updated_at = clock_timestamp()
  where id = v_user_id
    and coalesce(edu_coin, 0) >= v_total
  returning edu_coin into v_balance_after;
  if not found then raise exception 'INSUFFICIENT_EDU_COIN'; end if;

  insert into public.edu_coin_ledger(user_id, event_type, event_id, amount, reason)
  values (
    v_user_id,
    'SHOP_EDU_COIN_SPEND',
    v_order.id::text,
    -v_total,
    'Pembelian Shop dengan Edu Coin: ' || v_product.name
  );

  if v_product.product_type = 'BADGE' then
    insert into public.user_badges(
      user_id, badge_id, awarded_by, award_source, reason, source_reference, metadata
    ) values (
      v_user_id, v_badge_id, v_user_id, 'SYSTEM',
      'Badge dibeli dengan Edu Coin melalui Shop',
      v_order.id::text,
      jsonb_build_object(
        'source', 'SHOP_PURCHASE_EDU_COIN',
        'order_id', v_order.id,
        'product_id', v_product.id
      )
    )
    on conflict(user_id, badge_id) do nothing
    returning id into v_user_badge_id;
    if v_user_badge_id is null then raise exception 'BADGE_ALREADY_OWNED'; end if;

    insert into public.badge_audit_logs(
      badge_id, target_user_id, actor_user_id, action, reason, metadata
    ) values (
      v_badge_id, v_user_id, v_user_id, 'AWARDED_SHOP_PURCHASE',
      'Badge dibeli dengan Edu Coin',
      jsonb_build_object('order_id', v_order.id, 'product_id', v_product.id)
    );
  elsif v_product.product_type = 'CERTIFICATE_SERIALS' then
    select o.name into v_org_name
    from public.organizers o
    where o.id = v_org;

    v_org_name := regexp_replace(upper(coalesce(v_org_name, '')), '[^A-Z0-9 ]', '', 'g');
    v_org_words := regexp_split_to_array(trim(regexp_replace(v_org_name, '[[:space:]]+', ' ', 'g')), ' ');
    v_org_words := array(select w from unnest(v_org_words) as words(w) where w <> '');

    if coalesce(array_length(v_org_words, 1), 0) = 0 then
      v_org_suffix := 'ORG';
    elsif array_length(v_org_words, 1) = 1 then
      v_org_suffix := substr(v_org_words[1], 1, 1);
    else
      v_org_suffix := '';
      for j in 1..array_length(v_org_words, 1) loop
        v_org_suffix := v_org_suffix || substr(v_org_words[j], 1, 1);
      end loop;
    end if;

    for i in 1..v_serial_quantity loop
      v_serial_created := false;
      for v_attempt in 1..10 loop
        v_middle := '';
        for j in 1..13 loop
          v_middle := v_middle || substr('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', 1 + floor(random() * 36)::integer, 1);
        end loop;
        v_serial_code := 'SYKA' || v_middle || v_org_suffix;
        v_qr_payload := v_serial_code;
        begin
          insert into public.organizer_serials(
            organizer_id, serial_code, qr_payload, status, source_order_id
          ) values (
            v_org, v_serial_code, v_qr_payload, 'AVAILABLE', v_order.id
          ) returning id into v_serial_id;
          v_serial_created := true;
          exit;
        exception when unique_violation then
          null;
        end;
      end loop;
      if not v_serial_created then raise exception 'SERIAL_GENERATION_FAILED'; end if;
    end loop;

    insert into public.notifications(user_id, type, title, body, data)
    values (
      v_user_id, 'ORDER_PAYMENT', 'Paket QR / Serial Sertifikat siap',
      v_serial_quantity::text || ' QR / Serial sertifikat telah ditambahkan ke organisasi.',
      jsonb_build_object(
        'order_id', v_order.id,
        'organizer_id', v_org,
        'serial_quantity', v_serial_quantity,
        'payment_currency', 'EDU_COIN'
      )
    );
  elsif v_product.product_type in ('DIGITAL_ITEM', 'DONATION') then
    insert into public.notifications(user_id, type, title, body, data)
    values (
      v_user_id,
      'ORDER_PAYMENT',
      case when v_product.product_type = 'DONATION' then 'Donasi berhasil dibayar dengan Edu Coin' else 'Pembelian Shop berhasil' end,
      case when v_product.product_type = 'DONATION'
        then 'Terima kasih atas dukunganmu. Donasimu telah dibayar dengan Edu Coin.'
        else 'Pembelian telah dibayar dengan Edu Coin. Tim SYKABELAJAR akan memproses produk atau layanan ini.'
      end,
      jsonb_build_object(
        'order_id', v_order.id,
        'product_type', v_product.product_type,
        'product_ref', v_product.id,
        'product_name', v_product.name,
        'payment_currency', 'EDU_COIN',
        'edu_coin_spent', v_total,
        'edu_coin_balance', v_balance_after
      )
    );
  end if;

  update public.orders
  set status = 'PAID',
      reviewed_at = clock_timestamp(),
      admin_review_note = 'Pembayaran Edu Coin divalidasi dan diproses otomatis oleh sistem',
      updated_at = clock_timestamp()
  where id = v_order.id
  returning * into v_order;

  perform private.write_audit(
    'commerce.edu_coin_shop_purchase_fulfilled',
    'order',
    v_order.id::text,
    'Paid with Edu Coin; automatic settlement',
    null,
    to_jsonb(v_order),
    null
  );

  return v_order;
end;
$function$;

revoke execute on function public.create_product_order_with_edu_coin(uuid, integer, text, uuid) from public, anon;
grant execute on function public.create_product_order_with_edu_coin(uuid, integer, text, uuid) to authenticated;
