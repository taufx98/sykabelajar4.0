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
