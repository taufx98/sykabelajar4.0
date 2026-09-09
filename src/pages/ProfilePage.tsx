import { useEffect, useMemo, useState } from 'react';
import { Award, Calendar, Filter, GraduationCap, MessageCircle, School, Settings2, UserMinus, Users, X } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { Avatar } from '@/components/ui/Avatar';
import { VerifiedMark } from '@/components/ui/VerifiedMark';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { BadgeCard, type ProfileBadge } from '@/components/profile/BadgeCard';
import { useApp } from '@/store/AppContext';
import { supabase } from '@/lib/supabase';
import { getFollowStatus, removeFollow, requestFollow, blockChatUser, type FollowStatus } from '@/services/chat.service';
import { getProfileBadges, getProfileBadgeVisibility } from '@/services/badge.service';
import { CATEGORY_LABELS, GRADE_OPTIONS } from '@/data/catalog';
import { initials, avatarGradient } from '@/lib/utils';
import { optimizedCloudinaryUrl } from '@/services/cloudinary.service';

type Tab = 'prestasi' | 'lomba' | 'statistik' | 'badge' | 'kategori';
type Social = 'following' | 'followers';
const normalizeUsername = (value?: string) => decodeURIComponent(value ?? '').replace(/^@+/, '').trim().toLowerCase();

function ProfilePortrait({ name, id, src }: { name: string; id: string; src?: string | null }) {
  const common = 'w-[132px] h-[176px] sm:w-[150px] sm:h-[200px] md:w-[168px] md:h-[224px] rounded-2xl object-cover shadow-xl ring-1 ring-white/10';
  if (src) return <img src={optimizedCloudinaryUrl(src, { width: 336 })} alt={name} width={168} height={224} className={common} />;
  return <div className={`${common} bg-gradient-to-br ${avatarGradient(id)} flex items-center justify-center font-semibold text-white text-4xl`} aria-label={name}>{initials(name)}</div>;
}

function ConnectionModal({ mode, rows, close, onBlock, onUnfollow }: { mode: Social; rows: any[]; close: () => void; onBlock: (id: string) => void; onUnfollow: (id: string) => void }) {
  const [q, setQ] = useState('');
  const filtered = rows.filter((x) => `${x.full_name || ''} ${x.username || ''}`.toLowerCase().includes(q.toLowerCase()));
  return <div className="fixed inset-0 z-[120] flex items-center justify-center p-4"><button className="absolute inset-0 bg-black/70" onClick={close} aria-label="Tutup"/><div className="relative w-full max-w-xl max-h-[82vh] overflow-hidden rounded-2xl surface-card-bg border surface-border"><div className="p-4 border-b surface-border flex items-center gap-3"><Users size={18} className="text-accent"/><div className="flex-1"><h3 className="font-semibold text-fg">{mode === 'following' ? 'Mengikuti' : 'Penggemar'}</h3><p className="text-xs text-fg-muted">{filtered.length} pengguna</p></div><button onClick={close} aria-label="Tutup"><X size={18}/></button></div><div className="p-3 border-b surface-border"><input className="input w-full" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari username…"/></div><div className="max-h-[62vh] overflow-y-auto">{filtered.length === 0 ? <p className="p-8 text-center text-sm text-fg-muted">Belum ada pengguna.</p> : filtered.map((x) => <div key={x.id} className="flex items-center gap-3 p-3 border-b surface-border"><Link to={`/profile/@${x.username}`} onClick={close} className="flex-1 flex items-center gap-3 min-w-0"><Avatar name={x.full_name || x.username} id={x.id} size={40} src={x.avatar_url || undefined}/><div className="min-w-0"><p className="text-sm font-semibold text-fg truncate">{x.full_name || x.username}</p><p className="text-xs text-fg-muted">@{x.username}</p></div></Link><Button size="sm" variant="outline" onClick={() => onBlock(x.id)} icon={<UserMinus size={14}/>}>Blokir</Button>{mode === 'following' && <Button size="sm" variant="outline" onClick={() => onUnfollow(x.id)}>Unfollow</Button>}</div>)}</div></div></div>;
}

