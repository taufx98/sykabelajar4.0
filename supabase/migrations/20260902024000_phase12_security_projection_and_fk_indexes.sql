create or replace view public.certificate_verifications_public with (security_invoker = true) as
select certificate_id,
       verification_code,
       status,
       public_name,
       competition_title,
       achievement_title,
       issued_at,
       revoked_at
from public.certificate_verifications;

alter view public.certificate_verifications_public owner to postgres;

grant select (certificate_id, verification_code, status, public_name, competition_title, achievement_title, issued_at, revoked_at)
on public.certificate_verifications to anon, authenticated;

create policy certificate_verifications_public_select
on public.certificate_verifications
for select
to anon, authenticated
using (status in ('PUBLISHED'::public.certificate_status, 'REVOKED'::public.certificate_status));

revoke execute on function public.get_certificate_verification(text) from anon, authenticated;

drop index if exists public.organizers_one_owner_per_user_idx;

create index if not exists organizer_custom_plan_requests_reviewed_by_idx
on public.organizer_custom_plan_requests (reviewed_by);
