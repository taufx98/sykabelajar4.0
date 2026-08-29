import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { GraduationCap, Trophy, CalendarCheck, BarChart3, Award, ArrowRight, Sparkles, Users, ShieldCheck, Zap, Eye, School, UserRound, LogIn, UserPlus, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Avatar } from '@/components/ui/Avatar';
import { useApp } from '@/store/AppContext';
import { getPlatformStats, getPublicCompetitions, getPublicLeaderboard, type PlatformStats, type PublicLeaderboardRow } from '@/services/platform.service';
import { CATEGORY_LABELS } from '@/data/live';
import { RankBadge } from '@/components/ui/Badge';
import type { Competition } from '@/types';

function mapPublicCompetition(row: Record<string, unknown>): Competition {
  const status = String(row.status ?? 'PUBLISHED');
  return {
    id: String(row.id), slug: String(row.slug ?? ''), title: String(row.title ?? ''),
    category: String(row.category ?? 'mtk') as Competition['category'],
    posterUrl: row.poster_url ? String(row.poster_url) : undefined,
    shortDesc: String(row.short_description ?? ''), description: String(row.description ?? ''),
    juknis: row.juknis_url ? String(row.juknis_url) : '', juknisPdfUrl: row.juknis_url ? String(row.juknis_url) : undefined,
    prizes: [], points: 0, startDate: String(row.starts_at ?? ''), endDate: String(row.ends_at ?? ''),
    registrationDeadline: String(row.registration_ends_at ?? ''),
    status: status === 'REGISTRATION_OPEN' ? 'open' : status === 'LIVE' ? 'in-progress' : status === 'RESULT_PUBLISHED' || status === 'ARCHIVED' ? 'completed' : 'upcoming',
    participants: Number(row.participant_count ?? 0), level: 'Nasional', twibbonUrl: '', hasQuestions: false,
    featured: status === 'REGISTRATION_OPEN' || status === 'LIVE',
  };
}

