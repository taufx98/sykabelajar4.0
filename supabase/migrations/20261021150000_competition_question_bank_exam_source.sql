begin;

-- A competition can choose one existing organizer-owned question bank without
-- moving/copying source questions or introducing another table.
alter table public.competitions
  add column if not exists question_bank_id uuid null
    references public.question_banks(id) on delete set null;

create index if not exists competitions_question_bank_id_idx
  on public.competitions(question_bank_id)
  where question_bank_id is not null;

create or replace function private.guard_competition_question_bank()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bank_organizer_id uuid;
begin
  if new.question_bank_id is null then
    return new;
  end if;

  select qb.organizer_id into v_bank_organizer_id
  from public.question_banks qb
  where qb.id = new.question_bank_id;

  if v_bank_organizer_id is null
     or v_bank_organizer_id is distinct from new.organizer_id then
    raise exception 'QUESTION_BANK_NOT_OWNED_BY_COMPETITION_ORGANIZER';
  end if;

  return new;
end;
$$;

revoke all on function private.guard_competition_question_bank() from public, anon, authenticated;

drop trigger if exists guard_competition_question_bank on public.competitions;
create trigger guard_competition_question_bank
before insert or update of question_bank_id, organizer_id
on public.competitions
for each row execute function private.guard_competition_question_bank();

-- Include PUBLISHED, unassigned questions from the competition's selected bank.
-- Directly competition-linked questions remain supported; the two sources do not
-- overlap because bank questions are included only when competition_id is null.
do $migration$
declare
  v_definition text;
  v_old_count text := 'where competition_id = v_attempt.competition_id and status = ''PUBLISHED''';
  v_new_count text := 'where status = ''PUBLISHED'' and (competition_id = v_attempt.competition_id or (question_bank_id = v_comp.question_bank_id and competition_id is null))';
  v_old_loop text := 'where q.competition_id = v_attempt.competition_id and q.status = ''PUBLISHED''';
  v_new_loop text := 'where q.status = ''PUBLISHED'' and (q.competition_id = v_attempt.competition_id or (q.question_bank_id = v_comp.question_bank_id and q.competition_id is null))';
begin
  select pg_get_functiondef('private.prepare_linear_exam_runtime(uuid)'::regprocedure)
    into v_definition;

  if position(v_old_count in v_definition) = 0 then
    raise exception 'QUESTION_BANK_RUNTIME_COUNT_ANCHOR_NOT_FOUND';
  end if;
  if position(v_old_loop in v_definition) = 0 then
    raise exception 'QUESTION_BANK_RUNTIME_LOOP_ANCHOR_NOT_FOUND';
  end if;

  v_definition := replace(v_definition, v_old_count, v_new_count);
  v_definition := replace(v_definition, v_old_loop, v_new_loop);
  execute v_definition;
end;
$migration$;

-- Release validates the same effective question set that the linear engine loads.
do $migration$
declare
  v_definition text;
  v_old_count text := 'where competition_id=p_competition_id and status=''PUBLISHED''';
  v_new_count text := 'where status=''PUBLISHED'' and (competition_id=p_competition_id or (question_bank_id=v_comp.question_bank_id and competition_id is null))';
begin
  select pg_get_functiondef('public.release_organizer_competition(uuid)'::regprocedure)
    into v_definition;

  if position(v_old_count in v_definition) = 0 then
    raise exception 'QUESTION_BANK_RELEASE_COUNT_ANCHOR_NOT_FOUND';
  end if;

  v_definition := replace(v_definition, v_old_count, v_new_count);
  execute v_definition;
end;
$migration$;

commit;
