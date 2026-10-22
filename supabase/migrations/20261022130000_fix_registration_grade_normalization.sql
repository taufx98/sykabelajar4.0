begin;

create or replace function private.normalize_registration_grade(p_grade text)
returns text
language sql
immutable
security invoker
set search_path = ''
as $function$
  select case
    when lower(btrim(coalesce(p_grade, ''))) ~ '^sd([0-9]+)?$' then 'sd'
    when lower(btrim(coalesce(p_grade, ''))) ~ '^smp([0-9]+)?$' then 'smp'
    when lower(btrim(coalesce(p_grade, ''))) ~ '^(sma|smk)([0-9]+)?$'
      or lower(btrim(coalesce(p_grade, ''))) = 'sma/smk' then 'sma'
    when lower(btrim(coalesce(p_grade, ''))) in ('mahasiswa', 'kuliah', 'university') then 'mahasiswa'
    when lower(btrim(coalesce(p_grade, ''))) in ('profesional', 'professional') then 'profesional'
    else lower(btrim(coalesce(p_grade, '')))
  end;
$function$;

revoke all on function private.normalize_registration_grade(text) from public, anon, authenticated;

-- The profile may store a school year/class (for example SMP1) while the
-- competition rule stores only the school level (SMP). Compare normalized levels.
do $grade_normalization$
declare
  v_definition text;
  v_old_trigger_grade text := $old_trigger$IF coalesce(cardinality(r.allowed_grades),0)>0 AND (p.grade IS NULL OR NOT(p.grade=ANY(r.allowed_grades))) THEN RAISE EXCEPTION 'ELIGIBILITY_FAILED'; END IF;$old_trigger$;
  v_new_trigger_grade text := $new_trigger$IF coalesce(cardinality(r.allowed_grades),0)>0 AND (p.grade IS NULL OR NOT EXISTS (SELECT 1 FROM unnest(r.allowed_grades) allowed(grade_code) WHERE private.normalize_registration_grade(allowed.grade_code)=private.normalize_registration_grade(p.grade))) THEN RAISE EXCEPTION 'ELIGIBILITY_FAILED'; END IF;$new_trigger$;
  v_old_eligibility_grade text := $old_eligibility$if coalesce(cardinality(r.allowed_grades),0) > 0 then if p_grade is null or not (p_grade = any(r.allowed_grades)) then return jsonb_build_object('eligible', false, 'reason', 'ELIGIBILITY_FAILED', 'allowed_grades', to_jsonb(r.allowed_grades)); end if; end if;$old_eligibility$;
  v_new_eligibility_grade text := $new_eligibility$if coalesce(cardinality(r.allowed_grades),0) > 0 then if p_grade is null or not exists (select 1 from unnest(r.allowed_grades) allowed(grade_code) where private.normalize_registration_grade(allowed.grade_code)=private.normalize_registration_grade(p_grade)) then return jsonb_build_object('eligible', false, 'reason', 'ELIGIBILITY_FAILED', 'allowed_grades', to_jsonb(r.allowed_grades)); end if; end if;$new_eligibility$;
begin
  select pg_get_functiondef('public.validate_registration_insert()'::regprocedure)
    into v_definition;
  if position(v_old_trigger_grade in v_definition) = 0 then
    raise exception 'REGISTRATION_TRIGGER_GRADE_ANCHOR_NOT_FOUND';
  end if;
  v_definition := replace(v_definition, v_old_trigger_grade, v_new_trigger_grade);
  execute v_definition;

  select pg_get_functiondef('public.check_registration_eligibility(uuid,text)'::regprocedure)
    into v_definition;
  if position(v_old_eligibility_grade in v_definition) = 0 then
    raise exception 'REGISTRATION_ELIGIBILITY_GRADE_ANCHOR_NOT_FOUND';
  end if;
  v_definition := replace(v_definition, v_old_eligibility_grade, v_new_eligibility_grade);
  execute v_definition;
end;
$grade_normalization$;

commit;
