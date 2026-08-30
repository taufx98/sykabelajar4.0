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
import { uploadProfileImage } from '@/services/cloudinary.service';
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

        const { data: lb } = await supabase.rpc('get_public_leaderboard', { p_limit: 100 });
        const userRow = (lb ?? []).find((r: any) => String(r.user_id) === String(p.id));
        const xp = Number(userRow?.xp ?? 0);
        const userRank = Number(userRow?.rank ?? 0);

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
              id: r.id, competitionId: r.competition_id, status: r.status, submittedAt: r.submitted_at,
              title: comp?.title || 'Lomba', category: comp?.category || '',
              posterUrl: comp?.poster_url || null, competitionStatus: comp?.status || '',
              score: null, rank: null,
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
      const coverPublicId = oldCoverId || `sykabelajar/${profile.username}/cover`;
      const result = await uploadProfileImage(file, 'cover', profile.username, coverPublicId);
      const { error } = await supabase.from('profiles').update({
        cover_url: result.secure_url, cover_public_id: result.public_id,
        updated_at: new Date().toISOString(),
      }).eq('id', currentUser.id);
      if (error) throw error;
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

  if (loading) return (
    <div className="p-6 text-sm text-fg-muted">Memuat profil…</div>
  );
  if (!profile) return (
    <div className="p-6"><Card className="p-8 text-center text-fg-muted">Profil tidak ditemukan.</Card></div>
  );

  // Grade label
  const gradeLabel = (() => {
    const g = profile.grade || '';
    const found = GRADE_OPTIONS.find(o => o.value === g);
    if (found) return found.label;
    if (g === 'sd') return 'SD'; if (g === 'smp') return 'SMP';
    if (g === 'sma') return 'SMA'; if (g === 'alumni') return 'Alumni';
    return g || '';
  })();

  const emblems = profile.emblems ?? [];
  const badgeShowcase: string[] = profile.badge_showcase ?? [];
  const badgeShowcaseManual = profile.badge_showcase_manual ?? false;
  const displayBadges = badgeShowcaseManual && badgeShowcase.length > 0
    ? badgeShowcase
    : (profile.badges ?? []).slice(0, 3);
  const favoriteCategories = (profile.subjects ?? '').split(',').map((s: string) => s.trim()).filter(Boolean);

  return (
    <div className="w-full">
      {/* ════════════════════════════════════════════════════════════
           COVER — full width
         ════════════════════════════════════════════════════════════ */}
      <div className="relative h-32 md:h-44 surface-bg overflow-hidden">
        {profile.cover_url && (
          <img src={profile.cover_url} alt="" className="w-full h-full object-cover" />
        )}
        {/* Gradient overlay at bottom for text readability */}
        <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-surface to-transparent" />
        {isOwn && (
          <label className="absolute bottom-3 right-3 px-3 py-1.5 rounded-lg bg-black/50 backdrop-blur-sm text-[11px] text-white cursor-pointer hover:bg-black/70 transition z-10">
            Ganti Sampul
            <input type="file" accept="image/*" className="hidden" onChange={uploadCover} />
          </label>
        )}
      </div>

      {/* ════════════════════════════════════════════════════════════
           PROFILE HEADER — full width, centered
         ════════════════════════════════════════════════════════════ */}
      <div className="px-4 md:px-8 -mt-14 md:-mt-16 relative text-center pb-4 md:pb-6">
        {/* Avatar — overlaps cover */}
        <div className="flex justify-center">
          <div className="relative">
            <Avatar
              name={profile.full_name || profile.username || 'U'}
              id={profile.id} size={88} ring
              src={profile.avatar_url || undefined}
            />
            {/* Online indicator */}
            <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-green-500 border-2 surface-bg" />
          </div>
        </div>

        {/* Name + verified */}
        <div className="flex items-center justify-center gap-1.5 mt-3">
          <h1 className="font-display text-xl md:text-2xl font-bold text-fg">
            {profile.full_name || profile.username}
          </h1>
          {profile.status === 'ACTIVE' && <CheckCircle2 size={18} className="text-accent" />}
        </div>

        {/* Username */}
        <p className="text-sm text-fg-muted mt-0.5">@{profile.username}</p>

        {/* Bio */}
        {profile.bio && (
          <p className="text-sm text-fg-secondary mt-2 max-w-lg mx-auto leading-relaxed">
            {profile.bio}
          </p>
        )}

        {/* Metadata row */}
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 mt-3 text-[11px] text-fg-muted">
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
              <Calendar size={12} /> Lahir{' '}
              {new Date(profile.birth_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}
            </span>
          )}
        </div>

        {profile.pembina && (
          <p className="text-[11px] text-fg-muted mt-1.5 flex items-center justify-center gap-1">
            <User size={12} /> Pembina: {profile.pembina}
          </p>
        )}

        {/* Following / Followers */}
        <div className="flex items-center justify-center gap-6 mt-3">
          <span className="text-sm">
            <span className="font-bold text-fg">{following}</span>{' '}
            <span className="text-fg-muted">Mengikuti</span>
          </span>
          <span className="text-sm">
            <span className="font-bold text-fg">{followers}</span>{' '}
            <span className="text-fg-muted">Pengikut</span>
          </span>
        </div>

        {/* Action button */}
        <div className="flex justify-center mt-4">
          {isOwn ? (
            <Link to="/profile/edit">
              <Button size="sm" variant="outline" icon={<Edit2 size={14} />}>Edit Profil</Button>
            </Link>
          ) : currentUser ? (
            <Button
              size="sm"
              variant={isFollowing ? 'outline' : 'primary'}
              onClick={toggleFollow}
              disabled={followBusy}
              icon={isFollowing ? <UserMinus size={14} /> : <UserPlus size={14} />}
            >
              {isFollowing ? 'Unfollow' : 'Follow'}
            </Button>
          ) : null}
        </div>
      </div>

      {/* ════════════════════════════════════════════════════════════
           STATS ROW — 3 mini cards, always horizontal
         ════════════════════════════════════════════════════════════ */}
      <div className="px-4 md:px-8 pb-2">
        <div className="grid grid-cols-3 gap-3 max-w-2xl mx-auto">
          <div className="surface-card-bg border surface-border rounded-2xl p-4 text-center transition-colors duration-300">
            <p className="text-xl font-bold text-fg">{totalPoints.toLocaleString('id-ID')}</p>
            <p className="text-[10px] text-fg-muted mt-0.5">Total Poin</p>
          </div>
          <div className="surface-card-bg border surface-border rounded-2xl p-4 text-center transition-colors duration-300">
            <div className="w-8 h-8 rounded-full bg-accent-muted flex items-center justify-center mx-auto mb-1">
              <span className="text-sm font-bold text-accent">{rank || '—'}</span>
            </div>
            <p className="text-[10px] text-fg-muted">Peringkat #{rank || '—'}</p>
          </div>
          <div className="surface-card-bg border surface-border rounded-2xl p-4 text-center transition-colors duration-300">
            <p className="text-xl font-bold text-fg">{awards.length}</p>
            <p className="text-[10px] text-fg-muted mt-0.5">Awards</p>
          </div>
        </div>
      </div>

      {/* ════════════════════════════════════════════════════════════
           DESKTOP: 2-COLUMN LAYOUT | MOBILE: STACKED
         ════════════════════════════════════════════════════════════ */}
      <div className="px-4 md:px-8 py-4">
        <div className="max-w-6xl mx-auto flex flex-col lg:flex-row gap-5">

          {/* ═══ LEFT SIDEBAR (35%) — Emblems, Badges, Categories ═══ */}
          <aside className="w-full lg:w-[35%] lg:max-w-xs space-y-3 shrink-0 order-2 lg:order-1">
            {/* Emblems */}
            {emblems.length > 0 && (
              <Card className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Award size={16} className="text-accent" />
                  <h3 className="text-sm font-bold text-fg">Emblem ({emblems.length})</h3>
                </div>
                <div className="flex gap-2.5">
                  {emblems.slice(0, 6).map((e: any, i: number) => (
                    <div key={i} className="w-10 h-10 rounded-xl bg-accent-muted flex items-center justify-center">
                      <Award size={18} className="text-accent" />
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {/* Badges */}
            {displayBadges.length > 0 && (
              <Card className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Award size={16} className="text-accent" />
                  <h3 className="text-sm font-bold text-fg">Badge</h3>
                </div>
                <div className="flex flex-wrap gap-2">
                  {displayBadges.map((b: string, i: number) => (
                    <span key={i} className="chip">{b}</span>
                  ))}
                </div>
              </Card>
            )}

            {/* Favorite Categories */}
            {favoriteCategories.length > 0 && (
              <Card className="p-4">
                <h3 className="text-sm font-bold text-fg mb-3">Kategori Favorit</h3>
                <div className="flex flex-wrap gap-2">
                  {favoriteCategories.map((cat: string, i: number) => (
                    <span key={i} className="chip">{CATEGORY_LABELS[cat] || cat}</span>
                  ))}
                </div>
              </Card>
            )}
          </aside>

          {/* ═══ RIGHT MAIN (65%) — Tabs + Content ═══ */}
          <div className="flex-1 min-w-0 order-1 lg:order-2">
            {/* Tab navigation */}
            <div className="border-b surface-border mb-4 -mx-1">
              <div className="flex overflow-x-auto no-scrollbar gap-0">
                {([['prestasi', 'Prestasi'], ['lomba', 'Lomba'], ['statistik', 'Statistik']] as const).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setActiveTab(key)}
                    className={`relative px-5 py-3 text-sm font-medium transition whitespace-nowrap ${
                      activeTab === key
                        ? 'text-accent'
                        : 'text-fg-muted hover:text-fg-secondary'
                    }`}
                  >
                    {label}
                    {activeTab === key && (
                      <div className="absolute bottom-0 left-2 right-2 h-0.5 bg-accent rounded-full" />
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* ── PRESTASI ── */}
            {activeTab === 'prestasi' && (
              <div className="space-y-3">
                {awards.map((a: any) => (
                  <Card key={a.id} className="p-4 transition-colors duration-300">
                    <div className="flex items-center gap-3">
                      <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${
                        a.rank_code === '1' ? 'bg-amber-500/15' :
                        a.rank_code === '2' ? 'bg-slate-400/15' :
                        a.rank_code === '3' ? 'bg-orange-500/15' :
                        'bg-accent-muted'
                      }`}>
                        <Award size={18} className={
                          a.rank_code === '1' ? 'text-amber-400' :
                          a.rank_code === '2' ? 'text-slate-300' :
                          a.rank_code === '3' ? 'text-orange-400' :
                          'text-accent'
                        } />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-fg truncate">{a.title}</p>
                        <p className="text-xs text-fg-muted">{a.subtitle || a.rank_code || 'Penghargaan'}</p>
                        {a.emblem_url && (
                          <div className="flex items-center gap-1.5 mt-1.5">
                            <span className="text-[10px] text-fg-muted">Emblem:</span>
                            <div className="w-5 h-5 rounded-full bg-accent-muted flex items-center justify-center">
                              <Award size={10} className="text-accent" />
                            </div>
                          </div>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-bold text-accent">+{a.points ?? 0}</p>
                        <p className="text-[10px] text-fg-muted mt-0.5">{a.issued_at ? formatShortDate(a.issued_at) : '—'}</p>
                      </div>
                    </div>
                  </Card>
                ))}
                {!awards.length && (
                  <div className="text-center py-10 text-sm text-fg-muted">Belum ada penghargaan.</div>
                )}
              </div>
            )}

            {/* ── LOMBA ── */}
            {activeTab === 'lomba' && (
              <div className="space-y-3">
                {compLoading && <div className="text-center py-10 text-sm text-fg-muted">Memuat lomba…</div>}
                {!compLoading && !competitions.length && (
                  <div className="text-center py-10 text-sm text-fg-muted">Belum ada lomba yang diikuti.</div>
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
                      <Card className="p-4 flex items-center gap-4 transition-colors duration-300 hover:border-accent/30">
                        <div className="w-12 h-12 rounded-xl surface-elevated overflow-hidden shrink-0 flex items-center justify-center">
                          {comp.posterUrl ? (
                            <img src={comp.posterUrl} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <Trophy size={20} className="text-accent/40" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-fg truncate">{comp.title}</p>
                          <p className="text-[11px] text-fg-muted">{CATEGORY_LABELS[comp.category] || comp.category || 'Umum'}</p>
                        </div>
                        <Badge color={statusColor}>{statusLabel}</Badge>
                      </Card>
                    </Link>
                  );
                })}
              </div>
            )}

            {/* ── STATISTIK ── */}
            {activeTab === 'statistik' && (
              <div className="space-y-4">
                <Card className="p-5 transition-colors duration-300">
                  <div className="flex items-center gap-2 mb-4">
                    <BarChart3 size={17} className="text-accent" />
                    <h3 className="font-display font-bold text-fg text-sm">Statistik Performa</h3>
                  </div>
                  <div className="space-y-4">
                    <StatBar label="Uji kompetensi diikuti" value={stats.diikuti} max={Math.max(stats.diikuti, stats.dimenangkan * 3, 10)} color="bg-accent" />
                    <StatBar label="Uji kompetensi dimenangkan" value={stats.dimenangkan} max={Math.max(stats.diikuti, stats.dimenangkan * 3, 10)} color="bg-sky-400" />
                    <StatBar label="Daily tasks selesai" value={stats.dailyTasks} max={Math.max(stats.dailyTasks, 50)} color="bg-accent" />
                    <StatBar label="Rata-rata skor" value={stats.avgScore} max={100} suffix="%" color="bg-accent" />
                  </div>
                </Card>

                {catDistribution.length > 0 && (
                  <Card className="p-5 transition-colors duration-300">
                    <div className="flex items-center gap-2 mb-4">
                      <TrendingUp size={17} className="text-sky-400" />
                      <h3 className="font-display font-bold text-fg text-sm">Distribusi Kategori</h3>
                    </div>
                    <div className="space-y-3">
                      {catDistribution.map((cat) => (
                        <div key={cat.category} className="flex items-center gap-3">
                          <p className="text-xs text-fg-muted w-28 shrink-0">{cat.label}</p>
                          <div className="flex-1 h-2 surface-elevated rounded-full overflow-hidden">
                            <div className="h-full bg-sky-400 rounded-full transition-all duration-500" style={{ width: `${cat.pct}%` }} />
                          </div>
                          <span className="text-xs text-fg-muted font-medium w-10 text-right">{cat.pct}%</span>
                        </div>
                      ))}
                    </div>
                  </Card>
                )}

                {!stats.diikuti && !stats.dimenangkan && !stats.dailyTasks && (
                  <div className="text-center py-10 text-sm text-fg-muted">Belum ada data statistik.</div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatBar({ label, value, max, suffix = '', color }: { label: string; value: number; max: number; suffix?: string; color: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-sm text-fg-secondary">{label}</p>
        <p className="text-sm font-semibold text-fg">{value.toLocaleString('id-ID')}{suffix}</p>
      </div>
      <div className="h-2 surface-elevated rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all duration-700`} style={{ width: `${Math.max(pct, 2)}%` }} />
      </div>
    </div>
  );
}
