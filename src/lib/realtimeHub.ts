import { supabase } from '@/lib/supabase';
import { emitSykaEvent } from '@/lib/realtimeBus';
import { clearPublicCache, invalidateForRealtime } from '@/lib/cacheRegistry';
import { applyFeedRealtimeChange } from '@/lib/feedRealtime';
import { applyCompetitionRealtimeChange, invalidateLeaderboardMemory } from '@/services/platform.service';
import { applyChatRealtimeThread, removeChatRealtimeThread } from '@/services/chat.service';
import { reconcileAfterRealtimeReconnect } from '@/services/realtime-reconciliation.service';

type Cleanup = () => void;
let publicCleanup: Cleanup | null = null;
let userCleanup: Cleanup | null = null;
let activeUserId: string | null = null;
let activeIsAdmin = false;

function removeChannel(channel: ReturnType<typeof supabase.channel>) { void supabase.removeChannel(channel); }

export function startPublicRealtime(): Cleanup {
  if (publicCleanup) return publicCleanup;
  let wasDegraded = false;
  const channel = supabase.channel('syka-public-sync-v1')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'competitions' }, (payload) => {
      const row = (payload.new ?? payload.old ?? {}) as Record<string, unknown>;
      const eventType = payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE';
      applyCompetitionRealtimeChange(eventType, row);
      emitSykaEvent({ type: 'competition-changed', competition: row });
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
      clearPublicCache(['home']);
    })
    .subscribe((status, error) => {
      if (status === 'SUBSCRIBED') {
        emitSykaEvent({ type: 'realtime-status', scope: 'public', status: 'subscribed', reconnected: wasDegraded });
        wasDegraded = false;
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        wasDegraded = true;
        console.warn('[SykaBelajar] public realtime degraded:', status, error);
        emitSykaEvent({ type: 'realtime-status', scope: 'public', status: 'degraded', reconnected: false });
      } else if (status === 'CLOSED') {
        wasDegraded = true;
        emitSykaEvent({ type: 'realtime-status', scope: 'public', status: 'closed', reconnected: false });
      }
    });
  publicCleanup = () => { removeChannel(channel); publicCleanup = null; };
  return publicCleanup;
}

export function startUserRealtime(userId: string, isAdmin = false): Cleanup {
  if (userCleanup && activeUserId === userId && activeIsAdmin === isAdmin) return userCleanup;
  stopUserRealtime();
  let wasDegraded = false;
  const channel = supabase.channel(`syka-user-sync-v2-${userId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles', filter: `id=eq.${userId}` }, (payload) => {
      invalidateForRealtime('profile', userId);
      invalidateLeaderboardMemory();
      emitSykaEvent({ type: 'profile-updated', userId, fields: Object.keys((payload.new ?? {}) as Record<string, unknown>) });
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, (payload) => {
      invalidateForRealtime('notification', userId);
      const row = (payload.new ?? payload.old ?? {}) as Record<string, unknown>;
      const notificationId = String(row.id ?? '');
      if (payload.eventType === 'INSERT' && notificationId) emitSykaEvent({ type: 'notification-inserted', notificationId, notification: row });
      else if (payload.eventType === 'UPDATE' && notificationId) emitSykaEvent({ type: 'notification-read', notificationId });
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
    .on('postgres_changes', { event: '*', schema: 'public', table: 'organizer_members', filter: `user_id=eq.${userId}` }, (payload) => {
      const row = (payload.new ?? payload.old ?? {}) as Record<string, unknown>;
      emitSykaEvent({ type: 'organizer-changed', organizerId: String(row.organizer_id ?? '') || undefined });
    });

  const handleThreadChange = (payload: any) => {
    const row = (payload.new ?? payload.old ?? {}) as Record<string, unknown>;
    const threadId = String(row.id ?? '');
    if (threadId && payload.eventType === 'DELETE') removeChatRealtimeThread(threadId);
    else if (threadId) applyChatRealtimeThread(row as never);
    emitSykaEvent({ type: 'chat-thread-updated', thread: row });
  };

  if (isAdmin) {
    channel.on('postgres_changes', { event: '*', schema: 'public', table: 'chat_threads' }, handleThreadChange);
  } else {
    channel.on('postgres_changes', { event: '*', schema: 'public', table: 'chat_threads', filter: `user_id=eq.${userId}` }, handleThreadChange);
    channel.on('postgres_changes', { event: '*', schema: 'public', table: 'chat_threads', filter: `participant_id=eq.${userId}` }, handleThreadChange);
  }

  if (isAdmin) {
    channel.on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: 'payment_proof_status=eq.SUBMITTED' }, (payload) => {
      emitSykaEvent({ type: 'order-changed', order: payload.new as Record<string, unknown> });
    });
  }

  channel.subscribe((status, error) => {
    if (status === 'SUBSCRIBED') {
      const reconnected = wasDegraded;
      emitSykaEvent({ type: 'realtime-status', scope: 'user', status: 'subscribed', reconnected });
      wasDegraded = false;
      if (reconnected) void reconcileAfterRealtimeReconnect('user', userId);
    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
      wasDegraded = true;
      console.warn('[SykaBelajar] user realtime degraded:', status, error);
      emitSykaEvent({ type: 'realtime-status', scope: 'user', status: 'degraded', reconnected: false });
    } else if (status === 'CLOSED') {
      wasDegraded = true;
      emitSykaEvent({ type: 'realtime-status', scope: 'user', status: 'closed', reconnected: false });
    }
  });

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

export function stopUserRealtime() { userCleanup?.(); }
export function stopPublicRealtime() { publicCleanup?.(); }