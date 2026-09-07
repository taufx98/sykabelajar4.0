import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Link2, MessageCircle, Send, Users } from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Avatar } from '@/components/ui/Avatar';
import type { ChatGroup, ChatGroupMember, ChatGroupMessage } from '@/services/chat.service';
import {
  joinCollectiveChatGroup,
  listCollectiveChatGroupMembers,
  listCollectiveChatGroups,
  loadCollectiveChatGroupMessages,
  markCollectiveChatGroupRead,
  sendCollectiveChatGroupMessage,
  subscribeCollectiveGroupChat,
} from '@/services/collectiveGroupChat.service';
import { toast } from '@/lib/toast';

const PAGE = 50;
const ACCESS_KEY = 'syka_collective_access_token';

function readParticipant() {
  try {
    return JSON.parse(sessionStorage.getItem('syka_collective_participant') || 'null') as Record<string, unknown> | null;
  } catch {
    return null;
  }
}

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

function mapRealtimeMessage(row: ChatGroupMessage, members: ChatGroupMember[]) {
  const member = row.sender_collective_participant_id
    ? members.find((item) => item.collective_participant_id === row.sender_collective_participant_id)
    : row.sender_user_id
      ? members.find((item) => item.user_id === row.sender_user_id)
      : null;
  return {
    ...row,
    sender_name: row.sender_collective_participant_id ? member?.display_name || 'Peserta' : member?.display_name || 'Pengguna',
    sender_role: row.sender_collective_participant_id ? 'PESERTA' : member?.member_role || 'MEMBER',
  } as ChatGroupMessage;
}

