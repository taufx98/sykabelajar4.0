CREATE OR REPLACE FUNCTION private.organizer_has_entitlement(p_organizer_id uuid, p_capability text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organizer_plans op
    JOIN public.plan_entitlements pe ON pe.plan_code = op.plan_code
    WHERE op.organizer_id = p_organizer_id
      AND op.is_active = true
      AND op.starts_at <= now()
      AND (op.ends_at IS NULL OR op.ends_at > now())
      AND pe.capability = lower(trim(p_capability))
      AND coalesce(pe.limit_value, 0) > 0
  );
$$;

CREATE OR REPLACE FUNCTION private.require_organizer_entitlement(p_organizer_id uuid, p_capability text)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
BEGIN
  IF private.current_user_is_admin() THEN RETURN; END IF;
  IF NOT private.organizer_has_entitlement(p_organizer_id, p_capability) THEN
    RAISE EXCEPTION 'PLAN_ENTITLEMENT_REQUIRED' USING DETAIL = lower(trim(p_capability));
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION private.guard_question_bank_entitlement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE v_plan text; v_limit numeric; v_used bigint;
BEGIN
  IF private.current_user_is_admin() THEN RETURN NEW; END IF;
  IF NOT private.current_user_is_organizer_for(NEW.organizer_id) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.organizer_id::text || ':question_banks', 0));
  SELECT op.plan_code INTO v_plan FROM public.organizer_plans op
  WHERE op.organizer_id=NEW.organizer_id AND op.is_active=true AND op.starts_at<=now()
    AND (op.ends_at IS NULL OR op.ends_at>now()) ORDER BY op.starts_at DESC, op.created_at DESC LIMIT 1;
  SELECT pe.limit_value INTO v_limit FROM public.plan_entitlements pe
  WHERE pe.plan_code=v_plan AND pe.capability='question_bank';
  IF TG_OP='INSERT' THEN
    SELECT count(*) INTO v_used FROM public.question_banks qb WHERE qb.organizer_id=NEW.organizer_id;
    IF v_used >= coalesce(v_limit,0) THEN RAISE EXCEPTION 'QUESTION_BANK_QUOTA_EXCEEDED'; END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_question_bank_entitlement ON public.question_banks;
CREATE TRIGGER trg_guard_question_bank_entitlement
BEFORE INSERT OR UPDATE ON public.question_banks
FOR EACH ROW EXECUTE FUNCTION private.guard_question_bank_entitlement();

CREATE OR REPLACE FUNCTION private.guard_question_entitlement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE v_org uuid; v_plan text; v_limit numeric; v_used bigint;
BEGIN
  SELECT qb.organizer_id INTO v_org FROM public.question_banks qb WHERE qb.id=NEW.question_bank_id;
  IF v_org IS NULL THEN RAISE EXCEPTION 'BANK_NOT_FOUND'; END IF;
  IF private.current_user_is_admin() THEN RETURN NEW; END IF;
  IF NOT private.current_user_is_organizer_for(v_org) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_org::text || ':questions:' || NEW.question_bank_id::text, 0));
  SELECT op.plan_code INTO v_plan FROM public.organizer_plans op
  WHERE op.organizer_id=v_org AND op.is_active=true AND op.starts_at<=now()
    AND (op.ends_at IS NULL OR op.ends_at>now()) ORDER BY op.starts_at DESC, op.created_at DESC LIMIT 1;
  SELECT pe.limit_value INTO v_limit FROM public.plan_entitlements pe
  WHERE pe.plan_code=v_plan AND pe.capability='question_limit';
  IF TG_OP='INSERT' THEN
    SELECT count(*) INTO v_used FROM public.questions q WHERE q.question_bank_id=NEW.question_bank_id;
    IF v_used >= coalesce(v_limit,0) THEN RAISE EXCEPTION 'QUESTION_QUOTA_EXCEEDED'; END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_question_entitlement ON public.questions;
