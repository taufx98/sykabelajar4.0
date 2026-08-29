import { useEffect, useState, useRef } from 'react';
import { MessageCircle, X, Send, Star } from 'lucide-react';
import { useApp } from '@/store/AppContext';
import { getOrCreateThread, sendMessage, loadMyMessages, submitRating, loadMyThread, type ChatThread, type ChatMessage } from '@/services/chat.service';

export function ChatWidget() {
  const { user, toast } = useApp();
  const [isOpen, setIsOpen] = useState(false);
  const [thread, setThread] = useState<ChatThread | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [showRating, setShowRating] = useState(false);
  const [rating, setRating] = useState(0);
  const [loading, setLoading] = useState(false);
  const messagesEnd = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Don't show for guests
  if (!user) return null;

  // Load thread on mount
  useEffect(() => {
    loadMyThread().then(t => {
      if (t) {
        setThread(t);
        if (t.status === 'closed' && !t.rating) {
          setShowRating(true);
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
    if (isOpen && thread && thread.status === 'open') {
      void loadMessages();
      // Poll for new messages every 3 seconds
      pollRef.current = setInterval(() => void loadMessages(), 3000);
      return () => { if (pollRef.current) clearInterval(pollRef.current); };
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [isOpen, thread]);

  // Auto scroll
  useEffect(() => {
    messagesEnd.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleOpen = async () => {
    setIsOpen(true);
    if (!thread) {
      setLoading(true);
      try {
        const t = await getOrCreateThread();
        setThread(t);
        if (t.status === 'closed' && !t.rating) setShowRating(true);
      } catch (e: any) {
        toast(e?.message ?? 'Gagal memuat chat.', 'error');
      } finally {
        setLoading(false);
      }
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
      setShowRating(false);
      setThread(null);
      setMessages([]);
      toast('Terima kasih atas ratingnya! ⭐', 'success');
    } catch (e: any) {
      toast(e?.message ?? 'Gagal memberi rating.', 'error');
    }
  };

  const isClosed = thread?.status === 'closed';

  return (
    <div className="fixed bottom-5 right-5 z-50">
      {/* Rating modal */}
      {showRating && (
        <div className="mb-3 w-72 bg-ink-900 border border-white/10 rounded-2xl shadow-2xl overflow-hidden animate-slide-up">
          <div className="bg-moss-600 px-4 py-3">
            <p className="text-sm font-semibold text-white">Beri Rating ⭐</p>
          </div>
          <div className="p-4">
            <p className="text-sm text-slate-300 mb-3">Bagaimana layanan admin kami?</p>
            <div className="flex gap-1 mb-4">
              {[1, 2, 3, 4, 5].map(s => (
                <button key={s} onClick={() => setRating(s)} className="transition">
                  <Star size={28} className={s <= rating ? 'text-amber-400 fill-amber-400' : 'text-slate-600'} />
                </button>
              ))}
            </div>
            <button onClick={handleRate} disabled={rating === 0}
              className="w-full py-2 rounded-lg bg-moss-500 hover:bg-moss-600 text-sm font-medium text-white disabled:opacity-40 transition">
              Kirim Rating
            </button>
          </div>
        </div>
      )}

      {/* Chat popup */}
      {isOpen && !showRating && (
        <div className="mb-3 w-80 h-96 bg-ink-900 border border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col animate-slide-up">
          {/* Header */}
          <div className="bg-moss-600 px-4 py-3 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
                <MessageCircle size={16} className="text-white" />
              </div>
              <div>
                <p className="text-sm font-semibold text-white">Admin SykaBelajar</p>
                <p className="text-[10px] text-moss-200">
                  {isClosed ? 'Chat ditutup' : loading ? 'Memuat...' : 'Online'}
                </p>
              </div>
            </div>
            <button onClick={() => setIsOpen(false)} className="text-white/70 hover:text-white transition">
              <X size={18} />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-ink-800 min-h-0">
            {loading && (
              <div className="text-center py-4">
                <div className="w-5 h-5 border-2 border-moss-400 border-t-transparent rounded-full animate-spin mx-auto" />
              </div>
            )}
            {!loading && messages.length === 0 && (
              <div className="text-center py-6">
                <MessageCircle size={24} className="mx-auto text-slate-600 mb-2" />
                <p className="text-xs text-slate-500">Mulai chat dengan admin</p>
              </div>
            )}
            {messages.map(msg => {
              const isAdmin = msg.sender_id !== user?.id;
              return (
                <div key={msg.id} className={`flex ${isAdmin ? 'justify-start' : 'justify-end'}`}>
                  <div className={`max-w-[80%] px-3 py-2 rounded-xl text-sm ${
                    isAdmin
                      ? 'bg-ink-700 text-slate-200 rounded-bl-sm'
                      : 'bg-moss-600 text-white rounded-br-sm'
                  }`}>
                    <p>{msg.body}</p>
                    <p className={`text-[9px] mt-1 ${isAdmin ? 'text-slate-500' : 'text-moss-200'}`}>
                      {new Date(msg.created_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
              );
            })}
            <div ref={messagesEnd} />
          </div>

          {/* Input */}
          <div className="p-3 bg-ink-900 border-t border-white/5 shrink-0">
            {isClosed ? (
              <p className="text-xs text-slate-500 text-center py-1">Chat telah ditutup oleh admin</p>
            ) : (
              <div className="flex gap-2">
                <input
                  type="text"
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ketik pesan..."
                  className="flex-1 bg-ink-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-moss-500/50"
                />
                <button
                  onClick={handleSend}
                  disabled={!input.trim() || sending}
                  className="w-9 h-9 rounded-lg bg-moss-500 hover:bg-moss-600 flex items-center justify-center text-white transition disabled:opacity-40">
                  <Send size={16} />
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Floating button */}
      <button
        onClick={() => isOpen ? setIsOpen(false) : void handleOpen()}
        className={`w-14 h-14 rounded-full shadow-lg flex items-center justify-center transition-all duration-300 ${
          isOpen
            ? 'bg-slate-700 hover:bg-slate-600'
            : 'bg-moss-500 hover:bg-moss-600 animate-bounce'
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
