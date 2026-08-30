import { useEffect, useState } from 'react';
import { Building2, CheckCircle2, ChevronDown } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { OrganizerPage } from '@/pages/OrganizerPage';
import { listCurrentUserOrganizers, getSelectedOrganizerId, setSelectedOrganizerId, type CurrentOrganizer } from '@/services/organizerAuth.service';

export function OrganizerWorkspaceGate() {
  const [items, setItems] = useState<CurrentOrganizer[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(getSelectedOrganizerId());
  const [loading, setLoading] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);

  const load = async () => {
    try {
      const rows = await listCurrentUserOrganizers();
      setItems(rows);
      const selected = selectedId && rows.some((item) => item.id === selectedId) ? selectedId : rows[0]?.id ?? null;
      setSelectedId(selected);
      setSelectedOrganizerId(selected);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center surface-bg"><p className="text-sm text-slate-500">Memuat workspace penyelenggara…</p></div>;
  }

  if (items.length <= 1) return <OrganizerPage />;

  const selected = items.find((item) => item.id === selectedId) ?? items[0];

  const choose = (id: string) => {
    setSelectedId(id);
    setSelectedOrganizerId(id);
    setPickerOpen(false);
    window.location.reload();
  };

  return (
    <div className="min-h-screen surface-bg">
      <div className="sticky top-0 z-40 border-b surface-border surface-bg/95 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 md:px-7 py-3 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-moss-500/10 flex items-center justify-center shrink-0"><Building2 size={18} className="text-accent" /></div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-wide text-accent font-semibold">Organizer Workspace</p>
            <p className="text-sm font-semibold text-fg truncate">{selected.name}</p>
          </div>
          <Badge color="moss">{items.length} workspace</Badge>
          <div className="relative">
            <Button size="sm" variant="outline" onClick={() => setPickerOpen((open) => !open)} icon={<ChevronDown size={14} />}>Ganti</Button>
            {pickerOpen && (
              <Card className="absolute right-0 mt-2 w-72 p-2 z-50 shadow-2xl">
                {items.map((item) => (
                  <button key={item.id} onClick={() => choose(item.id)} className="w-full text-left flex items-center gap-3 p-3 rounded-lg hover:bg-surface-elevated/50 transition">
                    <div className="w-8 h-8 rounded-lg bg-moss-500/10 flex items-center justify-center"><Building2 size={15} className="text-accent" /></div>
                    <div className="flex-1 min-w-0"><p className="text-sm font-medium text-fg truncate">{item.name}</p><p className="text-[11px] text-slate-500">{item._memberRole || 'member'}</p></div>
                    {item.id === selected.id && <CheckCircle2 size={16} className="text-accent" />}
                  </button>
                ))}
              </Card>
            )}
          </div>
        </div>
      </div>
      <OrganizerPage />
    </div>
  );
}
