import { useEffect, useState, type ReactNode } from 'react';
import { Ban, LockKeyhole, Shield } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { getChatSpamStatus, type ChatSpamStatus } from '@/services/chat.service';
import { getChatAccessStatus, type ChatAccessStatus } from '@/services/chatModeration.service';
import { useApp } from '@/store/AppContext';

const formatRemaining = (ms: number) => {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const totalMinutes = Math.floor(totalSeconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const seconds = totalSeconds % 60;

  if (totalMinutes >= 60) return `${hours}Jam : ${minutes}Menit`;
  if (minutes > 0) return `${minutes}Menit : ${String(seconds).padStart(2, '0')}Detik`;
  return `${seconds}Detik`;
};

function LockTimer({ remaining }: { remaining: number }) {
  return (
    <div className="mx-auto mt-6 rounded-2xl border surface-border surface-elevated px-5 py-4">
      <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-fg-muted">Bisa chat kembali dalam</p>
      <p className="mt-1 text-3xl font-bold tracking-tight text-fg tabular-nums">{formatRemaining(remaining)}</p>
    </div>
  );
}

function ChatLockModal({
  title,
  description,
  icon,
  remaining,
  strike,
  source,
  permanent,
}: {
  title: string;
  description: string;
  icon: ReactNode;
  remaining: number;
  strike?: number | null;
  source: 'system' | 'admin';
  permanent?: boolean;
}) {
  return (
    <div
      className="fixed inset-x-0 top-0 bottom-16 z-[240] flex items-center justify-center p-4 md:inset-y-0 md:bottom-0 md:left-[max(250px,calc((100vw-1440px)/2+250px))] xl:left-[max(270px,calc((100vw-1440px)/2+270px))]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="chat-lock-title"
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-md" />
      <div className="relative w-full max-w-md overflow-hidden rounded-3xl border surface-border surface-card-bg p-6 text-center shadow-2xl">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-red-400/20 bg-red-400/10 text-red-300">
          {icon}
        </div>
        <p id="chat-lock-title" className="mt-5 text-lg font-bold text-fg">{title}</p>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-fg-secondary">{description}</p>
        {!permanent && remaining > 0 && <LockTimer remaining={remaining} />}
        {permanent && (
          <div className="mx-auto mt-6 rounded-2xl border border-red-400/15 bg-red-400/5 px-5 py-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-red-300">Status akses</p>
            <p className="mt-1 text-base font-bold text-fg">Diblokir permanent oleh Admin</p>
          </div>
        )}
        <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-amber-400/15 bg-amber-400/10 px-3 py-1.5 text-[11px] font-medium text-amber-300">
          <Shield size={13} />
          {source === 'system'
            ? `Pelanggaran ke-${strike || 1} · sistem otomatis`
            : 'Pembatasan oleh Admin'}
        </div>
        <p className="mt-5 text-[10px] leading-5 text-fg-muted">
          Jendela chat dikunci sementara. Kamu tidak dapat memilih percakapan atau membuka chat baru sampai pembatasan berakhir.
        </p>
      </div>
    </div>
  );
}

export function ChatCooldownGate() {
  const location = useLocation();
  const { user } = useApp();
  const [spam, setSpam] = useState<ChatSpamStatus | null>(null);
  const [access, setAccess] = useState<ChatAccessStatus | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!user || location.pathname !== '/pesan') return;
    let alive = true;

    const refresh = async () => {
      const [spamResult, accessResult] = await Promise.allSettled([
        getChatSpamStatus(),
        getChatAccessStatus(),
      ]);
      if (!alive) return;
      if (spamResult.status === 'fulfilled') setSpam(spamResult.value);
      if (accessResult.status === 'fulfilled') setAccess(accessResult.value);
    };

    void refresh();
    const poll = window.setInterval(() => void refresh(), 5000);
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      alive = false;
      window.clearInterval(poll);
      window.clearInterval(tick);
    };
  }, [location.pathname, user?.id]);

  if (!user || location.pathname !== '/pesan') return null;

  const accessRemaining = access?.blocked_until
    ? Math.max(0, new Date(access.blocked_until).getTime() - now)
    : 0;
  const spamRemaining = spam?.blocked_until
    ? Math.max(0, new Date(spam.blocked_until).getTime() - now)
    : 0;

  if (access?.blocked) {
    const isAutomatic = !access.blocked_by;
    return (
      <ChatLockModal
        title={access.is_permanent ? 'Akses chat dinonaktifkan' : 'Chat dikunci sementara'}
        description={
          isAutomatic
            ? 'Aktivitas chat terlalu cepat terdeteksi sebagai spam. Demi menjaga kualitas layanan, akses chat dikunci sementara.'
            : access.reason || 'Akses chat kamu diblokir oleh Admin. Fitur lain SYKABELAJAR tetap dapat digunakan seperti biasa.'
        }
        icon={isAutomatic ? <LockKeyhole size={25} /> : <Ban size={25} />}
        remaining={accessRemaining}
        strike={access.strike_level}
        source={isAutomatic ? 'system' : 'admin'}
        permanent={access.is_permanent}
      />
    );
  }

  if (spamRemaining > 0) {
    return (
      <ChatLockModal
        title="Chat dikunci sementara"
        description="Aktivitas chat terlalu cepat terdeteksi sebagai spam. Demi menjaga kualitas layanan, akses chat dikunci sementara."
        icon={<LockKeyhole size={25} />}
        remaining={spamRemaining}
        strike={spam?.strike_count}
        source="system"
      />
    );
  }

  return null;
}
