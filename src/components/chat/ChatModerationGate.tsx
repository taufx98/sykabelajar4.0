import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Ban, CheckCircle2, Clock3, LockKeyhole, Search, Shield, ShieldOff, UserRound } from 'lucide-react';
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
  return h > 0 ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

function ChatLockModal({ title, description, icon, countdown, strike }: { title: string; description: string; icon: ReactNode; countdown?: string; strike?: number }) {
  return <div className="fixed inset-0 z-[240] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="chat-lock-title">
    <div className="absolute inset-0 bg-black/60 backdrop-blur-md" />
    <div className="relative w-full max-w-md overflow-hidden rounded-3xl border surface-border surface-card-bg p-6 text-center shadow-2xl">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-moss-400/20 bg-moss-400/10 text-moss-300">{icon}</div>
      <p id="chat-lock-title" className="mt-5 text-lg font-bold text-fg">{title}</p>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-fg-secondary">{description}</p>
      {countdown && <div className="mx-auto mt-6 rounded-2xl border surface-border surface-elevated px-5 py-4"><p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-fg-muted">Bisa chat kembali dalam</p><p className="mt-1 font-mono text-4xl font-bold tracking-tight text-fg">{countdown}</p></div>}
      {typeof strike === 'number' && strike > 0 && <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-amber-400/15 bg-amber-400/10 px-3 py-1.5 text-[11px] font-medium text-amber-300"><Shield size={13} /> Pelanggaran ke-{strike} · pembatasan bertahap</div>}
      <p className="mt-5 text-[10px] leading-5 text-fg-muted">Jendela chat dikunci sementara. Kamu tidak dapat memilih percakapan atau membuka chat baru sampai pembatasan berakhir.</p>
    </div>
  </div>;
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
      if (accessResult.status === 'fulfilled') { setAccessBlocked(accessResult.value.blocked); setAccessReason(accessResult.value.reason); }
    };
    void refresh();
    const poll = window.setInterval(() => void refresh(), 5000);
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { alive = false; window.clearInterval(poll); window.clearInterval(tick); };
  }, [location.pathname, user?.id]);

  const remaining = spam?.blocked_until ? Math.max(0, new Date(spam.blocked_until).getTime() - now) : 0;
  if (!user || location.pathname !== '/pesan') return null;
  if (accessBlocked) return <ChatLockModal title="Akses chat dinonaktifkan" description={accessReason || 'Akses chat kamu diblokir oleh Admin. Fitur lain SYKABELAJAR tetap dapat digunakan seperti biasa.'} icon={<Ban size={25} />} />;
  if (remaining > 0) return <ChatLockModal title="Chat dikunci sementara" description="Aktivitas chat terlalu cepat terdeteksi sebagai spam. Demi menjaga kualitas layanan, akses chat dikunci sementara." icon={<LockKeyhole size={25} />} countdown={formatRemaining(remaining)} strike={spam?.strike_count} />;
  return null;
}

