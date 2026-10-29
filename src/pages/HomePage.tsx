import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { Calendar, ChevronRight, FileText, Flame, Heart, MessageCircle, Search, Share2, Sparkles, Trophy } from 'lucide-react';
import { BannerCarousel } from '@/components/ui/BannerCarousel';
import { MobileHomeAdsPopup } from '@/components/ui/MobileHomeAdsPopup';
import { Link, useNavigate } from 'react-router-dom';
import { useApp } from '@/store/AppContext';
import { useLanguage } from '@/lib/LanguageContext';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { CommentsSection } from '@/components/ui/Comments';
import { Skeleton, SkeletonCard } from '@/components/ui/Skeleton';
import { listPublishedPostsPage, togglePostLike, type SocialPost } from '@/services/social.service';
import { getHomeSnapshot } from '@/services/platform.service';
import { listUpcomingPublicCompetitionDeadlines } from '@/services/competition.service';
import { timeAgo } from '@/lib/utils';
import type { HomeSnapshot, PublicLeaderboardRow } from '@/services/platform.service';
import { supabase } from '@/lib/supabase';
import { optimizedCloudinaryUrl } from '@/services/cloudinary.service';

type HomeCompetition = {
  id: string;
  title: string;
  slug: string;
  category: string;
  organizer_name: string;
  organizer_photo_url: string | null;
  short_description: string;
  poster_url: string | null;
  participant_count: number;
  participants_count: number;
  status: string;
  deadline: string;
  registration_end: string;
  registration_starts_at: string | null;
  registration_ends_at: string | null;
  starts_at: string | null;
  ends_at: string | null;
  announcement_at: string | null;
};
type HomeFeedRow = HomeSnapshot['feed'][number];
const readString=(row:Record<string,unknown>,key:string,fallback=''):string=>row[key]==null?fallback:String(row[key]);
const readNullableString=(row:Record<string,unknown>,key:string):string|null=>row[key]==null?null:String(row[key]);
const readNumber=(row:Record<string,unknown>,key:string,fallback=0):number=>{const value=Number(row[key]??fallback);return Number.isFinite(value)?value:fallback;};
const normalizeCompetition = (row: Record<string, unknown>): HomeCompetition => {
  const participants = readNumber(row, 'participants_count', readNumber(row, 'participant_count'));
  return {
    id: readString(row, 'id'),
    title: readString(row, 'title'),
    slug: readString(row, 'slug'),
    category: readString(row, 'category', 'Kompetisi'),
    organizer_name: readString(row, 'organizer_name', 'Penyelenggara'),
    organizer_photo_url: readNullableString(row, 'organizer_photo_url'),
    short_description: readString(row, 'short_description'),
    poster_url: readNullableString(row, 'poster_url'),
    participant_count: participants,
    participants_count: participants,
    status: readString(row, 'status'),
    deadline: readString(row, 'deadline', readString(row, 'registration_ends_at', readString(row, 'registration_end'))),
    registration_end: readString(row, 'registration_end', readString(row, 'registration_ends_at')),
    registration_starts_at: readNullableString(row, 'registration_starts_at'),
    registration_ends_at: readNullableString(row, 'registration_ends_at') ?? readNullableString(row, 'registration_end'),
    starts_at: readNullableString(row, 'starts_at'),
    ends_at: readNullableString(row, 'ends_at'),
    announcement_at: readNullableString(row, 'announcement_at'),
  };
};

type CompetitionPhase = {
  label: string;
  tone: 'open' | 'upcoming' | 'closed' | 'running' | 'waiting' | 'result' | 'finished' | 'unavailable';
};

