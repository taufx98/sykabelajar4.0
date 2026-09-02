import { supabase } from '@/lib/supabase';

const NOTIFICATION_LIST_LIMIT = 50;
const UNREAD_CACHE_MS = 30_000;
const unreadCache = new Map<string, { value: number; expiresAt: number }>();
const unreadInFlight = new Map<string, Promise<number>>();

function invalidateUnread(userId: string) {
  unreadCache.delete(userId);
}

/** Fetch the latest notifications for a user, bounded to keep home/session reads predictable. */
export async function listNotifications(userId: string) {
  const { data, error } = await supabase
    .from('notifications')
    .select('id,type,title,body,data,read_at,created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(NOTIFICATION_LIST_LIMIT);
  if (error) throw error;
  return data ?? [];
}

/** Get the count of unread notifications (for sidebar badge), with short-lived dedupe/cache. */
export async function getUnreadNotificationCount(userId: string, force = false): Promise<number> {
  const now = Date.now();
  const cached = unreadCache.get(userId);
  if (!force && cached && cached.expiresAt > now) return cached.value;
  if (!force) {
    const inFlight = unreadInFlight.get(userId);
    if (inFlight) return inFlight;
  }
  const request = (async () => {
    const { count, error } = await supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .is('read_at', null);
    if (error) throw error;
    const value = count ?? 0;
    unreadCache.set(userId, { value, expiresAt: Date.now() + UNREAD_CACHE_MS });
    return value;
  })();
  unreadInFlight.set(userId, request);
  try {
    return await request;
  } catch {
    return cached?.value ?? 0;
  } finally {
    if (unreadInFlight.get(userId) === request) unreadInFlight.delete(userId);
  }
}

/** Mark a single notification as read */
export async function markNotificationRead(userId: string, notificationId: string) {
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', notificationId)
    .eq('user_id', userId);
  if (error) throw error;
  invalidateUnread(userId);
}

/** Mark all notifications as read */
export async function markAllNotificationsRead(userId: string) {
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('user_id', userId)
    .is('read_at', null);
  if (error) throw error;
  invalidateUnread(userId);
}
