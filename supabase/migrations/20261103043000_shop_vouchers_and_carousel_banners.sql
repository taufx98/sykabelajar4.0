-- Shop promotions: per-user vouchers, secure checkout pricing, and configurable campaign slides.
-- Existing shop_hero_banner settings and payment/checkout RPCs remain the source of truth for their current behavior.

create table if not exists public.shop_voucher_definitions (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 100),
  description text not null default '',
  usage_type text not null check (usage_type in ('DURATION','SINGLE_USE')),
  duration_hours integer,
  benefit_group text not null check (benefit_group in ('PRICE_DISCOUNT','BUY_X_GET_Y','FREE_SHIPPING')),
  benefit_type text not null check (benefit_type in ('PERCENT','FIXED','BUY_X_GET_Y','FREE_SHIPPING')),
  discount_value numeric(14,2) not null default 0,
  discount_currency text not null default 'IDR' check (discount_currency in ('IDR','EDU_COIN')),
  buy_quantity integer not null default 1,
  free_quantity integer not null default 1,
  scope_type text not null default 'ALL' check (scope_type in ('ALL','CATEGORY','PRODUCT')),
  product_ids uuid[] not null default '{}',
  category_ids text[] not null default '{}',
  min_purchase numeric(14,2) not null default 0 check (min_purchase >= 0),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shop_voucher_duration_config_check check (
    (usage_type = 'DURATION' and duration_hours between 1 and 720)
    or (usage_type = 'SINGLE_USE' and duration_hours is null)
  ),
  constraint shop_voucher_benefit_config_check check (
    (benefit_group = 'PRICE_DISCOUNT' and benefit_type in ('PERCENT','FIXED') and discount_value > 0)
    or (benefit_group = 'BUY_X_GET_Y' and benefit_type = 'BUY_X_GET_Y' and buy_quantity between 1 and 100 and free_quantity between 1 and 100)
    or (benefit_group = 'FREE_SHIPPING' and benefit_type = 'FREE_SHIPPING')
  ),
  constraint shop_voucher_scope_config_check check (
    (scope_type = 'ALL')
    or (scope_type = 'CATEGORY' and cardinality(category_ids) > 0)
    or (scope_type = 'PRODUCT' and cardinality(product_ids) > 0)
  ),
  constraint shop_voucher_percent_value_check check (benefit_type <> 'PERCENT' or discount_value <= 100)
);

create index if not exists shop_voucher_definitions_active_idx
  on public.shop_voucher_definitions (is_active, starts_at, ends_at);

create table if not exists public.shop_user_vouchers (
  id uuid primary key default gen_random_uuid(),
  definition_id uuid not null references public.shop_voucher_definitions(id) on delete restrict,
  user_id uuid not null references public.profiles(id) on delete cascade,
  issued_at timestamptz not null default now(),
  activated_at timestamptz,
  active_until timestamptz,
  status text not null default 'READY' check (status in ('READY','ACTIVE','RESERVED','USED','EXPIRED')),
  reserved_order_id uuid references public.orders(id) on delete set null,
  reserved_at timestamptz,
  used_at timestamptz,
  used_order_id uuid references public.orders(id) on delete set null,
  viewed_at timestamptz
);

create index if not exists shop_user_vouchers_user_issued_idx
  on public.shop_user_vouchers (user_id, issued_at desc);
create index if not exists shop_user_vouchers_available_idx
  on public.shop_user_vouchers (user_id, status, active_until);

alter table public.shop_user_vouchers
  add column if not exists source_order_item_id uuid references public.order_items(id) on delete set null,
  add column if not exists source_order_item_index integer not null default 0;
create unique index if not exists shop_user_vouchers_purchase_item_unique
  on public.shop_user_vouchers (source_order_item_id,source_order_item_index);

alter table public.shop_voucher_definitions enable row level security;
alter table public.shop_user_vouchers enable row level security;
revoke all on table public.shop_voucher_definitions from public, anon, authenticated;
revoke all on table public.shop_user_vouchers from public, anon, authenticated;

create or replace function private.shop_voucher_scope_matches(
  p_scope_type text,
  p_product_ids uuid[],
  p_category_ids text[],
  p_product_id uuid
) returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_metadata jsonb;
  v_category text;
begin
  if p_scope_type = 'ALL' then return true; end if;
  select coalesce(p.metadata, '{}'::jsonb) into v_metadata
  from public.commerce_products p
  where p.id = p_product_id and p.is_active = true;
  if not found then return false; end if;
  if p_scope_type = 'PRODUCT' then
    return p_product_id = any(coalesce(p_product_ids, '{}'::uuid[]));
  end if;
  v_category := nullif(btrim(coalesce(v_metadata->>'shop_category_id', '')), '');
  return v_category is not null and v_category = any(coalesce(p_category_ids, '{}'::text[]));
end;
$function$;

