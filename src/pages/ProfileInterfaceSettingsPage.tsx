import { useEffect, useState, type ReactNode } from 'react';
import { ArrowLeft, Bell, Check, Eye, Grid2X2, KeyRound, Lock, RotateCcw, Save, ShieldCheck, UserRound, UsersRound, XCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Avatar } from '@/components/ui/Avatar';
import { BadgeShowcaseSelector } from '@/components/profile/BadgeShowcaseSelector';
import { useApp } from '@/store/AppContext';
import { supabase } from '@/lib/supabase';
import { unblockChatUser } from '@/services/chat.service';
import { getProfileBadges } from '@/services/badge.service';
import { updateProfile as updateProfileRecord } from '@/services/profile.service';
import type { ProfileBadge } from '@/components/profile/BadgeCard';

const DEFAULT_MOBILE_NAV = ['home', 'leaderboard', 'awards', 'chat'];
const MOBILE_ITEMS = [
  ['home', 'Beranda'],
  ['leaderboard', 'Peringkat'],
  ['awards', 'Piagam'],
  ['chat', 'Pesan'],
  ['notifications', 'Notifikasi'],
  ['profile', 'Profil'],
] as const;

const SETTINGS_NAV = [
  { key: 'account', icon: UserRound, label: 'Akun', kind: 'link', to: '/profile/edit' },
  { key: 'security', icon: ShieldCheck, label: 'Keamanan', kind: 'anchor', to: '#security' },
  { key: 'notifications', icon: Bell, label: 'Notifikasi', kind: 'link', to: '/notifications' },
  { key: 'appearance', icon: Grid2X2, label: 'Tampilan & Privasi', kind: 'anchor', to: '#appearance' },
  { key: 'social', icon: UsersRound, label: 'Sosial', kind: 'anchor', to: '#social' },
  { key: 'blocked', icon: XCircle, label: 'Pengguna Diblokir', kind: 'anchor', to: '#blocked' },
] as const;

type SavedState = {
  showSocial: boolean;
  showFollowing: boolean;
  showBadges: boolean;
  showBadgeCollection: boolean;
  mobileNav: string[];
  selectedBadges: string[];
};

