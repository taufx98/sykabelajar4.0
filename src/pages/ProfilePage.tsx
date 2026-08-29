import { useEffect, useState, useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Edit2, Calendar, Trophy, Award, GraduationCap, BarChart3, TrendingUp,
  CheckCircle2, User, UserPlus, UserMinus, MessageCircle, School, Heart,
} from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Avatar } from '@/components/ui/Avatar';
import { useApp } from '@/store/AppContext';
import { supabase } from '@/lib/supabase';
import { uploadImage } from '@/services/cloudinary.service';
import { formatShortDate } from '@/lib/utils';
import { CATEGORY_LABELS, GRADE_OPTIONS } from '@/data/catalog';

type Tab = 'prestasi' | 'lomba' | 'statistik';

interface UserCompetition {
  id: string;
  competitionId: string;
  status: string;
  submittedAt: string;
  title: string;
  category: string;
  posterUrl: string | null;
  competitionStatus: string;
  score: number | null;
  rank: number | null;
}

export function ProfilePage() {
  const { username } = useParams();
  const { user: currentUser, toast } = useApp();
  const [profile, setProfile] = useState<any>(null);
  const [awards, setAwards] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>('prestasi');
  const [competitions, setCompetitions] = useState<UserCompetition[]>([]);
  const [compLoading, setCompLoading] = useState(false);
  const [stats, setStats] = useState({ diikuti: 0, dimenangkan: 0, dailyTasks: 0, streak: 0, avgScore: 0 });
  const [catDistribution, setCatDistribution] = useState<{ category: string; label: string; pct: number }[]>([]);
  const [totalPoints, setTotalPoints] = useState(0);
  const [rank, setRank] = useState(0);
  const [followers, setFollowers] = useState(0);
  const [following, setFollowing] = useState(0);
  const [isFollowing, setIsFollowing] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);
  const isOwn = currentUser?.username === username;

  // ── Load profile data ──
  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const { data: p, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('username', username || '')
          .maybeSingle();
        if (error) throw error;
        if (!p) { if (alive) setProfile(null); return; }

        const { data: a } = await supabase
          .from('awards')
          .select('*')
          .eq('user_id', p.id)
          .order('issued_at', { ascending: false });

        // XP from leaderboard (SECURITY DEFINER — global data)
        const { data: lb } = await supabase.rpc('get_public_leaderboard', { p_limit: 100 });
        const userRow = (lb ?? []).find((r: any) => String(r.user_id) === String(p.id));
        const xp = Number(userRow?.xp ?? 0);
        const userRank = Number(userRow?.rank ?? 0);

        // Followers / Following
        const { count: flCount } = await supabase
          .from('follows').select('id', { count: 'exact', head: true }).eq('following_id', p.id);
        const { count: fgCount } = await supabase
          .from('follows').select('id', { count: 'exact', head: true }).eq('follower_id', p.id);

        let followed = false;
        if (currentUser && currentUser.id !== p.id) {
          const { count } = await supabase
            .from('follows').select('id', { count: 'exact', head: true })
            .eq('follower_id', currentUser.id).eq('following_id', p.id);
          followed = (count ?? 0) > 0;
        }

        if (alive) {
          setProfile(p);
          setAwards(a || []);
          setTotalPoints(xp);
          setRank(userRank);
          setFollowers(flCount ?? 0);
          setFollowing(fgCount ?? 0);
          setIsFollowing(followed);
        }
      } catch (e: any) {
        if (alive) toast(e?.message || 'Profil gagal dimuat.', 'error');
      } finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [username, toast, currentUser]);

  // ── Load competitions ──
  useEffect(() => {
    if (activeTab !== 'lomba' || !profile?.id) return;
    let alive = true;
    (async () => {
      setCompLoading(true);
      try {
        const { data: regs } = await supabase
          .from('registrations')
          .select('id,competition_id,status,submitted_at')
          .eq('user_id', profile.id)
          .order('created_at', { ascending: false });

        if (!regs?.length) { if (alive) setCompetitions([]); return; }

        const compIds = [...new Set(regs.map((r: any) => String(r.competition_id)))];
        const { data: comps } = await supabase
          .from('competitions')
          .select('id,title,category,poster_url,status')
          .in('id', compIds);

        const compMap = new Map((comps ?? []).map((c: any) => [String(c.id), c]));

        if (alive) {
          setCompetitions(regs.map((r: any) => {
            const comp = compMap.get(String(r.competition_id));
            return {
              id: r.id,
              competitionId: r.competition_id,
              status: r.status,
              submittedAt: r.submitted_at,
              title: comp?.title || 'Lomba',
              category: comp?.category || '',
              posterUrl: comp?.poster_url || null,
              competitionStatus: comp?.status || '',
              score: null,
              rank: null,
            };
          }));
        }
      } catch (e: any) {
        if (alive) toast(e?.message || 'Gagal memuat lomba.', 'error');
      } finally { if (alive) setCompLoading(false); }
    })();
    return () => { alive = false; };
  }, [activeTab, profile?.id, toast]);

  // ── Load stats ──
  useEffect(() => {
    if (activeTab !== 'statistik' || !profile?.id) return;
    let alive = true;
    (async () => {
      try {
        const { count: diikuti } = await supabase
          .from('registrations').select('id', { count: 'exact', head: true }).eq('user_id', profile.id);
        const { count: dimenangkan } = await supabase
          .from('awards').select('id', { count: 'exact', head: true }).eq('user_id', profile.id);
        const { count: dailyTasks } = await supabase
          .from('daily_task_claims').select('id', { count: 'exact', head: true }).eq('user_id', profile.id);

        const { data: attScores } = await supabase
          .from('attempts').select('score').eq('participant_id', profile.id).eq('status', 'GRADED');
        const scores = (attScores ?? []).map((a: any) => Number(a.score ?? 0)).filter(s => s > 0);
        const avgScore = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;

        const { data: regs } = await supabase
          .from('registrations').select('competition_id').eq('user_id', profile.id);
        const regCompIds = [...new Set((regs ?? []).map((r: any) => String(r.competition_id)))];
        let catCounts: Record<string, number> = {};
        if (regCompIds.length) {
          const { data: catComps } = await supabase
            .from('competitions').select('id,category').in('id', regCompIds);
          for (const c of (catComps ?? []) as any[]) {
            const cat = String(c.category ?? '');
            catCounts[cat] = (catCounts[cat] || 0) + 1;
          }
        }
        const total = Object.values(catCounts).reduce((a, b) => a + b, 0) || 1;
        const distribution = Object.entries(catCounts)
          .map(([cat, count]) => ({ category: cat, label: CATEGORY_LABELS[cat] || cat, pct: Math.round((count / total) * 100) }))
          .sort((a, b) => b.pct - a.pct);

        if (alive) {
          setStats({ diikuti: diikuti ?? 0, dimenangkan: dimenangkan ?? 0, dailyTasks: dailyTasks ?? 0, streak: 0, avgScore });
          setCatDistribution(distribution);
        }
      } catch (e) { console.warn('[Profile] stats failed', e); }
    })();
    return () => { alive = false; };
  }, [activeTab, profile?.id]);

  // ── Cover upload ──
  const uploadCover = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !currentUser || !isOwn) return;
    try {
      const oldCoverId = profile?.cover_public_id as string | undefined;
      const result = await uploadImage(file, `sykabelajar/users/covers/${currentUser.id}`);
      const { error } = await supabase.from('profiles').update({
        cover_url: result.secure_url, cover_public_id: result.public_id,
        updated_at: new Date().toISOString(),
      }).eq('id', currentUser.id);
      if (error) throw error;
      if (oldCoverId && oldCoverId !== result.public_id) {
        const { deleteImage } = await import('@/services/cloudinary.service');
        void deleteImage(oldCoverId);
      }
      toast('Sampul diperbarui.', 'success');
      setProfile((prev: any) => prev ? { ...prev, cover_url: result.secure_url } : prev);
    } catch (e: any) { toast(e?.message || 'Upload gagal.', 'error'); }
    finally { e.target.value = ''; }
  };

  // ── Follow ──
  const toggleFollow = useCallback(async () => {
    if (!currentUser || isOwn || !profile?.id) return;
    setFollowBusy(true);
    try {
      if (isFollowing) {
        await supabase.from('follows').delete().eq('follower_id', currentUser.id).eq('following_id', profile.id);
        setFollowers(f => f - 1); setIsFollowing(false);
      } else {
        await supabase.from('follows').insert({ follower_id: currentUser.id, following_id: profile.id });
        setFollowers(f => f + 1); setIsFollowing(true);
      }
    } catch (e: any) { toast(e?.message || 'Gagal update follow.', 'error'); }
    finally { setFollowBusy(false); }
  }, [currentUser, isOwn, profile?.id, isFollowing, toast]);

  if (loading) return <div className="p-6 text-sm text-slate-500">Memuat profil…</div>;
  if (!profile) return <div className="p-6"><Card className="p-8 text-center text-slate-500">Profil tidak ditemukan.</Card></div>;

  // Grade label from granular value
  const gradeLabel = (() => {
    const g = profile.grade || '';
    const found = GRADE_OPTIONS.find(o => o.value === g);
    if (found) return found.label;
    if (g === 'sd') return 'SD';
    if (g === 'smp') return 'SMP';
    if (g === 'sma') return 'SMA';
    if (g === 'alumni') return 'Alumni';
    return g || '';
  })();

  const emblems = profile.emblems ?? [];
  const badges = profile.badges ?? [];
  const favoriteCategories = (profile.subjects ?? '').split(',').map((s: string) => s.trim()).filter(Boolean);

  return (
    <div className="max-w-lg mx-auto">
      {/* ═══ COVER (subtle) ═══ */}
      <div className="relative h-28 md:h-36 bg-gradient-to-b from-moss-900/30 via-ink-800 to-ink-900">
        {profile.cover_url && (
          <img src={profile.cover_url} alt="" className="w-full h-full object-cover" />
        )}
        {isOwn && (
          <label className="absolute bottom-2 right-2 px-3 py-1.5 rounded-lg bg-black/50 text-[11px] text-white cursor-pointer hover:bg-black/70 transition">
            Ganti Sampul
            <input type="file" accept="image/*" className="hidden" onChange={uploadCover} />
          </label>
        )}
      </div>

      {/* ═══ PROFILE INFO ═══ */}
      <div className="px-4 -mt-16 relative text-center pb-2">
        {/* Avatar */}
        <div className="flex justify-center">
          <Avatar
            name={profile.full_name || profile.username || 'U'}
            id={profile.id} size={88} ring
            src={profile.avatar_url || undefined}
          />
        </div>

        {/* Name + verified */}
        <div className="flex items-center justify-center gap-1.5 mt-2">
          <h1 className="font-display text-xl font-bold text-white">{profile.full_name || profile.username}</h1>
          {profile.status === 'ACTIVE' && <CheckCircle2 size={18} className="text-moss-400" />}
        </div>

        {/* Username */}
        <p className="text-sm text-slate-400 mt-0.5">@{profile.username}</p>

        {/* Bio */}
        {profile.bio && (
          <p className="text-sm text-slate-300 mt-2 max-w-sm mx-auto leading-relaxed">{profile.bio}</p>
        )}

        {/* Info row */}
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 mt-3 text-[11px] text-slate-400">
          {profile.institution && (
            <span className="flex items-center gap-1">
              <School size={12} /> {profile.institution}
            </span>
          )}
          {gradeLabel && (
            <span className="flex items-center gap-1">
              <GraduationCap size={12} /> {gradeLabel}
            </span>
          )}
          {profile.birth_date && (
            <span className="flex items-center gap-1">
              <Calendar size={12} /> Lahir {new Date(profile.birth_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}
            </span>
          )}
        </div>

        {/* Pembina */}
        {profile.pembina && (
          <p className="text-[11px] text-slate-400 mt-1.5 flex items-center justify-center gap-1">
            <User size={12} /> Pembina: {profile.pembina}
          </p>
        )}

        {/* Following / Followers */}
        <div className="flex items-center justify-center gap-5 mt-3">
          <span className="text-sm">
            <span className="font-bold text-white">{following}</span>{' '}
            <span className="text-slate-500">Mengikuti</span>
          </span>
          <span className="text-sm">
            <span className="font-bold text-white">{followers}</span>{' '}
            <span className="text-slate-500">Pengikut</span>
          </span>
        </div>

        {/* Follow button */}
        {!isOwn && currentUser && (
          <div className="flex justify-center mt-3">
            <Button
              size="sm"
              variant={isFollowing ? 'outline' : 'primary'}
              onClick={toggleFollow}
              disabled={followBusy}
              icon={isFollowing ? <UserMinus size={14} /> : <UserPlus size={14} />}
            >
              {isFollowing ? 'Unfollow' : 'Follow'}
            </Button>
          </div>
        )}

        {/* ═══ STATS CARDS ═══ */}
        <div className="grid grid-cols-3 gap-3 mt-5">
          <div className="bg-ink-800/80 border border-white/5 rounded-2xl p-4 text-center">
            <p className="text-xl font-bold text-white">{totalPoints.toLocaleString('id-ID')}</p>
            <p className="text-[10px] text-slate-500 mt-0.5">Total Poin</p>
          </div>
          <div className="bg-ink-800/80 border border-white/5 rounded-2xl p-4 text-center">
            <div className="w-8 h-8 rounded-full bg-moss-500/20 flex items-center justify-center mx-auto mb-1">
              <span className="text-sm font-bold text-moss-300">{rank || '—'}</span>
            </div>
            <p className="text-[10px] text-slate-500">Peringkat #{rank || '—'}</p>
          </div>
          <div className="bg-ink-800/80 border border-white/5 rounded-2xl p-4 text-center">
            <p className="text-xl font-bold text-white">{awards.length}</p>
            <p className="text-[10px] text-slate-500 mt-0.5">Awards</p>
          </div>
        </div>

        {/* ═══ EMBLEM ═══ */}
        {emblems.length > 0 && (
          <div className="bg-ink-800/80 border border-white/5 rounded-2xl p-4 mt-3 text-left">
            <div className="flex items-center gap-2 mb-3">
              <Award size={16} className="text-moss-400" />
              <h3 className="text-sm font-bold text-white">Emblem ({emblems.length})</h3>
            </div>
            <div className="flex gap-2.5">
              {emblems.slice(0, 6).map((e: any, i: number) => (
                <div key={i} className="w-10 h-10 rounded-xl bg-moss-500/15 flex items-center justify-center">
                  <Award size={18} className="text-moss-400" />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ═══ BADGE ═══ */}
        {badges.length > 0 && (
          <div className="bg-ink-800/80 border border-white/5 rounded-2xl p-4 mt-3 text-left">
            <div className="flex items-center gap-2 mb-3">
              <Award size={16} className="text-moss-400" />
              <h3 className="text-sm font-bold text-white">Badge</h3>
            </div>
            <div className="flex flex-wrap gap-2">
              {badges.map((b: string, i: number) => (
                <span key={i} className="px-3 py-1.5 rounded-full text-xs font-medium bg-moss-500/15 text-moss-300 border border-moss-500/20">
                  {b}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* ═══ KATEGORI FAVORIT ═══ */}
        {favoriteCategories.length > 0 && (
          <div className="bg-ink-800/80 border border-white/5 rounded-2xl p-4 mt-3 text-left">
            <h3 className="text-sm font-bold text-white mb-3">Kategori Favorit</h3>
            <div className="flex flex-wrap gap-2">
              {favoriteCategories.map((cat: string, i: number) => (
                <span key={i} className="px-3 py-1.5 rounded-full text-xs font-medium bg-moss-500/15 text-moss-300 border border-moss-500/20">
                  {CATEGORY_LABELS[cat] || cat}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* ═══ TABS ═══ */}
        <div className="flex border-b border-white/5 mt-5">
          {([['prestasi', 'Prestasi'], ['lomba', 'Lomba'], ['statistik', 'Statistik']] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`flex-1 py-3 text-center text-sm font-medium transition relative ${
                activeTab === key ? 'text-moss-300' : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {label}
              {activeTab === key && (
                <div className="absolute bottom-0 left-1/4 right-1/4 h-0.5 bg-moss-400 rounded-full" />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ═══ TAB CONTENT ═══ */}
      <div className="p-4 pt-3">
        {/* ── PRESTASI ── */}
        {activeTab === 'prestasi' && (
          <div className="space-y-3">
            {awards.map((a: any) => (
              <div key={a.id} className="bg-ink-800/80 border border-white/5 rounded-2xl p-4">
                <div className="flex items-center gap-3">
                  <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${
                    a.rank_code === '1' ? 'bg-amber-500/15' :
                    a.rank_code === '2' ? 'bg-slate-400/15' :
                    a.rank_code === '3' ? 'bg-orange-500/15' :
                    'bg-moss-500/10'
                  }`}>
                    <Award size={18} className={
                      a.rank_code === '1' ? 'text-amber-400' :
                      a.rank_code === '2' ? 'text-slate-300' :
                      a.rank_code === '3' ? 'text-orange-400' :
                      'text-moss-400'
                    } />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-white truncate">{a.title}</p>
                    <p className="text-xs text-slate-400">{a.subtitle || a.rank_code || 'Penghargaan'}</p>
                    {a.emblem_url && (
                      <div className="flex items-center gap-1.5 mt-1.5">
                        <span className="text-[10px] text-slate-500">Emblem:</span>
                        <div className="w-5 h-5 rounded-full bg-moss-500/15 flex items-center justify-center">
                          <Award size={10} className="text-moss-400" />
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold text-moss-300">+{a.points ?? 0}</p>
                    <p className="text-[10px] text-slate-500 mt-0.5">{a.issued_at ? formatShortDate(a.issued_at) : '—'}</p>
                  </div>
                </div>
              </div>
            ))}
            {!awards.length && (
              <div className="text-center py-10 text-sm text-slate-500">Belum ada penghargaan.</div>
            )}
          </div>
        )}

        {/* ── LOMBA ── */}
        {activeTab === 'lomba' && (
          <div className="space-y-3">
            {compLoading && <div className="text-center py-10 text-sm text-slate-500">Memuat lomba…</div>}
            {!compLoading && !competitions.length && (
              <div className="text-center py-10 text-sm text-slate-500">Belum ada lomba yang diikuti.</div>
            )}
            {!compLoading && competitions.map((comp) => {
              const statusColor = comp.competitionStatus === 'LIVE' ? 'moss'
                : comp.competitionStatus === 'REGISTRATION_OPEN' ? 'info'
                : 'default';
              const statusLabel = comp.competitionStatus === 'LIVE' ? 'Berlangsung'
                : comp.competitionStatus === 'REGISTRATION_OPEN' ? 'Terbuka'
                : comp.competitionStatus === 'RESULT_PUBLISHED' ? 'Selesai'
                : comp.competitionStatus;
              return (
                <Link key={comp.id} to={`/lomba/${comp.competitionId}`} className="block">
                  <div className="bg-ink-800/80 border border-white/5 rounded-2xl p-4 flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-ink-700 overflow-hidden shrink-0">
                      {comp.posterUrl ? (
                        <img src={comp.posterUrl} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Trophy size={20} className="text-moss-500/40" />
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-white truncate">{comp.title}</p>
                      <p className="text-[11px] text-slate-500">{CATEGORY_LABELS[comp.category] || comp.category || 'Umum'}</p>
                    </div>
                    <Badge color={statusColor}>{statusLabel}</Badge>
                  </div>
                </Link>
              );
            })}
          </div>
        )}

        {/* ── STATISTIK ── */}
        {activeTab === 'statistik' && (
          <div className="space-y-4">
            <div className="bg-ink-800/80 border border-white/5 rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <BarChart3 size={17} className="text-moss-400" />
                <h3 className="font-display font-bold text-white text-sm">Statistik Performa</h3>
              </div>
              <div className="space-y-4">
                <StatBar label="Uji kompetensi diikuti" value={stats.diikuti} max={Math.max(stats.diikuti, stats.dimenangkan * 3, 10)} color="bg-moss-400" />
                <StatBar label="Uji kompetensi dimenangkan" value={stats.dimenangkan} max={Math.max(stats.diikuti, stats.dimenangkan * 3, 10)} color="bg-sky-400" />
                <StatBar label="Daily tasks selesai" value={stats.dailyTasks} max={Math.max(stats.dailyTasks, 50)} color="bg-moss-400" />
                <StatBar label="Rata-rata skor" value={stats.avgScore} max={100} suffix="%" color="bg-moss-400" />
              </div>
            </div>

            {catDistribution.length > 0 && (
              <div className="bg-ink-800/80 border border-white/5 rounded-2xl p-5">
                <div className="flex items-center gap-2 mb-4">
                  <TrendingUp size={17} className="text-sky-400" />
                  <h3 className="font-display font-bold text-white text-sm">Distribusi Kategori</h3>
                </div>
                <div className="space-y-3">
                  {catDistribution.map((cat) => (
                    <div key={cat.category} className="flex items-center gap-3">
                      <p className="text-xs text-slate-400 w-28 shrink-0">{cat.label}</p>
                      <div className="flex-1 h-2 bg-ink-700 rounded-full overflow-hidden">
                        <div className="h-full bg-sky-400 rounded-full transition-all duration-500" style={{ width: `${cat.pct}%` }} />
                      </div>
                      <span className="text-xs text-slate-400 font-medium w-10 text-right">{cat.pct}%</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {!stats.diikuti && !stats.dimenangkan && !stats.dailyTasks && (
              <div className="text-center py-10 text-sm text-slate-500">Belum ada data statistik.</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function StatBar({ label, value, max, suffix = '', color }: { label: string; value: number; max: number; suffix?: string; color: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-sm text-slate-300">{label}</p>
        <p className="text-sm font-semibold text-white">{value.toLocaleString('id-ID')}{suffix}</p>
      </div>
      <div className="h-2 bg-ink-700 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all duration-700`} style={{ width: `${Math.max(pct, 2)}%` }} />
      </div>
    </div>
  );
}
