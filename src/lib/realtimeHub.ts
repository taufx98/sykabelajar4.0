import { supabase } from '@/lib/supabase';
import { emitSykaEvent } from '@/lib/realtimeBus';
import { clearPublicCache, invalidateForRealtime } from '@/lib/cacheRegistry';
import { applyFeedRealtimeChange } from '@/lib/feedRealtime';

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
      invalidateForRealtime('competition');
      emitSykaEvent({ type: 'competition-changed', competition: payload.new as Record<string, unknown> });
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'ad_banners' }, (payload) => {
      invalidateForRealtime('banner');
      emitSykaEvent({ type: 'banner-changed', banner: payload.new as Record<string, unknown> });
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'posts' }, (payload) => {
      const row = (payload.new ?? payload.old ?? {}) as Record<string, unknown>;
      const eventType = payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE';
      applyFeedRealtimeChange(eventType, row);
      emitSykaEvent({ type: 'feed-changed', postId: String(row.id ?? ''), eventType });
      // Home is a composite snapshot. Invalidate only that composite; the standalone
      // feed cache was patched above and remains available for instant UI rendering.
      clearPublicCache(['home']);
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
      invalidateForRealtime('profile', userId);
      emitSykaEvent({ type: 'profile-updated', userId, fields: Object.keys((payload.new ?? {}) as Record<string, unknown>) });
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, (payload) => {
      invalidateForRealtime('notification', userId);
      const row = (payload.new ?? payload.old ?? {}) as Record<string, unknown>;
      const notificationId = String(row.id ?? '');
      if (payload.eventType === 'INSERT' && notificationId) {
        emitSykaEvent({ type: 'notification-inserted', notificationId, notification: row });
      } else if (payload.eventType === 'UPDATE' && notificationId) {
        emitSykaEvent({ type: 'notification-read', notificationId });
      }
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'follows', filter: `follower_id=eq.${userId}` }, (payload) => {
      const row = (payload.new ?? payload.old ?? {}) as Record<string, unknown>;
      invalidateForRealtime('profile', userId);
      emitSykaEvent({ type: 'follow-updated', userId: String(row.following_id ?? ''), status: String(row.status ?? 'none') });
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'follows', filter: `following_id=eq.${userId}` }, (payload) => {
      const row = (payload.new ?? payload.old ?? {}) as Record<string, unknown>;
      invalidateForRealtime('profile', userId);
      emitSykaEvent({ type: 'follow-updated', userId: String(row.follower_id ?? ''), status: String(row.status ?? 'none') });
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_threads', filter: `user_id=eq.${userId}` }, (payload) => {
      const row = (payload.new ?? payload.old ?? {}) as Record<string, unknown>;
      if (isAdmin && String(row.thread_type ?? '') !== 'ticket') return;
      emitSykaEvent({ type: 'chat-thread-updated', thread: row });
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_threads', filter: `participant_id=eq.${userId}` }, (payload) => {
      const row = (payload.new ?? payload.old ?? {}) as Record<string, unknown>;
      if (isAdmin && String(row.thread_type ?? '') !== 'ticket') return;
      emitSykaEvent({ type: 'chat-thread-updated', thread: row });
    });

  // Chat messages are intentionally not subscribed globally here: a chat message row
  // only contains thread_id, so an unfiltered listener would stream every user's
  // message payload to every connected client. ChatWidget owns the active-thread
  // subscription and loads the message history through a scoped RPC.

  if (isAdmin) {
    channel.on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: 'payment_proof_status=eq.SUBMITTED' }, (payload) => {
      const order = payload.new as Record<string, unknown>;
      emitSykaEvent({ type: 'order-changed', order });
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