function Toggle({ checked, onChange, label, disabled = false }: { checked: boolean; onChange: (value: boolean) => void; label: string; disabled?: boolean }) {
  return <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    disabled={disabled}
    onClick={() => onChange(!checked)}
    className={`relative h-6 w-11 shrink-0 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-accent/30 ${checked ? 'bg-accent' : 'bg-slate-300 dark:bg-slate-700'} ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
  >
    <span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
  </button>;
}

function SettingRow({ title, description, checked, onChange, disabled = false }: { title: string; description: string; checked: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return <div className="flex items-center justify-between gap-4 py-3">
    <div className="min-w-0">
      <p className="text-sm font-semibold text-fg">{title}</p>
      <p className="mt-1 text-xs leading-relaxed text-fg-muted">{description}</p>
    </div>
    <Toggle checked={checked} onChange={onChange} label={title} disabled={disabled}/>
  </div>;
}

function SectionCard({ id, title, description, children }: { id?: string; title: string; description?: string; children: ReactNode }) {
  const card = <Card className="scroll-mt-24 p-5 md:p-6">
    <div className="mb-2">
      <h2 className="font-semibold text-fg">{title}</h2>
      {description && <p className="mt-1 text-xs text-fg-muted">{description}</p>}
    </div>
    {children}
  </Card>;
  return id ? <div id={id}>{card}</div> : card;
}

export function ProfileInterfaceSettingsPage() {
  const { user, toast, refreshUser } = useApp();
  const [showSocial, setShowSocial] = useState(true);
  const [showFollowing, setShowFollowing] = useState(true);
  const [showBadges, setShowBadges] = useState(true);
  const [showBadgeCollection, setShowBadgeCollection] = useState(true);
  const [mobileNav, setMobileNav] = useState<string[]>(DEFAULT_MOBILE_NAV);
  const [badges, setBadges] = useState<ProfileBadge[]>([]);
  const [selectedBadges, setSelectedBadges] = useState<string[]>([]);
  const [blocked, setBlocked] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [savedState, setSavedState] = useState<SavedState>({
    showSocial: true,
    showFollowing: true,
    showBadges: true,
    showBadgeCollection: true,
    mobileNav: [...DEFAULT_MOBILE_NAV],
    selectedBadges: [],
  });

  useEffect(() => {
    if (!user) return;
    let live = true;
    (async () => {
      setLoading(true);
      try {
        const [settings, profile, profileBadges, blocks] = await Promise.all([
          supabase.from('profile_ui_settings').select('show_social_popup,show_following_popup,show_badges,show_badge_collection,mobile_nav').eq('user_id', user.id).maybeSingle(),
          supabase.from('profiles').select('badge_showcase').eq('id', user.id).maybeSingle(),
          getProfileBadges(user.id).catch(() => [] as ProfileBadge[]),
          supabase.from('chat_blocks').select('blocked_id,created_at').eq('blocker_id', user.id).order('created_at', { ascending: false }),
        ]);
        if (!live) return;

        const nextShowSocial = settings.data?.show_social_popup !== false;
        const nextShowFollowing = settings.data?.show_following_popup !== false;
        const nextShowBadges = settings.data?.show_badges !== false;
        const nextShowBadgeCollection = settings.data?.show_badge_collection !== false;
        const nextMobileNav = Array.isArray(settings.data?.mobile_nav)
          ? settings.data.mobile_nav.map(String).filter((key: string) => MOBILE_ITEMS.some(([id]) => id === key)).slice(0, 5)
          : [...DEFAULT_MOBILE_NAV];
        const nextSelectedBadges = Array.isArray(profile.data?.badge_showcase)
          ? profile.data.badge_showcase.slice(0, 3).map((value: unknown) => String(value))
          : [];

        setShowSocial(nextShowSocial);
        setShowFollowing(nextShowFollowing);
        setShowBadges(nextShowBadges);
        setShowBadgeCollection(nextShowBadgeCollection);
        setMobileNav(nextMobileNav.length ? nextMobileNav : [...DEFAULT_MOBILE_NAV]);
        setSelectedBadges(nextSelectedBadges);
        setSavedState({
          showSocial: nextShowSocial,
          showFollowing: nextShowFollowing,
          showBadges: nextShowBadges,
          showBadgeCollection: nextShowBadgeCollection,
          mobileNav: nextMobileNav.length ? [...nextMobileNav] : [...DEFAULT_MOBILE_NAV],
          selectedBadges: [...nextSelectedBadges],
        });
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

  const scrollTo = (target: string) => {
    const element = document.querySelector(target);
    element?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const save = async () => {
    if (!user || saving) return;
    setSaving(true);
    try {
      const currentShowcase = selectedBadges.slice(0, 3);
      const nextMobileNav = mobileNav.filter((key) => MOBILE_ITEMS.some(([id]) => id === key)).slice(0, 5);
      const { error } = await supabase.from('profile_ui_settings').upsert({
        user_id: user.id,
        show_social_popup: showSocial,
        show_following_popup: showFollowing,
        show_badges: showBadges,
        show_badge_collection: showBadgeCollection,
        mobile_nav: nextMobileNav,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });
      if (error) throw error;

      await updateProfileRecord(user.id, {
        badge_showcase: currentShowcase,
        badge_showcase_manual: true,
      });

      setSelectedBadges(currentShowcase);
      setMobileNav(nextMobileNav);
      setSavedState({
        showSocial,
        showFollowing,
        showBadges,
        showBadgeCollection,
        mobileNav: [...nextMobileNav],
        selectedBadges: [...currentShowcase],
      });
      void refreshUser();
      toast('Pengaturan tampilan disimpan.', 'success');
    } catch (e: any) {
      toast(e?.message ?? 'Gagal menyimpan pengaturan.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    setShowSocial(savedState.showSocial);
    setShowFollowing(savedState.showFollowing);
    setShowBadges(savedState.showBadges);
    setShowBadgeCollection(savedState.showBadgeCollection);
    setMobileNav([...savedState.mobileNav]);
    setSelectedBadges([...savedState.selectedBadges]);
  };

  const toggleNav = (key: string) => {
    setMobileNav((current) => {
      if (current.includes(key)) return current.filter((value) => value !== key);
      if (current.length >= 5) return current;
      return [...current, key];
    });
  };

  const changePassword = async () => {
    if (!password || !passwordConfirmation) {
      toast('Password baru dan konfirmasi wajib diisi.', 'error');
      return;
    }
    if (password.length < 8) {
      toast('Password minimal 8 karakter.', 'error');
      return;
    }
    if (password !== passwordConfirmation) {
      toast('Konfirmasi password tidak cocok.', 'error');
      return;
    }
    setPasswordBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setPassword('');
      setPasswordConfirmation('');
      toast('Password berhasil diubah.', 'success');
    } catch (e: any) {
      toast(e?.message ?? 'Password gagal diubah.', 'error');
    } finally {
      setPasswordBusy(false);
    }
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

  if (!user) return null;

  return <div className="min-h-screen bg-surface/30 p-4 md:p-6">
    <div className="mx-auto max-w-6xl">
      <div className="mb-4 flex items-center gap-2 text-sm text-fg-muted">
        <Link to={`/profile/@${user.username}`} className="inline-flex items-center gap-2 hover:text-fg"><ArrowLeft size={16}/> Kembali ke profil</Link>
        <span>/</span>
        <span>Pengaturan</span>
      </div>

      <div className="grid gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="hidden lg:block rounded-2xl border surface-border surface-card-bg p-3 self-start sticky top-20">
          <div className="mb-3 px-3 py-2">
            <p className="font-display text-lg font-bold text-fg">Pengaturan Profil</p>
            <p className="mt-1 text-xs text-fg-muted">Kelola akun, keamanan, tampilan, dan privasi.</p>
          </div>
          <nav className="space-y-1" aria-label="Pengaturan profil">
            {SETTINGS_NAV.map(({ key, icon: Icon, label, kind, to }) => {
              const active = key === 'appearance';
              const className = `flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition ${active ? 'bg-accent/10 text-accent font-semibold' : 'text-fg-muted hover:bg-fg/[0.04] hover:text-fg'}`;
              return kind === 'link'
                ? <Link key={key} to={to} className={className}><Icon size={16}/><span>{label}</span></Link>
                : <button key={key} type="button" onClick={() => scrollTo(to)} className={className}><Icon size={16}/><span>{label}</span></button>;
            })}
          </nav>
        </aside>

        <main className="min-w-0 space-y-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-accent">Profil</p>
            <h1 className="font-display text-2xl font-bold text-fg">Tampilan & Privasi</h1>
            <p className="mt-1 text-sm text-fg-muted">Atur badge, privasi profil, navigasi mobile, dan kontrol akun.</p>
          </div>

          <SectionCard id="appearance" title="Badge Showcase" description="Pilih maksimal 3 badge untuk ditampilkan pada identitas profil.">
            <BadgeShowcaseSelector badges={badges} selected={selectedBadges} onChange={setSelectedBadges}/>
            <div className="mt-4 flex items-start gap-2 rounded-xl border border-accent/15 bg-accent/5 p-3 text-xs text-fg-muted"><Eye size={15} className="mt-0.5 shrink-0 text-accent"/>Badge showcase hanya bisa memakai badge yang benar-benar sudah kamu miliki. Perubahan diterapkan setelah menekan Simpan Pengaturan.</div>
          </SectionCard>

          <SectionCard title="Visibilitas badge" description="Kontrol bagaimana badge muncul di profil publik.">
            <div className="divide-y surface-border">
              <SettingRow title="Tampilkan badge di profil" description="Sembunyikan badge showcase dari identitas profil tanpa menghapus koleksi badge." checked={showBadges} onChange={setShowBadges} disabled={saving}/>
              <SettingRow title="Izinkan orang lain melihat koleksi badge" description="Mengatur apakah tab Badge pada profil publik dapat dibuka pengguna lain." checked={showBadgeCollection} onChange={setShowBadgeCollection} disabled={saving}/>
            </div>
          </SectionCard>

          <SectionCard id="social" title="Profil sosial" description="Kontrol akses ke informasi koneksi sosial.">
            <div className="divide-y surface-border">
              <SettingRow title="Tampilkan popup sosial" description="Izinkan orang membuka daftar Penggemar dan koneksi sosial dari profil Anda." checked={showSocial} onChange={setShowSocial} disabled={saving}/>
              <SettingRow title="Tampilkan “Mengikuti”" description="Matikan untuk menyembunyikan akses daftar akun yang Anda ikuti dari profil publik." checked={showFollowing} onChange={setShowFollowing} disabled={saving}/>
            </div>
          </SectionCard>

          <SectionCard title="Navigasi bawah mobile" description="Pilih maksimal 5 tombol yang muncul pada mobile. Urutan mengikuti urutan pilihan.">
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {MOBILE_ITEMS.map(([key, label]) => {
                const active = mobileNav.includes(key);
                const limitReached = mobileNav.length >= 5 && !active;
                return <button key={key} type="button" aria-pressed={active} onClick={() => toggleNav(key)} className={`flex min-h-11 items-center justify-between rounded-xl border px-3 py-2.5 text-left text-sm transition ${active ? 'border-accent/40 bg-accent/10 text-accent' : 'surface-border surface-elevated text-fg-muted hover:border-accent/30 hover:text-fg'} ${limitReached ? 'opacity-50' : ''}`}>
                  <span>{label}</span>{active && <Check size={15}/>} 
                </button>;
              })}
            </div>
          </SectionCard>

          <SectionCard id="security" title="Keamanan" description="Kelola password akun yang sedang login.">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block"><span className="mb-1.5 block text-xs font-semibold text-fg">Password baru</span><div className="relative"><KeyRound size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted"/><input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={passwordBusy} className="input w-full pl-9" placeholder="Minimal 8 karakter"/></div></label>
              <label className="block"><span className="mb-1.5 block text-xs font-semibold text-fg">Konfirmasi password</span><div className="relative"><Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted"/><input type="password" autoComplete="new-password" value={passwordConfirmation} onChange={(e) => setPasswordConfirmation(e.target.value)} disabled={passwordBusy} className="input w-full pl-9" placeholder="Ulangi password baru"/></div></label>
            </div>
            <div className="mt-3 flex justify-end"><Button size="sm" onClick={() => void changePassword()} disabled={passwordBusy} icon={<ShieldCheck size={14}/>}>{passwordBusy ? 'Mengubah…' : 'Ubah Password'}</Button></div>
          </SectionCard>

          <SectionCard id="blocked" title="Pengguna diblokir" description="Kelola akun yang tidak boleh mengirim chat atau berinteraksi sesuai aturan blokir.">
            {loading ? <p className="mt-4 text-sm text-fg-muted">Memuat…</p> : blocked.length === 0 ? <p className="mt-4 text-sm text-fg-muted">Belum ada pengguna yang diblokir.</p> : <div className="mt-3 divide-y surface-border">{blocked.map((item) => <div key={item.blocked_id} className="flex items-center gap-3 py-3"><Avatar name={item.profile?.full_name || item.profile?.username || 'User'} id={item.blocked_id} size={38} src={item.profile?.avatar_url || undefined}/><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-fg">{item.profile?.full_name || item.profile?.username}</p><p className="text-xs text-fg-muted">@{item.profile?.username}</p></div><Button size="sm" variant="outline" onClick={() => void unBlock(item.blocked_id)}>Buka Blokir</Button></div>)}</div>}
          </SectionCard>

          <div className="flex flex-col-reverse gap-2 pb-4 sm:flex-row sm:items-center sm:justify-end">
            <Button variant="ghost" onClick={reset} disabled={saving} icon={<RotateCcw size={14}/>}>Batalkan Perubahan</Button>
            <Button onClick={() => void save()} disabled={saving} icon={<Save size={14}/>}>{saving ? 'Menyimpan…' : 'Simpan Pengaturan'}</Button>
          </div>
        </main>
      </div>
    </div>
  </div>;
}
