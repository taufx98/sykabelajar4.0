import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Filter, MessageCircle, Search, ShieldAlert, Star, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useApp } from '@/store/AppContext';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { supabase } from '@/lib/supabase';
import {
  claimChatTicket,
  closeThread,
  getAdminChatHistory,
  loadChatMessagesPage,
  loadMyThreads,
  markThreadRead,
  sendMessage,
  type ChatHistoryRow,
  type ChatMessage,
  type ChatThread,
} from '@/services/chat.service';

const SECURITY = 'Himbauan Keamanan: Jangan membagikan password, nomor HP, atau data finansial.';
const formatChatTime = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
};

function Stars({ value }: { value: number | null }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={value == null ? 'Belum ada rating' : `Rating ${value} dari 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} size={13} className={value != null && n <= value ? 'text-amber-400 fill-amber-400' : 'text-slate-700'} />
      ))}
    </span>
  );
}

function TicketBubble({ row, body }: { row: ChatThread; body: string }) {
  const prefix = `${row.subject || ''}\n\n`;
  const isIntro = body === prefix + (row.description || '') || body.startsWith(prefix);
  if (!isIntro) return <p className="whitespace-pre-wrap break-words">{body}</p>;
  return (
    <div className="space-y-2">
      <p className="font-semibold text-fg leading-snug">{row.subject || 'Laporan'}</p>
      <p className="text-sm leading-relaxed whitespace-pre-wrap break-words text-fg-secondary">
        {row.description || body.slice(prefix.length)}
      </p>
    </div>
  );
}

function HistoryPreview({ row, onClose }: { row: ChatHistoryRow; onClose: () => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  useEffect(() => {
    let live = true;
    void loadChatMessagesPage(row.thread_id, 100).then((items) => {
      if (live) setMessages(items);
    }).catch(() => undefined);
    return () => { live = false; };
  }, [row.thread_id]);

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/70 p-4">
      <button className="absolute inset-0" onClick={onClose} aria-label="Tutup" />
      <div className="relative flex h-[80vh] w-full max-w-3xl flex-col overflow-hidden card">
        <header className="flex shrink-0 items-center gap-3 border-b surface-border px-5 py-4">
          <Avatar name={row.user_name || 'User'} id={row.user_id} size={38} />
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold text-fg">{row.user_name || 'User'}</p>
            <p className="truncate text-xs text-fg-muted">@{row.username || 'user'} · {row.subject || 'Ticket Admin'}</p>
          </div>
          <Stars value={row.rating} />
          <button className="rounded-lg p-2 text-fg-muted hover:bg-white/5" onClick={onClose} aria-label="Tutup riwayat"><X size={18} /></button>
        </header>
        <div className="border-b border-amber-500/20 bg-amber-500/10 px-5 py-2 text-[10px] text-amber-300">🔒 {SECURITY}</div>
        <div className="flex-1 space-y-3 overflow-y-auto p-5">
          {messages.map((message, index) => {
            const mine = message.sender_id !== row.user_id;
            return (
              <div key={message.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[78%] rounded-2xl px-4 py-2.5 text-sm ${mine ? 'rounded-br-sm bg-moss-600 text-white' : 'rounded-bl-sm surface-elevated text-fg'}`}>
                  {index === 0 && !mine ? <TicketBubble row={row as ChatThread} body={message.body} /> : <p className="whitespace-pre-wrap break-words">{message.body}</p>}
                  <p className="mt-1 text-right text-[9px] opacity-60">{formatChatTime(message.created_at)}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function AdminChatConsolePage() {
  const { user, toast } = useApp();
  const isAdmin = user?.role === 'admin';
  const [tab, setTab] = useState<'active' | 'history'>('active');
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [selected, setSelected] = useState<ChatThread | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [history, setHistory] = useState<ChatHistoryRow[]>([]);
  const [search, setSearch] = useState('');
  const [ratingFilter, setRatingFilter] = useState('');
  const [handler, setHandler] = useState('');
  const [date, setDate] = useState('');
  const [preview, setPreview] = useState<ChatHistoryRow | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [closing, setClosing] = useState(false);

  const refresh = useCallback(async (force = false) => {
    try {
      const rows = await loadMyThreads(force);
      setThreads(rows.filter((thread) => thread.thread_type === 'ticket' && thread.status === 'open'));
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Gagal memuat chat.', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { void refresh(true); }, [refresh]);

  useEffect(() => {
    if (!isAdmin || !user?.id) return;
    let timer: number | undefined;
    const schedule = () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => void refresh(true), 350);
    };
    const channel = supabase
      .channel(`admin-ticket-index-${user.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_threads', filter: `participant_id=eq.${user.id}` }, schedule)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'chat_threads', filter: `participant_id=eq.${user.id}` }, schedule)
      .subscribe();
    return () => {
      if (timer) window.clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [isAdmin, user?.id, refresh]);

  useEffect(() => {
    if (tab !== 'history') return;
    void getAdminChatHistory({
      search: search || undefined,
      rating: ratingFilter ? Number(ratingFilter) : null,
      handledBy: handler || null,
      sortDesc: true,
      limit: 200,
    }).then((rows) => setHistory(date ? rows.filter((row) => row.closed_at?.slice(0, 10) === date) : rows))
      .catch((error) => toast(error instanceof Error ? error.message : 'Gagal memuat history.', 'error'));
  }, [tab, search, ratingFilter, handler, date, toast]);

  useEffect(() => {
    if (!selected) return;
    let live = true;
    setMessages([]);
    void loadChatMessagesPage(selected.id, 100).then((items) => {
      if (live) setMessages(items);
    }).catch((error) => {
      if (live) toast(error instanceof Error ? error.message : 'Gagal memuat pesan.', 'error');
    });
    void markThreadRead(selected.id).catch(() => undefined);
    const channel = supabase
      .channel(`admin-ticket-${selected.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `thread_id=eq.${selected.id}` }, (payload) => {
        const message = payload.new as ChatMessage;
        if (live) setMessages((current) => current.some((item) => item.id === message.id) ? current : [...current, message]);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'chat_threads', filter: `id=eq.${selected.id}` }, (payload) => {
        if (live) setSelected((current) => current ? { ...current, ...(payload.new as ChatThread) } : current);
      })
      .subscribe();
    return () => {
      live = false;
      void supabase.removeChannel(channel);
    };
  }, [selected?.id, toast]);

  const claim = async () => {
    if (!selected) return;
    setClaiming(true);
    try {
      const thread = await claimChatTicket(selected.id);
      setSelected(thread);
      setThreads((current) => current.map((item) => item.id === thread.id ? thread : item));
      toast('Ticket berhasil diambil alih.', 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Ticket gagal diambil.', 'error');
    } finally {
      setClaiming(false);
    }
  };

  const finish = async () => {
    if (!selected) return;
    setClosing(true);
    try {
      const thread = await closeThread(selected.id);
      setSelected(thread);
      setThreads((current) => current.filter((item) => item.id !== thread.id));
      toast('Ticket ditutup.', 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Gagal menutup ticket.', 'error');
    } finally {
      setClosing(false);
    }
  };

  const send = async () => {
    if (!selected || selected.status !== 'open' || !selected.handled_by || !input.trim() || sending) return;
    setSending(true);
    try {
      const message = await sendMessage(selected.id, input.trim());
      setMessages((current) => current.some((item) => item.id === message.id) ? current : [...current, message]);
      setInput('');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Gagal mengirim pesan.', 'error');
    } finally {
      setSending(false);
    }
  };

  if (!isAdmin) {
    return <div className="min-h-screen flex items-center justify-center surface-bg"><Card className="p-6 text-center"><ShieldAlert className="mx-auto mb-2 text-red-400" /><p className="font-semibold text-fg">Akses ditolak</p></Card></div>;
  }

  return (
    <div className="h-screen overflow-hidden surface-bg p-3 md:p-5">
      <div className="mx-auto flex h-full max-w-7xl flex-col min-h-0">
        <div className="mb-3 flex shrink-0 items-center justify-between">
          <div className="flex items-center gap-2"><Link to="/admin" className="text-xs text-fg-muted">← Admin</Link><MessageCircle size={19} className="text-accent" /><h1 className="text-xl font-bold text-fg">Customer Service</h1></div>
          <Badge color="moss">{threads.length} ticket aktif</Badge>
        </div>
        <div className="mb-3 flex shrink-0 gap-1 border-b surface-border">
          <button onClick={() => setTab('active')} className={`border-b-2 px-4 py-2 text-sm font-medium ${tab === 'active' ? 'border-moss-500 text-fg' : 'border-transparent text-fg-muted'}`}>Chat Aktif</button>
          <button onClick={() => setTab('history')} className={`border-b-2 px-4 py-2 text-sm font-medium ${tab === 'history' ? 'border-moss-500 text-fg' : 'border-transparent text-fg-muted'}`}>History Chat & Rating</button>
        </div>

        {tab === 'history' ? (
          <div className="flex flex-1 min-h-0 flex-col">
            <div className="mb-3 grid shrink-0 gap-2 md:grid-cols-4">
              <div className="relative"><Search size={14} className="absolute left-3 top-3 text-fg-muted" /><input className="input w-full pl-9" placeholder="Nama / username" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
              <select className="input" value={ratingFilter} onChange={(event) => setRatingFilter(event.target.value)}><option value="">Semua rating</option>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} bintang</option>)}</select>
              <input className="input" placeholder="ID petugas" value={handler} onChange={(event) => setHandler(event.target.value)} />
              <div className="flex gap-2"><input type="date" className="input flex-1" value={date} onChange={(event) => setDate(event.target.value)} /><Button variant="outline" icon={<Filter size={14} />}>Filter</Button></div>
            </div>
            <div className="flex-1 min-h-0 space-y-2 overflow-y-auto">
              {history.length === 0 ? <Card className="p-8 text-center text-sm text-fg-muted">Belum ada riwayat ticket selesai.</Card> : history.map((row) => (
                <Card key={row.thread_id} className="p-4"><div className="flex items-center gap-3"><Avatar name={row.user_name || 'User'} id={row.user_id} size={36} /><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-fg">{row.user_name || 'User'}</p><p className="text-[11px] text-fg-muted">@{row.username || 'user'} · {row.subject || 'Ticket Admin'}</p><p className="mt-1 text-[10px] text-fg-muted">Dibuat {formatChatTime(row.created_at)} · selesai {formatChatTime(row.closed_at || row.created_at)} · {row.message_count} pesan</p></div><Stars value={row.rating} /><Button size="sm" variant="outline" onClick={() => setPreview(row)}>View Chat</Button></div></Card>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-1 min-h-0 overflow-hidden rounded-2xl border surface-border surface-card-bg">
            <aside className="flex w-[330px] shrink-0 flex-col border-r surface-border">
              <div className="border-b surface-border p-3"><p className="text-xs font-semibold text-fg">Ticket Masuk</p><p className="text-[10px] text-fg-muted">{threads.length} membutuhkan penanganan</p></div>
              <div className="flex-1 space-y-1 overflow-y-auto p-2">
                {threads.map((thread) => <button key={thread.id} onClick={() => setSelected(thread)} className={`w-full rounded-xl border p-3 text-left ${selected?.id === thread.id ? 'border-moss-500/50 bg-moss-500/10' : 'border-transparent hover:bg-white/5'}`}><div className="flex items-center gap-2.5"><Avatar name={thread.user_name || 'User'} id={thread.user_id} size={34} /><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-fg">{thread.user_name || 'User'}</p><p className="truncate text-[10px] text-fg-muted">@{thread.username || 'user'} · {thread.subject || 'Ticket Admin'}</p></div>{(thread.unread_count || 0) > 0 && <span className="min-w-5 rounded-full bg-red-500 px-1.5 py-0.5 text-center text-[9px] font-bold text-white">{thread.unread_count! > 99 ? '99+' : thread.unread_count}</span>}</div></button>)}
                {loading && <p className="py-5 text-center text-xs text-fg-muted">Memuat…</p>}
              </div>
            </aside>
            <section className="flex min-w-0 flex-1 flex-col">
              {!selected ? <div className="flex flex-1 items-center justify-center text-sm text-fg-muted">Pilih ticket.</div> : <>
                <header className="flex shrink-0 items-center gap-3 border-b surface-border p-3"><Avatar name={selected.user_name || 'User'} id={selected.user_id} size={40} /><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-fg">{selected.user_name || 'User'}</p><p className="truncate text-[11px] text-fg-muted">@{selected.username || 'user'} · {selected.subject || 'Ticket Admin'}</p></div>{selected.status === 'open' && !selected.handled_by && <Button size="sm" onClick={() => void claim()} disabled={claiming}>Ambil Ticket</Button>}{selected.status === 'open' && !!selected.handled_by && <Button size="sm" variant="outline" onClick={() => void finish()} disabled={closing} icon={<CheckCircle2 size={14} />}>Selesaikan</Button>}{selected.status === 'closed' && <Stars value={selected.rating} />}</header>
                <div className="border-b border-amber-500/20 bg-amber-500/10 px-3 py-2 text-[10px] text-amber-300">🔒 {SECURITY}</div>
                <div className="flex-1 space-y-3 overflow-y-auto p-4">{messages.map((message, index) => { const mine = message.sender_id === user.id; return <div key={message.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}><div className={`max-w-[78%] rounded-2xl px-4 py-2.5 text-sm ${mine ? 'rounded-br-sm bg-moss-600 text-white' : 'rounded-bl-sm surface-elevated text-fg'}`}>{index === 0 && !mine ? <TicketBubble row={selected} body={message.body} /> : <p className="whitespace-pre-wrap break-words">{message.body}</p>}<p className="mt-1 text-right text-[9px] opacity-60">{formatChatTime(message.created_at)}</p></div></div>; })}</div>
                {selected.status === 'open' && selected.handled_by === user.id && <div className="shrink-0 border-t surface-border p-3"><div className="flex gap-2"><textarea className="input min-h-[42px] max-h-28 flex-1 resize-none" value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send(); } }} placeholder="Tulis balasan…" /><Button onClick={() => void send()} disabled={!input.trim() || sending}>Kirim</Button></div></div>}
              </>}
            </section>
          </div>
        )}
      </div>
      {preview && <HistoryPreview row={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}
