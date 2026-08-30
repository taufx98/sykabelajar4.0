import { useEffect, useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, MessageCircle, Send, CheckCircle, Star, User } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Avatar } from '@/components/ui/Avatar';
import { useApp } from '@/store/AppContext';
import {
  adminLoadThreads,
  adminLoadMessages,
  adminSendMessage,
  adminCloseThread,
  type ChatThread,
  type ChatMessage,
} from '@/services/chat.service';

export function AdminChatPage() {
  const { user, toast } = useApp();
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [selectedThread, setSelectedThread] = useState<ChatThread | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const messagesEnd = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadThreads = async () => {
    try {
      const t = await adminLoadThreads();
      setThreads(t);
    } catch (e: any) {
      toast(e?.message ?? 'Gagal memuat chat.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadThreads(); }, []);

  // Load messages for selected thread
  const loadMessages = async () => {
    if (!selectedThread) return;
    try {
      const msgs = await adminLoadMessages(selectedThread.id);
      setMessages(msgs);
    } catch {}
  };

  useEffect(() => {
    if (selectedThread && selectedThread.status === 'open') {
      void loadMessages();
      pollRef.current = setInterval(() => void loadMessages(), 3000);
      return () => { if (pollRef.current) clearInterval(pollRef.current); };
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [selectedThread]);

  // Auto scroll
  useEffect(() => {
    messagesEnd.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Refresh thread list when messages change
  useEffect(() => {
    if (messages.length > 0) void loadThreads();
  }, [messages.length]);

  const handleSend = async () => {
    if (!input.trim() || !selectedThread || sending) return;
    setSending(true);
    try {
      const msg = await adminSendMessage(selectedThread.id, input.trim());
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

  const handleClose = async () => {
    if (!selectedThread) return;
    if (!confirm('Tutup chat ini? Semua pesan akan dihapus.')) return;
    try {
      await adminCloseThread(selectedThread.id);
      toast('Chat ditutup. Pesan telah dihapus.', 'success');
      setSelectedThread(null);
      setMessages([]);
      await loadThreads();
    } catch (e: any) {
      toast(e?.message ?? 'Gagal menutup chat.', 'error');
    }
  };

  const openThreads = threads.filter(t => t.status === 'open');
  const closedThreads = threads.filter(t => t.status === 'closed');

  return (
    <div className="min-h-screen surface-bg text-fg-secondary p-5 md:p-8">
      <div className="max-w-6xl mx-auto">
        <Link to="/admin" className="inline-flex items-center gap-2 text-xs text-slate-500 hover:text-fg mb-5">
          <ArrowLeft size={14} /> Kembali ke Admin
        </Link>

        <div className="flex items-center gap-2 mb-6">
          <MessageCircle size={20} className="text-accent" />
          <h1 className="text-2xl font-bold text-fg">Chat Admin</h1>
          <Badge color="moss">{openThreads.length} aktif</Badge>
        </div>

        <div className="flex gap-4 h-[calc(100vh-180px)]">
          {/* Thread list */}
          <div className="w-72 shrink-0 overflow-y-auto space-y-2">
            {/* Open threads */}
            <p className="text-xs text-slate-500 font-semibold px-1 mb-1">Aktif ({openThreads.length})</p>
            {openThreads.map(t => (
              <button key={t.id} onClick={() => setSelectedThread(t)}
                className={`w-full text-left p-3 rounded-xl border transition ${
                  selectedThread?.id === t.id
                    ? 'border-moss-500 bg-moss-500/10'
                    : 'surface-border surface-elevated hover:surface-elevated'
                }`}>
                <div className="flex items-center gap-2">
                  <Avatar name={t.user_name || 'U'} id={t.user_id} size={32} src={t.avatar_url ?? undefined} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white font-medium truncate">{t.user_name}</p>
                    <p className="text-[11px] text-slate-500 truncate">@{t.username}</p>
                  </div>
                  <div className="w-2 h-2 rounded-full bg-moss-400 animate-pulse" />
                </div>
              </button>
            ))}
            {openThreads.length === 0 && (
              <p className="text-xs text-slate-600 text-center py-3">Tidak ada chat aktif</p>
            )}

            {/* Closed threads */}
            {closedThreads.length > 0 && (
              <>
                <p className="text-xs text-slate-500 font-semibold px-1 mt-4 mb-1">Selesai ({closedThreads.length})</p>
                {closedThreads.slice(0, 10).map(t => (
                  <div key={t.id} className="p-3 rounded-xl border surface-border surface-elevated/30 opacity-60">
                    <div className="flex items-center gap-2">
                      <Avatar name={t.user_name || 'U'} id={t.user_id} size={28} src={t.avatar_url ?? undefined} />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-slate-400 truncate">{t.user_name}</p>
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
                {/* Chat header */}
                <div className="px-4 py-3 border-b surface-border flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Avatar name={selectedThread.user_name || 'U'} id={selectedThread.user_id} size={36} src={selectedThread.avatar_url ?? undefined} />
                    <div>
                      <p className="text-sm text-fg font-semibold">{selectedThread.user_name}</p>
                      <p className="text-[11px] text-slate-500">@{selectedThread.username}</p>
                    </div>
                  </div>
                  {selectedThread.status === 'open' && (
                    <Button size="sm" variant="outline" icon={<CheckCircle size={14} />} onClick={handleClose}>
                      Selesai
                    </Button>
                  )}
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
                    const isAdmin = msg.sender_id === user?.id;
                    return (
                      <div key={msg.id} className={`flex ${isAdmin ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[70%] px-4 py-2.5 rounded-2xl text-sm ${
                          isAdmin
                            ? 'bg-moss-600 text-white rounded-br-sm'
                            : 'surface-elevated text-fg-secondary rounded-bl-sm'
                        }`}>
                          <p>{msg.body}</p>
                          <p className={`text-[9px] mt-1 ${isAdmin ? 'text-moss-200' : 'text-slate-500'}`}>
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
                        placeholder="Balas pesan..."
                        className="flex-1 surface-card-bg border surface-border rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-moss-500/50"
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
                  <p className="text-sm text-slate-500">Pilih chat untuk mulai membalas</p>
                  <p className="text-[11px] text-slate-600 mt-1">{openThreads.length} chat aktif menunggu</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