CREATE TRIGGER trg_guard_question_entitlement
BEFORE INSERT OR UPDATE OF question_bank_id ON public.questions
FOR EACH ROW EXECUTE FUNCTION private.guard_question_entitlement();

CREATE OR REPLACE FUNCTION private.guard_registration_entitlement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE v_org uuid; v_plan text; v_limit numeric; v_used bigint;
BEGIN
  SELECT organizer_id INTO v_org FROM public.competitions WHERE id=NEW.competition_id;
  IF v_org IS NULL THEN RAISE EXCEPTION 'COMPETITION_NOT_FOUND'; END IF;
  IF private.current_user_is_admin() THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.competition_id::text || ':participants', 0));
  SELECT op.plan_code INTO v_plan FROM public.organizer_plans op
  WHERE op.organizer_id=v_org AND op.is_active=true AND op.starts_at<=now()
    AND (op.ends_at IS NULL OR op.ends_at>now()) ORDER BY op.starts_at DESC, op.created_at DESC LIMIT 1;
  SELECT pe.limit_value INTO v_limit FROM public.plan_entitlements pe
  WHERE pe.plan_code=v_plan AND pe.capability='participant_limit';
  SELECT count(*) INTO v_used FROM public.registrations r
  WHERE r.competition_id=NEW.competition_id AND r.status NOT IN ('REJECTED','CANCELLED');
  IF v_used >= coalesce(v_limit,0) THEN RAISE EXCEPTION 'PARTICIPANT_QUOTA_EXCEEDED'; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_registration_entitlement ON public.registrations;
CREATE TRIGGER trg_guard_registration_entitlement
BEFORE INSERT ON public.registrations
FOR EACH ROW EXECUTE FUNCTION private.guard_registration_entitlement();

CREATE OR REPLACE FUNCTION private.guard_certificate_entitlement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE v_org uuid;
BEGIN
  SELECT c.organizer_id INTO v_org FROM public.competitions c WHERE c.id=NEW.competition_id;
  IF v_org IS NULL THEN RAISE EXCEPTION 'COMPETITION_NOT_FOUND'; END IF;
  PERFORM private.require_organizer_entitlement(v_org,'certificate');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_certificate_entitlement ON public.certificates;
CREATE TRIGGER trg_guard_certificate_entitlement
BEFORE INSERT ON public.certificates
FOR EACH ROW EXECUTE FUNCTION private.guard_certificate_entitlement();

CREATE OR REPLACE FUNCTION public.finalize_attempt_manual(p_attempt_id uuid, p_score numeric, p_reason text DEFAULT NULL)
RETURNS public.attempts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE actor uuid:=auth.uid(); a public.attempts; c public.competitions;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'AUTHORIZATION_REQUIRED'; END IF;
  SELECT * INTO a FROM public.attempts WHERE id=p_attempt_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ATTEMPT_NOT_FOUND'; END IF;
  SELECT * INTO c FROM public.competitions WHERE id=a.competition_id;
  IF NOT (private.current_user_is_admin() OR private.current_user_is_organizer_for(c.organizer_id)) THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
  PERFORM private.require_organizer_entitlement(c.organizer_id,'manual_grading');
  IF a.status NOT IN ('GRADING','SUBMITTED') THEN RAISE EXCEPTION 'ATTEMPT_NOT_FINALIZABLE'; END IF;
  IF p_reason IS NULL OR trim(p_reason)='' THEN RAISE EXCEPTION 'FINALIZE_REASON_REQUIRED'; END IF;
  UPDATE public.attempts SET score=greatest(coalesce(p_score,0),0),status='FINALIZED',finalized_at=now(),updated_at=now()
  WHERE id=a.id RETURNING * INTO a;
  PERFORM private.write_audit('attempt.finalize','attempt',a.id::text,p_reason,NULL,jsonb_build_object('score',a.score,'status',a.status),NULL);
  RETURN a;
END;
$$;
