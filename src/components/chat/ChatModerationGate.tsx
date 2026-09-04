import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Ban, CheckCircle2, ChevronDown, ChevronUp, Clock3, LockKeyhole, MessageCircle, Search, Shield, ShieldOff, UserRound } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { getChatSpamStatus, type ChatSpamStatus } from '@/services/chat.service';
import { adminSearchChatUsers, adminSetChatUserBlock, getChatAccessStatus, type ChatModerationUser } from '@/services/chatModeration.service';
import { useApp } from '@/store/AppContext';

const formatRemaining = (ms: number) => {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0
    ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

function ChatLockModal({ title, description, icon, countdown, strike }: { title: string; description: string; icon: ReactNode; countdown?: string; strike?: number }) {
  return (
    <div className="fixed inset-0 z-[240] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="chat-lock-title">
      <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-md" />
      <div className="relative w-full max-w-md overflow-hidden rounded-3xl border border-white/10 bg-slate-900/95 p-6 text-center shadow-2xl shadow-black/40">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-moss-400/20 bg-moss-400/10 text-moss-300">{icon}</div>
        <p id="chat-lock-title" className="mt-5 text-lg font-bold text-white">{title}</p>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-slate-300">{description}</p>
        {countdown && <div className="mx-auto mt-6 rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-4"><p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-400">Bisa chat kembali dalam</p><p className="mt-1 font-mono text-4xl font-bold tracking-tight text-white">{countdown}</p></div>}
        {typeof strike === 'number' && strike > 0 && <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-amber-400/15 bg-amber-400/10 px-3 py-1.5 text-[11px] font-medium text-amber-200"><Shield size={13} /> Pelanggaran ke-{strike} · pembatasan bertahap</div>}
        <p className="mt-5 text-[10px] leading-5 text-slate-500">Jendela chat sementara dikunci. Kamu tidak dapat memilih percakapan atau membuka chat baru sampai pembatasan berakhir.</p>
      </div>
    </div>
  );
}

export function ChatCooldownGate() {
  const location = useLocation();
  const { user } = useApp();
  const [spam, setSpam] = useState<ChatSpamStatus | null>(null);
  const [accessBlocked, setAccessBlocked] = useState(false);
  const [accessReason, setAccessReason] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!user || location.pathname !== '/pesan') return;
    let alive = true;
    const refresh = async () => {
      const [spamResult, accessResult] = await Promise.allSettled([getChatSpamStatus(), getChatAccessStatus()]);
      if (!alive) return;
      if (spamResult.status === 'fulfilled') setSpam(spamResult.value);
      if (accessResult.status === 'fulfilled') {
        setAccessBlocked(accessResult.value.blocked);
        setAccessReason(accessResult.value.reason);
      }
    };
    void refresh();
    const poll = window.setInterval(() => void refresh(), 5000);
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { alive = false; window.clearInterval(poll); window.clearInterval(tick); };
  }, [location.pathname, user?.id]);

  const remaining = spam?.blocked_until ? Math.max(0, new Date(spam.blocked_until).getTime() - now) : 0;
  if (!user || location.pathname !== '/pesan') return null;
  if (accessBlocked) return <ChatLockModal title="Akses chat dinonaktifkan" description={accessReason || 'Akses chat kamu sementara diblokir oleh Admin. Hubungi Admin melalui kanal bantuan lain jika membutuhkan bantuan.'} icon={<Ban size={25} />} />;
  if (remaining > 0) return <ChatLockModal title="Chat dikunci sementara" description="Aktivitas chat terlalu cepat terdeteksi sebagai spam. Demi menjaga kualitas layanan, akses chat dikunci sementara." icon={<LockKeyhole size={25} />} countdown={formatRemaining(remaining)} strike={spam?.strike_count} />;
  return null;
}

