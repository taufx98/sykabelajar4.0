import { useEffect, useMemo, useState } from 'react';
import { Heart, MessageCircle, Send, CornerDownRight, RefreshCw } from 'lucide-react';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { useApp } from '@/store/AppContext';
import { timeAgo } from '@/lib/utils';
import { addPostComment, listPostComments, toggleCommentLike, type SocialComment } from '@/services/social.service';
import type { Comment as CommentType } from '@/types';

function mapComments(rows: SocialComment[]): CommentType[] {
  const roots = rows.filter((row) => !row.parentId);
  const replies = new Map<string, SocialComment[]>();
  for (const row of rows) if (row.parentId) replies.set(row.parentId, [...(replies.get(row.parentId) ?? []), row]);
  const map = (row: SocialComment): CommentType => ({
    id: row.id, postId: row.postId, userId: row.userId, authorName: row.authorName, authorUsername: row.authorUsername,
    authorId: row.authorId, body: row.body, createdAt: row.createdAt, likes: row.likes, liked: row.liked,
    replies: (replies.get(row.id) ?? []).map((reply) => ({ ...map(reply), replies: [] })),
  });
  return roots.map(map);
}

export function CommentsSection({ postId, comments: initialComments = [] }: { postId: string; comments?: CommentType[] }) {
  const { user, isGuest, toast } = useApp();
  const [comments, setComments] = useState<CommentType[]>(initialComments);
  const [input, setInput] = useState('');
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyInput, setReplyInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    if (!postId || postId.startsWith('f-')) { setComments([]); return; }
    setLoading(true);
    try { setComments(mapComments(await listPostComments(postId))); }
    catch (error: any) { toast(error?.message ?? 'Komentar gagal dimuat.', 'error'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [postId]);

  const total = useMemo(() => comments.reduce((sum, c) => sum + 1 + c.replies.length, 0), [comments]);

  const submit = async (body: string, parentId?: string) => {
    if (!user || isGuest || !body.trim()) return;
    setSubmitting(true);
    try {
      await addPostComment(postId, body, parentId);
      if (parentId) { setReplyInput(''); setReplyTo(null); } else setInput('');
      toast('Komentar berhasil diposting.', 'success');
      await load();
    } catch (error: any) { toast(error?.message ?? 'Komentar gagal dikirim.', 'error'); }
    finally { setSubmitting(false); }
  };

  const like = async (commentId: string) => {
    if (!user || isGuest) return;
    try { await toggleCommentLike(commentId); await load(); }
    catch (error: any) { toast(error?.message ?? 'Gagal memperbarui like.', 'error'); }
  };

  return <div className="mt-4 border-t border-white/5 pt-4">
    <div className="flex items-center justify-between mb-3"><p className="text-xs font-semibold text-slate-400">Komentar ({total})</p><button onClick={() => void load()} disabled={loading} className="p-1.5 rounded-lg hover:bg-white/5 text-slate-500" title="Refresh komentar"><RefreshCw size={13} className={loading ? 'animate-spin' : ''}/></button></div>
    {!isGuest && user ? <div className="flex gap-2 mb-4"><Avatar name={user.displayName} id={user.id} size={32} src={user.profilePhoto}/><div className="flex-1 flex gap-2"><input className="input text-sm" placeholder="Tulis komentar..." value={input} disabled={submitting} onChange={(e)=>setInput(e.target.value)} onKeyDown={(e)=>e.key==='Enter'&&void submit(input)}/><Button size="sm" disabled={!input.trim()} loading={submitting} onClick={()=>void submit(input)} icon={<Send size={14}/>}>Kirim</Button></div></div> : <div className="mb-4 p-3 rounded-xl bg-ink-800/50 text-center text-xs text-slate-500">Masuk untuk berkomentar</div>}
    <div className="space-y-3">{comments.map((comment)=><div key={comment.id}><div className="flex gap-2.5"><Avatar name={comment.authorName} id={comment.authorId} size={32}/><div className="flex-1 min-w-0"><div className="bg-ink-800/50 rounded-xl px-3 py-2"><div className="flex items-center gap-1.5"><span className="text-xs font-semibold text-white">{comment.authorName}</span><span className="text-[10px] text-slate-500">@{comment.authorUsername}</span><span className="text-[10px] text-slate-600">· {timeAgo(comment.createdAt)}</span></div><p className="text-sm text-slate-300 mt-1">{comment.body}</p></div><div className="flex items-center gap-3 mt-1 ml-1"><button onClick={()=>void like(comment.id)} disabled={!user||isGuest} className={`flex items-center gap-1 text-[11px] ${comment.liked?'text-moss-400':'text-slate-500 hover:text-moss-300'}`}><Heart size={12} className={comment.liked?'fill-moss-400':''}/> {comment.likes}</button>{user&&!isGuest&&<button onClick={()=>setReplyTo(replyTo===comment.id?null:comment.id)} className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-moss-300"><MessageCircle size={12}/> Balas</button>}</div>{replyTo===comment.id&&user&&!isGuest&&<div className="flex gap-2 mt-2"><input autoFocus className="input text-sm py-2" placeholder="Balas komentar..." value={replyInput} onChange={(e)=>setReplyInput(e.target.value)} onKeyDown={(e)=>e.key==='Enter'&&void submit(replyInput,comment.id)}/><Button size="sm" loading={submitting} disabled={!replyInput.trim()} onClick={()=>void submit(replyInput,comment.id)} icon={<Send size={13}/>}>Kirim</Button></div>}{comment.replies.length>0&&<div className="mt-2 space-y-2">{comment.replies.map((reply)=><div key={reply.id} className="flex gap-2"><CornerDownRight size={15} className="text-slate-600 mt-1 shrink-0"/><Avatar name={reply.authorName} id={reply.authorId} size={24}/><div className="flex-1"><div className="bg-ink-800/40 rounded-xl px-3 py-2"><div className="flex items-center gap-1.5"><span className="text-xs font-semibold text-white">{reply.authorName}</span><span className="text-[10px] text-slate-500">@{reply.authorUsername}</span><span className="text-[10px] text-slate-600">· {timeAgo(reply.createdAt)}</span></div><p className="text-sm text-slate-300 mt-1">{reply.body}</p></div><button onClick={()=>void like(reply.id)} disabled={!user||isGuest} className={`flex items-center gap-1 text-[11px] mt-1 ml-1 ${reply.liked?'text-moss-400':'text-slate-500 hover:text-moss-300'}`}><Heart size={12} className={reply.liked?'fill-moss-400':''}/> {reply.likes}</button></div></div>)}</div>}</div></div></div>)}{!loading&&!comments.length&&<p className="text-xs text-slate-600 text-center py-4">Belum ada komentar. Jadilah yang pertama!</p>}</div>
  </div>;
}
