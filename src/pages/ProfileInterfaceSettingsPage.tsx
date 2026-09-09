import { useEffect, useState } from 'react';
import { ArrowLeft, Bell, Check, Grid2X2, Lock, RotateCcw, Save, ShieldCheck, UserRound, UsersRound, XCircle } from 'lucide-react';
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
  ['home', 'Beranda'],
  ['leaderboard', 'Peringkat'],
  ['awards', 'Piagam'],
  ['chat', 'Pesan'],
  ['notifications', 'Notifikasi'],
  ['profile', 'Profil'],
] as const;

const SETTINGS_NAV = [
  { icon: UserRound, label: 'Akun' },
  { icon: ShieldCheck, label: 'Keamanan' },
  { icon: Bell, label: 'Notifikasi' },
  { icon: Grid2X2, label: 'Tampilan & Privasi', active: true },
  { icon: UsersRound, label: 'Sosial' },
  { icon: XCircle, label: 'Pengguna Diblokir' },
];

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    onClick={() => onChange(!checked)}
    className={`relative h-6 w-11 shrink-0 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-accent/30 ${checked ? 'bg-accent' : 'bg-slate-300 dark:bg-slate-700'}`}
  >
    <span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
  </button>;
}

function SettingRow({ title, description, checked, onChange }: { title: string; description: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <div className="flex items-center justify-between gap-4 py-3">
    <div className="min-w-0">
      <p className="text-sm font-semibold text-fg">{title}</p>
      <p className="mt-1 text-xs leading-relaxed text-fg-muted">{description}</p>
    </div>
    <Toggle checked={checked} onChange={onChange} label={title}/>
  </div>;
}

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
        const [settings, profile, profileBadges, blocks] = await Promise.all([
          supabase.from('profile_ui_settings').select('*').eq('user_id', user.id).maybeSingle(),
          supabase.from('profiles').select('badge_showcase').eq('id', user.id).maybeSingle(),
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
        }

        const storedShowcase = Array.isArray(profile.data?.badge_showcase) ? profile.data.badge_showcase : [];
        setSelectedBadges(storedShowcase.slice(0, 3).map((value: unknown) => String(value)));
        setBadges(profileBadges);

        const ids = (blocks.data ?? []).map((x) => x.blocked_id);
        const { data: profiles } = ids.length
          ? await supabase.from('profiles').select('id,username,full_name,avatar_url,verification_type').in('id', ids)
          : { data: [] };
        if (!live) return;
        setBlocked((blocks.data ?? []).map((x) => ({ ...x, profile: (profiles ?? []).find((q) => q.id === x.blocked_id) })));
      } catch (e: any) {
        if (live) toast(e?.message ?? 'Pengaturan gagal dimuat.', 'error');
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => { live = false; };
  }, [user?.id, toast]);

  const save = async () => {
    if (!user) return;
    setSaving(true);
    try {
      const currentShowcase = selectedBadges.slice(0, 3);
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

      const { error: profileError } = await supabase.from('profiles').update({
        badge_showcase: currentShowcase,
        badge_showcase_manual: true,
      }).eq('id', user.id);
      if (profileError) throw profileError;

      toast('Pengaturan tampilan disimpan.', 'success');
    } catch (e: any) {
      toast(e?.message ?? 'Gagal menyimpan pengaturan.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    setShowSocial(true);
    setShowFollowing(true);
    setShowBadges(true);
    setShowBadgeCollection(true);
    setMobileNav(['home', 'leaderboard', 'awards', 'chat']);
    setSelectedBadges([]);
  };

  const toggleNav = (key: string) => {
    setMobileNav((current) => current.includes(key) ? current.filter((value) => value !== key) : [...current, key].slice(0, 5));
  };

  const unBlock = async (id: string) => {
    try {
      await unblockChatUser(id);
      setBlocked((current) => current.filter((value) => value.blocked_id !== id));
      toast('Blokir chat dibuka.', 'success');
    } catch (e: any) {
      toast(e?.message ?? 'Gagal membuka blokir.', 'error');
    }
  };

  return <div className="min-h-screen bg-surface/30 p-4 md:p-6">
    <div className="mx-auto max-w-6xl">
      <div className="mb-4 flex items-center gap-2 text-sm text-fg-muted">
        <Link to={`/profile/@${user?.username}`} className="inline-flex items-center gap-2 hover:text-fg"><ArrowLeft size={16}/> Kembali ke profil</Link>
        <span>/</span>
        <span>Pengaturan</span>
      </div>

      <div className="grid gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="hidden lg:block rounded-2xl border surface-border surface-card-bg p-3 self-start">
          <div className="mb-3 px-3 py-2">
            <p className="font-display text-lg font-bold text-fg">Pengaturan Profil</p>
            <p className="mt-1 text-xs text-fg-muted">Kelola tampilan akun dan profil.</p>
          </div>
          <nav className="space-y-1" aria-label="Pengaturan profil">
            {SETTINGS_NAV.map(({ icon: Icon, label, active }) => <div key={label} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm ${active ? 'bg-accent/10 text-accent font-semibold' : 'text-fg-muted'}`}>
              <Icon size={16}/><span>{label}</span>
            </div>)}
          </nav>
        </aside>

        <main className="min-w-0 space-y-4">
          <div>
            <h1 className="font-display text-2xl font-bold text-fg">Tampilan & Privasi</h1>
            <p className="mt-1 text-sm text-fg-muted">Atur tampilan profil, badge yang ditonjolkan, privasi koleksi, dan navigasi mobile.</p>
          </div>

          <Card className="p-5 md:p-6">
            <BadgeShowcaseSelector badges={badges} selected={selectedBadges} onChange={setSelectedBadges}/>
            <div className="mt-4 rounded-xl border border-accent/15 bg-accent/5 p-3 text-xs text-fg-muted">
              Badge showcase tampil di bagian identitas profil dan hanya menggunakan badge yang sudah kamu peroleh. Pilih badge aktif untuk melepasnya, atau pilih badge lain saat kuota belum penuh.
            </div>
          </Card>

          <Card className="p-5 md:p-6">
            <div className="mb-2">
              <h2 className="font-semibold text-fg">Visibilitas badge</h2>
              <p className="mt-1 text-xs text-fg-muted">Atur bagian badge yang terlihat oleh pengguna lain.</p>
            </div>
            <div className="divide-y surface-border">
              <SettingRow title="Tampilkan badge di profil" description="Sembunyikan badge showcase dari identitas profil tanpa menghapus koleksi badge." checked={showBadges} onChange={setShowBadges}/>
              <SettingRow title="Izinkan orang lain melihat koleksi badge" description="Mengatur apakah tab Badge pada profil publik dapat dibuka pengguna lain." checked={showBadgeCollection} onChange={setShowBadgeCollection}/>
            </div>
          </Card>

          <Card className="p-5 md:p-6">
            <div className="mb-2">
              <h2 className="font-semibold text-fg">Profil sosial</h2>
              <p className="mt-1 text-xs text-fg-muted">Kontrol akses ke informasi koneksi sosial di profil.</p>
            </div>
            <div className="divide-y surface-border">
              <SettingRow title="Tampilkan popup sosial" description="Izinkan orang membuka daftar Penggemar dan koneksi sosial dari profil Anda." checked={showSocial} onChange={setShowSocial}/>
              <SettingRow title="Tampilkan “Mengikuti”" description="Matikan untuk menyembunyikan akses daftar akun yang Anda ikuti dari profil publik." checked={showFollowing} onChange={setShowFollowing}/>
            </div>
          </Card>

          <Card className="p-5 md:p-6">
            <h2 className="font-semibold text-fg">Navigasi bawah mobile</h2>
            <p className="mt-1 text-xs text-fg-muted">Maksimal 5 tombol. Urutan mengikuti pilihan Anda.</p>
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {MOBILE_ITEMS.map(([key, label]) => {
                const active = mobileNav.includes(key);
                return <button key={key} type="button" aria-pressed={active} onClick={() => toggleNav(key)} className={`flex items-center justify-between rounded-xl border px-3 py-2.5 text-sm transition ${active ? 'border-accent/40 bg-accent/10 text-accent' : 'surface-border surface-elevated text-fg-muted hover:border-accent/30 hover:text-fg'}`}>
                  <span>{label}</span>{active && <Check size={15}/>} 
                </button>;
              })}
            </div>
          </Card>

          <Card className="p-5 md:p-6">
            <div className="flex items-center gap-2"><Lock size={17} className="text-red-400"/><h2 className="font-semibold text-fg">Pengguna diblokir</h2></div>
            {loading ? <p className="mt-4 text-sm text-fg-muted">Memuat…</p> : blocked.length === 0 ? <p className="mt-4 text-sm text-fg-muted">Belum ada pengguna yang diblokir.</p> : <div className="mt-3 divide-y surface-border">{blocked.map((item) => <div key={item.blocked_id} className="flex items-center gap-3 py-3"><Avatar name={item.profile?.full_name || item.profile?.username || 'User'} id={item.blocked_id} size={38} src={item.profile?.avatar_url || undefined}/><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-fg">{item.profile?.full_name || item.profile?.username}</p><p className="text-xs text-fg-muted">@{item.profile?.username}</p></div><Button size="sm" variant="outline" onClick={() => void unBlock(item.blocked_id)}>Buka Blokir</Button></div>)}</div>}
          </Card>

          <div className="flex justify-end gap-2 pb-4">
            <Button variant="ghost" onClick={reset} icon={<RotateCcw size={14}/>}>Reset</Button>
            <Button onClick={() => void save()} disabled={saving} icon={<Save size={14}/>}>{saving ? 'Menyimpan…' : 'Simpan Pengaturan'}</Button>
          </div>
        </main>
      </div>
    </div>
  </div>;
}
