import { useEffect, useState } from 'react';
import { Heart, MessageCircle, RefreshCw, Send } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Avatar } from '@/components/ui/Avatar';
import { useApp } from '@/store/AppContext';
import { BannerCarousel } from '@/components/ui/BannerCarousel';
import { addPostComment, listPublishedPosts, togglePostLike, type SocialPost } from '@/services/social.service';

export function SocialFeedPage() {
  const { user, isAuthenticated, toast } = useApp();
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [comment, setComment] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try { setPosts(await listPublishedPosts()); }
    catch (e: any) { toast(e?.message ?? 'Feed gagal dimuat.', 'error'); setPosts([]); }
    finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, []);

  const like = async (post: SocialPost) => {
    if (!isAuthenticated) { toast('Masuk untuk menyukai postingan.', 'info'); return; }
    setBusy(post.id);
    // Optimistic update: toggle like count and liked state immediately
    setPosts(prev => prev.map(p => p.id === post.id
      ? { ...p, liked: !p.liked, likes: p.liked ? p.likes - 1 : p.likes + 1 }
      : p));
    try { await togglePostLike(post.id); }
    catch (e: any) {
      // Revert on failure
      setPosts(prev => prev.map(p => p.id === post.id
        ? { ...p, liked: !p.liked, likes: p.liked ? p.likes - 1 : p.likes + 1 }
        : p));
      toast(e?.message ?? 'Gagal memperbarui like.', 'error');
    }
    finally { setBusy(null); }
  };

  const sendComment = async (postId: string) => {
    if (!isAuthenticated) { toast('Masuk untuk berkomentar.', 'info'); return; }
    const text = comment[postId]?.trim();
    if (!text) return;
    setBusy(postId);
    try { await addPostComment(postId, text); setComment((c) => ({ ...c, [postId]: '' })); await load(); }
    catch (e: any) { toast(e?.message ?? 'Komentar gagal dikirim.', 'error'); }
    finally { setBusy(null); }
  };

  return <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-4"><BannerCarousel /><div className="flex items-center justify-between"><div><p className="text-xs text-moss-400 font-semibold">KOMUNITAS</p><h2 className="font-display text-2xl font-bold text-white">Feed SykaBelajar</h2><p className="text-sm text-slate-500">Postingan yang dipublikasikan dari backend.</p></div><Button size="sm" variant="outline" onClick={() => void load()} icon={<RefreshCw size={14}/>}>Refresh</Button></div>{loading&&<Card className="p-8 text-center text-sm text-slate-500">Memuat feed live...</Card>}{!loading&&!posts.length&&<Card className="p-8 text-center text-sm text-slate-500">Belum ada postingan yang dipublikasikan.</Card>}{!loading&&posts.map((p)=><Card key={p.id} className="overflow-hidden"><div className="p-4"><div className="flex items-center gap-3"><Link to={`/profile/${p.author_username}`}><Avatar name={p.author_name} id={p.author_user_id} size={40} src={p.avatar_url??undefined}/></Link><div className="min-w-0"><Link to={`/profile/${p.author_username}`} className="text-sm font-semibold text-white truncate hover:underline">{p.author_name}</Link><p className="text-xs text-slate-500">@{p.author_username||'pengguna'} · {new Date(p.created_at).toLocaleString('id-ID')}</p></div></div><h3 className="font-display font-semibold text-white mt-4">{p.title}</h3><p className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap mt-2">{p.body}</p></div>{p.cover_url&&<img src={p.cover_url} alt={p.title} className="w-full aspect-video object-cover"/>}<div className="px-4 py-3 border-t border-white/5"><div className="flex items-center gap-4"><button disabled={busy===p.id} onClick={()=>void like(p)} className={`flex items-center gap-1.5 text-xs ${p.liked?'text-red-400':'text-slate-500 hover:text-red-300'}`}><Heart size={16} fill={p.liked?'currentColor':'none'}/>{p.likes}</button><span className="flex items-center gap-1.5 text-xs text-slate-500"><MessageCircle size={16}/>{p.comments}</span></div>{isAuthenticated&&<div className="flex gap-2 mt-3"><input value={comment[p.id]??''} onChange={e=>setComment(c=>({...c,[p.id]:e.target.value}))} className="input flex-1" placeholder={`Komentari ${user?.displayName||'postingan ini'}...`}/><Button size="sm" disabled={!comment[p.id]?.trim()||busy===p.id} onClick={()=>void sendComment(p.id)} icon={<Send size={14}/>}>Kirim</Button></div>}</div></Card>)}</div>;
}
