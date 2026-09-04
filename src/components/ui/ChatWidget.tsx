function errorMessage(error:unknown,fallback:string):string{return error instanceof Error?error.message:fallback;}
import { useCallback, useEffect, useRef, useState } from 'react';
import { MessageCircle, X, Send, Star, ArrowLeft, Headphones, Plus, ShieldAlert } from 'lucide-react';
import { useApp } from '@/store/AppContext';
import { Avatar } from '@/components/ui/Avatar';
import { createTicketThread, sendMessage, loadChatMessagesPage, submitRating, loadMyThread, getChatSpamStatus, type ChatThread, type ChatMessage, type ChatSpamStatus } from '@/services/chat.service';
import { emitSykaEvent, subscribeSykaEvents } from '@/lib/realtimeBus';
import { supabase } from '@/lib/supabase';

type View = 'form' | 'waiting' | 'chat' | 'ended' | 'rating';

function formatCooldown(ms:number){const total=Math.max(0,Math.ceil(ms/1000));const h=Math.floor(total/3600);const m=Math.floor((total%3600)/60);const s=total%60;if(h>0)return `${h}j ${String(m).padStart(2,'0')}m ${String(s).padStart(2,'0')}d`;return `${String(m).padStart(2,'0')}m ${String(s).padStart(2,'0')}d`;}

