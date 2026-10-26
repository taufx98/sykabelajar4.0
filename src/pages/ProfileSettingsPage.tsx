import { useEffect, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Eye, SlidersHorizontal, UserRound, type LucideIcon } from 'lucide-react';
import { useApp } from '@/store/AppContext';
import { EditProfilePage } from '@/pages/EditProfilePage';
import { ProfileInterfaceSettingsPage } from '@/pages/ProfileInterfaceSettingsPage';

type SettingsTab = 'profile' | 'appearance';

export function ProfileSettingsPage() {
  const { user } = useApp();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab: SettingsTab = searchParams.get('tab') === 'appearance' ? 'appearance' : 'profile';
  const [visitedTabs, setVisitedTabs] = useState<SettingsTab[]>([activeTab]);

  useEffect(() => {
    setVisitedTabs((current) => current.includes(activeTab) ? current : [...current, activeTab]);
  }, [activeTab]);

  if (!user?.id) return <Navigate to="/home" replace />;

  const selectTab = (tab: SettingsTab) => {
    setVisitedTabs((current) => current.includes(tab) ? current : [...current, tab]);
    const next = new URLSearchParams(searchParams);
    if (tab === 'profile') next.delete('tab');
    else next.set('tab', tab);
    setSearchParams(next, { replace: true });
  };

  const tabs: Array<{ id: SettingsTab; label: string; description: string; icon: LucideIcon }> = [
    { id: 'profile', label: 'Informasi Profil', description: 'Identitas, pendidikan, foto, dan minat', icon: UserRound },
    { id: 'appearance', label: 'Tampilan & Privasi', description: 'Badge, akses sosial, keamanan, dan navigasi', icon: SlidersHorizontal },
  ];

  return (
    <div className="min-h-screen pb-10">
      <div className="mx-auto max-w-6xl space-y-5 px-3 py-4 sm:px-5 md:px-7 md:py-6">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-accent">Akun / Pengaturan</p>
            <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-fg sm:text-3xl">Pengaturan Profil</h1>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-fg-muted">Semua pengaturan profil dalam satu tempat. Pilih bagian yang ingin kamu kelola.</p>
          </div>
          <Link to={`/profile/@${user.username}`} className="inline-flex w-fit items-center gap-2 rounded-xl border surface-border surface-card-bg px-3 py-2 text-xs font-semibold text-fg-muted transition hover:border-accent/30 hover:text-accent"><ArrowLeft size={14}/> Kembali ke Profil</Link>
        </header>

        <nav aria-label="Bagian pengaturan profil" role="tablist" className="grid gap-2 rounded-2xl border surface-border surface-card-bg p-2 sm:grid-cols-2">
          {tabs.map(({ id, label, description, icon: Icon }) => {
            const selected = activeTab === id;
            return (
              <button
                key={id}
                id={`profile-settings-tab-${id}`}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={`profile-settings-panel-${id}`}
                onClick={() => selectTab(id)}
                className={`flex min-w-0 items-center gap-3 rounded-xl border p-3 text-left transition sm:p-4 ${selected ? 'border-accent/35 bg-accent/10 text-accent shadow-sm' : 'border-transparent text-fg-muted hover:border-surface-border hover:bg-surface-elevated/70 hover:text-fg'}`}
              >
                <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${selected ? 'bg-accent/15' : 'surface-elevated'}`}><Icon size={19}/></span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold">{label}</span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-fg-muted">{description}</span>
                </span>
                {selected && <Eye size={16} className="shrink-0" aria-hidden="true"/>}
              </button>
            );
          })}
        </nav>

        {visitedTabs.includes('profile') && <section id="profile-settings-panel-profile" role="tabpanel" aria-labelledby="profile-settings-tab-profile" hidden={activeTab !== 'profile'} className="min-w-0">
          <EditProfilePage embedded />
        </section>}

        {visitedTabs.includes('appearance') && <section id="profile-settings-panel-appearance" role="tabpanel" aria-labelledby="profile-settings-tab-appearance" hidden={activeTab !== 'appearance'} className="min-w-0 space-y-4">
          <div className="flex flex-wrap gap-2" aria-label="Pintasan bagian tampilan dan privasi">
            {[
              ['#appearance', 'Badge Showcase'],
              ['#badge-visibility', 'Visibilitas Badge'],
              ['#social', 'Sosial & Pesan'],
              ['#mobile-navigation', 'Navigasi Mobile'],
              ['#security', 'Keamanan'],
              ['#blocked', 'Pengguna Diblokir'],
            ].map(([href, label]) => (
              <a key={href} href={href} className="rounded-full border surface-border surface-card-bg px-3 py-1.5 text-xs font-semibold text-fg-muted transition hover:border-accent/30 hover:text-accent">{label}</a>
            ))}
          </div>
          <ProfileInterfaceSettingsPage embedded />
        </section>}
      </div>
    </div>
  );
}
