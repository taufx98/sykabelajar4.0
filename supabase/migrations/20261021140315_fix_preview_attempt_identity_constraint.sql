begin;

-- Official attempts still require exactly one participant identity. Organizer
-- previews intentionally have neither individual nor collective participant IDs.
alter table public.attempts
  drop constraint if exists attempts_one_participant_identity_chk;

alter table public.attempts
  add constraint attempts_one_participant_identity_chk
  check (
    (
      is_preview = true
      and preview_owner_id is not null
      and participant_id is null
      and collective_participant_id is null
      and canonical_participant_id is null
      and registration_id is null
    )
    or
    (
      is_preview = false
      and ((participant_id is not null) <> (collective_participant_id is not null))
    )
  );

commit;
