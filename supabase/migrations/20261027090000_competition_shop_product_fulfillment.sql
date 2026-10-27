-- SYKABELAJAR competition Shop: Edu Coin top-ups, profile badges, serial credits and collective certificates.
-- All benefits are fulfilled atomically in the existing order review flow. No browser-side balance/entitlement grants.

alter table public.commerce_products
  drop constraint if exists commerce_products_product_type_check;
alter table public.commerce_products
  add constraint commerce_products_product_type_check
  check (product_type = any (array[
    'EDU_COIN_TOPUP','FEATURE_UNLOCK','DIGITAL_ITEM','DONATION','PLAN',
    'BADGE','CERTIFICATE_SERIALS','COLLECTIVE_CERTIFICATE'
  ]::text[]));

alter table public.organizer_serials
  add column if not exists source_order_id uuid references public.orders(id) on delete restrict;

alter table public.badges
  add column if not exists is_purchasable boolean not null default false;
create index if not exists badges_shop_purchasable_idx
  on public.badges(name) where status = 'ACTIVE' and is_purchasable = true and award_type = 'MANUAL';

create index if not exists organizer_serials_source_order_idx
  on public.organizer_serials(source_order_id) where source_order_id is not null;

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
  v_type text := upper(trim(coalesce(p_product_type, 'DIGITAL_ITEM')));
  v_audiences text[] := coalesce(p_audiences, array[]::text[]);
  v_price numeric := coalesce(p_price, 0);
  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_badge_id uuid;
  v_coin_amount integer;
  v_serial_quantity integer;
