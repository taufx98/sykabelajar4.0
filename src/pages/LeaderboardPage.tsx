import { useEffect, useState, useMemo } from 'react';
import { TrendingUp, ChevronLeft, ChevronRight, Crown, Medal, Search } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card } from '@/components/ui/Card';
import { Avatar } from '@/components/ui/Avatar';
import { getPublicLeaderboard, getPublicCoinLeaderboard, type PublicLeaderboardRow, type PublicCoinLeaderboardRow } from '@/services/platform.service';
import { useApp } from '@/store/AppContext';

type Mode = 'xp' | 'coin';
type LeaderRow = (PublicLeaderboardRow & { grade?: string | null }) | (PublicCoinLeaderboardRow & { xp?: number; grade?: string | null });

const GRADES = [
  { key: 'all', label: 'Semua', children: [] as string[] },
  { key: 'sd', label: 'SD', children: ['1','2','3','4','5','6'] },
  { key: 'smp', label: 'SMP', children: ['7','8','9'] },
  { key: 'sma', label: 'SMA', children: ['10','11','12'] },
];

const PER_PAGE = 10;
const MAX_RANK = 100;

const RANK_STYLES = {
  1: { ring: 'ring-4 ring-amber-400/80', crown: 'text-amber-400', crownBg: 'bg-amber-500/20', card: 'border-amber-400/40', cardBg: 'bg-gradient-to-b from-amber-500/8 to-surface-card', glow: 'shadow-[0_0_20px_rgba(245,158,11,0.15)]', nameColor: 'text-fg', scoreBg: 'bg-amber-500', scoreText: 'text-white', label: '🥇' },
  2: { ring: 'ring-4 ring-slate-300/50', crown: 'text-fg-secondary', crownBg: 'bg-slate-400/15', card: 'border-slate-300/25', cardBg: 'bg-surface-card', glow: '', nameColor: 'text-fg', scoreBg: 'bg-slate-400/20', scoreText: 'text-fg', label: '🥈' },
  3: { ring: 'ring-4 ring-orange-400/50', crown: 'text-orange-400', crownBg: 'bg-orange-500/15', card: 'border-orange-400/25', cardBg: 'bg-surface-card', glow: '', nameColor: 'text-fg', scoreBg: 'bg-orange-500/15', scoreText: 'text-fg', label: '🥉' },
} as const;

const normalizeGrade = (value: unknown) => String(value ?? '').toLowerCase().trim();
const gradeGroup = (value: unknown) => {
  const g = normalizeGrade(value);
  if (!g) return '';
  if (g === 'sd' || g.startsWith('sd_') || /^sd\s*[1-6]$/.test(g)) return 'sd';
  if (g === 'smp' || g.startsWith('smp_') || /^smp\s*(7|8|9)$/.test(g)) return 'smp';
  if (g === 'sma' || g === 'smk' || g.startsWith('sma_') || /^sma\s*(10|11|12)$/.test(g)) return 'sma';
  if (g === 'alumni') return 'sma';
  return '';
};
const gradeClass = (value: unknown) => {
  const g = normalizeGrade(value);
  const m = g.match(/(?:sd[_\s-]?|smp[_\s-]?|sma[_\s-]?)(1|2|3|4|5|6|7|8|9|10|11|12)$/);
  return m?.[1] ?? '';
};

