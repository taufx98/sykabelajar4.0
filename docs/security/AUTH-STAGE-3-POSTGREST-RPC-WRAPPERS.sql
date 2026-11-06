-- DRAFT ONLY — Stage 3 PostgREST bridge contract.
-- NOT a Supabase migration and NOT approved for production execution.
-- Apply only after a complete schema-only baseline exists and an isolated
-- Free-plan Supabase project has accepted the Better Auth Custom OIDC issuer.
--
-- Required private implementations must already exist:
--   private.provision_better_auth_user(uuid,text,text,text,text,boolean,date,text,text,text)
--   private.complete_better_auth_email_verification(uuid,timestamptz)
--
-- These public wrappers are intentionally the only PostgREST entry points used
-- by the Cloudflare Worker. The service-role key remains in Worker secrets only.
-- The wrapper owner must be a trusted migration owner; callers are constrained
-- to service_role and the function body uses fully-qualified names + empty path.

begin;

create or replace function public.better_auth_provision_user(
  p_user_id uuid,
  p_account_type text,
  p_full_name text,
  p_username text,
  p_referral_code text default null,
  p_email_verified boolean default false,
  p_birth_date date default null,
  p_institution text default null,
  p_grade text default null,
  p_subjects text default null
)
returns jsonb
language sql
security definer
set search_path = ''
as $function$
  select private.provision_better_auth_user(
    p_user_id,
    p_account_type,
    p_full_name,
    p_username,
    p_referral_code,
    p_email_verified,
    p_birth_date,
    p_institution,
    p_grade,
    p_subjects
  );
$function$;

create or replace function public.better_auth_complete_email_verification(
  p_user_id uuid,
  p_verified_at timestamptz
)
returns boolean
language sql
security definer
set search_path = ''
as $function$
  select private.complete_better_auth_email_verification(
    p_user_id,
    p_verified_at
  );
$function$;

revoke all on function public.better_auth_provision_user(uuid,text,text,text,text,boolean,date,text,text,text)
  from public, anon, authenticated;
revoke all on function public.better_auth_complete_email_verification(uuid,timestamptz)
  from public, anon, authenticated;

grant execute on function public.better_auth_provision_user(uuid,text,text,text,text,boolean,date,text,text,text)
  to service_role;
grant execute on function public.better_auth_complete_email_verification(uuid,timestamptz)
  to service_role;

comment on function public.better_auth_provision_user(uuid,text,text,text,text,boolean,date,text,text,text)
  is 'Server-only Better Auth identity projection; execute only via Cloudflare Worker service-role credential.';
comment on function public.better_auth_complete_email_verification(uuid,timestamptz)
  is 'Server-only Better Auth email verification projection and referral qualification; execute only via Cloudflare Worker service-role credential.';

commit;

-- Post-apply checks (run as a trusted database owner):
-- SELECT to_regprocedure('public.better_auth_provision_user(uuid,text,text,text,text,boolean,date,text,text,text)');
-- SELECT to_regprocedure('public.better_auth_complete_email_verification(uuid,timestamp with time zone)');
-- SELECT has_function_privilege('service_role','public.better_auth_provision_user(uuid,text,text,text,text,boolean,date,text,text,text)','EXECUTE');
-- SELECT has_function_privilege('service_role','public.better_auth_complete_email_verification(uuid,timestamp with time zone)','EXECUTE');
-- SELECT has_function_privilege('anon','public.better_auth_provision_user(uuid,text,text,text,text,boolean,date,text,text,text)','EXECUTE');
-- SELECT has_function_privilege('authenticated','public.better_auth_provision_user(uuid,text,text,text,text,boolean,date,text,text,text)','EXECUTE');
-- The last two results must be false. Repeat for the email-verification wrapper.