function getCompetitionPhase(competition: HomeCompetition, now: number): CompetitionPhase {
  const status = String(competition.status ?? '').toUpperCase();
  const time = (value: string | null | undefined): number | null => {
    if (!value) return null;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const registrationStart = time(competition.registration_starts_at);
  const registrationEnd = time(competition.registration_ends_at);
  const competitionStart = time(competition.starts_at);
  const competitionEnd = time(competition.ends_at);
  const announcement = time(competition.announcement_at);

  if (status === 'CANCELLED') return { label: 'Dibatalkan', tone: 'unavailable' };
  if (status === 'SUSPENDED') return { label: 'Tidak tersedia', tone: 'unavailable' };
  if (status === 'RESULT_PUBLISHED') return { label: 'Hasil diumumkan', tone: 'result' };
  if (status === 'ARCHIVED') return { label: 'Selesai', tone: 'finished' };

  // The schedule takes precedence over a stale state label so the home card
  // reflects which phase is actually active at the current local time.
  if (competitionStart !== null && competitionEnd !== null && now >= competitionStart && now < competitionEnd) {
    return { label: 'Sedang berlangsung', tone: 'running' };
  }
  if (competitionEnd !== null && now >= competitionEnd) {
    if (status === 'SUBMISSION_CLOSED' || status === 'GRADING' || announcement !== null) {
      return { label: 'Menunggu pengumuman', tone: 'waiting' };
    }
    return { label: 'Uji kompetensi selesai', tone: 'finished' };
  }
  if (registrationStart !== null && now < registrationStart) {
    return { label: 'Segera dibuka', tone: 'upcoming' };
  }
  if (registrationEnd !== null && now > registrationEnd && (competitionStart === null || now < competitionStart)) {
    return { label: 'Pendaftaran ditutup', tone: 'closed' };
  }
  if (
    (registrationStart !== null || registrationEnd !== null) &&
    (registrationStart === null || now >= registrationStart) &&
    (registrationEnd === null || now <= registrationEnd) &&
    (competitionStart === null || now < competitionStart)
  ) {
    return { label: 'Pendaftaran dibuka', tone: 'open' };
  }

  switch (status) {
    case 'REGISTRATION_OPEN': return { label: 'Pendaftaran dibuka', tone: 'open' };
    case 'REGISTRATION_CLOSED': return { label: 'Pendaftaran ditutup', tone: 'closed' };
    case 'LIVE': return { label: 'Sedang berlangsung', tone: 'running' };
    case 'SUBMISSION_CLOSED':
    case 'GRADING': return { label: 'Menunggu pengumuman', tone: 'waiting' };
    case 'PUBLISHED': return { label: 'Segera dibuka', tone: 'upcoming' };
    default: return { label: 'Jadwal belum tersedia', tone: 'finished' };
  }
}

function CompetitionPhaseBadge({ competition, now }: { competition: HomeCompetition; now: number }) {
  const phase = getCompetitionPhase(competition, now);
  const { language } = useLanguage();
  const englishPhase: Record<CompetitionPhase['tone'], string> = { open: 'Registration open', upcoming: 'Coming soon', closed: 'Registration closed', running: 'In progress', waiting: 'Awaiting results', result: 'Results published', finished: 'Finished', unavailable: 'Unavailable' };
  const styles: Record<CompetitionPhase['tone'], { badge: string; dot: string }> = {
    open: { badge: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400', dot: 'bg-emerald-400 animate-pulse' },
    upcoming: { badge: 'border-blue-500/25 bg-blue-500/10 text-blue-400', dot: 'bg-blue-400' },
    closed: { badge: 'border-amber-500/25 bg-amber-500/10 text-amber-400', dot: 'bg-amber-400' },
    running: { badge: 'border-sky-500/25 bg-sky-500/10 text-sky-400', dot: 'bg-sky-400 animate-pulse' },
    waiting: { badge: 'border-violet-500/25 bg-violet-500/10 text-violet-400', dot: 'bg-violet-400' },
    result: { badge: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-400', dot: 'bg-emerald-400' },
    finished: { badge: 'border-slate-500/20 bg-slate-500/10 text-slate-400', dot: 'bg-slate-400' },
    unavailable: { badge: 'border-rose-500/25 bg-rose-500/10 text-rose-400', dot: 'bg-rose-400' },
  };
  const style = styles[phase.tone];
  return <span className={'ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold leading-none ' + style.badge}>
    <span className={'h-1.5 w-1.5 rounded-full ' + style.dot} />
    {language === 'en' ? englishPhase[phase.tone] : phase.label}
  </span>;
}
const normalizeHomeFeedRow=(row:HomeFeedRow):SocialPost=>({id:readString(row,'id'),author_user_id:readString(row,'author_user_id'),author_name:readString(row,'author_name','Pengguna'),author_username:readString(row,'author_username'),avatar_url:readNullableString(row,'avatar_url'),title:readString(row,'title'),body:readString(row,'body'),cover_url:readNullableString(row,'cover_url'),created_at:readString(row,'created_at'),competition_id:readNullableString(row,'competition_id'),competition_slug:readNullableString(row,'competition_slug'),likes:readNumber(row,'likes'),liked:Boolean(row.liked),comments:readNumber(row,'comments')});
const errorMessage=(error:unknown,fallback:string):string=>error instanceof Error?error.message:fallback;

export function HomePage(){
 const{user,isGuest,notifications,toast}=useApp();const {t,language}=useLanguage();const navigate=useNavigate();const[tab,setTab]=useState<'lomba'|'prestasi'>('lomba');const[posts,setPosts]=useState<SocialPost[]>([]);const[competitions,setCompetitions]=useState<HomeCompetition[]>([]);const[deadlineCompetitions,setDeadlineCompetitions]=useState<HomeCompetition[]>([]);const[leaders,setLeaders]=useState<PublicLeaderboardRow[]>([]);const[loading,setLoading]=useState(true);const[deadlinesLoading,setDeadlinesLoading]=useState(true);const[loadingMore,setLoadingMore]=useState(false);const[cursor,setCursor]=useState<string|null>(null);const[expanded,setExpanded]=useState<string|null>(null);const[searchQuery,setSearchQuery]=useState('');const[leaderMode,setLeaderMode]=useState<'xp'|'coin'>('xp');const[coinLeaders,setCoinLeaders]=useState<HomeSnapshot['coin_leaderboard']>([]);const[showAllPosts,setShowAllPosts]=useState(false);const[mobilePage,setMobilePage]=useState(1);const[phaseClock,setPhaseClock]=useState(Date.now());
 useEffect(()=>{const handler=(e:MouseEvent)=>{if(searchQuery&&!(e.target as HTMLElement).closest('[data-search]'))setSearchQuery('')};document.addEventListener('mousedown',handler);return()=>document.removeEventListener('mousedown',handler)},[searchQuery]);
 useEffect(()=>{
  let active=true;
  setLoading(true);
  setDeadlinesLoading(true);
  void listUpcomingPublicCompetitionDeadlines(10)
   .then((deadlineRows)=>{if(active)setDeadlineCompetitions(deadlineRows.map(normalizeCompetition))})
   .catch(()=>{if(active)setDeadlineCompetitions([])})
   .finally(()=>{if(active)setDeadlinesLoading(false)});
  void getHomeSnapshot(15)
   .then((home)=>{
    if(!active)return;
    const feedRows=home.feed;
    const initialPosts=feedRows.slice(0,15).map(normalizeHomeFeedRow);
    const snapshotCompetitions=home.competitions.map(normalizeCompetition);
    setPosts(initialPosts);
    setCursor(feedRows.length>15?String(feedRows[14]?.created_at??''):null);
    setCompetitions(snapshotCompetitions);
    setLeaders(home.leaderboard);
    setCoinLeaders(home.coin_leaderboard);
   })
   .catch((error:unknown)=>{if(active)toast(errorMessage(error,'Beranda gagal dimuat.'),'error')})
   .finally(()=>{if(active)setLoading(false)});
  return()=>{active=false};
 },[toast]);
 useEffect(()=>{const timer=window.setInterval(()=>setPhaseClock(Date.now()),30000);return()=>window.clearInterval(timer)},[]);
 const loadMore=async()=>{if(!cursor||loadingMore)return;setLoadingMore(true);try{const{items,nextCursor}=await listPublishedPostsPage(15,cursor);setPosts(p=>[...p,...items]);setCursor(nextCursor)}catch(error:unknown){toast(errorMessage(error,'Feed gagal dimuat.'),'error')}finally{setLoadingMore(false)}};
 const searchResults=useMemo(()=>{if(!searchQuery.trim())return[];const q=searchQuery.normalize('NFD').replace(/\u0300-\u036f/g,'').toLowerCase();const norm=(s:string)=>String(s??'').normalize('NFD').replace(/\u0300-\u036f/g,'').toLowerCase();const searchableCompetitions=[...competitions,...deadlineCompetitions.filter((item)=>!competitions.some((current)=>current.id===item.id))];const compResults=searchableCompetitions.filter((c)=>norm(c.title).includes(q)||norm(c.slug).includes(q)||norm(c.category).includes(q)||norm(c.organizer_name).includes(q)).map((c)=>({id:c.id,title:c.title,slug:c.slug,type:'competition' as const,subtitle:c.category||'Lomba',avatar_url:c.poster_url||null}));const postResults=posts.filter((p)=>norm(p.title).includes(q)||norm(p.body).includes(q)).map((p)=>({id:p.id,title:p.title,slug:'',type:'post' as const,subtitle:'Postingan',avatar_url:p.cover_url||null}));return[...compResults,...postResults].slice(0,10);},[searchQuery,competitions,deadlineCompetitions,posts]);
 const lombaPosts=useMemo(()=>posts.filter(p=>Boolean(p.competition_id)),[posts]);
const prestasiPosts=useMemo(()=>posts.filter(p=>!p.competition_id),[posts]);
const showCompetitions=tab==='lomba'&&lombaPosts.length===0&&competitions.length>0;const unread=notifications.filter(n=>!n.read).slice(0,5);const nextCompetition=competitions.find((c)=>['REGISTRATION_OPEN','LIVE'].includes(String(c.status)))??competitions[0];
 const upcomingDeadlines=useMemo(()=>deadlineCompetitions.map((competition)=>({competition,deadlineAt:Date.parse(competition.registration_ends_at||competition.registration_end||competition.deadline||'')})).filter((item)=>Number.isFinite(item.deadlineAt)&&item.deadlineAt>=phaseClock).sort((a,b)=>a.deadlineAt-b.deadlineAt).slice(0,3),[deadlineCompetitions,phaseClock]);
 const like=async(id:string)=>{if(isGuest||!user){toast('Masuk untuk menyukai postingan.','info');return;}try{await togglePostLike(id);setPosts(current=>current.map(post=>post.id===id?{...post,liked:!post.liked,likes:Math.max(0,post.likes+(post.liked?-1:1))}:post));}catch(error:unknown){toast(errorMessage(error,'Gagal memperbarui like.'),'error')}};
 // Running text announcements — TODO: connect to admin settings / platform_settings table
const runningTexts = [
  'Selamat datang di sykabelajar.id — Platform Uji Kompetensi & Gamifikasi Edukasi',
  'Daftar sekarang dan ikuti uji kompetensi terbaru!',
  'Selesaikan daily tasks untuk mendapatkan XP dan naik peringkat',
  'Ikuti kompetisi terbaru dan raih prestasi terbaikmu',
];
const displayedRunningTexts = language === 'en'
  ? ['Welcome to sykabelajar.id — Competency Tests & Educational Gamification', 'Register and join the latest competitions!', 'Complete daily tasks to earn XP and climb the leaderboard', 'Join the latest competitions and celebrate your achievements']
  : runningTexts;
const sharePost=async(post:SocialPost)=>{const url=new URL(window.location.href);if(post.competition_slug)url.hash=`/lomba/${post.competition_slug}`;else url.hash=`/feed?post=${encodeURIComponent(post.id)}`;try{await navigator.clipboard?.writeText(url.toString());toast('Tautan postingan disalin.','success')}catch{toast('Tidak dapat menyalin tautan.','error')}};
 // Ensure short Home pages can scroll the top banner completely out of view.
 return (
    <div style={{ minHeight: 'calc(100dvh + 16rem)' }}>
      <MobileHomeAdsPopup />
      {/* Banner gambar sengaja non-sticky agar keluar dari viewport saat pengguna scroll. */}
      <div className="!static px-4 py-2" data-home-top-banner><BannerCarousel placement="home_top" /></div>
      {/* Di mobile ticker berada di bawah header global; desktop Home tidak memakai GlobalHeader. */}
      <div className="sticky top-[56px] md:top-0 z-40 isolate glass border-b surface-border surface-bg">
<div className="relative min-h-8 overflow-hidden bg-moss-500/5 border-t border-moss-500/10"><div className="flex min-h-8 items-center whitespace-nowrap animate-marquee" style={{ animationDuration: '25s' }}>{[...displayedRunningTexts, ...displayedRunningTexts, ...displayedRunningTexts].map((text, i) => <span key={i} className="inline-flex items-center gap-2 mx-6 text-[11px] text-accent/80"><span className="w-1.5 h-1.5 rounded-full bg-moss-400/60 shrink-0" />{text}</span>)}</div></div>
      </div>
        <div className="lg:hidden px-4 py-2 relative" data-search><Search size={15} className="absolute left-7 top-1/2 -translate-y-1/2 text-slate-500" /><input className="input pl-9 text-sm" placeholder={t('home.searchPlaceholder')} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />{searchQuery && <div className="absolute left-4 right-4 top-full mt-1 z-30 surface-elevated border surface-border rounded-xl shadow-xl overflow-hidden max-h-60 overflow-y-auto">{searchResults.length > 0 ? searchResults.map((r) => <Link key={r.id + r.type} to={r.type === 'competition' ? `/lomba/${r.slug}` : '/feed'} className="flex items-center gap-3 px-3 py-2.5 hover:bg-white/5 transition" onClick={() => setSearchQuery('')}><div className="w-7 h-7 rounded-lg bg-moss-500/10 flex items-center justify-center shrink-0">{r.type === 'competition' ? <Trophy size={13} className="text-accent" /> : <FileText size={13} className="text-accent" />}</div><div className="min-w-0 flex-1"><p className="text-xs font-semibold text-fg truncate">{r.title}</p><p className="text-[10px] text-slate-500 truncate">{r.subtitle}</p></div></Link>) : <p className="text-xs text-slate-500 text-center py-3">{t('home.noSearchResults')}</p>}</div>}</div>

      <div className="px-4 py-4"><div className="lg:grid lg:grid-cols-[minmax(0,1fr)_340px] gap-5 items-start"><main className="space-y-4 min-w-0"><div className="sticky top-[104px] md:top-12 z-20 isolate flex border-b surface-border glass surface-bg">{(['lomba', 'prestasi'] as const).map((t) => <button key={t} onClick={() => setTab(t)} className={`flex-1 py-3 text-sm font-medium transition-all relative ${tab === t ? 'text-accent' : 'text-slate-500 hover:text-fg-secondary'}`}>{t === 'lomba' ? t('home.tabCompetitions') : t('home.tabAchievements')}{tab === t && <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-12 h-[2px] bg-moss-400 rounded-full" />}</button>)} </div>
            {loading ? <div className="space-y-4"><SkeletonCard /><SkeletonCard /></div> : tab === 'lomba' ? (showCompetitions ? competitions.slice(0, 5).map((comp) => <Card key={comp.id} className="overflow-hidden"><div className="p-4"><div className="flex items-center gap-3 mb-3">{comp.organizer_photo_url ? <img src={optimizedCloudinaryUrl(comp.organizer_photo_url,{width:96})} alt={comp.organizer_name} loading="lazy" decoding="async" className="w-12 h-12 rounded-2xl object-cover border surface-border shrink-0" /> : <Avatar name={comp.organizer_name} id={comp.id} size={48} />}<div className="flex-1 min-w-0"><p className="font-display text-[15px] font-semibold tracking-[-0.01em] text-fg truncate">{comp.organizer_name || 'Penyelenggara'}</p><div className="flex items-center gap-2"><span className="chip bg-moss-500/10 text-accent border border-moss-500/20 text-[10px]">{t('home.tabCompetitions')}</span><span className="text-[11px] text-slate-600">· {comp.category || 'Kompetisi'}</span></div></div></div><Link to={`/lomba/${comp.slug}`}><h3 className="font-display font-semibold text-[15px] text-fg mb-1.5">{comp.title}</h3>{comp.short_description && <p className="text-sm text-fg-secondary leading-relaxed mb-3">{comp.short_description}</p>}{comp.poster_url && <img src={optimizedCloudinaryUrl(comp.poster_url,{width:800})} alt={comp.title} loading="lazy" decoding="async" className="w-full aspect-video object-cover rounded-xl border surface-border mt-2" />}<p className="text-xs text-accent flex items-center gap-1 mt-3">{t('home.viewDetails')} <ChevronRight size={14} /></p></Link></div><div className="px-4 py-3 border-t surface-border flex items-center gap-4 text-xs text-slate-500"><span>{comp.participant_count || 0} {t('common.participants')}</span><CompetitionPhaseBadge competition={comp} now={phaseClock} /></div></Card>) : lombaPosts.length ? lombaPosts.slice(0, showAllPosts ? undefined : 5).map((post) => <FeedPostCard key={post.id} post={post} expanded={expanded === post.id} onExpand={() => setExpanded((v) => (v === post.id ? null : post.id))} onLike={() => void like(post.id)} onShare={() => void sharePost(post)} onOpen={() => post.competition_slug && navigate(`/lomba/${post.competition_slug}`)} isGuest={isGuest} />) : <Card className="p-10 text-center"><Trophy size={32} className="mx-auto text-slate-600 mb-3" /><p className="text-sm text-slate-400">{language === 'en' ? 'No public competitions yet.' : 'Belum ada lomba publik.'}</p></Card>) : prestasiPosts.length ? prestasiPosts.slice(0, showAllPosts ? undefined : 5).map((post) => <FeedPostCard key={post.id} post={post} expanded={expanded === post.id} onExpand={() => setExpanded((v) => (v === post.id ? null : v))} onLike={() => void like(post.id)} onShare={() => void sharePost(post)} onOpen={() => post.competition_slug && navigate(`/lomba/${post.competition_slug}`)} isGuest={isGuest} />) : <Card className="p-10 text-center"><Trophy size={32} className="mx-auto text-slate-600 mb-3" /><p className="text-sm text-slate-400">{language === 'en' ? 'No achievement posts yet.' : 'Belum ada postingan prestasi.'}</p></Card>}
            {!showAllPosts && ((tab === 'lomba' && lombaPosts.length > 5) || (tab === 'prestasi' && prestasiPosts.length > 5) || (showCompetitions && competitions.length > 5)) && <div className="text-center pt-1"><Button variant="outline" size="sm" onClick={() => setShowAllPosts(true)}>{t('home.showMore')}</Button></div>}{cursor && showAllPosts && <div className="text-center pt-1"><Button variant="outline" size="sm" loading={loadingMore} onClick={() => void loadMore()}>{t('home.loadMore')}</Button></div>}
          </main><aside className={`hidden lg:block space-y-4 lg:sticky lg:top-12 lg:self-start lg:max-h-[calc(100vh-4rem)] lg:overflow-y-auto ${showAllPosts ? 'hidden' : ''}`}><div className="relative" data-search><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" /><input className="input pl-9 text-sm" placeholder={t('home.searchPlaceholder')} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />{searchQuery && <div className="absolute left-0 right-0 top-full mt-1 z-30 surface-elevated border surface-border rounded-xl shadow-xl overflow-hidden max-h-72 overflow-y-auto">{searchResults.length > 0 ? searchResults.map((r) => <Link key={r.id + r.type} to={r.type === 'competition' ? `/lomba/${r.slug}` : '/feed'} className="flex items-center gap-3 px-3 py-2.5 hover:bg-white/5 transition" onClick={() => setSearchQuery('')}><div className="w-7 h-7 rounded-lg bg-moss-500/10 flex items-center justify-center shrink-0">{r.type === 'competition' ? <Trophy size={13} className="text-accent" /> : <FileText size={13} className="text-accent" />}</div><div className="min-w-0 flex-1"><p className="text-xs font-semibold text-fg truncate">{r.title}</p><p className="text-[10px] text-slate-500 truncate">{r.subtitle || (r.type === 'competition' ? 'Lomba' : 'Postingan')}</p></div></Link>) : <p className="text-xs text-slate-500 text-center py-3">Tidak ditemukan untuk "{searchQuery}"</p>}</div>}</div>
            <BannerCarousel placement="home_sidebar" />
            <Card className="p-4"><div className="flex items-center gap-2 mb-3"><Sparkles size={16} className="text-accent" /><h3 className="font-display font-semibold text-fg text-sm">{language === 'en' ? 'Trending Competitions' : 'Uji Kompetensi Trending'}</h3></div><div className="space-y-3">{competitions.slice(0, 3).map((comp, idx: number) => <Link key={comp.id} to={`/lomba/${comp.slug}`} className="flex items-start gap-3 group"><div className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 mt-0.5 ${idx === 0 ? 'bg-moss-500/20 text-accent' : idx === 1 ? 'bg-sky-500/20 text-sky-300' : 'bg-amber-500/20 text-amber-300'}`}>{idx + 1}</div><div className="min-w-0"><p className="text-xs font-semibold text-fg group-hover:text-accent transition line-clamp-2">{comp.title}</p><p className="text-[10px] text-slate-500 mt-0.5">{comp.category || 'Umum'} · {comp.participants_count ?? 0} peserta</p></div></Link>)}{competitions.length === 0 && <p className="text-xs text-slate-500 text-center py-2">{language === 'en' ? 'No trending data yet.' : 'Belum ada data trending.'}</p>}</div></Card>
            <Card className="p-4"><div className="flex items-center justify-between mb-3"><div className="flex items-center gap-1.5"><svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 text-accent"><path d="M12 2l2.09 6.26L20.18 9l4.09 6.26L16.18 19 12 15.77 7.82 19l1.09-6.26L3.82 9l6.09-.74L12 2z" fill="currentColor"/></svg><h3 className="font-display font-semibold text-fg text-sm">{language === 'en' ? 'Top 5 Leaderboard' : 'Top 5 Peringkat'}</h3></div><Link to="/leaderboard" className="text-[11px] text-accent hover:text-accent">{t('common.seeAll')}</Link></div><div className="grid grid-cols-2 surface-elevated rounded-lg p-1 mb-3"><button onClick={() => setLeaderMode('xp')} className={`text-[11px] py-1.5 rounded-md font-medium transition ${leaderMode === 'xp' ? 'bg-moss-500/15 text-accent' : 'text-slate-500'}`}>{language === 'en' ? 'Global XP' : 'XP Global'}</button><button onClick={() => setLeaderMode('coin')} className={`text-[11px] py-1.5 rounded-md font-medium transition ${leaderMode === 'coin' ? 'bg-moss-500/15 text-accent' : 'text-slate-500'}`}>{t('home.eduCoin')}</button></div><div className="space-y-2.5">{loading && leaders.length === 0 && <>{Array.from({ length: 5 }).map((_, i) => <div key={i} className="flex items-center gap-2.5 animate-pulse"><Skeleton className="w-6 h-6 rounded-full" /><Skeleton className="w-8 h-8 rounded-full" /><div className="flex-1 space-y-1.5"><Skeleton className="h-3 w-2/3" /><Skeleton className="h-2.5 w-1/3" /></div><Skeleton className="h-3 w-10" /></div>)}</>}{!loading && leaderMode === 'xp' ? leaders.map((u) => {const rankColor=u.rank===1?'bg-emerald-500/20 text-emerald-400':u.rank===2?'bg-sky-500/20 text-sky-400':u.rank===3?'bg-amber-500/20 text-amber-400':'bg-slate-500/15 text-slate-400';return <Link key={u.user_id} to={`/profile/${u.username}`} className="flex items-center gap-2.5 hover:bg-white/5 rounded-lg px-1 py-1 -mx-1 transition"><div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${rankColor}`}>{u.rank}</div><Avatar name={u.display_name||u.username||'U'} id={u.user_id} size={30} src={u.avatar_url||undefined}/><div className="flex-1 min-w-0"><p className="text-xs text-fg truncate">{u.display_name||u.username}</p></div><span className="text-xs text-accent font-semibold tabular-nums">{Number(u.xp||0).toLocaleString('id-ID')}</span></Link>}) : coinLeaders.map((u,idx:number) => {const rank=idx+1;const rankColor=rank===1?'bg-emerald-500/20 text-emerald-400':rank===2?'bg-sky-500/20 text-sky-400':rank===3?'bg-amber-500/20 text-amber-400':'bg-slate-500/15 text-slate-400';return <Link key={u.user_id} to={`/profile/${u.username}`} className="flex items-center gap-2.5 hover:bg-white/5 rounded-lg px-1 py-1 -mx-1 transition"><div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${rankColor}`}>{rank}</div><Avatar name={u.display_name||u.username||'U'} id={u.user_id} size={30} src={u.avatar_url||undefined}/><div className="flex-1 min-w-0"><p className="text-xs text-fg truncate">{u.display_name||u.username}</p></div><span className="text-xs text-amber-300 font-semibold tabular-nums">{Number(u.edu_coin||0).toLocaleString('id-ID')}</span></Link>})}{((leaderMode === 'xp' && leaders.length === 0) || (leaderMode === 'coin' && coinLeaders.length === 0)) && <p className="text-xs text-slate-500 text-center py-2">{language === 'en' ? 'No rankings yet.' : 'Belum ada peringkat.'}</p>}</div></Card>
            <Card className="p-4"><div className="flex items-center gap-2 mb-3"><Calendar size={16} className="text-amber-400" /><h3 className="font-display font-semibold text-fg text-sm">{language === 'en' ? 'Upcoming Deadlines' : 'Deadline Terdekat'}</h3></div><div className="space-y-3">{deadlinesLoading && <>{Array.from({ length: 3 }).map((_, i) => <div key={i} className="space-y-1.5 animate-pulse"><Skeleton className="h-3 w-3/4" /><Skeleton className="h-2.5 w-1/2" /></div>)}</>}{!deadlinesLoading && upcomingDeadlines.map(({competition:comp,deadlineAt}) => <Link key={comp.id} to={`/lomba/${comp.slug}`} className="block group"><p className="text-xs font-semibold text-fg group-hover:text-accent transition line-clamp-1">{comp.title}</p><p className="text-[11px] text-amber-400/80 mt-0.5">{language === 'en' ? 'Register before' : 'Daftar sebelum'} {new Date(deadlineAt).toLocaleDateString(language === 'en' ? 'en-US' : 'id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}</p></Link>)}{!deadlinesLoading && upcomingDeadlines.length === 0 && <p className="text-xs text-slate-500 text-center py-2">{language === 'en' ? 'No upcoming registration deadlines.' : 'Tidak ada deadline pendaftaran mendatang.'}</p>}</div></Card>
          </aside></div></div>
    </div>
  );
}

function FeedPostCard({post,expanded,onExpand,onLike,onShare,onOpen,isGuest}:{post:SocialPost;expanded:boolean;onExpand:()=>void;onLike:()=>void;onShare:()=>void;onOpen:()=>void;isGuest:boolean}){const isAchievement=!post.competition_id;const displayName=post.author_name;const profileHref=post.competition_id?undefined:`/profile/${post.author_username}`;return <div className="surface-elevated/80 border surface-border rounded-2xl p-4"><div className="flex items-start gap-3"><div className="shrink-0">{profileHref ? <Link to={profileHref}><Avatar name={displayName} id={post.author_user_id} size={post.competition_id?50:44} src={post.avatar_url??undefined}/></Link> : <Avatar name={displayName} id={post.author_user_id} size={50} src={post.avatar_url??undefined}/>}</div><div className="flex-1 min-w-0"><div className="flex items-center gap-2 flex-wrap">{profileHref ? <Link to={profileHref} className="text-sm font-semibold text-fg truncate">{displayName}</Link> : <span className="font-display text-[15px] font-semibold tracking-[-0.01em] text-fg truncate">{displayName}</span>}<span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-500/15 text-amber-300 border border-amber-500/20">{post.competition_id?'Lomba':'Prestasi'}</span><span className="text-xs text-slate-600">· {timeAgo(post.created_at)}</span></div>{!post.competition_id&&<p className="text-xs text-slate-500">@{post.author_username}</p>}</div><button className="text-slate-600 hover:text-slate-400 p-1">⋯</button></div><div className="mt-3">{post.competition_id?<button onClick={onOpen} className="text-left w-full"><h3 className="font-display font-semibold text-[15px] text-fg mb-1.5">{post.title}</h3><p className="text-sm text-fg-secondary leading-relaxed mb-3">{post.body}</p>{post.cover_url&&<img src={optimizedCloudinaryUrl(post.cover_url,{width:800})} alt={post.title} loading="lazy" decoding="async" className="w-full aspect-video object-cover rounded-xl border surface-border"/>}<p className="text-xs text-accent flex items-center gap-1 mt-3">{t('home.viewDetails')} <ChevronRight size={14}/></p></button>:<><h3 className="font-display font-semibold text-[15px] text-fg mb-1.5">{post.title}</h3><p className="text-sm text-fg-secondary leading-relaxed whitespace-pre-line">{post.body}</p>{post.cover_url&&<img src={optimizedCloudinaryUrl(post.cover_url,{width:800})} alt={post.title} loading="lazy" decoding="async" className="w-full aspect-video object-cover rounded-xl border surface-border mt-3"/>}{isAchievement&&<div className="mt-3 px-3 py-2.5 rounded-xl bg-moss-500/8 border border-moss-500/15 flex items-center gap-2"><span className="text-lg">🏆</span><p className="text-xs text-accent">Prestasi ini diverifikasi via sertifikat resmi sykabelajar.id</p></div>}</>}{/* end non-competition content */}</div><div className="flex items-center gap-5 mt-3 pt-3 border-t surface-border text-slate-500"><button onClick={onLike} disabled={isGuest} className={`flex items-center gap-1.5 text-xs transition ${post.liked?'text-accent':'hover:text-accent'}`}><Heart size={16} className={post.liked?'fill-moss-400':''}/>{post.likes}</button><button onClick={onExpand} className="flex items-center gap-1.5 text-xs hover:text-accent transition"><MessageCircle size={16}/>{post.comments}</button><button onClick={onShare} className="flex items-center gap-1.5 text-xs hover:text-accent transition"><Share2 size={16}/></button></div>{expanded&&<CommentsSection postId={post.id}/>}</div>}
