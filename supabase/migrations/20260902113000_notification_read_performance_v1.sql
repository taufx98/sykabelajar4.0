create index if not exists idx_notifications_user_unread
on public.notifications (user_id, created_at desc)
where read_at is null;
