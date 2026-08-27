import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, FileText, Flame, Heart, MessageCircle, Search, Share2, Sparkles, Trophy } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useApp } from '@/store/AppContext';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { CommentsSection } from '@/components/ui/Comments';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { listPublishedPostsPage, togglePostLike, type SocialPost } from '@/services/social.service';
import { getPublicCompetitions } from '@/services/platform.service';
import { timeAgo } from '@/lib/utils';
import type { PublicLeaderboardRow } from '@/services/platform.service';

export function HomePage(){
 const{user,isGuest,notifications,toast}=useApp();const navigate=useNavigate();const[tab,setTab]=useState<'lomba'|'prestasi'>('lomba');const[posts,setPosts]=useState<SocialPost[]>([]);const[competitions,setCompetitions]=useState<any[]>([]);const[leaders,setLeaders]=useState<PublicLeaderboardRow[]>([]);const[loading,setLoading]=useState(true);const[loadingMore,setLoadingMore]=useState(false);const[cursor,setCursor]=useState<string|null>(null);const[expanded,setExpanded]=useState<string|null>(null);const[searchQuery,setSearchQuery]=useState('');const[leaderMode,setLeaderMode]=useState<'xp'|'coin'>('xp');const[coinLeaders,setCoinLeaders]=useState<any[]>([]);
 const loadFirst=async()=>{setLoading(true);try{const[{items,nextCursor},comps,{data:lb,error:lbError}]=await Promise.all([listPublishedPostsPage(15),getPublicCompetitions(5),(async()=>{const{data,error}=await import('@/lib/supabase').then(({supabase})=>supabase.rpc('get_public_leaderboard',{p_limit:5}));return{data,error}})()]);if(lbError)throw lbError;setPosts(items);setCursor(nextCursor);setCompetitions(comps);setLeaders((lb??[]) as PublicLeaderboardRow[]);const{data:cl}=await import('@/lib/supabase').then(({supabase})=>supabase.rpc('get_public_coin_leaderboard',{p_limit:5}));setCoinLeaders((cl??[]) as any[]);}catch(e:any){toast(e?.message??'Beranda gagal dimuat.','error')}finally{setLoading(false)}};
 useEffect(()=>{void loadFirst()},[]);
 const loadMore=async()=>{if(!cursor||loadingMore)return;setLoadingMore(true);try{const{items,nextCursor}=await listPublishedPostsPage(15,cursor);setPosts(p=>[...p,...items]);setCursor(nextCursor)}catch(e:any){toast(e?.message??'Feed gagal dimuat.','error')}finally{setLoadingMore(false)}};
 const searchResults=useMemo(()=>{if(!searchQuery.trim())return[];const q=searchQuery.toLowerCase();const compResults=competitions.filter((c:any)=>String(c.title??'').toLowerCase().includes(q)||String(c.slug??'').toLowerCase().includes(q)).map((c:any)=>({id:c.id,title:c.title,slug:c.slug,type:'competition' as const}));const postResults=posts.filter((p:any)=>String(p.title??'').toLowerCase().includes(q)||String(p.body??'').toLowerCase().includes(q)).map((p:any)=>({id:p.id,title:p.title,slug:'',type:'post' as const}));return[...compResults,...postResults].slice(0,8);},[searchQuery,competitions,posts]);
 const filtered=useMemo(()=>tab==='lomba'?posts.filter(p=>Boolean(p.competition_id)):posts.filter(p=>!p.competition_id),[posts,tab]);const unread=notifications.filter(n=>!n.read).slice(0,5);const nextCompetition=competitions.find((c:any)=>['REGISTRATION_OPEN','LIVE'].includes(String(c.status)))??competitions[0];
 const like=async(id:string)=>{if(isGuest||!user){toast('Masuk untuk menyukai postingan.','info');return;}try{await togglePostLike(id);await loadFirst()}catch(e:any){toast(e?.message??'Gagal memperbarui like.','error')}};
 const sharePost=async(post:SocialPost)=>{const url=new URL(window.location.href);if(post.competition_slug)url.hash=`/lomba/${post.competition_slug}`;else url.hash=`/feed?post=${encodeURIComponent(post.id)}`;try{await navigator.clipboard?.writeText(url.toString());toast('Tautan postingan disalin.','success')}catch{toast('Tidak dapat menyalin tautan.','error')}};
 return (
    <div>
      {/* Sticky header */}
      <div className="sticky top-0 z-20 glass border-b border-white/5">
        <div className="px-4 py-3 flex items-center justify-between">
          <h2 className="font-display font-bold text-lg text-white">Beranda</h2>
          <Sparkles size={18} className="text-moss-400" />
        </div>
      </div>

      <div className="px-4 py-4">
        {/* 3-column: left nav (handled by AppLayout) | center feed | right sidebar */}
        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_320px] gap-5 items-start">

          {/* ===== CENTER COLUMN ===== */}
          <main className="space-y-4 min-w-0">
            {/* Search bar — visible below xl */}
            <div className="relative xl:hidden">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                className="input pl-9 text-sm"
                placeholder="Cari lomba atau postingan..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            {searchQuery && (
              <Card className="p-3 xl:hidden">
                <p className="text-xs text-slate-500 mb-2">Hasil pencarian</p>
                {searchResults.length ? (
                  searchResults.map((r) => (
                    <Link
                      key={r.id}
                      to={r.type === 'competition' ? `/lomba/${r.slug}` : '/feed'}
                      className="flex items-center gap-3 p-2 rounded-lg hover:bg-white/5 mb-1 last:mb-0"
                    >
                      <div className="w-8 h-8 rounded-lg bg-moss-500/10 flex items-center justify-center shrink-0">
                        {r.type === 'competition' ? (
                          <Trophy size={14} className="text-moss-400" />
                        ) : (
                          <FileText size={14} className="text-moss-400" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-white truncate">{r.title}</p>
                        <p className="text-[10px] text-slate-500">
                          {r.type === 'competition' ? 'Lomba' : 'Postingan'}
                        </p>
                      </div>
                    </Link>
                  ))
                ) : (
                  <p className="text-xs text-slate-500 text-center py-2">Tidak ditemukan.</p>
                )}
              </Card>
            )}

            {/* Lomba / Prestasi tabs — centered */}
            <div className="flex justify-center">
              <div className="flex gap-1 bg-ink-800 rounded-xl p-1">
                {(['lomba', 'prestasi'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    className={`px-6 py-2 rounded-lg text-sm font-medium transition ${
                      tab === t
                        ? 'bg-moss-500/15 text-moss-300'
                        : 'text-slate-500 hover:text-slate-300'
                    }`}
                  >
                    {t === 'lomba' ? 'Lomba' : 'Prestasi'}
                  </button>
                ))}
              </div>
            </div>

            {/* Feed */}
            {loading ? (
              <div className="space-y-4">
                <SkeletonCard />
                <SkeletonCard />
              </div>
            ) : filtered.length ? (
              filtered.map((post) => (
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
                <p className="text-sm text-slate-400">
                  {tab === 'lomba'
                    ? 'Belum ada postingan lomba publik.'
                    : 'Belum ada postingan prestasi.'}
                </p>
              </Card>
            )}
            {cursor && (
              <div className="text-center pt-1">
                <Button variant="outline" size="sm" loading={loadingMore} onClick={() => void loadMore()}>
                  Muat lebih banyak
                </Button>
              </div>
            )}
          </main>

          {/* ===== RIGHT SIDEBAR — always visible ===== */}
          <aside className="space-y-4 lg:sticky lg:top-[108px]">
            {/* Search bar — desktop only */}
            <div className="relative hidden xl:block">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                className="input pl-9 text-sm"
                placeholder="Cari lomba atau postingan..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            {searchQuery && (
              <Card className="p-3 hidden xl:block">
                <p className="text-xs text-slate-500 mb-2">Hasil pencarian</p>
                {searchResults.length ? (
                  searchResults.map((r) => (
                    <Link
                      key={r.id}
                      to={r.type === 'competition' ? `/lomba/${r.slug}` : '/feed'}
                      className="flex items-center gap-3 p-2 rounded-lg hover:bg-white/5 mb-1 last:mb-0"
                    >
                      <div className="w-8 h-8 rounded-lg bg-moss-500/10 flex items-center justify-center shrink-0">
                        {r.type === 'competition' ? (
                          <Trophy size={14} className="text-moss-400" />
                        ) : (
                          <FileText size={14} className="text-moss-400" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-white truncate">{r.title}</p>
                        <p className="text-[10px] text-slate-500">
                          {r.type === 'competition' ? 'Lomba' : 'Postingan'}
                        </p>
                      </div>
                    </Link>
                  ))
                ) : (
                  <p className="text-xs text-slate-500 text-center py-2">Tidak ditemukan.</p>
                )}
              </Card>
            )}

            {/* Personal Notifications + Kompetensi + Daily Tasks */}
            <Card className="p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-xs text-slate-500">Personal</p>
                  <h3 className="font-display font-semibold text-white">Notifikasi kamu</h3>
                </div>
                <Link to="/notifications" className="text-xs text-moss-400">
                  Lihat semua
                </Link>
              </div>

              {/* Uji Kompetensi terbuka */}
              {!isGuest && nextCompetition && (
                <Link
                  to={`/lomba/${nextCompetition.slug}`}
                  className="flex items-center gap-3 p-2.5 rounded-xl bg-moss-500/5 border border-moss-500/10 mb-2"
                >
                  <div className="w-9 h-9 rounded-lg bg-moss-500/15 flex items-center justify-center shrink-0">
                    <Trophy size={16} className="text-moss-400" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-white">Uji Kompetensi terbuka</p>
                    <p className="text-[10px] text-slate-500 truncate">{nextCompetition.title}</p>
                  </div>
                  <Badge color="moss">Lihat</Badge>
                </Link>
              )}

              {/* Daily Tasks */}
              {!isGuest && (
                <Link
                  to="/daily-tasks"
                  className="flex items-center gap-3 p-2.5 rounded-xl bg-amber-500/5 border border-amber-500/10 mb-2"
                >
                  <div className="w-9 h-9 rounded-lg bg-amber-500/15 flex items-center justify-center shrink-0">
                    <Flame size={16} className="text-amber-400" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-white">Daily Tasks</p>
                    <p className="text-[10px] text-slate-500">Bangun XP melalui aktivitas harian.</p>
                  </div>
                </Link>
              )}

              {/* Notification items */}
              {unread.length ? (
                unread.map((n) => (
                  <Link
                    key={n.id}
                    to={n.link ?? '/notifications'}
                    className="block rounded-xl border border-white/5 bg-ink-800/35 p-3 mb-2 last:mb-0"
                  >
                    <p className="text-xs font-semibold text-white line-clamp-1">{n.title}</p>
                    <p className="text-[11px] text-slate-500 mt-1 line-clamp-2">{n.body}</p>
                    <span className="text-[10px] text-slate-600 block mt-2">{timeAgo(n.createdAt)}</span>
                  </Link>
                ))
              ) : (
                <p className="text-xs text-slate-500 py-4 text-center">Tidak ada notifikasi baru.</p>
              )}
            </Card>

            {/* Top 5 Leaderboard with XP Global / Point Edu toggle */}
            <Card className="p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-xs text-slate-500">Peringkat</p>
                  <h3 className="font-display font-semibold text-white">Top 5</h3>
                </div>
                <Link to="/leaderboard" className="text-xs text-moss-400">
                  Semua
                </Link>
              </div>
              <div className="grid grid-cols-2 bg-ink-800 rounded-lg p-1 mb-3">
                <button
                  onClick={() => setLeaderMode('xp')}
                  className={`text-[11px] py-1.5 rounded-md font-medium ${
                    leaderMode === 'xp' ? 'bg-moss-500/15 text-moss-300' : 'text-slate-500'
                  }`}
                >
                  XP Global
                </button>
                <button
                  onClick={() => setLeaderMode('coin')}
                  className={`text-[11px] py-1.5 rounded-md font-medium ${
                    leaderMode === 'coin' ? 'bg-moss-500/15 text-moss-300' : 'text-slate-500'
                  }`}
                >
                  Point Edu
                </button>
              </div>
              <div className="space-y-2.5">
                {leaderMode === 'xp'
                  ? leaders.map((u) => (
                      <div key={u.user_id} className="flex items-center gap-2">
                        <div className="w-5 text-[10px] text-slate-500 text-center">{u.rank}</div>
                        <Avatar
                          name={u.display_name || u.username || 'U'}
                          id={u.user_id}
                          size={30}
                          src={u.avatar_url || undefined}
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-white truncate">{u.display_name || u.username}</p>
                          <p className="text-[10px] text-slate-500 truncate">{u.institution || '—'}</p>
                        </div>
                        <span className="text-xs text-moss-300 font-semibold">
                          {Number(u.xp || 0).toLocaleString('id-ID')}
                        </span>
                      </div>
                    ))
                  : coinLeaders.map((u) => (
                      <div key={u.user_id} className="flex items-center gap-2">
                        <div className="w-5 text-[10px] text-slate-500 text-center">{u.rank}</div>
                        <Avatar
                          name={u.display_name || u.username || 'U'}
                          id={u.user_id}
                          size={30}
                          src={u.avatar_url || undefined}
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-white truncate">{u.display_name || u.username}</p>
                          <p className="text-[10px] text-slate-500 truncate">{u.institution || '—'}</p>
                        </div>
                        <span className="text-xs text-amber-300 font-semibold">
                          {Number(u.edu_coin || 0).toLocaleString('id-ID')}
                        </span>
                      </div>
                    ))}
              </div>
            </Card>
          </aside>
        </div>
      </div>
    </div>
  );
}
function FeedPostCard({post,expanded,onExpand,onLike,onShare,onOpen,isGuest}:{post:SocialPost;expanded:boolean;onExpand:()=>void;onLike:()=>void;onShare:()=>void;onOpen:()=>void;isGuest:boolean}){return <Card className="p-4"><div className="flex gap-3"><Link to={`/profile/${post.author_username}`}><Avatar name={post.author_name} id={post.author_user_id} size={44} src={post.avatar_url??undefined}/></Link><div className="flex-1 min-w-0"><div className="flex items-center gap-2"><Link to={`/profile/${post.author_username}`} className="text-sm font-semibold text-white truncate">{post.author_name}</Link><span className="chip bg-moss-500/10 text-moss-300 border border-moss-500/20 text-[10px]">{post.competition_id?'Lomba':'Prestasi'}</span><span className="text-xs text-slate-600">· {timeAgo(post.created_at)}</span></div><p className="text-xs text-slate-500 mb-2">@{post.author_username}</p>{post.competition_id?<button onClick={onOpen} className="text-left w-full"><h3 className="font-display font-semibold text-[15px] text-white mb-1.5">{post.title}</h3><p className="text-sm text-slate-300 leading-relaxed mb-3">{post.body}</p>{post.cover_url&&<img src={post.cover_url} alt={post.title} loading="lazy" className="w-full max-h-96 object-cover rounded-xl border border-white/5"/>}<p className="text-xs text-moss-400 flex items-center gap-1 mt-3">Lihat detail uji kompetensi <ChevronRight size={14}/></p></button>:<><h3 className="font-display font-semibold text-[15px] text-white mb-1.5">{post.title}</h3><p className="text-sm text-slate-300 leading-relaxed mb-3 whitespace-pre-line">{post.body}</p>{post.cover_url&&<img src={post.cover_url} alt={post.title} loading="lazy" className="w-full max-h-96 object-cover rounded-xl border border-white"/>}</>}<div className="flex items-center justify-between max-w-md text-slate-500 mt-3"><button onClick={onLike} disabled={isGuest} className={`flex items-center gap-1.5 text-xs ${post.liked?'text-moss-400':''}`}><Heart size={16} className={post.liked?'fill-moss-400':''}/>{post.likes}</button><button onClick={onExpand} className="flex items-center gap-1.5 text-xs"><MessageCircle size={16}/>{post.comments}</button><button onClick={onShare} className="flex items-center gap-1.5 text-xs"><Share2 size={16}/></button></div>{expanded&&<CommentsSection postId={post.id}/>}</div></div></Card>}
