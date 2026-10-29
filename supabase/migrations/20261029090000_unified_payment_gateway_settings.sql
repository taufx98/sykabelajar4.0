-- Unified platform payment gateway configuration.
-- Provider secrets are written/read only by Supabase Edge Functions using service_role.
-- Never store gateway credentials in public-readable global_settings/platform_settings.

create table if not exists public.payment_gateway_configs (
  provider text primary key check (provider in ('MIDTRANS', 'XENITHPAY')),
  is_enabled boolean not null default false,
  environment text not null default 'sandbox' check (environment in ('sandbox', 'production')),
  public_config jsonb not null default '{}'::jsonb,
  secret_config jsonb not null default '{}'::jsonb,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.payment_gateway_configs is
  'Server-only payment gateway configuration. Do not grant anon/authenticated access; secrets are managed through payment-gateway-admin Edge Function.';
comment on column public.payment_gateway_configs.secret_config is
  'Server-only JSON credentials, grouped by sandbox/production. Never expose via a browser-facing SELECT or return the values from an Edge Function.';

alter table public.payment_gateway_configs enable row level security;
revoke all on table public.payment_gateway_configs from public, anon, authenticated;
grant all on table public.payment_gateway_configs to service_role;

create table if not exists public.payment_gateway_state (
  id boolean primary key default true check (id = true),
  active_provider text not null default 'MIDTRANS' check (active_provider in ('MANUAL', 'MIDTRANS', 'XENITHPAY')),
  automatic_payments_enabled boolean not null default true,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.payment_gateway_state is
  'Single global source of truth for the active checkout payment provider. Read/write only by server-side Edge Functions.';

alter table public.payment_gateway_state enable row level security;
revoke all on table public.payment_gateway_state from public, anon, authenticated;
grant all on table public.payment_gateway_state to service_role;

insert into public.payment_gateway_state (id, active_provider, automatic_payments_enabled)
values (true, 'MIDTRANS', true)
on conflict (id) do nothing;


-- Stable system method used by checkout to represent the currently selected global gateway.
-- The method contains no credentials; real provider selection happens server-side.
create unique index if not exists organizer_payment_methods_global_gateway_unique
  on public.organizer_payment_methods ((details ->> 'global_gateway'))
  where details ->> 'global_gateway' = 'true';

insert into public.organizer_payment_methods (name, payment_type, details, is_active, sort_order)
select
  'Pembayaran Otomatis (Gateway Global)',
  'SNAP',
  jsonb_build_object(
    'global_gateway', true,
    'instructions', 'Pembayaran diproses melalui payment gateway aktif yang diatur admin.'
  ),
  true,
  0
where not exists (
  select 1 from public.organizer_payment_methods
  where details ->> 'global_gateway' = 'true'
);


-- Server-only verified-payment finalizer. It reuses the existing order fulfillment branches
-- so a paid callback provisions the purchased product, not just the order status.
CREATE OR REPLACE FUNCTION public.process_payment_gateway_success(p_order_id uuid, p_provider text, p_payment_intent_id uuid)
 RETURNS orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_catalog'
AS $function$
declare
  v public.orders;
  v_intent public.payment_intents;
  p_decision text := 'APPROVE';
  p_reason text;
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
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then raise exception 'SERVICE_ROLE_REQUIRED'; end if;
  if upper(trim(p_provider)) not in ('MIDTRANS','XENITHPAY') then raise exception 'INVALID_PAYMENT_PROVIDER'; end if;
  p_reason := 'Gateway verified: ' || upper(trim(p_provider));
  select * into v from public.orders where id=p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  select * into v_intent from public.payment_intents where id=p_payment_intent_id and order_id=p_order_id for update;
  if not found then raise exception 'PAYMENT_INTENT_NOT_FOUND'; end if;
  if upper(trim(v_intent.provider)) <> upper(trim(p_provider)) then raise exception 'PAYMENT_PROVIDER_MISMATCH'; end if;
  if round(coalesce(v_intent.amount,0),2) <> round(coalesce(v.total,0),2) then raise exception 'PAYMENT_AMOUNT_MISMATCH'; end if;
  if v.status='PAID' and upper(v_intent.status)='PAID' then return v; end if;
  if v.status<>'PENDING_PAYMENT' then raise exception 'ORDER_NOT_REVIEWABLE:%',v.status; end if;
  if upper(v_intent.status) not in ('PENDING','PROCESSING') then raise exception 'PAYMENT_INTENT_NOT_PENDING:%',v_intent.status; end if;
  update public.payment_intents set status='PAID',updated_at=now() where id=v_intent.id;
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
      values(v.user_id,v_badge_id,null,'SYSTEM','Badge dibeli melalui Shop',v.id::text,
        jsonb_build_object('source','SHOP_PURCHASE','order_id',v.id,'product_id',i.product_ref))
      on conflict(user_id,badge_id) do nothing
      returning id into v_user_badge_id;
    if v_user_badge_id is null then raise exception 'BADGE_ALREADY_OWNED'; end if;
    insert into public.badge_audit_logs(badge_id,target_user_id,actor_user_id,action,reason,metadata)
      values(v_badge_id,v.user_id,null,'AWARDED_SHOP_PURCHASE','Badge dibeli melalui Shop',jsonb_build_object('order_id',v.id,'product_id',i.product_ref));
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
      values(v.user_id,'ORDER_PAYMENT',
        case
          when i.product_type='DONATION' then 'Donasi berhasil diverifikasi'
          when i.product_ref='COLLECTIVE_CERTIFICATE' then 'Sertifikat peserta telah diterbitkan'
          else 'Pembayaran produk berhasil'
        end,
        case
          when i.product_type='DONATION' then 'Terima kasih atas dukunganmu. Donasi telah diverifikasi oleh tim SYKABELAJAR.'
          when i.product_ref='COLLECTIVE_CERTIFICATE' then 'Pembayaran disetujui dan sertifikat peserta kolektif telah diterbitkan. Lihat sertifikat pada menu peserta kolektif.'
          else 'Pembayaran telah diverifikasi. Tim SYKABELAJAR akan memproses pesananmu.'
        end,
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
$function$;

revoke all on function public.process_payment_gateway_success(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.process_payment_gateway_success(uuid, text, uuid) to service_role;


-- Allow Shop orders and collective certificate orders to use the same global gateway.
-- Manual payment proof behavior remains unchanged for all existing method codes.
CREATE OR REPLACE FUNCTION public.create_product_order_with_proof(p_product_id uuid, p_quantity integer DEFAULT 1, p_whatsapp text DEFAULT NULL::text, p_payment_method text DEFAULT 'MANUAL_TRANSFER'::text, p_proof_url text DEFAULT NULL::text, p_proof_public_id text DEFAULT NULL::text, p_proof_width integer DEFAULT NULL::integer, p_proof_height integer DEFAULT NULL::integer, p_proof_version text DEFAULT NULL::text, p_proof_resource_type text DEFAULT NULL::text, p_target_organizer_id uuid DEFAULT NULL::uuid)
 RETURNS orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_product public.commerce_products;
  v_order public.orders;
  v_qty integer := p_quantity;
  v_total numeric(14,2);
  v_payment_method text := upper(trim(coalesce(p_payment_method,'BANK_TRANSFER')));
  v_proof_url text := nullif(trim(coalesce(p_proof_url,'')),'');
  v_metadata jsonb;
  v_badge_id uuid;
  v_global_method public.organizer_payment_methods%rowtype;
  v_is_global_gateway boolean := upper(trim(coalesce(p_payment_method,'')))='GATEWAY_GLOBAL';
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if v_qty is null or v_qty < 1 or v_qty > 100 then raise exception 'INVALID_QUANTITY'; end if;
  if nullif(trim(coalesce(p_whatsapp,'')),'') is null then raise exception 'WHATSAPP_REQUIRED'; end if;
  if v_is_global_gateway then
    select * into v_global_method from public.organizer_payment_methods where is_active=true and details->>'global_gateway'='true' limit 1;
    if not found then raise exception 'GLOBAL_PAYMENT_METHOD_NOT_CONFIGURED'; end if;
    v_proof_url := null;
  else
    if v_payment_method not in ('BANK_TRANSFER','MANUAL_TRANSFER','QRIS','EWALLET') then raise exception 'INVALID_PAYMENT_METHOD'; end if;
    if v_proof_url is null or v_proof_url !~* '^https?://' then raise exception 'PAYMENT_PROOF_REQUIRED'; end if;
  end if;

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
    payment_method,payment_provider,payment_method_id,payment_proof_url,payment_proof_public_id,payment_proof_width,payment_proof_height,
    payment_proof_version,payment_proof_resource_type,payment_proof_status
  ) values (
    auth.uid(),'PENDING_PAYMENT',v_total,0,0,v_total,v_product.currency,trim(p_whatsapp),
    case when v_is_global_gateway then v_global_method.name else v_payment_method end,
    case when v_is_global_gateway then 'GLOBAL' else 'MANUAL_TRANSFER' end,
    case when v_is_global_gateway then v_global_method.id else null end,
    v_proof_url,p_proof_public_id,p_proof_width,p_proof_height,
    p_proof_version,p_proof_resource_type,case when v_is_global_gateway then 'NOT_SUBMITTED' else 'SUBMITTED' end
  ) returning * into v_order;

  insert into public.order_items(order_id,product_type,product_ref,name,quantity,unit_price,line_total,metadata)
  values(v_order.id,v_product.product_type,v_product.id::text,v_product.name,v_qty,v_product.price,v_total,v_metadata);

  perform private.write_audit('commerce.order_created','order',v_order.id::text,'SYKABELAJAR Shop checkout',null,to_jsonb(v_order),null);
  return v_order;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_collective_certificate_order_with_proof(p_certificate_id uuid, p_payment_method text, p_proof_url text, p_proof_public_id text DEFAULT NULL::text, p_proof_width integer DEFAULT NULL::integer, p_proof_height integer DEFAULT NULL::integer, p_proof_version text DEFAULT NULL::text, p_proof_resource_type text DEFAULT NULL::text, p_whatsapp text DEFAULT NULL::text)
 RETURNS orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_cert public.collective_certificates%rowtype;
  v_cp public.collective_participants%rowtype;
  v_order public.orders%rowtype;
  v_price numeric := public.get_collective_certificate_price();
  v_method text := upper(trim(coalesce(p_payment_method,'BANK_TRANSFER')));
  v_proof text := nullif(trim(coalesce(p_proof_url,'')),'');
  v_global_method public.organizer_payment_methods%rowtype;
  v_is_global_gateway boolean := upper(trim(coalesce(p_payment_method,'')))='GATEWAY_GLOBAL';
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists(select 1 from public.commerce_products p where p.is_active=true and p.product_type='COLLECTIVE_CERTIFICATE' and 'teacher'=any(p.audiences)) then raise exception 'CERTIFICATE_SHOP_NOT_AVAILABLE'; end if;
  if v_price <= 0 then raise exception 'CERTIFICATE_PRICE_NOT_CONFIGURED'; end if;
  if v_is_global_gateway then
    select * into v_global_method from public.organizer_payment_methods where is_active=true and details->>'global_gateway'='true' limit 1;
    if not found then raise exception 'GLOBAL_PAYMENT_METHOD_NOT_CONFIGURED'; end if;
    v_proof := null;
  else
    if v_method not in ('BANK_TRANSFER','MANUAL_TRANSFER','QRIS','EWALLET') then raise exception 'INVALID_PAYMENT_METHOD'; end if;
    if v_proof is null or v_proof !~* '^https?://' then raise exception 'PAYMENT_PROOF_REQUIRED'; end if;
  end if;

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
      status='PENDING_PAYMENT',payment_method=case when v_is_global_gateway then v_global_method.name else v_method end,
      payment_provider=case when v_is_global_gateway then 'GLOBAL' else v_method end,
      payment_method_id=case when v_is_global_gateway then v_global_method.id else null end,
      payment_proof_url=v_proof,payment_proof_public_id=p_proof_public_id,
      payment_proof_width=p_proof_width,payment_proof_height=p_proof_height,
      payment_proof_version=p_proof_version,payment_proof_resource_type=p_proof_resource_type,
      payment_proof_status=case when v_is_global_gateway then 'NOT_SUBMITTED' else 'SUBMITTED' end,contact_whatsapp=nullif(trim(coalesce(p_whatsapp,'')),''),
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
    payment_proof_resource_type,payment_proof_status,payment_method_id
  ) values (
    v_uid,'PENDING_PAYMENT',v_price,0,0,v_price,'IDR',case when v_is_global_gateway then v_global_method.name else v_method end,
    case when v_is_global_gateway then 'GLOBAL' else v_method end,
    v_cp.full_name,null,'Sertifikat peserta kolektif',jsonb_build_object('collective_certificate_id',v_cert.id,'participant_code',v_cp.participant_code),
    nullif(trim(coalesce(p_whatsapp,'')),''),v_proof,p_proof_public_id,p_proof_width,p_proof_height,
    p_proof_version,p_proof_resource_type,case when v_is_global_gateway then 'NOT_SUBMITTED' else 'SUBMITTED' end,
    case when v_is_global_gateway then v_global_method.id else null end
  ) returning * into v_order;

  insert into public.order_items(order_id,product_type,product_ref,name,quantity,unit_price,line_total,metadata)
  values(v_order.id,'DIGITAL_ITEM','COLLECTIVE_CERTIFICATE','Sertifikat Peserta — '||v_cp.full_name,1,v_price,v_price,
    jsonb_build_object('collective_certificate_id',v_cert.id,'participant_id',v_cp.id,'shop_checkout',true));

  insert into public.collective_certificate_orders(collective_certificate_id,order_id,payer_user_id,amount,status)
  values(v_cert.id,v_order.id,v_uid,v_price,'PENDING')
  on conflict (collective_certificate_id) do update set
    order_id=excluded.order_id,
    payer_user_id=excluded.payer_user_id,
    amount=excluded.amount,
    status='PENDING',
    updated_at=now();
  return v_order;
end;
$function$;

-- Bring the original Guru workspace certificate-order flow onto the global gateway.
CREATE OR REPLACE FUNCTION public.create_collective_certificate_order(p_certificate_id uuid)
 RETURNS orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_cert public.collective_certificates%rowtype;
  v_cp public.collective_participants%rowtype;
  v_order public.orders%rowtype;
  v_price numeric := public.get_collective_certificate_price();
  v_gateway_method public.organizer_payment_methods%rowtype;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if v_price <= 0 then raise exception 'CERTIFICATE_PRICE_NOT_CONFIGURED'; end if;
  if not exists(select 1 from public.payment_gateway_state s where s.id=true and s.automatic_payments_enabled=true and s.active_provider in ('MIDTRANS','XENITHPAY')) then raise exception 'GLOBAL_GATEWAY_NOT_ACTIVE'; end if;
  select * into v_gateway_method from public.organizer_payment_methods where is_active=true and details->>'global_gateway'='true' limit 1;
  if not found then raise exception 'GLOBAL_PAYMENT_METHOD_NOT_CONFIGURED'; end if;
  select * into v_cert from public.collective_certificates where id=p_certificate_id for update;
  if not found then raise exception 'CERTIFICATE_NOT_FOUND'; end if;
  if v_cert.status not in ('ELIGIBLE','DRAFT') then raise exception 'CERTIFICATE_NOT_ORDERABLE'; end if;
  select * into v_cp from public.collective_participants where id=v_cert.collective_participant_id;
  if not found then raise exception 'PARTICIPANT_NOT_FOUND'; end if;
  if not (v_cp.managed_by_user_id=v_uid or v_cp.user_id=v_uid or exists(select 1 from public.user_roles ur where ur.user_id=v_uid and ur.role='admin' and ur.is_active=true)) then raise exception 'FORBIDDEN'; end if;
  select o.* into v_order
    from public.collective_certificate_orders cco
    join public.orders o on o.id=cco.order_id
    where cco.collective_certificate_id=v_cert.id
      and o.status not in ('CANCELLED','REFUNDED')
    order by o.created_at desc limit 1
    for update of o;
  if found then
    if v_order.status='PAID' then return v_order; end if;
    if v_order.status='PENDING_PAYMENT' and v_order.payment_method_id is null then
      if exists(select 1 from public.payment_intents pi where pi.order_id=v_order.id) then
        raise exception 'PAYMENT_SESSION_ALREADY_EXISTS';
      end if;
      update public.orders
        set payment_method=v_gateway_method.name,
            payment_provider='GLOBAL',
            payment_method_id=v_gateway_method.id,
            payment_proof_url=null,
            payment_proof_status='NOT_SUBMITTED',
            updated_at=now()
        where id=v_order.id
        returning * into v_order;
      return v_order;
    end if;
    if v_order.payment_method_id=v_gateway_method.id then return v_order; end if;
    raise exception 'PAYMENT_METHOD_LOCKED';
  end if;
  insert into public.orders(user_id,status,subtotal,discount,shipping_cost,total,currency,payment_method,payment_provider,payment_method_id,contact_name,contact_email,contact_note,contact_fields,payment_proof_status)
  values(v_uid,'PENDING_PAYMENT',v_price,0,0,v_price,'IDR',v_gateway_method.name,'GLOBAL',v_gateway_method.id,v_cp.full_name,null,'Kolektif certificate: '||v_cp.participant_code,jsonb_build_object('collective_certificate_id',v_cert.id,'participant_code',v_cp.participant_code),'NOT_SUBMITTED')
  returning * into v_order;
  insert into public.order_items(order_id,product_type,product_ref,name,quantity,unit_price,line_total,metadata)
  values(v_order.id,'DIGITAL_ITEM','COLLECTIVE_CERTIFICATE','Sertifikat Peserta Kolektif — '||v_cp.full_name,1,v_price,v_price,jsonb_build_object('collective_certificate_id',v_cert.id,'participant_id',v_cp.id));
  insert into public.collective_certificate_orders(collective_certificate_id,order_id,payer_user_id,amount,status)
  values(v_cert.id,v_order.id,v_uid,v_price,'PENDING')
  on conflict (collective_certificate_id) do update set
    order_id=excluded.order_id,
    payer_user_id=excluded.payer_user_id,
    amount=excluded.amount,
    status='PENDING',
    updated_at=now();
  update public.collective_certificates set status='ELIGIBLE',updated_at=now() where id=v_cert.id;
  return v_order;
end;
$function$;


-- Keep the payment_provider marker aligned with the selected global method before session creation.
CREATE OR REPLACE FUNCTION public.create_collective_registration_order(p_competition_id uuid, p_roster_student_ids uuid[], p_competition_level_id uuid, p_certificate_policy text, p_school_id uuid, p_school_name text, p_contact_name text, p_contact_whatsapp text, p_payment_method_id uuid, p_proof_url text, p_proof_public_id text, p_proof_width integer, p_proof_height integer, p_proof_version text, p_proof_resource_type text, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$ declare v_uid uuid:=auth.uid(); v_existing public.collective_registrations%rowtype; v_quote jsonb; v_comp public.competitions%rowtype; v_method public.organizer_payment_methods%rowtype; v_reg public.collective_registrations%rowtype; v_order public.orders%rowtype; v_status public.order_status; v_proof_status text; v_payment_method text; begin if v_uid is null then raise exception 'AUTH_REQUIRED'; end if; if p_idempotency_key is null then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if; select * into v_existing from public.collective_registrations where teacher_user_id=v_uid and idempotency_key=p_idempotency_key limit 1; if found then select * into v_order from public.orders where id=v_existing.order_id; return jsonb_build_object('registration_id',v_existing.id,'order_id',v_existing.order_id,'status',v_existing.status,'amount',v_existing.amount,'currency',v_existing.currency,'student_count',v_existing.student_count,'certificate_policy',v_existing.certificate_policy,'order_status',v_order.status,'idempotent',true); end if; perform pg_advisory_xact_lock(hashtextextended(v_uid::text||':'||p_competition_id::text||':collective_registration',0)); select * into v_existing from public.collective_registrations where teacher_user_id=v_uid and idempotency_key=p_idempotency_key limit 1; if found then select * into v_order from public.orders where id=v_existing.order_id; return jsonb_build_object('registration_id',v_existing.id,'order_id',v_existing.order_id,'status',v_existing.status,'amount',v_existing.amount,'currency',v_existing.currency,'student_count',v_existing.student_count,'certificate_policy',v_existing.certificate_policy,'order_status',v_order.status,'idempotent',true); end if; select * into v_comp from public.competitions c where c.id=p_competition_id; if not found then raise exception 'COMPETITION_NOT_FOUND'; end if; v_quote:=public.quote_collective_registration(p_competition_id,p_roster_student_ids,p_certificate_policy); if p_competition_level_id is not null and not exists(select 1 from public.competition_levels cl where cl.id=p_competition_level_id and cl.competition_id=p_competition_id) then raise exception 'INVALID_COMPETITION_LEVEL'; end if; if (v_quote->>'total')::numeric>0 then select * into v_method from public.organizer_payment_methods m where m.id=p_payment_method_id and m.is_active=true; if not found then raise exception 'PAYMENT_METHOD_REQUIRED'; end if; end if; v_payment_method:=coalesce(v_method.name,case when (v_quote->>'total')::numeric=0 then 'FREE' else 'MANUAL_TRANSFER' end); v_status:=case when (v_quote->>'total')::numeric=0 then 'PAID'::public.order_status else 'PENDING_PAYMENT'::public.order_status end; v_proof_status:=case when nullif(trim(coalesce(p_proof_url,'')),'') is null then 'NOT_SUBMITTED' else 'SUBMITTED' end; insert into public.collective_registrations(competition_id,teacher_user_id,school_id,school_name,competition_level_id,certificate_policy,roster_student_ids,student_count,status,amount,currency,idempotency_key,payment_method_id,metadata) values(p_competition_id,v_uid,p_school_id,nullif(trim(p_school_name),''),p_competition_level_id,p_certificate_policy,coalesce(p_roster_student_ids,'{}'::uuid[]),(v_quote->>'student_count')::integer,case when v_status='PAID' then 'PAID' else 'PENDING_PAYMENT' end,(v_quote->>'total')::numeric,coalesce(v_quote->>'currency','IDR'),p_idempotency_key,p_payment_method_id,jsonb_build_object('source','guru_collective_registration','competition_id',p_competition_id,'teacher_user_id',v_uid,'certificate_policy',p_certificate_policy)); select * into v_reg from public.collective_registrations where teacher_user_id=v_uid and idempotency_key=p_idempotency_key; insert into public.orders(user_id,status,subtotal,discount,shipping_cost,total,currency,contact_whatsapp,payment_method,payment_provider,payment_proof_url,payment_proof_public_id,payment_proof_width,payment_proof_height,payment_proof_version,payment_proof_resource_type,payment_proof_status,contact_name,contact_email,contact_note,contact_fields,payment_method_id) values(v_uid,v_status,(v_quote->>'subtotal')::numeric,0,0,(v_quote->>'total')::numeric,coalesce(v_quote->>'currency','IDR'),nullif(trim(p_contact_whatsapp),''),v_payment_method,case when v_status='PAID' then 'FREE' when coalesce(v_method.details->>'global_gateway','false')='true' then 'GLOBAL' else 'MANUAL' end,nullif(trim(p_proof_url),''),nullif(trim(p_proof_public_id),''),p_proof_width,p_proof_height,p_proof_version,p_proof_resource_type,v_proof_status,nullif(trim(p_contact_name),''),null,null,jsonb_build_object('collective_registration_id',v_reg.id,'competition_id',p_competition_id,'teacher_user_id',v_uid,'certificate_policy',p_certificate_policy,'roster_student_ids',to_jsonb(coalesce(p_roster_student_ids,'{}'::uuid[]))),p_payment_method_id) returning * into v_order; insert into public.order_items(order_id,product_type,product_ref,name,quantity,unit_price,line_total,metadata) values(v_order.id,'COLLECTIVE_REGISTRATION',p_competition_id,'Pendaftaran Kolektif — '||v_comp.title,(v_quote->>'student_count')::integer,(v_quote->>'unit_price')::numeric,(v_quote->>'total')::numeric,jsonb_build_object('collective_registration_id',v_reg.id,'competition_id',p_competition_id,'teacher_user_id',v_uid,'roster_student_ids',to_jsonb(coalesce(p_roster_student_ids,'{}'::uuid[])),'competition_level_id',p_competition_level_id,'certificate_policy',p_certificate_policy)); update public.collective_registrations set order_id=v_order.id,updated_at=now() where id=v_reg.id returning * into v_reg; return jsonb_build_object('registration_id',v_reg.id,'order_id',v_order.id,'status',v_reg.status,'amount',v_order.total,'currency',v_order.currency,'student_count',v_reg.student_count,'certificate_policy',v_reg.certificate_policy,'order_status',v_order.status,'payment_method',v_order.payment_method,'idempotent',false); end; $function$
;
