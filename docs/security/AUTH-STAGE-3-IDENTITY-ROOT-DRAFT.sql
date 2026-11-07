-- DRAFT ONLY — Better Auth Stage 3 identity-root and lifecycle migration.
-- Stored under docs/security, NOT supabase/migrations. This is not approved
-- for production execution. It must first pass on a complete schema-only
-- disposable restore together with the generated 69-FK plan.
--
-- Better Auth + Cloudflare D1 owns passwords, OAuth credentials and sessions.
-- private.app_users owns only UUID identity/verification projection.
-- Existing Supabase Auth signup is retained temporarily for overlap through
-- Stage 4/7; the legacy trigger syncs those UUIDs into the new identity root.
-- New Better Auth users provision directly via server-only PostgREST RPCs.

BEGIN;

CREATE TABLE private.app_users (
  id uuid PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  email_verified_at timestamptz,
  phone_verified_at timestamptz,
  verified_phone_identity_hash text,
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  phone_verification_provider text,
  phone_verification_subject text
);

COMMENT ON TABLE private.app_users IS
  'Minimal application identity root for Better Auth UUIDs; no credentials, tokens or sessions.';
COMMENT ON COLUMN private.app_users.verified_phone_identity_hash IS
  'SHA-256 of normalized verified phone digits; raw phone is never projected.';
COMMENT ON COLUMN private.app_users.phone_verification_subject IS
  'Trusted external verification subject (e.g. Telegram OIDC subject); never user-supplied.';

CREATE UNIQUE INDEX app_users_phone_provider_subject_uidx
  ON private.app_users(phone_verification_provider, phone_verification_subject)
  WHERE phone_verification_provider IS NOT NULL
    AND phone_verification_subject IS NOT NULL;

ALTER TABLE private.app_users ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.app_users FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE private.app_users TO service_role;

-- Preserve old Auth UUID parents without copying emails, phone values,
-- credentials, tokens or session rows. Phone is hashed transiently only when
-- Auth explicitly marks it verified, using the existing organizer hash format.
INSERT INTO private.app_users (
  id, email_verified_at, phone_verified_at, verified_phone_identity_hash,
  phone_verification_provider, phone_verification_subject, created_at, updated_at
)
SELECT
  au.id,
  au.email_confirmed_at,
  au.phone_confirmed_at,
  CASE
    WHEN au.phone_confirmed_at IS NOT NULL
      AND pg_catalog.length(regexp_replace(coalesce(au.phone, ''), '[^0-9]+', '', 'g')) >= 8
      THEN encode(extensions.digest(regexp_replace(coalesce(au.phone, ''), '[^0-9]+', '', 'g'), 'sha256'),'hex')
    ELSE NULL
  END,
  CASE
    WHEN au.phone_confirmed_at IS NOT NULL
      AND pg_catalog.length(regexp_replace(coalesce(au.phone, ''), '[^0-9]+', '', 'g')) >= 8
      THEN 'supabase_auth'
    ELSE NULL
  END,
  CASE
    WHEN au.phone_confirmed_at IS NOT NULL
      AND pg_catalog.length(regexp_replace(coalesce(au.phone, ''), '[^0-9]+', '', 'g')) >= 8
      THEN au.id::text
    ELSE NULL
  END,
  au.created_at,
  pg_catalog.clock_timestamp()
FROM auth.users au
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION private.sync_legacy_auth_user_identity_projection()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_phone_digits text;
  v_phone_hash text;
BEGIN
  v_phone_digits := regexp_replace(
    coalesce(NEW.phone, ''),
    '[^0-9]+',
    '',
    'g'
  );
  v_phone_hash := CASE
    WHEN NEW.phone_confirmed_at IS NOT NULL
         AND pg_catalog.length(v_phone_digits) >= 8
      THEN encode(
        extensions.digest(v_phone_digits, 'sha256'),
        'hex'
      )
    ELSE NULL
  END;

  INSERT INTO private.app_users (
    id,
    email_verified_at,
    phone_verified_at,
    verified_phone_identity_hash,
    phone_verification_provider,
    phone_verification_subject,
    created_at,
    updated_at
  )
  VALUES (
    NEW.id,
    NEW.email_confirmed_at,
    NEW.phone_confirmed_at,
    v_phone_hash,
    CASE WHEN v_phone_hash IS NOT NULL THEN 'supabase_auth' ELSE NULL END,
    CASE WHEN v_phone_hash IS NOT NULL THEN NEW.id::text ELSE NULL END,
    NEW.created_at,
    pg_catalog.clock_timestamp()
  )
  ON CONFLICT (id) DO UPDATE
    SET email_verified_at = EXCLUDED.email_verified_at,
        phone_verified_at = EXCLUDED.phone_verified_at,
        verified_phone_identity_hash = EXCLUDED.verified_phone_identity_hash,
        phone_verification_provider = EXCLUDED.phone_verification_provider,
        phone_verification_subject = EXCLUDED.phone_verification_subject,
        updated_at = pg_catalog.clock_timestamp();

  RETURN NEW;