function findAdminChatTabRow() {
  const historyButton = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent?.trim() === 'History Chat & Rating');
  return historyButton?.parentElement ?? null;
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
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [contentHost, setContentHost] = useState<HTMLElement | null>(null);

  const load = async () => {
    if (!isAdmin) return;
    setLoading(true);
    try { setRows(await adminSearchChatUsers(search, 30)); }
    catch (error) { toast(error instanceof Error ? error.message : 'Gagal memuat pengguna.', 'error'); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    if (!isAdmin || location.pathname !== '/admin/chat') { setHost(null); setContentHost(null); return; }
    const sync = () => { const row = findAdminChatTabRow(); setHost(row); setContentHost(row?.parentElement ?? null); };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => { observer.disconnect(); setHost(null); setContentHost(null); };
  }, [isAdmin, location.pathname]);

  useEffect(() => {
    if (!isAdmin || location.pathname !== '/admin/chat' || !open) return;
    const timer = window.setTimeout(() => void load(), 180);
    return () => window.clearTimeout(timer);
  }, [isAdmin, location.pathname, open, search]);

  useEffect(() => {
    if (!contentHost) return;
    const nativeContent = contentHost.lastElementChild as HTMLElement | null;
    if (nativeContent && nativeContent !== host) nativeContent.style.display = open ? 'none' : '';
    return () => { if (nativeContent && nativeContent !== host) nativeContent.style.display = ''; };
  }, [contentHost, host, open]);

  const blockedCount = useMemo(() => rows.filter(row => row.chat_blocked).length, [rows]);
  if (!isAdmin || location.pathname !== '/admin/chat' || !host || !contentHost) return null;

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

  const tabClass = (active: boolean) => `border-b-2 px-4 py-2 text-sm font-medium ${active ? 'border-moss-500 text-fg' : 'border-transparent text-fg-muted'}`;
  return createPortal(<>
    <button type="button" onClick={() => setOpen(value => !value)} className={tabClass(open)} aria-pressed={open}>Moderasi Chat</button>
    {open && createPortal(
      <div className="flex flex-1 min-h-0 flex-col rounded-2xl border surface-border surface-card-bg overflow-hidden">
        <div className="flex items-center justify-between border-b surface-border px-4 py-3">
          <div className="flex items-center gap-3"><div className="flex h-9 w-9 items-center justify-center rounded-xl bg-moss-400/10 text-moss-300"><Shield size={16} /></div><div><p className="text-sm font-semibold text-fg">Moderasi Chat</p><p className="text-[10px] text-fg-muted">Kelola siapa yang boleh menggunakan fitur chat.</p></div></div>
          <span className="rounded-full border border-moss-400/15 bg-moss-400/10 px-3 py-1 text-[10px] font-medium text-moss-300">{blockedCount} diblokir</span>
        </div>
        <div className="grid shrink-0 gap-2 border-b surface-border p-3 md:grid-cols-[1fr_1fr_auto]">
          <div className="relative"><Search size={14} className="absolute left-3 top-3 text-fg-muted" /><input value={search} onChange={event => setSearch(event.target.value)} className="input w-full pl-9" placeholder="Cari nama atau username..." /></div>
          <input value={reason} onChange={event => setReason(event.target.value)} className="input w-full text-[11px]" placeholder="Alasan blokir (opsional)" />
          <Button variant="outline" onClick={() => void load()} icon={<Shield size={14} />}>Muat ulang</Button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-2">
          {loading ? <div className="flex items-center justify-center py-14 text-xs text-fg-muted"><Clock3 size={14} className="mr-2" /> Memuat pengguna…</div> : rows.length === 0 ? <div className="py-14 text-center text-xs text-fg-muted"><UserRound size={18} className="mx-auto mb-2" />Tidak ada pengguna ditemukan.</div> : rows.map(row => <div key={row.id} className="flex items-center gap-3 rounded-xl px-3 py-3 hover:bg-white/[0.03]"><Avatar name={row.full_name || row.username || 'User'} id={row.id} size={38} src={row.avatar_url || undefined} /><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-fg">{row.full_name || 'User'}</p><p className="truncate text-[10px] text-fg-muted">@{row.username || 'user'}</p>{row.chat_blocked && <span className="mt-1 inline-flex text-[9px] font-medium text-red-300"><ShieldOff size={11} className="mr-1" /> Chat diblokir</span>}</div><Button size="sm" variant={row.chat_blocked ? 'primary' : 'outline'} disabled={busyId === row.id} icon={row.chat_blocked ? <CheckCircle2 size={13} /> : <ShieldOff size={13} />} onClick={() => void toggle(row)}>{row.chat_blocked ? 'Buka Akses' : 'Blokir Chat'}</Button></div>)}
        </div>
        <div className="border-t surface-border px-4 py-2.5 text-[9px] leading-4 text-fg-muted">Moderasi ini hanya memengaruhi fitur chat. Akun dan fitur SYKABELAJAR lainnya tidak ikut diblokir.</div>
      </div>,
      contentHost,
    )}
  </>, host);
}
