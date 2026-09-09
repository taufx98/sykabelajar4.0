import { Check } from 'lucide-react';
import { BadgeIcon, type ProfileBadge } from './BadgeCard';

export function BadgeShowcaseSelector({ badges, selected, onChange, max = 3 }: { badges: ProfileBadge[]; selected: string[]; onChange: (next: string[]) => void; max?: number }) {
  const toggle = (name: string) => {
    if (selected.includes(name)) onChange(selected.filter((value) => value !== name));
    else if (selected.length < max) onChange([...selected, name]);
  };

  if (!badges.length) return <div className="rounded-2xl border surface-border surface-elevated p-5 text-sm text-fg-muted">Kamu belum memiliki badge yang bisa dipilih.</div>;

  return <div>
    <div className="flex items-center justify-between gap-3 mb-3">
      <div><p className="text-sm font-semibold text-fg">Badge Showcase</p><p className="text-xs text-fg-muted mt-0.5">Pilih maksimal {max} badge untuk ditampilkan di profil.</p></div>
      <span className="shrink-0 rounded-full bg-accent/10 px-2.5 py-1 text-[11px] font-semibold text-accent">{selected.length}/{max} dipilih</span>
    </div>
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
      {badges.map((badge) => {
        const active = selected.includes(badge.name);
        const disabled = !active && selected.length >= max;
        return <button key={badge.id} type="button" onClick={() => !disabled && toggle(badge.name)} className={`relative rounded-2xl border p-3 text-left transition ${active ? 'border-accent bg-accent/10 shadow-sm' : 'surface-border surface-elevated hover:border-accent/40'} ${disabled ? 'opacity-45 cursor-not-allowed' : ''}`} aria-pressed={active}>
          {active && <span className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-accent text-white"><Check size={12} /></span>}
          <div className="flex justify-center"><BadgeIcon badge={badge} size={54} /></div>
          <p className="mt-2 text-xs font-semibold text-fg truncate text-center">{badge.name}</p>
          <p className="mt-0.5 text-[10px] text-fg-muted text-center">{badge.rarity}</p>
        </button>;
      })}
    </div>
  </div>;
}
