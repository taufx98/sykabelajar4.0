-- Persist generated collective certificate PDF metadata.
create table if not exists public.certificate_assets (
  id uuid primary key default gen_random_uuid(),
  certificate_id uuid not null references public.collective_certificates(id) on delete cascade,
  asset_kind text not null default 'PDF',
  storage_bucket text not null,
  storage_path text not null,
  mime_type text not null default 'application/pdf',
  revision integer not null default 1,
  created_at timestamptz not null default now(),
  unique(certificate_id, asset_kind, revision)
);

alter table public.certificate_assets enable row level security;
revoke all on public.certificate_assets from anon, authenticated;
grANT select,insert,update,delete on public.certificate_assets to service_role;
