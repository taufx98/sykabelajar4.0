import { supabase } from '@/lib/supabase';
import { emitSykaEvent } from '@/lib/realtimeBus';

type Cleanup = () => void;

let publicCleanup: Cleanup | null = null;
let userCleanup: Cleanup | null = null;
let activeUserId: string | null = null;
let activeIsAdmin = false;

function removeChannel(channel: ReturnType<typeof supabase.channel>) {
  void supabase.removeChannel(channel);
}

export function startPublicRealtime(): Cleanup {
  if (publicCleanup) return publicCleanup;

  const channel = supabase
    .channel('syka-public-sync-v1')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'competitions' }, (payload) => {
      emitSykaEvent({ type: 'competition-changed', competition: payload.new as Record<string, unknown> });
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'ad_banners' }, (payload) => {
      emitSykaEvent({ type: 'banner-changed', banner: payload.new as Record<string, unknown> });
    })
    .subscribe();

  publicCleanup = () => {
    removeChannel(channel);
    publicCleanup = null;
  };
  return publicCleanup;
}

export function startUserRealtime(userId: string, isAdmin = false): Cleanup {
  if (userCleanup && activeUserId === userId && activeIsAdmin === isAdmin) return userCleanup;
  stopUserRealtime();

  const channel = supabase
    .channel(`syka-user-sync-v1-${userId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles', filter: `id=eq.${userId}` }, (payload) => {
      emitSykaEvent({ type: 'profile-updated', userId, fields: Object.keys((payload.new ?? {}) as Record<string, unknown>) });
    })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, (payload) => {
      const notificationId = String((payload.new as Record<string, unknown>)?.id ?? '');
      if (notificationId) emitSykaEvent({ type: 'notification-inserted', notificationId });
    })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, (payload) => {
      emitSykaEvent({ type: 'chat-message', message: payload.new as Record<string, unknown> });
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'chat_threads' }, (payload) => {
      emitSykaEvent({ type: 'chat-thread-updated', thread: payload.new as Record<string, unknown> });
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'follows' }, (payload) => {
      const row = (payload.new ?? payload.old ?? {}) as Record<string, unknown>;
      const followerId = String(row.follower_id ?? '');
      const followingId = String(row.following_id ?? '');
      if (followerId === userId || followingId === userId) {
        emitSykaEvent({ type: 'follow-updated', userId: followerId === userId ? followingId : followerId, status: String(row.status ?? 'none') });
      }
    });

  if (isAdmin) {
    channel.on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, (payload) => {
      emitSykaEvent({ type: 'order-changed', order: payload.new as Record<string, unknown> });
    });
  }

  channel.subscribe();
  activeUserId = userId;
  activeIsAdmin = isAdmin;
  userCleanup = () => {
    removeChannel(channel);
    userCleanup = null;
    activeUserId = null;
    activeIsAdmin = false;
  };
  return userCleanup;
}

export function stopUserRealtime() {
  userCleanup?.();
}

export function stopPublicRealtime() {
  publicCleanup?.();
}
