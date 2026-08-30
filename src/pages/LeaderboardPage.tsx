import { useEffect, useState, useMemo } from 'react';
import { TrendingUp, ChevronLeft, ChevronRight, Crown, Medal, Search } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card } from '@/components/ui/Card';
import { Avatar } from '@/components/ui/Avatar';
import { getPublicLeaderboard, type PublicLeaderboardRow } from '@/services/platform.service';
import { supabase } from '@/lib/supabase';
import { useApp } from '@/store/AppContext';

type Mode = 'xp' | 'coin';
type CoinRow = { user_id: string; username: string; display_name: string; institution: string | null; avatar_url: string | null; edu_coin: number; rank: number };

const GRADES = [
  { key: 'all', label: 'Semua' },
  { key: 'sd', label: 'SD', children: ['1','2','3','4','5','6'] },
  { key: 'smp', label: 'SMP', children: ['7','8','9'] },
  { key: 'sma', label: 'SMA', children: ['10','11','12'] },
];

const PER_PAGE = 10;
const MAX_RANK = 100;

const RANK_STYLES = {
  1: {
    ring: 'ring-4 ring-amber-400/80',
    crown: 'text-amber-400',
    crownBg: 'bg-amber-500/20',
    card: 'border-amber-400/40',
    cardBg: 'bg-gradient-to-b from-amber-500/8 to-surface-card',
    glow: 'shadow-[0_0_20px_rgba(245,158,11,0.15)]',
    nameColor: 'text-fg',
    scoreBg: 'bg-amber-500',
    scoreText: 'text-white',
    label: '🥇',
  },
  2: {
    ring: 'ring-4 ring-slate-300/50',
    crown: 'text-slate-300',
    crownBg: 'bg-slate-400/15',
    card: 'border-slate-300/25',
    cardBg: 'bg-surface-card',
    glow: '',
    nameColor: 'text-fg',
    scoreBg: 'bg-slate-400/20',
    scoreText: 'text-fg',
    label: '🥈',
  },
  3: {
    ring: 'ring-4 ring-orange-400/50',
    crown: 'text-orange-400',
    crownBg: 'bg-orange-500/15',
    card: 'border-orange-400/25',
    cardBg: 'bg-surface-card',
    glow: '',
    nameColor: 'text-fg',
    scoreBg: 'bg-orange-500/15',
    scoreText: 'text-fg',
    label: '🥉',
  },
} as const;

