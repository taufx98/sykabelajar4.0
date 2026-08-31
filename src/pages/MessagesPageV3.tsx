import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent } from 'react';
import { ArrowLeft, CheckCircle2, FileText, Headphones, Lock, MessageCircle, Paperclip, Send, ShieldAlert, Star, Trash2, Unlock, X } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { useApp } from '@/store/AppContext';
import { supabase } from '@/lib/supabase';
import { blockChatUser, closeThread, createTicketThread, getOrCreateDmThread, hideChatThread, isChatBlocked, loadMessages, loadMyThreads, markThreadRead, sendMessage, unblockChatUser, type ChatMessage, type ChatThread } from '@/services/chat.service';
import { attachChatMedia, isHttpUrl, isImageUrl, uploadChatAttachment, validateChatFile } from '@/services/chatMedia.service';

const SECURITY = '🔒 Jangan membagikan password, OTP, nomor HP, atau data finansial. Waspadai penipuan.';
const isTicket = (thread: ChatThread) => thread.thread_type === 'ticket';

function peerName(thread: ChatThread, me: string, admin: boolean) {
  if (isTicket(thread)) return admin ? (thread.user_name || thread.username || 'Pengguna') : 'Admin Sykabelajar';
  return thread.user_id === me ? (thread.other_user_name || thread.other_username || 'Pengguna') : (thread.user_name || thread.username || 'Pengguna');
}
function peerUsername(thread: ChatThread, me: string, admin: boolean) {
  if (isTicket(thread)) return admin ? (thread.username || '') : 'sykabelajar';
  return thread.user_id === me ? (thread.other_username || '') : (thread.username || '');
}
function peerAvatar(thread: ChatThread, me: string, admin: boolean) {
  if (isTicket(thread)) return admin ? thread.avatar_url : undefined;
  return thread.user_id === me ? thread.other_avatar_url : thread.avatar_url;
}

function TicketModal({ onClose, onSubmit, busy }: { onClose: () => void; onSubmit: (subject: string, description: string) => void; busy: boolean }) {
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  return <div className="fixed inset-0 z-[120] flex items-center justify-center p-4"><div className="absolute inset-0 bg-black/70" onClick={onClose}/><div className="relative w-full max-w-md card p-5"><div className="flex items-center justify-between"><div><h3 className="font-semibold text-fg">Hubungi Admin</h3><p className="text-[11px] text-fg-muted mt-0.5">Satu laporan aktif per akun.</p></div><button onClick={onClose} aria-label="Tutup"><X size={18}/></button></div><div className="mt-4 space-y-3"><input autoFocus className="input w-full" maxLength={120} value={subject} onChange={e=>setSubject(e.target.value)} placeholder="Subjek kendala *"/><textarea className="input w-full min-h-32 resize-none" maxLength={4000} value={description} onChange={e=>setDescription(e.target.value)} placeholder="Jelaskan kendala *"/><div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Batal</Button><Button disabled={busy || !subject.trim() || !description.trim()} onClick={()=>onSubmit(subject.trim(),description.trim())}>{busy?'Mengirim…':'Kirim Laporan'}</Button></div></div></div></div>;
}

function RatingModal({ onClose, onSubmit, busy }: { onClose: () => void; onSubmit: (rating: number) => void; busy: boolean }) {
  const [rating, setRating] = useState(0);
  return <div className="fixed inset-0 z-[120] flex items-center justify-center p-4"><div className="absolute inset-0 bg-black/70" onClick={onClose}/><div className="relative w-full max-w-sm card p-6 text-center"><Star size={25} className="mx-auto text-amber-400 fill-amber-400"/><h3 className="mt-3 font-semibold text-fg">Nilai Layanan Admin</h3><div className="my-5 flex justify-center gap-2">{[1,2,3,4,5].map(n=><button key={n} onClick={()=>setRating(n)} aria-label={`Nilai ${n}`}><Star size={29} className={n<=rating?'text-amber-400 fill-amber-400':'text-slate-600'}/></button>)}</div><div className="flex gap-2"><Button fullWidth variant="outline" onClick={onClose}>Nanti</Button><Button fullWidth disabled={!rating||busy} onClick={()=>onSubmit(rating)}>{busy?'Menyimpan…':'Kirim Rating'}</Button></div></div></div>;
}