export function CollectiveMessagesPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const accessToken = sessionStorage.getItem(ACCESS_KEY) || '';
  const participant = useMemo(() => readParticipant(), []);
  const participantId = String(participant?.participant_id || '');
  const [groups, setGroups] = useState<ChatGroup[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<ChatGroup | null>(null);
  const [messages, setMessages] = useState<ChatGroupMessage[]>([]);
  const [members, setMembers] = useState<ChatGroupMember[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [olderBusy, setOlderBusy] = useState(false);
  const [hasOlder, setHasOlder] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [mobileList, setMobileList] = useState(true);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const loadGroups = useCallback(async () => {
    if (!accessToken) {
      navigate('/peserta-kolektif/login', { replace: true });
      return [];
    }
    try {
      const rows = await listCollectiveChatGroups(accessToken);
      setGroups(rows);
      return rows;
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'Gagal memuat group.');
      navigate('/peserta-kolektif/login', { replace: true });
      return [];
    } finally {
      setLoading(false);
    }
  }, [accessToken, navigate]);

  useEffect(() => {
    if (!accessToken) {
      navigate('/peserta-kolektif/login', { replace: true });
      return;
    }
    void loadGroups();
  }, [accessToken, loadGroups, navigate]);

  useEffect(() => {
    const inviteToken = params.get('join_group')?.trim();
    if (!inviteToken || !accessToken) return;
    let alive = true;
    void joinCollectiveChatGroup(accessToken, inviteToken)
      .then(async (result) => {
        if (!alive || !result.ok) return;
        const rows = await loadGroups();
        const target = rows.find((group) => group.id === result.group_id) || null;
        if (target) {
          setSelectedGroup(target);
          setMobileList(false);
        }
        toast.success('Berhasil bergabung ke group.');
      })
      .catch((error: unknown) => {
        if (alive) toast.error(error instanceof Error ? error.message : 'Link group tidak valid.');
      })
      .finally(() => {
        if (!alive) return;
        const next = new URLSearchParams(params);
        next.delete('join_group');
        setParams(next, { replace: true });
      });
    return () => { alive = false; };
  }, [accessToken, loadGroups, params, setParams]);

  useEffect(() => {
    if (!selectedGroup || !accessToken) return;
    let alive = true;
    setMessages([]);
    setMembers([]);
    void Promise.all([
      loadCollectiveChatGroupMessages(accessToken, selectedGroup.id, PAGE),
      listCollectiveChatGroupMembers(accessToken, selectedGroup.id),
    ]).then(([rows, memberRows]) => {
      if (!alive) return;
      setMessages(rows);
      setMembers(memberRows);
      setHasOlder(rows.length >= PAGE);
      void markCollectiveChatGroupRead(accessToken, selectedGroup.id).catch(() => undefined);
      setGroups((current) => current.map((group) => group.id === selectedGroup.id ? { ...group, unread_count: 0 } : group));
      requestAnimationFrame(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; });
    }).catch((error: unknown) => {
      if (alive) toast.error(error instanceof Error ? error.message : 'Gagal memuat pesan group.');
    });
    const unsubscribePromise = subscribeCollectiveGroupChat({
      groupId: selectedGroup.id,
      accessToken,
      onInsert: (row) => {
        if (!alive) return;
        const message = mapRealtimeMessage(row, members);
        setMessages((current) => current.some((item) => item.id === message.id) ? current : [...current, message]);
        setGroups((current) => current.map((group) => group.id === selectedGroup.id ? { ...group, last_message: message.body, last_message_at: message.created_at, unread_count: 0 } : group));
        requestAnimationFrame(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; });
      },
      onError: () => undefined,
    });
    return () => {
      alive = false;
      void unsubscribePromise.then((unsubscribe) => unsubscribe());
    };
  }, [accessToken, selectedGroup?.id]);

  const chooseGroup = async (group: ChatGroup) => {
    setSelectedGroup(group);
    setInput('');
    setMobileList(false);
    await markCollectiveChatGroupRead(accessToken, group.id).catch(() => undefined);
    setGroups((current) => current.map((item) => item.id === group.id ? { ...item, unread_count: 0 } : item));
  };

  const send = async () => {
    const body = input.trim();
    if (!body || !selectedGroup || busy) return;
    setBusy(true);
    try {
      const saved = await sendCollectiveChatGroupMessage(accessToken, selectedGroup.id, body);
      setInput('');
      const member = members.find((item) => item.collective_participant_id === participantId);
      const normalized = { ...saved, sender_name: member?.display_name || String(participant?.full_name || 'Peserta'), sender_role: 'PESERTA' };
      setMessages((current) => current.some((item) => item.id === normalized.id) ? current : [...current, normalized]);
      setGroups((current) => current.map((group) => group.id === selectedGroup.id ? { ...group, last_message: body, last_message_at: normalized.created_at } : group));
      requestAnimationFrame(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; });
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'Pesan gagal dikirim.');
    } finally {
      setBusy(false);
    }
  };

  const loadOlder = async () => {
    if (!selectedGroup || olderBusy || !hasOlder || !messages.length) return;
    const element = scrollRef.current;
    if (!element) return;
    setOlderBusy(true);
    const height = element.scrollHeight;
    try {
      const rows = await loadCollectiveChatGroupMessages(accessToken, selectedGroup.id, PAGE, messages[0].created_at);
      if (!rows.length) { setHasOlder(false); return; }
      setMessages((current) => [...rows, ...current].filter((item, index, all) => all.findIndex((x) => x.id === item.id) === index).sort((a, b) => a.created_at.localeCompare(b.created_at)));
      requestAnimationFrame(() => { element.scrollTop = element.scrollHeight - height; });
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'Gagal memuat pesan lama.');
    } finally {
      setOlderBusy(false);
    }
  };

  const backPath = '/peserta-kolektif';

  return <div className="h-[calc(100vh-56px)] md:h-screen overflow-hidden surface-bg p-2 md:p-4">
    <div className="h-full max-w-7xl mx-auto flex flex-col">
      <div className="shrink-0 flex items-center justify-between pb-2">
        <Link to={backPath} className="inline-flex items-center gap-2 text-xs text-fg-muted"><ArrowLeft size={14}/>Portal Peserta</Link>
        <div className="flex items-center gap-2 text-xs text-fg-muted"><Avatar name={String(participant?.full_name || 'Peserta')} id={participantId || 'collective'} size={30} src={participant?.photo_url ? String(participant.photo_url) : undefined}/><span className="hidden sm:block">{String(participant?.full_name || 'Peserta')}</span></div>
      </div>
      <div className="shrink-0 flex items-center gap-3 pb-3"><MessageCircle size={21} className="text-accent"/><h1 className="text-xl font-bold text-fg">Pesan</h1><Badge color="moss">{groups.length} group</Badge></div>
      <div className="flex-1 min-h-0 grid md:grid-cols-[320px_1fr] rounded-2xl overflow-hidden border surface-border surface-card-bg">
        <aside className={`${mobileList ? 'flex' : 'hidden'} md:flex flex-col min-h-0 border-r surface-border`}>
          <div className="p-3 border-b surface-border">
            <div className="grid grid-cols-2 rounded-xl bg-black/10 p-1 gap-1">
              <button type="button" disabled className="rounded-lg px-3 py-2 text-xs font-semibold text-fg-muted opacity-50 cursor-not-allowed" title="Peserta kolektif hanya dapat menggunakan chat grup">Chat Pribadi</button>
              <button type="button" className="rounded-lg px-3 py-2 text-xs font-semibold bg-white/10 text-fg shadow-sm">Chat Grup</button>
            </div>
            <div className="mt-3 flex justify-end"><Button size="sm" variant="outline" onClick={() => setJoinOpen(true)} icon={<Link2 size={14}/>}>Gabung Group</Button></div>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {loading ? <p className="py-10 text-center text-xs text-fg-muted">Memuat group…</p> : groups.length ? groups.map((group) => <button key={group.id} type="button" onClick={() => void chooseGroup(group)} className={`w-full text-left flex items-center gap-3 p-3 rounded-xl border ${selectedGroup?.id === group.id ? 'border-moss-500/50 bg-moss-500/10' : 'border-transparent hover:bg-white/5'}`}><div className="w-9 h-9 rounded-xl bg-accent/10 text-accent flex items-center justify-center shrink-0"><Users size={17}/></div><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><p className="text-sm font-medium text-fg truncate">{group.name}</p>{group.unread_count > 0 && <span className="min-w-5 h-5 rounded-full bg-red-500 text-white text-[9px] flex items-center justify-center">{group.unread_count > 99 ? '99+' : group.unread_count}</span>}</div><p className="text-[10px] text-fg-muted truncate">{group.member_count} anggota · {group.last_message || 'Belum ada pesan'}</p></div></button>) : <div className="py-10 text-center px-4"><p className="text-sm text-fg-muted">Belum ada group.</p><p className="text-xs text-fg-muted mt-1">Gunakan link undangan dari Guru untuk bergabung.</p></div>}
          </div>
        </aside>
        <section className={`${mobileList ? 'hidden' : 'flex'} md:flex flex-col min-h-0 min-w-0 relative`}>
          {!selectedGroup ? <div className="flex-1 flex items-center justify-center text-sm text-fg-muted">Pilih group.</div> : <>
            <header className="shrink-0 p-3 border-b surface-border flex items-center gap-3"><button type="button" className="md:hidden p-2 rounded-lg hover:bg-white/5" onClick={() => setMobileList(true)}><ArrowLeft size={18}/></button><div className="w-10 h-10 rounded-xl bg-accent/10 text-accent flex items-center justify-center"><Users size={18}/></div><div className="min-w-0 flex-1"><p className="text-sm font-semibold text-fg truncate">{selectedGroup.name}</p><p className="text-[11px] text-fg-muted truncate">{selectedGroup.member_count} anggota · {selectedGroup.group_type === 'event' ? 'Event Group' : selectedGroup.group_type === 'class' ? 'Group Kelas' : 'Group Umum'}</p></div></header>
            <div ref={scrollRef} onScroll={(event) => { if (event.currentTarget.scrollTop <= 30) void loadOlder(); }} className="flex-1 overflow-y-auto p-4 space-y-3">{olderBusy && <p className="text-[10px] text-fg-muted text-center">Memuat pesan lama…</p>}{messages.length ? messages.map((message) => { const mine = message.sender_collective_participant_id === participantId; return <div key={message.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}><div className={`max-w-[78%] rounded-2xl px-4 py-2.5 text-sm ${mine ? 'bg-moss-600 text-white rounded-br-sm' : 'surface-elevated text-fg rounded-bl-sm'}`}><div className="flex items-center gap-2 mb-1"><span className="text-[10px] font-semibold opacity-75">{mine ? 'Kamu' : message.sender_name}</span><Badge color="moss">{message.sender_role}</Badge></div><p className="whitespace-pre-wrap break-words">{message.body}</p><p className="text-[9px] mt-1 opacity-60 text-right">{formatTime(message.created_at)}</p></div></div>; }) : <p className="text-sm text-fg-muted text-center py-10">Belum ada pesan.</p>}</div>
            <div className="shrink-0 p-3 border-t surface-border"><div className="flex items-end gap-2"><textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send(); } }} placeholder="Tulis pesan ke group…" maxLength={2000} className="input flex-1 min-h-[42px] max-h-32 resize-none" rows={1}/><button type="button" className="p-2.5 rounded-xl bg-moss-600 text-white disabled:opacity-40" disabled={busy || !input.trim()} onClick={() => void send()}><Send size={17}/></button></div></div>
          </>}
        </section>
      </div>
    </div>
    {joinOpen && <div className="fixed inset-0 z-[170] flex items-center justify-center p-4"><button type="button" className="absolute inset-0 bg-black/70" onClick={() => setJoinOpen(false)}/><div className="relative w-full max-w-md card p-5"><h3 className="font-semibold text-fg">Gabung Group</h3><p className="text-xs text-fg-muted mt-1">Tempel link undangan dari Guru.</p><input autoFocus className="input w-full mt-4" placeholder="https://sykabelajar.my.id/pesan?join_group=…" onKeyDown={(event) => { if (event.key !== 'Enter') return; const raw = event.currentTarget.value.trim(); if (!raw) return; try { const url = new URL(raw); const token = url.searchParams.get('join_group') || ''; if (token) { void joinCollectiveChatGroup(accessToken, token).then(async (result) => { const rows = await loadGroups(); if (result.ok) { const target = rows.find((group) => group.id === result.group_id) || null; if (target) { setSelectedGroup(target); setMobileList(false); } setJoinOpen(false); toast.success('Berhasil bergabung ke group.'); } }); return; } } catch { /* raw token */ } if (raw.length > 20) { void joinCollectiveChatGroup(accessToken, raw).then(async (result) => { const rows = await loadGroups(); if (result.ok) { const target = rows.find((group) => group.id === result.group_id) || null; if (target) { setSelectedGroup(target); setMobileList(false); } setJoinOpen(false); toast.success('Berhasil bergabung ke group.'); } }).catch((error: unknown) => toast.error(error instanceof Error ? error.message : 'Undangan tidak valid.')); } }} /><div className="flex justify-end mt-4"><Button variant="ghost" onClick={() => setJoinOpen(false)}>Tutup</Button></div></div></div>}
  </div>;
}
