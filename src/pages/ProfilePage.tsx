import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Award, Calendar, Coins, Edit2, GraduationCap, Lock, MessageCircle, School, TrendingUp, Trophy } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Avatar } from '@/components/ui/Avatar';
import { useApp } from '@/store/AppContext';
import { supabase } from '@/lib/supabase';
import { uploadProfileImage } from '@/services/cloudinary.service';
import { CATEGORY_LABELS, GRADE_OPTIONS } from '@/data/catalog';
import { getFollowStatus, removeFollow, requestFollow, type FollowStatus } from '@/services/chat.service';
import { VerifiedMark } from '@/components/ui/VerifiedMark';

type Tab = 'prestasi' | 'lomba' | 'statistik' | 'badge' | 'kategori' | 'banned';

export function ProfilePage() {
  const { username } = useParams();
  const { user: currentUser, toast } = useApp();
  const [profile, setProfile] = useState<any>(null);
  const [awards, setAwards] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('prestasi');
  const [followStatus, setFollowStatus] = useState<FollowStatus>('none');
  const [followBusy, setFollowBusy] = useState(false);
  const [followers, setFollowers] = useState(0);
  const [following, setFollowing] = useState(0);
  const [xpDelta, setXpDelta] = useState(0);
  const [eduDelta, setEduDelta] = useState(0);
  const isOwn = currentUser?.username === username;

  useEffect(() => {
    let alive = true;
    const load = async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase.from('profiles').select('*').eq('username', username || '').maybeSingle();
        if (error) throw error;
        if (!data) { if (alive) setProfile(null); return; }
        const [{ data: awardRows }, { data: socialRows }] = await Promise.all([
          supabase.from('awards').select('*').eq('user_id', data.id).order('issued_at', { ascending: false }),
          supabase.rpc('get_public_profile_social', { p_profile_id: data.id }),
        ]);
        const social: any = Array.isArray(socialRows) ? socialRows[0] : socialRows;
        let fs: FollowStatus = 'none';
        if (currentUser && currentUser.id !== data.id) fs = await getFollowStatus(currentUser.id, data.id).catch(() => 'none');
        if (!alive) return;
        setProfile(data);
        setAwards(awardRows ?? []);
        setFollowers(Number(social?.follower_count ?? 0));
        setFollowing(Number(social?.following_count ?? 0));
        setFollowStatus(fs);
      } catch (e: any) {
        if (alive) toast(e?.message ?? 'Profil gagal dimuat.', 'error');
      } finally {
        if (alive) setLoading(false);
      }
    };
    void load();
    return () => { alive = false; };
  }, [username, currentUser?.id, toast]);

  useEffect(() => {
    if (!profile?.id) return;
    let previousXp = Number(profile.total_xp ?? 0);
    let previousEdu = Number(profile.edu_coin ?? 0);
    const channel = supabase.channel(`profile-live-${profile.id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${profile.id}` }, payload => {
        const next: any = payload.new;
        const nextXp = Number(next.total_xp ?? 0);
        const nextEdu = Number(next.edu_coin ?? 0);
        if (nextXp !== previousXp) { setXpDelta(nextXp - previousXp); window.setTimeout(() => setXpDelta(0), 4500); }
        if (nextEdu !== previousEdu) { setEduDelta(nextEdu - previousEdu); window.setTimeout(() => setEduDelta(0), 4500); }
        previousXp = nextXp;
        previousEdu = nextEdu;
        setProfile((old: any) => ({ ...old, ...next }));
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [profile?.id]);

  const toggleFollow = async () => {
    if (!currentUser || isOwn || followBusy || !profile) return;
    const before = followStatus;
    const approved = before === 'approved' || before === 'auto';
    const next: FollowStatus = approved ? 'none' : (profile.is_public ? 'approved' : 'pending');
    setFollowBusy(true);
    setFollowStatus(next);
    if (next === 'approved') setFollowers(v => v + 1);
    if (approved) setFollowers(v => Math.max(0, v - 1));
    try {
      if (approved) await removeFollow(profile.id); else await requestFollow(profile.id);
      toast(next === 'pending' ? 'Permintaan mengikuti dikirim.' : next === 'approved' ? 'Sekarang mengikuti pengguna ini.' : 'Berhenti mengikuti.', next === 'none' ? 'info' : 'success');
    } catch (e: any) {
      setFollowStatus(before);
      if (next === 'approved') setFollowers(v => Math.max(0, v - 1));
      if (approved) setFollowers(v => v + 1);
      toast(e?.message ?? 'Gagal memperbarui follow.', 'error');
    } finally { setFollowBusy(false); }
  };

  const uploadCover = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !currentUser || !isOwn || !profile) return;
    try {
      const result = await uploadProfileImage(file, 'cover', profile.username, profile.cover_public_id || `sykabelajar/${profile.username}/cover`);
      const { data, error } = await supabase.from('profiles').update({ cover_url: result.secure_url, cover_public_id: result.public_id }).eq('id', currentUser.id).select('*').single();
      if (error) throw error;
      setProfile((old: any) => ({ ...old, ...data }));
      toast('Sampul diperbarui.', 'success');
    } catch (e: any) { toast(e?.message ?? 'Upload gagal.', 'error'); }
    finally { event.target.value = ''; }
  };

  if (loading) return <div className="p-6 text-sm text-fg-muted">Memuat profil…</div>;
  if (!profile) return <div className="p-6"><Card className="p-10 text-center text-fg-muted">Profil tidak ditemukan.</Card></div>;

  const grade = GRADE_OPTIONS.find(x => x.value === profile.grade)?.label || profile.grade || '';
  const categories = String(profile.subjects ?? '').split(',').map((v: string) => v.trim()).filter(Boolean);
  const badges: string[] = Array.isArray(profile.badge_showcase) && profile.badge_showcase.length ? profile.badge_showcase.slice(0, 3) : (Array.isArray(profile.badges) ? profile.badges.slice(0, 3) : []);
  const allBadges: string[] = Array.isArray(profile.badges) ? profile.badges : [];
  const tabs: Array<[Tab, string]> = [['prestasi', 'Prestasi'], ['lomba', 'Lomba'], ['statistik', 'Statistik'], ['badge', 'Badge'], ['kategori', 'Kategori Favorit']];
  if (isOwn) tabs.push(['banned', 'Banned']);

  return (
    <div className="w-full pb-10">
      <div className="relative h-32 md:h-44 surface-bg overflow-hidden">
        {profile.cover_url && <img src={profile.cover_url} alt="" className="h-full w-full object-cover" />}
        {isOwn && <label className="absolute right-3 bottom-3 rounded-lg bg-black/50 px-3 py-1.5 text-[11px] text-white cursor-pointer">Ganti Sampul<input hidden type="file" accept="image/*" onChange={uploadCover} /></label>}
      </div>
      <div className="relative -mt-11 px-4 text-center">
        <Avatar name={profile.full_name || profile.username || 'U'} id={profile.id} size={88} ring src={profile.avatar_url || undefined} />
        <div className="mt-3 flex items-center justify-center gap-1.5"><h1 className="text-xl md:text-2xl font-bold text-fg">{profile.full_name || profile.username}</h1><VerifiedMark type={profile.verification_type} /></div>
        <p className="text-sm text-fg-muted">@{profile.username}</p>
        {profile.bio && <p className="mx-auto mt-2 max-w-xl text-sm text-fg-secondary">{profile.bio}</p>}
        <div className="mt-3 flex flex-wrap justify-center gap-4 text-[11px] text-fg-muted">
          {profile.institution && <span className="inline-flex items-center gap-1"><School size={12}/>{profile.institution}</span>}
          {grade && <span className="inline-flex items-center gap-1"><GraduationCap size={12}/>{grade}</span>}
          {profile.birth_date && <span className="inline-flex items-center gap-1"><Calendar size={12}/>Lahir {new Date(profile.birth_date).toLocaleDateString('id-ID',{day:'numeric',month:'long',year:'numeric'})}</span>}
        </div>
        {badges.length > 0 && <div className="mt-3 flex flex-wrap justify-center gap-2">{badges.map((b,i)=><span key={`${b}-${i}`} className="chip">{b}</span>)}</div>}
        <div className="mt-4 flex justify-center gap-6 text-sm"><Link className="hover:text-accent" to={`/profile/${profile.username}/followers?tab=followers`}><b>{followers}</b> <span className="text-fg-muted">Pengikut</span></Link><Link className="hover:text-accent" to={`/profile/${profile.username}/followers?tab=following`}><b>{following}</b> <span className="text-fg-muted">Mengikuti</span></Link></div>
        <div className="mt-4 flex justify-center gap-2">
          {isOwn ? <Link to="/profile/edit"><Button size="sm" variant="outline" icon={<Edit2 size={14}/>}>Edit Profil</Button></Link> : currentUser ? <Button size="sm" disabled={followBusy} variant={followStatus === 'approved' || followStatus === 'auto' ? 'outline' : 'primary'} onClick={() => void toggleFollow()}>{followStatus === 'pending' ? 'Diminta' : followStatus === 'approved' || followStatus === 'auto' ? 'Unfollow' : 'Ikuti'}</Button> : null}
          {!isOwn && currentUser && (followStatus === 'approved' || followStatus === 'auto') && <Link to={`/admin/chat?user_id=${profile.id}`}><Button size="sm" variant="outline" icon={<MessageCircle size={14}/>}>Kirim Pesan</Button></Link>}
        </div>
      </div>

      <div className="px-4 md:px-8 mt-6"><div className="mx-auto max-w-5xl">
        <div className="flex justify-center overflow-x-auto no-scrollbar border-b surface-border">{tabs.map(([key,label])=><button key={key} onClick={()=>setTab(key)} className={`relative whitespace-nowrap px-4 py-3 text-sm font-medium ${tab===key?'text-accent':'text-fg-muted hover:text-fg'}`}>{label}{tab===key&&<span className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full bg-accent"/>}</button>)}</div>
        {tab==='prestasi'&&<div className="mt-4 space-y-3">{awards.length?awards.slice(0,10).map(a=><Card key={a.id} className="p-4 flex items-center gap-3"><div className="w-10 h-10 rounded-xl surface-elevated flex items-center justify-center"><Award size={18} className="text-accent"/></div><div className="min-w-0 flex-1"><p className="truncate font-semibold text-fg">{a.title}</p><p className="truncate text-xs text-fg-muted">{a.subtitle||a.rank_code||'Penghargaan'}</p></div>{a.points!=null&&<span className="text-sm font-bold text-accent">+{a.points}</span>}</Card>):<Card className="p-8 text-center text-fg-muted">Belum ada penghargaan.</Card>}</div>}
        {tab==='lomba'&&<Card className="mt-4 p-8 text-center text-fg-muted"><Trophy size={24} className="mx-auto mb-2"/>Riwayat lomba tersedia di profil peserta.</Card>}
        {tab==='statistik'&&<div className="mt-4 grid gap-3 md:grid-cols-3"><Card className="p-5"><p className="text-xs text-fg-muted">XP</p><p className="text-2xl font-bold text-fg">{Number(profile.total_xp??0).toLocaleString('id-ID')} {xpDelta!==0&&<span className={xpDelta>0?'text-emerald-400 text-xs':'text-red-400 text-xs'}>{xpDelta>0?'+':''}{xpDelta}</span>}</p></Card><Card className="p-5"><p className="text-xs text-fg-muted">EduCoin</p><p className="text-2xl font-bold text-fg">{Number(profile.edu_coin??0).toLocaleString('id-ID')} {eduDelta!==0&&<span className={eduDelta>0?'text-emerald-400 text-xs':'text-red-400 text-xs'}>{eduDelta>0?'+':''}{eduDelta}</span>}</p></Card><Card className="p-5"><p className="text-xs text-fg-muted">Awards</p><p className="text-2xl font-bold text-fg">{awards.length}</p></Card></div>}
        {tab==='badge'&&<Card className="mt-4 p-5"><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{allBadges.length?allBadges.map((b,i)=><div key={i} className="rounded-xl border surface-border surface-elevated px-3 py-2 text-sm text-fg">{b}</div>):<p className="text-sm text-fg-muted">Belum ada badge.</p>}</div></Card>}
        {tab==='kategori'&&<Card className="mt-4 p-5"><div className="flex flex-wrap gap-2">{categories.length?categories.map(c=><span key={c} className="chip">{CATEGORY_LABELS[c]||c}</span>):<p className="text-sm text-fg-muted">Belum ada kategori favorit.</p>}</div></Card>}
        {tab==='banned'&&<BlockedPanel/>}
      </div></div>
    </div>
  );
}

function BlockedPanel(){
  const{toast}=useApp();const[rows,setRows]=useState<any[]>([]);
  useEffect(()=>{let live=true;(async()=>{const{data,error}=await supabase.from('chat_blocks').select('blocked_id,created_at').order('created_at',{ascending:false});if(error){toast(error.message,'error');return;}const ids=(data??[]).map(x=>x.blocked_id);if(!ids.length){if(live)setRows([]);return;}const{data:profiles}=await supabase.from('profiles').select('id,username,full_name,avatar_url').in('id',ids);if(live)setRows((data??[]).map(x=>({...x,profile:(profiles??[]).find(p=>p.id===x.blocked_id)})));})();return()=>{live=false;};},[toast]);
  return <Card className="mt-4 p-5">{rows.length===0?<p className="text-sm text-fg-muted">Belum ada pengguna yang diblokir.</p>:rows.map(x=><div key={x.blocked_id} className="flex items-center gap-3 py-2"><Avatar name={x.profile?.full_name||x.profile?.username||'User'} id={x.blocked_id} size={36} src={x.profile?.avatar_url||undefined}/><div className="min-w-0 flex-1"><p className="truncate text-sm text-fg">{x.profile?.full_name||x.profile?.username}</p><p className="text-xs text-fg-muted">@{x.profile?.username}</p></div><Lock size={14} className="text-red-400"/></div>)}</Card>;
}
