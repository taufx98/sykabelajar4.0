import { useEffect, useState, useRef } from 'react';
import { MessageCircle, X, Send, Star, ArrowLeft, Headphones } from 'lucide-react';
import { useApp } from '@/store/AppContext';
import { Avatar } from '@/components/ui/Avatar';
import {
  getOrCreateThread,
  sendMessage,
  loadMyMessages,
  submitRating,
  loadMyThread,
  type ChatThread,
  type ChatMessage,
} from '@/services/chat.service';

type View = 'closed' | 'form' | 'chat' | 'rating' | 'waiting';

export function ChatWidget() {
  const { user, toast } = useApp();
  const [isOpen, setIsOpen] = useState(false);
  const [view, setView] = useState<View>('closed');
  const [thread, setThread] = useState<ChatThread | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [rating, setRating] = useState(0);
  const messagesEnd = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  if (!user) return null;

  // Load thread on mount
  useEffect(() => {
    loadMyThread().then(t => {
      if (t) {
        setThread(t);
        if (t.status === 'open') {
          setView('chat');
        }
      }
    }).catch(() => {});
  }, [user]);

  // Load messages when thread is open
  const loadMessages = async () => {
    if (!thread || thread.status === 'closed') return;
    try {
      const msgs = await loadMyMessages(thread.id);
      setMessages(msgs);
    } catch {}
  };

  useEffect(() => {
    if (isOpen && view === 'chat' && thread && thread.status === 'open') {
      void loadMessages();
      pollRef.current = setInterval(() => void loadMessages(), 3000);
      return () => { if (pollRef.current) clearInterval(pollRef.current); };
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [isOpen, view, thread]);

  useEffect(() => {
    messagesEnd.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleOpen = async () => {
    setIsOpen(true);
    if (thread?.status === 'open') {
      setView('chat');
    } else if (thread?.status === 'closed') {
      setView('form');
    } else {
      setView('form');
    }
  };

  const handleSubmitForm = async () => {
    if (!title.trim() || !description.trim()) return;
    setLoading(true);
    try {
      const t = await getOrCreateThread();
      setThread(t);
      // Send title + description as first message
      const firstMsg = `📋 *${title.trim()}*\n\n${description.trim()}`;
      await sendMessage(t.id, firstMsg);
      setMessages([]);
      setView('waiting');
    } catch (e: any) {
      toast(e?.message ?? 'Gagal mengirim.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleStartChat = async () => {
    setView('chat');
    if (thread) {
      void loadMessages();
    }
  };

  const handleSend = async () => {
    if (!input.trim() || !thread || sending) return;
    setSending(true);
    try {
      const msg = await sendMessage(thread.id, input.trim());
      setMessages(prev => [...prev, msg]);
      setInput('');
    } catch (e: any) {
      toast(e?.message ?? 'Gagal mengirim.', 'error');
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

  const handleRate = async () => {
    if (!thread || rating === 0) return;
    try {
      await submitRating(thread.id, rating);
      setThread(null);
      setMessages([]);
      setTitle('');
      setDescription('');
      setView('closed');
      toast('Terima kasih atas ratingnya! ⭐', 'success');
    } catch (e: any) {
      toast(e?.message ?? 'Gagal memberi rating.', 'error');
    }
  };

  const handleNewChat = () => {
    setThread(null);
    setMessages([]);
    setTitle('');
    setDescription('');
    setView('form');
  };

  return (
    <div className="fixed bottom-5 right-5 z-50">
      {/* Chat popup */}
      {isOpen && (
        <div className="mb-3 w-80 h-[420px] bg-ink-900 border border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col animate-slide-up">

          {/* ═══ HEADER ═══ */}
          <div className="bg-gradient-to-r from-moss-600 to-moss-700 px-4 py-3 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2.5">
              {view === 'chat' && (
                <button onClick={() => setIsOpen(false)} className="text-white/70 hover:text-white">
                  <ArrowLeft size={16} />
                </button>
              )}
              <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
                <Headphones size={16} className="text-white" />
              </div>
              <div>
                <p className="text-sm font-semibold text-white">Admin SykaBelajar</p>
                <p className="text-[10px] text-moss-200">
                  {view === 'waiting' ? 'Menunggu balasan...' :
                   view === 'chat' ? 'Online' :
                   'Siap membantu'}
                </p>
              </div>
            </div>
            <button onClick={() => setIsOpen(false)} className="text-white/70 hover:text-white transition">
              <X size={18} />
            </button>
          </div>

          {/* ═══ VIEW: FORM (judul + masalah) ═══ */}
          {view === 'form' && (
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <div className="text-center mb-2">
                <div className="w-14 h-14 rounded-full bg-moss-500/10 flex items-center justify-center mx-auto mb-3">
                  <MessageCircle size={24} className="text-moss-400" />
                </div>
                <p className="text-sm font-semibold text-white">Hubungi Admin</p>
                <p className="text-[11px] text-slate-500 mt-1">Jelaskan masalah kamu, admin akan membalas dalam 1×24 jam</p>
              </div>

              <div>
                <label className="text-xs text-slate-400 font-medium mb-1.5 block">Judul Pesan</label>
                <input
                  type="text"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder="Contoh: Masalah Login"
                  className="w-full bg-ink-800 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-moss-500/50"
                />
              </div>

              <div>
                <label className="text-xs text-slate-400 font-medium mb-1.5 block">Deskripsi Masalah</label>
                <textarea
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="Jelaskan masalah kamu secara detail..."
                  rows={4}
                  className="w-full bg-ink-800 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-moss-500/50 resize-none"
                />
              </div>

              <button
                onClick={handleSubmitForm}
                disabled={!title.trim() || !description.trim() || loading}
                className="w-full py-2.5 rounded-xl bg-moss-500 hover:bg-moss-600 text-sm font-medium text-white disabled:opacity-40 transition flex items-center justify-center gap-2"
              >
                {loading ? (
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <Send size={14} />
                )}
                Kirim Pesan
              </button>
            </div>
          )}

          {/* ═══ VIEW: WAITING ═══ */}
          {view === 'waiting' && (
            <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
              <div className="w-16 h-16 rounded-full bg-amber-500/10 flex items-center justify-center mx-auto mb-4">
                <Headphones size={28} className="text-amber-400" />
              </div>
              <p className="text-sm font-semibold text-white mb-1">Pesan Terkirim!</p>
              <p className="text-xs text-slate-400 mb-1">Admin akan membalas dalam</p>
              <p className="text-lg font-bold text-amber-400 mb-4">1 × 24 Jam</p>
              <p className="text-[11px] text-slate-500 mb-4">Kami akan memberitahu kamu saat admin membalas.</p>
              <button
                onClick={handleStartChat}
                className="px-4 py-2 rounded-xl bg-moss-500 hover:bg-moss-600 text-sm font-medium text-white transition"
              >
                Lihat Chat
              </button>
            </div>
          )}

          {/* ═══ VIEW: CHAT ═══ */}
          {view === 'chat' && (
            <>
              <div className="flex-1 overflow-y-auto p-3 space-y-3 bg-ink-800 min-h-0">
                {loading && (
                  <div className="text-center py-4">
                    <div className="w-5 h-5 border-2 border-moss-400 border-t-transparent rounded-full animate-spin mx-auto" />
                  </div>
                )}
                {!loading && messages.length === 0 && (
                  <div className="text-center py-8">
                    <MessageCircle size={24} className="mx-auto text-slate-600 mb-2" />
                    <p className="text-xs text-slate-500">Belum ada pesan</p>
                  </div>
                )}
                {messages.map(msg => {
                  const isMe = msg.sender_id === user?.id;
                  const senderName = isMe ? user.displayName : 'Admin';
                  const senderAvatar = isMe ? user.profilePhoto : undefined;
                  return (
                    <div key={msg.id} className={`flex gap-2 ${isMe ? 'justify-end' : 'justify-start'}`}>
                      {!isMe && (
                        <div className="w-7 h-7 rounded-full bg-moss-500/20 flex items-center justify-center shrink-0 mt-1">
                          <Headphones size={12} className="text-moss-400" />
                        </div>
                      )}
                      <div className={`max-w-[75%] ${isMe ? 'order-1' : ''}`}>
                        <p className={`text-[10px] mb-0.5 ${isMe ? 'text-right text-slate-500' : 'text-slate-500'}`}>
                          {senderName}
                        </p>
                        <div className={`px-3 py-2 rounded-2xl text-sm ${
                          isMe
                            ? 'bg-moss-600 text-white rounded-br-sm'
                            : 'bg-ink-700 text-slate-200 rounded-bl-sm'
                        }`}>
                          <p className="whitespace-pre-wrap">{msg.body}</p>
                          <p className={`text-[9px] mt-1 ${isMe ? 'text-moss-200' : 'text-slate-500'}`}>
                            {new Date(msg.created_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
                          </p>
                        </div>
                      </div>
                      {isMe && (
                        <Avatar name={user.displayName} id={user.id} size={28} src={senderAvatar || undefined} />
                      )}
                    </div>
                  );
                })}
                <div ref={messagesEnd} />
              </div>

              {/* Input */}
              <div className="p-3 bg-ink-900 border-t border-white/5 shrink-0">
                {thread?.status === 'closed' ? (
                  <div className="text-center">
                    <p className="text-xs text-slate-500 mb-2">Sesi chat ini telah selesai</p>
                    <button onClick={handleNewChat}
                      className="px-4 py-1.5 rounded-lg bg-moss-500 hover:bg-moss-600 text-xs font-medium text-white transition">
                      Chat Baru
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={input}
                      onChange={e => setInput(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder="Ketik pesan..."
                      className="flex-1 bg-ink-800 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-moss-500/50"
                    />
                    <button
                      onClick={handleSend}
                      disabled={!input.trim() || sending}
                      className="w-9 h-9 rounded-xl bg-moss-500 hover:bg-moss-600 flex items-center justify-center text-white transition disabled:opacity-40 shrink-0"
                    >
                      <Send size={16} />
                    </button>
                  </div>
                )}
              </div>
            </>
          )}

          {/* ═══ VIEW: RATING ═══ */}
          {view === 'rating' && (
            <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
              <p className="text-sm font-semibold text-white mb-1">Beri Rating</p>
              <p className="text-xs text-slate-400 mb-4">Bagaimana layanan admin kami?</p>
              <div className="flex gap-1 mb-4">
                {[1, 2, 3, 4, 5].map(s => (
                  <button key={s} onClick={() => setRating(s)} className="transition">
                    <Star size={32} className={s <= rating ? 'text-amber-400 fill-amber-400' : 'text-slate-600'} />
                  </button>
                ))}
              </div>
              <button onClick={handleRate} disabled={rating === 0}
                className="w-full py-2.5 rounded-xl bg-moss-500 hover:bg-moss-600 text-sm font-medium text-white disabled:opacity-40 transition">
                Kirim Rating
              </button>
            </div>
          )}
        </div>
      )}

      {/* Floating button */}
      <button
        onClick={() => isOpen ? setIsOpen(false) : void handleOpen()}
        className={`w-14 h-14 rounded-full shadow-lg flex items-center justify-center transition-all duration-300 ${
          isOpen
            ? 'bg-slate-700 hover:bg-slate-600'
            : 'bg-gradient-to-br from-moss-500 to-moss-600 hover:from-moss-600 hover:to-moss-700 animate-bounce'
        }`}
      >
        {isOpen ? (
          <X size={24} className="text-white" />
        ) : (
          <MessageCircle size={24} className="text-white" />
        )}
      </button>
    </div>
  );
}
