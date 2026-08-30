import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, CheckCircle, Headphones, MessageCircle, Send, ShieldAlert, Star, X, Clock3 } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApp } from '@/store/AppContext';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { createTicketThread, getOrCreateDmThread, loadMessages, loadMyThreads, markThreadRead, sendMessage, closeThread, type ChatMessage, type ChatThread } from '@/services/chat.service';

const SECURITY = '🔒 Himbauan Keamanan: Jangan membagikan data pribadi sensitif (password, nomor HP, atau data finansial). Waspadai penipuan mengatasnamakan platform.';

function threadTitle(thread: ChatThread, isAdmin: boolean) {
  if (thread.thread_type === 'ticket') return isAdmin ? (thread.user_name || thread.username || 'Pengguna') : 'Admin Sykabelajar';
  return isAdmin ? (thread.user_name || thread.username || 'Pengguna') : (thread.other_user_name || thread.other_username || 'Pengguna');
}
function threadUsername(thread: ChatThread, isAdmin: boolean) {
  if (thread.thread_type === 'ticket') return isAdmin ? (thread.username || '') : 'sykabelajar';
  return isAdmin ? (thread.username || '') : (thread.other_username || '');
}
function threadAvatar(thread: ChatThread, isAdmin: boolean) {
  if (thread.thread_type === 'ticket') return isAdmin ? (thread.avatar_url || undefined) : undefined;
  return isAdmin ? (thread.avatar_url || undefined) : (thread.other_avatar_url || undefined);
}

function RatingModal({ onCancel, onSubmit, busy }: { onCancel: () => void; onSubmit: (rating: number) => void; busy: boolean }) {
  const [rating, setRating] = useState(0);
  return <div className="fixed inset-0 z-[100] flex items-center justify-center p-4"><div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onCancel}/><div className="relative w-full max-w-sm card p-6 text-center"><div className="w-12 h-12 rounded-full bg-amber-500/10 flex items-center justify-center mx-auto mb-3"><Star size={22} className="text-amber-400"/></div><h3 className="font-display font-semibold text-fg">Rating Layanan Admin</h3><p className="text-xs text-fg-muted mt-1">Pilih rating 1–5 untuk layanan percakapan ini.</p><div className="flex justify-center gap-2 my-5">{[1,2,3,4,5].map((n)=><button key={n} onClick={()=>setRating(n)} className="p-1"><Star size={30} className={n<=rating?'text-amber-400 fill-amber-400':'text-slate-600'} /></button>)}</div><div className="flex justify-end gap-2"><Button variant="ghost" onClick={onCancel}>Batal</Button><Button disabled={!rating||busy} onClick={()=>onSubmit(rating)}>{busy?'Menyimpan…':'Tandai Selesai'}</Button></div></div></div>;
}

function TicketModal({ onClose, onSubmit, busy }: { onClose: () => void; onSubmit: (subject: string, description: string) => void; busy: boolean }) {
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const valid = subject.trim() && description.trim();
  return <div className="fixed inset-0 z-[100] flex items-center justify-center p-4"><div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose}/><div className="relative w-full max-w-md card"><div className="flex items-center justify-between px-5 py-4 border-b surface-border"><div className="flex items-center gap-2"><Headphones size={18} className="text-accent"/><h3 className="font-display font-semibold text-fg">Hubungi Admin</h3></div><button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/5 text-fg-muted"><X size={18}/></button></div><div className="p-5 space-y-4"><div><label className="text-xs text-fg-muted block mb-1.5">Judul / Subjek Kendala *</label><input autoFocus className="input w-full" value={subject} onChange={e=>setSubject(e.target.value)} placeholder="Contoh: Kendala pembayaran" maxLength={120}/></div><div><label className="text-xs text-fg-muted block mb-1.5">Deskripsi Pesan *</label><textarea className="input w-full min-h-32 resize-none" value={description} onChange={e=>setDescription(e.target.value)} placeholder="Jelaskan kendala secara detail…" maxLength={4000}/></div><p className="text-[10px] text-fg-muted">Anda hanya dapat memiliki satu laporan aktif pada satu waktu.</p><div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Batal</Button><Button disabled={!valid||busy} onClick={()=>onSubmit(subject.trim(),description.trim())}>{busy?'Membuat…':'Kirim Laporan'}</Button></div></div></div></div>;
}

