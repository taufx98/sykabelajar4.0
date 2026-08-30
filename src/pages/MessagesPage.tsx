import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, Headphones, MessageCircle, Send, ShieldAlert, Star, X } from 'lucide-react';
import { useApp } from '@/store/AppContext';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { closeThread, createTicketThread, getOrCreateDmThread, loadMessages, loadMyThreads, markThreadRead, sendMessage, type ChatMessage, type ChatThread } from '@/services/chat.service';
import { supabase } from '@/lib/supabase';

const SECURITY = '🔒 Himbauan Keamanan: Jangan membagikan data pribadi sensitif (password, nomor HP, atau data finansial). Waspadai penipuan mengatasnamakan platform.';

const isTicket = (thread: ChatThread) => thread.thread_type === 'ticket';
const threadTitle = (thread: ChatThread, admin: boolean) => isTicket(thread) ? (admin ? (thread.user_name || thread.username || 'Pengguna') : 'Admin Sykabelajar') : (admin ? (thread.other_user_name || thread.other_username || thread.user_name || 'Pengguna') : (thread.other_user_name || thread.other_username || 'Pengguna'));
const threadUsername = (thread: ChatThread, admin: boolean) => isTicket(thread) ? (admin ? (thread.username || '') : 'sykabelajar') : (admin ? (thread.other_username || thread.username || '') : (thread.other_username || thread.username || ''));
const threadAvatar = (thread: ChatThread, admin: boolean) => isTicket(thread) ? (admin ? thread.avatar_url || undefined : undefined) : (admin ? thread.other_avatar_url || thread.avatar_url || undefined : thread.other_avatar_url || thread.avatar_url || undefined);

function TicketModal({ onClose, onSubmit, busy }: { onClose: () => void; onSubmit: (subject: string, description: string) => void; busy: boolean }) {
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  return <div className="fixed inset-0 z-[100] flex items-center justify-center p-4"><div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose}/><div className="relative w-full max-w-md card overflow-hidden"><div className="px-5 py-4 border-b surface-border flex items-center justify-between"><div><h3 className="font-semibold text-fg">Hubungi Admin</h3><p className="text-[11px] text-fg-muted mt-0.5">Satu laporan aktif per akun.</p></div><button onClick={onClose} aria-label="Tutup" className="p-1.5 text-fg-muted hover:text-fg"><X size={18}/></button></div><div className="p-5 space-y-4"><div><label className="text-xs text-fg-muted block mb-1.5">Judul / Subjek Kendala *</label><input className="input w-full" value={subject} onChange={e=>setSubject(e.target.value)} maxLength={120} autoFocus placeholder="Contoh: Kendala pembayaran"/></div><div><label className="text-xs text-fg-muted block mb-1.5">Deskripsi Pesan *</label><textarea className="input w-full min-h-32 resize-none" value={description} onChange={e=>setDescription(e.target.value)} maxLength={4000} placeholder="Jelaskan kendala secara detail…"/></div><div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Batal</Button><Button disabled={!subject.trim()||!description.trim()||busy} onClick={()=>onSubmit(subject.trim(),description.trim())}>{busy?'Mengirim…':'Kirim Laporan'}</Button></div></div></div></div>;
}

function RatingModal({ onClose, onSubmit, busy }: { onClose: () => void; onSubmit: (rating: number) => void; busy: boolean }) {
  const [rating,setRating]=useState(0);
  return <div className="fixed inset-0 z-[110] flex items-center justify-center p-4"><div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose}/><div className="relative w-full max-w-sm card p-6 text-center"><div className="w-12 h-12 rounded-full bg-amber-500/10 flex items-center justify-center mx-auto mb-3"><Star size={22} className="text-amber-400"/></div><h3 className="font-semibold text-fg">Nilai Layanan Admin</h3><p className="text-xs text-fg-muted mt-1">Pilih rating 1–5.</p><div className="flex justify-center gap-2 my-5">{[1,2,3,4,5].map(n=><button key={n} onClick={()=>setRating(n)} aria-label={`${n} bintang`} className="p-1"><Star size={28} className={n<=rating?'text-amber-400 fill-amber-400':'text-slate-700'}/></button>)}</div><div className="flex gap-2"><Button variant="outline" fullWidth onClick={onClose}>Nanti</Button><Button fullWidth disabled={!rating||busy} onClick={()=>onSubmit(rating)}>{busy?'Menyimpan…':'Kirim Rating'}</Button></div></div></div>;
}

