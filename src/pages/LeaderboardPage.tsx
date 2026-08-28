import { useEffect, useState, useMemo } from 'react';
import { TrendingUp, TrendingDown, Minus, ChevronLeft, ChevronRight, Filter } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card } from '@/components/ui/Card';
import { Avatar } from '@/components/ui/Avatar';
import { RankBadge } from '@/components/ui/Badge';
import { getPublicLeaderboard, type PublicLeaderboardRow } from '@/services/platform.service';
import { supabase } from '@/lib/supabase';
import { useApp } from '@/store/AppContext';

type Mode = 'xp' | 'coin';
type CoinRow = { user_id: string; username: string; display_name: string; institution: string | null; avatar_url: string | null; edu_coin: number; rank: number };

const GRADES = [
  { key: 'all', label: 'Semua' },
  { key: 'sd', label: 'SD' },
  { key: 'smp', label: 'SMP' },
  { key: 'sma', label: 'SMA' },
];

const PER_PAGE = 10;
const MAX_RANK = 100;

export function LeaderboardPage() {
  const { user } = useApp();
  const [mode, setMode] = useState<Mode>('xp');
  const [grade, setGrade] = useState('all');
  const [page, setPage] = useState(1);
  const [entries, setEntries] = useState<PublicLeaderboardRow[]>([]);
  const [coins, setCoins] = useState<CoinRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        if (mode === 'xp') {
          const rows = await getPublicLeaderboard(MAX_RANK);
          if (active) setEntries(rows);
        } else {
          const { data, error } = await supabase.rpc('get_public_coin_leaderboard', { p_limit: MAX_RANK });
          if (error) throw error;
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
    };
    void load();
    return () => { active = false; };
  }, [mode]);

  // Filter by grade
  const allRows = useMemo(() => {
    const rows = mode === 'xp' ? entries : (coins as any[]);
    if (grade === 'all') return rows;
    const gradeMap: Record<string, string[]> = {
      sd: ['SD', 'Sekolah Dasar', '1', '2', '3', '4', '5', '6'],
      smp: ['SMP', 'Sekolah Menengah Pertama', '7', '8', '9'],
      sma: ['SMA', 'SMK', 'Sekolah Menengah Atas', '10', '11', '12'],
    };
    const keywords = gradeMap[grade] || [];
    return rows.filter((r: any) => {
      const inst = (r.institution || '').toLowerCase();
      return keywords.some(k => inst.includes(k.toLowerCase()));
    });
  }, [entries, coins, mode, grade]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(allRows.length / PER_PAGE));
  const safePage = Math.min(page, totalPages);
  const top3 = allRows.slice(0, 3);
  const paged = allRows.slice(3 + (safePage - 1) * PER_PAGE, 3 + safePage * PER_PAGE);
  const startRank = 4 + (safePage - 1) * PER_PAGE;

  // Podium order: 2nd, 1st, 3rd
  const podium = top3.length >= 3 ? [top3[1], top3[0], top3[2]] : top3;

  return (
    <div>
      {/* Sticky header */}
      <div className="sticky top-0 z-20 glass border-b border-white/5 px-4 py-3">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-display font-bold text-lg text-white">Papan Peringkat</h2>
          <span className="flex items-center gap-1 text-xs text-moss-400">
            <span className="w-2 h-2 rounded-full bg-moss-400 animate-pulse" />Live
          </span>
        </div>

        {/* XP / Edu toggle */}
        <div className="flex gap-1 bg-ink-800 rounded-lg p-1 mb-2">
          <button onClick={() => { setMode('xp'); setPage(1); }}
            className={`flex-1 py-1.5 rounded-md text-xs font-medium transition ${mode === 'xp' ? 'bg-moss-500/15 text-moss-300' : 'text-slate-500'}`}>
            XP Global
          </button>
          <button onClick={() => { setMode('coin'); setPage(1); }}
            className={`flex-1 py-1.5 rounded-md text-xs font-medium transition ${mode === 'coin' ? 'bg-moss-500/15 text-moss-300' : 'text-slate-500'}`}>
            Edu Coin
          </button>
        </div>

        {/* Grade filter */}
        <div className="flex gap-1 overflow-x-auto no-scrollbar">
          {GRADES.map((g) => (
            <button key={g.key} onClick={() => { setGrade(g.key); setPage(1); }}
              className={`px-3 py-1 rounded-full text-[11px] font-medium whitespace-nowrap transition ${
                grade === g.key ? 'bg-moss-500/20 text-moss-300 border border-moss-500/30' : 'text-slate-500 border border-white/10 hover:border-white/20'
              }`}>
              {g.label}
            </button>
          ))}
        </div>
      </div>

      <div className="p-4 space-y-4">
        {loading && <Card className="p-8 text-center text-sm text-slate-500">Memuat...</Card>}
        {error && <Card className="p-8 text-center text-sm text-red-300">{error}</Card>}

        {/* Top 3 podium — order: 2nd, 1st, 3rd */}
        {!loading && !error && podium.length >= 3 && (
          <div className="flex items-end gap-3 px-1 pt-6 pb-2">
            {podium.map((entry: any, idx: number) => {
              const place = idx === 0 ? 2 : idx === 1 ? 1 : 3;
              return <TopBox key={entry.user_id} entry={entry} place={place as 1 | 2 | 3} mode={mode} />;
            })}
          </div>
        )}

        {/* Ranks 4-10 (current page) */}
        {!loading && !error && podium.length >= 3 && (
          <div className="border-t border-white/5 my-1" />
        )}
        {!loading && !error && (
          <div className="space-y-2">
            {paged.map((entry: any) => (
              <LeaderboardRow key={entry.user_id} entry={entry} currentUserId={user?.id} mode={mode} />
            ))}
          </div>
        )}

        {!loading && !error && !allRows.length && (
          <Card className="p-8 text-center text-sm text-slate-500">Belum ada data.</Card>
        )}

        {/* Pagination */}
        {!loading && totalPages > 1 && (
          <div className="flex items-center justify-center gap-1 pt-2">
            <button onClick={() => setPage(Math.max(1, safePage - 1))} disabled={safePage <= 1}
              className="p-1.5 rounded-lg text-slate-500 hover:bg-white/5 disabled:opacity-30">
              <ChevronLeft size={16} />
            </button>
            {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
              let pageNum: number;
              if (totalPages <= 7) {
                pageNum = i + 1;
              } else if (safePage <= 4) {
                pageNum = i + 1;
              } else if (safePage >= totalPages - 3) {
                pageNum = totalPages - 6 + i;
              } else {
                pageNum = safePage - 3 + i;
              }
              return (
                <button key={pageNum} onClick={() => setPage(pageNum)}
                  className={`w-8 h-8 rounded-lg text-xs font-medium transition ${
                    pageNum === safePage ? 'bg-moss-500/20 text-moss-300' : 'text-slate-500 hover:bg-white/5'
                  }`}>
                  {pageNum}
                </button>
              );
            })}
            <button onClick={() => setPage(Math.min(totalPages, safePage + 1))} disabled={safePage >= totalPages}
              className="p-1.5 rounded-lg text-slate-500 hover:bg-white/5 disabled:opacity-30">
              <ChevronRight size={16} />
            </button>
          </div>
        )}

        <p className="text-center text-xs text-slate-600 pt-2">
          Menampilkan {allRows.length} dari max {MAX_RANK} peringkat
        </p>
      </div>
    </div>
  );
}

