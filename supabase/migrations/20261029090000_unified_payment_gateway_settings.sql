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
      values(v.user_id,v_badge_id,v.user_id,'SYSTEM','Badge dibeli melalui Shop',v.id::text,
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
$function$


revoke all on function public.process_payment_gateway_success(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.process_payment_gateway_success(uuid, text, uuid) to service_role;