export function MessagesPage(){
  const {user,toast}=useApp();
  const isAdmin=user?.role==='admin';
  const [searchParams,setSearchParams]=useSearchParams();
  const [threads,setThreads]=useState<ChatThread[]>([]);
  const [selected,setSelected]=useState<ChatThread|null>(null);
  const [messages,setMessages]=useState<ChatMessage[]>([]);
  const [input,setInput]=useState('');
  const [loading,setLoading]=useState(true);
  const [sending,setSending]=useState(false);
  const [ticketBusy,setTicketBusy]=useState(false);
  const [ticketModal,setTicketModal]=useState(false);
  const [ratingBusy,setRatingBusy]=useState(false);
  const [ratingModal,setRatingModal]=useState(false);
  const [mobileList,setMobileList]=useState(true);
  const endRef=useRef<HTMLDivElement>(null);

  const refreshThreads=useCallback(async()=>{
    if(!user)return;
    try{const next=await loadMyThreads();setThreads(next);setSelected(current=>current?next.find(t=>t.id===current.id)||current:null);}
    catch(e:any){toast(e?.message||'Gagal memuat chat.','error');}
    finally{setLoading(false);}
  },[user?.id,toast]);

  useEffect(()=>{void refreshThreads();const timer=window.setInterval(()=>void refreshThreads(),10000);return()=>window.clearInterval(timer);},[refreshThreads]);

  useEffect(()=>{
    const target=searchParams.get('user_id'); if(!target||!user)return;
    let alive=true;
    (async()=>{
      try{const thread=await getOrCreateDmThread(target);if(!alive)return;setSelected(thread);setMobileList(false);await refreshThreads();}
      catch(e:any){if(alive)toast(e?.message||'Chat hanya dapat dimulai setelah hubungan mengikuti disetujui.','error');}
      finally{if(alive){const next=new URLSearchParams(searchParams);next.delete('user_id');setSearchParams(next,{replace:true});}}
    })();
    return()=>{alive=false;};
  },[searchParams,user?.id,refreshThreads,setSearchParams,toast]);

  useEffect(()=>{
    if(!selected){setMessages([]);return;}
    let alive=true;
    const refresh=async()=>{try{const data=await loadMessages(selected.id);if(alive)setMessages(data);await markThreadRead(selected.id);}catch(e:any){if(alive)toast(e?.message||'Gagal memuat pesan.','error');}};
    void refresh();
    const channel=supabase.channel(`syka-messages-${selected.id}`).on('postgres_changes',{event:'INSERT',schema:'public',table:'chat_messages',filter:`thread_id=eq.${selected.id}`},payload=>{const msg=payload.new as ChatMessage;setMessages(prev=>prev.some(m=>m.id===msg.id)?prev:[...prev,msg]);if(msg.sender_id!==user?.id)void markThreadRead(selected.id).catch(()=>{});void refreshThreads();}).on('postgres_changes',{event:'UPDATE',schema:'public',table:'chat_threads',filter:`id=eq.${selected.id}`},()=>void refreshThreads()).subscribe();
    return()=>{alive=false;void supabase.removeChannel(channel);};
  },[selected?.id,user?.id,refreshThreads,toast]);
  useEffect(()=>{endRef.current?.scrollIntoView({behavior:'smooth'});},[messages.length]);

  const openThreads=useMemo(()=>threads.filter(t=>t.status==='open'),[threads]);
  const closedThreads=useMemo(()=>threads.filter(t=>t.status==='closed'),[threads]);
  const activeTicket=!isAdmin?openThreads.find(isTicket)||null:null;

  const selectThread=async(thread:ChatThread)=>{setSelected(thread);setMobileList(false);try{await markThreadRead(thread.id);}catch{}};
  const send=async()=>{const body=input.trim();if(!selected||selected.status!=='open'||!body||sending)return;setSending(true);try{const message=await sendMessage(selected.id,body);setMessages(prev=>prev.some(m=>m.id===message.id)?prev:[...prev,message]);setInput('');await refreshThreads();}catch(e:any){toast(e?.message||'Gagal mengirim pesan.','error');}finally{setSending(false);}};
  const createTicket=async(subject:string,description:string)=>{setTicketBusy(true);try{const thread=await createTicketThread(subject,description);setTicketModal(false);setSelected(thread);setMobileList(false);await refreshThreads();toast('Laporan berhasil dikirim ke Admin.','success');}catch(e:any){toast(e?.message||'Gagal membuat laporan.','error');}finally{setTicketBusy(false);}};
  const finishTicket=async()=>{if(!selected||!isAdmin||!isTicket(selected)||selected.status!=='open')return;setTicketBusy(true);try{const closed=await closeThread(selected.id);setSelected(closed);await refreshThreads();toast('Ticket ditandai selesai. User dapat memberi rating.','success');}catch(e:any){toast(e?.message||'Gagal menyelesaikan ticket.','error');}finally{setTicketBusy(false);}};
  const submitRating=async(rating:number)=>{if(!selected||isAdmin||!isTicket(selected)||selected.status!=='closed')return;setRatingBusy(true);try{const updated=await closeThread(selected.id,rating);setSelected(updated);setRatingModal(false);await refreshThreads();toast('Terima kasih atas ratingnya.','success');}catch(e:any){toast(e?.message||'Gagal menyimpan rating.','error');}finally{setRatingBusy(false);}};

  return <div className="min-h-screen surface-bg p-3 md:p-6 text-fg-secondary"><div className="max-w-7xl mx-auto">
    <div className="flex items-center justify-between mb-4"><Link to="/home" className="inline-flex items-center gap-2 text-xs text-fg-muted hover:text-fg"><ArrowLeft size={14}/>Kembali</Link>{!isAdmin&&<Button size="sm" icon={<Headphones size={14}/>} onClick={()=>{if(activeTicket){toast('Anda masih memiliki laporan yang sedang berjalan. Tunggu hingga laporan diselesaikan oleh Admin.','info');return;}setTicketModal(true);}}>Hubungi Admin</Button>}</div>
    <div className="flex items-center gap-2 mb-5"><MessageCircle size={21} className="text-accent"/><h1 className="text-xl md:text-2xl font-bold text-fg">Pesan</h1><Badge color="moss">{openThreads.length} aktif</Badge></div>
    <div className="grid md:grid-cols-[320px_1fr] min-h-[calc(100vh-180px)] rounded-2xl border surface-border overflow-hidden surface-card-bg">
      <aside className={`${mobileList?'flex':'hidden'} md:flex flex-col border-r surface-border`}><div className="p-3 border-b surface-border"><p className="text-xs font-semibold text-fg">Percakapan</p><p className="text-[10px] text-fg-muted mt-0.5">DM antar pengguna & helpdesk Admin</p></div><div className="flex-1 overflow-y-auto p-2">
        <p className="px-2 py-2 text-[10px] uppercase tracking-wider text-fg-muted">Aktif · {openThreads.length}</p>{loading?<p className="py-8 text-center text-xs text-fg-muted">Memuat…</p>:openThreads.length===0?<p className="py-8 text-center text-xs text-fg-muted">Belum ada percakapan aktif.</p>:openThreads.map(thread=><button key={thread.id} onClick={()=>void selectThread(thread)} className={`w-full text-left p-3 rounded-xl mb-1 border transition ${selected?.id===thread.id?'border-moss-500/50 bg-moss-500/10':'border-transparent hover:bg-white/5'}`}><div className="flex items-center gap-3"><Avatar name={threadTitle(thread,!!isAdmin)} id={isAdmin?thread.user_id:'admin-sykabelajar'} size={36} src={threadAvatar(thread,!!isAdmin)}/><div className="min-w-0 flex-1"><div className="flex items-center gap-1.5"><p className="text-sm font-medium text-fg truncate">{threadTitle(thread,!!isAdmin)}</p>{isTicket(thread)&&<span className="text-[8px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400">TICKET</span>}</div><p className="text-[10px] text-fg-muted truncate">{isTicket(thread)?thread.subject||'Bantuan':`@${threadUsername(thread,!!isAdmin)}`}</p></div>{(thread.unread_count??0)>0&&<span className="min-w-5 h-5 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">{(thread.unread_count??0)>99?'99+':thread.unread_count}</span>}</div></button>)}
        <p className="px-2 pt-4 pb-2 text-[10px] uppercase tracking-wider text-fg-muted">Selesai · {closedThreads.length}</p>{closedThreads.slice(0,30).map(thread=><button key={thread.id} onClick={()=>void selectThread(thread)} className={`w-full text-left p-3 rounded-xl mb-1 border transition opacity-80 ${selected?.id===thread.id?'border-moss-500/30 bg-moss-500/5':'border-transparent hover:bg-white/5'}`}><div className="flex items-center gap-3"><Avatar name={threadTitle(thread,!!isAdmin)} id={isAdmin?thread.user_id:'admin-sykabelajar'} size={32} src={threadAvatar(thread,!!isAdmin)}/><div className="flex-1 min-w-0"><p className="text-xs text-fg truncate">{threadTitle(thread,!!isAdmin)}</p>{isTicket(thread)&&<p className="text-[9px] text-fg-muted truncate">{thread.subject||'Ticket'}</p>}<div className="flex gap-0.5 mt-1">{thread.rating?[1,2,3,4,5].map(n=><Star key={n} size={9} className={n<=thread.rating!?'text-amber-400 fill-amber-400':'text-slate-700'}/>):<span className="text-[9px] text-fg-muted">Belum dinilai</span>}</div></div><Badge color="default">Selesai</Badge></div></button>)}
      </div></aside>
      <section className={`${mobileList?'hidden':'flex'} md:flex flex-col min-w-0`}>{!selected?<div className="flex-1 flex items-center justify-center text-center p-8"><div><MessageCircle size={40} className="text-slate-700 mx-auto mb-3"/><p className="text-sm text-fg-muted">Pilih percakapan untuk mulai membaca.</p><p className="text-[11px] text-fg-muted mt-1">Chat antar pengguna dimulai dari halaman profil.</p></div></div>:<>
        <div className="px-4 py-3 border-b surface-border flex items-center gap-3"><button className="md:hidden p-1 text-fg-muted" onClick={()=>setMobileList(true)} aria-label="Kembali"><ArrowLeft size={17}/></button><Avatar name={threadTitle(selected,!!isAdmin)} id={isAdmin?selected.user_id:'admin-sykabelajar'} size={40} src={threadAvatar(selected,!!isAdmin)}/><div className="min-w-0 flex-1"><p className="text-sm font-semibold text-fg truncate">{threadTitle(selected,!!isAdmin)}</p><p className="text-[10px] text-fg-muted truncate">{isTicket(selected)?`Ticket · ${selected.subject||'Bantuan'}`:`@${threadUsername(selected,!!isAdmin)}`}</p></div>{isAdmin&&isTicket(selected)&&selected.status==='open'&&<Button size="sm" variant="outline" icon={<CheckCircle2 size={14}/>} onClick={()=>void finishTicket()} disabled={ticketBusy}>{ticketBusy?'Memproses…':'Tandai Selesai'}</Button>}</div>
        <div className="px-4 py-2 bg-amber-500/10 border-b border-amber-500/20 flex items-start gap-2"><ShieldAlert size={14} className="text-amber-400 shrink-0 mt-0.5"/><p className="text-[10px] leading-relaxed text-amber-300">{SECURITY}</p></div>
        {isTicket(selected)&&<div className="px-4 py-2.5 border-b surface-border"><p className="text-[9px] uppercase tracking-wider text-fg-muted">Ringkasan Laporan</p><p className="text-sm font-medium text-fg mt-0.5">{selected.subject||'Bantuan'}</p>{selected.description&&<p className="text-xs text-fg-muted mt-1 line-clamp-3">{selected.description}</p>}</div>}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">{messages.map(message=>{const mine=message.sender_id===user?.id;return <div key={message.id} className={`flex ${mine?'justify-end':'justify-start'}`}><div className={`max-w-[80%] px-3.5 py-2.5 rounded-2xl ${mine?'bg-moss-600 text-white rounded-br-sm':'surface-elevated border surface-border text-fg-secondary rounded-bl-sm'}`}><p className="text-sm whitespace-pre-wrap break-words">{message.body}</p><p className={`text-[9px] mt-1 ${mine?'text-moss-200':'text-fg-muted'}`}>{new Date(message.created_at).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'})}</p></div></div>})}{!messages.length&&<div className="text-center py-12 text-xs text-fg-muted">Belum ada pesan.</div>}<div ref={endRef}/></div>
        {selected.status==='open'?<div className="p-3 border-t surface-border"><div className="flex gap-2"><input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();void send();}}} className="flex-1 input" placeholder="Ketik pesan…"/><button onClick={()=>void send()} disabled={!input.trim()||sending} className="w-10 h-10 shrink-0 rounded-xl bg-moss-500 hover:bg-moss-600 text-white flex items-center justify-center disabled:opacity-40"><Send size={17}/></button></div></div>:<div className="p-4 border-t surface-border text-center"><p className="text-xs text-fg-muted">Percakapan ini telah selesai.</p>{!isAdmin&&isTicket(selected)&&!selected.rating&&<Button size="sm" variant="outline" className="mt-2" icon={<Star size={14}/>} onClick={()=>setRatingModal(true)}>Beri Rating</Button>}{selected.rating&&<div className="flex justify-center gap-1 mt-2">{[1,2,3,4,5].map(n=><Star key={n} size={13} className={n<=selected.rating!?'text-amber-400 fill-amber-400':'text-slate-700'}/>)}</div>}</div>}
      </>}</section>
    </div>
  </div>{ticketModal&&<TicketModal onClose={()=>setTicketModal(false)} onSubmit={(s,d)=>void createTicket(s,d)} busy={ticketBusy}/>} {ratingModal&&<RatingModal onClose={()=>setRatingModal(false)} onSubmit={r=>void submitRating(r)} busy={ratingBusy}/>}</div>;
}
