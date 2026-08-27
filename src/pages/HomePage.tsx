import { useEffect, useMemo, useState } from 'react';
import { Calendar, ChevronRight, FileText, Flame, Heart, MessageCircle, Search, Share2, Sparkles, Trophy } from 'lucide-react';
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
      <div className="px-4 py-4">
        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_340px] gap-5 items-start">

          {/* ===== CENTER COLUMN ===== */}
          <main className="space-y-4 min-w-0">
            {/* Lomba / Prestasi tabs — centered */}
            <div className="flex justify-center">
              <div className="flex gap-1 bg-ink-800 rounded-xl p-1">
                {(['lomba', 'prestasi'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    className={`px-8 py-2.5 rounded-lg text-sm font-medium transition ${
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

          {/* ===== RIGHT SIDEBAR ===== */}
          <aside className="space-y-4 lg:sticky lg:top-4">
            {/* Search bar */}
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                className="input pl-9 text-sm"
                placeholder="Cari lomba, pengguna..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            {searchQuery && (
              <Card className="p-3">
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

            {/* Top 5 Peringkat */}
            <Card className="p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-display font-semibold text-white text-sm">Top 5 Peringkat</h3>
                <Link to="/leaderboard" className="text-[11px] text-moss-400 hover:text-moss-300">
                  Lihat semua
                </Link>
              </div>
              <div className="space-y-2.5">
                {leaders.map((u) => {
                  const rankColor =
                    u.rank === 1 ? 'bg-emerald-500/20 text-emerald-400' :
                    u.rank === 2 ? 'bg-sky-500/20 text-sky-400' :
                    u.rank === 3 ? 'bg-amber-500/20 text-amber-400' :
                    'bg-slate-500/15 text-slate-400';
                  return (
                    <div key={u.user_id} className="flex items-center gap-2.5">
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
                    </div>
                  );
                })}
                {leaders.length === 0 && (
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
                {competitions
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

function FeedPostCard({post,expanded,onExpand,onLike,onShare,onOpen,isGuest}:{post:SocialPost;expanded:boolean;onExpand:()=>void;onLike:()=>void;onShare:()=>void;onOpen:()=>void;isGuest:boolean}){return <Card className="p-4"><div className="flex gap-3"><Link to={`/profile/${post.author_username}`}><Avatar name={post.author_name} id={post.author_user_id} size={44} src={post.avatar_url??undefined}/></Link><div className="flex-1 min-w-0"><div className="flex items-center gap-2"><Link to={`/profile/${post.author_username}`} className="text-sm font-semibold text-white truncate">{post.author_name}</Link><span className="chip bg-moss-500/10 text-moss-300 border border-moss-500/20 text-[10px]">{post.competition_id?'Lomba':'Prestasi'}</span><span className="text-xs text-slate-600">· {timeAgo(post.created_at)}</span></div><p className="text-xs text-slate-500 mb-2">@{post.author_username}</p>{post.competition_id?<button onClick={onOpen} className="text-left w-full"><h3 className="font-display font-semibold text-[15px] text-white mb-1.5">{post.title}</h3><p className="text-sm text-slate-300 leading-relaxed mb-3">{post.body}</p>{post.cover_url&&<img src={post.cover_url} alt={post.title} loading="lazy" className="w-full max-h-96 object-cover rounded-xl border border-white/5"/>}<p className="text-xs text-moss-400 flex items-center gap-1 mt-3">Lihat detail uji kompetensi <ChevronRight size={14}/></p></button>:<><h3 className="font-display font-semibold text-[15px] text-white mb-1.5">{post.title}</h3><p className="text-sm text-slate-300 leading-relaxed mb-3 whitespace-pre-line">{post.body}</p>{post.cover_url&&<img src={post.cover_url} alt={post.title} loading="lazy" className="w-full max-h-96 object-cover rounded-xl border border-white"/>}</>}<div className="flex items-center justify-between max-w-md text-slate-500 mt-3"><button onClick={onLike} disabled={isGuest} className={`flex items-center gap-1.5 text-xs ${post.liked?'text-moss-400':''}`}><Heart size={16} className={post.liked?'fill-moss-400':''}/>{post.likes}</button><button onClick={onExpand} className="flex items-center gap-1.5 text-xs"><MessageCircle size={16}/>{post.comments}</button><button onClick={onShare} className="flex items-center gap-1.5 text-xs"><Share2 size={16}/></button></div>{expanded&&<CommentsSection postId={post.id}/>}</div></div></Card>}
