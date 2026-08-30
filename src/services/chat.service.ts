import { supabase } from '@/lib/supabase';

export interface ChatThread {
  id: string;
  user_id: string;
  participant_id?: string | null;
  status: 'open' | 'closed';
  rating: number | null;
  closed_at: string | null;
  created_at: string;
  // Joined fields
  user_name?: string;
  username?: string;
  avatar_url?: string;
  other_user_name?: string;
  other_username?: string;
  other_avatar_url?: string;
  last_message?: string;
  last_message_at?: string;
  unread_count?: number;
}

export interface ChatMessage {
  id: string;
  thread_id: string;
  sender_id: string;
  body: string;
  created_at: string;
}

// ═══════════════════════════════════════
// USER FUNCTIONS
// ═══════════════════════════════════════

/** Get or create a DM thread with another user */
export async function getOrCreateDmThread(otherUserId: string): Promise<ChatThread> {
  const { data, error } = await supabase.rpc('get_or_create_dm_thread', {
    p_other_user_id: otherUserId,
  });
  if (error) throw error;
  return data as ChatThread;
}

/** Load all threads for current user (DMs + admin threads) */
export async function loadMyThreads(): Promise<ChatThread[]> {
  const { data, error } = await supabase.rpc('load_my_threads');
  if (error) throw error;
  return (data ?? []) as ChatThread[];
}

/** Send a message in a thread */
export async function sendMessage(threadId: string, body: string): Promise<ChatMessage> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error('Unauthorized');

  const { data, error } = await supabase
    .from('chat_messages')
    .insert({ thread_id: threadId, sender_id: auth.user.id, body: body.trim() })
    .select()
    .single();
  if (error) throw error;
  return data as ChatMessage;
}

/** Load messages for a thread */
export async function loadMessages(threadId: string): Promise<ChatMessage[]> {
  const { data } = await supabase
    .from('chat_messages')
    .select('*')
    .eq('thread_id', threadId)
    .order('created_at', { ascending: true });
  return (data ?? []) as ChatMessage[];
}

/** Submit rating and close thread */
export async function submitRating(threadId: string, rating: number): Promise<void> {
  await supabase
    .from('chat_threads')
    .update({ rating, status: 'closed', closed_at: new Date().toISOString() })
    .eq('id', threadId);
  await supabase.from('chat_messages').delete().eq('thread_id', threadId);
}

/** Legacy: get or create thread for current user (admin support chat) */
export async function getOrCreateThread(): Promise<ChatThread> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error('Unauthorized');

  const { data: existing } = await supabase
    .from('chat_threads')
    .select('*')
    .eq('user_id', auth.user.id)
    .eq('status', 'open')
    .is('participant_id', null)
    .maybeSingle();

  if (existing) return existing as ChatThread;

  const { data, error } = await supabase
    .from('chat_threads')
    .insert({ user_id: auth.user.id, status: 'open' })
    .select()
    .single();
  if (error) throw error;
  return data as ChatThread;
}

// ═══════════════════════════════════════
// SEARCH USERS FOR NEW CHAT
// ═══════════════════════════════════════

export interface SearchUserResult {
  id: string;
  username: string;
  full_name: string;
  avatar_url: string | null;
}

// Backward compat aliases for ChatWidget
export const loadMyThread = async (): Promise<ChatThread | null> => {
  const threads = await loadMyThreads();
  return threads.find(t => t.status === 'open' && !t.participant_id) ?? null;
};
export const loadMyMessages = loadMessages;

export async function searchUsersForChat(query: string, limit = 10): Promise<SearchUserResult[]> {
  if (!query.trim()) return [];
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return [];

  const { data } = await supabase
    .from('profiles')
    .select('id,username,full_name,avatar_url')
    .or(`full_name.ilike.%${query}%,username.ilike.%${query}%`)
    .neq('id', auth.user.id)
    .limit(limit);
  return (data ?? []).map((r: any) => ({
    id: r.id,
    username: r.username ?? '',
    full_name: r.full_name ?? '',
    avatar_url: r.avatar_url ?? null,
  }));
}
