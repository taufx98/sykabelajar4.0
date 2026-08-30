import { toast } from '@/lib/toast';
import { useEffect, useState, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, MessageCircle, Send, CheckCircle, Star, Plus, Search, X, ShieldAlert } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Avatar } from '@/components/ui/Avatar';
import { useApp } from '@/store/AppContext';
import {
  loadMyThreads,
  loadMessages,
  sendMessage,
  getOrCreateDmThread,
  searchUsersForChat,
  type ChatThread,
  type ChatMessage,
  type SearchUserResult,
} from '@/services/chat.service';

export function AdminChatPage() {
  const { user, toast: appToast } = useApp();
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [selectedThread, setSelectedThread] = useState<ChatThread | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showNewChat, setShowNewChat] = useState(false);
  const messagesEnd = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadThreads = useCallback(async () => {
    try {
      const t = await loadMyThreads();
      setThreads(t);
    } catch (e: any) {
      appToast(e?.message ?? 'Gagal memuat chat.', 'error');
    } finally {
      setLoading(false);
    }
  }, [appToast]);

  useEffect(() => { void loadThreads(); }, [loadThreads]);

  // Load messages for selected thread
  const loadMsgs = useCallback(async () => {
    if (!selectedThread) return;
    try {
      const msgs = await loadMessages(selectedThread.id);
      setMessages(msgs);
    } catch {}
  }, [selectedThread]);

  useEffect(() => {
    if (selectedThread && selectedThread.status === 'open') {
      void loadMsgs();
      pollRef.current = setInterval(() => void loadMsgs(), 3000);
      return () => { if (pollRef.current) clearInterval(pollRef.current); };
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [selectedThread, loadMsgs]);

  // Auto scroll
  useEffect(() => {
    messagesEnd.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Refresh thread list when messages change
  useEffect(() => {
    if (messages.length > 0) void loadThreads();
  }, [messages.length, loadThreads]);

  const handleSend = async () => {
    if (!input.trim() || !selectedThread || sending) return;
    setSending(true);
    try {
      const msg = await sendMessage(selectedThread.id, input.trim());
      setMessages(prev => [...prev, msg]);
      setInput('');
    } catch (e: any) {
      appToast(e?.message ?? 'Gagal mengirim.', 'error');
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const startNewChat = async (targetUser: SearchUserResult) => {
    try {
      const thread = await getOrCreateDmThread(targetUser.id);
      setShowNewChat(false);
      await loadThreads();
      // Select the thread (may need to re-fetch from updated list)
      setSelectedThread({
        ...thread,
        other_user_name: targetUser.full_name,
        other_username: targetUser.username,
        other_avatar_url: targetUser.avatar_url ?? undefined,
      });
    } catch (e: any) {
      appToast(e?.message ?? 'Gagal memulai chat.', 'error');
    }
  };

  const getDisplayName = (t: ChatThread) => {
    return t.other_user_name || t.user_name || 'User';
  };
  const getUsername = (t: ChatThread) => {
    return t.other_username || t.username || '';
  };
  const getAvatar = (t: ChatThread): string | undefined => {
    return t.other_avatar_url || t.avatar_url || undefined;
  };

  const openThreads = threads.filter(t => t.status === 'open');
  const closedThreads = threads.filter(t => t.status === 'closed');

  return (
    <div className="min-h-screen surface-bg text-fg-secondary p-5 md:p-8">
      <div className="max-w-6xl mx-auto">
        <Link to="/home" className="inline-flex items-center gap-2 text-xs text-slate-500 hover:text-fg mb-5">
          <ArrowLeft size={14} /> Kembali
        </Link>

        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <MessageCircle size={20} className="text-accent" />
            <h1 className="text-2xl font-bold text-fg">Pesan</h1>
            <Badge color="moss">{openThreads.length} aktif</Badge>
          </div>
          <Button size="sm" icon={<Plus size={14} />} onClick={() => setShowNewChat(true)}>
            Pesan Baru
          </Button>
        </div>

        <div className="flex gap-4 h-[calc(100vh-180px)]">
          {/* Thread list */}
          <div className="w-72 shrink-0 overflow-y-auto space-y-2">
            <p className="text-xs text-slate-500 font-semibold px-1 mb-1">Aktif ({openThreads.length})</p>
            {openThreads.map(t => (
              <button key={t.id} onClick={() => setSelectedThread(t)}
                className={`w-full text-left p-3 rounded-xl border transition ${
                  selectedThread?.id === t.id
                    ? 'border-moss-500 bg-moss-500/10'
                    : 'surface-border surface-elevated hover:surface-elevated'
                }`}>
                <div className="flex items-center gap-2">
                  <Avatar name={getDisplayName(t)} id={t.user_id} size={32} src={getAvatar(t)} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-fg font-medium truncate">{getDisplayName(t)}</p>
                    <p className="text-[11px] text-slate-500 truncate">
                      {t.last_message ? `@${getUsername(t)} · ${t.last_message}` : `@${getUsername(t)}`}
                    </p>
                  </div>
                  <div className="w-2 h-2 rounded-full bg-moss-400 animate-pulse" />
                </div>
              </button>
            ))}
            {openThreads.length === 0 && (
              <p className="text-xs text-slate-600 text-center py-3">Tidak ada chat aktif</p>
            )}

            {closedThreads.length > 0 && (
              <>
                <p className="text-xs text-slate-500 font-semibold px-1 mt-4 mb-1">Selesai ({closedThreads.length})</p>
                {closedThreads.slice(0, 10).map(t => (
                  <div key={t.id} className="p-3 rounded-xl border surface-border surface-elevated/30 opacity-60">
                    <div className="flex items-center gap-2">
                      <Avatar name={getDisplayName(t)} id={t.user_id} size={28} src={getAvatar(t)} />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-slate-400 truncate">{getDisplayName(t)}</p>
                        {t.rating && (
                          <div className="flex gap-0.5 mt-0.5">
                            {Array.from({ length: 5 }).map((_, i) => (
                              <Star key={i} size={10} className={i < t.rating! ? 'text-amber-400 fill-amber-400' : 'text-slate-700'} />
                            ))}
                          </div>
                        )}
                      </div>
                      <Badge color="default">Selesai</Badge>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>

          {/* Chat area */}
          <div className="flex-1 flex flex-col surface-elevated/30 rounded-2xl border surface-border overflow-hidden">
            {selectedThread ? (
              <>
                {/* Security warning banner */}
                <div className="px-4 py-2 bg-amber-500/10 border-b border-amber-500/20 flex items-center gap-2">
                  <ShieldAlert size={14} className="text-amber-400 shrink-0" />
                  <p className="text-[11px] text-amber-300 leading-tight">
                    🔒 Himbauan Keamanan: Hindari membagikan data pribadi sensitif (password, nomor telepon, atau data finansial). Hati-hati terhadap segala bentuk penipuan yang mengatasnamakan platform.
                  </p>
                </div>

                {/* Chat header */}
                <div className="px-4 py-3 border-b surface-border flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Avatar name={getDisplayName(selectedThread)} id={selectedThread.user_id} size={36} src={getAvatar(selectedThread)} />
                    <div>
                      <p className="text-sm text-fg font-semibold">{getDisplayName(selectedThread)}</p>
                      <p className="text-[11px] text-slate-500">@{getUsername(selectedThread)}</p>
                    </div>
                  </div>
                </div>

                {/* Messages */}
                <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
                  {messages.length === 0 && (
                    <div className="text-center py-8">
                      <MessageCircle size={24} className="mx-auto text-slate-600 mb-2" />
                      <p className="text-xs text-slate-500">Belum ada pesan</p>
                    </div>
                  )}
                  {messages.map(msg => {
                    const isMe = msg.sender_id === user?.id;
                    return (
                      <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[70%] px-4 py-2.5 rounded-2xl text-sm ${
                          isMe
                            ? 'bg-moss-600 text-white rounded-br-sm'
                            : 'surface-elevated text-fg-secondary rounded-bl-sm'
                        }`}>
                          <p>{msg.body}</p>
                          <p className={`text-[9px] mt-1 ${isMe ? 'text-moss-200' : 'text-slate-500'}`}>
                            {new Date(msg.created_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                  <div ref={messagesEnd} />
                </div>

                {/* Input */}
                {selectedThread.status === 'open' && (
                  <div className="p-3 border-t surface-border">
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={input}
                        onChange={e => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="Ketik pesan..."
                        className="flex-1 surface-card-bg border surface-border rounded-xl px-4 py-2.5 text-sm text-fg placeholder-slate-500 focus:outline-none focus:border-moss-500/50"
                      />
                      <button
                        onClick={handleSend}
                        disabled={!input.trim() || sending}
                        className="w-10 h-10 rounded-xl bg-moss-500 hover:bg-moss-600 flex items-center justify-center text-white transition disabled:opacity-40">
                        <Send size={18} />
                      </button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center">
                  <MessageCircle size={40} className="mx-auto text-slate-700 mb-3" />
                  <p className="text-sm text-slate-500">Pilih chat atau mulai pesan baru</p>
                  <p className="text-[11px] text-slate-600 mt-1">{openThreads.length} chat aktif</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ═══ NEW CHAT MODAL ═══ */}
      {showNewChat && (
        <NewChatModal
          onClose={() => setShowNewChat(false)}
          onSelect={startNewChat}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════
// NewChatModal — search & start DM
// ═══════════════════════════════════════
function NewChatModal({ onClose, onSelect }: { onClose: () => void; onSelect: (user: SearchUserResult) => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchUserResult[]>([]);
  const [searching, setSearching] = useState(false);
  const deadEndsRef = useRef(new Set<string>());
  const lastSearchedRef = useRef('');
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const doSearch = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) { setResults([]); lastSearchedRef.current = ''; return; }
    const lower = trimmed.toLowerCase();

    // Dead-end cache: skip if extending a zero-result prefix
    for (const dead of deadEndsRef.current) {
      if (lower.startsWith(dead)) { setResults([]); setSearching(false); return; }
    }
    // Prune irrelevant dead-ends
    for (const dead of deadEndsRef.current) {
      if (!lower.startsWith(dead)) deadEndsRef.current.delete(dead);
    }
    if (lower === lastSearchedRef.current) return;

    setSearching(true);
    try {
      const users = await searchUsersForChat(trimmed, 10);
      setResults(users);
      lastSearchedRef.current = lower;
      if (users.length === 0) deadEndsRef.current.add(lower);
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void doSearch(query), 300);
    return () => clearTimeout(debounceRef.current);
  }, [query, doSearch]);

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md card p-0 animate-scale-in max-h-[80vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b surface-border">
          <h3 className="font-display font-semibold text-base text-fg">Pesan Baru</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/5 text-fg-muted hover:text-fg transition">
            <X size={18} />
          </button>
        </div>
        <div className="px-5 pt-4">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted pointer-events-none" />
            <input
              className="input pl-9 w-full"
              placeholder="Cari nama atau username..."
              value={query}
              onChange={e => setQuery(e.target.value)}
              autoFocus
            />
            {searching && <div className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-fg-muted">Mencari...</div>}
          </div>
        </div>
        <div className="overflow-y-auto flex-1 px-5 py-3 space-y-1">
          {query.trim() && !searching && results.length === 0 && (
            <p className="text-xs text-fg-muted text-center py-4">Pengguna tidak ditemukan.</p>
          )}
          {!query.trim() && (
            <p className="text-xs text-fg-muted text-center py-4">Ketik nama atau username untuk mencari.</p>
          )}
          {results.map(u => (
            <button
              key={u.id}
              onClick={() => onSelect(u)}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-accent-muted/10 transition text-left"
            >
              <Avatar name={u.full_name || u.username} id={u.id} size={36} src={u.avatar_url || undefined} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-fg truncate">{u.full_name || u.username}</p>
                <p className="text-[11px] text-fg-muted truncate">@{u.username}</p>
              </div>
              <MessageCircle size={14} className="text-fg-muted shrink-0" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
