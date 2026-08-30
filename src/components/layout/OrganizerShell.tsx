import { useEffect, useState } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { Building2, Trophy, Users, FileQuestion, ClipboardList, Gauge, Megaphone, ChevronDown } from 'lucide-react';
import { listCurrentUserOrganizers, resolveCurrentUserOrganizer, setSelectedOrganizerId, type CurrentOrganizer } from '@/services/organizerAuth.service';

const items = [
  ['/organizer', 'Ringkasan', Building2],
  ['/organizer/competitions', 'Lomba', Trophy],
  ['/organizer/registrations', 'Pendaftar', ClipboardList],
  ['/organizer/members', 'Member', Users],
  ['/organizer/question-bank', 'Bank Soal', FileQuestion],
  ['/organizer/grading', 'Penilaian', Gauge],
  ['/organizer/plan', 'Plan & Usage', Gauge],
  ['/organizer/ads', 'Iklan', Megaphone],
] as const;

export function OrganizerShell() {
  const location = useLocation();
  const [workspaces, setWorkspaces] = useState<CurrentOrganizer[]>([]);
  const [selected, setSelected] = useState<CurrentOrganizer | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const [all, current] = await Promise.all([listCurrentUserOrganizers(), resolveCurrentUserOrganizer()]);
        if (!alive) return;
        setWorkspaces(all);
        setSelected(current);
      } catch {
        if (alive) { setWorkspaces([]); setSelected(null); }
      }
    })();
    return () => { alive = false; };
  }, [location.pathname]);

  const switchWorkspace = async (id: string) => {
    const org = workspaces.find((x) => x.id === id);
    if (!org) return;
    setSelectedOrganizerId(id);
    setSelected(org);
    window.location.reload();
  };

  return (
    <div className="min-h-screen surface-bg">
      <header className="sticky top-0 z-30 surface-card-bg/95 backdrop-blur border-b surface-border">
        <div className="max-w-[1400px] mx-auto px-4 md:px-6">
          <div className="h-14 flex items-center gap-3">
            <Building2 size={18} className="text-accent shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-[10px] uppercase tracking-wider text-accent font-semibold">Organizer Control Center</p>
              <p className="text-sm font-semibold text-fg truncate">{selected?.name ?? 'Memuat organisasi…'}</p>
            </div>
            {workspaces.length > 1 && (
              <div className="relative">
                <select aria-label="Pilih organisasi" value={selected?.id ?? ''} onChange={(e) => void switchWorkspace(e.target.value)} className="input pr-8 text-xs min-w-[190px]">
                  {workspaces.map((org) => <option key={org.id} value={org.id}>{org.name} · {org._memberRole}</option>)}
                </select>
                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-slate-500" size={14} />
              </div>
            )}
          </div>
          <nav className="flex gap-1 overflow-x-auto no-scrollbar pb-2">
            {items.map(([to, label, Icon]) => {
              const active = location.pathname === to || (to === '/organizer' && location.pathname === '/organizer');
              return <Link key={to} to={to} className={`inline-flex shrink-0 items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition ${active ? 'bg-accent-muted-strong text-accent' : 'text-fg-muted hover:text-fg hover:bg-surface-elevated/50'}`}><Icon size={14} />{label}</Link>;
            })}
          </nav>
        </div>
      </header>
      <main className="max-w-[1400px] mx-auto w-full">
        <Outlet />
      </main>
    </div>
  );
}
