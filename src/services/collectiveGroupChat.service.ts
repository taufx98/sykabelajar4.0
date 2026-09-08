import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';
import { reportRealtimeError, reportRpcError } from '@/lib/errorIntelligence';
import type { ChatGroup, ChatGroupMember, ChatGroupMessage } from '@/services/chat.service';

let participantClient: SupabaseClient | null = null;
let participantReady = false;

function getParticipantClient() {
  if (participantClient) return participantClient;
  participantClient = createClient(env.supabaseUrl, env.supabasePublishableKey, {
    auth: { persistSession: false, autoRefreshToken: true, detectSessionInUrl: false },
  });
  return participantClient;
}

async function ensureParticipantClient() {
  const client = getParticipantClient();
  if (!participantReady) {
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    if (!data.session) {
      const { error: signInError } = await client.auth.signInAnonymously();
      if (signInError) throw signInError;
    }
    participantReady = true;
  }
  return client;
}

function tokenRequired(token: string | null | undefined) {
  const value = String(token ?? '').trim();
  if (!value) throw new Error('COLLECTIVE_SESSION_INVALID');
  return value;
}

function normalizeError(error: unknown) {
  const message = String((error as { message?: string } | null)?.message ?? error ?? 'Terjadi kesalahan.');
  const map: Record<string, string> = {
    COLLECTIVE_SESSION_INVALID: 'Sesi peserta kolektif sudah tidak valid. Silakan buka kembali portal peserta.',
    ACCESS_DENIED: 'Kamu tidak memiliki akses ke group ini.',
    GROUP_INVITE_INVALID: 'Link undangan group tidak valid atau sudah tidak aktif.',
    GROUP_EVENT_NOT_ELIGIBLE: 'Group event ini hanya dapat diikuti peserta dari lomba yang sesuai.',
    GROUP_NOT_FOUND: 'Group tidak ditemukan.',
    CHAT_RATE_LIMIT: 'Pesan terlalu sering. Coba lagi sebentar lagi.',
    CHAT_DUPLICATE: 'Pesan yang sama baru saja dikirim.',
    CHAT_BODY_INVALID: 'Pesan harus berisi 1–2000 karakter.',
  };
  const key = Object.keys(map).find((item) => message.includes(item));
  return new Error(key ? map[key] : message);
}

export async function listCollectiveChatGroups(accessToken: string) {
  const client = await ensureParticipantClient();
  const { data, error } = await client.rpc('list_collective_chat_groups', { p_access_token: tokenRequired(accessToken) });
  if (error) { reportRpcError(error, 'list_collective_chat_groups'); throw normalizeError(error); }
  return (data ?? []) as ChatGroup[];
}

export async function loadCollectiveChatGroupMessages(accessToken: string, groupId: string, limit = 50, before?: string | null) {
  const client = await ensureParticipantClient();
  const { data, error } = await client.rpc('get_collective_chat_group_messages', {
    p_access_token: tokenRequired(accessToken),
    p_group_id: groupId,
    p_limit: Math.min(Math.max(limit, 1), 100),
    p_before: before ?? null,
  });
  if (error) { reportRpcError(error, 'get_collective_chat_group_messages', { groupId }); throw normalizeError(error); }
  return [...((data ?? []) as ChatGroupMessage[])].reverse();
}

export async function sendCollectiveChatGroupMessage(accessToken: string, groupId: string, body: string) {
  const client = await ensureParticipantClient();
  const text = body.trim();
  if (!text) throw new Error('CHAT_BODY_INVALID');
  const { data, error } = await client.rpc('send_collective_chat_group_message', {
    p_access_token: tokenRequired(accessToken),
    p_group_id: groupId,
    p_body: text,
  });
  if (error) { reportRpcError(error, 'send_collective_chat_group_message', { groupId }); throw normalizeError(error); }
  return data as ChatGroupMessage;
}

export async function listCollectiveChatGroupMembers(accessToken: string, groupId: string) {
  const client = await ensureParticipantClient();
  const { data, error } = await client.rpc('list_collective_chat_group_members', {
    p_access_token: tokenRequired(accessToken),
    p_group_id: groupId,
  });
  if (error) { reportRpcError(error, 'list_collective_chat_group_members', { groupId }); throw normalizeError(error); }
  return (data ?? []) as ChatGroupMember[];
}

export async function markCollectiveChatGroupRead(accessToken: string, groupId: string) {
  const client = await ensureParticipantClient();
  const { data, error } = await client.rpc('mark_collective_chat_group_read', {
    p_access_token: tokenRequired(accessToken),
    p_group_id: groupId,
  });
  if (error) { reportRpcError(error, 'mark_collective_chat_group_read', { groupId }); throw normalizeError(error); }
  return Boolean(data);
}

export async function joinCollectiveChatGroup(accessToken: string, inviteToken: string) {
  const client = await ensureParticipantClient();
  const { data, error } = await client.rpc('join_collective_chat_group', {
    p_access_token: tokenRequired(accessToken),
    p_invite_token: tokenRequired(inviteToken),
  });
  if (error) { reportRpcError(error, 'join_collective_chat_group'); throw normalizeError(error); }
  return data as { ok: boolean; group_id: string; name: string };
}

export async function subscribeCollectiveGroupChat(input: {
  groupId: string;
  accessToken: string;
  onInsert: (message: ChatGroupMessage) => void;
  onError?: (error: Error) => void;
}) {
  try {
    const client = await ensureParticipantClient();
    const { error: bindError } = await client.rpc('bind_collective_chat_realtime' as never, { p_access_token: tokenRequired(input.accessToken) } as never);
    if (bindError) {
      reportRpcError(bindError, 'bind_collective_chat_realtime', { groupId: input.groupId });
      throw bindError;
    }
    const channel = client.channel(`collective-group-chat:${input.groupId}`).on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'chat_group_messages', filter: `group_id=eq.${input.groupId}` },
      (payload) => input.onInsert(payload.new as ChatGroupMessage),
    ).subscribe((status) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        const error = new Error(`Realtime chat group gagal (${status}).`);
        reportRealtimeError(error, { channel: `collective-group-chat:${input.groupId}`, table: 'chat_group_messages', status });
        input.onError?.(error);
      }
    });
    return () => { void client.removeChannel(channel as RealtimeChannel); };
  } catch (error) {
    const normalized = error instanceof Error ? error : new Error('Gagal menghubungkan realtime chat group.');
    reportRealtimeError(normalized, { channel: `collective-group-chat:${input.groupId}`, table: 'chat_group_messages' });
    input.onError?.(normalized);
    return () => undefined;
  }
}
