import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, Headphones, MessageCircle, Send, ShieldAlert, Star, X, UserRound } from 'lucide-react';
import { useApp } from '@/store/AppContext';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import {
  closeThread, createTicketThread, getOrCreateDmThread, loadMessages, loadMyThreads,
  markThreadRead, sendMessage, type ChatMessage, type ChatThread,
} from '@/services/chat.service';
import { supabase } from '@/lib/supabase';

const SECURITY = '🔒 Himbauan Keamanan: Jangan membagikan data pribadi sensitif (password, nomor HP, atau data finansial). Waspadai penipuan mengatasnamakan platform.';

function isTicket(t: ChatThread) { return t.thread_type === 'ticket'; }
function title(t: ChatThread, admin: boolean) {
  if (isTicket(t)) return admin ? (t.user_name || t.username || 'Pengguna') : 'Admin Sykabelajar';
  return admin ? (t.other_user_name || t.user_name || 'Pengguna') : (t.other_user_name || t.other_username || 'Pengguna');
}
function username(t: ChatThread, admin: boolean) {
  if (isTicket(t)) return admin ? (t.username || '') : 'sykabelajar';
  return admin ? (t.other_username || t.username || '') : (t.other_username || t.username || '');
}
function avatar(t: ChatThread, admin: boolean) {
  if (isTicket(t)) return admin ? (t.avatar_url || undefined) : undefined;
  return admin ? (t.other_avatar_url || t.avatar_url || undefined) : (t.other_avatar_url || t.avatar_url || undefined);
}

function TicketModal({ onClose, onSubmit, busy }: { onClose: () => void; onSubmit: (s: string, d: string) => void; busy: boolean }) {
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const valid = subject.trim().length > 0 && description.trim().length > 0;
  return <div className="fixed inset-0 z-[100] flex items-center justify-center p-4"><div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose}/><div className="relative w-full max-w-md card overflow-hidden"><div className="px-5 py-4 border-b surface-border flex items-center justify-between"><div><p className="font-semibold text-fg">Hubungi Admin</p><p className="text-[11px] text-fg-muted">Buat satu laporan dan lanjutkan percakapan bersama Admin.</p></div><button onClick={onClose} className="p-1.5 text-fg-muted hover:text-fg" aria-label="Tutup"><X size={18}/></button></div><div className="p-5 space-y-4"><div><label className="text-xs text-fg-muted block mb-1.5">Judul / Subjek Kendala *</label><input className="input w-full" maxLength={120} autoFocus value={subject} onChange={e=>setSubject(e.target.value)} placeholder="Contoh: Kendala pembayaran"/></div><div><label className="text-xs text-fg-muted block mb-1.5">Deskripsi Pesan *</label><textarea className="input w-full min-h-32 resize-none" maxLength={4000} value={description} onChange={e=>setDescription(e.target.value)} placeholder="Jelaskan kendala secara detail…"/></div><div className="rounded-xl bg-amber-500/10 border border-amber-500/20 px-3 py-2.5"><p className="text-[10px] text-amber-300">Satu akun hanya dapat mempunyai satu laporan aktif pada satu waktu.</p></div><div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Batal</Button><Button disabled={!valid || busy} onClick={()=>onSubmit(subject.trim(),description.trim())}>{busy?'Mengirim…':'Kirim Laporan'}</Button></div></div></div></div>;
}

function RatingModal({ onClose, onSubmit, busy }: { onClose: () => void; onSubmit: (r:number)=>void; busy:boolean }) {
  const [rating, setRating] = useState(0);
  return <div className="fixed inset-0 z-[110] flex items-center justify-center p-4"><div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose}/><div className="relative w-full max-w-sm card p-6 text-center"><div className="w-12 h-12 rounded-full bg-amber-500/10 flex items-center justify-center mx-auto mb-3"><Star size={22} className="text-amber-400"/></div><h3 className="font-display font-semibold text-fg">Nilai Layanan Admin</h3><p className="text-xs text-fg-muted mt-1">Bagaimana pengalaman bantuan kamu?</p><div className="flex justify-center gap-2 my-5">{[1,2,3,4,5].map(n=><button key={n} onClick={()=>setRating(n)} aria-label={`${n} bintang`} className="p-1"><Star size={30} className={n<=rating?'text-amber-400 fill-amber-400':'text-slate-700'}/></button>)}</div><div className="flex gap-2"><Button variant="outline" fullWidth onClick={onClose}>Nanti</Button><Button fullWidth disabled={!rating||busy} onClick={()=>onSubmit(rating)}>{busy?'Menyimpan…':'Kirim Rating'}</Button></div></div></div>;
}