export function LeaderboardPage() {
  const { user } = useApp();
  const [mode, setMode] = useState<Mode>('xp');
  const [grade, setGrade] = useState('all');
  const [subGrade, setSubGrade] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [entries, setEntries] = useState<LeaderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true); setError('');
      try {
        const rows = mode === 'xp' ? await getPublicLeaderboard(MAX_RANK) : await getPublicCoinLeaderboard(MAX_RANK);
        if (active) setEntries(rows as LeaderRow[]);
      } catch (e: any) {
        if (active) { setError(e?.message ?? 'Gagal memuat.'); setEntries([]); }
      } finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [mode]);

  const allRows = useMemo(() => {
    if (grade === 'all' && !subGrade) return entries;
    return entries.filter((row) => {
      const group = gradeGroup(row.grade);
      if (subGrade) return group === grade && gradeClass(row.grade) === subGrade;
      return group === grade;
    });
  }, [entries, grade, subGrade]);

  const totalPages = Math.max(1, Math.ceil(allRows.length / PER_PAGE));
  const safePage = Math.min(page, totalPages);
  const top3 = allRows.slice(0, 3);
  const paged = allRows.slice(3 + (safePage - 1) * PER_PAGE, 3 + safePage * PER_PAGE);
  const activeGradeConfig = GRADES.find((g) => g.key === grade);
  const podiumDesktop = top3.length >= 3 ? [top3[1], top3[0], top3[2]] : top3;

  return (
    <div className="min-h-screen">
      <div className="sticky top-0 z-20 glass border-b surface-border px-4 py-3">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-display font-bold text-lg text-fg">Papan Peringkat</h2>
          <span className="flex items-center gap-1.5 text-xs text-accent"><span className="w-2 h-2 rounded-full bg-accent animate-pulse" />Live</span>
        </div>
        <div className="flex gap-1 surface-elevated rounded-lg p-1 mb-3">
          {([['xp', 'XP Global'], ['coin', 'Edu Coin']] as const).map(([key, label]) => (
            <button key={key} onClick={() => { setMode(key); setPage(1); }} className={`flex-1 py-1.5 rounded-md text-xs font-medium transition ${mode === key ? 'bg-accent-muted-strong text-accent' : 'text-fg-muted hover:text-fg-secondary'}`}>{label}</button>
          ))}
        </div>
        <div className="flex items-center gap-2 border-b surface-border pb-1">
          {GRADES.map((g) => (
            <button key={g.key} onClick={() => { setGrade(g.key); setSubGrade(null); setPage(1); }} className={`px-3 py-2.5 text-xs font-medium whitespace-nowrap transition-all relative ${grade === g.key && !subGrade ? 'text-accent' : 'text-fg-muted hover:text-fg-secondary'}`}>
              {g.label}
              {grade === g.key && !subGrade && <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-8 h-[2px] bg-accent rounded-full" />}
            </button>
          ))}
          {grade !== 'all' && <label className="relative ml-auto shrink-0">
            <select value={subGrade ?? ''} onChange={(e) => { setSubGrade(e.target.value || null); setPage(1); }} className="input appearance-none pr-9 py-2 text-xs min-w-[128px]">
              <option value="">Semua {activeGradeConfig?.label ?? grade.toUpperCase()}</option>
              {(activeGradeConfig?.children ?? []).map((lvl) => <option key={lvl} value={lvl}>Kelas {lvl}</option>)}
            </select>
            <ChevronRight size={14} className="absolute right-3 top-1/2 -translate-y-1/2 rotate-90 pointer-events-none text-fg-muted" />
          </label>}
        </div>
      </div>

      <div className="p-4 space-y-4">
        {loading && <Card className="p-8 text-center text-sm text-fg-muted animate-pulse">Memuat peringkat…</Card>}
        {error && <Card className="p-8 text-center text-sm text-red-400">{error}</Card>}

        {!loading && !error && podiumDesktop.length >= 3 && <>
          <div className="hidden sm:flex items-end justify-center gap-4 lg:gap-6 px-2 pt-6 pb-2">
            {podiumDesktop.map((entry, idx) => { const place = (idx === 0 ? 2 : idx === 1 ? 1 : 3) as 1 | 2 | 3; return <PodiumCard key={entry.user_id} entry={entry} place={place} mode={mode} compact={false} />; })}
          </div>
          <div className="sm:hidden flex items-end justify-center gap-2 px-1 pt-5 pb-2 w-full overflow-hidden">
            {top3.map((entry, idx) => { const place = (idx + 1) as 1 | 2 | 3; return <div key={entry.user_id} className="w-[31%] max-w-[130px] flex justify-center"><PodiumCard entry={entry} place={place} mode={mode} compact /></div>; })}
          </div>
        </>}

        {!loading && !error && podiumDesktop.length >= 3 && <div className="border-t surface-border" />}

        {!loading && !error && <div className="space-y-2">{paged.map((entry) => <RankRow key={entry.user_id} entry={entry} currentUserId={user?.id} mode={mode} />)}</div>}
        {!loading && !error && !allRows.length && <Card className="p-8 text-center text-sm text-fg-muted">Belum ada data peringkat.</Card>}

        {!loading && totalPages > 1 && <div className="flex items-center justify-center gap-1 pt-2">
          <button onClick={() => setPage(Math.max(1, safePage - 1))} disabled={safePage <= 1} className="p-1.5 rounded-lg text-fg-muted hover:bg-white/5 disabled:opacity-30 transition"><ChevronLeft size={16} /></button>
          {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => { let pageNum: number; if (totalPages <= 7) pageNum = i + 1; else if (safePage <= 4) pageNum = i + 1; else if (safePage >= totalPages - 3) pageNum = totalPages - 6 + i; else pageNum = safePage - 3 + i; return <button key={pageNum} onClick={() => setPage(pageNum)} className={`w-8 h-8 rounded-lg text-xs font-medium transition ${pageNum === safePage ? 'bg-accent-muted-strong text-accent' : 'text-fg-muted hover:bg-white/5'}`}>{pageNum}</button>; })}
          <button onClick={() => setPage(Math.min(totalPages, safePage + 1))} disabled={safePage >= totalPages} className="p-1.5 rounded-lg text-fg-muted hover:bg-white/5 disabled:opacity-30 transition"><ChevronRight size={16} /></button>
        </div>}
        <p className="text-center text-xs text-fg-muted pt-1">Menampilkan {allRows.length} dari max {MAX_RANK} peringkat</p>
      </div>
    </div>
  );
}

