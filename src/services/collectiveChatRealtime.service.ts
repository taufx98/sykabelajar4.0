import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';
import { supabase } from '@/lib/supabase';
import { reportRealtimeError, reportRpcError } from '@/lib/errorIntelligence';

let participantClient: SupabaseClient | null = null;
let participantReady = false;

function getParticipantClient() {
  if (participantClient) return participantClient;
  participantClient = createClient(env.supabaseUrl, env.supabasePublishableKey, {
    auth: { persistSession: false, autoRefreshToken: true, detectSessionInUrl: false },
  });
  return participantClient;
}

export async function subscribeCollectiveChat(input: {
  competitionId: string;
  accessToken?: string;
  onInsert: () => void;
  onError?: (error: Error) => void;
}) {
  const participantMode = Boolean(input.accessToken);
  const client = participantMode ? getParticipantClient() : supabase;
  try {
    if (participantMode) {
      const { data: session } = await client.auth.getSession();
      if (!session.session || !participantReady) {
        const { error } = await client.auth.signInAnonymously();
        if (error) {
          reportRpcError(error, 'anonymous_sign_in', { surface: 'collective_chat_realtime' });
          throw error;
        }
        participantReady = true;
      }
      const { error } = await client.rpc('bind_collective_chat_realtime' as never, { p_access_token: input.accessToken } as never);
      if (error) {
        reportRpcError(error, 'bind_collective_chat_realtime', { competitionId: input.competitionId });
        throw error;
      }
    }
    const channel = client.channel(`collective-chat:${input.competitionId}`).on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'collective_chat_messages', filter: `competition_id=eq.${input.competitionId}` },
      () => input.onInsert(),
    ).subscribe((status) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        const error = new Error(`Realtime chat sementara tidak terhubung (${status}).`);
        reportRealtimeError(error, { channel: `collective-chat:${input.competitionId}`, table: 'collective_chat_messages', status });
        input.onError?.(error);
      }
    });
    return () => { void client.removeChannel(channel as RealtimeChannel); };
  } catch (error) {
    const normalized = error instanceof Error ? error : new Error('Gagal menghubungkan realtime chat.');
    reportRealtimeError(normalized, { channel: `collective-chat:${input.competitionId}`, table: 'collective_chat_messages' });
    input.onError?.(normalized);
    return () => undefined;
  }
}