END;
$function$;

-- Same-event triggers run in alphabetical name order. The a_sync name ensures
-- the identity row exists before on_auth_user_created writes the profile, and
-- before trg_referral_signup_attribution checks the referrer identity.
REVOKE ALL ON FUNCTION private.sync_legacy_auth_user_identity_projection()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER a_sync_app_users_identity_insert
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION private.sync_legacy_auth_user_identity_projection();

CREATE TRIGGER a_sync_app_users_identity_update
AFTER UPDATE OF email_confirmed_at, phone_confirmed_at, phone ON auth.users
FOR EACH ROW
EXECUTE FUNCTION private.sync_legacy_auth_user_identity_projection();

-- Auth-dependent application lookups now use the common UUID identity root.
CREATE OR REPLACE FUNCTION private.apply_referral_qualification(p_referred_user_id uuid, p_activity text, p_occurred_at timestamp with time zone)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_referral public.referral_events%rowtype;
  v_email_confirmed_at timestamptz;
  v_activity text;
  v_activity_at timestamptz;
  v_ledger_id uuid;
BEGIN
  IF p_referred_user_id IS NULL
     OR p_occurred_at IS NULL
     OR p_activity NOT IN ('daily_checkin', 'comment', 'follow', 'chat', 'daily_task') THEN
    RETURN false;
  END IF;

  SELECT re.*
    INTO v_referral
  FROM public.referral_events re
  WHERE re.referred_user_id = p_referred_user_id
    AND re.status = 'PENDING'
    AND re.verified_at IS NULL
    AND p_occurred_at >= re.created_at
    AND p_occurred_at < re.created_at + interval '24 hours'
    AND pg_catalog.clock_timestamp() < re.created_at + interval '24 hours'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_referral.verified_activity IS NOT NULL
     AND v_referral.last_checked_at IS NOT NULL THEN
    v_activity := v_referral.verified_activity;
    v_activity_at := v_referral.last_checked_at;
  ELSE
    v_activity := p_activity;
    v_activity_at := p_occurred_at;
  END IF;

  IF v_activity_at < v_referral.created_at
     OR v_activity_at >= v_referral.created_at + interval '24 hours'
     OR pg_catalog.clock_timestamp() >= v_referral.created_at + interval '24 hours' THEN
    RETURN false;
  END IF;

  SELECT au.email_verified_at
    INTO v_email_confirmed_at
  FROM private.app_users au
  WHERE au.id = p_referred_user_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_email_confirmed_at IS NULL THEN
    IF v_referral.verified_activity IS NULL THEN
      UPDATE public.referral_events
      SET verified_activity = v_activity,
          last_checked_at = v_activity_at
      WHERE id = v_referral.id
        AND status = 'PENDING'
        AND verified_at IS NULL
        AND verified_activity IS NULL;
    END IF;
    RETURN false;
  END IF;

  UPDATE public.referral_events
  SET verified_at = v_activity_at,
      verified_activity = v_activity,
      status = 'VERIFIED',
      last_checked_at = pg_catalog.clock_timestamp()
  WHERE id = v_referral.id
    AND status = 'PENDING'
    AND verified_at IS NULL;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  v_ledger_id := NULL;
  INSERT INTO public.edu_coin_ledger (
    user_id, event_type, event_id, amount, reason
  )
  VALUES (
    v_referral.referrer_user_id,
    'REFERRAL_REGISTRATION',
    v_referral.id::text,
    v_referral.reward_amount,
    'Referral pendaftaran tervalidasi'
  )
  ON CONFLICT (user_id, event_type, event_id) DO NOTHING
  RETURNING id INTO v_ledger_id;

  IF v_ledger_id IS NOT NULL THEN
    PERFORM private.credit_profile_currency(
      v_referral.referrer_user_id,
      'COIN',
      v_referral.reward_amount
    );
  END IF;

  RETURN true;
END;
$function$;


