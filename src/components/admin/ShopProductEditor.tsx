import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { Check, Eye, ImagePlus, Info, Package, Sparkles, Upload, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import type { AdminProductInput } from '@/services/adminCore.service';
import { uploadImage } from '@/services/cloudinary.service';
import { supabase } from '@/lib/supabase';
import { getCollectiveCertificatePrice } from '@/services/collectiveParticipant.service';

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
  onSave: (product: ShopProductDraft) => Promise<unknown>;
};

const PRODUCT_TYPES = [
  { value: 'EDU_COIN_TOPUP', label: 'Paket Edu Coin', description: 'Saldo Edu Coin akan bertambah otomatis setelah pembayaran disetujui admin.' },
  { value: 'BADGE', label: 'Badge profil', description: 'Badge profil dari koleksi badge SYKABELAJAR akan diberikan otomatis setelah pembayaran disetujui.' },
  { value: 'CERTIFICATE_SERIALS', label: 'Paket QR / Serial Sertifikat', description: 'Tambahkan QR / serial yang siap dipasangkan pada sertifikat milik organisasi.' },
  { value: 'COLLECTIVE_CERTIFICATE', label: 'Sertifikat peserta kolektif', description: 'Tautan pemesanan sertifikat peserta yang sudah menyelesaikan lomba kolektif. Harga mengikuti pengaturan sertifikat.' },
  { value: 'DIGITAL_ITEM', label: 'Layanan / materi lomba', description: 'Materi latihan, template, atau layanan digital yang diproses oleh tim SYKABELAJAR.' },
  { value: 'DONATION', label: 'Donasi', description: 'Pilihan donasi untuk mendukung kegiatan dan pengembangan SYKABELAJAR.' },
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
  const [availableBadges, setAvailableBadges] = useState<Array<{ id: string; name: string; icon_emoji: string | null; rarity: string }>>([]);
  const [badgeCatalogLoading, setBadgeCatalogLoading] = useState(false);
  const [collectiveCertificatePrice, setCollectiveCertificatePrice] = useState<number | null>(null);
  const [imageUploadBusy, setImageUploadBusy] = useState(false);
  const [validationMessage, setValidationMessage] = useState('');
  const isEditing = Boolean(draft.id);
  const selectedType = PRODUCT_TYPES.find((item) => item.value === draft.product_type);
  const unsupportedType = !selectedType;
  const usesSpecialAudience = draft.product_type === 'CERTIFICATE_SERIALS' || draft.product_type === 'COLLECTIVE_CERTIFICATE';

  useEffect(() => {
    let active = true;
    setBadgeCatalogLoading(true);
    void supabase.from('badges').select('id,name,icon_emoji,rarity').eq('status','ACTIVE').order('name')
      .then(({ data, error }) => {
        if (!active) return;
        if (error) throw error;
        setAvailableBadges((data ?? []) as Array<{ id: string; name: string; icon_emoji: string | null; rarity: string }>);
      })
      .catch(() => {
        if (active) setValidationMessage('Daftar badge belum bisa dimuat. Coba buka kembali formulir.');
      })
      .finally(() => { if (active) setBadgeCatalogLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (draft.product_type !== 'COLLECTIVE_CERTIFICATE') return;
    let active = true;
    void getCollectiveCertificatePrice()
      .then((price) => { if (active) setCollectiveCertificatePrice(price); })
      .catch(() => { if (active) setCollectiveCertificatePrice(null); });
    return () => { active = false; };
  }, [draft.product_type]);

  const patch = (changes: Partial<ShopProductDraft>) => {
    setDraft((current) => ({ ...current, ...changes }));
    setValidationMessage('');
  };

  const changeProductType = (productType: string) => {
    const fixedAudience = productType === 'CERTIFICATE_SERIALS' ? ['organizer']
      : productType === 'COLLECTIVE_CERTIFICATE' ? ['teacher'] : draft.audiences;
    patch({ product_type: productType, audiences: fixedAudience, metadata: productType === 'COLLECTIVE_CERTIFICATE' ? { fulfillment: 'COLLECTIVE_CERTIFICATE' } : {} , price: productType === 'COLLECTIVE_CERTIFICATE' ? 0 : draft.price });
  };

  const toggleAudience = (audience: string) => {
    if (usesSpecialAudience) return;
    const next = draft.audiences.includes(audience)
      ? draft.audiences.filter((item) => item !== audience)
      : [...draft.audiences, audience];
    patch({ audiences: next });
  };

  const uploadProductImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setValidationMessage('Pilih file gambar, misalnya PNG, JPG, atau WEBP.');
      input.value = '';
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setValidationMessage('Ukuran gambar maksimal 5 MB.');
      input.value = '';
      return;
    }

    setImageUploadBusy(true);
    setValidationMessage('');
    try {
      const folder = `sykabelajar/shop-products/${draft.id ?? 'new'}`;
      const uploaded = await uploadImage(file, folder);
      patch({ image_url: uploaded.secure_url });
    } catch {
      setValidationMessage('Gambar gagal diunggah. Coba lagi atau gunakan tautan gambar publik.');
    } finally {
      setImageUploadBusy(false);
      input.value = '';
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = draft.name.trim();
    if (!name) return setValidationMessage('Nama produk perlu diisi terlebih dahulu.');
    if (draft.short_description.trim().length > 160) return setValidationMessage('Ringkasan maksimal 160 karakter.');
    if (draft.audiences.length === 0) return setValidationMessage('Pilih minimal satu kelompok pengguna.');
    if (unsupportedType) return setValidationMessage('Jenis produk ini belum didukung untuk pemesanan Shop. Pilih Produk digital atau Donasi.');
    if (!Number.isFinite(draft.price) || draft.price < 0) return setValidationMessage('Harga harus berupa angka nol atau lebih.');
    if (draft.is_active && draft.price <= 0 && draft.product_type !== 'COLLECTIVE_CERTIFICATE') return setValidationMessage('Produk aktif harus memiliki harga di atas Rp0.');
    if (draft.product_type === 'EDU_COIN_TOPUP' && (!Number.isInteger(Number(draft.metadata.coin_amount)) || Number(draft.metadata.coin_amount) < 1 || Number(draft.metadata.coin_amount) > 1000000)) return setValidationMessage('Masukkan jumlah Edu Coin antara 1 dan 1.000.000.');
    if (draft.product_type === 'BADGE' && !draft.metadata.badge_id) return setValidationMessage('Pilih badge yang akan diberikan setelah pembayaran berhasil.');
    if (draft.product_type === 'CERTIFICATE_SERIALS' && (!Number.isInteger(Number(draft.metadata.serial_quantity)) || Number(draft.metadata.serial_quantity) < 1 || Number(draft.metadata.serial_quantity) > 1000)) return setValidationMessage('Masukkan jumlah QR / Serial antara 1 dan 1.000.');
    if (draft.product_type === 'COLLECTIVE_CERTIFICATE' && collectiveCertificatePrice == null) return setValidationMessage('Harga sertifikat belum dapat dimuat. Atur atau periksa Pengaturan Sertifikat Kolektif terlebih dahulu.');
    if (draft.image_url.trim() && !validImageUrl(draft.image_url)) return setValidationMessage('Tautan gambar harus diawali http:// atau https://.');
    if (!Number.isFinite(draft.sort_order) || draft.sort_order < 0 || !Number.isInteger(draft.sort_order)) return setValidationMessage('Urutan tampilan harus bilangan bulat nol atau lebih.');
    void onSave({ ...draft, name, price: draft.product_type === 'COLLECTIVE_CERTIFICATE' ? 0 : draft.price, audiences: draft.product_type === 'CERTIFICATE_SERIALS' ? ['organizer'] : draft.product_type === 'COLLECTIVE_CERTIFICATE' ? ['teacher'] : draft.audiences, metadata: draft.product_type === 'COLLECTIVE_CERTIFICATE' ? { fulfillment: 'COLLECTIVE_CERTIFICATE' } : draft.metadata, short_description: draft.short_description.trim(), description: draft.description.trim(), image_url: draft.image_url.trim() });
  };

  return <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-3 sm:p-5" role="dialog" aria-modal="true" aria-labelledby="shop-product-editor-title">
    <button type="button" aria-label="Tutup formulir" className="absolute inset-0 cursor-default" onClick={() => { if (!busy && !imageUploadBusy) onClose(); }} />
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
                <select className="input mt-1 w-full" value={draft.product_type} onChange={(event) => changeProductType(event.target.value)}>
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
              <div>
                <label className="block">
                  <span className="label">{draft.product_type === 'COLLECTIVE_CERTIFICATE' ? 'Harga sertifikat peserta' : 'Harga (Rp)'} {draft.product_type !== 'COLLECTIVE_CERTIFICATE' && <span className="text-red-400">*</span>}</span>
                  <div className="relative mt-1">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-fg-muted">Rp</span>
                    <input className="input w-full pl-10" type="number" min="0" step="1" inputMode="numeric" value={draft.product_type === 'COLLECTIVE_CERTIFICATE' ? (collectiveCertificatePrice ?? '') : draft.price} onChange={(event) => patch({ price: event.target.value === '' ? 0 : Number(event.target.value) })} disabled={draft.product_type === 'COLLECTIVE_CERTIFICATE'} required={draft.product_type !== 'COLLECTIVE_CERTIFICATE'} />
                  </div>
                  {draft.product_type === 'COLLECTIVE_CERTIFICATE'
                    ? <p className="mt-1.5 text-xs leading-5 text-fg-muted">Harga mengikuti Pengaturan Sertifikat Kolektif. Atur nominal pada menu Pengaturan Sertifikat; katalog ini hanya mengaktifkan penawaran di Shop.</p>
                    : <p className="mt-1.5 text-xs text-fg-muted">Harga per paket. Semua pembayaran diperiksa admin sebelum manfaat diberikan.</p>}
                </label>
              </div>

              {draft.product_type === 'EDU_COIN_TOPUP' && <label className="block">
                <span className="label">Edu Coin yang diterima pembeli <span className="text-red-400">*</span></span>
                <input className="input mt-1 w-full" type="number" min="1" max="1000000" step="1" value={String(draft.metadata.coin_amount ?? '')} onChange={(event) => patch({ metadata: { ...draft.metadata, coin_amount: event.target.value === '' ? '' : Number(event.target.value) } })} placeholder="Contoh: 250" required />
                <span className="mt-1 block text-xs text-fg-muted">Coin akan ditambahkan ke saldo setelah admin menyetujui pembayaran. Membeli lebih dari satu paket akan menambah Coin sesuai jumlah paket.</span>
              </label>}

              {draft.product_type === 'BADGE' && <label className="block">
                <span className="label">Badge yang akan diberikan <span className="text-red-400">*</span></span>
                <select className="input mt-1 w-full" value={String(draft.metadata.badge_id ?? '')} onChange={(event) => patch({ metadata: { ...draft.metadata, badge_id: event.target.value } })} required disabled={badgeCatalogLoading}>
                  <option value="">{badgeCatalogLoading ? 'Memuat badge…' : 'Pilih badge aktif'}</option>
                  {availableBadges.map((badge) => <option key={badge.id} value={badge.id}>{badge.icon_emoji ? badge.icon_emoji + ' ' : ''}{badge.name} · {badge.rarity}</option>)}
                </select>
                <span className="mt-1 block text-xs text-fg-muted">Pembeli yang sudah memiliki badge ini tidak dapat membeli duplikatnya.</span>
              </label>}

              {draft.product_type === 'CERTIFICATE_SERIALS' && <label className="block">
                <span className="label">Jumlah QR / Serial dalam paket <span className="text-red-400">*</span></span>
                <input className="input mt-1 w-full" type="number" min="1" max="1000" step="1" value={String(draft.metadata.serial_quantity ?? '')} onChange={(event) => patch({ metadata: { ...draft.metadata, serial_quantity: event.target.value === '' ? '' : Number(event.target.value) } })} placeholder="Contoh: 100" required />
                <span className="mt-1 block text-xs text-fg-muted">Serial langsung ditambahkan ke organisasi yang dipilih saat pemesanan. Paket hanya bisa dibeli oleh penyelenggara yang memiliki akses ke organisasi tersebut.</span>
              </label>}
              <div>
                <span className="label">Gambar produk</span>
                <input className="input mt-1 w-full" type="url" value={draft.image_url} onChange={(event) => patch({ image_url: event.target.value })} placeholder="Tempel tautan gambar (opsional)" aria-label="Tautan gambar"/>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <label className={`inline-flex cursor-pointer items-center gap-2 rounded-xl border surface-border px-3 py-2 text-xs font-semibold text-fg transition hover:bg-surface-elevated/50 ${imageUploadBusy || busy ? 'pointer-events-none opacity-60' : ''}`}>
                    <Upload size={14}/>
                    <span>{imageUploadBusy ? 'Sedang mengunggah…' : 'Unggah gambar'}</span>
                    <input className="sr-only" type="file" accept="image/*" onChange={(event) => void uploadProductImage(event)} disabled={imageUploadBusy || busy}/>
                  </label>
                  {draft.image_url && <button type="button" className="rounded-xl px-3 py-2 text-xs text-fg-muted hover:bg-surface-elevated/40" onClick={() => patch({ image_url: '' })} disabled={imageUploadBusy || busy}>Hapus gambar</button>}
                </div>
                <span className="mt-1.5 block text-xs leading-5 text-fg-muted">Format gambar umum, maksimal 5 MB. Kamu juga bisa menempel tautan gambar publik.</span>
              </div>
              <label className="block">
                <span className="label">Urutan di Shop</span>
                <input className="input mt-1 w-full" type="number" min="0" step="1" value={draft.sort_order} onChange={(event) => patch({ sort_order: event.target.value === '' ? 0 : Number(event.target.value) })} />
                <span className="mt-1 block text-xs text-fg-muted">Angka lebih kecil akan tampil lebih dahulu.</span>
              </label>
            </section>

            <section className="space-y-3 border-t surface-border pt-5">
              <div>
                <h3 className="text-sm font-semibold text-fg">Siapa yang boleh melihat produk ini?</h3>
                <p className="mt-1 text-xs text-fg-muted">Pengguna di luar pilihan ini tidak akan dapat melihat atau memesan produk. Paket serial khusus penyelenggara, sedangkan sertifikat peserta kolektif khusus guru.</p>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                {AUDIENCES.map((audience) => {
                  const checked = draft.audiences.includes(audience.value);
                  return <label key={audience.value} className={`flex cursor-pointer items-center gap-2 rounded-xl border p-3 text-sm transition ${checked ? 'border-accent/30 bg-accent/5 text-fg' : 'border-surface-border text-fg-muted hover:bg-surface-elevated/35'}`}>
                    <input type="checkbox" checked={checked} onChange={() => toggleAudience(audience.value)} disabled={usesSpecialAudience} />
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
              <span>Edu Coin, badge profil, paket QR / Serial, dan sertifikat peserta kolektif diproses melalui alur khusus setelah pembayaran disetujui. Produk digital biasa tetap diproses tim SYKABELAJAR.</span>
            </div>
          </aside>
        </div>

        {validationMessage && <div className="mx-5 mb-4 rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-300 sm:mx-6">{validationMessage}</div>}
        <footer className="sticky bottom-0 flex flex-col-reverse gap-2 border-t surface-border bg-surface px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p className="flex items-center gap-2 text-xs text-fg-muted"><Eye size={14}/>Pratinjau di samping mengikuti perubahan form.</p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={busy || imageUploadBusy}>Batal</Button>
            <Button type="submit" disabled={busy || imageUploadBusy} loading={busy || imageUploadBusy} icon={<Check size={15}/>} >{imageUploadBusy ? 'Mengunggah gambar…' : busy ? 'Menyimpan…' : isEditing ? 'Simpan perubahan' : 'Simpan produk'}</Button>
          </div>
        </footer>
      </form>
    </Card>
  </div>;
}
