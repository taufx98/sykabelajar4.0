import { Check } from 'lucide-react';
import { BadgeIcon, type ProfileBadge } from './BadgeCard';

type Props = {
  badges: ProfileBadge[];
  selected: string[];
  onChange: (next: string[]) => void;
  max?: number;
};

function resolveSelectedBadges(badges: ProfileBadge[], selected: string[]) {
  const selectedSet = new Set(selected.map((value) => String(value).trim().toLowerCase()));
  return badges.filter((badge) => selectedSet.has(badge.name.trim().toLowerCase()) || selectedSet.has(badge.id.toLowerCase()));
}

export function BadgeShowcaseSelector({ badges, selected, onChange, max = 3 }: Props) {
  const selectedBadges = resolveSelectedBadges(badges, selected);
  const selectedIds = new Set(selectedBadges.map((badge) => badge.id));

  const toggle = (badge: ProfileBadge) => {
    if (selectedIds.has(badge.id)) {
      onChange(selectedBadges.filter((item) => item.id !== badge.id).map((item) => item.name));
      return;
    }
    if (selectedBadges.length >= max) return;
    onChange([...selectedBadges.map((item) => item.name), badge.name]);
  };

  if (!badges.length) {
    return <div className="rounded-2xl border surface-border surface-elevated p-5 text-sm text-fg-muted">Kamu belum memiliki badge yang bisa dipilih.</div>;
  }

  return <div>
    <div className="flex items-center justify-between gap-3 mb-3">
      <div>
        <p className="text-sm font-semibold text-fg">Badge Showcase</p>
        <p className="text-xs text-fg-muted mt-0.5">Pilih maksimal {max} badge untuk ditampilkan di profil.</p>
      </div>
      <span className="shrink-0 rounded-full bg-accent/10 px-2.5 py-1 text-[11px] font-semibold text-accent">{selectedBadges.length}/{max} dipilih</span>
    </div>

    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
      {badges.map((badge) => {
        const active = selectedIds.has(badge.id);
        const locked = !active && selectedBadges.length >= max;
        return <button
          key={badge.id}
          type="button"
          aria-pressed={active}
          disabled={false}
          onClick={() => toggle(badge)}
          className={`group relative min-h-[112px] rounded-2xl border p-3 text-left transition-all duration-150 ${
            active
              ? 'border-accent bg-accent/10 shadow-sm ring-1 ring-accent/20'
              : 'surface-border surface-elevated hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-sm'
          } ${locked ? 'opacity-60' : ''}`}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/80 dark:bg-slate-950/30">
              <BadgeIcon badge={badge} size={44} />
            </div>
            {active ? <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent text-white"><Check size={12}/></span> : <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-slate-300/70 dark:border-slate-700" aria-hidden="true"/>}
          </div>
          <p className="mt-2 text-xs font-semibold text-fg truncate">{badge.name}</p>
          <p className="mt-0.5 text-[10px] text-fg-muted">{badge.rarity}</p>
          {locked && <p className="mt-1 text-[9px] text-fg-muted">Hapus pilihan untuk memilih ini</p>}
        </button>;
      })}
    </div>
  </div>;
}
