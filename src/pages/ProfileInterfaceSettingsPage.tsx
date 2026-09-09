import { useEffect, useState } from 'react';
import { ArrowLeft, Check, Lock, RotateCcw, Save } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Avatar } from '@/components/ui/Avatar';
import { BadgeShowcaseSelector } from '@/components/profile/BadgeShowcaseSelector';
import { useApp } from '@/store/AppContext';
import { supabase } from '@/lib/supabase';
import { unblockChatUser } from '@/services/chat.service';
import { getProfileBadges } from '@/services/badge.service';
import type { ProfileBadge } from '@/components/profile/BadgeCard';

const MOBILE_ITEMS = [
  ['home', 'Beranda'], ['leaderboard', 'Peringkat'], ['awards', 'Piagam'], ['chat', 'Pesan'], ['notifications', 'Notifikasi'], ['profile', 'Profil'],
] as const;

export function ProfileInterfaceSettingsPage() {
  const { user, toast } = useApp();
  const [showSocial, setShowSocial] = useState(true);
  const [showFollowing, setShowFollowing] = useState(true);
  const [showBadges, setShowBadges] = useState(true);
  const [showBadgeCollection, setShowBadgeCollection] = useState(true);
  const [mobileNav, setMobileNav] = useState<string[]>(['home', 'leaderboard', 'awards', 'chat']);
  const [badges, setBadges] = useState<ProfileBadge[]>([]);
  const [selectedBadges, setSelectedBadges] = useState<string[]>([]);
  const [blocked, setBlocked] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    let live = true;
    (async () => {
      setLoading(true);
      try {
        const [settings, profileBadges, blocks] = await Promise.all([
          supabase.from('profile_ui_settings').select('*').eq('user_id', user.id).maybeSingle(),
          getProfileBadges(user.id).catch(() => [] as ProfileBadge[]),
          supabase.from('chat_blocks').select('blocked_id,created_at').eq('blocker_id', user.id).order('created_at', { ascending: false }),
        ]);
        if (!live) return;
        if (settings.data) {
          setShowSocial(settings.data.show_social_popup !== false);
          setShowFollowing(settings.data.show_following_popup !== false);
          setShowBadges(settings.data.show_badges !== false);
          setShowBadgeCollection(settings.data.show_badge_collection !== false);
          setMobileNav(Array.isArray(settings.data.mobile_nav) ? settings.data.mobile_nav : ['home', 'leaderboard', 'awards', 'chat']);
          setSelectedBadges(Array.isArray((user as any).badgeShowcase) ? (user as any).badgeShowcase.slice(0, 3) : []);
        }
        setBadges(profileBadges);
        if (!settings.data) setSelectedBadges((Array.isArray((user as any).badgeShowcase) ? (user as any).badgeShowcase : []).slice(0, 3));
        const ids = (blocks.data ?? []).map((x) => x.blocked_id);
        const { data: profiles } = ids.length ? await supabase.from('profiles').select('id,username,full_name,avatar_url,verification_type').in('id', ids) : { data: [] };
        if (!live) return;
        setBlocked((blocks.data ?? []).map((x) => ({ ...x, profile: (profiles ?? []).find((q) => q.id === x.blocked_id) })));
      } catch (e: any) {
        if (live) toast(e?.message ?? 'Pengaturan gagal dimuat.', 'error');
      } finally { if (live) setLoading(false); }
    })();
    return () => { live = false; };
  }, [user?.id, toast]);

  const save = async () => {
    if (!user) return;
    setSaving(true);
    try {
      const { error } = await supabase.from('profile_ui_settings').upsert({
        user_id: user.id,
        show_social_popup: showSocial,
        show_following_popup: showFollowing,
        show_badges: showBadges,
        show_badge_collection: showBadgeCollection,
        mobile_nav: mobileNav,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });
      if (error) throw error;
      const currentShowcase = selectedBadges.slice(0, 3);
      const { error: profileError } = await supabase.from('profiles').update({ badge_showcase: currentShowcase, badge_showcase_manual: true }).eq('id', user.id);
      if (profileError) throw profileError;
      toast('Pengaturan tampilan disimpan.', 'success');
    } catch (e: any) { toast(e?.message ?? 'Gagal menyimpan pengaturan.', 'error'); }
    finally { setSaving(false); }
  };

  const reset = () => {
    setShowSocial(true); setShowFollowing(true); setShowBadges(true); setShowBadgeCollection(true); setMobileNav(['home', 'leaderboard', 'awards', 'chat']); setSelectedBadges([]);
  };
  const toggleNav = (key: string) => setMobileNav((v) => v.includes(key) ? v.filter((x) => x !== key) : [...v, key].slice(0, 5));
  const unBlock = async (id: string) => { try { await unblockChatUser(id); setBlocked((v) => v.filter((x) => x.blocked_id !== id)); toast('Blokir chat dibuka.', 'success'); } catch (e: any) { toast(e?.message ?? 'Gagal membuka blokir.', 'error'); } };

  return <div className="min-h-screen p-4 md:p-6"><div className="max-w-3xl mx-auto space-y-4">
    <Link to={`/profile/@${user?.username}`} className="inline-flex items-center gap-2 text-sm text-fg-muted hover:text-fg"><ArrowLeft size={16}/>Kembali ke profil</Link>
    <div><h1 className="font-display text-2xl font-bold text-fg">Tampilan & Privasi</h1><p className="text-sm text-fg-muted mt-1">Atur tampilan profil, badge yang ditonjolkan, privasi koleksi, dan navigasi mobile.</p></div>

    <Card className="p-5"><BadgeShowcaseSelector badges={badges} selected={selectedBadges} onChange={setSelectedBadges}/><div className="mt-4 rounded-xl bg-accent/5 border border-accent/15 p-3 text-xs text-fg-muted">Badge showcase tampil di bagian identitas profil dan hanya menggunakan badge yang sudah kamu peroleh.</div></Card>

    <Card className="p-5"><h2 className="font-semibold text-fg">Visibilitas badge</h2><div className="mt-4 space-y-4"><label className="flex items-center justify-between gap-4"><div><p className="text-sm font-medium text-fg">Tampilkan badge di profil</p><p className="text-xs text-fg-muted">Sembunyikan seluruh badge dari header profil publik tanpa menghapus koleksi.</p></div><input type="checkbox" checked={showBadges} onChange={(e) => setShowBadges(e.target.checked)} className="h-5 w-5 accent-emerald-500"/></label><label className="flex items-center justify-between gap-4"><div><p className="text-sm font-medium text-fg">Izinkan orang lain melihat koleksi badge</p><p className="text-xs text-fg-muted">Mengatur tab Badge di profil publik.</p></div><input type="checkbox" checked={showBadgeCollection} onChange={(e) => setShowBadgeCollection(e.target.checked)} className="h-5 w-5 accent-emerald-500"/></label></div></Card>

    <Card className="p-5"><h2 className="font-semibold text-fg">Profil sosial</h2><div className="mt-4 space-y-4"><label className="flex items-center justify-between gap-4"><div><p className="text-sm font-medium text-fg">Tampilkan popup sosial</p><p className="text-xs text-fg-muted">Izinkan orang membuka daftar Penggemar dan koneksi sosial dari profil Anda.</p></div><input type="checkbox" checked={showSocial} onChange={(e) => setShowSocial(e.target.checked)} className="h-5 w-5 accent-emerald-500"/></label><label className="flex items-center justify-between gap-4"><div><p className="text-sm font-medium text-fg">Tampilkan “Mengikuti”</p><p className="text-xs text-fg-muted">Matikan untuk menyembunyikan akses daftar akun yang Anda ikuti dari profil publik.</p></div><input type="checkbox" checked={showFollowing} onChange={(e) => setShowFollowing(e.target.checked)} className="h-5 w-5 accent-emerald-500"/></label></div></Card>

    <Card className="p-5"><h2 className="font-semibold text-fg">Navigasi bawah mobile</h2><p className="text-xs text-fg-muted mt-1">Maksimal 5 tombol. Urutan mengikuti pilihan Anda.</p><div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-2">{MOBILE_ITEMS.map(([key, label]) => { const active = mobileNav.includes(key); return <button key={key} type="button" onClick={() => toggleNav(key)} className={`flex items-center justify-between rounded-xl border px-3 py-2.5 text-sm ${active ? 'border-accent/40 bg-accent/10 text-accent' : 'surface-border surface-elevated text-fg-muted'}`}><span>{label}</span>{active && <Check size={15}/>}</button>; })}</div></Card>

    <Card className="p-5"><div className="flex items-center gap-2"><Lock size={17} className="text-red-400"/><h2 className="font-semibold text-fg">Pengguna diblokir</h2></div>{loading ? <p className="text-sm text-fg-muted mt-4">Memuat…</p> : blocked.length === 0 ? <p className="text-sm text-fg-muted mt-4">Belum ada pengguna yang diblokir.</p> : <div className="mt-3 divide-y surface-border">{blocked.map((x) => <div key={x.blocked_id} className="py-3 flex items-center gap-3"><Avatar name={x.profile?.full_name || x.profile?.username || 'User'} id={x.blocked_id} size={38} src={x.profile?.avatar_url || undefined}/><div className="flex-1"><p className="text-sm font-semibold text-fg">{x.profile?.full_name || x.profile?.username}</p><p className="text-xs text-fg-muted">@{x.profile?.username}</p></div><Button size="sm" variant="outline" onClick={() => void unBlock(x.blocked_id)}>Buka Blokir</Button></div>)}</div>}</Card>

    <div className="flex justify-end gap-2"><Button variant="ghost" onClick={reset} icon={<RotateCcw size={14}/>}>Reset</Button><Button onClick={() => void save()} disabled={saving} icon={<Save size={14}/>}>{saving ? 'Menyimpan…' : 'Simpan Pengaturan'}</Button></div>
  </div></div>;
}
