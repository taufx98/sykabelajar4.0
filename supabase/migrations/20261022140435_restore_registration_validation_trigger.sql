begin;

-- Restore the trigger that enforces the server-side participant registration rules.
-- This ensures normal registration and Coin Edu bypass both still validate
-- schedule, duplicate registration, eligibility, capacity and platform URLs.
drop trigger if exists trg_validate_registration_insert on public.registrations;

create trigger trg_validate_registration_insert
before insert on public.registrations
for each row execute function public.validate_registration_insert();

comment on trigger trg_validate_registration_insert on public.registrations
  is 'Enforces server-side participant registration rules; Coin Edu bypass can skip only Twibbon/social proof checks within the registration transaction.';

commit;