begin
  if not private.current_user_is_admin() then raise exception 'ACCESS_DENIED'; end if;
  if nullif(trim(coalesce(p_name,'')),'') is null then raise exception 'NAME_REQUIRED'; end if;
  if nullif(trim(coalesce(p_code,'')),'') is null then raise exception 'CODE_REQUIRED'; end if;
  if nullif(trim(coalesce(p_slug,'')),'') is null then raise exception 'SLUG_REQUIRED'; end if;
  if v_type not in ('DIGITAL_ITEM','DONATION','EDU_COIN_TOPUP','BADGE','CERTIFICATE_SERIALS','COLLECTIVE_CERTIFICATE') then
    raise exception 'PRODUCT_TYPE_NOT_SUPPORTED';
  end if;
  if cardinality(v_audiences) = 0 then raise exception 'AUDIENCE_REQUIRED'; end if;
  if not (v_audiences <@ array['student','teacher','organizer']::text[]) then raise exception 'AUDIENCE_INVALID'; end if;
  if v_price < 0 then raise exception 'PRICE_INVALID'; end if;
  if coalesce(p_is_active,false) and v_price <= 0 and v_type <> 'COLLECTIVE_CERTIFICATE' then
    raise exception 'ACTIVE_PRODUCT_PRICE_REQUIRED';
  end if;
  if nullif(trim(coalesce(p_image_url,'')),'') is not null and trim(p_image_url) !~* '^https?://' then
    raise exception 'IMAGE_URL_INVALID';
  end if;

  if v_type = 'EDU_COIN_TOPUP' then
    if coalesce(v_metadata->>'coin_amount','') !~ '^[0-9]+$' then raise exception 'COIN_AMOUNT_REQUIRED'; end if;
    v_coin_amount := (v_metadata->>'coin_amount')::integer;
    if v_coin_amount < 1 or v_coin_amount > 1000000 then raise exception 'COIN_AMOUNT_INVALID'; end if;
  elsif v_type = 'BADGE' then
    if coalesce(v_metadata->>'badge_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'BADGE_REQUIRED'; end if;
    v_badge_id := (v_metadata->>'badge_id')::uuid;
    if not exists(select 1 from public.badges b where b.id=v_badge_id and b.status='ACTIVE' and b.is_purchasable=true and b.award_type='MANUAL') then raise exception 'BADGE_NOT_AVAILABLE'; end if;
  elsif v_type = 'CERTIFICATE_SERIALS' then
    if coalesce(v_metadata->>'serial_quantity','') !~ '^[0-9]+$' then raise exception 'SERIAL_QUANTITY_REQUIRED'; end if;
    v_serial_quantity := (v_metadata->>'serial_quantity')::integer;
    if v_serial_quantity < 1 or v_serial_quantity > 1000 then raise exception 'SERIAL_QUANTITY_INVALID'; end if;
    if not ('organizer' = any(v_audiences)) then raise exception 'SERIALS_ORGANIZER_ONLY'; end if;
  elsif v_type = 'COLLECTIVE_CERTIFICATE' then
    if not ('teacher' = any(v_audiences)) then raise exception 'COLLECTIVE_CERTIFICATE_TEACHER_ONLY'; end if;
    -- The real fee comes from the existing certificate settings, not this product's placeholder price.
    v_price := 0;
    v_metadata := jsonb_build_object('fulfillment','COLLECTIVE_CERTIFICATE');
  end if;

  if p_product_id is null then
    insert into public.commerce_products(
      code,slug,name,short_description,description,product_type,audiences,price,currency,
      image_url,is_active,is_featured,sort_order,metadata
    ) values (
      trim(p_code),trim(p_slug),trim(p_name),
      nullif(trim(coalesce(p_short_description,'')),''),
      nullif(trim(coalesce(p_description,'')),''),
      v_type,v_audiences,v_price,coalesce(nullif(trim(p_currency),''),'IDR'),
      nullif(trim(coalesce(p_image_url,'')),''),
      coalesce(p_is_active,false),coalesce(p_is_featured,false),greatest(coalesce(p_sort_order,0),0),v_metadata
    ) returning * into v_after;
    perform private.write_audit('admin.product_create','commerce_product',v_after.id::text,'Admin Shop',null,to_jsonb(v_after),null);
  else
    select * into v_before from public.commerce_products where id=p_product_id for update;
    if not found then raise exception 'PRODUCT_NOT_FOUND'; end if;
    update public.commerce_products set
      code=trim(p_code),slug=trim(p_slug),name=trim(p_name),
      short_description=nullif(trim(coalesce(p_short_description,'')),''),
      description=nullif(trim(coalesce(p_description,'')),''),
      product_type=v_type,audiences=v_audiences,price=v_price,
      currency=coalesce(nullif(trim(p_currency),''),'IDR'),
      image_url=nullif(trim(coalesce(p_image_url,'')),''),
      is_active=coalesce(p_is_active,false),is_featured=coalesce(p_is_featured,false),
      sort_order=greatest(coalesce(p_sort_order,0),0),metadata=v_metadata,updated_at=now()
    where id=p_product_id returning * into v_after;
    perform private.write_audit('admin.product_update','commerce_product',v_after.id::text,'Admin Shop',to_jsonb(v_before),to_jsonb(v_after),null);
  end if;
  return v_after;
end;
$$;

revoke execute on function public.admin_save_product(uuid,text,text,text,text,text,text,text[],numeric,text,text,boolean,boolean,integer,jsonb) from public, anon;
grant execute on function public.admin_save_product(uuid,text,text,text,text,text,text,text[],numeric,text,text,boolean,boolean,integer,jsonb) to authenticated;

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
  select * into v_product from public.commerce_products where id=p_product_id and is_active=true for share;
  if not found then raise exception 'PRODUCT_NOT_AVAILABLE'; end if;
  if v_product.product_type not in ('DIGITAL_ITEM','DONATION') then raise exception 'PRODUCT_TYPE_NOT_SUPPORTED'; end if;
  if v_product.price <= 0 then raise exception 'ACTIVE_PRODUCT_PRICE_REQUIRED'; end if;
  if cardinality(coalesce(v_product.audiences,array[]::text[]))=0 then raise exception 'PRODUCT_NOT_AVAILABLE'; end if;
  if not private.current_user_is_admin() and not exists (
    select 1 from public.user_roles ur where ur.user_id=auth.uid() and ur.is_active=true
      and ((ur.role::text='student' and 'student'=any(v_product.audiences))
        or (ur.role::text='teacher' and 'teacher'=any(v_product.audiences))
        or (ur.role::text='organizer_member' and 'organizer'=any(v_product.audiences)))
  ) then raise exception 'PRODUCT_NOT_AVAILABLE'; end if;
  insert into public.orders(user_id,status,subtotal,discount,shipping_cost,total,currency)
  values(auth.uid(),'DRAFT',v_product.price*v_qty,0,0,v_product.price*v_qty,v_product.currency)
  returning * into v_order;
  insert into public.order_items(order_id,product_type,product_ref,name,quantity,unit_price,line_total,metadata)
  values(v_order.id,v_product.product_type,v_product.id::text,v_product.name,v_qty,v_product.price,v_product.price*v_qty,
    jsonb_build_object('product_code',v_product.code,'metadata',v_product.metadata));
  perform private.write_audit('commerce.order_created','order',v_order.id::text,'Draft catalog order created by user',null,to_jsonb(v_order),null);
  return v_order;
end;
$$;

revoke execute on function public.create_product_order(uuid,integer) from public, anon;
grant execute on function public.create_product_order(uuid,integer) to authenticated;

drop function if exists public.create_product_order_with_proof(uuid,integer,text,text,text,text,integer,integer,text,text);
create function public.create_product_order_with_proof(
  p_product_id uuid,
  p_quantity integer default 1,
  p_whatsapp text default null,
  p_payment_method text default 'MANUAL_TRANSFER',
  p_proof_url text default null,
  p_proof_public_id text default null,
  p_proof_width integer default null,
  p_proof_height integer default null,
  p_proof_version text default null,
  p_proof_resource_type text default null,
  p_target_organizer_id uuid default null
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
  v_payment_method text := upper(trim(coalesce(p_payment_method,'BANK_TRANSFER')));
  v_proof_url text := nullif(trim(coalesce(p_proof_url,'')),'');
  v_metadata jsonb;
  v_badge_id uuid;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if v_qty is null or v_qty < 1 or v_qty > 100 then raise exception 'INVALID_QUANTITY'; end if;
  if nullif(trim(coalesce(p_whatsapp,'')),'') is null then raise exception 'WHATSAPP_REQUIRED'; end if;
  if v_payment_method not in ('BANK_TRANSFER','MANUAL_TRANSFER','QRIS','EWALLET') then raise exception 'INVALID_PAYMENT_METHOD'; end if;
  if v_proof_url is null or v_proof_url !~* '^https?://' then raise exception 'PAYMENT_PROOF_REQUIRED'; end if;

  select * into v_product from public.commerce_products where id=p_product_id and is_active=true for share;
  if not found then raise exception 'PRODUCT_NOT_AVAILABLE'; end if;
  if v_product.product_type not in ('DIGITAL_ITEM','DONATION','EDU_COIN_TOPUP','BADGE','CERTIFICATE_SERIALS') then
    raise exception 'PRODUCT_TYPE_NOT_SUPPORTED';
  end if;
  if v_product.price <= 0 then raise exception 'ACTIVE_PRODUCT_PRICE_REQUIRED'; end if;
  if cardinality(coalesce(v_product.audiences,array[]::text[]))=0 then raise exception 'PRODUCT_NOT_AVAILABLE'; end if;
  if not private.current_user_is_admin() and not exists (
    select 1 from public.user_roles ur where ur.user_id=auth.uid() and ur.is_active=true
      and ((ur.role::text='student' and 'student'=any(v_product.audiences))
        or (ur.role::text='teacher' and 'teacher'=any(v_product.audiences))
        or (ur.role::text='organizer_member' and 'organizer'=any(v_product.audiences)))
  ) then raise exception 'PRODUCT_NOT_AVAILABLE'; end if;

  if v_product.product_type in ('BADGE','CERTIFICATE_SERIALS') and v_qty <> 1 then raise exception 'SINGLE_PACKAGE_ONLY'; end if;
  if v_product.product_type='CERTIFICATE_SERIALS' then
    if p_target_organizer_id is null then raise exception 'ORGANIZER_REQUIRED'; end if;
    if not (private.current_user_is_admin() or private.current_user_can_manage_organizer(p_target_organizer_id)) then raise exception 'ORGANIZER_ACCESS_DENIED'; end if;
    if not exists(select 1 from public.organizers where id=p_target_organizer_id and status='ACTIVE') then raise exception 'ORGANIZER_NOT_AVAILABLE'; end if;
  elsif p_target_organizer_id is not null then
    raise exception 'UNEXPECTED_ORGANIZER';
  end if;

  if v_product.product_type='EDU_COIN_TOPUP' then
    if coalesce(v_product.metadata->>'coin_amount','') !~ '^[0-9]+$'
       or (v_product.metadata->>'coin_amount')::integer < 1 then raise exception 'COIN_AMOUNT_INVALID'; end if;
  elsif v_product.product_type='BADGE' then
    if coalesce(v_product.metadata->>'badge_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'BADGE_NOT_AVAILABLE'; end if;
    v_badge_id := (v_product.metadata->>'badge_id')::uuid;
    if not exists(select 1 from public.badges where id=v_badge_id and status='ACTIVE' and is_purchasable=true and award_type='MANUAL') then raise exception 'BADGE_NOT_AVAILABLE'; end if;
    if exists(select 1 from public.user_badges where user_id=auth.uid() and badge_id=v_badge_id) then raise exception 'BADGE_ALREADY_OWNED'; end if;
  elsif v_product.product_type='CERTIFICATE_SERIALS' then
    if coalesce(v_product.metadata->>'serial_quantity','') !~ '^[0-9]+$'
       or (v_product.metadata->>'serial_quantity')::integer not between 1 and 1000 then raise exception 'SERIAL_QUANTITY_INVALID'; end if;
  end if;

  v_total := v_product.price * v_qty;
  v_metadata := jsonb_build_object(
    'commerce_product_id',v_product.id,
    'product_code',v_product.code,
    'shop_metadata',coalesce(v_product.metadata,'{}'::jsonb)
  );
  if p_target_organizer_id is not null then
    v_metadata := v_metadata || jsonb_build_object('organizer_id',p_target_organizer_id);
  end if;

  insert into public.orders(
    user_id,status,subtotal,discount,shipping_cost,total,currency,contact_whatsapp,
    payment_method,payment_proof_url,payment_proof_public_id,payment_proof_width,payment_proof_height,
    payment_proof_version,payment_proof_resource_type,payment_proof_status
  ) values (
    auth.uid(),'PENDING_PAYMENT',v_total,0,0,v_total,v_product.currency,trim(p_whatsapp),
    v_payment_method,v_proof_url,p_proof_public_id,p_proof_width,p_proof_height,
    p_proof_version,p_proof_resource_type,'SUBMITTED'
  ) returning * into v_order;

  insert into public.order_items(order_id,product_type,product_ref,name,quantity,unit_price,line_total,metadata)
  values(v_order.id,v_product.product_type,v_product.id::text,v_product.name,v_qty,v_product.price,v_total,v_metadata);

  perform private.write_audit('commerce.order_created','order',v_order.id::text,'SYKABELAJAR Shop checkout',null,to_jsonb(v_order),null);
  return v_order;
end;
$$;

revoke execute on function public.create_product_order_with_proof(uuid,integer,text,text,text,text,integer,integer,text,text,uuid) from public, anon;
grant execute on function public.create_product_order_with_proof(uuid,integer,text,text,text,text,integer,integer,text,text,uuid) to authenticated;

create or replace function public.create_collective_certificate_order_with_proof(
  p_certificate_id uuid,
  p_payment_method text,
  p_proof_url text,
  p_proof_public_id text default null,
  p_proof_width integer default null,
  p_proof_height integer default null,
  p_proof_version text default null,
  p_proof_resource_type text default null,
  p_whatsapp text default null
) returns public.orders
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_uid uuid := auth.uid();
  v_cert public.collective_certificates%rowtype;
  v_cp public.collective_participants%rowtype;
  v_order public.orders%rowtype;
  v_price numeric := public.get_collective_certificate_price();
  v_method text := upper(trim(coalesce(p_payment_method,'BANK_TRANSFER')));
  v_proof text := nullif(trim(coalesce(p_proof_url,'')),'');
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists(select 1 from public.commerce_products p where p.is_active=true and p.product_type='COLLECTIVE_CERTIFICATE' and 'teacher'=any(p.audiences)) then raise exception 'CERTIFICATE_SHOP_NOT_AVAILABLE'; end if;
  if v_price <= 0 then raise exception 'CERTIFICATE_PRICE_NOT_CONFIGURED'; end if;
  if v_method not in ('BANK_TRANSFER','MANUAL_TRANSFER','QRIS','EWALLET') then raise exception 'INVALID_PAYMENT_METHOD'; end if;
  if v_proof is null or v_proof !~* '^https?://' then raise exception 'PAYMENT_PROOF_REQUIRED'; end if;

  select * into v_cert from public.collective_certificates where id=p_certificate_id for update;
  if not found then raise exception 'CERTIFICATE_NOT_FOUND'; end if;
  if v_cert.status not in ('ELIGIBLE','DRAFT') then raise exception 'CERTIFICATE_NOT_ORDERABLE'; end if;
  select * into v_cp from public.collective_participants where id=v_cert.collective_participant_id;
  if not found then raise exception 'PARTICIPANT_NOT_FOUND'; end if;
  if not (v_cp.managed_by_user_id=v_uid or v_cp.user_id=v_uid or private.current_user_is_admin()) then raise exception 'FORBIDDEN'; end if;
  if not exists(select 1 from public.attempts a where a.collective_participant_id=v_cp.id and a.status='FINALIZED') then raise exception 'RESULT_NOT_FINALIZED'; end if;
  if not exists(select 1 from public.competitions c where c.id=v_cert.competition_id and c.status in ('RESULT_PUBLISHED','ARCHIVED')) then
    raise exception 'RESULT_NOT_PUBLISHED';
  end if;

  select o.* into v_order
  from public.collective_certificate_orders cco
  join public.orders o on o.id=cco.order_id
  where cco.collective_certificate_id=v_cert.id
    and o.status not in ('CANCELLED','REFUNDED')
  order by o.created_at desc limit 1
  for update of o;

  if found then
    if v_order.user_id <> v_uid then raise exception 'CERTIFICATE_ORDER_OWNED_BY_ANOTHER_USER'; end if;
    if v_order.status='PAID' then raise exception 'CERTIFICATE_ALREADY_PAID'; end if;
    if v_order.payment_proof_status='SUBMITTED' then raise exception 'CERTIFICATE_PAYMENT_ALREADY_SUBMITTED'; end if;
    update public.orders set
      status='PENDING_PAYMENT',payment_method=v_method,payment_provider=v_method,
      payment_proof_url=v_proof,payment_proof_public_id=p_proof_public_id,
      payment_proof_width=p_proof_width,payment_proof_height=p_proof_height,
      payment_proof_version=p_proof_version,payment_proof_resource_type=p_proof_resource_type,
      payment_proof_status='SUBMITTED',contact_whatsapp=nullif(trim(coalesce(p_whatsapp,'')),''),
      subtotal=v_price,total=v_price,currency='IDR',updated_at=now()
    where id=v_order.id returning * into v_order;
    update public.order_items set unit_price=v_price,line_total=v_price,quantity=1
      where order_id=v_order.id;
    update public.collective_certificate_orders set amount=v_price,status='PENDING',updated_at=now()
      where order_id=v_order.id;
    return v_order;
  end if;

  insert into public.orders(
    user_id,status,subtotal,discount,shipping_cost,total,currency,payment_method,payment_provider,
    contact_name,contact_email,contact_note,contact_fields,contact_whatsapp,payment_proof_url,
    payment_proof_public_id,payment_proof_width,payment_proof_height,payment_proof_version,
    payment_proof_resource_type,payment_proof_status
  ) values (
    v_uid,'PENDING_PAYMENT',v_price,0,0,v_price,'IDR',v_method,v_method,
    v_cp.full_name,null,'Sertifikat peserta kolektif',jsonb_build_object('collective_certificate_id',v_cert.id,'participant_code',v_cp.participant_code),
    nullif(trim(coalesce(p_whatsapp,'')),''),v_proof,p_proof_public_id,p_proof_width,p_proof_height,
    p_proof_version,p_proof_resource_type,'SUBMITTED'
  ) returning * into v_order;

  insert into public.order_items(order_id,product_type,product_ref,name,quantity,unit_price,line_total,metadata)
  values(v_order.id,'DIGITAL_ITEM','COLLECTIVE_CERTIFICATE','Sertifikat Peserta — '||v_cp.full_name,1,v_price,v_price,
    jsonb_build_object('collective_certificate_id',v_cert.id,'participant_id',v_cp.id,'shop_checkout',true));

  insert into public.collective_certificate_orders(collective_certificate_id,order_id,payer_user_id,amount,status)
  values(v_cert.id,v_order.id,v_uid,v_price,'PENDING');
  return v_order;
end;
$$;

revoke execute on function public.create_collective_certificate_order_with_proof(uuid,text,text,text,integer,integer,text,text,text) from public, anon;
grant execute on function public.create_collective_certificate_order_with_proof(uuid,text,text,text,integer,integer,text,text,text) to authenticated;

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
  v_shop_metadata jsonb;
  v_coin_amount bigint;
  v_new_balance bigint;
  v_ledger_id uuid;
  v_badge_id uuid;
  v_user_badge_id uuid;
  v_serial_quantity integer;
  v_org_name text;
  v_org_suffix text;
  v_org_words text[];
  v_serial_code text;
  v_qr_payload text;
  v_serial_id uuid;
  v_middle text;
  j integer;
  k integer;
begin
  if not private.current_user_is_admin() then raise exception 'ACCESS_DENIED'; end if;
  select * into v from public.orders where id=p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if upper(trim(p_decision)) not in ('APPROVE','REJECT') then raise exception 'INVALID_DECISION'; end if;
  if v.status<>'PENDING_PAYMENT' then raise exception 'ORDER_NOT_REVIEWABLE:%',v.status; end if;
  v_before := v;
  select * into i from public.order_items where order_id=v.id order by created_at limit 1;
  v_shop_metadata := coalesce(i.metadata->'shop_metadata',i.metadata->'metadata','{}'::jsonb);

  if i.product_type='COLLECTIVE_REGISTRATION' then
    v_collective_registration_id:=nullif(i.metadata->>'collective_registration_id','')::uuid;
    if v_collective_registration_id is null then raise exception 'COLLECTIVE_REGISTRATION_LINK_MISSING'; end if;
    if upper(trim(p_decision))='REJECT' then
      update public.orders set status='CANCELLED',payment_proof_status='REJECTED',admin_review_note=nullif(trim(p_reason),''),reviewed_at=now(),updated_at=now() where id=v.id returning * into v;
      update public.collective_registrations set status='REJECTED',updated_at=now() where id=v_collective_registration_id and status='PENDING_PAYMENT';
      insert into public.notifications(user_id,type,title,body,data) values(v.user_id,'ORDER_PAYMENT','Pembayaran perlu diperbaiki',coalesce(nullif(trim(p_reason),''),'Bukti pembayaran belum dapat disetujui.'),jsonb_build_object('order_id',v.id,'collective_registration_id',v_collective_registration_id));
      return v;
    end if;
    update public.orders set status='PAID',payment_proof_status='APPROVED',admin_review_note=nullif(trim(p_reason),''),reviewed_at=now(),updated_at=now() where id=v.id returning * into v;
    update public.collective_registrations set status='PAID',updated_at=now() where id=v_collective_registration_id and status='PENDING_PAYMENT';
    perform private.provision_collective_registration(v_collective_registration_id);
    insert into public.notifications(user_id,type,title,body,data) values(v.user_id,'ORDER_PAYMENT','Pendaftaran kolektif berhasil','Pembayaran telah diverifikasi dan peserta siap mengakses lomba.',jsonb_build_object('order_id',v.id,'collective_registration_id',v_collective_registration_id));
    return v;
  end if;

  if upper(trim(p_decision))='REJECT' then
    update public.orders set status='CANCELLED',payment_proof_status='REJECTED',admin_review_note=nullif(trim(p_reason),''),reviewed_at=now(),updated_at=now() where id=v.id returning * into v;
    v_voucher_id:=nullif(i.metadata->>'voucher_id','')::uuid;
    if v_voucher_id is not null then
      select * into v_claim from public.organizer_voucher_claims where voucher_id=v_voucher_id and used_order_id=v.id for update;
      if found then
        update public.organizer_voucher_claims set status='CLAIMED',used_at=null,used_order_id=null where id=v_claim.id;
        update public.organizer_vouchers set used_count=greatest(used_count-1,0),used_at=null,is_active=true,updated_at=now() where id=v_voucher_id;
      end if;
    end if;
    insert into public.notifications(user_id,type,title,body,data) values(v.user_id,'ORDER_PAYMENT','Pembayaran perlu diperbaiki',coalesce(nullif(trim(p_reason),''),'Bukti pembayaran belum dapat disetujui.'),jsonb_build_object('order_id',v.id));
    return v;
  end if;

  if i.product_type='EDU_COIN_TOPUP' then
    if coalesce(v_shop_metadata->>'coin_amount','') !~ '^[0-9]+$' then raise exception 'COIN_AMOUNT_INVALID'; end if;
    v_coin_amount := (v_shop_metadata->>'coin_amount')::bigint * i.quantity;
    if v_coin_amount < 1 or v_coin_amount > 100000000 then raise exception 'COIN_AMOUNT_INVALID'; end if;
    insert into public.edu_coin_ledger(user_id,event_type,event_id,amount,reason)
      values(v.user_id,'SHOP_PURCHASE',v.id::text,v_coin_amount,'Pembelian Edu Coin dari Shop: '||i.name)
      on conflict(user_id,event_type,event_id) do nothing
      returning id into v_ledger_id;
    if v_ledger_id is null then raise exception 'COIN_PURCHASE_ALREADY_PROCESSED'; end if;
    update public.profiles set edu_coin=coalesce(edu_coin,0)+v_coin_amount,updated_at=now()
      where id=v.user_id returning edu_coin into v_new_balance;
    if not found then raise exception 'PROFILE_NOT_FOUND'; end if;
    update public.orders set status='PAID',payment_proof_status='APPROVED',admin_review_note=nullif(trim(p_reason),''),reviewed_at=now(),updated_at=now()
      where id=v.id returning * into v;
    perform private.write_audit('commerce.edu_coin_purchase_fulfilled','order',v.id::text,coalesce(nullif(trim(p_reason),''),'Edu Coin credited'),to_jsonb(v_before),to_jsonb(v),null);
    insert into public.notifications(user_id,type,title,body,data)
      values(v.user_id,'ORDER_PAYMENT','Edu Coin berhasil ditambahkan',
        'Sebanyak '||v_coin_amount::text||' Edu Coin sudah masuk ke saldo akunmu.',
        jsonb_build_object('order_id',v.id,'edu_coin_added',v_coin_amount,'edu_coin_balance',v_new_balance));
    return v;
  end if;

  if i.product_type='BADGE' then
    if coalesce(v_shop_metadata->>'badge_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'BADGE_NOT_AVAILABLE'; end if;
    v_badge_id := (v_shop_metadata->>'badge_id')::uuid;
    if exists(select 1 from public.user_badges where user_id=v.user_id and badge_id=v_badge_id) then raise exception 'BADGE_ALREADY_OWNED'; end if;
    insert into public.user_badges(user_id,badge_id,awarded_by,award_source,reason,source_reference,metadata)
      values(v.user_id,v_badge_id,auth.uid(),'SYSTEM','Badge dibeli melalui Shop',v.id::text,
        jsonb_build_object('source','SHOP_PURCHASE','order_id',v.id,'product_id',i.product_ref))
      on conflict(user_id,badge_id) do nothing
      returning id into v_user_badge_id;
    if v_user_badge_id is null then raise exception 'BADGE_ALREADY_OWNED'; end if;
    insert into public.badge_audit_logs(badge_id,target_user_id,actor_user_id,action,reason,metadata)
      values(v_badge_id,v.user_id,auth.uid(),'AWARDED_SHOP_PURCHASE','Badge dibeli melalui Shop',jsonb_build_object('order_id',v.id,'product_id',i.product_ref));
    update public.orders set status='PAID',payment_proof_status='APPROVED',admin_review_note=nullif(trim(p_reason),''),reviewed_at=now(),updated_at=now()
      where id=v.id returning * into v;
    perform private.write_audit('commerce.badge_purchase_fulfilled','order',v.id::text,coalesce(nullif(trim(p_reason),''),'Badge diberikan'),null,to_jsonb(v),null);
    return v;
  end if;

  if i.product_type='CERTIFICATE_SERIALS' then
    if coalesce(v_shop_metadata->>'serial_quantity','') !~ '^[0-9]+$' then raise exception 'SERIAL_QUANTITY_INVALID'; end if;
    v_serial_quantity := (v_shop_metadata->>'serial_quantity')::integer * i.quantity;
    if v_serial_quantity < 1 or v_serial_quantity > 1000 then raise exception 'SERIAL_QUANTITY_INVALID'; end if;
    v_org := nullif(coalesce(i.metadata->>'organizer_id',v_shop_metadata->>'organizer_id',''),'')::uuid;
    if v_org is null or not exists(select 1 from public.organizers where id=v_org and status='ACTIVE') then raise exception 'ORGANIZER_NOT_AVAILABLE'; end if;
    select name into v_org_name from public.organizers where id=v_org;
    v_org_name := regexp_replace(upper(coalesce(v_org_name,'')),'[^A-Z0-9 ]','','g');
    v_org_words := regexp_split_to_array(trim(regexp_replace(v_org_name,'[[:space:]]+',' ','g')),' ');
    v_org_words := array(select w from unnest(v_org_words) as words(w) where w <> '');
    if coalesce(array_length(v_org_words,1),0)=0 then v_org_suffix:='ORG';
    elsif array_length(v_org_words,1)=1 then v_org_suffix:=substr(v_org_words[1],1,1);
    else
      v_org_suffix:='';
      for j in 1..array_length(v_org_words,1) loop v_org_suffix:=v_org_suffix||substr(v_org_words[j],1,1); end loop;
    end if;

    update public.orders set status='PAID',payment_proof_status='APPROVED',admin_review_note=nullif(trim(p_reason),''),reviewed_at=now(),updated_at=now()
      where id=v.id returning * into v;
    for k in 1..v_serial_quantity loop
      loop
        v_middle := '';
        for j in 1..13 loop v_middle := v_middle || substr('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',1+floor(random()*36)::integer,1); end loop;
        v_serial_code := 'SYKA'||v_middle||v_org_suffix;
        v_qr_payload := v_serial_code;
        begin
          insert into public.organizer_serials(organizer_id,serial_code,qr_payload,status,source_order_id)
          values(v_org,v_serial_code,v_qr_payload,'AVAILABLE',v.id)
          returning id into v_serial_id;
          exit;
        exception when unique_violation then null;
        end;
      end loop;
    end loop;
    perform private.write_audit('commerce.certificate_serials_fulfilled','order',v.id::text,
      coalesce(nullif(trim(p_reason),''),'QR / Serial sertifikat ditambahkan'),null,to_jsonb(v),null);
    insert into public.notifications(user_id,type,title,body,data)
      values(v.user_id,'ORDER_PAYMENT','Paket QR / Serial Sertifikat siap',
        v_serial_quantity::text||' QR / Serial sertifikat telah ditambahkan ke organisasi.',
        jsonb_build_object('order_id',v.id,'organizer_id',v_org,'serial_quantity',v_serial_quantity));
    return v;
  end if;

  if i.product_type in ('DIGITAL_ITEM','DONATION') then
    v_before := v;
    update public.orders set status='PAID',payment_proof_status='APPROVED',admin_review_note=nullif(trim(p_reason),''),reviewed_at=now(),updated_at=now()
      where id=v.id returning * into v;
    perform private.write_audit('commerce.order_payment_approved','order',v.id::text,
      coalesce(nullif(trim(p_reason),''),'Shop payment approved'),to_jsonb(v_before),to_jsonb(v),null);
    insert into public.notifications(user_id,type,title,body,data)
      values(v.user_id,case when i.product_type='DONATION' then 'ORDER_PAYMENT' else 'ORDER_PAYMENT' end,
        case when i.product_type='DONATION' then 'Donasi berhasil diverifikasi' else 'Pembayaran produk berhasil' end,
        case when i.product_type='DONATION' then 'Terima kasih atas dukunganmu. Donasi telah diverifikasi oleh tim SYKABELAJAR.'
             else 'Pembayaran telah diverifikasi. Tim SYKABELAJAR akan memproses pesananmu.' end,
        jsonb_build_object('order_id',v.id,'product_type',i.product_type,'product_ref',i.product_ref,'product_name',i.name));
    return v;
  end if;

  if i.product_type in ('FEATURE_UNLOCK') then raise exception 'PRODUCT_FULFILLMENT_NOT_CONFIGURED'; end if;
  -- Preserve organizer subscription fulfillment and voucher management.
  v_plan:=i.metadata->>'plan_code';
  v_period:=i.metadata->>'billing_period';
  v_org:=nullif(i.metadata->>'organizer_id','')::uuid;
  v_voucher_id:=nullif(i.metadata->>'voucher_id','')::uuid;
  if v_org is null or v_plan is null then raise exception 'INVALID_ORGANIZER_PLAN_ORDER'; end if;
  if v_voucher_id is not null then
    select * into v_voucher from public.organizer_vouchers where id=v_voucher_id for update;
    if not found or not v_voucher.is_active or v_voucher.used_count>=v_voucher.max_uses then raise exception 'VOUCHER_EXHAUSTED'; end if;
    if v_voucher.benefit_type='FREE_PLAN' and upper(coalesce(v_voucher.free_plan_code,''))<>upper(coalesce(v_plan,'')) then raise exception 'VOUCHER_FREE_PLAN_MISMATCH'; end if;
  end if;
  update public.orders set status='PAID',payment_proof_status='APPROVED',admin_review_note=nullif(trim(p_reason),''),reviewed_at=now(),updated_at=now()
    where id=v.id returning * into v;
  update public.organizer_plans set is_active=false where organizer_id=v_org and is_active=true;
  insert into public.organizer_plans(organizer_id,plan_code,starts_at,ends_at,is_active)
    values(v_org,v_plan,now(),case when v_period='MONTHLY' then now()+interval '1 month' when v_period='YEARLY' then now()+interval '1 year' else null end,true);
  if v_voucher_id is not null then
    select * into v_claim from public.organizer_voucher_claims where voucher_id=v_voucher_id and organizer_id=v_org and status in ('CLAIMED','USED') for update;
    if found then
      if v_claim.status='CLAIMED' then
        update public.organizer_voucher_claims set status='USED',used_at=now(),used_order_id=v.id where id=v_claim.id;
        update public.organizer_vouchers set used_count=used_count+1,used_at=now(),is_active=((used_count+1)<max_uses),updated_at=now() where id=v_voucher_id;
      end if;
    else
      insert into public.organizer_voucher_claims(voucher_id,organizer_id,claimed_by,status,claimed_at,used_at,used_order_id)
        values(v_voucher_id,v_org,v.user_id,'USED',now(),now(),v.id);
      update public.organizer_vouchers set claim_count=claim_count+1,used_count=used_count+1,used_at=now(),is_active=((used_count+1)<max_uses),updated_at=now()
        where id=v_voucher_id;
    end if;
  end if;
  insert into public.notifications(user_id,type,title,body,data)
    values(v.user_id,'ORDER_PAYMENT','Pembayaran berhasil','Pembayaran telah diverifikasi. Paket organizer Anda sekarang aktif.',jsonb_build_object('order_id',v.id,'plan_code',v_plan));
  return v;
end;
$$;

revoke execute on function public.admin_review_manual_order(uuid,text,text) from public, anon;
grant execute on function public.admin_review_manual_order(uuid,text,text) to authenticated;

create or replace function public.generate_organizer_serials(p_organizer_id uuid,p_quantity integer)
returns table(id uuid,serial_code text,qr_payload text,status text)
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_plan text; v_limit numeric; v_used bigint; v_qty integer:=greatest(coalesce(p_quantity,0),0);
  v_id uuid; v_serial_code text; v_qr_payload text; v_status text; v_org_name text;
  v_org_words text[]; v_org_suffix text; v_middle text; v_health jsonb; v_health_status text;
  i integer; j integer;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not (private.current_user_is_admin() or private.current_user_can_manage_organizer(p_organizer_id)) then raise exception 'ACCESS_DENIED'; end if;
  if v_qty < 1 or v_qty > 100 then raise exception 'INVALID_QUANTITY'; end if;
  select gs.value into v_health from public.global_settings gs where gs.key='__rpc_health:generate_organizer_serials';
  v_health_status:=v_health->>'status';
  if v_health_status='BLOCKED' then raise exception 'RPC_BLOCKED:generate_organizer_serials'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organizer_id::text||':serials',0));
  select e.plan_code into v_plan from private.get_effective_organizer_plan(p_organizer_id) e;
  if v_plan is null then raise exception 'PLAN_EXPIRED'; end if;
  select pe.limit_value into v_limit from public.plan_entitlements pe where pe.plan_code=v_plan and pe.capability='certificate_serials';
  if v_limit is null or v_limit <= 0 then raise exception 'PLAN_ENTITLEMENT_REQUIRED'; end if;
  select count(*) into v_used from public.organizer_serials os
    where os.organizer_id=p_organizer_id and os.source_order_id is null
      and exists(select 1 from public.organizer_plans op where op.organizer_id=p_organizer_id and op.plan_code=v_plan
        and op.is_active=true and os.created_at>=op.starts_at and (op.ends_at is null or os.created_at<op.ends_at));
  if v_used+v_qty>v_limit and not private.current_user_is_admin() then raise exception 'SERIAL_QUOTA_EXCEEDED'; end if;
  select o.name into v_org_name from public.organizers o where o.id=p_organizer_id;
  v_org_name:=regexp_replace(upper(coalesce(v_org_name,'')),'[^A-Z0-9 ]','','g');
  v_org_words:=regexp_split_to_array(trim(regexp_replace(v_org_name,'[[:space:]]+',' ','g')),' ');
  v_org_words:=array(select w from unnest(v_org_words) as words(w) where w<>'');
  if coalesce(array_length(v_org_words,1),0)=0 then v_org_suffix:='ORG';
  elsif array_length(v_org_words,1)=1 then v_org_suffix:=substr(v_org_words[1],1,1);
  else v_org_suffix:=''; for j in 1..array_length(v_org_words,1) loop v_org_suffix:=v_org_suffix||substr(v_org_words[j],1,1); end loop; end if;
  for i in 1..v_qty loop
    loop
      v_middle:=''; for j in 1..13 loop v_middle:=v_middle||substr('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',1+floor(random()*36)::integer,1); end loop;
      v_serial_code:='SYKA'||v_middle||v_org_suffix;
      begin
        insert into public.organizer_serials as os(organizer_id,serial_code,qr_payload,status,source_order_id)
        values(p_organizer_id,v_serial_code,v_serial_code,'AVAILABLE',null)
        returning os.id,os.serial_code,os.qr_payload,os.status into v_id,v_serial_code,v_qr_payload,v_status;
        exit;
      exception when unique_violation then null;
      end;
    end loop;
    id:=v_id;serial_code:=v_serial_code;qr_payload:=v_qr_payload;status:=v_status;return next;
  end loop;
end;
$$;

create or replace function public.assign_organizer_serial(p_serial_id uuid,p_certificate_id uuid)
returns public.organizer_serials
language plpgsql
security definer
set search_path = public, private
as $$
declare v_serial public.organizer_serials; v_cert public.certificates; v_org uuid; v_code text;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into v_serial from public.organizer_serials where id=p_serial_id for update;
  if not found then raise exception 'SERIAL_NOT_FOUND'; end if;
  select * into v_cert from public.certificates where id=p_certificate_id;
  if not found then raise exception 'CERTIFICATE_NOT_FOUND'; end if;
  select organizer_id into v_org from public.competitions where id=v_cert.competition_id;
  if v_org is null or v_org<>v_serial.organizer_id then raise exception 'SERIAL_CERTIFICATE_ORGANIZER_MISMATCH'; end if;
  if not (private.current_user_is_admin() or private.current_user_can_manage_organizer(v_org)) then raise exception 'ACCESS_DENIED'; end if;
  if v_serial.source_order_id is not null then
    if not exists(select 1 from public.orders where id=v_serial.source_order_id and status='PAID') then raise exception 'SERIAL_PURCHASE_NOT_PAID'; end if;
  else
    perform private.require_organizer_entitlement(v_org,'certificate_serials');
  end if;
  if v_serial.status<>'AVAILABLE' then raise exception 'SERIAL_UNAVAILABLE'; end if;
  select verification_code into v_code from public.certificate_verifications where certificate_id=p_certificate_id order by issued_at desc nulls last limit 1;
  if v_code is null then raise exception 'CERTIFICATE_VERIFICATION_NOT_FOUND'; end if;
  update public.organizer_serials set status='ASSIGNED',certificate_id=p_certificate_id,assigned_at=now(),qr_payload='/verify/'||v_code where id=p_serial_id returning * into v_serial;
  update public.certificates set serial_number=v_serial.serial_code,updated_at=now() where id=p_certificate_id;
  return v_serial;
end;
$$;

revoke execute on function public.generate_organizer_serials(uuid,integer) from public, anon;
grant execute on function public.generate_organizer_serials(uuid,integer) to authenticated;
revoke execute on function public.assign_organizer_serial(uuid,uuid) from public, anon;
grant execute on function public.assign_organizer_serial(uuid,uuid) to authenticated;

