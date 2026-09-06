import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';
import { supabase } from '@/lib/supabase';

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
        if (error) throw error;
        participantReady = true;
      }
      const { error } = await client.rpc('collective_realtime_bind' as never, {
        p_access_token: input.accessToken,
      } as never);
      if (error) throw error;
    }

    const channel = client
      .channel(`collective-chat:${input.competitionId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'collective_chat_messages',
          filter: `competition_id=eq.${input.competitionId}`,
        },
        () => input.onInsert(),
      )
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          input.onError?.(new Error('Realtime chat sementara tidak terhubung.'));
        }
      });

    return () => {
      void client.removeChannel(channel as RealtimeChannel);
    };
  } catch (error) {
    input.onError?.(error instanceof Error ? error : new Error('Gagal menghubungkan realtime chat.'));
    return () => undefined;
  }
}
