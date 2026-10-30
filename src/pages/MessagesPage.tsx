import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type ReactNode } from 'react';
import { ArrowLeft, CheckCheck, ChevronDown, ChevronUp, FileText, Headphones, Link2, Lock, MessageCircle, Mic, MoreVertical, Paperclip, Pin, PinOff, Plus, Search, Send, Settings2, Shield, Star, Trash2, Unlock, UserMinus, UserPlus, Users, X } from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useApp } from '@/store/AppContext';
import { useLanguage } from '@/lib/LanguageContext';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { supabase } from '@/lib/supabase';
import { subscribeSykaEvents } from '@/lib/realtimeBus';
import { blockChatUser, claimChatTicket, closeThread, createTicketThread, getChatSpamStatus, getOrCreateDmThread, hideChatThread, loadChatMessagesPage, loadMyThreads, markThreadRead, sendMessage, unblockChatUser, type ChatMessage, type ChatSpamStatus, type ChatThread, listChatGroups, createChatGroup, loadChatGroupMessages, sendChatGroupMessage, listChatGroupMembers, addChatGroupMember, removeChatGroupMember, renameChatGroup, markChatGroupRead, createChatGroupInvite, joinChatGroup, type ChatGroup, type ChatGroupMessage, type ChatGroupMember, searchUsersForChat } from '@/services/chat.service';
import { listCollectiveCompetitions } from '@/services/collectiveParticipant.service';
import { attachChatMedia, isAudioUrl, isDocumentUrl, isHttpUrl, isImageUrl, uploadChatAttachment, validateChatFile } from '@/services/chatMedia.service';
import { mergeChatMessageCache, readChatMessageCache, readOlderChatMessageCache } from '@/services/chatMessageCache';