function ProfileBadgeCollection({ badges, own }: { badges: ProfileBadge[]; own: boolean }) {
  const [category, setCategory] = useState('Semua');
  const [rarity, setRarity] = useState('Semua');
  const categories = ['Semua', ...Array.from(new Set(badges.map((badge) => badge.category)))];
  const rarities = ['Semua', ...Array.from(new Set(badges.map((badge) => badge.rarity)))];
  const filtered = badges.filter((badge) => (category === 'Semua' || badge.category === category) && (rarity === 'Semua' || badge.rarity === rarity));
  return <div>
    {!own && !badges.length ? <div className="rounded-2xl border surface-border surface-elevated p-8 text-center"><Award className="mx-auto text-fg-muted" size={30}/><p className="mt-2 text-sm font-semibold text-fg">Belum ada badge yang ditampilkan.</p><p className="mt-1 text-xs text-fg-muted">Badge akan muncul di sini setelah diperoleh.</p></div> : own && !badges.length ? <div className="rounded-2xl border surface-border surface-elevated p-8 text-center"><Award className="mx-auto text-fg-muted" size={30}/><p className="mt-2 text-sm font-semibold text-fg">Belum ada badge.</p><p className="mt-1 text-xs text-fg-muted">Selesaikan misi, ikut lomba, dan aktif di komunitas untuk mendapatkannya.</p></div> : <>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3"><div><p className="font-display text-lg font-bold text-fg">Koleksi Badge</p><p className="text-xs text-fg-muted mt-0.5">{badges.length} badge telah diperoleh.</p></div><div className="flex flex-wrap gap-2"><label className="relative"><span className="sr-only">Kategori</span><select className="input pr-8 text-xs" value={category} onChange={(e) => setCategory(e.target.value)}>{categories.map((value) => <option key={value}>{value}</option>)}</select></label><label className="relative"><span className="sr-only">Rarity</span><select className="input pr-8 text-xs" value={rarity} onChange={(e) => setRarity(e.target.value)}>{rarities.map((value) => <option key={value}>{value}</option>)}</select></label></div></div>
      <div className="mt-4 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">{filtered.map((badge) => <BadgeCard key={badge.id} badge={badge}/>)}</div>
      {!filtered.length && <p className="py-8 text-center text-sm text-fg-muted">Tidak ada badge yang sesuai filter.</p>}
    </>}
  </div>;
}

