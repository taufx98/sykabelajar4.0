import { useEffect, useMemo, useState } from 'react';
import { Award, ChevronDown, Edit3, Filter, History, ImagePlus, Play, Plus, Search, ShieldCheck, Sparkles, Trophy, UserPlus, Users, X } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge as UiBadge } from '@/components/ui/Badge';
import { Avatar } from '@/components/ui/Avatar';
import { useApp } from '@/store/AppContext';
import { uploadImage } from '@/services/cloudinary.service';
import { awardBadge, archiveBadge, evaluateAutomaticBadges, getBadgeCounts, getBadgeOwners, listAdminBadges, saveBadge, type Badge, type BadgeAwardType, type BadgeCondition, type BadgeConditionField, type BadgeConditionOperator, type BadgeRarity, type BadgeStatus } from '@/services/badge.service';
import { supabase } from '@/lib/supabase';

const CATEGORIES = ['Prestasi', 'Kompetisi', 'Aktivitas', 'Pembelajaran', 'Komunitas', 'Membership', 'Khusus'];
const RARITIES: BadgeRarity[] = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Special'];
const STATUS: BadgeStatus[] = ['DRAFT', 'ACTIVE', 'ARCHIVED'];
const AWARD_TYPES: Array<{ value: BadgeAwardType; label: string; help: string }> = [
  { value: 'AUTOMATIC', label: 'Otomatis', help: 'Diberikan saat semua kondisi aturan terpenuhi.' },
  { value: 'MANUAL', label: 'Manual', help: 'Diberikan langsung oleh admin.' },
  { value: 'EVENT', label: 'Event-based', help: 'Diberikan untuk event atau program tertentu.' },
];

const FIELDS: Array<{ value: BadgeConditionField; label: string; numeric: boolean }> = [
  { value: 'competition_wins', label: 'Jumlah kemenangan kompetisi', numeric: true },
  { value: 'competitions_joined', label: 'Jumlah kompetisi diikuti', numeric: true },
  { value: 'awards_count', label: 'Jumlah penghargaan', numeric: true },
  { value: 'daily_checkin_streak', label: 'Streak Daily Check-in', numeric: true },
  { value: 'total_xp', label: 'Total XP', numeric: true },
  { value: 'edu_coin', label: 'Edu Coin', numeric: true },
  { value: 'followers', label: 'Jumlah followers', numeric: true },
  { value: 'following', label: 'Jumlah following', numeric: true },
  { value: 'grade', label: 'Jenjang / grade', numeric: false },
];

const OPERATORS: BadgeConditionOperator[] = ['>=', '>', '=', '<=', '<', '!='];

type StatCard = { label: string; value: number; Icon: typeof Award };

type ConditionPatch = {
  field?: BadgeConditionField;
  operator?: BadgeConditionOperator;
  value?: string | number;
};

function slugify(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'badge-baru';
}

function codeify(value: string) {
  return value.toUpperCase().trim().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'BADGE_BARU';
}

function emptyBadge(): Partial<Badge> {
  return { name: '', code: '', slug: '', description: '', icon_url: null, icon_emoji: '🏆', category: 'Khusus', rarity: 'Common', status: 'DRAFT', award_type: 'MANUAL', rule_config: { conditions: [] } };
}

function formatStatus(status: BadgeStatus) {
  return status === 'ACTIVE' ? 'Aktif' : status === 'DRAFT' ? 'Draft' : 'Diarsipkan';
}

function rarityClass(rarity: BadgeRarity) {
  return {
    Common: 'border-slate-500/20 bg-slate-500/10 text-slate-300',
    Uncommon: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300',
    Rare: 'border-sky-500/20 bg-sky-500/10 text-sky-300',
    Epic: 'border-violet-500/20 bg-violet-500/10 text-violet-300',
    Legendary: 'border-amber-500/20 bg-amber-500/10 text-amber-300',
    Special: 'border-rose-500/20 bg-rose-500/10 text-rose-300',
  }[rarity];
}

