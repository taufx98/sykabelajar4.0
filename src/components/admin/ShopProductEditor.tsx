import { useState, type FormEvent } from 'react';
import { Check, Eye, ImagePlus, Info, Package, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import type { AdminProductInput } from '@/services/adminCore.service';

export type ShopProductDraft = AdminProductInput & {
  code: string;
  slug: string;
  name: string;
  short_description: string;
  description: string;
  product_type: string;
  audiences: string[];
  price: number;
  currency: string;
  image_url: string;
  is_active: boolean;
  is_featured: boolean;
  sort_order: number;
  metadata: Record<string, unknown>;
};

type Props = {
  product: Partial<ShopProductDraft> & { id?: string | null };
  busy: boolean;
  onClose: () => void;
  onSave: (product: ShopProductDraft) => Promise<void>;
};

const PRODUCT_TYPES = [
  {
    value: 'DIGITAL_ITEM',
    label: 'Produk digital',
    description: 'File, materi, template, atau layanan digital yang diproses oleh tim SYKABELAJAR.',
  },
  {
    value: 'DONATION',
    label: 'Donasi',
    description: 'Pilihan nominal donasi untuk mendukung kegiatan atau program tertentu.',
  },
] as const;

const AUDIENCES = [
  { value: 'student', label: 'Pelajar' },
  { value: 'teacher', label: 'Guru' },
  { value: 'organizer', label: 'Penyelenggara' },
];

function initialDraft(product: Props['product']): ShopProductDraft {
  return {
    id: product.id ?? null,
    code: String(product.code ?? ''),
    slug: String(product.slug ?? ''),
    name: String(product.name ?? ''),
    short_description: String(product.short_description ?? ''),
    description: String(product.description ?? ''),
    product_type: String(product.product_type ?? 'DIGITAL_ITEM'),
    audiences: Array.isArray(product.audiences) ? product.audiences.map(String) : ['student'],
    price: Number.isFinite(Number(product.price)) ? Number(product.price ?? 0) : 0,
    currency: 'IDR',
    image_url: String(product.image_url ?? ''),
    is_active: Boolean(product.is_active),
    is_featured: Boolean(product.is_featured),
    sort_order: Number.isFinite(Number(product.sort_order)) ? Number(product.sort_order ?? 0) : 0,
    metadata: product.metadata && typeof product.metadata === 'object' ? product.metadata as Record<string, unknown> : {},
  };
}

function validImageUrl(value: string) {
  if (!value.trim()) return false;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

export function ShopProductEditor({ product, busy, onClose, onSave }: Props) {
  const [draft, setDraft] = useState<ShopProductDraft>(() => initialDraft(product));
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [validationMessage, setValidationMessage] = useState('');
  const isEditing = Boolean(draft.id);
  const selectedType = PRODUCT_TYPES.find((item) => item.value === draft.product_type);
  const unsupportedType = !selectedType;

  const patch = (changes: Partial<ShopProductDraft>) => {
    setDraft((current) => ({ ...current, ...changes }));
    setValidationMessage('');
  };

  const toggleAudience = (audience: string) => {
    const next = draft.audiences.includes(audience)
      ? draft.audiences.filter((item) => item !== audience)
      : [...draft.audiences, audience];
    patch({ audiences: next });
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = draft.name.trim();
    if (!name) return setValidationMessage('Nama produk perlu diisi terlebih dahulu.');
    if (draft.short_description.trim().length > 160) return setValidationMessage('Ringkasan maksimal 160 karakter.');
    if (draft.audiences.length === 0) return setValidationMessage('Pilih minimal satu kelompok pengguna.');
    if (unsupportedType) return setValidationMessage('Jenis produk ini belum didukung untuk pemesanan Shop. Pilih Produk digital atau Donasi.');
    if (!Number.isFinite(draft.price) || draft.price < 0) return setValidationMessage('Harga harus berupa angka nol atau lebih.');
    if (draft.is_active && draft.price <= 0) return setValidationMessage('Produk aktif harus memiliki harga di atas Rp0. Alur klaim produk gratis belum tersedia.');
    if (draft.image_url.trim() && !validImageUrl(draft.image_url)) return setValidationMessage('Tautan gambar harus diawali http:// atau https://.');
    if (!Number.isFinite(draft.sort_order) || draft.sort_order < 0 || !Number.isInteger(draft.sort_order)) return setValidationMessage('Urutan tampilan harus bilangan bulat nol atau lebih.');
    void onSave({ ...draft, name, short_description: draft.short_description.trim(), description: draft.description.trim(), image_url: draft.image_url.trim() });
  };

  return <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-3 sm:p-5" role="dialog" aria-modal="true" aria-labelledby="shop-product-editor-title">
    <button type="button" aria-label="Tutup formulir" className="absolute inset-0 cursor-default" onClick={() => { if (!busy) onClose(); }} />
    <Card className="relative z-10 flex max-h-[94vh] w-full max-w-3xl flex-col overflow-hidden border surface-border p-0 shadow-2xl">
      <header className="flex items-start justify-between gap-3 border-b surface-border px-5 py-4 sm:px-6">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent"><Package size={19}/></div>
          <div className="min-w-0">
            <h2 id="shop-product-editor-title" className="font-display text-lg font-bold text-fg">{isEditing ? 'Edit produk' : 'Tambah produk baru'}</h2>
            <p className="mt-1 text-xs leading-5 text-fg-muted">Lengkapi informasi yang akan dilihat pengguna sebelum produk ditampilkan di Shop.</p>
          </div>
        </div>
        <button type="button" aria-label="Tutup" onClick={() => { if (!busy) onClose(); }} disabled={busy} className="rounded-xl p-2 text-fg-muted transition hover:bg-surface-elevated hover:text-fg disabled:opacity-40"><X size={18}/></button>
      </header>

      <form onSubmit={submit} className="min-h-0 flex-1 overflow-y-auto">
        <div className="grid gap-6 p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_240px]">
          <div className="space-y-5">
            <section className="space-y-3">
              <div>
                <h3 className="text-sm font-semibold text-fg">Informasi produk</h3>
                <p className="mt-1 text-xs text-fg-muted">Gunakan nama dan ringkasan yang jelas supaya pengguna memahami apa yang mereka pesan.</p>
              </div>
              <label className="block">
                <span className="label">Nama produk <span className="text-red-400">*</span></span>
                <input autoFocus className="input mt-1 w-full" maxLength={120} value={draft.name} onChange={(event) => patch({ name: event.target.value })} placeholder="Contoh: Paket Latihan Olimpiade Sains" required />
              </label>
              <label className="block">
                <span className="label">Jenis produk <span className="text-red-400">*</span></span>
                <select className="input mt-1 w-full" value={draft.product_type} onChange={(event) => patch({ product_type: event.target.value })}>
                  {unsupportedType && <option value={draft.product_type} disabled>Jenis lama — belum didukung</option>}
                  {PRODUCT_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
                </select>
                <span className="mt-1.5 block text-xs leading-5 text-fg-muted">{selectedType?.description ?? 'Produk dengan alur khusus ini belum bisa dijual melalui Shop.'}</span>
              </label>
              <label className="block">
                <span className="label">Ringkasan</span>
                <input className="input mt-1 w-full" maxLength={160} value={draft.short_description} onChange={(event) => patch({ short_description: event.target.value })} placeholder="Penjelasan singkat untuk kartu produk" />
                <span className="mt-1 block text-right text-[10px] text-fg-muted">{draft.short_description.length}/160 karakter</span>
              </label>
              <label className="block">
                <span className="label">Deskripsi lengkap</span>
                <textarea className="input mt-1 min-h-28 w-full resize-y" maxLength={5000} value={draft.description} onChange={(event) => patch({ description: event.target.value })} placeholder="Jelaskan isi produk, manfaat, cara menerima, atau ketentuan pemesanan." />
              </label>
            </section>

            <section className="space-y-3 border-t surface-border pt-5">
              <div>
                <h3 className="text-sm font-semibold text-fg">Harga dan gambar</h3>
                <p className="mt-1 text-xs text-fg-muted">Harga dalam Rupiah. Gambar bersifat opsional, tetapi membantu produk lebih mudah dikenali.</p>
              </div>
              <label className="block">
                <span className="label">Harga (Rp) <span className="text-red-400">*</span></span>
                <div className="relative mt-1">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-fg-muted">Rp</span>
                  <input className="input w-full pl-10" type="number" min="0" step="1" inputMode="numeric" value={draft.price} onChange={(event) => patch({ price: event.target.value === '' ? 0 : Number(event.target.value) })} required />
                </div>
                {draft.price <= 0 && <p className="mt-1.5 text-xs text-amber-400">Produk dengan harga Rp0 belum bisa diklaim otomatis. Simpan sebagai draft dahulu.</p>}
              </label>
              <label className="block">
                <span className="label">Tautan gambar</span>
                <input className="input mt-1 w-full" type="url" value={draft.image_url} onChange={(event) => patch({ image_url: event.target.value })} placeholder="https://..." />
                <span className="mt-1 block text-xs text-fg-muted">Tempel tautan gambar publik yang bisa dibuka pengguna.</span>
              </label>
              <label className="block">
                <span className="label">Urutan di Shop</span>
                <input className="input mt-1 w-full" type="number" min="0" step="1" value={draft.sort_order} onChange={(event) => patch({ sort_order: event.target.value === '' ? 0 : Number(event.target.value) })} />
                <span className="mt-1 block text-xs text-fg-muted">Angka lebih kecil akan tampil lebih dahulu.</span>
              </label>
            </section>

            <section className="space-y-3 border-t surface-border pt-5">
              <div>
                <h3 className="text-sm font-semibold text-fg">Siapa yang boleh melihat produk ini?</h3>
                <p className="mt-1 text-xs text-fg-muted">Pengguna di luar pilihan ini tidak akan dapat melihat atau memesan produk.</p>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                {AUDIENCES.map((audience) => {
                  const checked = draft.audiences.includes(audience.value);
                  return <label key={audience.value} className={`flex cursor-pointer items-center gap-2 rounded-xl border p-3 text-sm transition ${checked ? 'border-accent/30 bg-accent/5 text-fg' : 'border-surface-border text-fg-muted hover:bg-surface-elevated/35'}`}>
                    <input type="checkbox" checked={checked} onChange={() => toggleAudience(audience.value)} />
                    <span>{audience.label}</span>
                  </label>;
                })}
              </div>
            </section>

            <details className="rounded-xl border surface-border px-4 py-3" open={advancedOpen} onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}>
              <summary className="cursor-pointer text-sm font-semibold text-fg">Identitas produk (opsional)</summary>
              <p className="mt-2 text-xs leading-5 text-fg-muted">Boleh dikosongkan. Sistem akan membuat kode dan tautan produk secara otomatis.</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="block"><span className="label">Kode internal</span><input className="input mt-1 w-full" value={draft.code} onChange={(event) => patch({ code: event.target.value })} placeholder="Dibuat otomatis jika kosong" /></label>
                <label className="block"><span className="label">Tautan pendek</span><input className="input mt-1 w-full" value={draft.slug} onChange={(event) => patch({ slug: event.target.value })} placeholder="Dibuat otomatis jika kosong" /></label>
              </div>
            </details>
          </div>

          <aside className="space-y-4">
            <Card className="overflow-hidden border surface-border p-0">
              <div className="flex aspect-[4/3] items-center justify-center bg-surface-elevated/35">
                {validImageUrl(draft.image_url)
                  ? <img src={draft.image_url} alt={draft.name || 'Pratinjau produk'} className="h-full w-full object-cover" />
                  : <div className="px-4 text-center text-fg-muted"><ImagePlus size={26} className="mx-auto mb-2 opacity-70"/><p className="text-xs">Pratinjau gambar</p><p className="mt-1 text-[10px]">Gambar akan terlihat di sini</p></div>}
              </div>
              <div className="space-y-2 p-4">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="rounded-full bg-accent/10 px-2 py-1 text-[10px] font-semibold text-accent">{selectedType?.label ?? 'Jenis belum didukung'}</span>
                  {draft.is_featured && <span className="rounded-full bg-amber-500/10 px-2 py-1 text-[10px] font-semibold text-amber-400"><Sparkles size={10} className="mr-1 inline"/>Unggulan</span>}
                </div>
                <p className="break-words text-sm font-semibold text-fg">{draft.name.trim() || 'Nama produk'}</p>
                <p className="line-clamp-3 text-xs leading-5 text-fg-muted">{draft.short_description || 'Ringkasan produk akan tampil di sini.'}</p>
                <p className="pt-1 text-lg font-bold text-accent">Rp {Math.max(0, Number(draft.price) || 0).toLocaleString('id-ID')}</p>
              </div>
            </Card>

            <div className="space-y-3 rounded-xl border surface-border p-4">
              <div>
                <p className="text-sm font-semibold text-fg">Tampilan Shop</p>
                <p className="mt-1 text-xs leading-5 text-fg-muted">Produk yang dinonaktifkan hanya tersimpan di pengelolaan admin dan tidak muncul di katalog pengguna.</p>
              </div>
              <label className="flex cursor-pointer items-start gap-3">
                <input className="mt-1" type="checkbox" checked={draft.is_active} onChange={(event) => patch({ is_active: event.target.checked })} />
                <span><span className="block text-sm font-medium text-fg">Tampilkan di Shop</span><span className="mt-0.5 block text-xs leading-5 text-fg-muted">Pengguna yang sesuai bisa melihat dan memesan produk.</span></span>
              </label>
              <label className="flex cursor-pointer items-start gap-3">
                <input className="mt-1" type="checkbox" checked={draft.is_featured} onChange={(event) => patch({ is_featured: event.target.checked })} />
                <span><span className="block text-sm font-medium text-fg">Jadikan unggulan</span><span className="mt-0.5 block text-xs leading-5 text-fg-muted">Tandai sebagai produk pilihan untuk pengelolaan katalog.</span></span>
              </label>
            </div>

            <div className="flex items-start gap-2 rounded-xl border border-sky-500/20 bg-sky-500/5 p-3 text-xs leading-5 text-fg-muted">
              <Info size={15} className="mt-0.5 shrink-0 text-sky-400"/>
              <span>Pembayaran produk saat ini perlu bukti pembayaran dan persetujuan admin. Barang fisik, isi ulang Coin otomatis, dan pembukaan fitur otomatis belum tersedia.</span>
            </div>
          </aside>
        </div>

        {validationMessage && <div className="mx-5 mb-4 rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-300 sm:mx-6">{validationMessage}</div>}
        <footer className="sticky bottom-0 flex flex-col-reverse gap-2 border-t surface-border bg-surface px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p className="flex items-center gap-2 text-xs text-fg-muted"><Eye size={14}/>Pratinjau di samping mengikuti perubahan form.</p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>Batal</Button>
            <Button type="submit" disabled={busy} loading={busy} icon={<Check size={15}/>} >{busy ? 'Menyimpan…' : isEditing ? 'Simpan perubahan' : 'Simpan produk'}</Button>
          </div>
        </footer>
      </form>
    </Card>
  </div>;
}