CREATE OR REPLACE FUNCTION private.capture_signup_referral()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_referral_id text := nullif(trim(coalesce(NEW.raw_user_meta_data ->> 'referral_id', '')), '');
  v_referrer_id uuid;
  v_reward_amount integer;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF v_referral_id IS NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    v_referrer_id := v_referral_id::uuid;
  EXCEPTION
    WHEN invalid_text_representation THEN
      RETURN NEW;
  END;

  IF v_referrer_id IS NULL OR v_referrer_id = NEW.id THEN
    RETURN NEW;
  END IF;

  SELECT
    CASE
      WHEN s.event_reward_amount IS NOT NULL
       AND (s.starts_at IS NULL OR v_now >= s.starts_at)
       AND (s.ends_at IS NULL OR v_now < s.ends_at)
        THEN s.event_reward_amount
      ELSE s.base_reward_amount
    END
  INTO v_reward_amount
  FROM private.referral_program_settings s
  WHERE s.id = true
    AND s.is_active = true;

  IF v_reward_amount IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM private.app_users au
    WHERE au.id = v_referrer_id
      AND au.email_verified_at IS NOT NULL
  ) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.referral_events (
    referrer_user_id,
    referred_user_id,
    competition_id,
    registration_id,
    reward_amount,
    status,
    created_at
  )
  VALUES (
    v_referrer_id,
    NEW.id,
    NULL,
    NULL,
    v_reward_amount,
    'PENDING',
    v_now
  )
  ON CONFLICT (referred_user_id) DO NOTHING;

  RETURN NEW;
END;
$function$;


-- The legacy Auth email-confirmation trigger remains on auth.users during
-- overlap. Its earlier alphabetical sync trigger updates app_users first.
CREATE OR REPLACE FUNCTION private.process_referral_email_confirmation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_referral public.referral_events%rowtype;
BEGIN
  IF OLD.email_confirmed_at IS NOT NULL OR NEW.email_confirmed_at IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT re.*
    INTO v_referral
  FROM public.referral_events re
  WHERE re.referred_user_id = NEW.id
    AND re.status = 'PENDING'
    AND re.verified_at IS NULL
    AND re.verified_activity IS NOT NULL
    AND re.last_checked_at IS NOT NULL
    AND re.last_checked_at >= re.created_at
    AND re.last_checked_at < re.created_at + interval '24 hours'
    AND re.created_at >= clock_timestamp() - interval '24 hours'
  FOR UPDATE;

  IF FOUND THEN
    PERFORM private.apply_referral_qualification(
      NEW.id,
      v_referral.verified_activity,
      v_referral.last_checked_at
    );
  END IF;

  RETURN NEW;
END;
$function$;


