begin;

create or replace function public.get_public_competition_detail_summary(p_competition_id uuid)
returns table(
  participant_count bigint,
  organizer_name text,
  organizer_logo_url text,
  question_bank_name text,
  question_provider_name text,
  question_count bigint
)
language sql
stable
security definer
set search_path = ''
as $function$
  select
    (
      select count(*)::bigint
      from public.registrations r
      where r.competition_id = c.id
        and r.status <> 'CANCELLED'::public.registration_status
    ) as participant_count,
    coalesce(nullif(o.name, ''), 'Penyelenggara') as organizer_name,
    coalesce(nullif(o.logo_asset_url, ''), nullif(op.avatar_url, '')) as organizer_logo_url,
    nullif(qb.name, '') as question_bank_name,
    case
      when qb.id is not null and qb.organizer_id is distinct from c.organizer_id
        then coalesce(nullif(qbo.name, ''), 'Mitra penyedia soal')
      else null
    end as question_provider_name,
    (
      select count(distinct q.id)::bigint
      from public.questions q
      where q.status = 'PUBLISHED'
        and (
          q.competition_id = c.id
          or (c.question_bank_id is not null and q.question_bank_id = c.question_bank_id)
        )
    ) as question_count
  from public.competitions c
  left join public.organizers o on o.id = c.organizer_id
  left join public.profiles op on op.id = o.owner_user_id
  left join public.question_banks qb on qb.id = c.question_bank_id
  left join public.organizers qbo on qbo.id = qb.organizer_id
  where c.id = p_competition_id
    and c.visibility = 'PUBLIC'
    and c.status in (
      'PUBLISHED','REGISTRATION_OPEN','REGISTRATION_CLOSED','LIVE',
      'SUBMISSION_CLOSED','GRADING','RESULT_PUBLISHED','ARCHIVED'
    );
$function$;

revoke all on function public.get_public_competition_detail_summary(uuid) from public;
grant execute on function public.get_public_competition_detail_summary(uuid) to anon, authenticated;

create or replace function public.register_for_competition_with_integrity(
  p_competition_id uuid,
  p_participation_key text default null,
  p_competition_level_id uuid default null,
  p_social_proof_url text default null,
  p_twibbon_completed boolean default false,
  p_social_platform text default null,
  p_social_username text default null,
  p_referral_code text default null,
  p_integrity_agreed boolean default false
)
returns public.registrations
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  v_registration public.registrations;
begin
  if auth.uid() is null then
    raise exception 'AUTHORIZATION_REQUIRED';
  end if;
  if p_integrity_agreed is not true then
    raise exception 'INTEGRITY_AGREEMENT_REQUIRED';
  end if;

  v_registration := public.register_for_competition(
    p_competition_id,
    p_participation_key,
    p_competition_level_id,
    p_social_proof_url,
    p_twibbon_completed,
    p_social_platform,
    p_social_username,
    p_referral_code
  );

  update public.registrations
  set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'integrity_agreed', true,
        'integrity_agreed_at', clock_timestamp(),
        'integrity_version', 'SYKA-COMPETITION-2026-01'
      ),
      updated_at = clock_timestamp()
  where id = v_registration.id
  returning * into v_registration;

  return v_registration;
end;
$function$;

revoke all on function public.register_for_competition_with_integrity(uuid,text,uuid,text,boolean,text,text,text,boolean) from public, anon;
grant execute on function public.register_for_competition_with_integrity(uuid,text,uuid,text,boolean,text,text,text,boolean) to authenticated;

commit;