export function MessagesPage() {
  const { user, toast } = useApp();
  const isAdmin = user?.role === 'admin';
  const [params, setParams] = useSearchParams();
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [selected, setSelected] = useState<ChatThread|null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [ticketModal, setTicketModal] = useState(false);
  const [ticketBusy, setTicketBusy] = useState(false);
  const [ratingModal, setRatingModal] = useState(false);
  const [ratingBusy, setRatingBusy] = useState(false);
  const [mobileList, setMobileList] = useState(true);
  const endRef = useRef<HTMLDivElement>(null);

  const refreshThreads = useCallback(async () => {
    if (!user) return;
    try {
      const data = await loadMyThreads();
      setThreads(data);
      setSelected(prev => prev ? (data.find(x=>x.id===prev.id) || prev) : null);
    } catch (e:any) { toast(e?.message ?? 'Gagal memuat percakapan.', 'error'); }
    finally { setLoading(false); }
  }, [user?.id, toast]);

  useEffect(()=>{ void refreshThreads(); const timer=window.setInterval(()=>void refreshThreads(),10000); return ()=>window.clearInterval(timer); },[refreshThreads]);

  useEffect(()=>{
    const target = params.get('user_id');
    if(!target || !user) return;
    let alive=true;
    (async()=>{
      try{
        const thread=await getOrCreateDmThread(target);
        if(!alive)return;
        setSelected(thread); setMobileList(false); await refreshThreads();
      }catch(e:any){ if(alive) toast(e?.message ?? 'Anda belum dapat mengirim pesan ke pengguna ini.', 'error'); }
      finally{ if(alive){ const next=new URLSearchParams(params); next.delete('user_id'); setParams(next,{replace:true}); } }
    })();
    return()=>{alive=false;};
  },[params,user?.id,refreshThreads,setParams,toast]);

  useEffect(()=>{
    if(!selected){setMessages([]);return;}
    let alive=true;
    const refresh=async()=>{
      try{ const data=await loadMessages(selected.id); if(alive)setMessages(data); await markThreadRead(selected.id); }catch(e:any){if(alive)toast(e?.message??'Pesan gagal dimuat.','error');}
    };
    void refresh();
    const channel=supabase.channel(`messages-${selected.id}`).on('postgres_changes',{event:'INSERT',schema:'public',table:'chat_messages',filter:`thread_id=eq.${selected.id}`},payload=>{
      const msg=payload.new as ChatMessage; setMessages(prev=>prev.some(x=>x.id===msg.id)?prev:[...prev,msg]); if(msg.sender_id!==user?.id) void markThreadRead(selected.id).catch(()=>{}); void refreshThreads();
    }).on('postgres_changes',{event:'UPDATE',schema:'public',table:'chat_threads',filter:`id=eq.${selected.id}`},()=>void refreshThreads()).subscribe();
    return()=>{alive=false;void supabase.removeChannel(channel);};
  },[selected?.id,user?.id,refreshThreads,toast]);

  useEffect(()=>{endRef.current?.scrollIntoView({behavior:'smooth'});},[messages.length]);

  const openThreads=useMemo(()=>threads.filter(t=>t.status==='open'),[threads]);
  const closedThreads=useMemo(()=>threads.filter(t=>t.status==='closed'),[threads]);
  const activeTicket=!isAdmin?openThreads.find(t=>isTicket(t)):null;

  const selectThread=async(t:ChatThread)=>{setSelected(t);setMobileList(false);try{await markThreadRead(t.id);}catch{}};
  const send=async()=>{const body=input.trim();if(!body||!selected||selected.status!=='open'||sending)return;setSending(true);try{const msg=await sendMessage(selected.id,body);setMessages(prev=>prev.some(x=>x.id===msg.id)?prev:[...prev,msg]);setInput('');await markThreadRead(selected.id);await refreshThreads();}catch(e:any){toast(e?.message??'Gagal mengirim pesan.','error');}finally{setSending(false);}};
  const createTicket=async(s:string,d:string)=>{setTicketBusy(true);try{const t=await createTicketThread(s,d);setTicketModal(false);setSelected(t);setMobileList(false);await refreshThreads();toast('Laporan berhasil dikirim ke Admin.','success');}catch(e:any){toast(e?.message??'Gagal membuat laporan.','error');}finally{setTicketBusy(false);}};
  const adminFinish=async()=>{if(!selected||!isAdmin||!isTicket(selected)||selected.status!=='open')return;setTicketBusy(true);try{const t=await closeThread(selected.id);setSelected(t);await refreshThreads();toast('Ticket ditandai selesai. User dapat memberi rating.','success');}catch(e:any){toast(e?.message??'Gagal menyelesaikan ticket.','error');}finally{setTicketBusy(false);}};
  const submitRating=async(r:number)=>{if(!selected||isAdmin||!isTicket(selected)||selected.status!=='closed')return;setRatingBusy(true);try{const t=await closeThread(selected.id,r);setSelected(t);setRatingModal(false);await refreshThreads();toast('Terima kasih atas ratingnya.','success');}catch(e:any){toast(e?.message??'Gagal menyimpan rating.','error');}finally{setRatingBusy(false);}};

  return <div className="min-h-screen surface-bg p-3 md:p-6 text-fg-secondary"><div className="max-w-7xl mx-auto"><div className="flex items-center justify-between mb-4"><Link to="/home" className="inline-flex items-center gap-2 text-xs text-fg-muted hover:text-fg"><ArrowLeft size={14}/>Kembali</Link>{!isAdmin&&<Button size="sm" icon={<Headphones size={14}/>} onClick={()=>{if(activeTicket){toast('Anda masih memiliki laporan yang sedang berjalan. Tunggu hingga laporan diselesaikan oleh Admin.','info');return;}setTicketModal(true);}}>Hubungi Admin</Button>}</div><div className="mb-5 flex items-center gap-2"><MessageCircle size={21} className="text-accent"/><h1 className="text-xl md:text-2xl font-bold text-fg">Pesan</h1><Badge color="moss">{openThreads.length} aktif</Badge></div>
    <div className="grid md:grid-cols-[310px_1fr] min-h-[calc(100vh-180px)] rounded-2xl border surface-border overflow-hidden surface-card-bg shadow-xl"><aside className={`${mobileList?'flex':'hidden'} md:flex flex-col border-r surface-border`}><div className="p-3 border-b surface-border"><p className="text-xs font-semibold text-fg">Percakapan</p><p className="text-[10px] text-fg-muted mt-0.5">DM dan bantuan Admin</p></div><div className="flex-1 overflow-y-auto p-2">{loading?<div className="py-12 text-center text-xs text-fg-muted">Memuat…</div>:<><p className="text-[10px] uppercase tracking-wider text-fg-muted px-2 py-2">Aktif · {openThreads.length}</p>{openThreads.length===0&&<p className="text-xs text-fg-muted text-center py-8">Belum ada percakapan aktif.</p>}{openThreads.map(t=>{const n=title(t,!!isAdmin);return <button key={t.id} onClick={()=>void selectThread(t)} className={`w-full text-left p-3 rounded-xl mb-1 transition border ${selected?.id===t.id?'border-moss-500/50 bg-moss-500/10':'border-transparent hover:bg-white/5'}`}><div className="flex items-center gap-3"><Avatar name={n} id={isAdmin?t.user_id:'admin-sykabelajar'} size={36} src={avatar(t,!!isAdmin)}/><div className="min-w-0 flex-1"><div className="flex items-center gap-1.5"><p className="text-sm font-medium text-fg truncate">{n}</p>{isTicket(t)&&<span className="text-[8px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400">TICKET</span>}</div><p className="text-[10px] text-fg-muted truncate">{isTicket(t)?(t.subject||'Bantuan'):`@${username(t,!!isAdmin)}`}</p></div>{(t.unread_count??0)>0&&<span className="min-w-5 h-5 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">{(t.unread_count??0)>99?'99+':t.unread_count}</span>}</div></button>})}<p className="text-[10px] uppercase tracking-wider text-fg-muted px-2 pt-4 pb-2">Selesai · {closedThreads.length}</p>{closedThreads.slice(0,30).map(t=>{const n=title(t,!!isAdmin);return <button key={t.id} onClick={()=>void selectThread(t)} className={`w-full text-left p-3 rounded-xl mb-1 transition border opacity-80 ${selected?.id===t.id?'border-moss-500/30 bg-moss-500/5':'border-transparent hover:bg-white/5'}`}><div className="flex items-center gap-3"><Avatar name={n} id={isAdmin?t.user_id:'admin-sykabelajar'} size={32} src={avatar(t,!!isAdmin)}/><div className="min-w-0 flex-1"><p className="text-xs text-fg truncate">{n}</p>{isTicket(t)&&<p className="text-[9px] text-fg-muted truncate">{t.subject||'Ticket'}</p>}<div className="flex gap-0.5 mt-1">{t.rating?[1,2,3,4,5].map(n2=><Star key={n2} size={9} className={n2<=t.rating!?'text-amber-400 fill-amber-400':'text-slate-700'}/>):<span className="text-[9px] text-fg-muted">Belum dinilai</span>}</div></div><Badge color="default">Selesai</Badge></div></button>})}</>}</div></aside>
    <section className={`${mobileList?'hidden':'flex'} md:flex flex-col min-w-0`}>{!selected?<div className="flex-1 flex items-center justify-center text-center p-8"><div><div className="w-14 h-14 rounded-2xl surface-elevated flex items-center justify-center mx-auto mb-4"><MessageCircle size={28} className="text-fg-muted"/></div><p className="text-sm text-fg-muted">Pilih percakapan untuk mulai membaca.</p><p className="text-[11px] text-fg-muted mt-1">Untuk chat antar pengguna, mulai dari halaman profil.</p></div></div>:<><div className="px-4 py-3 border-b surface-border flex items-center gap-3"><button className="md:hidden p-1 text-fg-muted" onClick={()=>setMobileList(true)} aria-label="Kembali ke daftar"><ArrowLeft size={17}/></button><Avatar name={title(selected,!!isAdmin)} id={isAdmin?selected.user_id:'admin-sykabelajar'} size={40} src={avatar(selected,!!isAdmin)}/><div className="min-w-0 flex-1"><p className="text-sm font-semibold text-fg truncate">{title(selected,!!isAdmin)}</p><p className="text-[10px] text-fg-muted truncate">{isTicket(selected)?`Ticket · ${selected.subject||'Bantuan'}`:`@${username(selected,!!isAdmin)}`}</p></div>{isAdmin&&isTicket(selected)&&selected.status==='open'&&<Button size="sm" variant="outline" icon={<CheckCircle2 size={14}/>} disabled={ticketBusy} onClick={()=>void adminFinish()}>{ticketBusy?'Memproses…':'Tandai Selesai'}</Button>}</div><div className="px-4 py-2 bg-amber-500/10 border-b border-amber-500/20 flex items-start gap-2"><ShieldAlert size={14} className="text-amber-400 shrink-0 mt-0.5"/><p className="text-[10px] leading-relaxed text-amber-300">{SECURITY}</p></div>{isTicket(selected)&&<div className="px-4 py-2.5 border-b surface-border"><p className="text-[9px] uppercase tracking-wider text-fg-muted">Ringkasan Laporan</p><p className="text-sm font-medium text-fg mt-0.5">{selected.subject||'Bantuan'}</p>{selected.description&&<p className="text-xs text-fg-muted mt-1 line-clamp-3">{selected.description}</p>}</div>}<div className="flex-1 overflow-y-auto p-4 space-y-3">{messages.map(m=>{const me=m.sender_id===user?.id;return <div key={m.id} className={`flex ${me?'justify-end':'justify-start'}`}><div className={`max-w-[80%] px-3.5 py-2.5 rounded-2xl ${me?'bg-moss-600 text-white rounded-br-sm':'surface-elevated border surface-border text-fg-secondary rounded-bl-sm'}`}><p className="text-sm whitespace-pre-wrap break-words">{m.body}</p><p className={`text-[9px] mt-1 ${me?'text-moss-200':'text-fg-muted'}`}>{new Date(m.created_at).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'})}</p></div></div>)}{messages.length===0&&<div className="text-center py-12 text-xs text-fg-muted">Belum ada pesan.</div>}<div ref={endRef}/></div>{selected.status==='open'?<div className="p-3 border-t surface-border"><div className="flex gap-2"><input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();void send();}}} className="flex-1 input" placeholder="Ketik pesan…"/><button onClick={()=>void send()} disabled={!input.trim()||sending} className="w-10 h-10 rounded-xl bg-moss-500 hover:bg-moss-600 disabled:opacity-40 text-white flex items-center justify-center"><Send size={17}/></button></div></div>:<div className="p-4 border-t surface-border text-center"><p className="text-xs text-fg-muted">Percakapan ini telah selesai.</p>{!isAdmin&&isTicket(selected)&&!selected.rating&&<Button size="sm" variant="outline" className="mt-2" icon={<Star size={14}/>} onClick={()=>{setRating(0);setRatingModal(true);}}>Beri Rating</Button>}{selected.rating&&<div className="flex justify-center gap-1 mt-2">{[1,2,3,4,5].map(n=><Star key={n} size={13} className={n<=selected.rating!?'text-amber-400 fill-amber-400':'text-slate-700'}/>)}</div>}</div>}</>}</section></div></div>{ticketModal&&<TicketModal onClose={()=>setTicketModal(false)} onSubmit={(s,d)=>void createTicket(s,d)} busy={ticketBusy}/>} {ratingModal&&<RatingModal onClose={()=>setRatingModal(false)} onSubmit={(r)=>void submitRating(r)} busy={ratingBusy}/>}</div>;
}
