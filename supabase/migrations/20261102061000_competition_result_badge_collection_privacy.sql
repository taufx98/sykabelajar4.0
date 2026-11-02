begin;

CREATE OR REPLACE FUNCTION public.get_competition_participant_detail(p_slug text, p_participant_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_comp public.competitions%rowtype;
  v_participant public.participants%rowtype;
  v_attempt public.attempts%rowtype;
  v_published boolean;
  v_badges_visible boolean := false;
  v_rank bigint;
  v_total integer := 0;
  v_correct integer := 0;
  v_incorrect integer := 0;
  v_manual integer := 0;
  v_unanswered integer := 0;
  v_elapsed integer := 0;
  v_awards jsonb := '[]'::jsonb;
  v_badges jsonb := '[]'::jsonb;
  v_certificates jsonb := '[]'::jsonb;
begin
  select * into v_comp
  from public.competitions c
  where c.slug = trim(coalesce(p_slug, ''));

  if not found then
    raise exception 'COMPETITION_NOT_FOUND';
  end if;

  v_published := v_comp.visibility = 'PUBLIC'
    and v_comp.status::text in ('RESULT_PUBLISHED', 'ARCHIVED');

  if not v_published then
    if auth.uid() is null then
      raise exception 'RESULT_NOT_PUBLISHED';
    end if;
    if not (
      private.current_user_is_admin()
      or (
        v_comp.organizer_id is not null
        and private.current_user_can_edit_competition(v_comp.organizer_id)
      )
    ) then
      raise exception 'ACCESS_DENIED';
    end if;
  end if;

  select * into v_participant
  from public.participants p
  where p.id = p_participant_id
    and p.competition_id = v_comp.id;

  if not found then
    raise exception 'PARTICIPANT_NOT_FOUND';
  end if;

  -- Match the public profile badge-collection visibility contract. Contest
  -- results may be public while a participant's badge collection remains private.
  if v_participant.user_id is not null then
    select
      auth.uid() = p.id
      or private.current_user_is_admin()
      or (coalesce(p.is_public, false) and coalesce(settings.show_badge_collection, true))
    into v_badges_visible
    from public.profiles p
    left join public.profile_ui_settings settings on settings.user_id = p.id
    where p.id = v_participant.user_id;
  end if;

  select * into v_attempt
  from public.attempts a
  where a.competition_id = v_comp.id
    and a.canonical_participant_id = v_participant.id
    and a.is_preview = false
    and a.status::text = 'FINALIZED'
  order by a.finalized_at desc nulls last, a.created_at desc, a.id desc
  limit 1;

  if not found then
    return jsonb_build_object(
      'has_result', false,
      'participant', jsonb_build_object(
        'full_name', v_participant.full_name,
        'participant_type', v_participant.participant_type,
        'grade', v_participant.grade,
        'class_name', v_participant.class_name,
        'school_name', (select s.name from public.schools s where s.id = v_participant.school_id)
      ),
      'scores', null,
      'awards', '[]'::jsonb,
      'badges', '[]'::jsonb,
      'certificates', '[]'::jsonb
    );
  end if;

  select r.rank_position into v_rank
  from private.canonical_competition_results(v_comp.id) r
  where r.canonical_participant_id = v_participant.id;

  select
    count(*)::integer,
    count(*) filter (where evaluated.result_status = 'CORRECT')::integer,
    count(*) filter (where evaluated.result_status = 'INCORRECT')::integer,
    count(*) filter (where evaluated.result_status = 'MANUAL_REVIEW')::integer,
    count(*) filter (where evaluated.result_status in ('UNANSWERED', 'SKIPPED', 'TIMEOUT'))::integer
  into v_total, v_correct, v_incorrect, v_manual, v_unanswered
  from (
    select (private.evaluate_linear_preview_answer(
      eq.state,
      eq.transition_reason,
      eq.question_snapshot,
      eq.answer_key_snapshot,
      coalesce(a.answer_json, '{}'::jsonb)
    )->>'result_status') as result_status
    from public.exam_attempt_questions eq
    left join public.answers a
      on a.attempt_id = eq.attempt_id
     and a.question_id = eq.question_id
    where eq.attempt_id = v_attempt.id
  ) evaluated;

  select coalesce(sum(eq.elapsed_seconds), 0)::integer
  into v_elapsed
  from public.exam_attempt_questions eq
  where eq.attempt_id = v_attempt.id;

  if v_elapsed = 0 and v_attempt.started_at is not null then
    v_elapsed := greatest(
      0,
      extract(epoch from (coalesce(v_attempt.submitted_at, v_attempt.finalized_at) - v_attempt.started_at))::integer
    );
  end if;

  if v_participant.user_id is not null then
    select coalesce(jsonb_agg(jsonb_build_object(
      'title', aw.title,
      'rank_code', aw.rank_code,
      'points', aw.points,
      'emblem_url', aw.emblem_url,
      'issued_at', aw.issued_at
    ) order by aw.issued_at desc), '[]'::jsonb)
    into v_awards
    from public.awards aw
    where aw.user_id = v_participant.user_id
      and aw.competition_id = v_comp.id
      and aw.visibility = 'PUBLIC';

    select coalesce(jsonb_agg(jsonb_build_object(
      'name', b.name,
      'description', b.description,
      'icon_url', b.icon_url,
      'icon_emoji', b.icon_emoji,
      'rarity', b.rarity,
      'awarded_at', ub.awarded_at
    ) order by ub.awarded_at desc), '[]'::jsonb)
    into v_badges
    from public.user_badges ub
    join public.badges b on b.id = ub.badge_id
    where ub.user_id = v_participant.user_id
      and ub.source_reference = v_comp.id::text
      and b.status = 'ACTIVE'
      and v_badges_visible;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'serial_number', cert.serial_number,
    'certificate_url', cert.certificate_url,
    'issued_at', cert.issued_at
  ) order by cert.issued_at desc), '[]'::jsonb)
  into v_certificates
  from public.certificates cert
  where cert.canonical_participant_id = v_participant.id
    and cert.competition_id = v_comp.id
    and cert.status::text = 'PUBLISHED'
    and cert.certificate_url is not null;

  select v_certificates || coalesce(jsonb_agg(jsonb_build_object(
    'serial_number', cc.serial_number,
    'certificate_url', cc.certificate_url,
    'issued_at', cc.issued_at
  ) order by cc.issued_at desc), '[]'::jsonb)
  into v_certificates
  from public.collective_certificates cc
  where cc.canonical_participant_id = v_participant.id
    and cc.competition_id = v_comp.id
    and cc.status = 'PUBLISHED'
    and cc.certificate_url is not null;

  return jsonb_build_object(
    'has_result', true,
    'participant', jsonb_build_object(
      'full_name', v_participant.full_name,
      'participant_type', v_participant.participant_type,
      'grade', v_participant.grade,
      'class_name', v_participant.class_name,
      'school_name', (select s.name from public.schools s where s.id = v_participant.school_id)
    ),
    'result', jsonb_build_object(
      'rank', v_rank,
      'score', v_attempt.score,
      'finalized_at', v_attempt.finalized_at,
      'duration_seconds', v_elapsed
    ),
    'question_summary', jsonb_build_object(
      'total', v_total,
      'correct', v_correct,
      'incorrect', v_incorrect,
      'manual_review', v_manual,
      'unanswered', v_unanswered
    ),
    'awards', v_awards,
    'badges', v_badges,
    'certificates', v_certificates
  );
end;
$function$;

revoke all on function public.get_competition_participant_detail(text, uuid) from public;
grant execute on function public.get_competition_participant_detail(text, uuid) to anon, authenticated;

commit;