export function ProfilePage() {
  const { username: rawUsername } = useParams();
  const username = useMemo(() => normalizeUsername(rawUsername), [rawUsername]);
  const { user, toast } = useApp();
  const [profile, setProfile] = useState<any>(null);
  const [awards, setAwards] = useState<any[]>([]);
  const [badges, setBadges] = useState<ProfileBadge[]>([]);
  const [badgeVisibility, setBadgeVisibility] = useState({ showBadges: true, showBadgeCollection: true });
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('prestasi');
  const [followers, setFollowers] = useState(0);
  const [following, setFollowing] = useState(0);
  const [follow, setFollow] = useState<FollowStatus>('none');
  const [busy, setBusy] = useState(false);
  const [showSocial, setShowSocial] = useState(true);
  const [showFollowing, setShowFollowing] = useState(true);
  const [social, setSocial] = useState<Social | null>(null);
  const [rows, setRows] = useState<any[]>([]);
  const own = user?.username === username;

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const p = await supabase.from('profiles').select('*').eq('username', username).maybeSingle();
        if (p.error) throw p.error;
        if (!p.data) { setProfile(null); return; }
        setProfile(p.data);
        const [a, s, u, b, v] = await Promise.all([
          supabase.from('awards').select('*').eq('user_id', p.data.id).order('issued_at', { ascending: false }),
          supabase.rpc('get_public_profile_social', { p_profile_id: p.data.id }),
          supabase.rpc('get_public_profile_ui_settings', { p_profile_id: p.data.id }),
          getProfileBadges(p.data.id).catch(() => [] as ProfileBadge[]),
          getProfileBadgeVisibility(p.data.id).catch(() => ({ showBadges: true, showBadgeCollection: true })),
        ]);
        const sr = s.error ? null : (Array.isArray(s.data) ? s.data[0] : s.data);
        const ui = u.error ? null : (Array.isArray(u.data) ? u.data[0] : u.data);
        if (alive) {
          setAwards(a.error ? [] : (a.data || []));
          setFollowers(Number(sr?.follower_count || 0));
          setFollowing(Number(sr?.following_count || 0));
          setShowSocial(ui?.show_social_popup !== false);
          setShowFollowing(ui?.show_following_popup !== false);
          setBadges(b);
          setBadgeVisibility(v);
        }
        if (user && user.id !== p.data.id) {
          const fs = await getFollowStatus(user.id, p.data.id).catch(() => 'none' as FollowStatus);
          if (alive) setFollow(fs);
        }
      } catch (e: any) {
        if (alive) { setProfile(null); toast(e?.message || 'Profil gagal dimuat.', 'error'); }
      } finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [username, user?.id, toast]);

  useEffect(() => {
    if (!social || !profile?.id) return;
    let alive = true;
    (async () => {
      try {
        const r = await supabase.rpc('get_profile_connections', { p_profile_id: profile.id, p_mode: social });
        if (r.error) throw r.error;
        if (alive) setRows(r.data || []);
      } catch (e: any) { if (alive) toast(e?.message || 'Daftar pengguna gagal dimuat.', 'error'); }
    })();
    return () => { alive = false; };
  }, [social, profile?.id, toast]);

  const cats = String(profile?.subjects || '').split(',').map((x) => x.trim()).filter(Boolean);
  const showcaseNames = Array.isArray(profile?.badge_showcase) ? profile.badge_showcase.slice(0, 3) : [];
  const showcase = badges.filter((badge) => showcaseNames.includes(badge.name));
  const resolvedShowcase = showcase.length ? showcase : (showcaseNames.length ? [] : badges.slice(0, 3));
  const grade = GRADE_OPTIONS.find((x) => x.value === profile?.grade)?.label || profile?.grade || '';
  const canShowBadges = own || badgeVisibility.showBadges;
  const canShowCollection = own || badgeVisibility.showBadgeCollection;

  const doFollow = async () => {
    if (!user || !profile || own || busy) return;
    const removing = follow === 'approved' || follow === 'auto';
    const old = follow;
    const next: FollowStatus = removing ? 'none' : profile.is_public ? 'approved' : 'pending';
    setBusy(true); setFollow(next);
    if (removing) setFollowers((v) => Math.max(0, v - 1)); else if (next === 'approved') setFollowers((v) => v + 1);
    try { if (removing) await removeFollow(profile.id); else await requestFollow(profile.id); }
    catch (e: any) { setFollow(old); if (removing) setFollowers((v) => v + 1); else if (next === 'approved') setFollowers((v) => Math.max(0, v - 1)); toast(e?.message || 'Gagal memperbarui.', 'error'); }
    finally { setBusy(false); }
  };

  const block = async (id: string) => { try { await blockChatUser(id); setRows((v) => v.filter((x) => x.id !== id)); toast('Pengguna diblokir.', 'success'); } catch (e: any) { toast(e?.message || 'Gagal memblokir.', 'error'); } };
  const unfollow = async (id: string) => { try { await removeFollow(id); setRows((v) => v.filter((x) => x.id !== id)); setFollowing((v) => Math.max(0, v - 1)); toast('Berhenti mengikuti.', 'success'); } catch (e: any) { toast(e?.message || 'Gagal berhenti mengikuti.', 'error'); } };

  if (loading) return <div className="p-6 text-sm text-fg-muted">Memuat profil…</div>;
  if (!profile) return <div className="p-6"><Card className="p-8 text-center text-fg-muted">Profil tidak ditemukan.</Card></div>;

  return <div className="min-h-screen pb-10">
    <div className="h-32 md:h-44 overflow-hidden surface-bg">{profile.cover_url ? <img src={profile.cover_url} alt="" className="w-full h-full object-cover"/> : <div className="w-full h-full bg-gradient-to-r from-accent/20 via-surface-elevated to-accent/5"/>}</div>
    <div className="relative -mt-14 px-4 md:px-8">
      <div className="mx-auto max-w-5xl rounded-3xl border surface-border surface-card-bg p-5 md:p-6 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-end gap-5">
          <div className="shrink-0 mx-auto md:mx-0"><ProfilePortrait name={profile.full_name || profile.username} id={profile.id} src={profile.avatar_url || undefined}/></div>
          <div className="min-w-0 flex-1 text-center md:text-left">
            <div className="flex flex-wrap items-baseline justify-center md:justify-start gap-1.5"><h1 className="font-display text-2xl md:text-3xl font-bold text-fg">{profile.full_name || profile.username}</h1><VerifiedMark type={profile.verification_type}/></div>
            <p className="mt-0.5 text-sm text-fg-muted">@{profile.username}</p>
            {profile.bio && <p className="mt-3 text-sm text-fg max-w-2xl mx-auto md:mx-0">{profile.bio}</p>}
            <div className="mt-3 flex flex-wrap justify-center md:justify-start gap-3 text-[11px] text-fg-muted">{profile.institution && <span className="flex items-center gap-1"><School size={13}/>{profile.institution}</span>}{grade && <span className="flex items-center gap-1"><GraduationCap size={13}/>{grade}</span>}{profile.birth_date && <span className="flex items-center gap-1"><Calendar size={13}/>Lahir {new Date(profile.birth_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}</span>}</div>
            <div className="mt-4 flex flex-wrap justify-center md:justify-start gap-6 text-sm"><button type="button" disabled={!showFollowing} onClick={() => showFollowing && setSocial('following')} className="hover:text-accent disabled:opacity-50"><b>{following}</b> <span className="text-fg-muted">Mengikuti</span></button><button type="button" disabled={!showSocial} onClick={() => showSocial && setSocial('followers')} className="hover:text-accent disabled:opacity-50"><b>{followers}</b> <span className="text-fg-muted">Penggemar</span></button></div>
            <div className="mt-4 flex flex-wrap justify-center md:justify-start gap-2">{own ? <><Link to="/profile/edit"><Button size="sm" variant="outline">Edit Profil</Button></Link><Link to="/profile/interface-settings"><Button size="sm" variant="outline" icon={<Settings2 size={14}/>}>Tampilan & Privasi</Button></Link></> : user && <><Button size="sm" disabled={busy} variant={follow === 'approved' || follow === 'auto' ? 'outline' : 'primary'} onClick={() => void doFollow()}>{follow === 'pending' ? 'Diminta' : follow === 'approved' || follow === 'auto' ? 'Berhenti Mengikuti' : 'Ikuti'}</Button>{(follow === 'approved' || follow === 'auto') && <Link to={`/pesan?user_id=${profile.id}`}><Button size="sm" variant="outline" icon={<MessageCircle size={14}/>}>Kirim Pesan</Button></Link>}</>}</div>
          </div>
        </div>
        {canShowBadges && resolvedShowcase.length > 0 && <div className="mt-6 pt-5 border-t surface-border"><div className="flex flex-wrap justify-center md:justify-start gap-2">{resolvedShowcase.map((badge) => <div key={badge.id} className="inline-flex items-center gap-2 rounded-full border surface-border surface-elevated px-2.5 py-1.5"><div className="h-7 w-7 flex items-center justify-center">{badge.icon_url ? <img src={optimizedCloudinaryUrl(badge.icon_url, { width: 64 })} alt="" className="max-h-7 max-w-7 object-contain"/> : <span className="text-lg">{badge.icon_emoji || '🏅'}</span>}</div><span className="text-xs font-semibold text-fg">{badge.name}</span><span className="text-[10px] text-fg-muted">{badge.rarity}</span></div>)}</div></div>}
      </div>
    </div>

    <div className="px-4 md:px-8 mt-6"><div className="mx-auto max-w-5xl flex justify-center overflow-x-auto border-b surface-border">{(['prestasi','lomba','statistik','badge','kategori'] as Tab[]).map((t) => <button key={t} onClick={() => setTab(t)} className={`px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 ${tab === t ? 'text-accent border-accent' : 'text-fg-muted border-transparent hover:text-fg'}`}>{t === 'prestasi' ? 'Prestasi' : t === 'lomba' ? 'Lomba' : t === 'statistik' ? 'Statistik' : t === 'badge' ? 'Badge' : 'Kategori Favorit'}</button>)}</div>
      <Card className="mx-auto max-w-5xl mt-4 p-5 md:p-6">
        {tab === 'prestasi' && <div className="space-y-2">{awards.slice(0, 10).map((a) => <div key={a.id} className="flex items-center gap-3 rounded-xl p-2"><Award size={18} className="text-accent"/><div><p className="font-semibold text-fg">{a.title}</p><p className="text-xs text-fg-muted">{a.subtitle || a.rank_code || 'Penghargaan'}</p></div></div>)}{!awards.length && <p className="text-sm text-fg-muted">Belum ada prestasi.</p>}</div>}
        {tab === 'lomba' && <p className="text-sm text-fg-muted">Riwayat lomba tersedia di profil.</p>}
        {tab === 'statistik' && <div className="grid sm:grid-cols-3 gap-3"><div className="rounded-2xl surface-elevated p-4"><p className="text-xs text-fg-muted">XP</p><b className="text-lg text-fg">{Number(profile.total_xp || 0).toLocaleString('id-ID')}</b></div><div className="rounded-2xl surface-elevated p-4"><p className="text-xs text-fg-muted">EduCoin</p><b className="text-lg text-fg">{Number(profile.edu_coin || 0).toLocaleString('id-ID')}</b></div><div className="rounded-2xl surface-elevated p-4"><p className="text-xs text-fg-muted">Prestasi</p><b className="text-lg text-fg">{awards.length}</b></div></div>}
        {tab === 'badge' && (canShowCollection ? <ProfileBadgeCollection badges={badges} own={own}/> : <div className="py-10 text-center"><Filter className="mx-auto text-fg-muted" size={28}/><p className="mt-2 text-sm font-semibold text-fg">Koleksi badge disembunyikan</p><p className="mt-1 text-xs text-fg-muted">Pemilik profil memilih untuk tidak menampilkan koleksi badge.</p></div>)}
        {tab === 'kategori' && <div className="flex flex-wrap gap-2">{cats.map((c) => <span key={c} className="chip">{CATEGORY_LABELS[c] || c}</span>)}{!cats.length && <p className="text-sm text-fg-muted">Belum ada kategori favorit.</p>}</div>}
      </Card>
    </div>
    {social && <ConnectionModal mode={social} rows={rows} close={() => setSocial(null)} onBlock={block} onUnfollow={unfollow}/>}</div>;
}
