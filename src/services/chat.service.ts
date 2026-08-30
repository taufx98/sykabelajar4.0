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

// ═══════════════════════════════════════
// TICKET SYSTEM (Hubungi Admin)
// ═══════════════════════════════════════

/** Create a helpdesk ticket thread with admin */
export async function createTicketThread(subject: string, description: string): Promise<ChatThread> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error('Unauthorized');

  // Find an admin user
  const { data: adminRole } = await supabase
    .from('user_roles')
    .select('user_id')
    .eq('role', 'admin')
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();

  const adminId = adminRole?.user_id;

  // Create ticket thread
  const { data: thread, error: tErr } = await supabase
    .from('chat_threads')
    .insert({
      user_id: auth.user.id,
      participant_id: adminId || null,
      status: 'open',
      thread_type: 'ticket',
      subject: subject.trim(),
      description: description.trim(),
    })
    .select()
    .single();
  if (tErr) throw tErr;

  // Send first message with subject & description
  const firstMsg = `📋 *${subject.trim()}*\n\n${description.trim()}`;
  await sendMessage(thread.id, firstMsg);

  return thread as ChatThread;
}

// ═══════════════════════════════════════
// DM FROM PROFILE (Redirect)
// ═══════════════════════════════════════

/** Create DM thread from profile page and return thread */
export async function createDmFromProfile(targetUserId: string): Promise<ChatThread> {
  return getOrCreateDmThread(targetUserId);
}

// ═══════════════════════════════════════
// FOLLOW WITH APPROVAL
// ═══════════════════════════════════════

/** Check if a follow request is approved */
export async function isFollowApproved(followerId: string, followingId: string): Promise<boolean> {
  const { data } = await supabase
    .from('follows')
    .select('status')
    .eq('follower_id', followerId)
    .eq('following_id', followingId)
    .maybeSingle();
  if (!data) return false;
  return data.status === 'approved' || data.status === 'auto';
}

/** Get follow status between two users */
export async function getFollowStatus(followerId: string, followingId: string): Promise<'none' | 'pending' | 'approved'> {
  const { data } = await supabase
    .from('follows')
    .select('status')
    .eq('follower_id', followerId)
    .eq('following_id', followingId)
    .maybeSingle();
  if (!data) return 'none';
  if (data.status === 'pending') return 'pending';
  return 'approved';
}

/** Accept a follow request */
export async function acceptFollow(followerId: string, followingId: string): Promise<void> {
  await supabase
    .from('follows')
    .update({ status: 'approved' })
    .eq('follower_id', followerId)
    .eq('following_id', followingId);
}

/** Reject a follow request */
export async function rejectFollow(followerId: string, followingId: string): Promise<void> {
  await supabase
    .from('follows')
    .delete()
    .eq('follower_id', followerId)
    .eq('following_id', followingId);
}

/** Get user privacy setting */
export async function getUserPrivacy(userId: string): Promise<string> {
  const { data } = await supabase
    .from('profiles')
    .select('accept_messages')
    .eq('id', userId)
    .maybeSingle();
  return (data as any)?.accept_messages ?? 'public';
}

/** Check if current user can DM target user */
export async function canDmUser(currentUserId: string, targetUserId: string): Promise<boolean> {
  const privacy = await getUserPrivacy(targetUserId);
  if (privacy === 'public') return true;
  if (privacy === 'private') return false;
  // 'followers' — check if follow is approved
  return isFollowApproved(currentUserId, targetUserId);
}
