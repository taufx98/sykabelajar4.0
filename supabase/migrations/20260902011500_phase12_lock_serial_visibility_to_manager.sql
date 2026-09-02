drop policy if exists organizer_serials_select on public.organizer_serials;

create policy organizer_serials_select on public.organizer_serials
for select to authenticated
using (
  (select private.current_user_is_admin())
  or (select private.current_user_can_manage_organizer(organizer_id))
);
