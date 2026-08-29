import { supabase } from '@/lib/supabase';

export interface ChatThread {
  id: string;
  user_id: string;
  status: 'open' | 'closed';
  rating: number | null;
  closed_at: string | null;
  created_at: string;
  // Joined fields
  user_name?: string;
  username?: string;
  avatar_url?: string;
  last_message?: string;
  unread_count?: number;
}

export interface ChatMessage {
  id: string;
  thread_id: string;
  sender_id: string;
  body: string;
  created_at: string;
}

// ── User: get or create own thread ──
export async function getOrCreateThread(): Promise<ChatThread> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error('Unauthorized');

  // Try to find existing open thread
  const { data: existing } = await supabase
    .from('chat_threads')
    .select('*')
    .eq('user_id', auth.user.id)
    .eq('status', 'open')
    .maybeSingle();

  if (existing) return existing as ChatThread;

  // Create new thread
  const { data, error } = await supabase
    .from('chat_threads')
    .insert({ user_id: auth.user.id, status: 'open' })
    .select()
    .single();
  if (error) throw error;
  return data as ChatThread;
}

// ── User: send message ──
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

// ── User: load own messages ──
export async function loadMyMessages(threadId: string): Promise<ChatMessage[]> {
  const { data } = await supabase
    .from('chat_messages')
    .select('*')
    .eq('thread_id', threadId)
    .order('created_at', { ascending: true });
  return (data ?? []) as ChatMessage[];
}

// ── User: submit rating ──
export async function submitRating(threadId: string, rating: number): Promise<void> {
  await supabase
    .from('chat_threads')
    .update({ rating, status: 'closed', closed_at: new Date().toISOString() })
    .eq('id', threadId);
  // Delete all messages (cleanup)
  await supabase.from('chat_messages').delete().eq('thread_id', threadId);
}

// ── User: load own thread status ──
export async function loadMyThread(): Promise<ChatThread | null> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const { data } = await supabase
    .from('chat_threads')
    .select('*')
    .eq('user_id', auth.user.id)
    .maybeSingle();
  return (data as ChatThread) ?? null;
}

// ═══════════════════════════════════════
// ADMIN FUNCTIONS
// ═══════════════════════════════════════

// ── Admin: load all threads with user info ──
export async function adminLoadThreads(): Promise<ChatThread[]> {
  const { data, error } = await supabase
    .from('chat_threads')
    .select('*, public_profiles:user_id(full_name, username, avatar_url)')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((t: any) => ({
    ...t,
    user_name: t.public_profiles?.full_name || 'User',
    username: t.public_profiles?.username || '',
    avatar_url: t.public_profiles?.avatar_url || null,
  })) as ChatThread[];
}

// ── Admin: load messages for a thread ──
export async function adminLoadMessages(threadId: string): Promise<ChatMessage[]> {
  const { data } = await supabase
    .from('chat_messages')
    .select('*')
    .eq('thread_id', threadId)
    .order('created_at', { ascending: true });
  return (data ?? []) as ChatMessage[];
}

// ── Admin: send message as admin ──
export async function adminSendMessage(threadId: string, body: string): Promise<ChatMessage> {
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

// ── Admin: close thread (triggers cleanup) ──
export async function adminCloseThread(threadId: string): Promise<void> {
  await supabase
    .from('chat_threads')
    .update({ status: 'closed', closed_at: new Date().toISOString() })
    .eq('id', threadId);
  // Delete all messages (cleanup to save data)
  await supabase.from('chat_messages').delete().eq('thread_id', threadId);
}