export function MessagesPageV3() {
  const { user, toast } = useApp();
  const me = user?.id || '';
  const isAdmin = user?.role === 'admin';
  const [params, setParams] = useSearchParams();
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [selected, setSelected] = useState<ChatThread | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [mobileList, setMobileList] = useState(true);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [fileBusy, setFileBusy] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [blockedByMe, setBlockedByMe] = useState(false);
  const [ticketModal, setTicketModal] = useState(false);
  const [ticketBusy, setTicketBusy] = useState(false);
  const [ratingModal, setRatingModal] = useState(false);
  const [ratingBusy, setRatingBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const counterpart = useMemo(() => selected ? (selected.user_id === me ? selected.participant_id : selected.user_id) : null, [selected, me]);

  const reloadThreads = useCallback(async () => {
    if (!user) return;
    try { setThreads(await loadMyThreads()); } catch (e: any) { toast(e?.message || 'Gagal memuat chat.', 'error'); }
    finally { setLoading(false); }
  }, [user?.id, toast]);

  useEffect(() => { void reloadThreads(); const timer = window.setInterval(() => void reloadThreads(), 30000); return () => window.clearInterval(timer); }, [reloadThreads]);

  useEffect(() => {
    const target = params.get('user_id');
    if (!target || !user) return;
    let live = true;
    (async () => {
      try {
        const thread = await getOrCreateDmThread(target);
        if (!live) return;
        setSelected(thread); setMobileList(false); await reloadThreads();
      } catch (e: any) { if (live) toast(e?.message || 'Chat tidak tersedia.', 'error'); }
      finally { if (live) { const next = new URLSearchParams(params); next.delete('user_id'); setParams(next, { replace: true }); } }
    })();
    return () => { live = false; };
  }, [params, setParams, user?.id, reloadThreads, toast]);

  useEffect(() => {
    if (!selected || !user) return;
    let live = true;
    (async () => {
      try { const data = await loadMessages(selected.id); if (live) setMessages(data); await markThreadRead(selected.id); }
      catch (e: any) { if (live) toast(e?.message || 'Gagal memuat pesan.', 'error'); }
    })();
    const channel = supabase.channel(`chat-page-v3-${selected.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `thread_id=eq.${selected.id}` }, payload => {
        const message = payload.new as ChatMessage;
        setMessages(current => current.some(x => x.id === message.id) ? current : [...current, message]);
        if (message.sender_id !== me) void markThreadRead(selected.id).catch(() => undefined);
        void reloadThreads();
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'chat_threads', filter: `id=eq.${selected.id}` }, payload => setSelected(payload.new as ChatThread))
      .subscribe();
    return () => { live = false; void supabase.removeChannel(channel); };
  }, [selected?.id, me, user?.id, reloadThreads, toast]);

  useEffect(() => {
    if (!counterpart || !user) { setBlocked(false); setBlockedByMe(false); return; }
    let live = true;
    (async () => {
      try {
        const blockedNow = await isChatBlocked(counterpart); if (live) setBlocked(blockedNow);
        const { data } = await supabase.from('chat_blocks').select('blocker_id').eq('blocker_id',user.id).eq('blocked_id',counterpart).maybeSingle();
        if (live) setBlockedByMe(Boolean(data));
      } catch { if (live) { setBlocked(false); setBlockedByMe(false); } }
    })();
    return () => { live = false; };
  }, [counterpart, user?.id]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages.length]);

  const openThreads = useMemo(() => threads.filter(t => t.status === 'open'), [threads]);
  const closedThreads = useMemo(() => threads.filter(t => t.status === 'closed'), [threads]);
  const activeTicket = !isAdmin ? openThreads.find(isTicket) || null : null;

  const choose = async (thread: ChatThread) => { setSelected(thread); setMessages([]); setMobileList(false); setBlocked(false); await markThreadRead(thread.id).catch(() => undefined); };

  const sendText = async () => {
    if (!selected || selected.status !== 'open' || blocked || !input.trim() || sending) return;
    const text = input.trim();
    const optimistic: ChatMessage = { id: `local-${crypto.randomUUID()}`, thread_id: selected.id, sender_id: me, body: text, created_at: new Date().toISOString() };
    setMessages(current => [...current, optimistic]); setInput(''); setSending(true);
    try { const saved = await sendMessage(selected.id, text); setMessages(current => current.map(x => x.id === optimistic.id ? saved : x)); await reloadThreads(); }
    catch (e: any) { setMessages(current => current.filter(x => x.id !== optimistic.id)); toast(e?.message || 'Gagal mengirim pesan.', 'error'); }
    finally { setSending(false); }
  };

  const sendFile = async (file: File) => {
    if (!selected || selected.status !== 'open' || blocked || fileBusy) return;
    try {
      validateChatFile(file); setFileBusy(true);
      const uploaded = await uploadChatAttachment(file, selected.id, me);
      const savedMessage = await sendMessage(selected.id, uploaded.secure_url);
      await attachChatMedia(uploaded.media_id, savedMessage.id);
      setMessages(current => [...current, savedMessage]); await reloadThreads(); toast('Lampiran berhasil dikirim.', 'success');
    } catch (e: any) { toast(e?.message || 'Lampiran gagal dikirim.', 'error'); }
    finally { setFileBusy(false); }
  };

  const onPaste = (event: ClipboardEvent) => {
    const item = Array.from(event.clipboardData.items).find(candidate => candidate.kind === 'file' && candidate.type.startsWith('image/'));
    const file = item?.getAsFile();
    if (file) { event.preventDefault(); void sendFile(file); }
  };
  const onDrop = (event: DragEvent) => { event.preventDefault(); setDropActive(false); const file = event.dataTransfer.files?.[0]; if (file) void sendFile(file); };

  const hide = async (thread: ChatThread) => {
    setThreads(current => current.filter(x => x.id !== thread.id));
    if (selected?.id === thread.id) { setSelected(null); setMessages([]); setMobileList(true); }
    try { await hideChatThread(thread.id); toast('Chat telah dihapus', 'success'); }
    catch (e: any) { toast(e?.message || 'Gagal menghapus chat.', 'error'); void reloadThreads(); }
  };

  const toggleBlock = async () => {
    if (!counterpart) return;
    const wasBlocked = blocked;
    setBlocked(!wasBlocked);
    try { if (wasBlocked) await unblockChatUser(counterpart); else await blockChatUser(counterpart); toast(wasBlocked ? 'Blokir chat dibuka.' : 'Pengguna diblokir.', 'success'); }
    catch (e: any) { setBlocked(wasBlocked); toast(e?.message || 'Gagal mengubah blokir.', 'error'); }
  };

  const createTicket = async (subject: string, description: string) => {
    setTicketBusy(true);
    try { const thread = await createTicketThread(subject, description); setTicketModal(false); setSelected(thread); setMobileList(false); setThreads(current => [thread, ...current.filter(x => x.id !== thread.id)]); toast('Laporan berhasil dikirim.', 'success'); }
    catch (e: any) { toast(e?.message || 'Gagal membuat laporan.', 'error'); }
    finally { setTicketBusy(false); }
  };

  const finishTicket = async () => {
    if (!selected || !isAdmin || !isTicket(selected) || selected.status !== 'open') return;
    setTicketBusy(true);
    try { const closed = await closeThread(selected.id); setSelected(closed); setThreads(current => current.map(x => x.id === closed.id ? closed : x)); toast('Percakapan otomatis diselesaikan.', 'success'); }
    catch (e: any) { toast(e?.message || 'Gagal menyelesaikan percakapan.', 'error'); }
    finally { setTicketBusy(false); }
  };

  const rateTicket = async (rating: number) => {
    if (!selected || isAdmin || !isTicket(selected) || selected.status !== 'closed') return;
    setRatingBusy(true);
    try { const closed = await closeThread(selected.id, rating); setSelected(closed); setThreads(current => current.map(x => x.id === closed.id ? closed : x)); setRatingModal(false); toast('Rating tersimpan.', 'success'); }
    catch (e: any) { toast(e?.message || 'Gagal menyimpan rating.', 'error'); }
    finally { setRatingBusy(false); }
  };

  const renderBody = (body: string) => {
    if (isImageUrl(body)) return <a href={body} target="_blank" rel="noreferrer"><img src={body} alt="Lampiran gambar" loading="lazy" className="rounded-xl object-contain" style={{ maxWidth: 512, maxHeight: 512 }} /></a>;
    if (isHttpUrl(body) && /\.pdf(?:$|[?#])/i.test(body)) return <a href={body} target="_blank" rel="noreferrer" className="flex items-center gap-2 underline"><FileText size={16}/>Buka PDF</a>;
    if (isHttpUrl(body)) return <a href={body} target="_blank" rel="noreferrer" className="break-all underline">{body}</a>;
    return <p className="whitespace-pre-wrap break-words">{body}</p>;
  };

  return <div className="h-[calc(100vh-56px)] md:h-screen overflow-hidden surface-bg p-2 md:p-4">
    <div className="h-full max-w-7xl mx-auto flex flex-col">
      <div className="shrink-0 flex items-center justify-between pb-2"><Link to="/home" className="inline-flex items-center gap-2 text-xs text-fg-muted"><ArrowLeft size={14}/>Kembali</Link>{!isAdmin&&<Button size="sm" icon={<Headphones size={14}/>} onClick={()=>activeTicket?toast('Masih ada laporan yang belum selesai.','info'):setTicketModal(true)}>Hubungi Admin</Button>}</div>
      <div className="shrink-0 flex items-center gap-2 pb-3"><MessageCircle size={21} className="text-accent"/><h1 className="text-xl font-bold text-fg">Pesan</h1><Badge color="moss">{openThreads.length} aktif</Badge></div>
      <div className="flex-1 min-h-0 grid md:grid-cols-[320px_1fr] rounded-2xl overflow-hidden border surface-border surface-card-bg">
        <aside className={`${mobileList?'flex':'hidden'} md:flex min-h-0 flex-col border-r surface-border`}><div className="shrink-0 p-3 border-b surface-border"><p className="text-xs font-semibold text-fg">Percakapan</p><p className="text-[10px] text-fg-muted">DM antar pengguna & helpdesk</p></div><div className="flex-1 min-h-0 overflow-y-auto p-2"><p className="px-2 py-2 text-[10px] uppercase tracking-wider text-fg-muted">Aktif · {openThreads.length}</p>{loading?<p className="p-8 text-center text-xs text-fg-muted">Memuat…</p>:openThreads.map(thread=><ThreadRow key={thread.id} thread={thread} me={me} admin={isAdmin} active={selected?.id===thread.id} closed={false} onClick={()=>void choose(thread)} onHide={()=>void hide(thread)}/>)}<p className="px-2 pt-4 pb-2 text-[10px] uppercase tracking-wider text-fg-muted">Selesai · {closedThreads.length}</p>{closedThreads.slice(0,50).map(thread=><ThreadRow key={thread.id} thread={thread} me={me} admin={isAdmin} active={selected?.id===thread.id} closed onClick={()=>void choose(thread)} onHide={()=>void hide(thread)}/>)}</div></aside>
        <section className={`${mobileList?'hidden':'flex'} md:flex min-h-0 flex-col`} onDragOver={event=>{event.preventDefault();setDropActive(true)}} onDragLeave={event=>{if(event.currentTarget===event.target)setDropActive(false)}} onDrop={onDrop}>
          {!selected?<div className="flex-1 grid place-items-center text-center p-8 text-sm text-fg-muted">Pilih percakapan.</div>:<>
            <header className="shrink-0 px-4 py-3 border-b surface-border flex items-center gap-3"><button className="md:hidden" onClick={()=>setMobileList(true)}><ArrowLeft size={17}/></button><Avatar name={peerName(selected,me,isAdmin)} id={counterpart||selected.user_id} size={40} src={peerAvatar(selected,me,isAdmin)}/><div className="flex-1 min-w-0"><p className="truncate text-sm font-semibold text-fg">{peerName(selected,me,isAdmin)}</p><p className="truncate text-[10px] text-fg-muted">@{peerUsername(selected,me,isAdmin)}</p></div>{!isTicket(selected)&&counterpart&&<Button size="sm" variant="outline" icon={blocked?<Unlock size={14}/>:<Lock size={14}/>} onClick={()=>void toggleBlock()}>{blocked?'Buka Blokir':'Blokir'}</Button>}{!isTicket(selected)&&<Button size="sm" variant="outline" icon={<Trash2 size={14}/>} onClick={()=>void hide(selected)}>Hapus Chat</Button>}{isAdmin&&isTicket(selected)&&selected.status==='open'&&<Button size="sm" variant="outline" icon={<CheckCircle2 size={14}/>} disabled={ticketBusy} onClick={()=>void finishTicket()}>{ticketBusy?'Memproses…':'Selesaikan'}</Button>}</header>
            <div className="shrink-0 px-4 py-2 bg-amber-500/10 border-b border-amber-500/20 flex items-start gap-2"><ShieldAlert size={14} className="text-amber-400 mt-0.5"/><p className="text-[10px] leading-relaxed text-amber-300">{SECURITY}</p></div>
            {blocked&&<div className="shrink-0 px-4 py-2.5 bg-red-500/10 border-b border-red-500/20 text-center text-xs text-red-300">{blockedByMe?`@${peerUsername(selected,me,isAdmin)} telah diblokir.`:`@${peerUsername(selected,me,isAdmin)} telah memblokir anda.`}</div>}
            {isTicket(selected)&&<div className="shrink-0 px-4 py-2 border-b surface-border"><p className="text-[9px] uppercase text-fg-muted">Ringkasan Laporan</p><p className="text-sm font-medium text-fg">{selected.subject||'Bantuan'}</p>{selected.description&&<p className="text-xs text-fg-muted mt-1">{selected.description}</p>}{!isAdmin&&selected.status==='closed'&&<Button size="sm" className="mt-2" onClick={()=>setRatingModal(true)}>Beri Rating</Button>}</div>}
            <div className="relative flex-1 min-h-0 overflow-y-auto p-4 space-y-3" onPaste={onPaste}>{dropActive&&<div className="absolute inset-3 z-20 rounded-2xl border-2 border-dashed border-accent bg-accent/10 backdrop-blur-sm grid place-items-center pointer-events-none"><div className="text-center"><Paperclip size={28} className="mx-auto text-accent"/><p className="mt-2 text-sm font-semibold text-fg">Lepaskan file di sini</p><p className="text-xs text-fg-muted">JPG, PNG, PDF · maksimal 2MB</p></div></div>}{messages.map(message=><div key={message.id} className={`flex ${message.sender_id===me?'justify-end':'justify-start'}`}><div className={`max-w-[82%] rounded-2xl px-3.5 py-2.5 ${message.sender_id===me?'bg-moss-600 text-white rounded-br-sm':'surface-elevated border surface-border text-fg-secondary rounded-bl-sm'}`}>{renderBody(message.body)}<p className="mt-1 text-[9px] opacity-60">{new Date(message.created_at).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'})}</p></div></div>)}{!messages.length&&<p className="py-12 text-center text-xs text-fg-muted">Belum ada pesan.</p>}<div ref={endRef}/></div>
            <footer className="shrink-0 border-t surface-border p-3"><input ref={fileRef} type="file" hidden accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf" onChange={event=>{const file=event.target.files?.[0];if(file)void sendFile(file);event.currentTarget.value='';}}/><div className="flex items-end gap-2"><button disabled={fileBusy||blocked||selected.status!=='open'} onClick={()=>fileRef.current?.click()} className="shrink-0 rounded-xl p-2.5 surface-elevated text-fg-muted hover:text-fg disabled:opacity-40" title="Kirim JPG, PNG, atau PDF"><Paperclip size={18}/></button><textarea value={input} disabled={blocked||selected.status!=='open'||sending} onChange={event=>setInput(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();void sendText();}}} placeholder={blocked?(blockedByMe?'Anda memblokir pengguna ini.':`@${peerUsername(selected,me,isAdmin)} telah memblokir anda.`):selected.status==='closed'?'Percakapan telah selesai.':'Tulis pesan…'} className="input flex-1 min-h-11 max-h-28 resize-none"/><Button disabled={!input.trim()||sending||blocked||selected.status!=='open'} onClick={()=>void sendText()} aria-label="Kirim"><Send size={17}/></Button></div><p className="mt-1 text-[9px] text-fg-muted">JPG/PNG/PDF maksimal 2MB · gambar otomatis maksimal 512×512 · paste & drag-drop</p></footer>
          </>}
        </section>
      </div>
    </div>
    {ticketModal&&<TicketModal onClose={()=>setTicketModal(false)} onSubmit={createTicket} busy={ticketBusy}/>} {ratingModal&&<RatingModal onClose={()=>setRatingModal(false)} onSubmit={rateTicket} busy={ratingBusy}/>}
  </div>;
}

function ThreadRow({ thread, me, admin, active, closed, onClick, onHide }: { thread: ChatThread; me: string; admin: boolean; active: boolean; closed: boolean; onClick: () => void; onHide: () => void }) {
  const unread = Number(thread.unread_count || 0) > 0;
  return <div className={`flex items-center gap-1 rounded-xl mb-1 border ${active?'border-accent/40 bg-accent/10':'border-transparent hover:bg-white/5'}`}><button onClick={onClick} className="flex-1 min-w-0 p-3 text-left"><div className="flex items-center gap-3"><Avatar name={peerName(thread,me,admin)} id={thread.user_id===me?(thread.participant_id||'u'):thread.user_id} size={38} src={peerAvatar(thread,me,admin)}/><div className="min-w-0 flex-1"><p className="text-sm font-medium text-fg truncate">{peerName(thread,me,admin)}</p><p className="text-[10px] text-fg-muted truncate">{isTicket(thread)?thread.subject||'Laporan':`@${peerUsername(thread,me,admin)}`}</p></div><span title={unread?'Belum dibaca':'Sudah dibaca'} className={`w-2.5 h-2.5 rounded-full shrink-0 ${closed?'bg-slate-600':unread?'bg-emerald-400':'bg-slate-600'}`}/></div></button><button onClick={onHide} className="shrink-0 p-2 rounded-lg text-fg-muted hover:text-red-400" title={closed?'Hapus dari daftar':'Hapus chat'}><Trash2 size={15}/></button></div>;
}
