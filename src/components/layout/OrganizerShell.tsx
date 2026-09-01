import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { BarChart3, Building2, ClipboardList, FileQuestion, Gauge, Megaphone, Trophy, Users } from 'lucide-react';
import { listCurrentUserOrganizers, resolveCurrentUserOrganizer, setSelectedOrganizerId, type CurrentOrganizer } from '@/services/organizerAuth.service';

const items = [
  ['/organizer', 'Ringkasan', Building2],
  ['/organizer?tab=competitions', 'Lomba', Trophy],
  ['/organizer?tab=question-bank', 'Bank Soal', FileQuestion],
  ['/organizer/registrations', 'Pendaftar', ClipboardList],
  ['/organizer/members', 'Member', Users],
  ['/organizer/grading', 'Penilaian', Gauge],
  ['/organizer/plan', 'Plan & Usage', BarChart3],
  ['/organizer/ads', 'Iklan', Megaphone],
] as const;

type OrganizerShellProps = { children?: ReactNode };

export function OrganizerShell({ children }: OrganizerShellProps) {
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

  const switchWorkspace = (id: string) => {
    const org = workspaces.find((x) => x.id === id);
    if (!org) return;
    setSelectedOrganizerId(id);
    setSelected(org);
  };

  const isActive = (to: string) => {
    const [pathname, search] = to.split('?');
    if (location.pathname !== pathname) return false;
    if (!search) return !location.search || location.pathname !== '/organizer';
    return location.search === `?${search}`;
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
              <select aria-label="Pilih organisasi" value={selected?.id ?? ''} onChange={(e) => switchWorkspace(e.target.value)} className="input text-xs min-w-[190px] max-w-[280px]">
                {workspaces.map((org) => <option key={org.id} value={org.id}>{org.name} · {org._memberRole}</option>)}
              </select>
            )}
          </div>
          <nav className="flex gap-1 overflow-x-auto no-scrollbar pb-2">
            {items.map(([to, label, Icon]) => (
              <Link key={to} to={to} className={`inline-flex shrink-0 items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition ${isActive(to) ? 'bg-accent-muted-strong text-accent' : 'text-fg-muted hover:text-fg hover:bg-surface-elevated/50'}`}>
                <Icon size={14} />{label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="max-w-[1400px] mx-auto w-full">{children}</main>
    </div>
  );
}