export function LandingPage() {
  const navigate = useNavigate();
  const { user, isAuthenticated, authLoading, isGuest, loginAsGuest, logout, toast, certificates } = useApp();
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [leaderboard, setLeaderboard] = useState<PublicLeaderboardRow[]>([]);
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [loadingData, setLoadingData] = useState(true);

  useEffect(() => {
    let active = true;
    Promise.all([getPlatformStats(), getPublicLeaderboard(5), getPublicCompetitions(6)])
      .then(([nextStats, nextLeaderboard, nextCompetitions]) => {
        if (!active) return;
        setStats(nextStats);
        setLeaderboard(nextLeaderboard);
        setCompetitions(nextCompetitions.map(mapPublicCompetition).filter((c) => c.featured || c.status === 'open' || c.status === 'in-progress'));
      })
      .catch((error) => console.error('[SykaBelajar] landing live data failed', error))
      .finally(() => { if (active) setLoadingData(false); });
    return () => { active = false; };
  }, []);

  const handleGuest = () => {
    loginAsGuest();
    toast('Mode tamu aktif. Daftar untuk interaksi penuh.', 'info');
    navigate('/home');
  };

  const statValue = (value?: number) => loadingData ? '—' : Number(value ?? 0).toLocaleString('id-ID');
  const topUsers = useMemo(() => leaderboard.slice(0, 5), [leaderboard]);

  const loggedIn = !authLoading && isAuthenticated;
  const guest = !authLoading && isGuest;
  const showAuthButtons = !authLoading && !isAuthenticated && !isGuest;

  return (
    <div className="min-h-screen">
      {/* ═══ HEADER ═══ */}
      <header className="sticky top-0 z-30 glass border-b border-white/5">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl gradient-moss flex items-center justify-center shadow-glow">
              <GraduationCap size={20} className="text-white" />
            </div>
            <span className="font-display font-bold text-lg text-white">sykabelajar<span className="text-moss-400">.id</span></span>
          </div>

          {/* Header buttons based on auth state */}
          <div className="flex items-center gap-2">
            {authLoading ? (
              /* Loading: show skeleton */
              <div className="flex items-center gap-2">
                <div className="w-20 h-8 bg-white/5 rounded-lg animate-pulse" />
                <div className="w-24 h-8 bg-white/5 rounded-lg animate-pulse" />
              </div>
            ) : loggedIn && user ? (
              /* Logged in: show profile card + logout */
              <>
                <Link to={`/profile/${user.username}`} className="flex items-center gap-2.5 px-3 py-1.5 rounded-xl hover:bg-white/5 transition group">
                  <Avatar name={user.displayName} id={user.id} size={28} src={user.profilePhoto || undefined} />
                  <span className="text-sm text-white font-medium group-hover:text-moss-300 transition hidden sm:inline">{user.displayName}</span>
                </Link>
                <Link to="/home">
                  <Button size="sm" icon={<ArrowRight size={15} />}>Masuk ke Dashboard</Button>
                </Link>
              </>
            ) : showAuthButtons ? (
              /* Not logged in: show Masuk + Daftar */
              <>
                <Link to="/login"><Button variant="ghost" size="sm" icon={<LogIn size={15} />}>Masuk</Button></Link>
                <Link to="/register"><Button size="sm" icon={<UserPlus size={15} />}>Daftar Gratis</Button></Link>
              </>
            ) : (
              /* Guest mode: show profile + logout */
              <>
                <span className="text-sm text-slate-400 px-2">Mode Tamu</span>
                <Link to="/home"><Button size="sm" icon={<ArrowRight size={15} />}>Lanjutkan</Button></Link>
                <Button variant="ghost" size="sm" onClick={handleGuest} icon={<Eye size={15} />}>Ganti Tamu</Button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* ═══ HERO SECTION ═══ */}
      <section className="relative overflow-hidden">
        <div className="max-w-6xl mx-auto px-4 pt-16 pb-20 md:pt-24 md:pb-32">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div className="animate-slide-up">
              <div className="inline-flex items-center gap-2 chip bg-moss-500/10 text-moss-300 border border-moss-500/20 mb-6">
                <Sparkles size={14} /> Platform Uji Kompetensi Nasional Non-Formal
              </div>
              <h1 className="font-display font-extrabold text-4xl md:text-6xl text-white leading-[1.1] mb-6">
                Belajar Jadi Seru,<br />
                <span className="gradient-text">Uji Kompetensi Setiap Hari</span>
              </h1>
              <p className="text-slate-400 text-lg leading-relaxed mb-8 max-w-md">
                Ikuti uji kompetensi, kerjakan tantangan, bangun rekam prestasi, dan dapatkan sertifikat yang dapat diverifikasi publik.
              </p>

              {/* CTA buttons based on auth state */}
              <div className="flex flex-col sm:flex-row gap-3">
                {authLoading ? (
                  /* Loading: show skeleton */
                  <>
                    <div className="w-48 h-12 bg-white/5 rounded-xl animate-pulse" />
                    <div className="w-40 h-12 bg-white/5 rounded-xl animate-pulse" />
                  </>
                ) : loggedIn ? (
                  /* Logged in: single CTA */
                  <Link to="/home">
                    <Button size="lg" icon={<ArrowRight size={18} />}>Ikuti Lomba Sekarang</Button>
                  </Link>
                ) : showAuthButtons ? (
                  /* Not logged in: two CTAs */
                  <>
                    <Link to="/register">
                      <Button size="lg" icon={<ArrowRight size={18} />}>Mulai Sekarang — Gratis</Button>
                    </Link>
                    <Button variant="outline" size="lg" onClick={handleGuest} icon={<Eye size={18} />}>Lihat Sebagai Tamu</Button>
                  </>
                ) : (
                  /* Guest mode */
                  <Link to="/home">
                    <Button size="lg" icon={<ArrowRight size={18} />}>Mulai Menjelajahi</Button>
                  </Link>
                )}
              </div>

              {/* Stats */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mt-8">
                <Stat icon={<School size={18} />} value={statValue(stats?.total_schools)} label="Sekolah Terdaftar" />
                <Stat icon={<UserRound size={18} />} value={statValue(stats?.total_users)} label="User Terdaftar" />
                <Stat icon={<GraduationCap size={18} />} value={statValue(stats?.total_students)} label="Pelajar Terdaftar" />
                <Stat icon={<Trophy size={18} />} value={statValue(stats?.total_competitions)} label="Lomba Terdaftar" />
                <Stat icon={<Trophy size={18} />} value={statValue(stats?.total_public_competitions)} label="Lomba Publik" />
                <Stat icon={<Award size={18} />} value={statValue(stats?.total_certificates ?? certificates.length)} label="Sertifikat Terbit" />
              </div>
            </div>

            {/* Right side: leaderboard card */}
            <div className="relative animate-scale-in hidden md:block">
              <div className="absolute -inset-4 bg-moss-500/10 blur-3xl rounded-full" />
              <div className="relative card p-5">
                <div className="flex items-center gap-2 mb-4">
                  <BarChart3 size={18} className="text-moss-400" />
                  <h3 className="font-display font-semibold text-white">Papan Peringkat</h3>
                  <span className="ml-auto chip bg-moss-500/10 text-moss-300 text-[10px]">Live</span>
                </div>
                <div className="space-y-3">
                  {topUsers.length ? topUsers.map((u) => (
                    <div key={u.user_id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-white/5">
                      <RankBadge rank={u.rank} size="sm" />
                      <Avatar name={u.display_name} id={u.user_id} size={32} src={u.avatar_url ?? undefined} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-white truncate">{u.display_name}</p>
                        <p className="text-xs text-slate-500 truncate">{u.institution || '—'}</p>
                      </div>
                      <span className="text-sm font-semibold text-moss-300">{u.xp.toLocaleString('id-ID')}</span>
                    </div>
                  )) : <p className="text-sm text-slate-500 text-center py-8">Belum ada XP tercatat.</p>}
                </div>
              </div>
              <div className="absolute -bottom-6 -left-6 card p-3 animate-float">
                <div className="flex items-center gap-2">
                  <div className="w-10 h-10 rounded-lg bg-amber-500/20 flex items-center justify-center">
                    <Trophy size={18} className="text-amber-400" />
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Prestasi</p>
                    <p className="text-sm font-semibold text-white">Data live</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══ LOMBA SECTION ═══ */}
      <section className="max-w-6xl mx-auto px-4 py-16">
        <div className="flex items-end justify-between mb-8">
          <div>
            <h2 className="font-display font-bold text-2xl md:text-3xl text-white mb-2">Uji Kompetensi Unggulan</h2>
            <p className="text-slate-400">Lomba yang saat ini tersedia dari database.</p>
          </div>
        </div>
        <div className="grid md:grid-cols-2 gap-5">
          {competitions.length ? competitions.slice(0, 6).map((c) => (
            <Link key={c.id} to={`/lomba/${c.slug}`} className="card card-hover p-0 overflow-hidden group">
              <div className="h-40 bg-gradient-to-br from-ink-700 to-ink-850 relative">
                {c.posterUrl ? <img src={c.posterUrl} alt={c.title} className="w-full h-full object-cover opacity-50 group-hover:opacity-60 transition" /> : <div className="w-full h-full flex items-center justify-center"><Trophy size={40} className="text-moss-400/60" /></div>}
                <div className="absolute inset-0 bg-gradient-to-t from-ink-900 to-transparent" />
                <div className="absolute top-3 left-3 chip bg-moss-500/20 text-moss-300 border border-moss-500/30">{CATEGORY_LABELS[c.category] || c.category}</div>
                <div className="absolute top-3 right-3 chip bg-black/40 text-white"><Users size={12} /> {c.participants.toLocaleString('id-ID')}</div>
              </div>
              <div className="p-5">
                <h3 className="font-display font-semibold text-lg text-white mb-2 group-hover:text-moss-300 transition">{c.title}</h3>
                <p className="text-sm text-slate-400 line-clamp-2 mb-4">{c.shortDesc}</p>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-moss-300 font-semibold">{c.status === 'open' ? 'Pendaftaran dibuka' : c.status === 'in-progress' ? 'Sedang berlangsung' : 'Informasi lomba'}</span>
                  <span className="text-xs text-slate-500 flex items-center gap-1">Lihat detail <ArrowRight size={14} /></span>
                </div>
              </div>
            </Link>
          )) : (
            <div className="md:col-span-2 card p-8 text-center">
              <Trophy size={28} className="mx-auto text-slate-600 mb-3" />
              <p className="text-sm text-slate-500">{loadingData ? 'Memuat data lomba...' : 'Belum ada lomba publik yang tersedia.'}</p>
            </div>
          )}
        </div>
      </section>

      {/* ═══ FEATURES ═══ */}
      <section className="max-w-6xl mx-auto px-4 py-16">
        <h2 className="font-display font-bold text-2xl md:text-3xl text-white text-center mb-12">Kenapa sykabelajar.id?</h2>
        <div className="grid md:grid-cols-3 gap-5">
          {[
            { icon: Trophy, title: 'Uji Kompetensi', desc: 'Discovery lomba dan kompetisi berdasarkan data yang dipublikasikan penyelenggara.' },
            { icon: CalendarCheck, title: 'Daily Tasks', desc: 'Aktivitas harian akan tersedia berdasarkan konfigurasi backend.' },
            { icon: BarChart3, title: 'Leaderboard', desc: 'Peringkat dibangun dari ledger XP, bukan angka statis di frontend.' },
            { icon: Award, title: 'Sertifikat & Emblem', desc: 'Prestasi berasal dari awards dan certificate yang tersimpan di backend.' },
            { icon: ShieldCheck, title: 'Verifikasi Publik', desc: 'Kode verifikasi sertifikat dapat ditampilkan melalui jalur publik terbatas.' },
            { icon: Zap, title: 'Gamifikasi', desc: 'XP dan Edu Coin dipisahkan sesuai arsitektur ledger RPD.' },
          ].map((f) => {
            const Icon = f.icon;
            return (
              <div key={f.title} className="card p-6 hover:border-moss-500/20 transition">
                <div className="w-12 h-12 rounded-xl bg-moss-500/10 flex items-center justify-center mb-4">
                  <Icon size={22} className="text-moss-400" />
                </div>
                <h3 className="font-display font-semibold text-lg text-white mb-2">{f.title}</h3>
                <p className="text-sm text-slate-400 leading-relaxed">{f.desc}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* ═══ CTA SECTION ═══ */}
      <section className="max-w-6xl mx-auto px-4 py-16">
        <div className="card p-8 md:p-12 text-center relative overflow-hidden">
          <div className="absolute -inset-20 bg-moss-500/5 blur-3xl" />
          <div className="relative">
            <h2 className="font-display font-bold text-2xl md:text-4xl text-white mb-4">Siap Beruji Kompetensi?</h2>
            <p className="text-slate-400 mb-8 max-w-lg mx-auto">Buat akun dan mulai menggunakan data, lomba, serta rekam prestasi yang tersimpan secara nyata.</p>

            {/* CTA based on auth state */}
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              {loggedIn ? (
                <Link to="/home">
                  <Button size="lg" icon={<ArrowRight size={18} />}>Ikuti Lomba Sekarang</Button>
                </Link>
              ) : showAuthButtons ? (
                <>
                  <Link to="/register">
                    <Button size="lg" icon={<ArrowRight size={18} />}>Daftar Sekarang</Button>
                  </Link>
                  <Button variant="outline" size="lg" onClick={handleGuest} icon={<Eye size={18} />}>Lihat sebagai Tamu</Button>
                </>
              ) : (
                <Link to="/home">
                  <Button size="lg" icon={<ArrowRight size={18} />}>Mulai Menjelajahi</Button>
                </Link>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ═══ FOOTER ═══ */}
      <footer className="border-t border-white/5 py-8">
        <div className="max-w-6xl mx-auto px-4 text-center text-sm text-slate-600">
          sykabelajar.id © 2026 — Platform Uji Kompetensi Nasional Non-Formal
        </div>
      </footer>
    </div>
  );
}

function Stat({ icon, value, label }: { icon: React.ReactNode; value: string; label: string }) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <div className="w-9 h-9 rounded-lg bg-moss-500/10 flex items-center justify-center text-moss-400 shrink-0">{icon}</div>
      <div className="min-w-0">
        <p className="text-xl font-bold text-white tabular-nums">{value}</p>
        <p className="text-[10px] text-slate-500 whitespace-nowrap truncate">{label}</p>
      </div>
    </div>
  );
}