CREATE OR REPLACE FUNCTION public.create_organizer(p_name text, p_slug text)
 RETURNS TABLE(id uuid, name text, slug text, access_code text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_email_verified_at timestamptz;
  v_phone_verified_at timestamptz;
  v_id uuid;
  v_code text := encode(extensions.gen_random_bytes(5), 'hex');
  v_slug text := lower(regexp_replace(trim(p_slug), '[^a-zA-Z0-9]+', '-', 'g'));
  v_identity_hash text;
begin
  if v_uid is null then
    raise exception 'UNAUTHORIZED';
  end if;

  if not exists (
    select 1
    from public.user_roles ur
    where ur.user_id = v_uid
      and ur.role = 'organizer_member'::public.app_role
      and ur.is_active = true
  ) then
    raise exception 'ORGANIZER_ROLE_REQUIRED';
  end if;

  if nullif(trim(p_name), '') is null then
    raise exception 'ORGANIZER_NAME_REQUIRED';
  end if;
  if nullif(trim(v_slug), '') is null then
    raise exception 'ORGANIZER_SLUG_REQUIRED';
  end if;
  if exists (select 1 from public.organizers where owner_user_id = v_uid) then
    raise exception 'ORGANIZER_LIMIT_REACHED';
  end if;

  select au.email_verified_at, au.phone_verified_at, au.verified_phone_identity_hash
    into v_email_verified_at, v_phone_verified_at, v_identity_hash
  from private.app_users au
  where au.id = v_uid;

  if not found then
    raise exception 'USER_NOT_FOUND';
  end if;
  if v_email_verified_at is null then
    raise exception 'EMAIL_VERIFICATION_REQUIRED';
  end if;
  if v_phone_verified_at is null
     or v_identity_hash is null
     or v_identity_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'PHONE_VERIFICATION_REQUIRED';
  end if;

  if exists (
    select 1 from private.organizer_free_identity_claims where identity_hash = v_identity_hash
  ) then
    raise exception 'FREE_ORGANIZER_ALREADY_CLAIMED';
  end if;

  insert into public.organizers AS inserted_organizer(name, slug, owner_user_id, status)
  values (trim(p_name), trim(both '-' from v_slug), v_uid, 'ACTIVE')
  returning inserted_organizer.id into v_id;

  insert into public.organizer_members(organizer_id, user_id, member_role, is_active, role, status)
  values (v_id, v_uid, 'owner', true, 'owner', 'ACTIVE')
  on conflict (organizer_id, user_id) do update
    set member_role = 'owner',
        is_active = true,
        role = 'owner',
        status = 'ACTIVE',
        updated_at = now();

  insert into public.organizer_plans(organizer_id, plan_code, starts_at, ends_at, is_active)
  values (v_id, 'FREE', now(), now() + interval '6 months', true);

  insert into private.organizer_access_codes(organizer_id, code_hash, rotated_by)
  values (v_id, extensions.crypt(v_code, extensions.gen_salt('bf', 10)), v_uid);

  insert into private.organizer_free_identity_claims(identity_hash, owner_user_id, organizer_id)
  values (v_identity_hash, v_uid, v_id);

  return query
    select o.id, o.name, o.slug, v_code
    from public.organizers o
    where o.id = v_id;
exception
  when unique_violation then
    raise exception 'FREE_ORGANIZER_ALREADY_CLAIMED';
end;
$function$;


CREATE OR REPLACE FUNCTION public.get_my_referrals()
 RETURNS TABLE(referred_user_id uuid, full_name text, username text, joined_at timestamp with time zone, last_login_at timestamp with time zone, status text, verified_at timestamp with time zone, verified_activity text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT
    re.referred_user_id,
    CASE
      WHEN re.status IN ('VERIFIED', 'CREDITED')
        THEN coalesce(p.full_name, p.username, 'Pengguna')
      ELSE 'Pengguna menunggu verifikasi'
    END AS full_name,
    CASE
      WHEN re.status IN ('VERIFIED', 'CREDITED') THEN p.username
      ELSE NULL
    END AS username,
    re.created_at AS joined_at,
    NULL::timestamptz AS last_login_at,
    CASE
      WHEN re.status = 'PENDING'
       AND re.created_at + interval '24 hours' <= now()
        THEN 'EXPIRED'
      ELSE re.status
    END AS status,
    re.verified_at,
    re.verified_activity
  FROM public.referral_events re
  JOIN private.app_users au ON au.id = re.referred_user_id
  LEFT JOIN public.profiles p ON p.id = re.referred_user_id
  WHERE re.referrer_user_id = auth.uid()
    AND re.status IN ('PENDING', 'VERIFIED', 'CREDITED')
  ORDER BY re.created_at DESC;
$function$;


CREATE OR REPLACE FUNCTION public.get_my_referrals_v2()
 RETURNS TABLE(referred_user_id uuid, full_name text, username text, joined_at timestamp with time zone, last_login_at timestamp with time zone, status text, verified_at timestamp with time zone, verified_activity text, reward_amount numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT
    re.referred_user_id,
    CASE
      WHEN re.status IN ('VERIFIED', 'CREDITED')
        THEN coalesce(p.full_name, p.username, 'Pengguna')
      ELSE 'Pengguna menunggu verifikasi'
    END AS full_name,
    CASE
      WHEN re.status IN ('VERIFIED', 'CREDITED') THEN p.username
      ELSE NULL
    END AS username,
    re.created_at AS joined_at,
    NULL::timestamptz AS last_login_at,
    CASE
      WHEN re.status = 'PENDING'
       AND re.created_at + interval '24 hours' <= statement_timestamp()
        THEN 'EXPIRED'
      ELSE re.status
    END AS status,
    re.verified_at,
    re.verified_activity,
    re.reward_amount
  FROM public.referral_events re
  JOIN private.app_users au ON au.id = re.referred_user_id
  LEFT JOIN public.profiles p ON p.id = re.referred_user_id
  WHERE re.referrer_user_id = (SELECT auth.uid())
    AND re.status IN ('PENDING', 'VERIFIED', 'CREDITED')
  ORDER BY re.created_at DESC;
$function$;


CREATE OR REPLACE FUNCTION public.get_my_verified_referrals()
 RETURNS TABLE(referred_user_id uuid, full_name text, username text, joined_at timestamp with time zone, last_login_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$ SELECT re.referred_user_id,coalesce(p.full_name,p.username,'Pengguna'),p.username,re.created_at,NULL::timestamptz FROM public.referral_events re JOIN private.app_users au ON au.id=re.referred_user_id LEFT JOIN public.profiles p ON p.id=re.referred_user_id WHERE re.referrer_user_id=auth.uid() AND re.verified_at IS NOT NULL ORDER BY re.verified_at DESC; $function$;


CREATE OR REPLACE FUNCTION public.register_for_competition(p_competition_id uuid, p_participation_key text DEFAULT NULL::text, p_competition_level_id uuid DEFAULT NULL::uuid, p_social_proof_url text DEFAULT NULL::text, p_twibbon_completed boolean DEFAULT false, p_social_platform text DEFAULT NULL::text, p_social_username text DEFAULT NULL::text, p_referral_code text DEFAULT NULL::text)
 RETURNS registrations
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_registration public.registrations;
  v_referrer_id uuid;
  v_referral_reward_amount integer;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'AUTHORIZATION_REQUIRED';
  END IF;

  IF nullif(trim(coalesce(p_referral_code, '')), '') IS NOT NULL THEN
    SELECT rc.user_id
      INTO v_referrer_id
    FROM public.referral_codes rc
    WHERE rc.code = upper(trim(p_referral_code));

    IF v_referrer_id IS NULL THEN
      BEGIN
        v_referrer_id := trim(p_referral_code)::uuid;
      EXCEPTION
        WHEN invalid_text_representation THEN
          v_referrer_id := NULL;
      END;
    END IF;

    IF v_referrer_id = v_user_id THEN
      v_referrer_id := NULL;
    END IF;

    IF v_referrer_id IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM private.app_users au
      WHERE au.id = v_referrer_id
        AND au.email_verified_at IS NOT NULL
    ) THEN
      v_referrer_id := NULL;
    END IF;
  END IF;

  INSERT INTO public.registrations (
    competition_id,
    user_id,
    competition_level_id,
    participation_key,
    social_proof_url,
    metadata
  )
  VALUES (
    p_competition_id,
    v_user_id,
    p_competition_level_id,
    p_participation_key,
    nullif(trim(p_social_proof_url), ''),
    jsonb_build_object(
      'twibbon_completed', coalesce(p_twibbon_completed, false),
      'social_platform', nullif(lower(trim(p_social_platform)), ''),
      'social_username', nullif(regexp_replace(trim(coalesce(p_social_username, '')), '^@', ''), '')
    )
  )
  RETURNING * INTO v_registration;

  IF v_referrer_id IS NOT NULL THEN
    SELECT
      CASE
        WHEN s.event_reward_amount IS NOT NULL
         AND (s.starts_at IS NULL OR v_now >= s.starts_at)
         AND (s.ends_at IS NULL OR v_now < s.ends_at)
          THEN s.event_reward_amount
        ELSE s.base_reward_amount
      END
    INTO v_referral_reward_amount
    FROM private.referral_program_settings s
    WHERE s.id = true
      AND s.is_active = true;

    IF v_referral_reward_amount IS NOT NULL THEN
      INSERT INTO public.referral_events (
        referrer_user_id,
        referred_user_id,
        competition_id,
        registration_id,
        reward_amount,
        status
      )
      VALUES (
        v_referrer_id,
        v_user_id,
        p_competition_id,
        v_registration.id,
        v_referral_reward_amount,
        'PENDING'
      )
      ON CONFLICT (referred_user_id) DO NOTHING;
    END IF;
  END IF;

  INSERT INTO public.audit_logs (
    actor_user_id,
    action,
    entity_type,
    entity_id,
    after_data
  )
  VALUES (
    v_user_id,
    'registration.create',
    'registration',
    v_registration.id::text,
    to_jsonb(v_registration)
  );

  INSERT INTO public.notifications (user_id, type, title, body, data)
  VALUES (
    v_user_id,
    CASE WHEN v_registration.status = 'ACTIVE' THEN 'REGISTRATION_APPROVED' ELSE 'REGISTRATION_SUBMITTED' END,
    CASE WHEN v_registration.status = 'ACTIVE' THEN 'Pendaftaran otomatis disetujui' ELSE 'Pendaftaran dikirim' END,
    CASE
      WHEN v_registration.status = 'ACTIVE'
        THEN 'Pendaftaran kamu langsung aktif sesuai aturan paket organizer.'
      ELSE 'Pendaftaran kamu menunggu persetujuan penyelenggara.'
    END,
    jsonb_build_object(
      'competition_id', v_registration.competition_id,
      'registration_id', v_registration.id
    )
  );

  RETURN v_registration;
END;
$function$;


CREATE OR REPLACE FUNCTION public.verify_pending_referrals()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
DECLARE
  r record;
  n integer := 0;
  activity text;
  ts timestamptz;
  v_ledger_id uuid;
BEGIN
  FOR r IN
    SELECT re.*
    FROM public.referral_events re
    JOIN private.app_users au ON au.id = re.referred_user_id
    WHERE re.verified_at IS NULL
      AND re.status = 'PENDING'
      AND au.email_verified_at IS NOT NULL
      AND re.created_at >= pg_catalog.now() - interval '24 hours'
  LOOP
    activity := NULL;
    ts := NULL;

    SELECT 'daily_checkin', created_at INTO activity, ts
    FROM public.daily_checkins
    WHERE user_id = r.referred_user_id AND created_at >= r.created_at
    ORDER BY created_at LIMIT 1;

    IF activity IS NULL THEN
      SELECT 'comment', created_at INTO activity, ts
      FROM public.comments
      WHERE user_id = r.referred_user_id AND created_at >= r.created_at
      ORDER BY created_at LIMIT 1;
    END IF;

    IF activity IS NULL THEN
      SELECT 'follow', created_at INTO activity, ts
      FROM public.follows
      WHERE follower_id = r.referred_user_id AND created_at >= r.created_at
      ORDER BY created_at LIMIT 1;
    END IF;

    IF activity IS NULL THEN
      SELECT 'chat', created_at INTO activity, ts
      FROM public.chat_messages
      WHERE sender_id = r.referred_user_id AND created_at >= r.created_at
      ORDER BY created_at LIMIT 1;
    END IF;

    IF activity IS NULL THEN
      SELECT 'daily_task', completed_at INTO activity, ts
      FROM public.daily_task_claims
      WHERE user_id = r.referred_user_id
        AND status = 'COMPLETED'
        AND completed_at >= r.created_at
      ORDER BY completed_at LIMIT 1;
    END IF;

    IF activity IS NOT NULL THEN
      UPDATE public.referral_events
      SET verified_at = coalesce(ts, pg_catalog.now()),
          verified_activity = activity,
          status = 'VERIFIED',
          last_checked_at = pg_catalog.now()
      WHERE id = r.id AND verified_at IS NULL;

      v_ledger_id := NULL;
      INSERT INTO public.edu_coin_ledger(
        user_id, event_type, event_id, amount, reason
      )
      VALUES (
        r.referrer_user_id, 'REFERRAL_REGISTRATION', r.id::text,
        r.reward_amount, 'Referral pendaftaran tervalidasi'
      )
      ON CONFLICT (user_id, event_type, event_id) DO NOTHING
      RETURNING id INTO v_ledger_id;

      IF v_ledger_id IS NOT NULL THEN
        PERFORM private.credit_profile_currency(r.referrer_user_id, 'COIN', r.reward_amount);
      END IF;

      n := n + 1;
    ELSE
      UPDATE public.referral_events
      SET last_checked_at = pg_catalog.now()
      WHERE id = r.id;
    END IF;
  END LOOP;

  RETURN n;
END;
$function$;


-- These functions are taken from synthetic Stage 3 fixtures and remain
-- server-only. Only the Cloudflare Worker service credential may invoke them.
create or replace function private.provision_better_auth_user(
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
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_type text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_account_type, 'student')));
  v_role public.app_role;
  v_referrer_id uuid;
  v_reward_amount integer;
begin
  if p_user_id is null then
    raise exception using errcode = '22023', message = 'USER_ID_REQUIRED';
  end if;
  if v_type not in ('student', 'teacher', 'organizer') then
    raise exception using errcode = '22023', message = 'UNSUPPORTED_ACCOUNT_TYPE';
  end if;

  v_role := case v_type
    when 'teacher' then 'teacher'::public.app_role
    when 'organizer' then 'organizer_member'::public.app_role
    else 'student'::public.app_role
  end;

  insert into private.app_users (id, email_verified_at)
  values (
    p_user_id,
    case when coalesce(p_email_verified, false)
      then pg_catalog.clock_timestamp() else null end
  )
  on conflict (id) do nothing;

  insert into public.profiles
    (id, full_name, username, account_type, birth_date, institution, grade, subjects)
  values (
    p_user_id,
    coalesce(nullif(pg_catalog.btrim(p_full_name), ''), ''),
    nullif(pg_catalog.lower(pg_catalog.btrim(p_username)), ''),
    v_type,
    p_birth_date,
    nullif(pg_catalog.upper(pg_catalog.btrim(p_institution)), ''),
    nullif(pg_catalog.lower(pg_catalog.btrim(p_grade)), ''),
    nullif(pg_catalog.btrim(p_subjects), '')
  )
  on conflict (id) do nothing;

  -- Provision only the first basic role. A retry must not add a second role
  -- or reactivate a role that an administrator has already disabled.
  insert into public.user_roles (user_id, role, is_active)
  select p_user_id, v_role, true
  where not exists (
    select 1 from public.user_roles existing_role
    where existing_role.user_id = p_user_id
  )
  on conflict (user_id, role) do nothing;

  insert into public.user_settings (user_id) values (p_user_id)
  on conflict (user_id) do nothing;

  if nullif(pg_catalog.btrim(p_referral_code), '') is not null then
    select rc.user_id into v_referrer_id
    from public.referral_codes rc
    join private.app_users au on au.id = rc.user_id
    where rc.code = pg_catalog.btrim(p_referral_code)
      and rc.user_id <> p_user_id
      and au.email_verified_at is not null;

    if v_referrer_id is not null then
      select case
        when s.event_reward_amount is not null
         and (s.starts_at is null or pg_catalog.clock_timestamp() >= s.starts_at)
         and (s.ends_at is null or pg_catalog.clock_timestamp() < s.ends_at)
          then s.event_reward_amount
        else s.base_reward_amount
      end into v_reward_amount
      from private.referral_program_settings s
      where s.id = true and s.is_active = true;

      if v_reward_amount is not null then
        insert into public.referral_events
          (referrer_user_id, referred_user_id, reward_amount, status, created_at)
        values
          (v_referrer_id, p_user_id, v_reward_amount, 'PENDING',
           pg_catalog.clock_timestamp())
        on conflict (referred_user_id) do nothing;
      end if;
    end if;
  end if;

  return pg_catalog.jsonb_build_object(
    'user_id', p_user_id, 'account_type', v_type, 'role', v_role
  );
end;
$$;

create or replace function private.complete_better_auth_email_verification(
  p_user_id uuid, p_verified_at timestamptz
) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_event public.referral_events%rowtype;
begin
  if p_user_id is null or p_verified_at is null then
    raise exception using errcode = '22023', message = 'VERIFICATION_INPUT_REQUIRED';
  end if;

  update private.app_users
  set email_verified_at = p_verified_at,
      updated_at = pg_catalog.clock_timestamp()
  where id = p_user_id and email_verified_at is null;
  if not found then
    if exists (select 1 from private.app_users where id = p_user_id) then
      return false;
    end if;
    raise exception 'USER_IDENTITY_NOT_FOUND';
  end if;

  select re.* into v_event
  from public.referral_events re
  where re.referred_user_id = p_user_id
    and re.status = 'PENDING'
    and re.verified_at is null
    and re.verified_activity is not null
    and re.last_checked_at is not null
  for update;
  if found then
    perform private.apply_referral_qualification(
      p_user_id, v_event.verified_activity, v_event.last_checked_at
    );
  end if;
  return true;
end;
$$;

revoke all on function private.credit_profile_currency(uuid, text, numeric)
  from public, anon, authenticated;
revoke all on function private.apply_referral_qualification(uuid, text, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.handle_referral_daily_checkin()
  from public, anon, authenticated, service_role;
revoke all on function private.provision_better_auth_user(uuid, text, text, text, text, boolean, date, text, text, text)
  from public, anon, authenticated;
revoke all on function private.complete_better_auth_email_verification(uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function private.provision_better_auth_user(uuid, text, text, text, text, boolean, date, text, text, text)
  to service_role;
grant execute on function private.complete_better_auth_email_verification(uuid, timestamptz)
  to service_role;

-- Same PostgREST-facing RPC bridge proposed for the Cloudflare Worker.
-- This lives only in the synthetic local fixture; no production migration is made.
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
) returns jsonb
language sql security definer set search_path = ''
as $function$
  select private.provision_better_auth_user(
    p_user_id, p_account_type, p_full_name, p_username,
    p_referral_code, p_email_verified,
    p_birth_date, p_institution, p_grade, p_subjects
  );
$function$;

create or replace function private.complete_better_auth_email_verification(
  p_user_id uuid, p_verified_at timestamptz
) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_event public.referral_events%rowtype;
begin
  if p_user_id is null or p_verified_at is null then
    raise exception using errcode = '22023', message = 'VERIFICATION_INPUT_REQUIRED';
  end if;

  update private.app_users
  set email_verified_at = p_verified_at,
      updated_at = pg_catalog.clock_timestamp()
  where id = p_user_id and email_verified_at is null;
  if not found then
    if exists (select 1 from private.app_users where id = p_user_id) then
      return false;
    end if;
    raise exception 'USER_IDENTITY_NOT_FOUND';
  end if;

  select re.* into v_event
  from public.referral_events re
  where re.referred_user_id = p_user_id
    and re.status = 'PENDING'
    and re.verified_at is null
    and re.verified_activity is not null
    and re.last_checked_at is not null
  for update;
  if found then
    perform private.apply_referral_qualification(
      p_user_id, v_event.verified_activity, v_event.last_checked_at
    );
  end if;
  return true;
end;
$$;

revoke all on function private.credit_profile_currency(uuid, text, numeric)
  from public, anon, authenticated;
revoke all on function private.apply_referral_qualification(uuid, text, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.handle_referral_daily_checkin()
  from public, anon, authenticated, service_role;
revoke all on function private.provision_better_auth_user(uuid, text, text, text, text, boolean, date, text, text, text)
  from public, anon, authenticated;
revoke all on function private.complete_better_auth_email_verification(uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function private.provision_better_auth_user(uuid, text, text, text, text, boolean, date, text, text, text)
  to service_role;
grant execute on function private.complete_better_auth_email_verification(uuid, timestamptz)
  to service_role;

-- Same PostgREST-facing RPC bridge proposed for the Cloudflare Worker.
-- This lives only in the synthetic local fixture; no production migration is made.
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
) returns jsonb
language sql security definer set search_path = ''
as $function$
  select private.provision_better_auth_user(
    p_user_id, p_account_type, p_full_name, p_username,
    p_referral_code, p_email_verified,
    p_birth_date, p_institution, p_grade, p_subjects
  );
$function$;

CREATE OR REPLACE FUNCTION private.complete_better_auth_phone_verification(
  p_user_id uuid,
  p_verified_at timestamptz,
  p_phone_hash text,
  p_provider text,
  p_provider_subject text,
  p_phone_digits_count integer
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_user private.app_users%rowtype;
BEGIN
  IF p_user_id IS NULL
     OR p_verified_at IS NULL
     OR p_verified_at > pg_catalog.clock_timestamp() + interval '2 minutes'
     OR p_verified_at < pg_catalog.clock_timestamp() - interval '15 minutes'
     OR p_provider IS DISTINCT FROM 'telegram'
     OR p_provider_subject IS NULL
     OR p_provider_subject !~ '^[0-9]{1,32}$'
     OR p_phone_hash IS NULL
     OR p_phone_hash !~ '^[a-f0-9]{64}$'
     OR p_phone_digits_count IS NULL
     OR p_phone_digits_count < 8
     OR p_phone_digits_count > 15 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'PHONE_VERIFICATION_INPUT_INVALID';
  END IF;

  SELECT * INTO v_user
  FROM private.app_users
  WHERE id = p_user_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'USER_IDENTITY_NOT_FOUND';
  END IF;

  IF EXISTS (
    SELECT 1 FROM private.app_users au
    WHERE au.phone_verification_provider = p_provider
      AND au.phone_verification_subject = p_provider_subject
      AND au.id <> p_user_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'PHONE_PROVIDER_IDENTITY_ALREADY_LINKED';
  END IF;

  IF v_user.phone_verified_at IS NOT NULL
     AND v_user.verified_phone_identity_hash = p_phone_hash
     AND v_user.phone_verification_provider = p_provider
     AND v_user.phone_verification_subject = p_provider_subject THEN
    RETURN false;
  END IF;

  IF v_user.verified_phone_identity_hash IS NOT NULL
     AND v_user.verified_phone_identity_hash <> p_phone_hash
     AND EXISTS (
       SELECT 1 FROM private.organizer_free_identity_claims c
       WHERE c.identity_hash = v_user.verified_phone_identity_hash
         AND c.owner_user_id = p_user_id
     ) THEN
    RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'PHONE_IDENTITY_LOCKED_BY_ORGANIZER_CLAIM';
  END IF;

  UPDATE private.app_users
  SET phone_verified_at = p_verified_at,
      verified_phone_identity_hash = p_phone_hash,
      phone_verification_provider = p_provider,
      phone_verification_subject = p_provider_subject,
      updated_at = pg_catalog.clock_timestamp()
  WHERE id = p_user_id;

  RETURN true;
END;
$function$;

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
) returns jsonb
language sql security definer set search_path = ''
as $function$
  select private.provision_better_auth_user(
    p_user_id, p_account_type, p_full_name, p_username,
    p_referral_code, p_email_verified,
    p_birth_date, p_institution, p_grade, p_subjects
  );
$function$;

create or replace function public.better_auth_complete_email_verification(
  p_user_id uuid, p_verified_at timestamptz
) returns boolean
language sql security definer set search_path = ''
as $function$
  select private.complete_better_auth_email_verification(p_user_id, p_verified_at);
$function$;

CREATE OR REPLACE FUNCTION public.better_auth_complete_phone_verification(
  p_user_id uuid,
  p_verified_at timestamptz,
  p_phone_hash text,
  p_provider text,
  p_provider_subject text,
  p_phone_digits_count integer
) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $function$
  SELECT private.complete_better_auth_phone_verification(
    p_user_id, p_verified_at, p_phone_hash, p_provider,
    p_provider_subject, p_phone_digits_count
  );
$function$;

COMMIT;

-- Production gates — this draft does not perform the FK cutover itself:
-- 1. Review and execute only on a complete disposable schema-only PostgreSQL 17.6 restore.
-- 2. Generate the 69-FK plan from the live catalog and inspect all three phases.
-- 3. Backfill/expand, validate every replacement FK, then do one atomic cutover.
-- 4. Run the full production-shaped regression and Better Auth provisioning/email/phone tests.
-- 5. Verify issuer restriction, hosted OIDC, frontend/backend gates and rollback.
-- 6. Keep production Supabase, production Worker/DNS and all live accounts unchanged.
