import { supabase } from '@/lib/supabase';

/** Fetch all notifications for a user */
export async function listNotifications(userId: string) {
  const { data, error } = await supabase
    .from('notifications')
    .select('id,type,title,body,data,read_at,created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** Get the count of unread notifications (for sidebar badge) */
export async function getUnreadNotificationCount(userId: string): Promise<number> {
  const { count, error } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .is('read_at', null);
  if (error) return 0;
  return count ?? 0;
}

/** Mark a single notification as read */
export async function markNotificationRead(userId: string, notificationId: string) {
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', notificationId)
    .eq('user_id', userId);
  if (error) throw error;
}

/** Mark all notifications as read */
export async function markAllNotificationsRead(userId: string) {
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('user_id', userId)
    .is('read_at', null);
  if (error) throw error;
}