function PodiumCard({ entry, place, mode, compact }: { entry: LeaderRow; place: 1 | 2 | 3; mode: Mode; compact: boolean }) {
  const s = RANK_STYLES[place]; const is1st = place === 1; const score = Number(mode === 'xp' ? (entry as any).xp : (entry as any).edu_coin).toLocaleString('id-ID'); const avatarSize = is1st ? (compact ? 72 : 96) : (compact ? 56 : 72);
  return <div className={`flex-1 ${is1st ? 'max-w-[280px]' : 'max-w-[240px]'} ${!compact ? (is1st ? '-mt-4' : place === 2 ? 'mt-4' : 'mt-6') : ''}`}>
    <div className="flex justify-center mb-2"><div className={`${s.crownBg} rounded-full px-3 py-1 flex items-center gap-1.5`}><span className="text-base">{s.label}</span><span className={`text-[11px] font-bold ${s.crown}`}>Rank {place}</span></div></div>
    <div className={`${s.cardBg} ${s.card} border-2 rounded-2xl p-4 flex flex-col items-center ${s.glow} transition-all duration-300`}>
      <div className="relative mb-3"><div className={`${s.ring} rounded-full overflow-hidden`}><Avatar name={entry.display_name} id={entry.user_id} size={avatarSize} src={entry.avatar_url ?? undefined} /></div>{is1st && <div className="absolute -top-2 left-1/2 -translate-x-1/2"><Crown size={20} className="text-amber-400 drop-shadow-lg" /></div>}</div>
      <Link to={`/profile/${entry.username}`} className="text-center group"><p className={`font-bold text-sm ${s.nameColor} group-hover:text-accent transition truncate max-w-full`}>{entry.display_name}</p><p className="text-[11px] text-fg-muted truncate">@{entry.username}</p></Link>
      <p className="text-[10px] text-fg-muted mt-1 truncate max-w-full">{entry.institution || '—'}</p>
      <div className={`${s.scoreBg} ${is1st ? 'text-white' : s.scoreText} rounded-xl px-4 py-2 mt-3 text-center w-full`}><p className="text-lg font-bold tabular-nums">{score}</p><p className={`text-[10px] ${is1st ? 'text-white/70' : 'text-fg-muted'}`}>{mode === 'xp' ? 'Total XP' : 'Edu Coin'}</p></div>
    </div>
  </div>;
}

function RankRow({ entry, currentUserId, mode }: { entry: LeaderRow; currentUserId?: string; mode: Mode }) {
  const isMe = currentUserId === entry.user_id; const score = Number(mode === 'xp' ? (entry as any).xp : (entry as any).edu_coin).toLocaleString('id-ID');
  return <div className={`flex items-center gap-3 p-3 rounded-xl border transition-all duration-150 ${isMe ? 'border-accent/40 bg-accent-muted' : 'surface-border surface-card-bg hover:border-accent/20 hover:bg-surface-elevated'}`}>
    <div className="w-8 text-center shrink-0"><span className={`text-sm font-bold ${isMe ? 'text-accent' : 'text-fg-muted'}`}>{entry.rank}</span></div>
    <Link to={`/profile/${entry.username}`} className="shrink-0"><Avatar name={entry.display_name} id={entry.user_id} size={36} src={entry.avatar_url ?? undefined} /></Link>
    <div className="flex-1 min-w-0"><Link to={`/profile/${entry.username}`}><p className={`text-sm font-semibold truncate ${isMe ? 'text-accent' : 'text-fg'}`}>{entry.display_name}{isMe && <span className="text-fg-muted font-normal ml-1">(Kamu)</span>}</p><p className="text-[11px] text-fg-muted truncate">{entry.institution || '—'}</p></Link></div>
    <div className="text-right shrink-0"><p className={`text-sm font-bold tabular-nums ${mode === 'xp' ? 'text-accent' : 'text-amber-400'}`}>{score}</p><p className="text-[10px] text-fg-muted">{mode === 'xp' ? 'XP' : 'Coin'}</p></div>
  </div>;
}