export function ChatAdminModerationPanel() {
  const location = useLocation();
  const { user, toast } = useApp();
  const isAdmin = user?.role === 'admin';
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [reason, setReason] = useState('');
  const [rows, setRows] = useState<ChatModerationUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    if (!isAdmin) return;
    setLoading(true);
    try { setRows(await adminSearchChatUsers(search, 30)); }
    catch (error) { toast(error instanceof Error ? error.message : 'Gagal memuat pengguna.', 'error'); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    if (!isAdmin || location.pathname !== '/admin/chat' || !open) return;
    const timer = window.setTimeout(() => void load(), 220);
    return () => window.clearTimeout(timer);
  }, [isAdmin, location.pathname, open, search]);

  const blockedCount = useMemo(() => rows.filter(row => row.chat_blocked).length, [rows]);

  if (!isAdmin || location.pathname !== '/admin/chat') return null;

  const toggle = async (row: ChatModerationUser) => {
    if (busyId) return;
    setBusyId(row.id);
    try {
      await adminSetChatUserBlock(row.id, !row.chat_blocked, reason);
      setRows(current => current.map(item => item.id === row.id ? { ...item, chat_blocked: !row.chat_blocked } : item));
      setReason('');
      toast(row.chat_blocked ? 'Akses chat pengguna dibuka kembali.' : 'Pengguna diblokir dari fitur chat.', 'success');
    } catch (error) { toast(error instanceof Error ? error.message : 'Moderasi chat gagal.', 'error'); }
    finally { setBusyId(null); }
  };

  return (
    <div className="fixed right-5 top-20 z-[180] w-[min(390px,calc(100vw-2rem))]">
      {!open ? (
        <button onClick={() => setOpen(true)} className="ml-auto flex items-center gap-2 rounded-2xl border border-white/10 bg-slate-900/90 px-4 py-3 text-xs font-semibold text-white shadow-xl shadow-black/20 backdrop-blur-md transition hover:-translate-y-0.5 hover:border-moss-400/30">
          <Shield size={15} className="text-moss-300" /> Moderasi Chat <ChevronDown size={15} className="text-slate-400" />
        </button>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-white/10 bg-slate-900/95 shadow-2xl shadow-black/30 backdrop-blur-xl">
          <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-moss-400/10 text-moss-300"><Shield size={16} /></div>
            <div className="min-w-0 flex-1"><p className="text-sm font-semibold text-white">Moderasi Chat</p><p className="text-[10px] text-slate-400">Blokir / buka akses chat pengguna secara global.</p></div>
            <button onClick={() => setOpen(false)} className="rounded-lg p-1.5 text-slate-400 hover:bg-white/5 hover:text-white" aria-label="Tutup"><ChevronUp size={16} /></button>
          </div>
          <div className="border-b border-white/10 p-3">
            <div className="relative"><Search size={14} className="absolute left-3 top-3 text-slate-500" /><input value={search} onChange={event => setSearch(event.target.value)} className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-9 py-2.5 text-xs text-white outline-none placeholder:text-slate-500 focus:border-moss-400/40" placeholder="Cari nama atau username..." /></div>
            <div className="mt-2 flex items-center justify-between"><span className="text-[10px] text-slate-500">{rows.length} pengguna · {blockedCount} diblokir</span><button onClick={() => void load()} className="text-[10px] font-medium text-moss-300 hover:text-moss-200">Muat ulang</button></div>
            <input value={reason} onChange={event => setReason(event.target.value)} className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-[11px] text-white outline-none placeholder:text-slate-500" placeholder="Alasan blokir (opsional)" />
          </div>
          <div className="max-h-[54vh] overflow-y-auto p-2">
            {loading ? <div className="flex items-center justify-center py-10 text-xs text-slate-500"><Clock3 size={14} className="mr-2" /> Memuat pengguna…</div> : rows.length === 0 ? <div className="py-10 text-center text-xs text-slate-500"><UserRound size={17} className="mx-auto mb-2" />Tidak ada pengguna ditemukan.</div> : rows.map(row => (
              <div key={row.id} className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-white/[0.03]">
                <Avatar name={row.full_name || row.username || 'User'} id={row.id} size={34} src={row.avatar_url || undefined} />
                <div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold text-white">{row.full_name || 'User'}</p><p className="truncate text-[10px] text-slate-500">@{row.username || 'user'} {row.chat_blocked ? '· Chat diblokir' : ''}</p></div>
                <Button size="sm" variant={row.chat_blocked ? 'primary' : 'outline'} disabled={busyId === row.id} icon={row.chat_blocked ? <CheckCircle2 size={13} /> : <ShieldOff size={13} />} onClick={() => void toggle(row)}>{row.chat_blocked ? 'Buka' : 'Blokir'}</Button>
              </div>
            ))}
          </div>
          <div className="border-t border-white/10 px-4 py-2.5 text-[9px] leading-4 text-slate-500">Blokir ini berlaku untuk fitur chat platform, bukan untuk akun atau fitur SYKABELAJAR lainnya.</div>
        </div>
      )}
    </div>
  );
}