export function LeaderboardPage() {
  const { user } = useApp();
  const [mode, setMode] = useState<Mode>('xp');
  const [grade, setGrade] = useState('all');
  const [subGrade, setSubGrade] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [entries, setEntries] = useState<PublicLeaderboardRow[]>([]);
  const [coins, setCoins] = useState<CoinRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true); setError('');
      try {
        if (mode === 'xp') {
          const rows = await getPublicLeaderboard(MAX_RANK);
          if (active) setEntries(rows);
        } else {
          const { data, error: rpcErr } = await supabase.rpc('get_public_coin_leaderboard', { p_limit: MAX_RANK });
          if (rpcErr) throw rpcErr;
          if (active) setCoins(((data ?? []) as any[]).map(r => ({
            user_id: String(r.user_id), username: String(r.username ?? ''),
            display_name: String(r.display_name ?? r.username ?? 'Pengguna'),
            institution: r.institution == null ? null : String(r.institution),
            avatar_url: r.avatar_url == null ? null : String(r.avatar_url),
            edu_coin: Number(r.edu_coin ?? 0), rank: Number(r.rank ?? 0),
          })));
        }
      } catch (e: any) {
        if (active) { setError(e?.message ?? 'Gagal memuat.'); setEntries([]); setCoins([]); }
      } finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [mode]);

  const allRows = useMemo(() => {
    const rows = mode === 'xp' ? entries : (coins as any[]);
    if (grade === 'all' && !subGrade) return rows;
    if (subGrade) return rows.filter((r: any) => (r.institution || '').toLowerCase().includes(subGrade.toLowerCase()));
    const gradeMap: Record<string, string[]> = {
      sd: ['SD', 'Sekolah Dasar', '1', '2', '3', '4', '5', '6'],
      smp: ['SMP', 'Sekolah Menengah Pertama', '7', '8', '9'],
      sma: ['SMA', 'SMK', 'Sekolah Menengah Atas', '10', '11', '12'],
    };
    const keywords = gradeMap[grade] || [];
    return rows.filter((r: any) => keywords.some(k => (r.institution || '').toLowerCase().includes(k.toLowerCase())));
  }, [entries, coins, mode, grade, subGrade]);

  const totalPages = Math.max(1, Math.ceil(allRows.length / PER_PAGE));
  const safePage = Math.min(page, totalPages);
  const top3 = allRows.slice(0, 3);
  const paged = allRows.slice(3 + (safePage - 1) * PER_PAGE, 3 + safePage * PER_PAGE);

  // Podium: 2nd, 1st, 3rd for desktop (center is tallest)
  const podiumDesktop = top3.length >= 3 ? [top3[1], top3[0], top3[2]] : top3;
  const podiumMobile = top3.length >= 3 ? [top3[0], top3[1], top3[2]] : top3;

  return (
    <div className="min-h-screen">
      {/* ═══ STICKY HEADER ═══ */}
      <div className="sticky top-0 z-20 glass border-b surface-border px-4 py-3">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-display font-bold text-lg text-fg">Papan Peringkat</h2>
          <span className="flex items-center gap-1.5 text-xs text-accent">
            <span className="w-2 h-2 rounded-full bg-accent animate-pulse" />Live
          </span>
        </div>

        {/* Mode toggle */}
        <div className="flex gap-1 surface-elevated rounded-lg p-1 mb-3">
          {([['xp', 'XP Global'], ['coin', 'Edu Coin']] as const).map(([key, label]) => (
            <button key={key} onClick={() => { setMode(key); setPage(1); }}
              className={`flex-1 py-1.5 rounded-md text-xs font-medium transition ${
                mode === key ? 'bg-accent-muted text-accent' : 'text-fg-muted hover:text-fg-secondary'
              }`}>
              {label}
            </button>
          ))}
        </div>

        {/* Grade filter */}
        <div className="flex overflow-x-auto no-scrollbar border-b surface-border">
          {(() => {
            const items: { key: string; label: string; active: boolean; onClick: () => void }[] = [];
            items.push({ key: 'all', label: 'Semua', active: grade === 'all' && !subGrade, onClick: () => { setGrade('all'); setSubGrade(null); setPage(1); } });
            GRADES.filter(g => g.key !== 'all').forEach((g) => {
              items.push({ key: g.key, label: g.label, active: grade === g.key && !subGrade, onClick: () => { setGrade(g.key); setSubGrade(null); setPage(1); } });
              if (grade === g.key && g.children) {
                g.children.forEach((lvl) => {
                  items.push({ key: `${g.key}-${lvl}`, label: lvl, active: subGrade === lvl, onClick: () => { setSubGrade(lvl); setPage(1); } });
                });
              }
            });
            return items.map((item) => (
              <button key={item.key} onClick={item.onClick}
                className={`px-3 py-2.5 text-xs font-medium whitespace-nowrap transition-all relative shrink-0 ${
                  item.active ? 'text-accent' : 'text-fg-muted hover:text-fg-secondary'
                }`}>
                {item.label}
                {item.active && <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-8 h-[2px] bg-accent rounded-full" />}
              </button>
            ));
          })()}
        </div>
      </div>

      <div className="p-4 space-y-4">
        {loading && <Card className="p-8 text-center text-sm text-fg-muted animate-pulse">Memuat peringkat…</Card>}
        {error && <Card className="p-8 text-center text-sm text-red-400">{error}</Card>}

        {/* ═══ TOP 3 PODIUM ═══ */}
        {!loading && !error && podiumDesktop.length >= 3 && (
          <>
            {/* Desktop: 2nd — 1st — 3rd */}
            <div className="hidden sm:flex items-end justify-center gap-4 lg:gap-6 px-2 pt-6 pb-2">
              {podiumDesktop.map((entry: any, idx: number) => {
                const place = (idx === 0 ? 2 : idx === 1 ? 1 : 3) as 1 | 2 | 3;
                return <PodiumCard key={entry.user_id} entry={entry} place={place} mode={mode} compact={false} />;
              })}
            </div>
            {/* Mobile: 1st, 2nd, 3rd stacked */}
            <div className="flex sm:hidden flex-col gap-3 pt-4">
              {podiumMobile.map((entry: any, idx: number) => {
                const place = (idx === 0 ? 1 : idx === 1 ? 2 : 3) as 1 | 2 | 3;
                return <PodiumCard key={entry.user_id} entry={entry} place={place} mode={mode} compact />;
              })}
            </div>
          </>
        )}

        {/* Divider */}
        {!loading && !error && podiumDesktop.length >= 3 && <div className="border-t surface-border" />}

        {/* ═══ RANK 4+ LIST ═══ */}
        {!loading && !error && (
          <div className="space-y-2">
            {paged.map((entry: any) => (
              <RankRow key={entry.user_id} entry={entry} currentUserId={user?.id} mode={mode} />
            ))}
          </div>
        )}

        {!loading && !error && !allRows.length && (
          <Card className="p-8 text-center text-sm text-fg-muted">Belum ada data peringkat.</Card>
        )}

        {/* Pagination */}
        {!loading && totalPages > 1 && (
          <div className="flex items-center justify-center gap-1 pt-2">
            <button onClick={() => setPage(Math.max(1, safePage - 1))} disabled={safePage <= 1}
              className="p-1.5 rounded-lg text-fg-muted hover:bg-white/5 disabled:opacity-30 transition">
              <ChevronLeft size={16} />
            </button>
            {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
              let pageNum: number;
              if (totalPages <= 7) pageNum = i + 1;
              else if (safePage <= 4) pageNum = i + 1;
              else if (safePage >= totalPages - 3) pageNum = totalPages - 6 + i;
              else pageNum = safePage - 3 + i;
              return (
                <button key={pageNum} onClick={() => setPage(pageNum)}
                  className={`w-8 h-8 rounded-lg text-xs font-medium transition ${
                    pageNum === safePage ? 'bg-accent-muted text-accent' : 'text-fg-muted hover:bg-white/5'
                  }`}>
                  {pageNum}
                </button>
              );
            })}
            <button onClick={() => setPage(Math.min(totalPages, safePage + 1))} disabled={safePage >= totalPages}
              className="p-1.5 rounded-lg text-fg-muted hover:bg-white/5 disabled:opacity-30 transition">
              <ChevronRight size={16} />
            </button>
          </div>
        )}

        <p className="text-center text-xs text-fg-muted pt-1">
          Menampilkan {allRows.length} dari max {MAX_RANK} peringkat
        </p>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   PodiumCard — Rank 1/2/3 with circular avatar + crown icon
   ═══════════════════════════════════════════════════════════════ */