const PAGE = 50;
const INITIAL_MESSAGE_PAGE = 20;
const MESSAGE_CACHE_REVALIDATE_MS = 60_000;
const KEY = 'syka.chat.stable.';
const isTicket = (t: ChatThread) => t.thread_type === 'ticket';
const isCachedMessage = (value: unknown): value is ChatMessage => { if (!value || typeof value !== 'object') return false; const item = value as Partial<ChatMessage>; return typeof item.id === 'string' && item.id.length > 0 && typeof item.thread_id === 'string' && item.thread_id.length > 0 && typeof item.sender_id === 'string' && item.sender_id.length > 0 && typeof item.body === 'string' && typeof item.created_at === 'string' && item.created_at.length > 0; };
const cacheGet = (id: string): ChatMessage[] => { try { const value = JSON.parse(localStorage.getItem(KEY + id) || '[]'); return Array.isArray(value) ? value.filter(isCachedMessage) : []; } catch { return []; } };
const mergeMessageRows = (current: ChatMessage[], incoming: ChatMessage[]) => {
  const byId = new Map<string, ChatMessage>();
  for (const message of current.filter(isCachedMessage)) byId.set(message.id, message);
  for (const message of incoming.filter(isCachedMessage)) byId.set(message.id, message);
  return [...byId.values()].sort((a, b) => a.created_at.localeCompare(b.created_at));
};
const nameOf = (t: ChatThread, me: string, admin: boolean) => isTicket(t) ? (admin ? t.user_name || t.username || 'User' : 'Admin Sykabelajar') : (t.user_id === me ? t.other_user_name || t.other_username || 'User' : t.user_name || t.username || 'User');
function dedupeInboxThreads(items: ChatThread[]): ChatThread[] {
  const byId = new Map<string, ChatThread>();
  for (const item of items) {
    if (item?.id && !byId.has(item.id)) byId.set(item.id, item);
  }
  const uniqueRows = [...byId.values()];
  const latestOpenDmByPair = new Map<string, ChatThread>();
  const timestamp = (thread: ChatThread) => {
    const value = new Date(thread.last_message_at || thread.created_at).getTime();
    return Number.isFinite(value) ? value : 0;
  };

  // Keep closed conversation records intact. Only collapse duplicate active DMs
  // in the UI; the database already has a unique index for an open DM pair.
  for (const thread of uniqueRows) {
    if (thread.thread_type !== 'dm' || thread.status !== 'open' || !thread.participant_id || thread.user_id === thread.participant_id) continue;
    const key = [thread.user_id, thread.participant_id].sort().join(':');
    const existing = latestOpenDmByPair.get(key);
    if (!existing || timestamp(thread) > timestamp(existing)) latestOpenDmByPair.set(key, thread);
  }

  return uniqueRows.filter((thread) => {
    if (thread.thread_type !== 'dm' || thread.status !== 'open' || !thread.participant_id || thread.user_id === thread.participant_id) return true;
    const key = [thread.user_id, thread.participant_id].sort().join(':');
    return latestOpenDmByPair.get(key)?.id === thread.id;
  });
}
const usernameOf = (t: ChatThread, me: string, admin: boolean) => isTicket(t) ? (admin ? t.username || 'user' : 'sykabelajar') : (t.user_id === me ? t.other_username || 'user' : t.username || 'user');
const avatarOf = (t: ChatThread, me: string) => t.user_id === me ? t.other_avatar_url : t.avatar_url;
const formatChatTime = (value: string) => { const d = new Date(value); return Number.isNaN(d.getTime()) ? '' : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const formatListTime = (value?: string | null) => { if (!value) return ''; const d = new Date(value); if (Number.isNaN(d.getTime())) return ''; const now = new Date(); const today = d.toDateString() === now.toDateString(); const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1); if (today) return formatChatTime(value); if (d.toDateString() === yesterday.toDateString()) return 'Kemarin'; return d.getFullYear() === now.getFullYear() ? `${d.getDate()} ${d.toLocaleDateString('id-ID', { month: 'short' })}` : d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: '2-digit' }); };
const formatCooldown = (ms: number) => { const total = Math.max(0, Math.ceil(ms / 1000)); const h = Math.floor(total / 3600); const m = Math.floor((total % 3600) / 60); const s = total % 60; return h > 0 ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`; };
function Body({ body, preview }: { body: string; preview: (url: string) => void }) {
  try {
    const url = new URL(body.trim());
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      if (isImageUrl(url.toString())) return <button type="button" onClick={() => preview(url.toString())} className="block overflow-hidden rounded-xl text-left"><img src={url.toString()} alt="Lampiran gambar" loading="lazy" className="max-h-[320px] max-w-[min(320px,70vw)] rounded-xl object-contain" /></button>;
      if (isAudioUrl(url.toString())) return <div className="min-w-[220px] max-w-[min(340px,70vw)] rounded-xl border border-white/10 bg-black/10 p-2.5"><div className="mb-1.5 flex items-center gap-2 text-xs font-semibold"><Mic size={14}/><span>Pesan suara</span></div><audio controls preload="metadata" className="w-full" src={url.toString()}>Browser tidak mendukung pemutar audio.</audio></div>;
      if (isDocumentUrl(url.toString())) return <a href={url.toString()} target="_blank" rel="noopener noreferrer" className="flex max-w-[min(300px,70vw)] items-center gap-3 rounded-xl border border-white/10 bg-black/10 p-3 no-underline hover:bg-black/15"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-500/15 text-blue-400"><FileText size={19}/></span><span className="min-w-0"><span className="block text-sm font-semibold">Dokumen PDF</span><span className="block text-[10px] opacity-70">Buka lampiran</span></span></a>;
      if (isHttpUrl(url.toString())) return <a href={url.toString()} target="_blank" rel="noopener noreferrer" className="break-all underline underline-offset-2">{url.toString()}</a>;
    }
  } catch { /* plain message body */ }
  return <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{body}</p>;
}
function Modal({ children, onClose }: { children: ReactNode; onClose: () => void }) { return <div className="fixed inset-0 z-[170] flex items-center justify-center p-4"><button className="absolute inset-0 bg-black/70" onClick={onClose} /><div className="relative w-full max-w-md card p-5">{children}</div></div>; }
function TicketForm({ busy, onClose, onSubmit }: { busy: boolean; onClose: () => void; onSubmit: (subject: string, description: string) => void }) { const [subject,setSubject]=useState(''); const [description,setDescription]=useState(''); return <Modal onClose={onClose}><div className="flex justify-between"><h3 className="font-semibold text-fg">Hubungi Admin</h3><button onClick={onClose}><X size={18}/></button></div><input className="input w-full mt-4" value={subject} onChange={e=>setSubject(e.target.value)} placeholder="Subjek kendala *"/><textarea className="input w-full mt-3 min-h-32" value={description} onChange={e=>setDescription(e.target.value)} placeholder="Deskripsi kendala *"/><div className="flex justify-end gap-2 mt-4"><Button variant="ghost" onClick={onClose}>Batal</Button><Button disabled={busy||!subject.trim()||!description.trim()} onClick={()=>onSubmit(subject.trim(),description.trim())}>{busy?'Mengirim…':'Kirim Laporan'}</Button></div></Modal>; }
function RatingForm({ value,busy,onRate,onDelete,onClose }: { value:number;busy:boolean;onRate:(value:number)=>void;onDelete:()=>void;onClose:()=>void }) { const rated=value>0; return <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/45 backdrop-blur-[2px] p-4"><div className="relative w-full max-w-sm card p-6 shadow-2xl border border-white/10">{!rated&&<button className="absolute right-3 top-3 rounded-lg p-2 text-fg-muted hover:bg-white/5" onClick={onClose} aria-label="Tutup"><X size={18}/></button>}<div className="text-center"><div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-amber-500/10"><Star size={21} className="text-amber-400"/></div><h3 className="font-semibold text-fg">Nilai Layanan Admin</h3><p className="mt-1 text-xs text-fg-muted">Bagaimana pengalaman kamu dengan bantuan admin?</p></div><div className="flex justify-center gap-2 my-6">{[1,2,3,4,5].map(n=><button key={n} disabled={busy||rated} onClick={()=>onRate(n)} aria-label={`${n} bintang`} className="rounded-lg p-1.5 transition-transform hover:scale-110 disabled:cursor-default"><Star size={34} className={n<=value?'text-amber-400 fill-amber-400':'text-slate-600'}/></button>)}</div>{!rated?<div className="text-center text-[11px] text-fg-muted">Pilih jumlah bintang untuk melanjutkan.</div>:<><p className="mb-3 text-center text-xs text-fg-muted">Rating tersimpan. Kamu dapat menutup panel ini atau menghapus percakapan.</p><div className="grid grid-cols-2 gap-2"><Button fullWidth variant="outline" onClick={onDelete} disabled={busy} icon={<Trash2 size={14}/>}>Hapus percakapan</Button><Button fullWidth onClick={onClose} disabled={busy}>Selesai</Button></div></>}{busy&&<p className="mt-3 text-center text-[10px] text-fg-muted">Menyimpan…</p>}</div></div>; }
function BlockedChatOverlay({ name,busy,onUnblock }: { name:string;busy:boolean;onUnblock:()=>void }) { return <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Chat diblokir"><div className="w-full max-w-sm rounded-3xl border border-red-400/20 bg-slate-950/95 p-6 text-center shadow-2xl"><div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-red-500/10 text-red-300"><Lock size={22}/></div><h3 className="text-base font-semibold text-fg">Chat diblokir</h3><p className="mt-2 text-sm leading-relaxed text-fg-secondary">Percakapan dengan <span className="font-semibold text-fg">{name}</span> sedang diblokir. Panel chat ini dinonaktifkan sampai blokir dibuka.</p><Button className="mt-5" disabled={busy} onClick={onUnblock} icon={<Unlock size={15}/>}>{busy?'Membuka…':'Buka Blokir'}</Button></div></div>; }
function TicketIntro({ subject,description }: { subject?:string|null;description?:string|null }) { return <div className="space-y-2"><p className="font-semibold text-fg leading-snug">{subject||'Laporan'}</p><p className="text-sm leading-relaxed text-fg-secondary whitespace-pre-wrap break-words">{description||''}</p></div>; }
function ThreadRow({ t, me, admin, selected, onClick, onHide, pinned = false, onTogglePin }: { t: ChatThread; me: string; admin: boolean; selected: boolean; onClick: () => void; onHide: () => void; pinned?: boolean; onTogglePin?: () => void }) {
  const unread = t.unread_count ?? 0;
  const protectedTicket = isTicket(t) && (t.status === 'open' || (!admin && t.rating == null));
  return <div className={`group flex items-center gap-1.5 rounded-2xl border p-2.5 transition ${selected ? 'border-blue-500/45 bg-blue-600/15 shadow-sm shadow-blue-950/30' : 'border-transparent hover:border-slate-700/70 hover:bg-slate-800/45'}`}>
    <button className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={onClick}>
      <span className="relative shrink-0"><Avatar name={nameOf(t, me, admin)} id={t.user_id === me ? (t.participant_id || t.id) : t.user_id} size={42} src={avatarOf(t, me)}/>{unread > 0 && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-[#111827] bg-blue-400"/>}</span>
      <span className="min-w-0 flex-1"><span className="flex min-w-0 items-center gap-1.5"><span className={`truncate text-[13px] font-semibold ${selected ? 'text-white' : 'text-fg'}`}>{nameOf(t, me, admin)}</span>{pinned && <Pin size={12} className="shrink-0 fill-amber-400 text-amber-400"/>}{isTicket(t) && <span className="shrink-0 rounded bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-semibold text-amber-400">Bantuan</span>}</span><span className="mt-1 block truncate text-[11px] text-fg-muted">{isTicket(t) ? (t.subject || 'Ticket Admin') : `@${usernameOf(t, me, admin)}`} <span className="opacity-50">·</span> {t.last_message || t.description || 'Belum ada pesan'}</span></span>
      <span className="flex shrink-0 flex-col items-end gap-1 self-start pt-0.5">{(t.last_message_at || t.created_at) && <span className={`text-[10px] ${selected ? 'text-blue-300' : 'text-fg-muted'}`}>{formatListTime(t.last_message_at || t.created_at)}</span>}{unread > 0 && <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-600 px-1.5 text-[10px] font-bold text-white">{unread > 99 ? '99+' : unread}</span>}</span>
    </button>
    <div className="flex shrink-0 flex-col gap-0.5 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">{onTogglePin && <button type="button" title={pinned ? 'Lepas sematan' : 'Sematkan (tersimpan di perangkat ini)'} onClick={onTogglePin} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-700/60 hover:text-amber-400">{pinned ? <PinOff size={13}/> : <Pin size={13}/>}</button>}<button type="button" title={protectedTicket ? (isTicket(t) && t.rating == null ? 'Rating wajib diberikan sebelum percakapan disembunyikan' : 'Tiket aktif tidak dapat dihapus') : 'Sembunyikan percakapan'} disabled={protectedTicket} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-700/60 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-20" onClick={onHide}><Trash2 size={13}/></button></div>
  </div>;
}
function GroupRow({ g,selected,onClick }: { g:ChatGroup;selected:boolean;onClick:()=>void }) { return <button onClick={onClick} className={`w-full text-left flex items-center gap-3 p-3 rounded-xl border ${selected?'border-moss-500/50 bg-moss-500/10':'border-transparent hover:bg-white/5'}`}><div className="w-9 h-9 rounded-xl bg-accent/10 text-accent flex items-center justify-center shrink-0"><Users size={17}/></div><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><p className="text-sm font-medium text-fg truncate">{g.name}</p>{g.unread_count>0&&<span className="min-w-5 h-5 rounded-full bg-red-500 text-white text-[9px] flex items-center justify-center">{g.unread_count>99?'99+':g.unread_count}</span>}</div><p className="text-[10px] text-fg-muted truncate">{g.member_count} anggota · {g.last_message||'Belum ada pesan'}</p></div></button>; }
function GroupCreateForm({ busy,canEvent,competitions,onClose,onSubmit }: { busy:boolean;canEvent:boolean;competitions:Array<{id:string;title:string}>;onClose:()=>void;onSubmit:(name:string,type:'general'|'event'|'class',competitionId:string|null,joinMode:'invite_only'|'link')=>void }) { const [name,setName]=useState('');const [type,setType]=useState<'general'|'event'|'class'>('general');const [competitionId,setCompetitionId]=useState('');const [joinMode,setJoinMode]=useState<'invite_only'|'link'>('invite_only');return <Modal onClose={onClose}><div className="flex items-center justify-between"><div><h3 className="font-semibold text-fg">Buat Group</h3><p className="text-xs text-fg-muted mt-1">Group akan muncul di Chat Grup.</p></div><button onClick={onClose}><X size={18}/></button></div><input className="input w-full mt-4" value={name} onChange={e=>setName(e.target.value)} placeholder="Nama group"/><div className="grid grid-cols-3 gap-2 mt-3">{(['general','class','event'] as const).map(item=><button key={item} type="button" disabled={item==='event'&&!canEvent} onClick={()=>setType(item)} className={`rounded-xl border px-3 py-2 text-xs font-medium ${type===item?'border-moss-500 bg-moss-500/10 text-accent':'surface-border text-fg-muted'} disabled:opacity-40`}>{item==='general'?'Umum':item==='class'?'Kelas':'Event'}</button>)}</div>{type==='event'&&<select value={competitionId} onChange={e=>setCompetitionId(e.target.value)} className="input w-full mt-3"><option value="">Pilih event</option>{competitions.map(c=><option key={c.id} value={c.id}>{c.title}</option>)}</select>}<div className="mt-4"><label className="label">Cara bergabung</label><select value={joinMode} onChange={e=>setJoinMode(e.target.value as 'invite_only'|'link')} className="input w-full"><option value="invite_only">Undangan saja</option><option value="link">Bisa lewat link undangan</option></select></div><Button fullWidth className="mt-4" loading={busy} disabled={!name.trim()||(type==='event'&&!competitionId)} onClick={()=>onSubmit(name.trim(),type,type==='event'?competitionId:null,joinMode)} icon={<Plus size={16}/>}>Buat Group</Button></Modal>; }
function GroupMembersModal({ group,me,members,canManage,busy,onClose,onRename,onInvite,onAddUser,onAddParticipant,onRemove }: { group:ChatGroup;me:string;members:ChatGroupMember[];canManage:boolean;busy:boolean;onClose:()=>void;onRename:(name:string)=>void;onInvite:()=>void;onAddUser:(id:string)=>void;onAddParticipant:(id:string)=>void;onRemove:(id:string)=>void }) { const [name,setName]=useState(group.name);const [query,setQuery]=useState('');const [users,setUsers]=useState<Array<{id:string;username:string;full_name:string;avatar_url:string|null}>>([]);const [participantId,setParticipantId]=useState('');const [mode,setMode]=useState<'users'|'participants'>('users');useEffect(()=>{if(mode!=='users'||!query.trim()){setUsers([]);return;}let active=true;const t=window.setTimeout(()=>void searchUsersForChat(query,8).then(v=>{if(active)setUsers(v)}).catch(()=>undefined),250);return()=>{active=false;window.clearTimeout(t)}},[mode,query]);return <Modal onClose={onClose}><div className="flex items-center justify-between"><div><h3 className="font-semibold text-fg">{group.name}</h3><p className="text-xs text-fg-muted mt-1">{members.length} anggota</p></div><button onClick={onClose}><X size={18}/></button></div><div className="flex gap-2 mt-4">{canManage&&<Button size="sm" variant="outline" onClick={()=>onRename(name)} icon={<Settings2 size={14}/>}>Simpan Nama</Button>}<Button size="sm" variant="outline" onClick={onInvite} icon={<Link2 size={14}/>}>Bagikan Link</Button></div>{canManage&&<input className="input w-full mt-3" value={name} onChange={e=>setName(e.target.value)} placeholder="Nama group"/>}<div className="mt-5 space-y-2 max-h-56 overflow-auto">{members.map(m=><div key={m.id} className="flex items-center gap-3 rounded-xl border border-border p-2.5"><Avatar name={m.display_name} id={m.user_id||m.collective_participant_id||m.id} size={32} src={m.avatar_url||undefined}/><div className="min-w-0 flex-1"><p className="text-sm text-fg truncate">{m.display_name}</p><p className="text-[10px] text-fg-muted">{m.member_role}{m.username?` · @${m.username}`:''}</p></div>{canManage&&m.user_id!==me&&m.member_role!=='OWNER'&&<button className="p-1.5 text-slate-500 hover:text-red-300" disabled={busy} onClick={()=>onRemove(m.id)} title="Hapus anggota"><UserMinus size={14}/></button>}</div>)}</div>{canManage&&<><div className="flex gap-2 mt-4"><button className={`text-xs rounded-lg px-3 py-2 ${mode==='users'?'bg-white/10 text-fg':'text-fg-muted'}`} onClick={()=>setMode('users')}>User</button><button className={`text-xs rounded-lg px-3 py-2 ${mode==='participants'?'bg-white/10 text-fg':'text-fg-muted'}`} onClick={()=>setMode('participants')}>Peserta Event</button></div>{mode==='users'?<div className="mt-2"><div className="flex gap-2"><input className="input flex-1" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Cari nama/username"/><Button size="sm" disabled={!users[0]} onClick={()=>onAddUser(users[0].id)} icon={<UserPlus size={14}/>}>Tambah</Button></div>{users.length>0&&<p className="text-[10px] text-fg-muted mt-1">Dipilih: {users[0].full_name} (@{users[0].username})</p>}</div>:<div className="mt-2 flex gap-2"><input className="input flex-1 font-mono" value={participantId} onChange={e=>setParticipantId(e.target.value)} placeholder="ID participant"/><Button size="sm" disabled={!participantId} onClick={()=>onAddParticipant(participantId)} icon={<UserPlus size={14}/>}>Tambah</Button></div>}</>}</Modal>; }

export function MessagesPage() {
 const navigate=useNavigate();
 const { user,toast }=useApp();const {t,language}=useLanguage();const me=user?.id||'';const admin=user?.role==='admin';const teacher=user?.role==='guru';const [params,setParams]=useSearchParams();const [mode,setMode]=useState<'private'|'group'>('private');const [threads,setThreads]=useState<ChatThread[]>([]);const [selected,setSelected]=useState<ChatThread|null>(null);const [messages,setMessages]=useState<ChatMessage[]>([]);const [groups,setGroups]=useState<ChatGroup[]>([]);const [selectedGroup,setSelectedGroup]=useState<ChatGroup|null>(null);const [groupMessages,setGroupMessages]=useState<ChatGroupMessage[]>([]);const [groupMembers,setGroupMembers]=useState<ChatGroupMember[]>([]);const [groupBusy,setGroupBusy]=useState(false);const [groupManageOpen,setGroupManageOpen]=useState(false);const [groupCreateOpen,setGroupCreateOpen]=useState(false);const [groupInvite,setGroupInvite]=useState<string|null>(null);const [joinGroupValue,setJoinGroupValue]=useState('');const [groupInput,setGroupInput]=useState('');const [groupOlderBusy,setGroupOlderBusy]=useState(false);const [groupHasOlder,setGroupHasOlder]=useState(false);const [competitions,setCompetitions]=useState<Array<{id:string;title:string}>>([]);
 const [input,setInput]=useState('');
 const [loading,setLoading]=useState(true);
 const [busy,setBusy]=useState(false);
 const [ticketOpen,setTicketOpen]=useState(false);
 const [ticketBusy,setTicketBusy]=useState(false);
 const [ratingOpen,setRatingOpen]=useState(false);
 const [rating,setRating]=useState(0);
 const [mobileList,setMobileList]=useState(true);
 const [blocked,setBlocked]=useState(false);
 const [blockBusy,setBlockBusy]=useState(false);
 const [olderBusy,setOlderBusy]=useState(false);
 const [hasOlder,setHasOlder]=useState(false);
 const [preview,setPreview]=useState<string|null>(null);
 const [drop,setDrop]=useState(false);
 const [spam,setSpam]=useState<ChatSpamStatus|null>(null);
 const [now,setNow]=useState(Date.now());
 const [spamLevel,setSpamLevel]=useState(0);
 const [threadSearch,setThreadSearch]=useState('');
 const [pinnedIds,setPinnedIds]=useState<string[]>([]);
 const [pinnedOnly,setPinnedOnly]=useState(false);
 const [messageSearchOpen,setMessageSearchOpen]=useState(false);
 const [messageSearch,setMessageSearch]=useState('');
 const [messageSearchIndex,setMessageSearchIndex]=useState(-1);
 const [messageHidden,setMessageHidden]=useState(false);
 const [newMessages,setNewMessages]=useState(0);
 const [moreOpen,setMoreOpen]=useState(false);
 const [securityInfoOpen,setSecurityInfoOpen]=useState(false);
 const [attachmentMenuOpen,setAttachmentMenuOpen]=useState(false);
 const scrollRef=useRef<HTMLDivElement|null>(null);
 const groupScrollRef=useRef<HTMLDivElement|null>(null);
 const fileRef=useRef<HTMLInputElement|null>(null);
  const inputRef=useRef<HTMLTextAreaElement|null>(null);
  const groupInputRef=useRef<HTMLTextAreaElement|null>(null);
 const loadToken=useRef(0);
 const refreshToken=useRef(0);
 const olderRequestRef=useRef<string|null>(null);
 const open=useMemo(()=>threads.filter(t=>t.status==='open'),[threads]);
 const pendingRating=useMemo(()=>threads.filter(t=>t.status==='closed'&&isTicket(t)&&t.rating==null),[threads]);
 const activeTicket=!admin?(open.find(isTicket)||null):null;
 const counterpart=useMemo(()=>selected?(selected.user_id===me?selected.participant_id:selected.user_id):null,[selected,me]);
 const filterThreadRows=useCallback((items:ChatThread[])=>items.filter(thread=>{
   const query=threadSearch.trim().toLocaleLowerCase();
   const text=[nameOf(thread,me,admin),usernameOf(thread,me,admin),thread.last_message||'',thread.subject||'',thread.description||''].join(' ').toLocaleLowerCase();
   return (!query||text.includes(query))&&(!pinnedOnly||pinnedIds.includes(thread.id));
 }).sort((a,b)=>Number(pinnedIds.includes(b.id))-Number(pinnedIds.includes(a.id))),[threadSearch,me,admin,pinnedOnly,pinnedIds]);
 const visibleOpen=useMemo(()=>filterThreadRows(open),[filterThreadRows,open]);
 const visiblePendingRating=useMemo(()=>filterThreadRows(pendingRating),[filterThreadRows,pendingRating]);
 const visibleGroups=useMemo(()=>{const query=threadSearch.trim().toLocaleLowerCase();return groups.filter(group=>!query||`${group.name} ${group.last_message||''}`.toLocaleLowerCase().includes(query));},[groups,threadSearch]);
 const messageMatches=useMemo(()=>{const query=messageSearch.trim().toLocaleLowerCase();return query?messages.filter(isCachedMessage).filter(message=>message.body.toLocaleLowerCase().includes(query)):[]},[messages,messageSearch]);
 const jumpToMessageMatch=(direction:number)=>{if(!messageMatches.length)return;const current=messageSearchIndex<0?(direction>0?-1:0):messageSearchIndex;const next=(current+direction+messageMatches.length)%messageMatches.length;setMessageSearchIndex(next);window.requestAnimationFrame(()=>document.getElementById(`chat-message-${messageMatches[next].id}`)?.scrollIntoView({behavior:'smooth',block:'center'}));};
 const togglePinned=(threadId:string)=>{const alreadyPinned=pinnedIds.includes(threadId);const next=alreadyPinned?pinnedIds.filter(id=>id!==threadId):[threadId,...pinnedIds];setPinnedIds(next);try{localStorage.setItem(`syka.chat.pinned.${me}`,JSON.stringify(next));}catch{toast('Sematan tidak dapat disimpan di perangkat ini.','error');return;}toast(alreadyPinned?'Sematan percakapan dilepas.':'Percakapan disematkan di perangkat ini.','success');};
 const chooseAttachment=(accept:string)=>{setAttachmentMenuOpen(false);const picker=fileRef.current;if(!picker)return;picker.accept=accept;picker.click();};

 const refresh=useCallback(async(force=false)=>{if(!user)return;const token=++refreshToken.current;try{const rows=await loadMyThreads(force);if(token!==refreshToken.current)return;const normalized=dedupeInboxThreads(rows.map(t=>({...t,user_name:t.user_name||'User',username:t.username||'user',other_user_name:t.other_user_name||'User',other_username:t.other_username||'user'})));setThreads(normalized);if(selected){const next=normalized.find(t=>t.id===selected.id);if(next)setSelected(next);}else{const initial=normalized.find(t=>t.thread_type==='dm'&&t.status==='open')||normalized.find(t=>t.status==='open')||normalized.find(t=>isTicket(t)&&t.status==='closed'&&t.rating==null);if(initial)setSelected(initial);}}catch(error:unknown){if(token===refreshToken.current)toast(error instanceof Error?error.message:'Gagal memuat chat.','error')}finally{if(token===refreshToken.current)setLoading(false)}},[user?.id,selected?.id,toast]);
 useEffect(()=>{if(!me){setPinnedIds([]);return;}try{const parsed=JSON.parse(localStorage.getItem(`syka.chat.pinned.${me}`)||'[]');setPinnedIds(Array.isArray(parsed)?parsed.filter((value):value is string=>typeof value==='string'):[]);}catch{setPinnedIds([])}},[me]);
 const loadGroups=useCallback(async():Promise<ChatGroup[]>=>{if(!user)return[];try{const rows=await listChatGroups();setGroups(rows);return rows}catch(error:unknown){toast(error instanceof Error?error.message:'Gagal memuat group.','error');return[]}},[user?.id,toast]);
 useEffect(()=>{void refresh(true);void loadGroups();if(teacher)void listCollectiveCompetitions().then(v=>setCompetitions(v.map(x=>({id:String(x.id),title:String(x.title)})))).catch(()=>undefined)},[refresh,loadGroups,teacher]);
 useEffect(()=>{if(admin||!user)return;let live=true;void getChatSpamStatus().then(v=>{if(live){setSpam(v);setSpamLevel(v.warning_level)}}).catch(()=>undefined);return()=>{live=false}},[admin,user?.id]);
 useEffect(()=>{if(!spam?.blocked_until)return;const id=window.setInterval(()=>setNow(Date.now()),1000);return()=>window.clearInterval(id)},[spam?.blocked_until]);
 useEffect(()=>{if(!user)return;let timer:number|undefined;const schedule=()=>{if(timer)window.clearTimeout(timer);timer=window.setTimeout(()=>void refresh(true),250)};const unsubscribe=subscribeSykaEvents(event=>{if(event.type==='chat-thread-updated'&&selected?.id===String(event.thread.id??''))setSelected(current=>current?{...current,...(event.thread as unknown as ChatThread)}:current);if(['chat-thread-updated','chat-read','chat-hidden','chat-message','chat-reconciled'].includes(event.type))schedule()});return()=>{if(timer)window.clearTimeout(timer);unsubscribe()}},[user?.id,refresh,selected?.id]);
 const directMessageTarget=params.get('user_id')?.trim()||'';
 useEffect(()=>{const target=directMessageTarget;if(!target||!user||target===user.id)return;let live=true;(async()=>{try{const existingThreads=await loadMyThreads(true);let thread=existingThreads.find(x=>x.participant_id&&((x.user_id===user.id&&x.participant_id===target)||(x.user_id===target&&x.participant_id===user.id))&&x.status==='open');if(!thread)thread=await getOrCreateDmThread(target);if(!live)return;setMode('private');setSelectedGroup(null);setSelected(thread);setRating(0);setRatingOpen(false);setMobileList(false)}catch(error:unknown){if(live)toast(error instanceof Error?error.message:'Chat tidak tersedia.','error')}finally{if(live){const next=new URLSearchParams(window.location.search);next.delete('user_id');setParams(next,{replace:true})}}})();return()=>{live=false}},[directMessageTarget,user?.id,setParams,toast]);
 useEffect(()=>{const token=params.get('join_group')?.trim();if(!token||!user)return;let live=true;(async()=>{try{const result=await joinChatGroup(token);if(result.ok){await loadGroups();setMode('group');setSelected(null);setMobileList(true);setGroupInvite(null);toast('Berhasil bergabung ke group.','success')}}catch(error:unknown){if(live)toast(error instanceof Error?error.message:'Link group tidak valid.','error')}finally{if(live){const next=new URLSearchParams(params);next.delete('join_group');setParams(next,{replace:true})}}})();return()=>{live=false}},[params,user?.id,setParams,toast,loadGroups]);
 useEffect(() => {
    if (!selected || !me) return;
    const threadId = selected.id;
    const token = ++loadToken.current;
    let live = true;
    const allLegacyMessages = cacheGet(threadId).sort((a, b) => a.created_at.localeCompare(b.created_at));
    const legacyLatest = allLegacyMessages.slice(-INITIAL_MESSAGE_PAGE);
    setMessages(legacyLatest);
    setHasOlder(allLegacyMessages.length > INITIAL_MESSAGE_PAGE);
    setOlderBusy(false);
    olderRequestRef.current = null;

    (async () => {
      try {
        const cached = await readChatMessageCache(me, threadId, INITIAL_MESSAGE_PAGE);
        if (!live || token !== loadToken.current) return;

        const cachedMessages = cached?.messages ?? legacyLatest;
        const hasLocalOrRemoteOlder = cached
          ? cached.hasCachedOlder || cached.hasOlder
          : allLegacyMessages.length > INITIAL_MESSAGE_PAGE;
        if (cachedMessages.length) {
          setMessages(cachedMessages);
          setHasOlder(hasLocalOrRemoteOlder);
          requestAnimationFrame(() => {
            if (live && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
          });
          if (!cached && allLegacyMessages.length) {
            await mergeChatMessageCache(me, threadId, allLegacyMessages, { hasOlder: true });
          }
        }

        const cacheIsFresh = !!cached?.lastSyncedAt
          && Date.now() - cached.lastSyncedAt < MESSAGE_CACHE_REVALIDATE_MS;
        if (!cacheIsFresh) {
          const rows = await loadChatMessagesPage(threadId, INITIAL_MESSAGE_PAGE);
          if (!live || token !== loadToken.current) return;
          const validRows = rows.filter(isCachedMessage);
          const latestMessages = mergeMessageRows(cachedMessages, validRows).slice(-INITIAL_MESSAGE_PAGE);
          const nextHasOlder = cached ? cached.hasOlder : rows.length >= INITIAL_MESSAGE_PAGE;
          setMessages(latestMessages);
          setHasOlder(cached ? (cached.hasCachedOlder || nextHasOlder) : nextHasOlder);
          await mergeChatMessageCache(me, threadId, validRows, {
            hasOlder: nextHasOlder,
            lastSyncedAt: Date.now(),
          });
          if (!cachedMessages.length) {
            requestAnimationFrame(() => {
              if (live && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
            });
          }
        }

        await markThreadRead(threadId);
        if (live) setThreads(current => current.map(thread => (
          thread.id === threadId ? { ...thread, unread_count: 0 } : thread
        )));
      } catch (error: unknown) {
        if (live && !legacyLatest.length) {
          toast(error instanceof Error ? error.message : 'Gagal memuat pesan.', 'error');
        }
      }
    })();

    const channel = supabase.channel(`chat-active-${threadId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `thread_id=eq.${threadId}` }, payload => {
        const message = payload.new as ChatMessage;
        if (!live || !isCachedMessage(message)) return;
        const element = scrollRef.current;
        const nearBottom = !element || element.scrollHeight - element.scrollTop - element.clientHeight < 120;
        const mine = message.sender_id === me;
        const shouldStick = mine || nearBottom;
        setMessages(current => mergeMessageRows(
          current.filter(item => !(item.id.startsWith('local-') && item.sender_id === message.sender_id && item.body === message.body)),
          [message],
        ));
        void mergeChatMessageCache(me, threadId, [message]);
        setThreads(current => current.map(thread => thread.id === threadId ? {
          ...thread,
          last_message: message.body,
          last_message_at: message.created_at,
          unread_count: shouldStick ? 0 : Math.min(99, (thread.unread_count ?? 0) + 1),
        } : thread));
        if (shouldStick) {
          setNewMessages(0);
          requestAnimationFrame(() => {
            if (scrollRef.current) scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
          });
          if (!mine) void markThreadRead(threadId).catch(() => undefined);
        } else if (!mine) {
          setNewMessages(value => Math.min(99, value + 1));
        }
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'chat_threads', filter: `id=eq.${threadId}` }, payload => {
        if (live) setSelected(current => current ? { ...current, ...(payload.new as ChatThread) } : current);
      })
      .subscribe();

    return () => {
      live = false;
      void supabase.removeChannel(channel);
    };
  }, [selected?.id, toast, me]);
 useEffect(()=>{if(!selectedGroup)return;let live=true;(async()=>{try{const rows=await loadChatGroupMessages(selectedGroup.id,PAGE);setGroupMessages(rows);setGroupHasOlder(rows.length>=PAGE);await markChatGroupRead(selectedGroup.id);setGroups(current=>current.map(g=>g.id===selectedGroup.id?{...g,unread_count:0}:g))}catch(error:unknown){if(live)toast(error instanceof Error?error.message:'Gagal memuat group.','error')}})();void listChatGroupMembers(selectedGroup.id).then(setGroupMembers).catch(()=>undefined);const channel=supabase.channel(`chat-group-${selectedGroup.id}`).on('postgres_changes',{event:'INSERT',schema:'public',table:'chat_group_messages',filter:`group_id=eq.${selectedGroup.id}`},payload=>{const row=payload.new as ChatGroupMessage;if(!live)return;const element=groupScrollRef.current;const nearBottom=!element||element.scrollHeight-element.scrollTop-element.clientHeight<120;const mine=row.sender_user_id===me;const shouldStick=mine||nearBottom;setGroupMessages(current=>current.some(m=>m.id===row.id)?current:[...current,row]);setGroups(current=>current.map(g=>g.id===selectedGroup.id?{...g,last_message:row.body,last_message_at:row.created_at,unread_count:shouldStick?0:Math.min(99,(g.unread_count??0)+1)}:g));if(shouldStick){setNewMessages(0);requestAnimationFrame(()=>{if(groupScrollRef.current)groupScrollRef.current.scrollTo({top:groupScrollRef.current.scrollHeight,behavior:'smooth'})});if(!mine)void markChatGroupRead(selectedGroup.id).catch(()=>undefined)}else if(!mine)setNewMessages(value=>Math.min(99,value+1))}).subscribe();return()=>{live=false;void supabase.removeChannel(channel)}},[selectedGroup?.id,toast,me]);
 const loadGroupOlder=useCallback(async()=>{if(!selectedGroup||groupOlderBusy||!groupHasOlder||!groupMessages.length||!groupScrollRef.current)return;setGroupOlderBusy(true);const element=groupScrollRef.current;const height=element.scrollHeight;try{const rows=await loadChatGroupMessages(selectedGroup.id,PAGE,groupMessages[0].created_at);if(!rows.length){setGroupHasOlder(false);return}setGroupMessages(current=>[...rows,...current].filter((m,i,a)=>a.findIndex(x=>x.id===m.id)===i).sort((a,b)=>a.created_at.localeCompare(b.created_at)));requestAnimationFrame(()=>{element.scrollTop=element.scrollHeight-height})}catch(error:unknown){toast(error instanceof Error?error.message:'Gagal memuat pesan lama.','error')}finally{setGroupOlderBusy(false)}},[selectedGroup?.id,groupOlderBusy,groupHasOlder,groupMessages,toast]);
 const loadOlder = useCallback(async () => {
    if (!selected || olderBusy || !hasOlder || !messages.length || !scrollRef.current) return;
    const threadId = selected.id;
    const loadVersion = loadToken.current;
    if (olderRequestRef.current === threadId) return;
    olderRequestRef.current = threadId;
    setOlderBusy(true);
    const element = scrollRef.current;
    const previousHeight = element.scrollHeight;
    const before = messages[0].created_at;
    try {
      const cachedRows = await readOlderChatMessageCache(me, threadId, before, PAGE);
      if (loadVersion !== loadToken.current) return;

      if (cachedRows.length) {
        const meta = await readChatMessageCache(me, threadId, 1);
        if (loadVersion !== loadToken.current) return;
        const stillHasCachedOlder = !!meta?.oldestCachedAt
          && meta.oldestCachedAt < cachedRows[0].created_at;
        const nextHasOlder = cachedRows.length >= PAGE || stillHasCachedOlder || !!meta?.hasOlder;
        setMessages(current => mergeMessageRows(current, cachedRows));
        setHasOlder(nextHasOlder);
        requestAnimationFrame(() => {
          if (scrollRef.current === element) element.scrollTop = element.scrollHeight - previousHeight;
        });
        return;
      }

      const meta = await readChatMessageCache(me, threadId, 1);
      if (loadVersion !== loadToken.current) return;
      if (!meta?.hasOlder) {
        setHasOlder(false);
        return;
      }

      const rows = await loadChatMessagesPage(threadId, PAGE, before);
      if (loadVersion !== loadToken.current) return;
      if (!rows.length) {
        setHasOlder(false);
        await mergeChatMessageCache(me, threadId, [], { hasOlder: false });
        return;
      }
      const validRows = rows.filter(isCachedMessage);
      const nextHasOlder = rows.length >= PAGE;
      setMessages(current => mergeMessageRows(current, validRows));
      setHasOlder(nextHasOlder);
      await mergeChatMessageCache(me, threadId, validRows, { hasOlder: nextHasOlder });
      requestAnimationFrame(() => {
        if (scrollRef.current === element) element.scrollTop = element.scrollHeight - previousHeight;
      });
    } catch (error: unknown) {
      if (loadVersion === loadToken.current) {
        toast(error instanceof Error ? error.message : 'Gagal memuat pesan sebelumnya.', 'error');
      }
    } finally {
      if (olderRequestRef.current === threadId) olderRequestRef.current = null;
      if (loadVersion === loadToken.current) setOlderBusy(false);
    }
  }, [selected?.id, me, olderBusy, hasOlder, messages, toast]);
 const choose=useCallback(async(thread:ChatThread)=>{setMode('private');setSelectedGroup(null);if(selected?.id===thread.id){setMobileList(false);return}setSelected(thread);setMessages(cacheGet(thread.id).slice(-INITIAL_MESSAGE_PAGE));setRating(0);setRatingOpen(false);setNewMessages(0);setMessageHidden(false);setMobileList(false);await markThreadRead(thread.id).catch(()=>undefined);setThreads(current=>current.map(item=>item.id===thread.id?{...item,unread_count:0}:item))},[selected?.id]);
 const chooseGroup=useCallback(async(group:ChatGroup)=>{setMode('group');setSelected(null);setSelectedGroup(group);setGroupInput('');setNewMessages(0);setMessageHidden(false);setMobileList(false);await markChatGroupRead(group.id).catch(()=>undefined);setGroups(current=>current.map(item=>item.id===group.id?{...item,unread_count:0}:item))},[]);
 const parseCooldown=(error:unknown)=>{const message=error instanceof Error?error.message:'';const match=message.match(/Peringatan\s+(\d+).*?(\d{4}-\d{2}-\d{2}T[^\s.]+)/i);if(!match)return false;const level=Number(match[1]);const until=new Date(match[2]);if(Number.isNaN(until.getTime()))return false;setSpam({warning_level:level,strike_count:level,blocked_until:until.toISOString(),reset_at:spam?.reset_at||new Date(Date.now()+7*86400000).toISOString()});setSpamLevel(level);setNow(Date.now());toast(`Peringatan ${level}: chat dibatasi sementara karena spam.`,'error');return true};
 const focusComposer=(element:HTMLTextAreaElement|null)=>{window.requestAnimationFrame(()=>window.requestAnimationFrame(()=>element?.focus({preventScroll:true})))};
  const sendText=async()=>{
    if(!selected||selected.status!=='open'||blocked||!input.trim()||busy||(admin&&isTicket(selected)&&!selected.handled_by))return;
    const cooldownMs=spam?.blocked_until?Math.max(0,new Date(spam.blocked_until).getTime()-Date.now()):0;
    if(cooldownMs>0)return;
    const text=input.trim();
    const optimistic:ChatMessage={id:`local-${crypto.randomUUID()}`,thread_id:selected.id,sender_id:me,body:text,created_at:new Date().toISOString()};
    setMessages(current=>[...current.filter(isCachedMessage),optimistic]);
    setInput('');
    setBusy(true);
    try{
      const saved=await sendMessage(selected.id,text);
      if(!isCachedMessage(saved))throw new Error('CHAT_SEND_INVALID_RESPONSE');
      setMessages(current=>mergeMessageRows(current.map(item=>item.id===optimistic.id?saved:item),[]));
      void mergeChatMessageCache(me,selected.id,[saved]);
      setThreads(current=>current.map(thread=>thread.id===selected.id?{...thread,last_message:saved.body,last_message_at:saved.created_at}:thread));
    }catch(error:unknown){
      setMessages(current=>current.filter(isCachedMessage).filter(item=>item.id!==optimistic.id));
      if(!parseCooldown(error))toast(error instanceof Error?error.message:'Gagal mengirim pesan.','error');
    }finally{
      setBusy(false);
      focusComposer(inputRef.current);
    }
  };
  const sendGroupText=async()=>{
    if(!selectedGroup||!groupInput.trim()||groupBusy)return;
    const text=groupInput.trim();
    setGroupInput('');
    setGroupBusy(true);
    try{
      await sendChatGroupMessage(selectedGroup.id,text);
      const rows=await loadChatGroupMessages(selectedGroup.id,PAGE);
      setGroupMessages(rows);
      setGroups(current=>current.map(group=>group.id===selectedGroup.id?{...group,last_message:text,last_message_at:new Date().toISOString()}:group));
    }catch(error:unknown){
      toast(error instanceof Error?error.message:'Gagal mengirim pesan group.','error');
    }finally{
      setGroupBusy(false);
      focusComposer(groupInputRef.current);
    }
  };
  const upload=async(file:File)=>{if(!selected||selected.status!=='open'||blocked||busy)return;try{validateChatFile(file);setBusy(true);const uploadResult=await uploadChatAttachment(file,selected.id,me);const saved=await sendMessage(selected.id,uploadResult.secure_url);if(!isCachedMessage(saved))throw new Error('CHAT_SEND_INVALID_RESPONSE');await attachChatMedia(uploadResult.media_id,saved.id);setMessages(current=>mergeMessageRows(current,[saved]));void mergeChatMessageCache(me,selected.id,[saved]);toast('Lampiran berhasil dikirim.','success')}catch(error:unknown){if(!parseCooldown(error))toast(error instanceof Error?error.message:'Lampiran gagal dikirim.','error')}finally{setBusy(false);focusComposer(inputRef.current)}};
 const onPaste=(event:ClipboardEvent)=>{const item=Array.from(event.clipboardData.items).find(entry=>entry.kind==='file'&&entry.type.startsWith('image/'));const file=item?.getAsFile();if(file){event.preventDefault();void upload(file)}};const onDrop=(event:DragEvent)=>{event.preventDefault();setDrop(false);const file=event.dataTransfer.files?.[0];if(file)void upload(file)};
 const hide=async(thread:ChatThread)=>{setThreads(current=>current.filter(item=>item.id!==thread.id));if(selected?.id===thread.id){setSelected(null);setMessages([]);setRating(0);setRatingOpen(false);setMobileList(true)}try{await hideChatThread(thread.id);toast('Percakapan disembunyikan.','success')}catch(error:unknown){toast(error instanceof Error?error.message:'Gagal menghapus chat.','error');void refresh(true)}};
 const toggleBlock=async()=>{if(!counterpart||blockBusy)return;const old=blocked;setBlockBusy(true);setBlocked(!old);try{if(old)await unblockChatUser(counterpart);else await blockChatUser(counterpart);toast(old?'Blokir dibuka.':'Pengguna diblokir.','success')}catch(error:unknown){setBlocked(old);toast(error instanceof Error?error.message:'Gagal mengubah blokir.','error')}finally{setBlockBusy(false)}};
 const createTicket=async(subject:string,description:string)=>{setTicketBusy(true);try{const thread=await createTicketThread(subject,description);setTicketOpen(false);setSelected(thread);setMessages([]);setRating(0);setRatingOpen(false);setMobileList(false);setThreads(current=>[thread,...current.filter(item=>item.id!==thread.id)]);toast('Laporan berhasil dikirim.','success')}catch(error:unknown){toast(error instanceof Error?error.message:'Gagal membuat laporan.','error')}finally{setTicketBusy(false)}};
 const finish=async()=>{if(!selected)return;setTicketBusy(true);try{const thread=await closeThread(selected.id);setSelected(thread);setThreads(current=>current.map(item=>item.id===thread.id?thread:item));toast('Percakapan diselesaikan.','success')}catch(error:unknown){toast(error instanceof Error?error.message:'Gagal menyelesaikan ticket.','error')}finally{setTicketBusy(false)}};
 const rateTicket=async(value:number)=>{if(!selected||!isTicket(selected)||selected.status!=='closed'||rating>0||ticketBusy)return;setRating(value);setTicketBusy(true);try{const thread=await closeThread(selected.id,value);setSelected(thread);setThreads(current=>current.map(item=>item.id===thread.id?thread:item));toast('Rating tersimpan.','success')}catch(error:unknown){setRating(0);toast(error instanceof Error?error.message:'Gagal menyimpan rating.','error')}finally{setTicketBusy(false)}};
 const deleteAfterRating=()=>{if(selected)void hide(selected)};
 const createGroup=async(name:string,type:'general'|'event'|'class',competitionId:string|null,joinMode:'invite_only'|'link')=>{setGroupBusy(true);try{const created=await createChatGroup({name,groupType:type,competitionId,joinMode});setGroupCreateOpen(false);const rows=await loadGroups();const group=rows.find(g=>g.id===created.id);if(group)void chooseGroup(group);else toast('Group berhasil dibuat.','success')}catch(error:unknown){toast(error instanceof Error?error.message:'Gagal membuat group.','error')}finally{setGroupBusy(false)}};
 const openGroupManager=async()=>{if(!selectedGroup)return;setGroupManageOpen(true);await listChatGroupMembers(selectedGroup.id).then(setGroupMembers).catch(()=>undefined)};
 const renameGroup=async(name:string)=>{if(!selectedGroup)return;setGroupBusy(true);try{const updated=await renameChatGroup(selectedGroup.id,name);setSelectedGroup({...selectedGroup,...updated});setGroups(current=>current.map(g=>g.id===selectedGroup.id?{...g,...updated}:g));toast('Nama group diperbarui.','success')}catch(error:unknown){toast(error instanceof Error?error.message:'Gagal mengubah nama group.','error')}finally{setGroupBusy(false)}};
 const inviteGroup=async()=>{if(!selectedGroup)return;try{const token=await createChatGroupInvite(selectedGroup.id);const url=`${window.location.origin}/pesan?join_group=${encodeURIComponent(token)}`;await navigator.clipboard.writeText(url).catch(()=>undefined);setGroupInvite(url);toast('Link undangan disalin.','success')}catch(error:unknown){toast(error instanceof Error?error.message:'Gagal membuat link group.','error')}};
 const addUser=async(id:string)=>{if(!selectedGroup)return;setGroupBusy(true);try{await addChatGroupMember(selectedGroup.id,{userId:id});setGroupMembers(await listChatGroupMembers(selectedGroup.id));await loadGroups();toast('Anggota ditambahkan.','success')}catch(error:unknown){toast(error instanceof Error?error.message:'Gagal menambah anggota.','error')}finally{setGroupBusy(false)}};
 const addParticipant=async(id:string)=>{if(!selectedGroup)return;setGroupBusy(true);try{await addChatGroupMember(selectedGroup.id,{collectiveParticipantId:id});setGroupMembers(await listChatGroupMembers(selectedGroup.id));await loadGroups();toast('Peserta ditambahkan.','success')}catch(error:unknown){toast(error instanceof Error?error.message:'Gagal menambah peserta.','error')}finally{setGroupBusy(false)}};
 const removeMember=async(id:string)=>{if(!selectedGroup)return;setGroupBusy(true);try{await removeChatGroupMember(selectedGroup.id,id);setGroupMembers(await listChatGroupMembers(selectedGroup.id));await loadGroups();toast('Anggota dihapus dari group.','success')}catch(error:unknown){toast(error instanceof Error?error.message:'Gagal menghapus anggota.','error')}finally{setGroupBusy(false)}};
 const joinGroupFromInput=async()=>{const value=joinGroupValue.trim();if(!value){toast('Tempel link atau token undangan terlebih dahulu.','error');return;}let token=value;try{const url=new URL(value);token=url.searchParams.get('join_group')||value;}catch{/* Input may be a raw invitation token. */}if(!token||token.length<12){toast('Link atau token undangan tidak valid.','error');return;}setGroupBusy(true);try{const result=await joinChatGroup(token);if(!result.ok)throw new Error('Undangan tidak dapat digunakan.');setGroupInvite(null);setJoinGroupValue('');setMode('group');setSelected(null);setMobileList(true);await loadGroups();toast('Berhasil bergabung ke group.','success')}catch(error:unknown){toast(error instanceof Error?error.message:'Undangan tidak valid atau sudah kedaluwarsa.','error')}finally{setGroupBusy(false)}};
 const isSelectedPinned=!!selected&&pinnedIds.includes(selected.id);
 const cooldownMs=spam?.blocked_until?Math.max(0,new Date(spam.blocked_until).getTime()-now):0;const canSend=!cooldownMs&&!blocked;const canManageGroup=!!selectedGroup&&['OWNER','ADMIN'].includes(selectedGroup.my_role);
 return <div className="flex h-[calc(100dvh-184px)] min-h-0 max-h-[calc(100dvh-184px)] flex-col overflow-hidden surface-bg text-fg-secondary md:h-[calc(100dvh-60px)] md:max-h-[calc(100dvh-60px)]">

   <div className="relative flex min-h-0 flex-1 overflow-hidden border-b surface-border bg-white dark:bg-[#0f172a]">
     <aside className={(mobileList?'flex':'hidden')+' w-full shrink-0 flex-col border-r surface-border bg-slate-50 dark:bg-[#111827] md:flex md:w-[320px] lg:w-[340px] xl:w-[365px]'}>
       <div className="shrink-0 space-y-3 border-b surface-border p-3 sm:p-4">
         <div className="grid grid-cols-2 gap-1 rounded-xl border border-slate-200 bg-slate-100 p-1 text-center text-xs font-semibold dark:border-slate-800 dark:bg-[#0b0f19]">
           <button type="button" onClick={()=>{setMode('private');setSelectedGroup(null);setMobileList(true)}} className={mode==='private'?'rounded-lg bg-blue-600 py-2.5 text-white shadow-md shadow-blue-950/20 transition':'rounded-lg py-2.5 text-slate-500 transition hover:text-fg dark:text-slate-400 dark:hover:text-white'}>{t('chat.private')}</button>
           <button type="button" onClick={()=>{setMode('group');setSelected(null);setMobileList(true)}} className={mode==='group'?'rounded-lg bg-blue-600 py-2.5 text-white shadow-md shadow-blue-950/20 transition':'rounded-lg py-2.5 text-slate-500 transition hover:text-fg dark:text-slate-400 dark:hover:text-white'}>{t('chat.group')}</button>
         </div>
         <div className="flex items-center gap-2">
           <div className="relative min-w-0 flex-1"><Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/><input value={threadSearch} onChange={event=>setThreadSearch(event.target.value)} placeholder={mode==='private'?'Cari percakapan...':'Cari grup...'} className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-8 text-xs text-fg outline-none transition placeholder:text-slate-400 focus:border-blue-500/60 focus:ring-2 focus:ring-blue-500/10 dark:border-slate-800 dark:bg-[#0b0f19] dark:text-slate-200 dark:placeholder:text-slate-500"/>{threadSearch&&<button type="button" onClick={()=>setThreadSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:text-fg" aria-label="Hapus pencarian"><X size={13}/></button>}</div>
           {mode==='private'&&<button type="button" title={pinnedOnly?'Tampilkan semua percakapan':'Tampilkan percakapan yang disematkan'} onClick={()=>setPinnedOnly(value=>!value)} className={'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border transition '+(pinnedOnly?'border-amber-500/30 bg-amber-500/10 text-amber-500':'border-slate-200 text-slate-500 hover:border-slate-300 hover:text-fg dark:border-slate-800 dark:text-slate-400 dark:hover:bg-slate-800')}><Pin size={16} className={pinnedOnly?'fill-amber-400':''}/></button>}
           {mode==='group'&&<button type="button" onClick={()=>setGroupCreateOpen(true)} title="Buat grup" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 text-slate-500 transition hover:border-blue-500/30 hover:bg-blue-500/10 hover:text-blue-500 dark:border-slate-800 dark:text-slate-400"><Plus size={17}/></button>}
         </div>
         {pinnedOnly&&mode==='private'&&<div className="flex items-center justify-between rounded-lg bg-amber-500/10 px-2.5 py-1.5 text-[10px] text-amber-500"><span>Hanya percakapan disematkan</span><button type="button" onClick={()=>setPinnedOnly(false)} className="font-semibold underline underline-offset-2">Hapus filter</button></div>}
       </div>
       <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2 sm:p-2.5">
         {mode==='private' ? (loading ? <div className="space-y-3 p-3"><div className="h-12 animate-pulse rounded-xl bg-slate-200/70 dark:bg-slate-800/70"/><div className="h-12 animate-pulse rounded-xl bg-slate-200/70 dark:bg-slate-800/70"/><div className="h-12 animate-pulse rounded-xl bg-slate-200/70 dark:bg-slate-800/70"/></div> : <>
           {visibleOpen.length>0&&<div className="flex items-center justify-between px-2 pb-1 pt-1.5"><span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-500" >{pinnedOnly?(language==='en'?'Pinned':'Disematkan'):t('chat.active')}</span><span className="text-[10px] tabular-nums text-slate-400">{visibleOpen.length}</span></div>}
           {visibleOpen.map(thread=><ThreadRow key={thread.id} t={thread} me={me} admin={admin} selected={selected?.id===thread.id} pinned={pinnedIds.includes(thread.id)} onTogglePin={()=>togglePinned(thread.id)} onClick={()=>void choose(thread)} onHide={()=>void hide(thread)}/>)}
           {visiblePendingRating.length>0&&<div className="flex items-center justify-between px-2 pb-1 pt-3"><span className="text-[10px] font-bold uppercase tracking-[0.14em] text-amber-500">Menunggu Rating</span><span className="text-[10px] text-slate-400">{visiblePendingRating.length}</span></div>}
           {visiblePendingRating.map(thread=><ThreadRow key={thread.id} t={thread} me={me} admin={admin} selected={selected?.id===thread.id} pinned={pinnedIds.includes(thread.id)} onTogglePin={()=>togglePinned(thread.id)} onClick={()=>void choose(thread)} onHide={()=>void hide(thread)}/>)}
           {!visibleOpen.length&&!visiblePendingRating.length&&<div className="px-5 py-12 text-center"><div className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-200/70 text-slate-500 dark:bg-slate-800 dark:text-slate-400"><MessageCircle size={20}/></div><p className="mt-3 text-xs font-semibold text-fg">{pinnedOnly?t('chat.noPinned'):threadSearch?t('chat.notFound'):t('chat.noConversations')}</p><p className="mt-1 text-[11px] text-fg-muted">{pinnedOnly?(language==='en'?'Pin a conversation from the chat menu.':'Sematkan percakapan dari menu chat.'):t('chat.newMessages')}</p></div>}
         </>) : <>
           {visibleGroups.map(group=><GroupRow key={group.id} g={group} selected={selectedGroup?.id===group.id} onClick={()=>void chooseGroup(group)}/>)}
           {!visibleGroups.length&&<div className="px-5 py-12 text-center"><Users size={22} className="mx-auto text-slate-400"/><p className="mt-3 text-xs font-semibold text-fg">{threadSearch?'Grup tidak ditemukan.':'Belum ada grup.'}</p><p className="mt-1 text-[11px] text-fg-muted">Buat grup baru atau gabung dengan link undangan.</p></div>}
           <button type="button" className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 py-3 text-xs font-semibold text-slate-500 transition hover:border-blue-500/40 hover:text-blue-500 dark:border-slate-700 dark:text-slate-400" onClick={()=>{setJoinGroupValue('');setGroupInvite('join')}}><Link2 size={14}/> Gabung dengan link undangan</button>
         </>}
       </div>
     </aside>
     <section className={(mobileList?'hidden':'flex')+' relative min-h-0 min-w-0 flex-1 flex-col dark:bg-[#0f172a] bg-white md:flex'}>
       {mode==='private' ? (!selected ? <div className="flex flex-1 flex-col items-center justify-center p-8 text-center"><div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-500/10 text-blue-500"><MessageCircle size={26}/></div><h2 className="mt-4 text-sm font-semibold text-fg">Pilih percakapan</h2><p className="mt-1 max-w-xs text-xs leading-relaxed text-fg-muted">Pilih chat dari daftar di sisi kiri untuk membaca pesan dan melanjutkan percakapan.</p></div> : <>
         <header className="z-10 flex shrink-0 items-center gap-3 border-b border-slate-200 bg-white/70 px-3 py-3 backdrop-blur dark:border-slate-800/80 dark:bg-[#111827]/65 sm:px-5">
           <button type="button" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800 md:hidden" onClick={()=>setMobileList(true)} aria-label="Kembali ke daftar chat"><ArrowLeft size={18}/></button>
           <button type="button" disabled={isTicket(selected)||usernameOf(selected,me,admin)==='user'} onClick={()=>{const handle=usernameOf(selected,me,admin);if(!isTicket(selected)&&handle&&handle!=='user')navigate(`/profile/@${handle}`)}} className="flex min-w-0 flex-1 items-center gap-3 text-left disabled:cursor-default" aria-label={isTicket(selected)?'Percakapan tiket bantuan':`Lihat profil ${nameOf(selected,me,admin)}`}>
             <Avatar name={nameOf(selected,me,admin)} id={selected.user_id===me?(selected.participant_id||selected.id):selected.user_id} size={42} src={avatarOf(selected,me)}/>
             <span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2"><span className="truncate text-sm font-bold text-fg sm:text-[15px]">{nameOf(selected,me,admin)}</span>{isTicket(selected)&&<Badge color="warn">Tiket Admin</Badge>}</span><span className="mt-0.5 block truncate text-[11px] text-fg-muted">@{usernameOf(selected,me,admin)} <span className="px-0.5 opacity-50">•</span> {isTicket(selected)?(selected.status==='open'?'Layanan bantuan aktif':'Tiket selesai'):'Chat pribadi'}</span>{cooldownMs>0&&<span className="mt-1 block text-[10px] text-red-400">Peringatan {spamLevel}: pengiriman dibatasi · {formatCooldown(cooldownMs)}</span>}</span>
           </button>
           <div className="flex shrink-0 items-center gap-0.5 sm:gap-1">
             <button type="button" title="Cari di percakapan" onClick={()=>{setMessageSearchOpen(value=>!value);setMessageSearch('');setMessageSearchIndex(0)}} className={'rounded-xl p-2 transition hover:bg-slate-100 dark:hover:bg-slate-800 '+(messageSearchOpen?'text-blue-500':'text-slate-500 dark:text-slate-400')}><Search size={17}/></button>
             <button type="button" title={isSelectedPinned?'Lepas sematan':'Sematkan percakapan di perangkat ini'} onClick={()=>togglePinned(selected.id)} className={'rounded-xl p-2 transition hover:bg-slate-100 dark:hover:bg-slate-800 '+(isSelectedPinned?'text-amber-500':'text-slate-500 dark:text-slate-400')}>{isSelectedPinned?<PinOff size={17}/>:<Pin size={17}/>}</button>
             <button type="button" aria-label={messageHidden?'Tampilkan kembali isi pesan':'Samarkan isi pesan di layar ini'} title={messageHidden?'Tampilkan kembali isi pesan':'Samarkan isi pesan di layar ini (bukan kunci/enkripsi chat)'} onClick={()=>setMessageHidden(value=>!value)} className={'rounded-xl p-2 transition hover:bg-slate-100 dark:hover:bg-slate-800 '+(messageHidden?'text-blue-500':'text-slate-500 dark:text-slate-400')}>{messageHidden?<Unlock size={17}/>:<Lock size={17}/>}</button>
             <span className="mx-1 hidden h-5 border-l border-slate-200 dark:border-slate-800 sm:block"/>
             <button type="button" title="Opsi percakapan" onClick={()=>setMoreOpen(value=>!value)} className="rounded-xl p-2 text-slate-500 transition hover:bg-slate-100 hover:text-fg dark:text-slate-400 dark:hover:bg-slate-800"><MoreVertical size={17}/></button>
           </div>
         </header>
         {messageSearchOpen&&<div className="z-10 flex shrink-0 items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-[#111827] sm:px-5"><Search size={15} className="shrink-0 text-slate-400"/><input autoFocus value={messageSearch} onChange={event=>{setMessageSearch(event.target.value);setMessageSearchIndex(-1)}} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();jumpToMessageMatch(1)}}} placeholder="Cari kata di pesan yang sudah dimuat..." className="min-w-0 flex-1 bg-transparent text-xs text-fg outline-none placeholder:text-slate-400"/><span className="whitespace-nowrap text-[10px] tabular-nums text-fg-muted">{messageSearch.trim()?messageMatches.length?String(messageSearchIndex<0?0:messageSearchIndex+1)+' / '+messageMatches.length:'0 hasil':''}</span><button type="button" onClick={()=>jumpToMessageMatch(-1)} disabled={!messageMatches.length} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-200 disabled:opacity-30 dark:hover:bg-slate-800" title="Hasil sebelumnya"><ChevronUp size={15}/></button><button type="button" onClick={()=>jumpToMessageMatch(1)} disabled={!messageMatches.length} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-200 disabled:opacity-30 dark:hover:bg-slate-800" title="Hasil berikutnya"><ChevronDown size={15}/></button><button type="button" onClick={()=>{setMessageSearchOpen(false);setMessageSearch('')}} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800" aria-label="Tutup pencarian"><X size={14}/></button></div>}
         {isTicket(selected)&&selected.status==='open'&&admin&&!selected.handled_by&&<div className="flex shrink-0 justify-end border-b border-slate-200 bg-amber-500/5 px-4 py-2 dark:border-slate-800"><Button size="sm" onClick={()=>void claimChatTicket(selected.id).then(thread=>{setSelected(thread);setThreads(current=>current.map(item=>item.id===thread.id?thread:item));toast('Tiket berhasil diambil alih.','success')}).catch(error=>toast(error instanceof Error?error.message:'Tiket gagal diambil.','error'))}>Ambil Tiket</Button></div>}
         {isTicket(selected)&&selected.status==='open'&&admin&&!!selected.handled_by&&<div className="flex shrink-0 justify-end border-b border-slate-200 bg-amber-500/5 px-4 py-2 dark:border-slate-800"><Button size="sm" variant="outline" disabled={selected.handled_by!==me||ticketBusy} onClick={finish}>{ticketBusy?'Menyimpan…':'Selesaikan Tiket'}</Button></div>}
         {selected.status==='closed'&&<div className="flex shrink-0 items-start gap-2.5 border-b border-slate-200 bg-slate-100/80 px-4 py-2.5 text-[11px] text-slate-600 dark:border-slate-800/80 dark:bg-slate-900/55 dark:text-slate-300"><Lock size={14} className="mt-0.5 shrink-0 text-slate-400"/><div><p className="font-semibold text-fg">Percakapan telah ditutup</p><p className="mt-0.5 leading-relaxed">Pesan sebelumnya tetap dapat dibaca, tetapi pesan baru tidak bisa dikirim dari percakapan ini.</p></div></div>}
         <div data-testid="chat-message-list" ref={scrollRef} onScroll={event=>{const element=event.currentTarget;if(element.scrollTop<=30)void loadOlder();if(element.scrollHeight-element.scrollTop-element.clientHeight<80&&newMessages>0){setNewMessages(0);void markThreadRead(selected.id).catch(()=>undefined);setThreads(current=>current.map(item=>item.id===selected.id?{...item,unread_count:0}:item));}}} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-4 sm:px-5 sm:py-5">
           {olderBusy&&<p className="text-center text-[10px] text-fg-muted">Memuat pesan sebelumnya…</p>}
           {messages.filter(isCachedMessage).length===0?<div className="py-12 text-center"><MessageCircle size={24} className="mx-auto text-slate-400"/><p className="mt-3 text-xs text-fg-muted">Belum ada pesan di percakapan ini.</p></div>:messages.filter(isCachedMessage).map((message,index,all)=>{
             const mine=message.sender_id===me;
             const previous=all[index-1];
             const showDate=!previous||new Date(previous.created_at).toDateString()!==new Date(message.created_at).toDateString();
             const dateLabel=new Date(message.created_at).toLocaleDateString('id-ID',{day:'numeric',month:'long',year:'numeric'});
             const firstTicket=isTicket(selected)&&message.sender_id===selected.user_id&&index===0;
             const matches=!!messageSearch.trim()&&message.body.toLocaleLowerCase().includes(messageSearch.trim().toLocaleLowerCase());
             return <div key={message.id} data-testid="chat-message" className="space-y-2">
               {showDate&&<div className="my-4 flex items-center gap-3"><span className="h-px flex-1 bg-slate-200 dark:bg-slate-800"/><span className="rounded-full bg-slate-100 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500 dark:bg-[#0b0f19] dark:text-slate-500">{dateLabel}</span><span className="h-px flex-1 bg-slate-200 dark:bg-slate-800"/></div>}
               <div id={'chat-message-'+message.id} className={'scroll-mt-16 flex '+(mine?'justify-end':'justify-start')}>
                 {!mine&&<div className="mr-2 mt-1 shrink-0"><Avatar name={nameOf(selected,me,admin)} id={selected.user_id===me?(selected.participant_id||selected.id):selected.user_id} size={30} src={avatarOf(selected,me)}/></div>}
                 <div className={'min-w-0 max-w-[88%] [overflow-wrap:anywhere] rounded-2xl px-3.5 py-2.5 text-sm shadow-sm sm:max-w-[76%] sm:px-4 '+(mine?'rounded-br-md bg-gradient-to-r from-blue-600 to-blue-500 text-white shadow-blue-950/10':'rounded-bl-md border border-slate-200 bg-slate-100 text-slate-800 dark:border-slate-700/70 dark:bg-slate-800/90 dark:text-slate-200')+(matches?' ring-2 ring-amber-400/70':'')}>
                   {messageHidden?<div className="flex items-center gap-2 py-1 text-xs opacity-80"><Lock size={14}/> Isi pesan disembunyikan untuk privasi.</div>:firstTicket?<TicketIntro subject={selected.subject} description={selected.description}/>:<Body body={message.body} preview={url=>setPreview(url)}/>}
                    <div className="mt-1.5 flex items-center justify-end gap-1.5 text-[9px] opacity-70"><span>{formatChatTime(message.created_at)}</span>{mine&&<span title={message.id.startsWith('local-')?'Mengirim pesan':'Terkirim'}><CheckCheck size={12}/></span>}</div>
                 </div>
               </div>
             </div>;
           })}
         </div>
         {newMessages>0&&<button type="button" onClick={()=>{setNewMessages(0);if(scrollRef.current)scrollRef.current.scrollTo({top:scrollRef.current.scrollHeight,behavior:'smooth'});void markThreadRead(selected.id).catch(()=>undefined)}} className="absolute bottom-[94px] left-1/2 z-20 -translate-x-1/2 rounded-full border border-blue-500/30 bg-blue-600 px-4 py-2 text-[11px] font-semibold text-white shadow-lg shadow-blue-950/25">↓ {newMessages} pesan baru</button>}
         {selected.status==='open'&&<div onDragOver={event=>{event.preventDefault();setDrop(true)}} onDragLeave={()=>setDrop(false)} onDrop={onDrop} className={'relative z-10 shrink-0 border-t border-slate-200 bg-white/90 p-3 backdrop-blur dark:border-slate-800/80 dark:bg-[#111827]/90 sm:p-4 '+(drop?'bg-blue-500/10':'')}>
           <div className="grid w-full grid-cols-[44px_minmax(0,1fr)_44px] items-center gap-2">
             <input ref={fileRef} type="file" accept="image/jpeg,image/png,application/pdf,audio/webm,audio/ogg,audio/mp4,audio/mpeg,audio/wav" className="hidden" onChange={event=>{const file=event.target.files?.[0];if(file)void upload(file);event.currentTarget.value=''}}/>
             <button type="button" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-slate-100 text-slate-500 transition hover:bg-slate-200 hover:text-fg disabled:opacity-40 dark:border-slate-700/60 dark:bg-slate-800/70 dark:text-slate-400 dark:hover:bg-slate-700" disabled={!canSend||busy} onClick={()=>setAttachmentMenuOpen(true)} title="Lampirkan file"><Paperclip size={17}/></button>
             <textarea ref={inputRef} value={input} onChange={event=>setInput(event.target.value)} onPaste={onPaste} onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();void sendText()}}} disabled={!canSend||(admin&&isTicket(selected)&&!selected.handled_by)} placeholder={cooldownMs>0?'Chat dibatasi karena spam…':'Tulis pesan…'} className="block min-h-11 max-h-32 min-w-0 w-full resize-none rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm leading-5 text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-blue-500/60 focus:ring-2 focus:ring-blue-500/10 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-800 dark:bg-[#0b0f19] dark:text-slate-100 dark:placeholder:text-slate-500" rows={1}/>
             <button type="button" disabled={!canSend||busy||!input.trim()||(admin&&isTicket(selected)&&!selected.handled_by)} onClick={()=>void sendText()} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 text-white shadow-md shadow-blue-950/20 transition hover:from-blue-500 hover:to-indigo-500 disabled:cursor-not-allowed disabled:opacity-35" title="Kirim pesan"><Send size={17}/></button>
           </div>
           <p className="mt-2 hidden px-1 text-[9px] text-slate-400 sm:block">Enter untuk mengirim · Shift + Enter untuk baris baru · Lampiran maks. 2 MB</p>
         </div>}
         {blocked&&!isTicket(selected)&&<BlockedChatOverlay name={nameOf(selected,me,admin)} busy={blockBusy} onUnblock={()=>void toggleBlock()}/>}
         {moreOpen&&<><button type="button" onClick={()=>setMoreOpen(false)} className="absolute inset-0 z-20 cursor-default" aria-label="Tutup menu opsi"/><div className="absolute right-3 top-[58px] z-30 w-56 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
           {!isTicket(selected)&&<button type="button" onClick={()=>{setMoreOpen(false);void toggleBlock()}} className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-xs text-fg transition hover:bg-slate-100 dark:hover:bg-slate-800"><Shield size={14}/>{blocked?'Buka blokir pengguna':'Blokir pengguna'}</button>}
           {!(isTicket(selected)&&(selected.status==='open'||(!admin&&selected.rating==null)))&&<button type="button" onClick={()=>{setMoreOpen(false);void hide(selected)}} className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-xs text-rose-500 transition hover:bg-rose-500/10"><Trash2 size={14}/>Sembunyikan percakapan</button>}
           <button type="button" onClick={()=>{setMoreOpen(false);setSecurityInfoOpen(true)}} className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-xs text-fg-muted transition hover:bg-slate-100 dark:hover:bg-slate-800"><Lock size={14}/>Info keamanan</button>
         </div></>}
       </>) : (!selectedGroup ? <div className="flex flex-1 flex-col items-center justify-center p-8 text-center"><div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-500/10 text-blue-500"><Users size={26}/></div><h2 className="mt-4 text-sm font-semibold text-fg">Pilih grup</h2><p className="mt-1 max-w-xs text-xs leading-relaxed text-fg-muted">Pilih grup yang kamu ikuti untuk melihat diskusi.</p></div> : <>
         <header className="flex shrink-0 items-center gap-3 border-b border-slate-200 bg-white/70 px-3 py-3 backdrop-blur dark:border-slate-800/80 dark:bg-[#111827]/65 sm:px-5">
           <button type="button" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800 md:hidden" onClick={()=>setMobileList(true)} aria-label="Kembali ke daftar grup"><ArrowLeft size={18}/></button>
           <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-500/10 text-blue-500"><Users size={19}/></div>
           <div className="min-w-0 flex-1"><h2 className="truncate text-sm font-bold text-fg">{selectedGroup.name}</h2><p className="mt-0.5 text-[11px] text-fg-muted">{selectedGroup.member_count} anggota · {selectedGroup.group_type==='event'?'Event Group':selectedGroup.group_type==='class'?'Grup Kelas':'Grup Umum'}</p></div>
           <button type="button" title="Anggota dan pengaturan grup" className="rounded-xl p-2 text-slate-500 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800" onClick={()=>void openGroupManager()}><MoreVertical size={17}/></button>
         </header>
         <div ref={groupScrollRef} onScroll={event=>{const element=event.currentTarget;if(element.scrollTop<=30)void loadGroupOlder();if(element.scrollHeight-element.scrollTop-element.clientHeight<80&&newMessages>0)setNewMessages(0)}} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-4 sm:px-5 sm:py-5">
           {groupOlderBusy&&<p className="text-center text-[10px] text-fg-muted">Memuat pesan sebelumnya…</p>}
           {groupMessages.length===0?<div className="py-12 text-center"><Users size={24} className="mx-auto text-slate-400"/><p className="mt-3 text-xs text-fg-muted">Belum ada pesan di grup ini.</p></div>:groupMessages.map((message,index,all)=>{
             const mine=message.sender_user_id===me;
             const previous=all[index-1];
             const showDate=!previous||new Date(previous.created_at).toDateString()!==new Date(message.created_at).toDateString();
             const dateLabel=new Date(message.created_at).toLocaleDateString('id-ID',{day:'numeric',month:'long',year:'numeric'});
             return <div key={message.id} className="space-y-2">
               {showDate&&<div className="my-4 flex items-center gap-3"><span className="h-px flex-1 bg-slate-200 dark:bg-slate-800"/><span className="rounded-full bg-slate-100 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500 dark:bg-[#0b0f19] dark:text-slate-500">{dateLabel}</span><span className="h-px flex-1 bg-slate-200 dark:bg-slate-800"/></div>}
                <div className={'flex '+(mine?'justify-end':'justify-start')}><div className={'max-w-[88%] rounded-2xl px-3.5 py-2.5 text-sm shadow-sm sm:max-w-[76%] sm:px-4 '+(mine?'rounded-br-md bg-gradient-to-r from-blue-600 to-blue-500 text-white':'rounded-bl-md border border-slate-200 bg-slate-100 text-slate-800 dark:border-slate-700/70 dark:bg-slate-800/90 dark:text-slate-200')}><div className="mb-1.5 flex items-center gap-2"><span className="text-[10px] font-semibold opacity-75">{mine?'Kamu':message.sender_name}</span><Badge color="moss">{message.sender_role}</Badge></div>{messageHidden?<p className="text-xs opacity-70">Isi pesan disembunyikan untuk privasi.</p>:<Body body={message.body} preview={url=>setPreview(url)}/>}<div className="mt-1.5 flex items-center justify-end gap-1.5 text-[9px] opacity-60"><span>{formatChatTime(message.created_at)}</span>{mine&&<span title="Terkirim"><CheckCheck size={12}/></span>}</div></div></div>
             </div>;
           })}
         </div>
         {newMessages>0&&<button type="button" onClick={()=>{setNewMessages(0);if(groupScrollRef.current)groupScrollRef.current.scrollTo({top:groupScrollRef.current.scrollHeight,behavior:'smooth'});if(selectedGroup)void markChatGroupRead(selectedGroup.id).catch(()=>undefined)}} className="absolute bottom-[88px] left-1/2 z-20 -translate-x-1/2 rounded-full border border-blue-500/30 bg-blue-600 px-4 py-2 text-[11px] font-semibold text-white shadow-lg">↓ {newMessages} pesan baru</button>}
         <div className="relative z-10 shrink-0 border-t border-slate-200 bg-white/90 p-3 backdrop-blur dark:border-slate-800/80 dark:bg-[#111827]/90 sm:p-4">
           <div className="grid w-full grid-cols-[minmax(0,1fr)_44px] items-center gap-2">
             <textarea ref={groupInputRef} value={groupInput} onChange={event=>setGroupInput(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();void sendGroupText()}}} placeholder="Tulis pesan ke grup…" className="block min-h-11 max-h-32 min-w-0 w-full resize-none rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm leading-5 text-fg outline-none focus:border-blue-500/60 focus:ring-2 focus:ring-blue-500/10 dark:border-slate-800 dark:bg-[#0b0f19]" rows={1}/>
             <button type="button" disabled={groupBusy||!groupInput.trim()} onClick={()=>void sendGroupText()} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 text-white shadow-md transition disabled:opacity-35" title="Kirim pesan"><Send size={17}/></button>
           </div>
         </div>
       </>)}
     </section>
   </div>
   {ticketOpen&&<TicketForm busy={ticketBusy} onClose={()=>setTicketOpen(false)} onSubmit={createTicket}/>}
   {ratingOpen&&selected&&isTicket(selected)&&selected.status==='closed'&&!admin&&<RatingForm value={rating} busy={ticketBusy} onRate={rateTicket} onDelete={deleteAfterRating} onClose={()=>setRatingOpen(false)}/>}
   {groupCreateOpen&&<GroupCreateForm busy={groupBusy} canEvent={teacher} competitions={competitions} onClose={()=>setGroupCreateOpen(false)} onSubmit={(name,type,competitionId,joinMode)=>void createGroup(name,type,competitionId,joinMode)}/>}
   {groupManageOpen&&selectedGroup&&<GroupMembersModal group={selectedGroup} me={me} members={groupMembers} canManage={canManageGroup} busy={groupBusy} onClose={()=>setGroupManageOpen(false)} onRename={renameGroup} onInvite={inviteGroup} onAddUser={addUser} onAddParticipant={addParticipant} onRemove={removeMember}/>}
   {securityInfoOpen&&<Modal onClose={()=>setSecurityInfoOpen(false)}><div className="flex items-start justify-between gap-3"><div><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/10 text-blue-500"><Lock size={19}/></div><h3 className="mt-3 font-display text-base font-bold text-fg">Privasi & keamanan chat</h3><p className="mt-1 text-xs leading-relaxed text-fg-muted">Ringkasan kontrol yang tersedia di percakapan ini.</p></div><button type="button" onClick={()=>setSecurityInfoOpen(false)} className="rounded-lg p-2 text-fg-muted hover:bg-white/5" aria-label="Tutup informasi keamanan"><X size={16}/></button></div><div className="mt-4 space-y-3 text-xs leading-relaxed text-fg-secondary"><div className="rounded-xl border surface-border surface-elevated p-3"><p className="font-semibold text-fg">Sembunyikan isi pesan</p><p className="mt-1">Tombol gembok di header menyamarkan konten pesan pada tampilan saat ini. Ini bukan enkripsi tambahan atau kunci PIN.</p></div><div className="rounded-xl border surface-border surface-elevated p-3"><p className="font-semibold text-fg">Sematan percakapan</p><p className="mt-1">Pin disimpan pada perangkat/browser ini dan tidak tersinkron ke perangkat lain.</p></div><div className="rounded-xl border surface-border surface-elevated p-3"><p className="font-semibold text-fg">Blokir dan spam</p><p className="mt-1">Kontrol blokir dan pembatasan spam tetap menggunakan aturan backend SYKABELAJAR yang berlaku.</p></div></div><Button fullWidth className="mt-4" onClick={()=>setSecurityInfoOpen(false)}>Mengerti</Button></Modal>}
   {attachmentMenuOpen&&<Modal onClose={()=>setAttachmentMenuOpen(false)}><div className="flex items-start justify-between"><div><h3 className="font-display text-base font-bold text-fg">Lampirkan file</h3><p className="mt-1 text-xs text-fg-muted">Gambar, dokumen PDF, atau audio hingga 2 MB.</p></div><button type="button" onClick={()=>setAttachmentMenuOpen(false)} className="rounded-lg p-2 text-fg-muted hover:bg-white/5" aria-label="Tutup"><X size={16}/></button></div><div className="mt-4 grid grid-cols-3 gap-2"><button type="button" onClick={()=>chooseAttachment('image/jpeg,image/png')} className="flex flex-col items-center gap-2 rounded-xl border surface-border surface-elevated p-3 text-xs font-semibold text-fg transition hover:border-blue-500/40 hover:text-blue-500"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/10 text-blue-500"><Paperclip size={18}/></span>Gambar</button><button type="button" onClick={()=>chooseAttachment('application/pdf')} className="flex flex-col items-center gap-2 rounded-xl border surface-border surface-elevated p-3 text-xs font-semibold text-fg transition hover:border-blue-500/40 hover:text-blue-500"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-500/10 text-rose-500"><FileText size={18}/></span>Dokumen</button><button type="button" onClick={()=>chooseAttachment('audio/webm,audio/ogg,audio/mp4,audio/mpeg,audio/wav')} className="flex flex-col items-center gap-2 rounded-xl border surface-border surface-elevated p-3 text-xs font-semibold text-fg transition hover:border-blue-500/40 hover:text-blue-500"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/10 text-violet-500"><Mic size={18}/></span>Audio</button></div><p className="mt-3 text-[10px] text-fg-muted">Lampiran bersifat sementara dan mengikuti masa simpan media chat yang sudah berlaku.</p></Modal>}
   {groupInvite&&groupInvite!=='join'&&<Modal onClose={()=>setGroupInvite(null)}><div className="flex items-center justify-between"><h3 className="font-semibold text-fg">Link grup</h3><button type="button" onClick={()=>setGroupInvite(null)} className="rounded-lg p-2 text-fg-muted hover:bg-white/5"><X size={16}/></button></div><p className="mt-2 text-xs text-fg-muted">Bagikan link ini kepada anggota yang memenuhi akses grup.</p><div className="mt-3 rounded-xl border surface-border surface-elevated p-3 text-xs break-all text-fg">{groupInvite}</div><Button fullWidth className="mt-3" onClick={()=>void navigator.clipboard.writeText(groupInvite).catch(()=>toast('Clipboard tidak tersedia.','error'))}>Salin link undangan</Button></Modal>}
   {groupInvite==='join'&&<Modal onClose={()=>{setGroupInvite(null);setJoinGroupValue('')}}><div className="flex items-center justify-between"><h3 className="font-semibold text-fg">Gabung grup</h3><button type="button" onClick={()=>{setGroupInvite(null);setJoinGroupValue('')}} className="rounded-lg p-2 text-fg-muted hover:bg-white/5" aria-label="Tutup"><X size={16}/></button></div><p className="mt-1 text-xs text-fg-muted">Tempel link atau token undangan. Sistem akan memeriksa keanggotaannya sebelum bergabung.</p><input autoFocus value={joinGroupValue} onChange={event=>setJoinGroupValue(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();void joinGroupFromInput()}}} className="input mt-4 w-full" placeholder="https://sykabelajar.my.id/pesan?join_group=..."/><Button fullWidth className="mt-3" loading={groupBusy} disabled={!joinGroupValue.trim()} onClick={()=>void joinGroupFromInput()}>Gabung Grup</Button></Modal>}
   {preview&&<Modal onClose={()=>setPreview(null)}><div className="flex items-center justify-between"><h3 className="font-semibold text-fg">Pratinjau gambar</h3><button type="button" onClick={()=>setPreview(null)} className="rounded-lg p-2 text-fg-muted hover:bg-white/5"><X size={16}/></button></div><img src={preview} alt="Pratinjau lampiran" className="mt-3 max-h-[70vh] w-full rounded-xl object-contain"/></Modal>}
 </div>;
}
