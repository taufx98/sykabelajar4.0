import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Edit2, Calendar, Trophy, Award, GraduationCap } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge, RankBadge } from '@/components/ui/Badge';
import { Avatar } from '@/components/ui/Avatar';
import { useApp } from '@/store/AppContext';
import { supabase } from '@/lib/supabase';
import { uploadImage } from '@/services/cloudinary.service';
import { formatShortDate } from '@/lib/utils';

export function ProfilePage() {
  const { username } = useParams();
  const { user: currentUser, toast } = useApp();
  const [profile, setProfile] = useState<any>(null);
  const [awards, setAwards] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const isOwn = currentUser?.username === username;

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const { data: p, error } = await supabase.from('public_profiles').select('id,username,full_name,institution,avatar_url,bio,created_at').eq('username', username || '').maybeSingle();
        if (error) throw error;
        if (!p) { if (alive) setProfile(null); return; }
        const { data: a } = await supabase.from('awards').select('*').eq('user_id', p.id).order('issued_at', { ascending: false });
        if (alive) { setProfile(p); setAwards(a || []); }
      } catch (e: any) { if (alive) toast(e?.message || 'Profil gagal dimuat.', 'error'); }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [username, toast]);

  const uploadCover = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file || !currentUser || !isOwn) return;
    try {
      const result = await uploadImage(file, `sykabelajar/users/covers/${currentUser.id}`);
      const { error } = await supabase.from('profiles').update({ cover_url: result.secure_url, updated_at: new Date().toISOString() }).eq('id', currentUser.id);
      if (error) throw error;
      toast('Foto sampul diperbarui.', 'success');
      setProfile(prev => prev ? {...prev, cover_url: result.secure_url} : prev);
    } catch (e: any) { toast(e?.message || 'Upload gagal.', 'error'); }
    finally { e.target.value = ''; }
  };

  if (loading) return <div className="p-6 text-sm text-slate-500">Memuat profil…</div>;
  if (!profile) return <div className="p-6"><Card className="p-8 text-center text-slate-500">Profil tidak ditemukan.</Card></div>;
  return <div>
    <div className="relative h-32 md:h-40 bg-gradient-to-br from-ink-700 via-ink-800 to-moss-900/30">
      {profile.cover_url && <img src={profile.cover_url} alt="Cover" className="w-full h-full object-cover"/>}
      {isOwn && <label className="absolute bottom-2 right-2 px-3 py-1.5 rounded-lg bg-black/60 text-xs text-white cursor-pointer">Ganti Sampul<input type="file" accept="image/*" className="hidden" onChange={uploadCover}/></label>}
    </div>
    <div className="p-4 -mt-10 relative">
      <div className="flex items-end gap-3"><Avatar name={profile.full_name || profile.username || 'U'} id={profile.id} size={84} ring src={profile.avatar_url || undefined}/><div className="pb-1 flex-1"><h1 className="font-display text-xl font-bold text-white">{profile.full_name || profile.username}</h1><p className="text-xs text-slate-500">@{profile.username}</p></div>{isOwn && <Link to="/profile/edit"><Button size="sm" variant="outline" icon={<Edit2 size={14}/>}>Edit</Button></Link>}</div>
      <Card className="p-4 mt-4"><div className="flex items-center gap-2 text-xs text-slate-400"><GraduationCap size={15} className="text-moss-400"/>{profile.institution || 'Institusi belum diisi'}</div>{profile.bio && <p className="text-sm text-slate-300 mt-3">{profile.bio}</p>}<p className="text-[11px] text-slate-600 mt-3 flex items-center gap-1"><Calendar size={11}/> Bergabung {formatShortDate(profile.created_at)}</p></Card>
      <div className="grid grid-cols-3 gap-2 mt-4"><Card className="p-3 text-center"><p className="text-xs text-slate-500">Prestasi</p><p className="text-lg font-bold text-white">{awards.length}</p></Card><Card className="p-3 text-center"><p className="text-xs text-slate-500">XP</p><p className="text-lg font-bold text-white">—</p></Card><Card className="p-3 text-center"><p className="text-xs text-slate-500">Status</p><Badge color="moss">Aktif</Badge></Card></div>
      <div className="flex items-center gap-2 mt-6"><Trophy size={17} className="text-moss-400"/><h2 className="font-display font-bold text-white">Prestasi</h2></div>
      <div className="grid sm:grid-cols-2 gap-3 mt-3">{awards.map((a)=><Card key={a.id} className="p-4"><div className="flex items-center gap-3"><div className="w-10 h-10 rounded-xl bg-moss-500/10 flex items-center justify-center"><Award size={18} className="text-moss-400"/></div><div className="flex-1 min-w-0"><p className="text-sm text-white font-semibold truncate">{a.title}</p><p className="text-xs text-slate-500">{a.rank_code || 'Penghargaan'} · {a.issued_at ? formatShortDate(a.issued_at) : '—'}</p></div><RankBadge rank={parseInt(String(a.rank_code).replace(/\D/g, '')) || 0} /></div></Card>)}{!awards.length && <Card className="p-8 text-center text-sm text-slate-500 sm:col-span-2">Belum ada penghargaan.</Card>}</div>
    </div>
  </div>;
}
