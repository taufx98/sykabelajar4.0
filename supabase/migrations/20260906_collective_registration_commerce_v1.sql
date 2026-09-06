-- Applied to production on 2026-09-06.
-- PRD P0: collective registration wizard, server-side quote/order, idempotency,
-- payment linkage, paid-order provisioning, and credential provisioning.

create table if not exists public.collective_registrations (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.competitions(id) on delete restrict,
  teacher_user_id uuid not null references auth.users(id) on delete restrict,
  school_id uuid null,
  school_name text null,
  competition_level_id uuid null references public.competition_levels(id) on delete set null,
  certificate_policy text not null default 'EVENT_DEFAULT',
  roster_student_ids uuid[] not null default '{}',
  student_count integer not null default 0,
  status text not null default 'PENDING_PAYMENT',
  order_id uuid null references public.orders(id) on delete set null,
  payment_method_id uuid null references public.organizer_payment_methods(id) on delete set null,
  amount numeric(14,2) not null default 0,
  currency text not null default 'IDR',
  idempotency_key uuid not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint collective_registrations_certificate_policy_check check (certificate_policy in ('EVENT_DEFAULT','INCLUDED','OPTIONAL','NONE')),
  constraint collective_registrations_status_check check (status in ('DRAFT','PENDING_PAYMENT','PAID','PROVISIONED','CANCELLED','REJECTED')),
  constraint collective_registrations_student_count_check check (student_count >= 0),
  constraint collective_registrations_amount_check check (amount >= 0),
  constraint collective_registrations_idempotency_unique unique (teacher_user_id,idempotency_key)
);
create index if not exists idx_collective_registrations_teacher_created on public.collective_registrations(teacher_user_id,created_at desc);
create index if not exists idx_collective_registrations_competition_status on public.collective_registrations(competition_id,status);
create index if not exists idx_collective_registrations_order on public.collective_registrations(order_id);
alter table public.collective_registrations enable row level security;
drop policy if exists collective_registrations_select_owner on public.collective_registrations;
create policy collective_registrations_select_owner on public.collective_registrations for select to authenticated using (teacher_user_id=(select auth.uid()) or private.current_user_is_admin());

-- The production function bodies for these routines are tracked in the applied
-- migration and should not be hand-edited independently of the production schema.