function PodiumCard({ entry, place, mode, compact }: { entry: any; place: 1 | 2 | 3; mode: Mode; compact: boolean }) {
  const s = RANK_STYLES[place];
  const is1st = place === 1;
  const score = Number(mode === 'xp' ? entry.xp : entry.edu_coin).toLocaleString('id-ID');
  const avatarSize = is1st ? (compact ? 72 : 96) : (compact ? 56 : 72);

  return (
    <div className={`flex-1 ${is1st ? 'max-w-[280px]' : 'max-w-[240px]'} ${!compact ? (is1st ? '-mt-4' : place === 2 ? 'mt-4' : 'mt-6') : ''}`}>
      {/* Crown / Medal badge */}
      <div className={`flex justify-center mb-2`}>
        <div className={`${s.crownBg} rounded-full px-3 py-1 flex items-center gap-1.5`}>
          <span className="text-base">{s.label}</span>
          <span className={`text-[11px] font-bold ${s.crown}`}>Rank {place}</span>
        </div>
      </div>

      {/* Card */}
      <div className={`${s.cardBg} ${s.card} border-2 rounded-2xl p-4 flex flex-col items-center ${s.glow} transition-all duration-300`}>
        {/* Avatar — circular */}
        <div className="relative mb-3">
          <div className={`${s.ring} rounded-full overflow-hidden`}>
            <Avatar
              name={entry.display_name} id={entry.user_id}
              size={avatarSize} src={entry.avatar_url ?? undefined}
            />
          </div>
          {/* Crown icon overlay for rank 1 */}
          {is1st && (
            <div className="absolute -top-2 left-1/2 -translate-x-1/2">
              <Crown size={20} className="text-amber-400 drop-shadow-lg" />
            </div>
          )}
        </div>

        {/* Name + username */}
        <Link to={`/profile/${entry.username}`} className="text-center group">
          <p className={`font-bold text-sm ${s.nameColor} group-hover:text-accent transition truncate max-w-full`}>
            {entry.display_name}
          </p>
          <p className="text-[11px] text-fg-muted truncate">@{entry.username}</p>
        </Link>

        {/* Institution */}
        <p className="text-[10px] text-fg-muted mt-1 truncate max-w-full">{entry.institution || '—'}</p>

        {/* Score badge */}
        <div className={`${s.scoreBg} ${is1st ? 'text-white' : s.scoreText} rounded-xl px-4 py-2 mt-3 text-center w-full`}>
          <p className="text-lg font-bold tabular-nums">{score}</p>
          <p className={`text-[10px] ${is1st ? 'text-white/70' : 'text-fg-muted'}`}>{mode === 'xp' ? 'Total XP' : 'Edu Coin'}</p>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   RankRow — Rank 4+ list item
   ═══════════════════════════════════════════════════════════════ */
function RankRow({ entry, currentUserId, mode }: { entry: any; currentUserId?: string; mode: Mode }) {
  const isMe = currentUserId === entry.user_id;
  const score = Number(mode === 'xp' ? entry.xp : entry.edu_coin).toLocaleString('id-ID');

  return (
    <div className={`flex items-center gap-3 p-3 rounded-xl border transition-all duration-150 ${
      isMe
        ? 'border-accent/40 bg-accent-muted'
        : 'surface-border surface-card-bg hover:border-accent/20 hover:bg-surface-elevated'
    }`}>
      {/* Rank number */}
      <div className="w-8 text-center shrink-0">
        <span className={`text-sm font-bold ${isMe ? 'text-accent' : 'text-fg-muted'}`}>{entry.rank}</span>
      </div>

      {/* Avatar */}
      <Link to={`/profile/${entry.username}`} className="shrink-0">
        <Avatar name={entry.display_name} id={entry.user_id} size={36} src={entry.avatar_url ?? undefined} />
      </Link>

      {/* Name + institution */}
      <div className="flex-1 min-w-0">
        <Link to={`/profile/${entry.username}`}>
          <p className={`text-sm font-semibold truncate ${isMe ? 'text-accent' : 'text-fg'}`}>
            {entry.display_name}{isMe && <span className="text-fg-muted font-normal ml-1">(Kamu)</span>}
          </p>
          <p className="text-[11px] text-fg-muted truncate">{entry.institution || '—'}</p>
        </Link>
      </div>

      {/* Score */}
      <div className="text-right shrink-0">
        <p className={`text-sm font-bold tabular-nums ${mode === 'xp' ? 'text-accent' : 'text-amber-400'}`}>
          {score}
        </p>
        <p className="text-[10px] text-fg-muted">{mode === 'xp' ? 'XP' : 'Coin'}</p>
      </div>
    </div>
  );
}