create or replace function public.admin_list_shop_voucher_definitions()
returns table (
  id uuid, name text, description text, usage_type text, duration_hours integer,
  benefit_group text, benefit_type text, discount_value numeric, discount_currency text,
  buy_quantity integer, free_quantity integer, scope_type text, product_ids uuid[],
  category_ids text[], min_purchase numeric, starts_at timestamptz, ends_at timestamptz,
  is_active boolean, created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if not private.current_user_is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  return query
  select d.id,d.name,d.description,d.usage_type,d.duration_hours,d.benefit_group,d.benefit_type,
    d.discount_value,d.discount_currency,d.buy_quantity,d.free_quantity,d.scope_type,d.product_ids,
    d.category_ids,d.min_purchase,d.starts_at,d.ends_at,d.is_active,d.created_at
  from public.shop_voucher_definitions d
  order by d.created_at desc;
end;
$function$;

create or replace function public.admin_save_shop_voucher_definition(p_definition jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_id uuid := nullif(p_definition->>'id','')::uuid;
  v_name text := btrim(coalesce(p_definition->>'name',''));
  v_usage text := upper(coalesce(p_definition->>'usage_type','SINGLE_USE'));
  v_duration integer := nullif(p_definition->>'duration_hours','')::integer;
  v_group text := upper(coalesce(p_definition->>'benefit_group','PRICE_DISCOUNT'));
  v_type text := upper(coalesce(p_definition->>'benefit_type','PERCENT'));
  v_value numeric := coalesce(nullif(p_definition->>'discount_value','')::numeric,0);
  v_currency text := upper(coalesce(p_definition->>'discount_currency','IDR'));
  v_scope text := upper(coalesce(p_definition->>'scope_type','ALL'));
  v_products uuid[] := '{}';
  v_categories text[] := '{}';
  v_buy integer := coalesce(nullif(p_definition->>'buy_quantity','')::integer,1);
  v_free integer := coalesce(nullif(p_definition->>'free_quantity','')::integer,1);
  v_min numeric := coalesce(nullif(p_definition->>'min_purchase','')::numeric,0);
  v_starts timestamptz := coalesce(nullif(p_definition->>'starts_at','')::timestamptz,now());
  v_ends timestamptz := nullif(p_definition->>'ends_at','')::timestamptz;
  v_active boolean := coalesce((p_definition->>'is_active')::boolean,true);
  v_description text := left(coalesce(p_definition->>'description',''),500);
  v_row public.shop_voucher_definitions%rowtype;
begin
  if not private.current_user_is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if v_name is null or char_length(v_name) < 2 then raise exception 'VOUCHER_NAME_REQUIRED'; end if;
  if v_usage not in ('DURATION','SINGLE_USE') then raise exception 'INVALID_VOUCHER_USAGE'; end if;
  if v_group not in ('PRICE_DISCOUNT','BUY_X_GET_Y','FREE_SHIPPING') then raise exception 'INVALID_VOUCHER_GROUP'; end if;
  if v_type not in ('PERCENT','FIXED','BUY_X_GET_Y','FREE_SHIPPING') then raise exception 'INVALID_VOUCHER_TYPE'; end if;
  if v_currency not in ('IDR','EDU_COIN') then raise exception 'INVALID_VOUCHER_CURRENCY'; end if;
  if v_scope not in ('ALL','CATEGORY','PRODUCT') then raise exception 'INVALID_VOUCHER_SCOPE'; end if;
  if v_ends is not null and v_ends <= v_starts then raise exception 'INVALID_VOUCHER_DATE_RANGE'; end if;
  if v_min < 0 then raise exception 'INVALID_VOUCHER_MINIMUM'; end if;

  if jsonb_typeof(coalesce(p_definition->'product_ids','[]'::jsonb)) = 'array' then
    select coalesce(array_agg(value::uuid), '{}') into v_products
    from jsonb_array_elements_text(coalesce(p_definition->'product_ids','[]'::jsonb)) as x(value)
    where value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  end if;
  if jsonb_typeof(coalesce(p_definition->'category_ids','[]'::jsonb)) = 'array' then
    select coalesce(array_agg(distinct left(btrim(value),64)), '{}') into v_categories
    from jsonb_array_elements_text(coalesce(p_definition->'category_ids','[]'::jsonb)) as x(value)
    where btrim(value) <> '';
  end if;

  if v_usage = 'DURATION' and (v_duration is null or v_duration < 1 or v_duration > 720) then raise exception 'INVALID_VOUCHER_DURATION'; end if;
  if v_usage = 'SINGLE_USE' then v_duration := null; end if;
  if v_group = 'PRICE_DISCOUNT' then
    if v_type not in ('PERCENT','FIXED') or v_value <= 0 or (v_type='PERCENT' and v_value > 100) then raise exception 'INVALID_VOUCHER_DISCOUNT'; end if;
    if v_type='FIXED' and v_currency='EDU_COIN' and v_value <> trunc(v_value) then raise exception 'INVALID_EDU_COIN_VOUCHER_AMOUNT'; end if;
  elsif v_group = 'BUY_X_GET_Y' then
    if v_type <> 'BUY_X_GET_Y' or v_buy not between 1 and 100 or v_free not between 1 and 100 then raise exception 'INVALID_VOUCHER_BOGO'; end if;
    v_value := 0;
  elsif v_group = 'FREE_SHIPPING' then
    if v_type <> 'FREE_SHIPPING' then raise exception 'INVALID_VOUCHER_SHIPPING'; end if;
    v_value := 0;
  end if;
  if v_scope='CATEGORY' and cardinality(v_categories)=0 then raise exception 'VOUCHER_CATEGORY_REQUIRED'; end if;
  if v_scope='PRODUCT' and cardinality(v_products)=0 then raise exception 'VOUCHER_PRODUCT_REQUIRED'; end if;

  if v_id is null then
    insert into public.shop_voucher_definitions(
      name,description,usage_type,duration_hours,benefit_group,benefit_type,discount_value,
      discount_currency,buy_quantity,free_quantity,scope_type,product_ids,category_ids,min_purchase,
      starts_at,ends_at,is_active,created_by,updated_at
    ) values (
      v_name,v_description,v_usage,v_duration,v_group,v_type,v_value,v_currency,v_buy,v_free,
      v_scope,v_products,v_categories,v_min,v_starts,v_ends,v_active,auth.uid(),now()
    ) returning * into v_row;
  else
    update public.shop_voucher_definitions d set
      name=v_name,description=v_description,usage_type=v_usage,duration_hours=v_duration,
      benefit_group=v_group,benefit_type=v_type,discount_value=v_value,discount_currency=v_currency,
      buy_quantity=v_buy,free_quantity=v_free,scope_type=v_scope,product_ids=v_products,
      category_ids=v_categories,min_purchase=v_min,starts_at=v_starts,ends_at=v_ends,
      is_active=v_active,updated_at=now()
    where d.id=v_id returning * into v_row;
    if not found then raise exception 'VOUCHER_DEFINITION_NOT_FOUND'; end if;
  end if;
  return to_jsonb(v_row);
end;
$function$;

create or replace function public.admin_issue_shop_voucher(p_definition_id uuid, p_username text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid;
  v_definition public.shop_voucher_definitions%rowtype;
  v_issue public.shop_user_vouchers%rowtype;
  v_activation timestamptz;
begin
  if not private.current_user_is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if nullif(btrim(coalesce(p_username,'')),'') is null then raise exception 'USERNAME_REQUIRED'; end if;
  select * into v_definition from public.shop_voucher_definitions d
    where d.id=p_definition_id and d.is_active=true;
  if not found then raise exception 'VOUCHER_DEFINITION_NOT_AVAILABLE'; end if;
  select p.id into v_user_id from public.profiles p
    where lower(p.username)=lower(btrim(p_username))
    limit 1;
  if v_user_id is null then raise exception 'VOUCHER_USER_NOT_FOUND'; end if;

  if v_definition.usage_type='DURATION' then
    v_activation := greatest(now(),v_definition.starts_at);
    insert into public.shop_user_vouchers(
      definition_id,user_id,issued_at,activated_at,active_until,status
    ) values (
      v_definition.id,v_user_id,now(),v_activation,
      least(v_activation + make_interval(hours => v_definition.duration_hours),coalesce(v_definition.ends_at,'infinity'::timestamptz)),
      'ACTIVE'
    ) returning * into v_issue;
    if v_issue.active_until <= now() then
      update public.shop_user_vouchers set status='EXPIRED' where id=v_issue.id returning * into v_issue;
    end if;
  else
    insert into public.shop_user_vouchers(definition_id,user_id,issued_at,status)
      values(v_definition.id,v_user_id,now(),'READY') returning * into v_issue;
  end if;
  return jsonb_build_object('id',v_issue.id,'user_id',v_issue.user_id,'definition_id',v_issue.definition_id,'status',v_issue.status);
end;
$function$;

create or replace function public.admin_list_issued_shop_vouchers()
returns table (
  id uuid, username text, voucher_name text, usage_type text, benefit_group text,
  status text, issued_at timestamptz, active_until timestamptz, used_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if not private.current_user_is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  return query
  select uv.id,p.username,d.name,d.usage_type,d.benefit_group,
    case
      when uv.status='USED' then 'USED'
      when uv.status='RESERVED' then 'RESERVED'
      when uv.status='ACTIVE' and uv.active_until <= now() then 'EXPIRED'
      when d.ends_at is not null and d.ends_at <= now() then 'EXPIRED'
      when uv.status='ACTIVE' and uv.activated_at > now() then 'READY'
      when uv.status='ACTIVE' then 'ACTIVE'
      else uv.status
    end,
    uv.issued_at,uv.active_until,uv.used_at
  from public.shop_user_vouchers uv
  join public.profiles p on p.id=uv.user_id
  join public.shop_voucher_definitions d on d.id=uv.definition_id
  order by uv.issued_at desc
  limit 200;
end;
$function$;

create or replace function public.list_my_shop_vouchers()
returns table (
  id uuid, name text, description text, usage_type text, duration_hours integer,
  benefit_group text, benefit_type text, discount_value numeric, discount_currency text,
  scope_type text, starts_at timestamptz, ends_at timestamptz, issued_at timestamptz,
  activated_at timestamptz, active_until timestamptz, status text, viewed_at timestamptz,
  is_new boolean
)
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  return query
  select uv.id,d.name,d.description,d.usage_type,d.duration_hours,d.benefit_group,d.benefit_type,
    d.discount_value,d.discount_currency,d.scope_type,d.starts_at,d.ends_at,uv.issued_at,
    uv.activated_at,uv.active_until,
    case
      when uv.status='USED' then 'USED'
      when uv.status='RESERVED' then 'RESERVED'
      when (uv.status='ACTIVE' and uv.active_until <= now()) or (d.ends_at is not null and d.ends_at <= now()) then 'EXPIRED'
      when uv.status='ACTIVE' and uv.activated_at > now() then 'READY'
      when uv.status='ACTIVE' then 'ACTIVE'
      else uv.status
    end,
    uv.viewed_at,(uv.viewed_at is null)
  from public.shop_user_vouchers uv
  join public.shop_voucher_definitions d on d.id=uv.definition_id
  where uv.user_id=auth.uid()
  order by uv.issued_at desc;
end;
$function$;

create or replace function public.mark_my_shop_vouchers_seen()
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare v_count integer;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  update public.shop_user_vouchers set viewed_at=now()
  where user_id=auth.uid() and viewed_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

create or replace function public.list_shop_checkout_vouchers(
  p_product_id uuid,
  p_quantity integer default 1,
  p_subtotal numeric default 0,
  p_shipping_cost numeric default 0
)
returns table (
  id uuid, name text, description text, usage_type text, benefit_group text,
  benefit_type text, discount_value numeric, discount_currency text,
  status text, eligible boolean, reason text, auto_applied boolean, estimated_discount numeric
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_product public.commerce_products%rowtype;
  v_group_active text[];
  v_auto_ids uuid[] := '{}';
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_quantity is null or p_quantity < 1 or p_quantity > 100 then raise exception 'INVALID_QUANTITY'; end if;
  select * into v_product from public.commerce_products p
    where p.id=p_product_id and p.is_active=true;
  if not found then raise exception 'PRODUCT_NOT_AVAILABLE'; end if;

  select coalesce(array_agg(chosen.id),'{}'::uuid[]) into v_auto_ids
  from (
    select distinct on (d.benefit_group) uv.id, d.benefit_group
    from public.shop_user_vouchers uv
    join public.shop_voucher_definitions d on d.id=uv.definition_id
    where uv.user_id=auth.uid() and d.usage_type='DURATION' and uv.status='ACTIVE'
      and uv.active_until > now() and d.is_active=true
      and (d.ends_at is null or d.ends_at > now())
      and d.starts_at <= now()
      and private.shop_voucher_scope_matches(d.scope_type,d.product_ids,d.category_ids,p_product_id)
      and p_subtotal >= d.min_purchase
      and (d.benefit_type <> 'FIXED' or d.discount_currency=v_product.currency)
      and (d.benefit_type <> 'FREE_SHIPPING' or p_shipping_cost > 0)
      and (d.benefit_type <> 'BUY_X_GET_Y' or p_quantity >= d.buy_quantity+d.free_quantity)
    order by d.benefit_group, uv.issued_at desc, uv.id
  ) chosen;

  select coalesce(array_agg(distinct d.benefit_group),'{}') into v_group_active
  from public.shop_user_vouchers uv
  join public.shop_voucher_definitions d on d.id=uv.definition_id
  where uv.id=any(v_auto_ids);

  return query
  select uv.id,d.name,d.description,d.usage_type,d.benefit_group,d.benefit_type,d.discount_value,d.discount_currency,
    case
      when uv.status='USED' then 'USED'
      when uv.status='RESERVED' then 'RESERVED'
      when (uv.status='ACTIVE' and uv.active_until <= now()) or (d.ends_at is not null and d.ends_at <= now()) then 'EXPIRED'
      when uv.status='ACTIVE' and uv.activated_at > now() then 'READY'
      when uv.status='ACTIVE' then 'ACTIVE'
      else uv.status
    end,
    case
      when not d.is_active then false
      when d.starts_at > now() then false
      when d.ends_at is not null and d.ends_at <= now() then false
      when d.usage_type='DURATION' and (uv.status <> 'ACTIVE' or uv.active_until <= now() or not (uv.id=any(v_auto_ids))) then false
      when d.usage_type='SINGLE_USE' and uv.status <> 'READY' then false
      when not private.shop_voucher_scope_matches(d.scope_type,d.product_ids,d.category_ids,p_product_id) then false
      when p_subtotal < d.min_purchase then false
      when d.benefit_type='FIXED' and d.discount_currency <> v_product.currency then false
      when d.benefit_type='FREE_SHIPPING' and p_shipping_cost <= 0 then false
      when d.benefit_type='BUY_X_GET_Y' and p_quantity < d.buy_quantity+d.free_quantity then false
      when d.usage_type='SINGLE_USE' and d.benefit_group=any(v_group_active) then false
      else true
    end,
    case
      when not d.is_active then 'Voucher tidak lagi tersedia'
      when d.starts_at > now() then 'Voucher belum mulai berlaku'
      when d.ends_at is not null and d.ends_at <= now() then 'Voucher sudah kedaluwarsa'
      when d.usage_type='DURATION' and (uv.status <> 'ACTIVE' or uv.active_until <= now()) then 'Masa aktif voucher sudah habis'
      when d.usage_type='DURATION' and not (uv.id=any(v_auto_ids)) then 'Voucher durasi sejenis sudah aktif'
      when d.usage_type='SINGLE_USE' and uv.status='RESERVED' then 'Voucher sedang dipakai pada pesanan lain'
      when d.usage_type='SINGLE_USE' and uv.status='USED' then 'Voucher sudah digunakan'
      when d.usage_type='SINGLE_USE' and uv.status <> 'READY' then 'Voucher belum tersedia'
      when not private.shop_voucher_scope_matches(d.scope_type,d.product_ids,d.category_ids,p_product_id) then 'Produk ini tidak termasuk ketentuan voucher'
      when p_subtotal < d.min_purchase then 'Belum memenuhi minimum pembelian'
      when d.benefit_type='FIXED' and d.discount_currency <> v_product.currency then 'Mata uang produk tidak sesuai'
      when d.benefit_type='FREE_SHIPPING' and p_shipping_cost <= 0 then 'Produk ini tidak memiliki biaya pengiriman'
      when d.benefit_type='BUY_X_GET_Y' and p_quantity < d.buy_quantity+d.free_quantity then 'Jumlah produk belum memenuhi promo'
      when d.usage_type='SINGLE_USE' and d.benefit_group=any(v_group_active) then 'Manfaat sejenis sudah diterapkan otomatis'
      else 'Dapat digunakan'
    end,
    d.usage_type='DURATION' and uv.id=any(v_auto_ids)
      and uv.status='ACTIVE' and uv.active_until > now()
      and d.is_active and d.starts_at <= now() and (d.ends_at is null or d.ends_at > now())
      and private.shop_voucher_scope_matches(d.scope_type,d.product_ids,d.category_ids,p_product_id)
      and p_subtotal >= d.min_purchase
      and (d.benefit_type <> 'FIXED' or d.discount_currency=v_product.currency)
      and (d.benefit_type <> 'FREE_SHIPPING' or p_shipping_cost > 0)
      and (d.benefit_type <> 'BUY_X_GET_Y' or p_quantity >= d.buy_quantity+d.free_quantity),
    case
      when not d.is_active or d.starts_at > now() or (d.ends_at is not null and d.ends_at <= now())
        or (d.usage_type='DURATION' and (uv.status <> 'ACTIVE' or uv.active_until <= now() or not (uv.id=any(v_auto_ids))))
        or (d.usage_type='SINGLE_USE' and uv.status <> 'READY')
        or not private.shop_voucher_scope_matches(d.scope_type,d.product_ids,d.category_ids,p_product_id)
        or p_subtotal < d.min_purchase or (d.benefit_type='FIXED' and d.discount_currency <> v_product.currency)
        or (d.benefit_type='FREE_SHIPPING' and p_shipping_cost <= 0)
        or (d.benefit_type='BUY_X_GET_Y' and p_quantity < d.buy_quantity+d.free_quantity)
        or (d.usage_type='SINGLE_USE' and d.benefit_group=any(v_group_active))
      then 0::numeric
      when d.benefit_type='PERCENT' then
        case when v_product.currency='EDU_COIN'
          then trunc(least(p_subtotal,p_subtotal*d.discount_value/100))
          else round(least(p_subtotal,p_subtotal*d.discount_value/100),2)
        end
      when d.benefit_type='FIXED' then least(p_subtotal,d.discount_value)
      when d.benefit_type='BUY_X_GET_Y' then floor(p_quantity::numeric/(d.buy_quantity+d.free_quantity))*d.free_quantity*(p_subtotal/p_quantity)
      when d.benefit_type='FREE_SHIPPING' then p_shipping_cost
      else 0::numeric
    end
  from public.shop_user_vouchers uv
  join public.shop_voucher_definitions d on d.id=uv.definition_id
  where uv.user_id=auth.uid()
  order by uv.issued_at desc;
end;
$function$;

create or replace function private.calculate_shop_voucher_effects(
  p_user_id uuid,
  p_product_id uuid,
  p_quantity integer,
  p_subtotal numeric,
  p_shipping_cost numeric,
  p_selected_voucher_ids uuid[]
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_product public.commerce_products%rowtype;
  v_row record;
  v_groups text[] := '{}';
  v_applied uuid[] := '{}';
  v_one_time uuid[] := '{}';
  v_price_discount numeric := 0;
  v_bogo_discount numeric := 0;
  v_shipping_discount numeric := 0;
  v_amount numeric := 0;
  v_selected_count integer := 0;
  v_requested_count integer := cardinality(coalesce(p_selected_voucher_ids,'{}'::uuid[]));
begin
  if p_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_quantity is null or p_quantity < 1 or p_quantity > 100 then raise exception 'INVALID_QUANTITY'; end if;
  select * into v_product from public.commerce_products p
    where p.id=p_product_id and p.is_active=true for share;
  if not found then raise exception 'PRODUCT_NOT_AVAILABLE'; end if;

  for v_row in
    select uv.id as user_voucher_id,uv.status as voucher_status,uv.active_until,uv.user_id,
      d.id as definition_id,d.name,d.usage_type,d.duration_hours,d.benefit_group,d.benefit_type,
      d.discount_value,d.discount_currency,d.buy_quantity,d.free_quantity,d.scope_type,
      d.product_ids,d.category_ids,d.min_purchase,d.starts_at,d.ends_at,d.is_active
    from public.shop_user_vouchers uv
    join public.shop_voucher_definitions d on d.id=uv.definition_id
    where uv.user_id=p_user_id
      and (
        (d.usage_type='DURATION' and uv.status='ACTIVE')
        or uv.id=any(coalesce(p_selected_voucher_ids,'{}'::uuid[]))
      )
    order by case when d.usage_type='DURATION' then 0 else 1 end,uv.issued_at desc,d.benefit_group,uv.id
    for update of uv
  loop
    if v_row.usage_type='DURATION' then
      if v_row.voucher_status <> 'ACTIVE' or v_row.active_until <= now()
        or not v_row.is_active or v_row.starts_at > now()
        or (v_row.ends_at is not null and v_row.ends_at <= now())
        or p_subtotal < v_row.min_purchase
        or not private.shop_voucher_scope_matches(v_row.scope_type,v_row.product_ids,v_row.category_ids,p_product_id)
        or (v_row.benefit_type='FIXED' and v_row.discount_currency <> v_product.currency)
        or (v_row.benefit_type='FREE_SHIPPING' and p_shipping_cost <= 0)
        or (v_row.benefit_type='BUY_X_GET_Y' and p_quantity < v_row.buy_quantity+v_row.free_quantity)
      then
        continue;
      end if;
    else
      if v_row.usage_type <> 'SINGLE_USE' or v_row.voucher_status <> 'READY' then raise exception 'SHOP_VOUCHER_NOT_AVAILABLE'; end if;
      if not v_row.is_active or v_row.starts_at > now() or (v_row.ends_at is not null and v_row.ends_at <= now()) then raise exception 'SHOP_VOUCHER_EXPIRED'; end if;
      if p_subtotal < v_row.min_purchase then raise exception 'SHOP_VOUCHER_MINIMUM_NOT_MET'; end if;
      if not private.shop_voucher_scope_matches(v_row.scope_type,v_row.product_ids,v_row.category_ids,p_product_id) then raise exception 'SHOP_VOUCHER_PRODUCT_MISMATCH'; end if;
      if v_row.benefit_type='FIXED' and v_row.discount_currency <> v_product.currency then raise exception 'SHOP_VOUCHER_CURRENCY_MISMATCH'; end if;
      if v_row.benefit_type='FREE_SHIPPING' and p_shipping_cost <= 0 then raise exception 'SHOP_VOUCHER_SHIPPING_NOT_APPLICABLE'; end if;
      if v_row.benefit_type='BUY_X_GET_Y' and p_quantity < v_row.buy_quantity+v_row.free_quantity then raise exception 'SHOP_VOUCHER_QUANTITY_NOT_MET'; end if;
    end if;

    if v_row.benefit_group = any(v_groups) then
      if v_row.usage_type='DURATION' then continue; end if;
      raise exception 'SHOP_VOUCHER_STACK_CONFLICT';
    end if;
    v_groups := array_append(v_groups,v_row.benefit_group);
    v_applied := array_append(v_applied,v_row.user_voucher_id);

    if v_row.usage_type='SINGLE_USE' then
      v_one_time := array_append(v_one_time,v_row.user_voucher_id);
      v_selected_count := v_selected_count + 1;
    end if;

    if v_row.benefit_type='PERCENT' then
      v_amount := case
        when v_product.currency='EDU_COIN' then trunc(least(p_subtotal,p_subtotal*v_row.discount_value/100))
        else round(least(p_subtotal,p_subtotal*v_row.discount_value/100),2)
      end;
      v_price_discount := v_price_discount + v_amount;
    elsif v_row.benefit_type='FIXED' then
      v_amount := least(p_subtotal,v_row.discount_value);
      v_price_discount := v_price_discount + v_amount;
    elsif v_row.benefit_type='BUY_X_GET_Y' then
      v_amount := floor(p_quantity::numeric/(v_row.buy_quantity+v_row.free_quantity))*v_row.free_quantity*(p_subtotal/p_quantity);
      v_bogo_discount := v_bogo_discount + v_amount;
    elsif v_row.benefit_type='FREE_SHIPPING' then
      v_shipping_discount := v_shipping_discount + p_shipping_cost;
    end if;
  end loop;

  if v_selected_count <> v_requested_count then raise exception 'SHOP_VOUCHER_NOT_AVAILABLE'; end if;
  v_price_discount := least(p_subtotal,v_price_discount);
  v_bogo_discount := least(greatest(0,p_subtotal-v_price_discount),v_bogo_discount);
  v_shipping_discount := least(p_shipping_cost,v_shipping_discount);
  return jsonb_build_object(
    'voucher_ids',to_jsonb(v_applied),
    'one_time_ids',to_jsonb(v_one_time),
    'price_discount',v_price_discount,
    'bogo_discount',v_bogo_discount,
    'shipping_discount',v_shipping_discount,
    'line_discount',v_price_discount+v_bogo_discount,
    'total_discount',v_price_discount+v_bogo_discount+v_shipping_discount
  );
end;
$function$;

create or replace function public.create_shop_product_order_with_vouchers(
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
  p_target_organizer_id uuid default null,
  p_voucher_ids uuid[] default '{}'
) returns public.orders
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_order public.orders%rowtype;
  v_effects jsonb;
  v_total_discount numeric;
  v_line_discount numeric;
  v_shipping_discount numeric;
  v_one_time_ids uuid[];
  v_voucher_ids uuid[];
  v_reward_definition_id uuid;
  v_reward_definition public.shop_voucher_definitions%rowtype;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  select nullif(p.metadata->>'shop_voucher_definition_id','')::uuid
    into v_reward_definition_id
  from public.commerce_products p
  where p.id=p_product_id and p.product_type::text='VOUCHER' and p.is_active=true;
  if found then
    select * into v_reward_definition
    from public.shop_voucher_definitions d
    where d.id=v_reward_definition_id
      and d.is_active=true
      and d.starts_at<=now()
      and (d.ends_at is null or d.ends_at>now())
    for share;
    if not found then raise exception 'SHOP_VOUCHER_REWARD_NOT_AVAILABLE'; end if;
  end if;
  v_order := public.create_product_order_with_proof(
    p_product_id,p_quantity,p_whatsapp,p_payment_method,p_proof_url,p_proof_public_id,
    p_proof_width,p_proof_height,p_proof_version,p_proof_resource_type,p_target_organizer_id
  );
  if v_reward_definition_id is not null then
    update public.order_items oi set
      metadata=jsonb_set(
        coalesce(oi.metadata,'{}'::jsonb),
        '{shop_metadata}',
        coalesce(oi.metadata->'shop_metadata','{}'::jsonb)
          || jsonb_build_object('shop_voucher_definition_snapshot',to_jsonb(v_reward_definition)),
        true
      )
    where oi.order_id=v_order.id and oi.product_type::text='VOUCHER';
    if not found then raise exception 'SHOP_VOUCHER_ORDER_ITEM_MISSING'; end if;
  end if;
  v_effects := private.calculate_shop_voucher_effects(
    auth.uid(),p_product_id,p_quantity,v_order.subtotal,v_order.shipping_cost,coalesce(p_voucher_ids,'{}'::uuid[])
  );
  v_total_discount := coalesce((v_effects->>'total_discount')::numeric,0);
  v_line_discount := coalesce((v_effects->>'line_discount')::numeric,0);
  v_shipping_discount := coalesce((v_effects->>'shipping_discount')::numeric,0);
  select coalesce(array_agg(value::uuid),'{}') into v_one_time_ids
    from jsonb_array_elements_text(v_effects->'one_time_ids') as x(value);
  select coalesce(array_agg(value::uuid),'{}') into v_voucher_ids
    from jsonb_array_elements_text(v_effects->'voucher_ids') as x(value);

  if cardinality(v_voucher_ids)>0 then
    update public.order_items oi set
      line_total=greatest(0,oi.line_total-v_line_discount),
      metadata=coalesce(oi.metadata,'{}'::jsonb) || jsonb_build_object(
        'shop_voucher_ids',to_jsonb(v_voucher_ids),
        'shop_voucher_discount',v_total_discount,
        'shop_voucher_breakdown',v_effects
      )
    where oi.order_id=v_order.id;

    if cardinality(v_one_time_ids)>0 then
      update public.shop_user_vouchers uv set
        status='RESERVED',reserved_order_id=v_order.id,reserved_at=now()
      where uv.id=any(v_one_time_ids) and uv.user_id=auth.uid() and uv.status='READY';
      if not found then raise exception 'SHOP_VOUCHER_NOT_AVAILABLE'; end if;
    end if;

    update public.orders o set
      discount=coalesce(o.discount,0)+v_total_discount,
      shipping_cost=greatest(0,coalesce(o.shipping_cost,0)-v_shipping_discount),
      total=greatest(0,coalesce(o.total,0)-v_total_discount),
      updated_at=now()
    where o.id=v_order.id returning * into v_order;
    perform private.write_audit('commerce.shop_voucher_reserved','order',v_order.id::text,
      'Shop voucher discount reserved until payment is confirmed',null,to_jsonb(v_order),null);
  end if;
  return v_order;
end;
$function$;

create or replace function public.create_shop_product_order_with_edu_coin_vouchers(
  p_product_id uuid,
  p_quantity integer default 1,
  p_whatsapp text default null,
  p_target_organizer_id uuid default null,
  p_voucher_ids uuid[] default '{}'
) returns public.orders
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_order public.orders%rowtype;
  v_effects jsonb;
  v_total_discount numeric;
  v_line_discount numeric;
  v_shipping_discount numeric;
  v_one_time_ids uuid[];
  v_voucher_ids uuid[];
  v_balance_after bigint;
  v_final_total numeric;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  v_order := public.create_product_order_with_edu_coin(
    p_product_id,p_quantity,p_whatsapp,p_target_organizer_id
  );
  v_effects := private.calculate_shop_voucher_effects(
    auth.uid(),p_product_id,p_quantity,v_order.subtotal,v_order.shipping_cost,coalesce(p_voucher_ids,'{}'::uuid[])
  );
  v_total_discount := coalesce((v_effects->>'total_discount')::numeric,0);
  v_line_discount := coalesce((v_effects->>'line_discount')::numeric,0);
  v_shipping_discount := coalesce((v_effects->>'shipping_discount')::numeric,0);
  select coalesce(array_agg(value::uuid),'{}') into v_one_time_ids
    from jsonb_array_elements_text(v_effects->'one_time_ids') as x(value);
  select coalesce(array_agg(value::uuid),'{}') into v_voucher_ids
    from jsonb_array_elements_text(v_effects->'voucher_ids') as x(value);

  if cardinality(v_voucher_ids)>0 then
    v_final_total := greatest(0,v_order.total-v_total_discount);
    if v_total_discount > 0 then
      update public.profiles p set edu_coin=coalesce(p.edu_coin,0)+v_total_discount::bigint,updated_at=clock_timestamp()
        where p.id=auth.uid()
        returning p.edu_coin into v_balance_after;
      if not found then raise exception 'PROFILE_NOT_FOUND'; end if;
      update public.edu_coin_ledger
        set amount=-v_final_total::bigint,
            reason='Pembelian Shop dengan Edu Coin setelah voucher: '||v_order.id::text
      where user_id=auth.uid() and event_type='SHOP_EDU_COIN_SPEND' and event_id=v_order.id::text;
      update public.orders o set discount=coalesce(o.discount,0)+v_total_discount,
        shipping_cost=greatest(0,coalesce(o.shipping_cost,0)-v_shipping_discount),
        total=v_final_total,updated_at=clock_timestamp()
      where o.id=v_order.id returning * into v_order;
      update public.order_items oi set
        line_total=greatest(0,oi.line_total-v_line_discount),
        metadata=coalesce(oi.metadata,'{}'::jsonb) || jsonb_build_object(
          'shop_voucher_ids',to_jsonb(v_voucher_ids),
          'shop_voucher_discount',v_total_discount,
          'shop_voucher_breakdown',v_effects
        )
      where oi.order_id=v_order.id;
      update public.notifications n set data=jsonb_set(
        jsonb_set(coalesce(n.data,'{}'::jsonb),'{edu_coin_spent}',to_jsonb(v_final_total),true),
        '{edu_coin_balance}',to_jsonb(v_balance_after),true
      )
      where n.user_id=auth.uid() and n.data->>'order_id'=v_order.id::text;
    else
      update public.order_items oi set metadata=coalesce(oi.metadata,'{}'::jsonb) || jsonb_build_object(
        'shop_voucher_ids',to_jsonb(v_voucher_ids),
        'shop_voucher_discount',0,
        'shop_voucher_breakdown',v_effects
      ) where oi.order_id=v_order.id;
    end if;
    if cardinality(v_one_time_ids)>0 then
      update public.shop_user_vouchers uv set
        status='USED',used_at=now(),used_order_id=v_order.id
      where uv.id=any(v_one_time_ids) and uv.user_id=auth.uid() and uv.status='READY';
      if not found then raise exception 'SHOP_VOUCHER_NOT_AVAILABLE'; end if;
    end if;
    perform private.write_audit('commerce.shop_voucher_redeemed','order',v_order.id::text,
      'Shop voucher redeemed in Edu Coin checkout',null,to_jsonb(v_order),null);
  end if;
  return v_order;
end;
$function$;

-- One-time vouchers are reserved at pending checkout and consumed only when the order becomes paid.
create or replace function private.sync_shop_voucher_order_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if old.status::text not in ('PAID','COMPLETED') and new.status::text in ('PAID','COMPLETED') then
    update public.shop_user_vouchers uv set
      status='USED',used_at=coalesce(uv.used_at,now()),used_order_id=new.id,
      reserved_order_id=null,reserved_at=null
    where uv.reserved_order_id=new.id and uv.status='RESERVED';
  elsif new.status::text in ('CANCELLED','CANCELED','REFUNDED','EXPIRED')
    and old.status::text not in ('CANCELLED','CANCELED','REFUNDED','EXPIRED') then
    update public.shop_user_vouchers uv set
      status='READY',reserved_order_id=null,reserved_at=null
    where uv.reserved_order_id=new.id and uv.status='RESERVED';
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_sync_shop_voucher_order_status on public.orders;
create trigger trg_sync_shop_voucher_order_status
after update of status on public.orders
for each row execute function private.sync_shop_voucher_order_status();

-- Additional slide banners are separate from the existing configurable hero banner.
create table if not exists public.shop_promo_banners (
  id uuid primary key default gen_random_uuid(),
  image_url text not null,
  target_url text,
  slide_duration_seconds integer not null default 5 check (slide_duration_seconds between 2 and 60),
  position integer not null default 1 check (position >= 1),
  is_active boolean not null default true,
  views_count bigint not null default 0,
  clicks_count bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists shop_promo_banners_active_position_idx
  on public.shop_promo_banners (is_active,position,created_at);
create table if not exists public.shop_promo_banner_events (
  id uuid primary key default gen_random_uuid(),
  banner_id uuid not null references public.shop_promo_banners(id) on delete cascade,
  event_type text not null check (event_type in ('VIEW','CLICK')),
  visitor_key text not null check (char_length(visitor_key) between 16 and 80),
  created_at timestamptz not null default now(),
  constraint shop_promo_banner_event_once unique (banner_id,event_type,visitor_key)
);
alter table public.shop_promo_banners enable row level security;
alter table public.shop_promo_banner_events enable row level security;
revoke all on table public.shop_promo_banners from public,anon,authenticated;
revoke all on table public.shop_promo_banner_events from public,anon,authenticated;

create or replace function public.list_active_shop_promo_banners()
returns table (
  id uuid,image_url text,target_url text,slide_duration_seconds integer,position integer
)
language sql
stable
security definer
set search_path = ''
as $function$
  select b.id,b.image_url,b.target_url,b.slide_duration_seconds,b.position
  from public.shop_promo_banners b
  where b.is_active=true
  order by b.position asc,b.created_at desc;
$function$;

create or replace function public.record_shop_promo_banner_event(
  p_banner_id uuid,
  p_event_type text,
  p_visitor_key text
) returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare v_event_id uuid;
begin
  if upper(coalesce(p_event_type,'')) not in ('VIEW','CLICK') then raise exception 'INVALID_BANNER_EVENT'; end if;
  if coalesce(p_visitor_key,'') !~ '^[a-zA-Z0-9_-]{16,80}$' then raise exception 'INVALID_VISITOR_KEY'; end if;
  insert into public.shop_promo_banner_events(banner_id,event_type,visitor_key)
    select b.id,upper(p_event_type),p_visitor_key
    from public.shop_promo_banners b where b.id=p_banner_id and b.is_active=true
  on conflict (banner_id,event_type,visitor_key) do nothing
  returning id into v_event_id;
  if v_event_id is null then return false; end if;
  if upper(p_event_type)='VIEW' then
    update public.shop_promo_banners set views_count=views_count+1 where id=p_banner_id;
  else
    update public.shop_promo_banners set clicks_count=clicks_count+1 where id=p_banner_id;
  end if;
  return true;
end;
$function$;

create or replace function public.admin_list_shop_promo_banners()
returns table (
  id uuid,image_url text,target_url text,slide_duration_seconds integer,position integer,
  is_active boolean,views_count bigint,clicks_count bigint,created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if not private.current_user_is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  return query select b.id,b.image_url,b.target_url,b.slide_duration_seconds,b.position,
    b.is_active,b.views_count,b.clicks_count,b.created_at
  from public.shop_promo_banners b order by b.position,b.created_at desc;
end;
$function$;

create or replace function public.admin_save_shop_promo_banner(
  p_id uuid,
  p_image_url text,
  p_target_url text,
  p_slide_duration_seconds integer,
  p_position integer,
  p_is_active boolean
) returns public.shop_promo_banners
language plpgsql
security definer
set search_path = ''
as $function$
declare v_row public.shop_promo_banners%rowtype;
begin
  if not private.current_user_is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if coalesce(p_image_url,'') !~* '^https://res\.cloudinary\.com/[^/]+/image/upload/.+' then raise exception 'INVALID_BANNER_IMAGE_URL'; end if;
  if p_target_url is not null and p_target_url !~* '^https://' then raise exception 'INVALID_BANNER_TARGET_URL'; end if;
  if p_slide_duration_seconds not between 2 and 60 then raise exception 'INVALID_BANNER_DURATION'; end if;
  if p_position is null or p_position < 0 then raise exception 'INVALID_BANNER_POSITION'; end if;
  if p_id is null then
    insert into public.shop_promo_banners(image_url,target_url,slide_duration_seconds,position,is_active)
      values(p_image_url,nullif(btrim(p_target_url),''),p_slide_duration_seconds,p_position,coalesce(p_is_active,true))
      returning * into v_row;
  else
    update public.shop_promo_banners set image_url=p_image_url,target_url=nullif(btrim(p_target_url),''),
      slide_duration_seconds=p_slide_duration_seconds,position=p_position,is_active=coalesce(p_is_active,true),
      updated_at=now()
    where id=p_id returning * into v_row;
    if not found then raise exception 'SHOP_BANNER_NOT_FOUND'; end if;
  end if;
  return v_row;
end;
$function$;

create or replace function public.admin_delete_shop_promo_banner(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if not private.current_user_is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  delete from public.shop_promo_banners where id=p_id;
  return found;
end;
$function$;

-- Force Shop checkout through voucher-aware wrappers so automatically-active duration vouchers cannot be bypassed.
revoke all on function public.create_product_order_with_proof(uuid,integer,text,text,text,text,integer,integer,text,text,uuid) from public,anon,authenticated;
revoke all on function public.create_product_order_with_edu_coin(uuid,integer,text,uuid) from public,anon,authenticated;
revoke all on function private.calculate_shop_voucher_effects(uuid,uuid,integer,numeric,numeric,uuid[]) from public,anon,authenticated;
revoke all on function public.create_shop_product_order_with_vouchers(uuid,integer,text,text,text,text,integer,integer,text,text,uuid,uuid[]) from public, anon, authenticated;
revoke all on function public.create_shop_product_order_with_edu_coin_vouchers(uuid,integer,text,uuid,uuid[]) from public, anon, authenticated;
revoke all on function private.shop_voucher_scope_matches(text,uuid[],text[],uuid) from public, anon, authenticated;
revoke all on function public.list_my_shop_vouchers() from public, anon, authenticated;
revoke all on function public.mark_my_shop_vouchers_seen() from public, anon, authenticated;
revoke all on function public.list_shop_checkout_vouchers(uuid,integer,numeric,numeric) from public, anon, authenticated;
revoke all on function public.admin_list_shop_voucher_definitions() from public, anon, authenticated;
revoke all on function public.admin_save_shop_voucher_definition(jsonb) from public, anon, authenticated;
revoke all on function public.admin_issue_shop_voucher(uuid,text) from public, anon, authenticated;
revoke all on function public.admin_list_issued_shop_vouchers() from public, anon, authenticated;
revoke all on function public.list_active_shop_promo_banners() from public, anon, authenticated;
revoke all on function public.record_shop_promo_banner_event(uuid,text,text) from public, anon, authenticated;
revoke all on function public.admin_list_shop_promo_banners() from public, anon, authenticated;
revoke all on function public.admin_save_shop_promo_banner(uuid,text,text,integer,integer,boolean) from public, anon, authenticated;
revoke all on function public.admin_delete_shop_promo_banner(uuid) from public, anon, authenticated;

grant execute on function public.create_shop_product_order_with_vouchers(uuid,integer,text,text,text,text,integer,integer,text,text,uuid,uuid[]) to authenticated;
grant execute on function public.create_shop_product_order_with_edu_coin_vouchers(uuid,integer,text,uuid,uuid[]) to authenticated;
grant execute on function public.list_my_shop_vouchers() to authenticated;
grant execute on function public.mark_my_shop_vouchers_seen() to authenticated;
grant execute on function public.list_shop_checkout_vouchers(uuid,integer,numeric,numeric) to authenticated;
grant execute on function public.admin_list_shop_voucher_definitions() to authenticated;
grant execute on function public.admin_save_shop_voucher_definition(jsonb) to authenticated;
grant execute on function public.admin_issue_shop_voucher(uuid,text) to authenticated;
grant execute on function public.admin_list_issued_shop_vouchers() to authenticated;
grant execute on function public.list_active_shop_promo_banners() to anon,authenticated;
grant execute on function public.record_shop_promo_banner_event(uuid,text,text) to anon,authenticated;
grant execute on function public.admin_list_shop_promo_banners() to authenticated;
grant execute on function public.admin_save_shop_promo_banner(uuid,text,text,integer,integer,boolean) to authenticated;
grant execute on function public.admin_delete_shop_promo_banner(uuid) to authenticated;

notify pgrst, 'reload schema';


-- Allow a Shop product to represent a voucher that is granted only after the order is paid.
alter table public.commerce_products
  drop constraint if exists commerce_products_product_type_check;
alter table public.commerce_products
  add constraint commerce_products_product_type_check
  check (product_type = any (array[
    'EDU_COIN_TOPUP','FEATURE_UNLOCK','DIGITAL_ITEM','DONATION','PLAN',
    'BADGE','CERTIFICATE_SERIALS','COLLECTIVE_CERTIFICATE','VOUCHER'
  ]::text[]));

do $shop_voucher_product$
declare
  v_definition text;
begin
  -- Keep the established product editor and checkout RPC implementations intact; extend only their supported type lists.
  v_definition := pg_get_functiondef('public.admin_save_product(uuid,text,text,text,text,text,text,text[],numeric,text,text,boolean,boolean,integer,jsonb)'::regprocedure);
  if position('''VOUCHER''' in v_definition) = 0 then
    v_definition := replace(
      v_definition,
      'if v_type not in (''DIGITAL_ITEM'',''DONATION'',''EDU_COIN_TOPUP'',''BADGE'',''CERTIFICATE_SERIALS'',''COLLECTIVE_CERTIFICATE'') then',
      'if v_type not in (''DIGITAL_ITEM'',''DONATION'',''EDU_COIN_TOPUP'',''BADGE'',''CERTIFICATE_SERIALS'',''COLLECTIVE_CERTIFICATE'',''VOUCHER'') then'
    );
    if position('''VOUCHER''' in v_definition) = 0 then raise exception 'SHOP_VOUCHER_PRODUCT_ADMIN_PATCH_FAILED'; end if;
    v_definition := replace(
      v_definition,
      '  elsif v_type = ''COLLECTIVE_CERTIFICATE'' then',
      '  elsif v_type = ''VOUCHER'' then
    if upper(trim(coalesce(p_currency,''IDR''))) <> ''IDR'' then raise exception ''VOUCHER_PRODUCT_IDR_ONLY''; end if;
    if coalesce(v_metadata->>''shop_voucher_definition_id'','''') !~* ''^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'' then raise exception ''VOUCHER_DEFINITION_REQUIRED''; end if;
    if not exists (select 1 from public.shop_voucher_definitions d where d.id=(v_metadata->>''shop_voucher_definition_id'')::uuid and d.is_active=true) then raise exception ''VOUCHER_DEFINITION_NOT_AVAILABLE''; end if;
  elsif v_type = ''COLLECTIVE_CERTIFICATE'' then'
    );
    execute v_definition;
  end if;

  v_definition := pg_get_functiondef('public.create_product_order_with_proof(uuid,integer,text,text,text,text,integer,integer,text,text,uuid)'::regprocedure);
  if position('''VOUCHER''' in v_definition) = 0 then
    v_definition := replace(
      v_definition,
      'v_product.product_type not in (''DIGITAL_ITEM'',''DONATION'',''EDU_COIN_TOPUP'',''BADGE'',''CERTIFICATE_SERIALS'')',
      'v_product.product_type not in (''DIGITAL_ITEM'',''DONATION'',''EDU_COIN_TOPUP'',''BADGE'',''CERTIFICATE_SERIALS'',''VOUCHER'')'
    );
    if position('''VOUCHER''' in v_definition) = 0 then raise exception 'SHOP_VOUCHER_PRODUCT_CHECKOUT_PATCH_FAILED'; end if;
    execute v_definition;
  end if;

  v_definition := pg_get_functiondef('public.admin_review_manual_order(uuid,text,text)'::regprocedure);
  if position('''VOUCHER''' in v_definition) = 0 then
    v_definition := replace(
      v_definition,
      'if i.product_type in (''DIGITAL_ITEM'',''DONATION'') then',
      'if i.product_type in (''DIGITAL_ITEM'',''DONATION'',''VOUCHER'') then'
    );
    if position('''VOUCHER''' in v_definition) = 0 then raise exception 'SHOP_VOUCHER_PRODUCT_REVIEW_PATCH_FAILED'; end if;
    execute v_definition;
  end if;

  v_definition := pg_get_functiondef('public.process_payment_gateway_success(uuid,text,uuid)'::regprocedure);
  if position('''VOUCHER''' in v_definition) = 0 then
    v_definition := replace(
      v_definition,
      'if i.product_type in (''DIGITAL_ITEM'',''DONATION'') then',
      'if i.product_type in (''DIGITAL_ITEM'',''DONATION'',''VOUCHER'') then'
    );
    if position('''VOUCHER''' in v_definition) = 0 then raise exception 'SHOP_VOUCHER_PRODUCT_GATEWAY_PATCH_FAILED'; end if;
    execute v_definition;
  end if;
end;
$shop_voucher_product$;

create or replace function private.sync_shop_voucher_order_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_item record;
  v_definition public.shop_voucher_definitions%rowtype;
  v_definition_id uuid;
  v_activation timestamptz;
  v_active_until timestamptz;
  v_index integer;
  v_issued_count integer := 0;
begin
  if old.status::text not in ('PAID','COMPLETED') and new.status::text in ('PAID','COMPLETED') then
    update public.shop_user_vouchers uv set
      status='USED',used_at=coalesce(uv.used_at,now()),used_order_id=new.id,
      reserved_order_id=null,reserved_at=null
    where uv.reserved_order_id=new.id and uv.status='RESERVED';

    for v_item in
      select oi.id,oi.quantity,oi.metadata
      from public.order_items oi
      where oi.order_id=new.id and oi.product_type::text='VOUCHER'
      order by oi.created_at
    loop
      v_definition_id := nullif(v_item.metadata->'shop_metadata'->>'shop_voucher_definition_id','')::uuid;
      if v_definition_id is null then raise exception 'SHOP_VOUCHER_DEFINITION_REQUIRED'; end if;
      if jsonb_typeof(v_item.metadata->'shop_metadata'->'shop_voucher_definition_snapshot')='object' then
        v_definition := jsonb_populate_record(
          null::public.shop_voucher_definitions,
          v_item.metadata->'shop_metadata'->'shop_voucher_definition_snapshot'
        );
      else
        select * into v_definition
        from public.shop_voucher_definitions d
        where d.id=v_definition_id
        for share;
      end if;
      if v_definition.id is null then raise exception 'SHOP_VOUCHER_DEFINITION_NOT_AVAILABLE'; end if;
      if v_item.quantity is null or v_item.quantity < 1 or v_item.quantity > 100 then
        raise exception 'SHOP_VOUCHER_PRODUCT_QUANTITY_INVALID';
      end if;

      for v_index in 1..v_item.quantity loop
        if v_definition.usage_type='DURATION' then
          v_activation := greatest(now(),v_definition.starts_at);
          v_active_until := least(
            v_activation + make_interval(hours => v_definition.duration_hours),
            coalesce(v_definition.ends_at,'infinity'::timestamptz)
          );
          insert into public.shop_user_vouchers(
            definition_id,user_id,issued_at,activated_at,active_until,status,
            source_order_item_id,source_order_item_index
          ) values (
            v_definition.id,new.user_id,now(),v_activation,v_active_until,
            case when v_active_until <= now() then 'EXPIRED' else 'ACTIVE' end,
            v_item.id,v_index
          ) on conflict (source_order_item_id,source_order_item_index) do nothing;
        else
          insert into public.shop_user_vouchers(
            definition_id,user_id,issued_at,status,source_order_item_id,source_order_item_index
          ) values (
            v_definition.id,new.user_id,now(),'READY',v_item.id,v_index
          ) on conflict (source_order_item_id,source_order_item_index) do nothing;
        end if;
        if found then v_issued_count := v_issued_count + 1; end if;
      end loop;
    end loop;

    if v_issued_count > 0 then
      insert into public.notifications(user_id,type,title,body,data)
      values(
        new.user_id,'ORDER_PAYMENT','Voucher Shop berhasil diterima',
        v_issued_count::text || ' voucher dari pembelian Shop telah masuk ke koleksi Voucher Saya.',
        jsonb_build_object('order_id',new.id,'voucher_count',v_issued_count)
      );
    end if;
  elsif new.status::text in ('CANCELLED','CANCELED','REFUNDED','EXPIRED')
    and old.status::text not in ('CANCELLED','CANCELED','REFUNDED','EXPIRED') then
    update public.shop_user_vouchers uv set
      status='READY',reserved_order_id=null,reserved_at=null
    where uv.reserved_order_id=new.id and uv.status='RESERVED';
  end if;
  return new;
end;
$function$;


-- Collective certificate orders use a dedicated existing checkout RPC. Wrap that same flow so ALL-scope vouchers
-- and product/category-scoped vouchers are also validated and applied without bypassing certificate preparation.
create or replace function public.create_shop_collective_certificate_order_with_vouchers(
  p_certificate_id uuid,
  p_shop_product_id uuid,
  p_payment_method text,
  p_proof_url text,
  p_proof_public_id text,
  p_proof_width integer,
  p_proof_height integer,
  p_proof_version text,
  p_proof_resource_type text,
  p_whatsapp text,
  p_voucher_ids uuid[] default '{}'
) returns public.orders
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_order public.orders%rowtype;
  v_effects jsonb;
  v_total_discount numeric;
  v_line_discount numeric;
  v_shipping_discount numeric;
  v_one_time_ids uuid[];
  v_voucher_ids uuid[];
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists (
    select 1 from public.commerce_products p
    where p.id=p_shop_product_id and p.product_type::text='COLLECTIVE_CERTIFICATE' and p.is_active=true
  ) then raise exception 'PRODUCT_NOT_AVAILABLE'; end if;

  v_order := public.create_collective_certificate_order_with_proof(
    p_certificate_id,p_payment_method,p_proof_url,p_proof_public_id,
    p_proof_width,p_proof_height,p_proof_version,p_proof_resource_type,p_whatsapp
  );

  -- The existing certificate checkout can reuse a pending gateway order. Clear any prior voucher reservation
  -- and discount metadata before calculating this attempt, so retries cannot stack stale discounts.
  update public.shop_user_vouchers uv set
    status='READY',reserved_order_id=null,reserved_at=null
  where uv.reserved_order_id=v_order.id and uv.status='RESERVED';

  update public.order_items oi set
    line_total=oi.unit_price*oi.quantity,
    metadata=coalesce(oi.metadata,'{}'::jsonb)-'shop_voucher_ids'-'shop_voucher_discount'-'shop_voucher_breakdown'
  where oi.order_id=v_order.id;

  update public.orders o set
    discount=0,
    total=coalesce(o.subtotal,0)+coalesce(o.shipping_cost,0),
    updated_at=now()
  where o.id=v_order.id
  returning * into v_order;

  v_effects := private.calculate_shop_voucher_effects(
    auth.uid(),p_shop_product_id,1,v_order.subtotal,v_order.shipping_cost,coalesce(p_voucher_ids,'{}'::uuid[])
  );
  v_total_discount := coalesce((v_effects->>'total_discount')::numeric,0);
  v_line_discount := coalesce((v_effects->>'line_discount')::numeric,0);
  v_shipping_discount := coalesce((v_effects->>'shipping_discount')::numeric,0);

  select coalesce(array_agg(value::uuid),'{}') into v_one_time_ids
    from jsonb_array_elements_text(v_effects->'one_time_ids') as x(value);
  select coalesce(array_agg(value::uuid),'{}') into v_voucher_ids
    from jsonb_array_elements_text(v_effects->'voucher_ids') as x(value);

  if cardinality(v_voucher_ids)>0 then
    update public.order_items oi set
      line_total=greatest(0,oi.line_total-v_line_discount),
      metadata=coalesce(oi.metadata,'{}'::jsonb) || jsonb_build_object(
        'shop_voucher_ids',to_jsonb(v_voucher_ids),
        'shop_voucher_discount',v_total_discount,
        'shop_voucher_breakdown',v_effects
      )
    where oi.order_id=v_order.id;

    if cardinality(v_one_time_ids)>0 then
      update public.shop_user_vouchers uv set
        status='RESERVED',reserved_order_id=v_order.id,reserved_at=now()
      where uv.id=any(v_one_time_ids) and uv.user_id=auth.uid() and uv.status='READY';
      if not found then raise exception 'SHOP_VOUCHER_NOT_AVAILABLE'; end if;
    end if;

    update public.orders o set
      discount=coalesce(o.discount,0)+v_total_discount,
      shipping_cost=greatest(0,coalesce(o.shipping_cost,0)-v_shipping_discount),
      total=greatest(0,coalesce(o.total,0)-v_total_discount),
      updated_at=now()
    where o.id=v_order.id returning * into v_order;

    perform private.write_audit('commerce.shop_voucher_reserved','order',v_order.id::text,
      'Shop voucher discount reserved for collective certificate order',null,to_jsonb(v_order),null);
  end if;

  -- Keep the certificate-specific order record aligned even when a reused pending
  -- order is checked out again without a voucher after a previous discounted attempt.
  update public.collective_certificate_orders cco
    set amount=v_order.total,updated_at=now()
  where cco.order_id=v_order.id;

  return v_order;
end;
$function$;

revoke all on function public.create_shop_collective_certificate_order_with_vouchers(uuid,uuid,text,text,text,integer,integer,text,text,text,uuid[]) from public, anon, authenticated;
grant execute on function public.create_shop_collective_certificate_order_with_vouchers(uuid,uuid,text,text,text,integer,integer,text,text,text,uuid[]) to authenticated;