export function AdminChatPageV2() {
  const { user, toast } = useApp();
  const [searchParams, setSearchParams] = useSearchParams();
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [selected, setSelected] = useState<ChatThread | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [ticketModal, setTicketModal] = useState(false);
  const [ticketBusy, setTicketBusy] = useState(false);
  const [ratingModal, setRatingModal] = useState(false);
  const [ratingBusy, setRatingBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const isAdmin = user?.role === 'admin';

  const refreshThreads = useCallback(async () => {
    if (!user) return;
    try { setThreads(await loadMyThreads()); } catch (e: any) { toast(e?.message ?? 'Gagal memuat chat.', 'error'); }
    finally { setLoading(false); }
  }, [user?.id, toast]);

  useEffect(() => { void refreshThreads(); const timer = window.setInterval(()=>void refreshThreads(), 7000); return ()=>window.clearInterval(timer); }, [refreshThreads]);

  useEffect(() => {
    const userId = searchParams.get('user_id');
    if (!userId || !user) return;
    let active = true;
    (async()=>{ try { const t=await getOrCreateDmThread(userId); if(!active)return; setSelected(t); await refreshThreads(); } catch(e:any){toast(e?.message??'Gagal membuka chat.', 'error');} finally { searchParams.delete('user_id'); setSearchParams(searchParams,{replace:true}); } })();
    return ()=>{active=false;};
  }, [searchParams,user?.id,refreshThreads,setSearchParams,toast]);

  useEffect(()=>{
    if(!selected) { setMessages([]); return; }
    let active=true;
    const refresh=async()=>{ try { const list=await loadMessages(selected.id); if(active)setMessages(list); await markThreadRead(selected.id); } catch(e:any){ if(active)toast(e?.message??'Gagal memuat pesan.','error'); } };
    void refresh(); const timer=window.setInterval(()=>void refresh(),3000);
    return()=>{active=false;window.clearInterval(timer);};
  },[selected?.id,toast]);

  useEffect(()=>{ endRef.current?.scrollIntoView({behavior:'smooth'}); },[messages.length]);

  const activeThreads = useMemo(()=>threads.filter(t=>t.status==='open'),[threads]);
  const closedThreads = useMemo(()=>threads.filter(t=>t.status==='closed'),[threads]);
  const activeTicket = !isAdmin ? activeThreads.find(t=>t.thread_type==='ticket') : undefined;

  const selectThread = async(t:ChatThread)=>{ setSelected(t); try { await markThreadRead(t.id); } catch {} };

  const send = async()=>{
    if(!selected||selected.status!=='open'||!input.trim()||sending)return;
    setSending(true); try { const msg=await sendMessage(selected.id,input.trim()); setMessages(prev=>prev.some(m=>m.id===msg.id)?prev:[...prev,msg]); setInput(''); await markThreadRead(selected.id); await refreshThreads(); } catch(e:any){toast(e?.message??'Gagal mengirim.','error');} finally{setSending(false);} 
  };
  const onKey=(e:React.KeyboardEvent)=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();void send();}};

  const createTicket = async(subject:string,description:string)=>{
    setTicketBusy(true); try { const t=await createTicketThread(subject,description); await sendMessage(t.id,`📋 ${subject}\n\n${description}`); setTicketModal(false); setSelected(t); await refreshThreads(); toast('Laporan berhasil dikirim ke Admin.','success'); } catch(e:any){toast(e?.message??'Gagal membuat laporan.','error');} finally{setTicketBusy(false);} 
  };

  const finishTicket = async(rating:number)=>{
    if(!selected)return; setRatingBusy(true); try { const closed=await closeThread(selected.id,rating); setSelected(closed); setRatingModal(false); await refreshThreads(); toast('Ticket ditandai selesai.','success'); } catch(e:any){toast(e?.message??'Gagal menutup ticket.','error');} finally{setRatingBusy(false);} 
  };

  return <div className="min-h-screen surface-bg text-fg-secondary p-4 md:p-7"><div className="max-w-6xl mx-auto">
    <Link to="/home" className="inline-flex items-center gap-2 text-xs text-fg-muted hover:text-fg mb-4"><ArrowLeft size={14}/> Kembali</Link>
    <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-5"><div><div className="flex items-center gap-2"><MessageCircle size={20} className="text-accent"/><h1 className="text-2xl font-bold text-fg">Pesan</h1><Badge color="moss">{activeThreads.length} aktif</Badge></div><p className="text-xs text-fg-muted mt-1">Pesan antar pengguna dan layanan bantuan Admin.</p></div>{!isAdmin&&<Button size="sm" icon={<Headphones size={14}/>} onClick={()=>{ if(activeTicket){toast('Anda masih memiliki laporan yang sedang berjalan. Tunggu hingga laporan diselesaikan oleh Admin.','info');return;} setTicketModal(true); }}>Hubungi Admin</Button>}</div>
    <div className="grid md:grid-cols-[300px_1fr] h-[calc(100vh-190px)] min-h-[520px] rounded-2xl border surface-border overflow-hidden surface-elevated/20">
      <aside className="border-r surface-border overflow-y-auto p-2 md:p-3 bg-black/[.02] dark:bg-white/[.01]">
        <p className="text-[11px] font-semibold text-fg-muted px-2 py-2">Aktif · {activeThreads.length}</p>
        {loading?<div className="text-center text-xs text-fg-muted py-8">Memuat…</div>:activeThreads.length===0?<div className="text-center text-xs text-fg-muted py-8">Belum ada percakapan aktif.</div>:activeThreads.map(t=><button key={t.id} onClick={()=>void selectThread(t)} className={`w-full text-left p-3 rounded-xl mb-1 border transition ${selected?.id===t.id?'border-moss-500/50 bg-moss-500/10':'border-transparent hover:bg-white/5'}`}><div className="flex items-center gap-2.5"><Avatar name={threadTitle(t,!!isAdmin)} id={t.user_id} size={34} src={threadAvatar(t,!!isAdmin)}/><div className="min-w-0 flex-1"><div className="flex items-center gap-1.5"><p className="text-sm font-medium text-fg truncate">{threadTitle(t,!!isAdmin)}</p>{t.thread_type==='ticket'&&<span className="text-[9px] rounded bg-amber-500/10 text-amber-400 px-1.5 py-0.5">TICKET</span>}</div><p className="text-[10px] text-fg-muted truncate">@{threadUsername(t,!!isAdmin)} · {t.last_message||'Belum ada pesan'}</p></div>{(t.unread_count??0)>0&&<span className="min-w-5 h-5 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">{(t.unread_count??0)>99?'99+':t.unread_count}</span>}</div></button>)}
        {closedThreads.length>0&&<><p className="text-[11px] font-semibold text-fg-muted px-2 pt-4 pb-2">Selesai · {closedThreads.length}</p>{closedThreads.slice(0,30).map(t=><button key={t.id} onClick={()=>void selectThread(t)} className={`w-full text-left p-3 rounded-xl mb-1 border transition opacity-75 ${selected?.id===t.id?'border-moss-500/40 bg-moss-500/5':'border-transparent hover:bg-white/5'}`}><div className="flex items-center gap-2.5"><Avatar name={threadTitle(t,!!isAdmin)} id={t.user_id} size={30} src={threadAvatar(t,!!isAdmin)}/><div className="min-w-0 flex-1"><p className="text-xs text-fg truncate">{threadTitle(t,!!isAdmin)}</p><div className="flex items-center gap-1 mt-0.5">{t.rating?[1,2,3,4,5].map(n=><Star key={n} size={9} className={n<=t.rating!?'text-amber-400 fill-amber-400':'text-slate-700'}/>):<span className="text-[9px] text-fg-muted">Belum dinilai</span>}</div></div><Badge color="default">Selesai</Badge></div></button>)}</>}
      </aside>
      <section className="flex flex-col min-w-0">
        {!selected?<div className="flex-1 flex items-center justify-center p-8"><div className="text-center"><MessageCircle size={40} className="text-slate-700 mx-auto mb-3"/><p className="text-sm text-fg-muted">Pilih percakapan untuk mulai membaca.</p><p className="text-[11px] text-fg-muted mt-1">Semua pesan tersimpan dan dipisahkan per peserta.</p></div></div>:<>
          <div className="sticky top-0 z-10 px-4 py-3 border-b surface-border surface-card-bg"><div className="flex items-center gap-3"><Avatar name={threadTitle(selected,!!isAdmin)} id={selected.user_id} size={38} src={threadAvatar(selected,!!isAdmin)}/><div className="flex-1 min-w-0"><p className="font-semibold text-sm text-fg truncate">{threadTitle(selected,!!isAdmin)}</p><p className="text-[10px] text-fg-muted">@{threadUsername(selected,!!isAdmin)}{selected.thread_type==='ticket'?' · Helpdesk Admin':''}</p></div>{selected.status==='open'&&selected.thread_type==='ticket'&&isAdmin&&<Button size="sm" variant="outline" onClick={()=>setRatingModal(true)} icon={<CheckCircle size={14}/>}>Tandai Selesai</Button>}{selected.status==='closed'&&<Badge color="default">Selesai</Badge>}</div>{selected.thread_type==='ticket'&&selected.subject&&<div className="mt-3 p-3 rounded-xl surface-elevated border surface-border"><p className="text-[10px] uppercase tracking-wide text-fg-muted">Subjek Laporan</p><p className="text-sm font-medium text-fg mt-0.5">{selected.subject}</p></div>}</div>
          <div className="px-4 py-2 bg-amber-500/10 border-b border-amber-500/20 flex items-start gap-2"><ShieldAlert size={14} className="text-amber-400 mt-0.5 shrink-0"/><p className="text-[10px] leading-relaxed text-amber-300">{SECURITY}</p></div>
          <div className="flex-1 overflow-y-auto p-4 space-y-3"><div className="text-center text-[10px] text-fg-muted py-2">Riwayat percakapan</div>{messages.map(m=>{const me=m.sender_id===user?.id;return <div key={m.id} className={`flex ${me?'justify-end':'justify-start'}`}><div className={`max-w-[78%] px-3.5 py-2.5 rounded-2xl text-sm whitespace-pre-wrap break-words ${me?'bg-moss-600 text-white rounded-br-sm':'surface-card-bg border surface-border text-fg-secondary rounded-bl-sm'}`}><p>{m.body}</p><p className={`text-[9px] mt-1 ${me?'text-moss-200':'text-fg-muted'}`}>{new Date(m.created_at).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'})}</p></div></div>})}<div ref={endRef}/></div>
          {selected.status==='open'?<div className="p-3 border-t surface-border"><div className="flex gap-2"><input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={onKey} className="flex-1 input" placeholder="Ketik pesan…"/><button onClick={()=>void send()} disabled={!input.trim()||sending} className="w-10 h-10 rounded-xl bg-moss-500 hover:bg-moss-600 disabled:opacity-40 text-white flex items-center justify-center shrink-0"><Send size={17}/></button></div></div>:<div className="p-4 border-t surface-border text-center"><p className="text-xs text-fg-muted">Percakapan ini telah selesai.</p>{selected.rating&&<div className="flex justify-center gap-1 mt-2">{[1,2,3,4,5].map(n=><Star key={n} size={13} className={n<=selected.rating!?'text-amber-400 fill-amber-400':'text-slate-700'}/>)}</div>}</div>}
        </>}
      </section>
    </div>
  </div>{ticketModal&&<TicketModal onClose={()=>setTicketModal(false)} onSubmit={(s,d)=>void createTicket(s,d)} busy={ticketBusy}/>} {ratingModal&&<RatingModal onCancel={()=>setRatingModal(false)} onSubmit={(r)=>void finishTicket(r)} busy={ratingBusy}/>}</div>;
}