function TopBox({ entry, place, mode }: { entry: any; place: 1 | 2 | 3; mode: Mode }) {
  const is1st = place === 1;
  const colors = is1st
    ? { border: 'border-amber-500/50', bg: 'bg-gradient-to-br from-amber-900/30 to-ink-800', badge: 'bg-amber-500 text-white', bar: 'bg-amber-600', text: 'text-amber-300', medal: '🥇' }
    : place === 2
    ? { border: 'border-slate-400/30', bg: 'bg-gradient-to-br from-slate-700/30 to-ink-800', badge: 'bg-slate-500/80 text-white', bar: 'bg-slate-500/60', text: 'text-slate-300', medal: '🥈' }
    : { border: 'border-orange-600/30', bg: 'bg-gradient-to-br from-orange-900/20 to-ink-800', badge: 'bg-orange-600/80 text-white', bar: 'bg-orange-700/60', text: 'text-orange-300', medal: '🥉' };
  const w = ''; // flexible via flex
  const h = is1st ? 'max-h-[320px]' : 'max-h-[260px]';
  const score = Number(mode === 'xp' ? entry.xp : entry.edu_coin).toLocaleString('id-ID');
  const unit = mode === 'xp' ? 'XP' : 'Coin';
  return (
    <div className={`${w} ${h} flex flex-col items-center`}>
      {/* Rank badge */}
      <div className={`${colors.badge} px-3 py-1 rounded-full text-[11px] font-bold flex items-center gap-1 mb-[-12px] z-10 shadow-lg`}>
        <span>{colors.medal}</span> RANK {place}
      </div>
      {/* Card */}
      <div className={`${colors.bg} ${colors.border} border-2 rounded-2xl p-4 flex-1 flex flex-col w-full overflow-hidden`}>
        {/* Avatar + Info row */}
        <div className="flex items-start gap-3 mb-3">
          <div className={`${is1st ? 'w-24 h-28' : 'w-16 h-20'} rounded-xl overflow-hidden bg-ink-700 shrink-0 border-2 ${is1st ? 'border-amber-500/40' : 'border-white/10'}`}>
            {entry.avatar_url ? (
              <img src={entry.avatar_url} alt={entry.display_name} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-moss-500/10">
                <span className={`${is1st ? 'text-2xl' : 'text-xl'} font-bold text-moss-300`}>{(entry.display_name || 'U').charAt(0).toUpperCase()}</span>
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0 pt-1">
            <Link to={`/profile/${entry.username}`}>
              <p className={`${is1st ? 'text-base' : 'text-sm'} font-bold text-white truncate`}>{entry.display_name}</p>
              <p className="text-[11px] text-slate-400 truncate">@{entry.username}</p>
            </Link>
            {entry.institution && (
              <span className={`inline-block mt-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${is1st ? 'bg-amber-500/20 text-amber-300' : 'bg-white/5 text-slate-400'}`}>
                {entry.institution}
              </span>
            )}
            <p className="text-[10px] text-slate-500 mt-1">Wali: —</p>
          </div>
        </div>
        {/* Ribbons */}
        <div className={`text-center text-[11px] ${colors.text} mb-2`}>
          🎗️ 0 Ribbons
        </div>
        {/* Score bar */}
        <div className={`${colors.bar} rounded-xl py-2 text-center mt-auto`}>
          <span className={`text-sm font-bold ${is1st ? 'text-white' : 'text-white/90'}`}>{score}</span>
          <span className="text-[10px] text-white/60 ml-1">{unit}</span>
        </div>
      </div>
    </div>
  );
}

function LeaderboardRow({ entry, currentUserId, mode }: { entry: any; currentUserId?: string; mode: Mode }) {
  return (
    <Card className={`p-3 ${currentUserId === entry.user_id ? 'border-moss-500/40 bg-moss-500/5' : ''}`}>
      <div className="flex items-center gap-3">
        <div className="w-8 text-center">
          <span className="text-sm font-bold text-slate-300">{entry.rank}</span>
        </div>
        <Link to={`/profile/${entry.username}`}>
          <Avatar name={entry.display_name} id={entry.user_id} size={36} ring={currentUserId === entry.user_id} src={entry.avatar_url ?? undefined} shape="square" />
        </Link>
        <div className="flex-1 min-w-0">
          <Link to={`/profile/${entry.username}`}>
            <p className={`text-sm font-semibold truncate ${currentUserId === entry.user_id ? 'text-moss-300' : 'text-white'}`}>
              {entry.display_name}{currentUserId === entry.user_id ? ' (Kamu)' : ''}
            </p>
            <p className="text-xs text-slate-500 truncate">{entry.institution || '—'}</p>
          </Link>
        </div>
        <span className={`text-sm font-semibold tabular-nums w-20 text-right ${mode === 'xp' ? 'text-moss-300' : 'text-amber-300'}`}>
          {Number(mode === 'xp' ? entry.xp : entry.edu_coin).toLocaleString('id-ID')} {mode === 'xp' ? 'XP' : 'Coin'}
        </span>
      </div>
    </Card>
  );
}