function BadgeVisual({ badge, size = 'md' }: { badge: Partial<Badge>; size?: 'sm' | 'md' | 'lg' }) {
  const box = size === 'lg' ? 'h-28 w-28 rounded-3xl text-5xl' : size === 'sm' ? 'h-12 w-12 rounded-xl text-2xl' : 'h-20 w-20 rounded-2xl text-4xl';
  return badge.icon_url ? <img src={badge.icon_url} alt="" className={`${box} object-contain`} /> : <div className={`${box} surface-elevated flex items-center justify-center border surface-border shadow-inner`}>{badge.icon_emoji || '🏆'}</div>;
}

export function AdminBadgesPage() {
  const { toast } = useApp();
  const [badges, setBadges] = useState<Badge[]>([]);
  const [counts, setCounts] = useState<Map<string, number>>(new Map());
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('ALL');
  const [status, setStatus] = useState<'ALL' | BadgeStatus>('ALL');
  const [editor, setEditor] = useState<Partial<Badge> | null>(null);
  const [detail, setDetail] = useState<Badge | null>(null);
  const [owners, setOwners] = useState<any[]>([]);
  const [awardOpen, setAwardOpen] = useState<Badge | null>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [awardUserId, setAwardUserId] = useState('');
  const [awardReason, setAwardReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [evaluating, setEvaluating] = useState(false);
  const [uploading, setUploading] = useState(false);

  const load = async () => {
    try {
      const rows = await listAdminBadges();
      setBadges(rows);
      setCounts(await getBadgeCounts(rows.map((row) => row.id)));
    } catch (error: any) {
      toast(error?.message ?? 'Gagal memuat badge.', 'error');
    }
  };

  useEffect(() => { void load(); }, []);

  const filtered = useMemo(() => badges.filter((badge) => {
    const haystack = `${badge.name} ${badge.code} ${badge.description}`.toLowerCase();
    return (!search || haystack.includes(search.toLowerCase())) && (category === 'ALL' || badge.category === category) && (status === 'ALL' || badge.status === status);
  }), [badges, category, search, status]);

  const stats = useMemo(() => ({
    total: badges.length,
    active: badges.filter((b) => b.status === 'ACTIVE').length,
    draft: badges.filter((b) => b.status === 'DRAFT').length,
    owners: [...counts.values()].reduce((sum, value) => sum + value, 0),
  }), [badges, counts]);

  const statCards: StatCard[] = [
    { label: 'Total Badge', value: stats.total, Icon: Award },
    { label: 'Aktif', value: stats.active, Icon: Sparkles },
    { label: 'Draft', value: stats.draft, Icon: Edit3 },
    { label: 'Badge Diperoleh', value: stats.owners, Icon: Users },
  ];

  const openNew = () => setEditor(emptyBadge());
  const openEdit = (badge: Badge) => setEditor({ ...badge, rule_config: { conditions: [...(badge.rule_config?.conditions ?? [])] } });

  const updateEditor = (patch: Partial<Badge>) => setEditor((current) => ({ ...(current ?? emptyBadge()), ...patch }));
  const updateCondition = (index: number, patch: ConditionPatch) => {
    const conditions = [...(editor?.rule_config?.conditions ?? [])];
    conditions[index] = { ...conditions[index], ...patch } as BadgeCondition;
    updateEditor({ rule_config: { conditions } });
  };

  const updateConditionValue = (index: number, rawValue: string) => {
    const field = editor?.rule_config?.conditions?.[index]?.field;
    const numeric = field ? FIELDS.find((item) => item.value === field)?.numeric ?? false : false;
    const trimmed = rawValue.trim();
    const parsed = Number(trimmed);
    const value = numeric && trimmed !== '' && Number.isFinite(parsed) ? parsed : rawValue;
    updateCondition(index, { value });
  };

  const save = async () => {
    if (!editor?.name?.trim() || !editor?.description?.trim()) {
      toast('Nama dan deskripsi badge wajib diisi.', 'error');
      return;
    }
    if (editor.award_type === 'AUTOMATIC' && !(editor.rule_config?.conditions?.length)) {
      toast('Badge otomatis membutuhkan minimal satu kondisi.', 'error');
      return;
    }
    setBusy(true);
    try {
      const name = editor.name.trim();
      await saveBadge({
        ...editor,
        name,
        code: editor.code?.trim() || codeify(name),
        slug: editor.slug?.trim() || slugify(name),
        description: editor.description.trim(),
        category: editor.category || 'Khusus',
        rarity: (editor.rarity || 'Common') as BadgeRarity,
        status: (editor.status || 'DRAFT') as BadgeStatus,
        award_type: (editor.award_type || 'MANUAL') as BadgeAwardType,
        rule_config: editor.rule_config || { conditions: [] },
      });
      toast(editor.id ? 'Badge diperbarui.' : 'Badge berhasil dibuat.', 'success');
      setEditor(null);
      await load();
    } catch (error: any) {
      toast(error?.message ?? 'Gagal menyimpan badge.', 'error');
    } finally { setBusy(false); }
  };

  const archive = async (badge: Badge) => {
    if (!window.confirm(`Arsipkan badge “${badge.name}”? Badge yang sudah diperoleh user tetap disimpan.`)) return;
    setBusy(true);
    try {
      await archiveBadge(badge.id);
      toast('Badge diarsipkan.', 'success');
      await load();
    } catch (error: any) { toast(error?.message ?? 'Gagal mengarsipkan badge.', 'error'); }
    finally { setBusy(false); }
  };

  const openDetail = async (badge: Badge) => {
    setDetail(badge);
    try { setOwners(await getBadgeOwners(badge.id)); } catch (error: any) { toast(error?.message ?? 'Gagal memuat pemilik badge.', 'error'); }
  };

  const openAward = async (badge: Badge) => {
    setAwardOpen(badge);
    setAwardUserId('');
    setAwardReason('');
    if (users.length) return;
    const { data, error } = await supabase.from('profiles').select('id,username,full_name,institution,avatar_url').order('created_at', { ascending: false }).limit(200);
    if (error) toast(error.message, 'error'); else setUsers(data ?? []);
  };

  const submitAward = async () => {
    if (!awardOpen || !awardUserId || !awardReason.trim()) {
      toast('Pilih peserta dan tuliskan alasan pemberian badge.', 'error');
      return;
    }
    setBusy(true);
    try {
      await awardBadge(awardUserId, awardOpen.id, awardReason);
      await supabase.from('badge_audit_logs').insert({ badge_id: awardOpen.id, target_user_id: awardUserId, action: 'AWARDED_MANUAL', reason: awardReason.trim(), metadata: {} });
      toast('Badge berhasil diberikan.', 'success');
      setAwardOpen(null);
      await load();
    } catch (error: any) { toast(error?.message ?? 'Gagal memberikan badge.', 'error'); }
    finally { setBusy(false); }
  };

  const runEvaluation = async () => {
    setEvaluating(true);
    try {
      const awarded = await evaluateAutomaticBadges();
      toast(awarded ? `${awarded} badge otomatis baru diberikan.` : 'Tidak ada badge otomatis baru yang perlu diberikan.', 'success');
      await load();
      if (detail) setOwners(await getBadgeOwners(detail.id));
    } catch (error: any) { toast(error?.message ?? 'Gagal mengevaluasi badge otomatis.', 'error'); }
    finally { setEvaluating(false); }
  };

  const uploadBadgeIcon = async (file: File) => {
    setUploading(true);
    try {
      if (!['image/png', 'image/svg+xml', 'image/webp'].includes(file.type)) throw new Error('Ikon badge harus PNG, SVG, atau WebP.');
      const result = await uploadImage(file, { folder: 'sykabelajar/badges' });
      updateEditor({ icon_url: result.secure_url });
      toast('Ikon badge berhasil diupload.', 'success');
    } catch (error: any) { toast(error?.message ?? 'Gagal mengupload ikon badge.', 'error'); }
    finally { setUploading(false); }
  };

  return <div className="min-h-screen surface-bg text-fg p-4 md:p-7">
    <div className="mx-auto max-w-7xl space-y-5">
      <section className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-accent">Admin · Platform & Konten</p>
          <h1 className="mt-1 font-display text-2xl font-bold tracking-tight md:text-3xl">Badge</h1>
          <p className="mt-1.5 max-w-2xl text-sm leading-6 text-fg-muted">Kelola koleksi badge, aturan pemberian, pemilik badge, dan penghargaan khusus peserta.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void runEvaluation()} loading={evaluating} icon={<Play size={14} />}>Evaluasi Otomatis</Button>
          <Button onClick={openNew} icon={<Plus size={15} />}>Buat Badge</Button>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {statCards.map(({ label, value, Icon }) => <Card key={label} className="p-4"><div className="flex items-center justify-between"><p className="text-xs text-fg-muted">{label}</p><Icon size={15} className="text-accent" /></div><p className="mt-2 text-2xl font-bold">{value}</p></Card>)}
      </div>

      <Card className="p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative flex-1"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted" /><input className="input pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cari nama, kode, atau deskripsi badge..." /></div>
          <label className="flex items-center gap-2 text-xs text-fg-muted"><Filter size={14} /><select className="input min-w-36" value={category} onChange={(event) => setCategory(event.target.value)}><option value="ALL">Semua kategori</option>{CATEGORIES.map((item) => <option key={item}>{item}</option>)}</select></label>
          <select className="input min-w-32" value={status} onChange={(event) => setStatus(event.target.value as 'ALL' | BadgeStatus)}><option value="ALL">Semua status</option>{STATUS.map((item) => <option key={item} value={item}>{formatStatus(item)}</option>)}</select>
        </div>
      </Card>

      {filtered.length ? <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{filtered.map((badge) => <Card key={badge.id} className="group overflow-hidden p-4 transition-transform duration-200 hover:-translate-y-0.5">
        <div className="flex gap-3"><BadgeVisual badge={badge} /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-1.5"><UiBadge color="moss">{badge.category}</UiBadge><span className={`rounded-full border px-2 py-0.5 text-[10px] ${rarityClass(badge.rarity)}`}>{badge.rarity}</span></div><h2 className="mt-2 truncate text-base font-bold">{badge.name}</h2><p className="mt-1 line-clamp-2 text-xs leading-5 text-fg-muted">{badge.description}</p></div></div>
        <div className="mt-4 flex items-center justify-between border-t surface-border pt-3 text-xs"><span className="text-fg-muted">{counts.get(badge.id) ?? 0} pemilik · {badge.award_type === 'AUTOMATIC' ? 'Otomatis' : badge.award_type === 'EVENT' ? 'Event' : 'Manual'}</span><span className={`rounded-full border px-2 py-0.5 ${badge.status === 'ACTIVE' ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300' : badge.status === 'DRAFT' ? 'border-amber-500/20 bg-amber-500/10 text-amber-300' : 'border-slate-500/20 bg-slate-500/10 text-slate-400'}`}>{formatStatus(badge.status)}</span></div>
        <div className="mt-3 grid grid-cols-3 gap-2"><Button size="sm" variant="outline" onClick={() => void openDetail(badge)}>Lihat</Button><Button size="sm" variant="outline" onClick={() => openEdit(badge)}>Edit</Button><Button size="sm" variant="outline" onClick={() => void openAward(badge)} icon={<UserPlus size={13} />}>Beri</Button></div>
        {badge.status !== 'ARCHIVED' && <button type="button" onClick={() => void archive(badge)} className="mt-2 w-full text-[11px] text-fg-muted hover:text-fg">Arsipkan badge</button>}
      </Card>)}</div> : <Card className="p-10 text-center"><Award size={24} className="mx-auto text-fg-muted" /><p className="mt-3 text-sm font-medium">Badge tidak ditemukan</p><p className="mt-1 text-xs text-fg-muted">Coba ubah kata kunci atau filter yang dipilih.</p></Card>}

      {editor && <div className="fixed inset-0 z-[120] overflow-y-auto bg-black/70 p-4 backdrop-blur-sm"><div className="mx-auto my-6 max-w-5xl"><Card className="overflow-hidden"><div className="flex items-center justify-between border-b surface-border px-5 py-4"><div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-accent">Badge Studio</p><h2 className="mt-1 text-lg font-bold">{editor.id ? 'Edit Badge' : 'Buat Badge Baru'}</h2></div><button className="rounded-lg p-2 text-fg-muted hover:bg-white/5 hover:text-fg" onClick={() => setEditor(null)}><X size={18} /></button></div>
        <div className="grid gap-0 lg:grid-cols-[1.35fr_.85fr]">
          <div className="space-y-5 p-5">
            <div className="grid gap-3 sm:grid-cols-2"><label className="text-xs text-fg-muted">Nama Badge<input className="input mt-1" value={editor.name ?? ''} onChange={(event) => updateEditor({ name: event.target.value, slug: editor.slug || slugify(event.target.value), code: editor.code || codeify(event.target.value) })} placeholder="Competition Master" /></label><label className="text-xs text-fg-muted">Kategori<select className="input mt-1" value={editor.category ?? 'Khusus'} onChange={(event) => updateEditor({ category: event.target.value })}>{CATEGORIES.map((item) => <option key={item}>{item}</option>)}</select></label></div>
            <label className="text-xs text-fg-muted">Deskripsi<textarea className="input mt-1 min-h-24" value={editor.description ?? ''} onChange={(event) => updateEditor({ description: event.target.value })} placeholder="Badge untuk peserta yang telah memenangkan minimal 5 kompetisi." /></label>
            <div className="grid gap-3 sm:grid-cols-2"><label className="text-xs text-fg-muted">Kode<input className="input mt-1" value={editor.code ?? ''} onChange={(event) => updateEditor({ code: codeify(event.target.value) })} /></label><label className="text-xs text-fg-muted">Slug<input className="input mt-1" value={editor.slug ?? ''} onChange={(event) => updateEditor({ slug: slugify(event.target.value) })} /></label></div>
            <div className="grid gap-3 sm:grid-cols-3"><label className="text-xs text-fg-muted">Rarity<select className="input mt-1" value={editor.rarity ?? 'Common'} onChange={(event) => updateEditor({ rarity: event.target.value as BadgeRarity })}>{RARITIES.map((item) => <option key={item}>{item}</option>)}</select></label><label className="text-xs text-fg-muted">Status<select className="input mt-1" value={editor.status ?? 'DRAFT'} onChange={(event) => updateEditor({ status: event.target.value as BadgeStatus })}>{STATUS.map((item) => <option key={item} value={item}>{formatStatus(item)}</option>)}</select></label><label className="text-xs text-fg-muted">Emoji fallback<input className="input mt-1" value={editor.icon_emoji ?? ''} onChange={(event) => updateEditor({ icon_emoji: event.target.value })} placeholder="🏆" /></label></div>
            <label className="text-xs text-fg-muted">Ikon Badge
              <div className="mt-1 rounded-xl border border-dashed surface-border p-3"><div className="flex flex-col gap-3 sm:flex-row sm:items-center"><div className="flex flex-1 items-center gap-3"><BadgeVisual badge={editor} size="sm" /><div><p className="text-xs font-medium text-fg">PNG, SVG, atau WebP</p><p className="text-[11px] text-fg-muted">Ikon akan dipakai sebagai visual utama badge.</p></div></div><label className="inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border surface-border px-3 py-2 text-xs font-semibold hover:bg-white/5">{uploading ? 'Mengupload…' : <><ImagePlus size={14} /> Upload ikon</>}<input type="file" className="hidden" accept="image/png,image/svg+xml,image/webp" disabled={uploading} onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadBadgeIcon(file); }} /></label></div></div>
            </label>
            <div><p className="text-xs font-semibold text-fg">Metode Perolehan</p><div className="mt-2 grid gap-2 md:grid-cols-3">{AWARD_TYPES.map((option) => <button key={option.value} type="button" onClick={() => updateEditor({ award_type: option.value })} className={`rounded-xl border p-3 text-left transition ${editor.award_type === option.value ? 'border-accent/30 bg-accent/10' : 'surface-border hover:bg-white/5'}`}><div className="flex items-center gap-2"><span className={`h-3 w-3 rounded-full border ${editor.award_type === option.value ? 'border-accent bg-accent' : 'border-fg-muted'}`} /><span className="text-xs font-semibold">{option.label}</span></div><p className="mt-1 text-[10px] leading-4 text-fg-muted">{option.help}</p></button>)}</div></div>
            {editor.award_type === 'AUTOMATIC' && <div className="rounded-2xl border surface-border p-4"><div className="flex items-start justify-between gap-3"><div><h3 className="text-sm font-semibold">Rule Builder</h3><p className="mt-1 text-[11px] text-fg-muted">Badge diberikan saat semua kondisi di bawah terpenuhi.</p></div><UiBadge color="moss">AND</UiBadge></div><div className="mt-3 space-y-2">{(editor.rule_config?.conditions ?? []).map((condition, index) => <div key={`${index}-${condition.field}`} className="grid gap-2 rounded-xl border surface-border p-3 md:grid-cols-[1fr_auto_120px_auto]"><select className="input" value={condition.field} onChange={(event) => updateCondition(index, { field: event.target.value as BadgeConditionField })}>{FIELDS.map((field) => <option key={field.value} value={field.value}>{field.label}</option>)}</select><select className="input md:w-20" value={condition.operator} onChange={(event) => updateCondition(index, { operator: event.target.value as BadgeConditionOperator })}>{(FIELDS.find((field) => field.value === condition.field)?.numeric ? OPERATORS : ['=','!=']).map((item) => <option key={item}>{item}</option>)}</select><input className="input" value={String(condition.value ?? '')} onChange={(event) => updateConditionValue(index, event.target.value)} placeholder={condition.field === 'grade' ? 'SMA' : '5'} /><button type="button" className="rounded-lg p-2 text-fg-muted hover:bg-red-500/10 hover:text-red-300" onClick={() => updateEditor({ rule_config: { conditions: (editor.rule_config?.conditions ?? []).filter((_, itemIndex) => itemIndex !== index) } })}><X size={15} /></button></div>)}</div><Button size="sm" variant="outline" className="mt-3" onClick={() => updateEditor({ rule_config: { conditions: [...(editor.rule_config?.conditions ?? []), { field: 'competition_wins', operator: '>=', value: 5 }] } })} icon={<Plus size={13} />}>Tambah Kondisi</Button></div>}
            <div className="flex justify-end gap-2 border-t surface-border pt-4"><Button variant="outline" onClick={() => setEditor(null)}>Batal</Button><Button loading={busy} onClick={() => void save()} icon={<ShieldCheck size={15} />}>Simpan Badge</Button></div>
          </div>
          <div className="surface-bg/40 border-t surface-border p-5 lg:border-l lg:border-t-0"><div className="sticky top-4"><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-accent">Live Preview</p><div className="mt-3 rounded-3xl border surface-border bg-black/10 p-6 text-center"><div className="flex justify-center"><BadgeVisual badge={editor} size="lg" /></div><h3 className="mt-5 text-xl font-bold uppercase tracking-tight">{editor.name || 'Nama Badge'}</h3><p className="mx-auto mt-2 max-w-xs text-xs leading-5 text-fg-muted">{editor.description || 'Deskripsi badge akan tampil di sini.'}</p><div className="mt-4 flex flex-wrap items-center justify-center gap-2"><UiBadge color="moss">{editor.category || 'Khusus'}</UiBadge><span className={`rounded-full border px-2.5 py-1 text-[10px] ${rarityClass((editor.rarity || 'Common') as BadgeRarity)}`}>{editor.rarity || 'Common'}</span></div><div className="mt-6 rounded-2xl border surface-border p-4 text-left"><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-fg-muted">Tampilan di Profil</p><div className="mt-3 flex items-center gap-3"><BadgeVisual badge={editor} size="sm" /><div className="min-w-0"><p className="truncate text-sm font-semibold">{editor.name || 'Nama Badge'}</p><p className="text-[10px] text-fg-muted">{editor.category || 'Khusus'} · {editor.rarity || 'Common'}</p></div></div></div></div></div></div>
        </div>
      </Card></div></div>}

      {detail && <div className="fixed inset-0 z-[110] overflow-y-auto bg-black/60 p-4 backdrop-blur-sm"><div className="mx-auto my-10 max-w-3xl"><Card className="overflow-hidden"><div className="flex items-center justify-between border-b surface-border px-5 py-4"><div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-accent">Badge Detail</p><h2 className="mt-1 text-lg font-bold">{detail.name}</h2></div><button className="rounded-lg p-2 text-fg-muted hover:bg-white/5 hover:text-fg" onClick={() => setDetail(null)}><X size={18} /></button></div><div className="grid gap-6 p-5 md:grid-cols-[auto_1fr]"><BadgeVisual badge={detail} size="lg" /><div><div className="flex flex-wrap gap-2"><UiBadge color="moss">{detail.category}</UiBadge><span className={`rounded-full border px-2.5 py-1 text-[10px] ${rarityClass(detail.rarity)}`}>{detail.rarity}</span><span className="rounded-full border surface-border px-2.5 py-1 text-[10px] text-fg-muted">{formatStatus(detail.status)}</span></div><p className="mt-4 text-sm leading-6 text-fg-muted">{detail.description}</p><div className="mt-5 flex items-center gap-2 text-xs text-fg-muted"><Users size={14} /> {owners.length} pemilik badge</div></div></div><div className="border-t surface-border p-5"><div className="flex items-center gap-2"><History size={15} className="text-accent" /><p className="text-xs font-semibold">Pemilik Badge</p></div><div className="mt-3 grid gap-2 md:grid-cols-2">{owners.length ? owners.map((owner: any) => <div key={owner.id} className="flex items-center gap-3 rounded-xl border surface-border p-3"><Avatar src={owner.avatar_url} name={owner.full_name || owner.username || 'Peserta'} size="sm" /><div className="min-w-0"><p className="truncate text-xs font-semibold">{owner.full_name || owner.username || 'Peserta'}</p><p className="truncate text-[10px] text-fg-muted">@{owner.username || 'user'}</p></div></div>) : <p className="text-xs text-fg-muted">Belum ada peserta yang memiliki badge ini.</p>}</div></div></Card></div></div>}

      {awardOpen && <div className="fixed inset-0 z-[130] overflow-y-auto bg-black/70 p-4 backdrop-blur-sm"><div className="mx-auto my-20 max-w-lg"><Card className="overflow-hidden"><div className="flex items-center justify-between border-b surface-border px-5 py-4"><div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-accent">Pemberian Manual</p><h2 className="mt-1 text-lg font-bold">{awardOpen.name}</h2></div><button className="rounded-lg p-2 text-fg-muted hover:bg-white/5 hover:text-fg" onClick={() => setAwardOpen(null)}><X size={18} /></button></div><div className="space-y-4 p-5"><label className="text-xs text-fg-muted">Peserta<select className="input mt-1" value={awardUserId} onChange={(event) => setAwardUserId(event.target.value)}><option value="">Pilih peserta</option>{users.map((user) => <option key={user.id} value={user.id}>{user.full_name || user.username || user.id}</option>)}</select></label><label className="text-xs text-fg-muted">Alasan<textarea className="input mt-1 min-h-28" value={awardReason} onChange={(event) => setAwardReason(event.target.value)} placeholder="Tuliskan alasan pemberian badge..." /></label><div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setAwardOpen(null)}>Batal</Button><Button loading={busy} onClick={() => void submitAward()} icon={<UserPlus size={15} />}>Berikan Badge</Button></div></div></Card></div></div>}
    </div>
  </div>;
}