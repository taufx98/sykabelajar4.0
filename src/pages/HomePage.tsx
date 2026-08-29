import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { Calendar, ChevronRight, FileText, Flame, Heart, MessageCircle, Search, Share2, Sparkles, Trophy } from 'lucide-react';
import { BannerCarousel } from '@/components/ui/BannerCarousel';
import { Link, useNavigate } from 'react-router-dom';
import { useApp } from '@/store/AppContext';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { CommentsSection } from '@/components/ui/Comments';
import { Skeleton, SkeletonCard } from '@/components/ui/Skeleton';
import { listPublishedPostsPage, togglePostLike, type SocialPost } from '@/services/social.service';
import { getPublicCompetitions } from '@/services/platform.service';
import { timeAgo } from '@/lib/utils';
import type { PublicLeaderboardRow } from '@/services/platform.service';
import { supabase } from '@/lib/supabase';

export function HomePage(){
 const{user,isGuest,notifications,toast}=useApp();const navigate=useNavigate();const[tab,setTab]=useState<'lomba'|'prestasi'>('lomba');const[posts,setPosts]=useState<SocialPost[]>([]);const[competitions,setCompetitions]=useState<any[]>([]);const[leaders,setLeaders]=useState<PublicLeaderboardRow[]>([]);const[loading,setLoading]=useState(true);const[loadingMore,setLoadingMore]=useState(false);const[cursor,setCursor]=useState<string|null>(null);const[expanded,setExpanded]=useState<string|null>(null);const[searchQuery,setSearchQuery]=useState('');const[searchAllComps,setSearchAllComps]=useState<any[]>([]);const[searchUsers,setSearchUsers]=useState<any[]>([]);const[leaderMode,setLeaderMode]=useState<'xp'|'coin'>('xp');const[coinLeaders,setCoinLeaders]=useState<any[]>([]);const[showAllPosts,setShowAllPosts]=useState(false);const[mobilePage,setMobilePage]=useState(1);
 const loadFirst=async()=>{setLoading(true);try{const[{items,nextCursor},comps,lbResult,clResult]=await Promise.all([listPublishedPostsPage(15),getPublicCompetitions(5),supabase.rpc('get_public_leaderboard',{p_limit:5}),supabase.rpc('get_public_coin_leaderboard',{p_limit:5})]);if(lbResult.error)throw lbResult.error;setPosts(items);setCursor(nextCursor);setCompetitions(comps);setLeaders((lbResult.data??[]) as PublicLeaderboardRow[]);setCoinLeaders((clResult.data??[]) as any[]);}catch(e:any){toast(e?.message??'Beranda gagal dimuat.','error')}finally{setLoading(false)}};
const loadSearchData=useCallback(async()=>{try{const [compRes,userRes]=await Promise.allSettled([getPublicCompetitions(100),supabase.from('public_profiles').select('id,username,full_name,avatar_url,grade,institution').limit(50)]);if(compRes.status==='fulfilled')setSearchAllComps(compRes.value);if(userRes.status==='fulfilled'&&userRes.value.data)setSearchUsers(userRes.value.data);}catch{}},[]);useEffect(()=>{void loadSearchData()},[loadSearchData]);useEffect(()=>{const handler=(e:MouseEvent)=>{if(searchQuery&&!(e.target as HTMLElement).closest('[data-search]'))setSearchQuery('')};document.addEventListener('mousedown',handler);return()=>document.removeEventListener('mousedown',handler)},[searchQuery]);
 useEffect(()=>{void loadFirst()},[]);
 const loadMore=async()=>{if(!cursor||loadingMore)return;setLoadingMore(true);try{const{items,nextCursor}=await listPublishedPostsPage(15,cursor);setPosts(p=>[...p,...items]);setCursor(nextCursor)}catch(e:any){toast(e?.message??'Feed gagal dimuat.','error')}finally{setLoadingMore(false)}};
 const searchResults=useMemo(()=>{if(!searchQuery.trim())return[];const q=searchQuery.normalize('NFD').replace(/\u0300-\u036f/g,'').toLowerCase();const norm=(s:string)=>String(s??'').normalize('NFD').replace(/\u0300-\u036f/g,'').toLowerCase();const compResults=searchAllComps.filter((c:any)=>norm(c.title).includes(q)||norm(c.slug).includes(q)||norm(c.category).includes(q)||norm(c.organizer_name).includes(q)).map((c:any)=>({id:c.id,title:c.title,slug:c.slug,type:'competition' as const,subtitle:c.category||'Lomba',avatar_url:c.poster_url||null}));const postResults=posts.filter((p:any)=>norm(p.title).includes(q)||norm(p.body).includes(q)).map((p:any)=>({id:p.id,title:p.title,slug:'',type:'post' as const,subtitle:'Postingan',avatar_url:p.cover_url||null}));const userResults=searchUsers.filter((u:any)=>norm(u.username).includes(q)||norm(u.full_name).includes(q)||norm(u.institution).includes(q)).map((u:any)=>({id:u.id,title:u.full_name||u.username,slug:u.username,type:'user' as const,subtitle:'@'+u.username+(u.institution?' \u00b7 '+u.institution:''),avatar_url:u.avatar_url||null}));return[...compResults,...userResults,...postResults].slice(0,10);},[searchQuery,searchAllComps,posts,searchUsers]);
 const lombaPosts=useMemo(()=>posts.filter(p=>Boolean(p.competition_id)),[posts]);
const prestasiPosts=useMemo(()=>posts.filter(p=>!p.competition_id),[posts]);
const showCompetitions=tab==='lomba'&&lombaPosts.length===0&&competitions.length>0;const unread=notifications.filter(n=>!n.read).slice(0,5);const nextCompetition=competitions.find((c:any)=>['REGISTRATION_OPEN','LIVE'].includes(String(c.status)))??competitions[0];
 const like=async(id:string)=>{if(isGuest||!user){toast('Masuk untuk menyukai postingan.','info');return;}try{await togglePostLike(id);await loadFirst()}catch(e:any){toast(e?.message??'Gagal memperbarui like.','error')}};
 // Running text announcements — TODO: connect to admin settings / platform_settings table
const runningTexts = [
  'Selamat datang di sykabelajar.id — Platform Uji Kompetensi & Gamifikasi Edukasi',
  'Daftar sekarang dan ikuti uji kompetensi terbaru!',
  'Selesaikan daily tasks untuk mendapatkan XP dan naik peringkat',
  'Ikuti kompetisi terbaru dan raih prestasi terbaikmu',
];
const sharePost=async(post:SocialPost)=>{const url=new URL(window.location.href);if(post.competition_slug)url.hash=`/lomba/${post.competition_slug}`;else url.hash=`/feed?post=${encodeURIComponent(post.id)}`;try{await navigator.clipboard?.writeText(url.toString());toast('Tautan postingan disalin.','success')}catch{toast('Tidak dapat menyalin tautan.','error')}};
 return (
    <div>
      {/* ===== STICKY HEADER ===== */}
      <div className="sticky top-0 z-20 glass border-b border-white/5">
        <div className="px-4 py-2">
          <BannerCarousel />
        </div>
        {/* Running text / announcement marquee — always scrolling */}
        <div className="relative overflow-hidden bg-moss-500/5 border-t border-moss-500/10">
          <div className="flex whitespace-nowrap animate-marquee py-1.5" style={{ animationDuration: '25s' }}>
            {[...runningTexts, ...runningTexts, ...runningTexts].map((text, i) => (
              <span key={i} className="inline-flex items-center gap-2 mx-6 text-[11px] text-moss-300/80">
                <span className="w-1.5 h-1.5 rounded-full bg-moss-400/60 shrink-0" />
                {text}
              </span>
            ))}
          </div>
        </div>
        {/* Mobile search bar — below running text */}
        <div className="md:hidden px-4 py-2 relative" data-search>
          <Search size={15} className="absolute left-7 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            className="input pl-9 text-sm"
            placeholder="Cari lomba, pengguna..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <div className="absolute left-4 right-4 top-full mt-1 z-30 bg-ink-800 border border-white/10 rounded-xl shadow-xl overflow-hidden max-h-60 overflow-y-auto">
              {searchResults.length > 0 ? searchResults.map((r) => (
                <Link
                  key={r.id + r.type}
                  to={r.type === 'competition' ? `/lomba/${r.slug}` : r.type === 'user' ? `/profile/${r.slug}` : '/feed'}
                  className="flex items-center gap-3 px-3 py-2.5 hover:bg-white/5 transition"
                  onClick={() => setSearchQuery('')}
                >
                  <div className="w-7 h-7 rounded-lg bg-moss-500/10 flex items-center justify-center shrink-0">
                    {r.type === 'competition' ? <Trophy size={13} className="text-moss-400" /> : <FileText size={13} className="text-moss-400" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-white truncate">{r.title}</p>
                    <p className="text-[10px] text-slate-500 truncate">{r.subtitle}</p>
                  </div>
                </Link>
              )) : (
                <p className="text-xs text-slate-500 text-center py-3">Tidak ditemukan</p>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="px-4 py-4">
        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_340px] gap-5 items-start">

          {/* ===== CENTER COLUMN ===== */}
          <main className="space-y-4 min-w-0">
            {/* Lomba / Prestasi tabs — full width, underline style */}
            <div className="flex border-b border-white/5">
              {(['lomba', 'prestasi'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`flex-1 py-3 text-sm font-medium transition-all relative ${
                    tab === t
                      ? 'text-moss-300'
                      : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  {t === 'lomba' ? 'Lomba' : 'Prestasi'}
                  {tab === t && (
                    <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-12 h-[2px] bg-moss-400 rounded-full" />
                  )}
                </button>
              ))}
            </div>

            {/* Feed */}
            {loading ? (
              <div className="space-y-4">
                <SkeletonCard />
                <SkeletonCard />
              </div>
            ) : tab === 'lomba' ? (
              showCompetitions ? (
                competitions.slice(0, 5).map((comp) => (
                  <Card key={comp.id} className="overflow-hidden">
                    <div className="p-4">
                      <div className="flex items-center gap-3 mb-3">
                        <div className="w-10 h-10 rounded-xl bg-moss-500/10 flex items-center justify-center">
                          <Trophy size={18} className="text-moss-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-white">{comp.organizer_name || 'Penyelenggara'}</p>
                          <div className="flex items-center gap-2">
                            <span className="chip bg-moss-500/10 text-moss-300 border border-moss-500/20 text-[10px]">Lomba</span>
                            <span className="text-[11px] text-slate-600">· {comp.category || 'Kompetisi'}</span>
                          </div>
                        </div>
                      </div>
                      <Link to={`/lomba/${comp.slug}`}>
                        <h3 className="font-display font-semibold text-[15px] text-white mb-1.5">{comp.title}</h3>
                        {comp.short_description && <p className="text-sm text-slate-300 leading-relaxed mb-3">{comp.short_description}</p>}
                        {comp.poster_url && <img src={comp.poster_url} alt={comp.title} loading="lazy" className="w-full aspect-video object-cover rounded-xl border border-white/5 mt-2" />}
                        <p className="text-xs text-moss-400 flex items-center gap-1 mt-3">Lihat detail uji kompetensi <ChevronRight size={14} /></p>
                      </Link>
                    </div>
                    <div className="px-4 py-3 border-t border-white/5 flex items-center gap-4 text-xs text-slate-500">
                      <span>{comp.participant_count || 0} peserta</span>
                      <span className="ml-auto">
                        {comp.status === 'REGISTRATION_OPEN' ? 'Pendaftaran dibuka' :
                         comp.status === 'LIVE' ? 'Sedang berlangsung' :
                         comp.status === 'PUBLISHED' ? 'Segera dibuka' : comp.status}
                      </span>
                    </div>
                  </Card>
                ))
              ) : lombaPosts.length ? (
                lombaPosts.slice(0, showAllPosts ? undefined : 5).map((post) => (
                  <FeedPostCard
                    key={post.id}
                    post={post}
                    expanded={expanded === post.id}
                    onExpand={() => setExpanded((v) => (v === post.id ? null : post.id))}
                    onLike={() => void like(post.id)}
                    onShare={() => void sharePost(post)}
                    onOpen={() => post.competition_slug && navigate(`/lomba/${post.competition_slug}`)}
                    isGuest={isGuest}
                  />
                ))
              ) : (
                <Card className="p-10 text-center">
                  <Trophy size={32} className="mx-auto text-slate-600 mb-3" />
                  <p className="text-sm text-slate-400">Belum ada lomba publik.</p>
                </Card>
              )
            ) : prestasiPosts.length ? (
              prestasiPosts.slice(0, showAllPosts ? undefined : 5).map((post) => (
                <FeedPostCard
                  key={post.id}
                  post={post}
                  expanded={expanded === post.id}
                  onExpand={() => setExpanded((v) => (v === post.id ? null : post.id))}
                  onLike={() => void like(post.id)}
                  onShare={() => void sharePost(post)}
                  onOpen={() => post.competition_slug && navigate(`/lomba/${post.competition_slug}`)}
                  isGuest={isGuest}
                />
              ))
            ) : (
              <Card className="p-10 text-center">
                <Trophy size={32} className="mx-auto text-slate-600 mb-3" />
                <p className="text-sm text-slate-400">Belum ada postingan prestasi.</p>
              </Card>
            )}
            {/* Lihat lebih banyak button for mobile */}
            {!showAllPosts && ((tab === 'lomba' && lombaPosts.length > 5) || (tab === 'prestasi' && prestasiPosts.length > 5) || (showCompetitions && competitions.length > 5)) && (
              <div className="text-center pt-1">
                <Button variant="outline" size="sm" onClick={() => setShowAllPosts(true)}>
                  Lihat lebih banyak
                </Button>
              </div>
            )}
            {cursor && showAllPosts && (
              <div className="text-center pt-1">
                <Button variant="outline" size="sm" loading={loadingMore} onClick={() => void loadMore()}>
                  Muat lebih banyak
                </Button>
              </div>
            )}
          </main>

          {/* ===== RIGHT SIDEBAR ===== — hidden on mobile always, hidden on lg when showAllPosts */}
          <aside className={`hidden lg:block space-y-4 lg:sticky lg:top-[108px] ${showAllPosts ? 'hidden' : ''}`}>
            {/* Search bar */}
            <div className="relative" data-search>
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                className="input pl-9 text-sm"
                placeholder="Cari lomba, pengguna..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            {searchQuery && (
              <div className="absolute left-0 right-0 top-full mt-1 z-30 bg-ink-800 border border-white/10 rounded-xl shadow-xl overflow-hidden max-h-72 overflow-y-auto">
                {searchResults.length > 0 ? searchResults.map((r) => (
                  <Link
                    key={r.id + r.type}
                    to={r.type === 'competition' ? `/lomba/${r.slug}` : r.type === 'user' ? `/profile/${r.slug}` : '/feed'}
                    className="flex items-center gap-3 px-3 py-2.5 hover:bg-white/5 transition"
                    onClick={() => setSearchQuery('')}
                  >
                    {r.type === 'user' && r.avatar_url ? (
                      <img src={r.avatar_url} alt="" className="w-7 h-7 rounded-full object-cover shrink-0" />
                    ) : r.type === 'user' ? (
                      <div className="w-7 h-7 rounded-full bg-sky-500/20 flex items-center justify-center shrink-0 text-[10px] font-bold text-sky-300">
                        {(r.title || '?')[0].toUpperCase()}
                      </div>
                    ) : (
                      <div className="w-7 h-7 rounded-lg bg-moss-500/10 flex items-center justify-center shrink-0">
                        {r.type === 'competition' ? (
                          <Trophy size={13} className="text-moss-400" />
                        ) : (
                          <FileText size={13} className="text-moss-400" />
                        )}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-white truncate">{r.title}</p>
                      <p className="text-[10px] text-slate-500 truncate">
                        {r.subtitle || (r.type === 'competition' ? 'Lomba' : r.type === 'user' ? 'Pengguna' : 'Postingan')}
                      </p>
                    </div>
                  </Link>
                )) : (
                  <p className="text-xs text-slate-500 text-center py-3">Tidak ditemukan untuk "{searchQuery}"</p>
                )}
              </div>
            )}
            </div>

            {/* Uji Kompetensi Trending */}
            <Card className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <Sparkles size={16} className="text-moss-400" />
                <h3 className="font-display font-semibold text-white text-sm">Uji Kompetensi Trending</h3>
              </div>
              <div className="space-y-3">
                {competitions.slice(0, 3).map((comp: any, idx: number) => (
                  <Link
                    key={comp.id}
                    to={`/lomba/${comp.slug}`}
                    className="flex items-start gap-3 group"
                  >
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 mt-0.5 ${
                      idx === 0 ? 'bg-moss-500/20 text-moss-300' :
                      idx === 1 ? 'bg-sky-500/20 text-sky-300' :
                      'bg-amber-500/20 text-amber-300'
                    }`}>
                      {idx + 1}
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-white group-hover:text-moss-300 transition line-clamp-2">
                        {comp.title}
                      </p>
                      <p className="text-[10px] text-slate-500 mt-0.5">
                        {comp.category || 'Umum'} · {comp.participants_count ?? 0} peserta
                      </p>
                    </div>
                  </Link>
                ))}
                {competitions.length === 0 && (
                  <p className="text-xs text-slate-500 text-center py-2">Belum ada data trending.</p>
                )}
              </div>
            </Card>

            {/* Top 5 Peringkat — XP / Point Edu toggle */}
            <Card className="p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-1.5"><svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 text-moss-400"><path d="M12 2l2.09 6.26L20.18 9l-5.09 3.74L16.18 19 12 15.77 7.82 19l1.09-6.26L3.82 9l6.09-.74L12 2z" fill="currentColor"/></svg><h3 className="font-display font-semibold text-white text-sm">Top 5 Peringkat</h3></div>
                <Link to="/leaderboard" className="text-[11px] text-moss-400 hover:text-moss-300">
                  Lihat semua
                </Link>
              </div>
              <div className="grid grid-cols-2 bg-ink-800 rounded-lg p-1 mb-3">
                <button
                  onClick={() => setLeaderMode('xp')}
                  className={`text-[11px] py-1.5 rounded-md font-medium transition ${
                    leaderMode === 'xp' ? 'bg-moss-500/15 text-moss-300' : 'text-slate-500'
                  }`}
                >
                  XP Global
                </button>
                <button
                  onClick={() => setLeaderMode('coin')}
                  className={`text-[11px] py-1.5 rounded-md font-medium transition ${
                    leaderMode === 'coin' ? 'bg-moss-500/15 text-moss-300' : 'text-slate-500'
                  }`}
                >
                  Point Edu
                </button>
              </div>
              <div className="space-y-2.5">
                {loading && leaders.length === 0 && (
                  <>
                    {Array.from({ length: 5 }).map((_, i) => (
                      <div key={i} className="flex items-center gap-2.5 animate-pulse">
                        <Skeleton className="w-6 h-6 rounded-full" />
                        <Skeleton className="w-8 h-8 rounded-full" />
                        <div className="flex-1 space-y-1.5">
                          <Skeleton className="h-3 w-2/3" />
                          <Skeleton className="h-2.5 w-1/3" />
                        </div>
                        <Skeleton className="h-3 w-10" />
                      </div>
                    ))}
                  </>
                )}
                {!loading && leaderMode === 'xp'
                  ? leaders.map((u) => {
                      const rankColor =
                        u.rank === 1 ? 'bg-emerald-500/20 text-emerald-400' :
                        u.rank === 2 ? 'bg-sky-500/20 text-sky-400' :
                        u.rank === 3 ? 'bg-amber-500/20 text-amber-400' :
                        'bg-slate-500/15 text-slate-400';
                      return (
                        <Link key={u.user_id} to={`/profile/${u.username}`} className="flex items-center gap-2.5 hover:bg-white/5 rounded-lg px-1 py-1 -mx-1 transition">
                          <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${rankColor}`}>
                            {u.rank}
                          </div>
                          <Avatar
                            name={u.display_name || u.username || 'U'}
                            id={u.user_id}
                            size={30}
                            src={u.avatar_url || undefined}
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-white truncate">{u.display_name || u.username}</p>
                          </div>
                          <span className="text-xs text-moss-300 font-semibold tabular-nums">
                            {Number(u.xp || 0).toLocaleString('id-ID')}
                          </span>
                        </Link>
                      );
                    })
                  : coinLeaders.map((u, idx) => {
                      const rank = idx + 1;
                      const rankColor =
                        rank === 1 ? 'bg-emerald-500/20 text-emerald-400' :
                        rank === 2 ? 'bg-sky-500/20 text-sky-400' :
                        rank === 3 ? 'bg-amber-500/20 text-amber-400' :
                        'bg-slate-500/15 text-slate-400';
                      return (
                        <Link key={u.user_id} to={`/profile/${u.username}`} className="flex items-center gap-2.5 hover:bg-white/5 rounded-lg px-1 py-1 -mx-1 transition">
                          <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${rankColor}`}>
                            {rank}
                          </div>
                          <Avatar
                            name={u.display_name || u.username || 'U'}
                            id={u.user_id}
                            size={30}
                            src={u.avatar_url || undefined}
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-white truncate">{u.display_name || u.username}</p>
                          </div>
                          <span className="text-xs text-amber-300 font-semibold tabular-nums">
                            {Number(u.edu_coin || 0).toLocaleString('id-ID')}
                          </span>
                        </Link>
                      );
                    })}
                {((leaderMode === 'xp' && leaders.length === 0) ||
                  (leaderMode === 'coin' && coinLeaders.length === 0)) && (
                  <p className="text-xs text-slate-500 text-center py-2">Belum ada peringkat.</p>
                )}
              </div>
            </Card>

            {/* Deadline Terdekat */}
            <Card className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <Calendar size={16} className="text-amber-400" />
                <h3 className="font-display font-semibold text-white text-sm">Deadline Terdekat</h3>
              </div>
              <div className="space-y-3">
                {loading && (
                  <>
                    {Array.from({ length: 3 }).map((_, i) => (
                      <div key={i} className="space-y-1.5 animate-pulse">
                        <Skeleton className="h-3 w-3/4" />
                        <Skeleton className="h-2.5 w-1/2" />
                      </div>
                    ))}
                  </>
                )}
                {!loading && competitions
                  .filter((c: any) => c.deadline || c.registration_end)
                  .slice(0, 3)
                  .map((comp: any) => (
                    <Link
                      key={comp.id}
                      to={`/lomba/${comp.slug}`}
                      className="block group"
                    >
                      <p className="text-xs font-semibold text-white group-hover:text-moss-300 transition line-clamp-1">
                        {comp.title}
                      </p>
                      <p className="text-[11px] text-amber-400/80 mt-0.5">
                        Daftar sebelum {new Date(comp.deadline || comp.registration_end).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </p>
                    </Link>
                  ))}
                {competitions.filter((c: any) => c.deadline || c.registration_end).length === 0 && (
                  <p className="text-xs text-slate-500 text-center py-2">Tidak ada deadline mendatang.</p>
                )}
              </div>
            </Card>
          </aside>
        </div>
      </div>
    </div>
  );
}

function FeedPostCard({post,expanded,onExpand,onLike,onShare,onOpen,isGuest}:{post:SocialPost;expanded:boolean;onExpand:()=>void;onLike:()=>void;onShare:()=>void;onOpen:()=>void;isGuest:boolean}){return <Card className="p-4"><div className="flex gap-3"><Link to={`/profile/${post.author_username}`}><Avatar name={post.author_name} id={post.author_user_id} size={44} src={post.avatar_url??undefined}/></Link><div className="flex-1 min-w-0"><div className="flex items-center gap-2"><Link to={`/profile/${post.author_username}`} className="text-sm font-semibold text-white truncate">{post.author_name}</Link><span className="chip bg-moss-500/10 text-moss-300 border border-moss-500/20 text-[10px]">{post.competition_id?'Lomba':'Prestasi'}</span><span className="text-xs text-slate-600">· {timeAgo(post.created_at)}</span></div><p className="text-xs text-slate-500 mb-2">@{post.author_username}</p>{post.competition_id?<button onClick={onOpen} className="text-left w-full"><h3 className="font-display font-semibold text-[15px] text-white mb-1.5">{post.title}</h3><p className="text-sm text-slate-300 leading-relaxed mb-3">{post.body}</p>{post.cover_url&&<img src={post.cover_url} alt={post.title} loading="lazy" className="w-full aspect-video object-cover rounded-xl border border-white/5"/>}<p className="text-xs text-moss-400 flex items-center gap-1 mt-3">Lihat detail uji kompetensi <ChevronRight size={14}/></p></button>:<><h3 className="font-display font-semibold text-[15px] text-white mb-1.5">{post.title}</h3><p className="text-sm text-slate-300 leading-relaxed mb-3 whitespace-pre-line">{post.body}</p>{post.cover_url&&<img src={post.cover_url} alt={post.title} loading="lazy" className="w-full aspect-video object-cover rounded-xl border border-white"/>}</>}<div className="flex items-center justify-between max-w-md text-slate-500 mt-3"><button onClick={onLike} disabled={isGuest} className={`flex items-center gap-1.5 text-xs ${post.liked?'text-moss-400':''}`}><Heart size={16} className={post.liked?'fill-moss-400':''}/>{post.likes}</button><button onClick={onExpand} className="flex items-center gap-1.5 text-xs"><MessageCircle size={16}/>{post.comments}</button><button onClick={onShare} className="flex items-center gap-1.5 text-xs"><Share2 size={16}/></button></div>{expanded&&<CommentsSection postId={post.id}/>}</div></div></Card>}