export function ChatWidget() {
  const { user, toast } = useApp();
  const [isOpen, setIsOpen] = useState(false);
  const [view, setView] = useState<View>('form');
  const [thread, setThread] = useState<ChatThread | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [threadLoading, setThreadLoading] = useState(false);
  const [rating, setRating] = useState(0);
  const [spamStatus, setSpamStatus] = useState<ChatSpamStatus | null>(null);
  const [cooldownLeft, setCooldownLeft] = useState(0);
  const messagesEnd = useRef<HTMLDivElement>(null);

  const refreshSpamStatus = useCallback(async () => {
    try {
      const status = await getChatSpamStatus();
      setSpamStatus(status);
      setCooldownLeft(status.blocked_until ? Math.max(0,new Date(status.blocked_until).getTime()-Date.now()) : 0);
    } catch {
      // Spam enforcement remains server-side even when status read fails.
    }
  }, []);

  useEffect(() => {
    if (!isOpen || !user) return;
    void refreshSpamStatus();
  }, [isOpen, user?.id, refreshSpamStatus]);

  useEffect(() => {
    if (!isOpen || !spamStatus?.blocked_until) return;
    const tick = () => setCooldownLeft(Math.max(0,new Date(spamStatus.blocked_until as string).getTime()-Date.now()));
    tick();
    const timer=window.setInterval(tick,1000);
    return () => window.clearInterval(timer);
  }, [isOpen, spamStatus?.blocked_until]);

  useEffect(() => {
    if (cooldownLeft===0 && spamStatus?.blocked_until) {
      setSpamStatus(current=>current?{...current,blocked_until:null}:current);
      void refreshSpamStatus();
    }
  }, [cooldownLeft, spamStatus?.blocked_until, refreshSpamStatus]);

  const chatLocked = cooldownLeft > 0;

  useEffect(() => {
    if (!isOpen || !user || thread || threadLoading) return;
    let alive = true;
    setThreadLoading(true);
    void loadMyThread().then((found) => {
      if (!alive) return;
      if (!found) return;
      setThread(found);
      if (found.status === 'open') setView('chat');
      else if (found.status === 'closed') setView('ended');
    }).catch(() => {
      // Non-critical: keep the widget in its new-ticket form.
    }).finally(() => {
      if (alive) setThreadLoading(false);
    });
    return () => { alive = false; };
  }, [isOpen, user?.id, thread, threadLoading]);

  const loadMessages = useCallback(async () => {
    if (!thread || thread.status === 'closed') return;
    try {
      const msgs = await loadChatMessagesPage(thread.id); setMessages(current => { const byId = new Map(msgs.map(x => [x.id, x])); for (const item of current) if (!byId.has(item.id)) byId.set(item.id, item); return [...byId.values()].sort((a,b) => a.created_at.localeCompare(b.created_at)); });
    } catch {
      // Realtime remains active; a transient read failure should not break the widget.
    }
  }, [thread]);

  useEffect(() => {
    if (!isOpen || view !== 'chat' || !thread) return;
    let alive = true;
    void loadMessages();
    const channel = supabase
      .channel(`chat-widget-${thread.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `thread_id=eq.${thread.id}` }, (payload) => {
        const message = payload.new as ChatMessage;
        if (!alive || !message?.id) return; setMessages((current) => { const next = current.some((item) => item.id === message.id) ? current : [...current, message]; return next.sort((a,b) => a.created_at.localeCompare(b.created_at)); }); emitSykaEvent({ type: 'chat-message', message: message as unknown as Record<string, unknown> });
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'chat_threads', filter: `id=eq.${thread.id}` }, (payload) => {
        if (!alive) return;
        const updated = payload.new as ChatThread;
        setThread((current) => current ? { ...current, ...updated } : updated);
        if (updated.status === 'closed') setView('ended');
      })
      .subscribe((status, error) => {
        if (error) console.error('[SykaBelajar] chat widget realtime error', status, error);
      });
    const unsubscribe = subscribeSykaEvents((event) => {
      if (event.type !== 'chat-thread-updated' || String(event.thread.id ?? '') !== thread.id) return;
      const updated = event.thread as unknown as ChatThread;
      setThread((current) => current ? { ...current, ...updated } : updated);
      if (updated.status === 'closed') setView('ended');
    });
    return () => {
      alive = false;
      unsubscribe();
      void supabase.removeChannel(channel);
    };
  }, [isOpen, view, thread?.id, loadMessages]);

  useEffect(() => {
    if (isOpen) messagesEnd.current?.scrollIntoView({ behavior: 'smooth' });
  }, [isOpen, messages]);

  const handleOpen = () => {
    setIsOpen(true);
    if (thread?.status === 'open') setView('chat');
    else if (thread?.status === 'closed') setView('ended');
    else setView('form');
  };

  const handleSubmitForm = async () => {
    if (chatLocked || !title.trim() || !description.trim()) return;
    setLoading(true);
    try {
      const t = await createTicketThread(title.trim(), description.trim());
      setThread(t);
      setTitle('');
      setDescription('');
      setMessages([]);
      setView('waiting');
    } catch (e: unknown) {
      if ((e as Error)?.name === 'ChatSpamCooldown') await refreshSpamStatus();
      toast(errorMessage(e, 'Gagal mengirim.'), 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleStartChat = () => {
    setView('chat');
    void loadMessages();
  };

  const handleSend = async () => {
    if (chatLocked || !input.trim() || !thread || sending) return;
    setSending(true);
    try {
      const msg = await sendMessage(thread.id, input.trim());
      setMessages((prev) => { const next = prev.some((item) => item.id === msg.id) ? prev : [...prev, msg]; next.sort((a,b) => a.created_at.localeCompare(b.created_at)); return next; }); emitSykaEvent({ type: 'chat-message', message: msg as unknown as Record<string, unknown> }); setInput('');
    } catch (e: unknown) {
      if ((e as Error)?.name === 'ChatSpamCooldown') await refreshSpamStatus();
      toast(errorMessage(e, 'Gagal mengirim.'), 'error');
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const handleRate = async () => {
    if (!thread || rating === 0) return;
    try {
      await submitRating(thread.id, rating);
      setThread(null);
      setMessages([]);
      setRating(0);
      setView('form');
      toast('Terima kasih atas ratingnya! ⭐', 'success');
    } catch (e: unknown) {
      toast(errorMessage(e, 'Gagal memberi rating.'), 'error');
    }
  };

  const handleNewChat = () => {
    setThread(null);
    setMessages([]);
    setView('form');
  };

  const handleSkipRating = () => {
    setThread(null);
    setMessages([]);
    setView('ended');
  };

  if (!user) return null;

  return (
    <div className="fixed bottom-20 md:bottom-5 right-5 z-50">
      {isOpen && (
        <div className="mb-3 w-80 h-[420px] surface-card-bg border surface-border rounded-2xl shadow-2xl overflow-hidden flex flex-col animate-slide-up">
          <div className="bg-gradient-to-r from-moss-600 to-moss-700 px-4 py-3 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2.5">
              {view === 'chat' && <button onClick={() => setIsOpen(false)} className="text-fg/70 hover:text-fg"><ArrowLeft size={16} /></button>}
              <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center"><Headphones size={16} className="text-fg" /></div>
              <div><p className="text-sm font-semibold text-fg">Admin SykaBelajar</p><p className="text-[10px] text-moss-200">{threadLoading ? 'Memeriksa chat...' : chatLocked ? 'Chat sementara dikunci' : view === 'chat' ? 'Online' : view === 'waiting' ? 'Menunggu balasan...' : view === 'ended' ? 'Chat selesai' : 'Siap membantu'}</p></div>
            </div>
            <button onClick={() => setIsOpen(false)} className="text-fg/70 hover:text-white transition"><X size={18} /></button>
          </div>
          {chatLocked && <div className="mx-3 mt-3 rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 flex gap-2.5"><ShieldAlert size={18} className="text-amber-400 shrink-0 mt-0.5" /><div><p className="text-xs font-semibold text-amber-300">Chat dikunci sementara</p><p className="text-[11px] text-fg-muted mt-0.5">Terlalu banyak pesan terdeteksi. Tunggu <span className="font-bold text-amber-300">{formatCooldown(cooldownLeft)}</span>.</p>{(spamStatus?.strike_count ?? 0)>0 && <p className="text-[10px] text-fg-muted mt-1">Pelanggaran ke-{spamStatus?.strike_count} dari batas bertahap.</p>}</div></div>}
          {view === 'form' && <div className="flex-1 overflow-y-auto p-4 space-y-4"><div className="text-center mb-2"><div className="w-14 h-14 rounded-full bg-moss-500/10 flex items-center justify-center mx-auto mb-3"><MessageCircle size={24} className="text-accent" /></div><p className="text-sm font-semibold text-fg">Hubungi Admin</p><p className="text-[11px] text-fg-muted mt-1">Isi judul & deskripsi masalah, lalu chat dengan admin</p></div><div><label className="text-xs text-slate-400 font-medium mb-1.5 block">Judul Pesan</label><input type="text" value={title} onChange={(e) => setTitle(e.target.value)} disabled={chatLocked} placeholder="Contoh: Masalah Login" className="input disabled:opacity-50" /></div><div><label className="text-xs text-slate-400 font-medium mb-1.5 block">Deskripsi Masalah</label><textarea value={description} onChange={(e) => setDescription(e.target.value)} disabled={chatLocked} placeholder="Jelaskan masalah kamu secara detail..." rows={4} className="input resize-none disabled:opacity-50" /></div><button onClick={() => void handleSubmitForm()} disabled={chatLocked || !title.trim() || !description.trim() || loading || threadLoading} className="w-full py-2.5 rounded-xl bg-moss-500 hover:bg-moss-600 text-sm font-medium text-white disabled:opacity-40 transition flex items-center justify-center gap-2">{loading ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Send size={14} />}Kirim & Mulai Chat</button></div>}
          {view === 'waiting' && <div className="flex-1 flex flex-col items-center justify-center p-6 text-center"><div className="w-16 h-16 rounded-full bg-amber-500/10 flex items-center justify-center mx-auto mb-4"><Headphones size={28} className="text-amber-400" /></div><p className="text-sm font-semibold text-fg mb-1">Pesan Terkirim!</p><p className="text-xs text-fg-muted mb-1">Admin akan membalas dalam</p><p className="text-lg font-bold text-amber-400 mb-4">1 × 24 Jam</p><button onClick={handleStartChat} disabled={chatLocked} className="px-4 py-2 rounded-xl bg-moss-500 hover:bg-moss-600 text-sm font-medium text-white transition disabled:opacity-40">Lihat Chat</button></div>}
          {view === 'chat' && <><div className="flex-1 overflow-y-auto p-3 space-y-3 surface-elevated min-h-0">{loading && <div className="text-center py-4"><div className="w-5 h-5 border-2 border-moss-400 border-t-transparent rounded-full animate-spin mx-auto" /></div>}{!loading && messages.length === 0 && <div className="text-center py-8"><MessageCircle size={24} className="mx-auto text-slate-600 mb-2" /><p className="text-xs text-slate-500">Belum ada pesan</p></div>}{messages.map((msg) => {const isMe = msg.sender_id === user.id;return <div key={msg.id} className={`flex gap-2 ${isMe ? 'justify-end' : 'justify-start'}`}>{!isMe && <div className="w-7 h-7 rounded-full bg-moss-500/20 flex items-center justify-center shrink-0 mt-1"><Headphones size={12} className="text-accent" /></div>}<div className="max-w-[75%]"><p className={`text-[10px] mb-0.5 ${isMe ? 'text-right text-slate-500' : 'text-slate-500'}`}>{isMe ? (user.displayName || 'Kamu') : 'Admin'}</p><div className={`px-3 py-2 rounded-2xl text-sm ${isMe ? 'bg-moss-600 text-white rounded-br-sm' : 'surface-elevated text-fg-secondary rounded-bl-sm'}`}><p className="whitespace-pre-wrap">{msg.body}</p><p className={`text-[9px] mt-1 ${isMe ? 'text-moss-200' : 'text-slate-500'}`}>{new Date(msg.created_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</p></div></div>{isMe && <Avatar name={user.displayName} id={user.id} size={28} src={user.profilePhoto || undefined} />}</div>})}<div ref={messagesEnd} /></div><div className="p-3 surface-card-bg border-t surface-border shrink-0">{thread?.status === 'closed' ? <div className="text-center space-y-2"><p className="text-xs text-slate-500">Sesi chat ini telah selesai</p><div className="flex gap-2 justify-center"><button onClick={() => setView('rating')} className="px-3 py-1.5 rounded-lg bg-amber-500/10 text-amber-400 text-xs font-medium hover:bg-amber-500/20 transition">⭐ Beri Rating</button><button onClick={handleNewChat} disabled={chatLocked} className="px-3 py-1.5 rounded-lg bg-moss-500/10 text-accent text-xs font-medium hover:bg-moss-500/20 transition flex items-center gap-1 disabled:opacity-40"><Plus size={12} /> Chat Baru</button></div></div> : <div className="flex gap-2"><input type="text" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={handleKeyDown} disabled={chatLocked || sending} placeholder={chatLocked ? 'Chat dikunci sementara...' : 'Ketik pesan...'} className="flex-1 input disabled:opacity-50" /><button onClick={() => void handleSend()} disabled={chatLocked || !input.trim() || sending} className="w-9 h-9 rounded-xl bg-moss-500 hover:bg-moss-600 flex items-center justify-center text-white transition disabled:opacity-40 shrink-0"><Send size={16}/></button></div>}</div></>}
          {view === 'ended' && <div className="flex-1 flex flex-col items-center justify-center p-6 text-center"><div className="w-16 h-16 rounded-full bg-slate-500/10 flex items-center justify-center mx-auto mb-4"><MessageCircle size={28} className="text-slate-400" /></div><p className="text-sm font-semibold text-fg mb-1">Chat Selesai</p><p className="text-xs text-fg-muted mb-5">Sesi chat sebelumnya sudah ditutup</p><button onClick={handleNewChat} disabled={chatLocked} className="px-5 py-2.5 rounded-xl bg-moss-500 hover:bg-moss-600 text-sm font-medium text-white transition flex items-center gap-2 disabled:opacity-40"><Plus size={16} />Mulai Chat Baru</button></div>}
          {view === 'rating' && <div className="flex-1 flex flex-col items-center justify-center p-6 text-center"><p className="text-sm font-semibold text-fg mb-1">Beri Rating</p><p className="text-xs text-fg-muted mb-4">Bagaimana layanan admin kami?</p><div className="flex gap-1 mb-4">{[1, 2, 3, 4, 5].map((s) => <button key={s} onClick={() => setRating(s)} className="transition active:scale-110"><Star size={32} className={s <= rating ? 'text-amber-400 fill-amber-400' : 'text-slate-600'} /></button>)}</div><div className="flex gap-2 w-full"><button onClick={handleSkipRating} className="flex-1 py-2.5 rounded-xl surface-elevated text-slate-400 text-sm font-medium hover:surface-elevated transition">Lewati</button><button onClick={() => void handleRate()} disabled={rating === 0} className="flex-1 py-2.5 rounded-xl bg-moss-500 hover:bg-moss-600 text-sm font-medium text-white disabled:opacity-40 transition">Kirim</button></div></div>}
        </div>
      )}
      <button onClick={() => isOpen ? setIsOpen(false) : handleOpen()} className={`group rounded-full shadow-lg flex items-center justify-center transition-all duration-300 ease-out ${isOpen ? 'w-11 h-11 bg-slate-700 hover:bg-slate-600' : 'w-11 h-11 hover:w-[52px] hover:h-[52px] bg-gradient-to-br from-moss-500 to-moss-600 hover:from-moss-600 hover:to-moss-700'}`} aria-label="Chat dengan admin">{isOpen ? <X size={18} className="text-fg transition-transform duration-300 group-active:rotate-90" /> : <MessageCircle size={18} className="text-fg transition-transform duration-300 group-hover:scale-110" />}</button>
    </div>
  );
}