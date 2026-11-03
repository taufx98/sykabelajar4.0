import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { Eye, ExternalLink, ImagePlus, Loader2, MousePointerClick, Pencil, Plus, RefreshCw, Save, Tag, Trash2, Upload, X } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { uploadImage } from '@/services/cloudinary.service';
import { getShopProductCategories, type ShopProductCategory } from '@/services/shopEngagement.service';
import type { CommerceProduct } from '@/services/commerce.service';
import {
  adminDeleteShopPromoBanner, adminIssueShopVoucher, adminListIssuedShopVouchers,
  adminListShopPromoBanners, adminListShopVoucherDefinitions, adminSaveShopPromoBanner,
  adminSaveShopVoucherDefinition, type ShopIssuedVoucher, type ShopPromoBanner,
  type ShopVoucherDefinition, type ShopVoucherGroup, type ShopVoucherUsage,
} from '@/services/shopPromotion.service';

type Props = { products: CommerceProduct[] };
type BannerDraft = { id: string | null; imageUrl: string; targetUrl: string; durationSeconds: number; position: number; isActive: boolean };
type VoucherDraft = {
  id: string | null; name: string; description: string; usage_type: ShopVoucherUsage; duration_hours: number;
  benefit_group: ShopVoucherGroup; benefit_type: 'PERCENT' | 'FIXED' | 'BUY_X_GET_Y' | 'FREE_SHIPPING';
  discount_value: number; discount_currency: 'IDR' | 'EDU_COIN'; buy_quantity: number; free_quantity: number;
  scope_type: 'ALL' | 'CATEGORY' | 'PRODUCT'; product_ids: string[]; category_ids: string[];
  min_purchase: number; starts_at: string; ends_at: string; is_active: boolean;
};

const emptyBanner: BannerDraft = { id: null, imageUrl: '', targetUrl: '', durationSeconds: 5, position: 1, isActive: true };
const localDateTime = (date: Date) => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
};
const emptyVoucher: VoucherDraft = {
  id: null, name: '', description: '', usage_type: 'SINGLE_USE', duration_hours: 24,
  benefit_group: 'PRICE_DISCOUNT', benefit_type: 'PERCENT', discount_value: 10, discount_currency: 'IDR',
  buy_quantity: 1, free_quantity: 1, scope_type: 'ALL', product_ids: [], category_ids: [],
  min_purchase: 0, starts_at: localDateTime(new Date()), ends_at: '', is_active: true,
};

function cloudinaryImageUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname.toLowerCase() === 'res.cloudinary.com'
      && /^\/[^/]+\/image\/upload\/.+/.test(url.pathname);
  } catch { return false; }
}
function benefitLabel(group: ShopVoucherGroup) {
  return group === 'BUY_X_GET_Y' ? 'Beli X Gratis Y' : group === 'FREE_SHIPPING' ? 'Gratis ongkir' : 'Diskon harga';
}
function voucherValueLabel(definition: ShopVoucherDefinition) {
  if (definition.benefit_type === 'PERCENT') return definition.discount_value + '%';
  if (definition.benefit_type === 'FIXED') return (definition.discount_currency === 'EDU_COIN' ? 'Coin ' : 'Rp ') + definition.discount_value.toLocaleString('id-ID');
  if (definition.benefit_type === 'BUY_X_GET_Y') return 'Beli ' + definition.buy_quantity + ' gratis ' + definition.free_quantity;
  return 'Gratis ongkir';
}
function voucherStatusLabel(status: string) {
  const labels: Record<string, string> = { ACTIVE: 'Aktif', READY: 'Siap digunakan', RESERVED: 'Dalam pesanan', USED: 'Digunakan', EXPIRED: 'Kedaluwarsa' };
  return labels[status] ?? status;
}

export function ShopPromotionManager({ products }: Props) {
  const [banners, setBanners] = useState<ShopPromoBanner[]>([]);
  const [bannerDraft, setBannerDraft] = useState<BannerDraft>(emptyBanner);
  const [uploadingBanner, setUploadingBanner] = useState(false);
  const [savingBanner, setSavingBanner] = useState(false);
  const [voucherDefinitions, setVoucherDefinitions] = useState<ShopVoucherDefinition[]>([]);
  const [issuedVouchers, setIssuedVouchers] = useState<ShopIssuedVoucher[]>([]);
  const [categories, setCategories] = useState<ShopProductCategory[]>([]);
  const [voucherDraft, setVoucherDraft] = useState<VoucherDraft>(emptyVoucher);
  const [issueDefinitionId, setIssueDefinitionId] = useState('');
  const [issueUsername, setIssueUsername] = useState('');
  const [busyVoucher, setBusyVoucher] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [bannerRows, definitions, issued, categoryRows] = await Promise.all([
        adminListShopPromoBanners(), adminListShopVoucherDefinitions(), adminListIssuedShopVouchers(), getShopProductCategories(),
      ]);
      setBanners(bannerRows);
      setVoucherDefinitions(definitions);
      setIssuedVouchers(issued);
      setCategories(categoryRows.filter((row) => row.is_active));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Pengaturan promosi Shop belum dapat dimuat.');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const orderedBanners = useMemo(
    () => [...banners].sort((a, b) => a.position - b.position || (a.created_at ?? '').localeCompare(b.created_at ?? '')),
    [banners],
  );

  const uploadPromoBanner = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/') || file.size > 5 * 1024 * 1024) {
      setError('Gambar banner harus berupa file gambar dengan ukuran maksimal 5 MB.');
      input.value = '';
      return;
    }
    setUploadingBanner(true);
    setError('');
    try {
      const uploaded = await uploadImage(file, 'sykabelajar/shop-promo-banners');
      if (!cloudinaryImageUrl(uploaded.secure_url)) throw new Error('URL gambar Cloudinary tidak valid.');
      setBannerDraft((current) => ({ ...current, imageUrl: uploaded.secure_url }));
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Gambar banner gagal diunggah.');
    } finally { setUploadingBanner(false); input.value = ''; }
  };

  const saveBanner = async () => {
    if (!cloudinaryImageUrl(bannerDraft.imageUrl)) {
      setError('Unggah gambar banner melalui Cloudinary terlebih dahulu.');
      return;
    }
    if (bannerDraft.targetUrl.trim()) {
      try { const target = new URL(bannerDraft.targetUrl.trim()); if (target.protocol !== 'https:') throw new Error(); }
      catch { setError('Direct link banner harus berupa URL HTTPS yang valid.'); return; }
    }
    if (!Number.isInteger(bannerDraft.durationSeconds) || bannerDraft.durationSeconds < 2 || bannerDraft.durationSeconds > 60) {
      setError('Durasi slide harus antara 2 sampai 60 detik.'); return;
    }
    if (!Number.isInteger(bannerDraft.position) || bannerDraft.position < 1) {
      setError('Posisi slide harus berupa angka mulai dari 1.'); return;
    }
    setSavingBanner(true); setError(''); setSuccess('');
    try {
      await adminSaveShopPromoBanner({
        id: bannerDraft.id, imageUrl: bannerDraft.imageUrl, targetUrl: bannerDraft.targetUrl,
        durationSeconds: bannerDraft.durationSeconds, position: bannerDraft.position, isActive: bannerDraft.isActive,
      });
      setBannerDraft(emptyBanner);
      setSuccess('Banner promosi berhasil disimpan.');
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Banner promosi gagal disimpan.');
    } finally { setSavingBanner(false); }
  };

  const editBanner = (banner: ShopPromoBanner) => {
    setBannerDraft({
      id: banner.id, imageUrl: banner.image_url, targetUrl: banner.target_url ?? '',
      durationSeconds: banner.slide_duration_seconds, position: banner.position, isActive: Boolean(banner.is_active),
    });
    setError(''); setSuccess('');
  };

  const hideBanner = async (banner: ShopPromoBanner) => {
    setSavingBanner(true); setError('');
    try {
      await adminSaveShopPromoBanner({
        id: banner.id, imageUrl: banner.image_url, targetUrl: banner.target_url,
        durationSeconds: banner.slide_duration_seconds, position: banner.position, isActive: !banner.is_active,
      });
      await load();
      setSuccess(banner.is_active ? 'Banner berhasil disembunyikan.' : 'Banner berhasil ditampilkan.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Status banner gagal diperbarui.');
    } finally { setSavingBanner(false); }
  };

  const deleteBanner = async (banner: ShopPromoBanner) => {
    if (!window.confirm('Hapus banner ini secara permanen?')) return;
    setSavingBanner(true); setError('');
    try {
      await adminDeleteShopPromoBanner(banner.id);
      if (bannerDraft.id === banner.id) setBannerDraft(emptyBanner);
      await load();
      setSuccess('Banner berhasil dihapus.');
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Banner gagal dihapus.');
    } finally { setSavingBanner(false); }
  };

  const patchVoucher = (changes: Partial<VoucherDraft>) => {
    setVoucherDraft((current) => ({ ...current, ...changes }));
    setError(''); setSuccess('');
  };

  const saveVoucher = async () => {
    const draft = voucherDraft;
    if (draft.name.trim().length < 2) { setError('Nama voucher minimal 2 karakter.'); return; }
    if (draft.usage_type === 'DURATION' && (!Number.isInteger(draft.duration_hours) || draft.duration_hours < 1 || draft.duration_hours > 720)) {
      setError('Durasi voucher harus antara 1 sampai 720 jam.'); return;
    }
    if (draft.scope_type === 'PRODUCT' && draft.product_ids.length === 0) { setError('Pilih produk yang menjadi target voucher.'); return; }
    if (draft.scope_type === 'CATEGORY' && draft.category_ids.length === 0) { setError('Pilih kategori yang menjadi target voucher.'); return; }
    if (draft.benefit_group === 'PRICE_DISCOUNT' && (draft.discount_value <= 0 || (draft.benefit_type === 'PERCENT' && draft.discount_value > 100))) {
      setError('Nilai diskon persentase harus 1–100, sedangkan diskon nominal harus lebih dari 0.'); return;
    }
    if (draft.discount_currency === 'EDU_COIN' && draft.benefit_type === 'FIXED' && !Number.isInteger(draft.discount_value)) {
      setError('Potongan Edu Coin harus berupa bilangan bulat.'); return;
    }
    setBusyVoucher(true); setError(''); setSuccess('');
    try {
      await adminSaveShopVoucherDefinition({
        ...draft,
        starts_at: new Date(draft.starts_at).toISOString(),
        ends_at: draft.ends_at ? new Date(draft.ends_at).toISOString() : null,
      });
      setVoucherDraft(emptyVoucher);
      setSuccess('Aturan voucher berhasil disimpan.');
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Aturan voucher gagal disimpan.');
    } finally { setBusyVoucher(false); }
  };

  const editVoucher = (definition: ShopVoucherDefinition) => {
    setVoucherDraft({
      id: definition.id, name: definition.name, description: definition.description,
      usage_type: definition.usage_type, duration_hours: definition.duration_hours ?? 24,
      benefit_group: definition.benefit_group, benefit_type: definition.benefit_type,
      discount_value: definition.discount_value, discount_currency: definition.discount_currency,
      buy_quantity: definition.buy_quantity, free_quantity: definition.free_quantity,
      scope_type: definition.scope_type, product_ids: definition.product_ids, category_ids: definition.category_ids,
      min_purchase: definition.min_purchase, starts_at: localDateTime(new Date(definition.starts_at)),
      ends_at: definition.ends_at ? localDateTime(new Date(definition.ends_at)) : '', is_active: definition.is_active,
    });
    setError(''); setSuccess('');
  };

  const issueVoucher = async () => {
    if (!issueDefinitionId || !issueUsername.trim()) { setError('Pilih voucher dan masukkan username penerima.'); return; }
    setBusyVoucher(true); setError(''); setSuccess('');
    try {
      const issued = await adminIssueShopVoucher(issueDefinitionId, issueUsername);
      setIssueUsername('');
      setSuccess(issued.status === 'ACTIVE'
        ? 'Voucher berhasil diberikan dan durasi aktifnya langsung dimulai.'
        : 'Voucher berhasil diberikan ke koleksi pengguna.');
      await load();
    } catch (issueError) {
      const message = issueError instanceof Error ? issueError.message : '';
      setError(message.includes('VOUCHER_USER_NOT_FOUND') ? 'Username pengguna tidak ditemukan.' : message || 'Voucher gagal diberikan.');
    } finally { setBusyVoucher(false); }
  };

  const toggleVoucherDefinition = async (definition: ShopVoucherDefinition) => {
    setBusyVoucher(true); setError('');
    try {
      await adminSaveShopVoucherDefinition({ ...definition, is_active: !definition.is_active });
      await load();
      setSuccess(definition.is_active ? 'Voucher dinonaktifkan.' : 'Voucher diaktifkan kembali.');
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : 'Status voucher gagal diperbarui.');
    } finally { setBusyVoucher(false); }
  };

  return <div className="space-y-5">
    <Card className="overflow-hidden border-slate-800 bg-[#111B2C] p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 p-4 sm:p-5">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-500/10 text-sky-300"><ImagePlus size={17}/></span>
          <div><h4 className="text-sm font-bold text-slate-100">Banner promosi tambahan</h4><p className="mt-1 text-[11px] text-slate-400">Kelola beberapa banner slide tanpa mengubah banner utama Shop.</p></div>
        </div>
        <Badge color="info">{banners.length} banner</Badge>
      </div>
      <div className="grid gap-5 p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.85fr)]">
        <div className="space-y-3">
          <label className="block"><span className="label">Gambar banner</span><input className="input mt-1 w-full" value={bannerDraft.imageUrl} onChange={(event) => setBannerDraft((current) => ({ ...current, imageUrl: event.target.value }))} placeholder="URL Cloudinary atau unggah gambar"/></label>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border surface-border px-3 py-2 text-xs font-semibold text-fg hover:bg-surface-elevated/40">
            <Upload size={14}/>{uploadingBanner ? 'Mengunggah…' : 'Unggah banner'}
            <input className="sr-only" type="file" accept="image/*" onChange={(event) => void uploadPromoBanner(event)} disabled={uploadingBanner || savingBanner}/>
          </label>
          <label className="block"><span className="label">Direct link tujuan (opsional)</span><input className="input mt-1 w-full" type="url" value={bannerDraft.targetUrl} onChange={(event) => setBannerDraft((current) => ({ ...current, targetUrl: event.target.value }))} placeholder="https://..."/></label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block"><span className="label">Timer slide (detik)</span><input className="input mt-1 w-full" type="number" min={2} max={60} value={bannerDraft.durationSeconds} onChange={(event) => setBannerDraft((current) => ({ ...current, durationSeconds: Number(event.target.value) }))}/></label>
            <label className="block"><span className="label">Posisi slide</span><input className="input mt-1 w-full" type="number" min={1} value={bannerDraft.position} onChange={(event) => setBannerDraft((current) => ({ ...current, position: Number(event.target.value) }))}/></label>
          </div>
          <label className="inline-flex items-center gap-2 text-xs text-fg"><input type="checkbox" checked={bannerDraft.isActive} onChange={(event) => setBannerDraft((current) => ({ ...current, isActive: event.target.checked }))}/>Tampilkan banner ke pengguna</label>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button size="sm" onClick={() => void saveBanner()} disabled={savingBanner || uploadingBanner} loading={savingBanner} icon={<Save size={14}/>}>{bannerDraft.id ? 'Simpan perubahan' : 'Tambah banner'}</Button>
            {bannerDraft.id && <Button size="sm" variant="outline" onClick={() => setBannerDraft(emptyBanner)} disabled={savingBanner} icon={<X size={13}/>}>Batal edit</Button>}
          </div>
          <p className="text-[10px] leading-5 text-fg-muted">Gambar maksimal 5 MB dan wajib Cloudinary. Timer menentukan lama satu slide tampil sebelum berpindah; posisi lebih kecil ditampilkan lebih dahulu.</p>
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2"><h5 className="text-xs font-semibold text-slate-300">Daftar banner</h5><Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw size={12} className="mr-1"/>Segarkan</Button></div>
          {orderedBanners.length ? <div className="max-h-[460px] space-y-2 overflow-y-auto pr-1">
            {orderedBanners.map((banner) => <div key={banner.id} className="flex gap-3 rounded-xl border border-slate-800 bg-slate-900/50 p-2.5">
              <img src={banner.image_url} alt="" className="h-16 w-24 shrink-0 rounded-lg border border-slate-700 object-cover"/>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5"><Badge color={banner.is_active ? 'moss' : 'default'}>{banner.is_active ? 'Aktif' : 'Disembunyikan'}</Badge><span className="text-[10px] text-slate-500">Slide {banner.position} · {banner.slide_duration_seconds}s</span></div>
                <div className="mt-1 flex flex-wrap gap-3 text-[10px] text-slate-400"><span className="inline-flex items-center gap-1"><Eye size={11}/>{(banner.views_count ?? 0).toLocaleString('id-ID')} view</span><span className="inline-flex items-center gap-1"><MousePointerClick size={11}/>{(banner.clicks_count ?? 0).toLocaleString('id-ID')} klik</span></div>
                {banner.target_url && <a className="mt-1 inline-flex max-w-full items-center gap-1 truncate text-[10px] text-sky-300 hover:underline" href={banner.target_url} target="_blank" rel="noreferrer"><ExternalLink size={10}/>Tautan tujuan</a>}
                <div className="mt-1.5 flex flex-wrap gap-1">
                  <button type="button" onClick={() => editBanner(banner)} className="rounded-lg border border-slate-700 p-1.5 text-slate-400 hover:text-sky-300" aria-label="Edit banner"><Pencil size={12}/></button>
                  <button type="button" onClick={() => void hideBanner(banner)} disabled={savingBanner} className="rounded-lg border border-slate-700 px-2 py-1 text-[10px] text-slate-300 hover:text-amber-300">{banner.is_active ? 'Hide banner' : 'Tampilkan'}</button>
                  <button type="button" onClick={() => void deleteBanner(banner)} disabled={savingBanner} className="rounded-lg border border-red-500/20 p-1.5 text-red-300 hover:bg-red-500/10" aria-label="Hapus banner"><Trash2 size={12}/></button>
                </div>
              </div>
            </div>)}
          </div> : <p className="rounded-xl border border-dashed border-slate-700 p-6 text-center text-xs text-slate-500">Belum ada banner tambahan.</p>}
        </div>
      </div>
    </Card>

    <Card className="overflow-hidden border-slate-800 bg-[#111B2C] p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 p-4 sm:p-5">
        <div className="flex items-center gap-2.5"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/10 text-amber-300"><Tag size={17}/></span><div><h4 className="text-sm font-bold text-slate-100">Voucher Shop</h4><p className="mt-1 text-[11px] text-slate-400">Atur voucher sekali pakai, voucher durasi otomatis, manfaat, target, dan penerima.</p></div></div>
        <Badge color="info">{voucherDefinitions.length} aturan</Badge>
      </div>
      <div className="space-y-5 p-4 sm:p-5">
        <div className="grid gap-3 lg:grid-cols-2">
          <label className="block"><span className="label">Nama voucher</span><input className="input mt-1 w-full" maxLength={100} value={voucherDraft.name} onChange={(event) => patchVoucher({ name: event.target.value })} placeholder="Contoh: Promo Ulang Tahun Shop"/></label>
          <label className="block"><span className="label">Jenis voucher</span><select className="input mt-1 w-full" value={voucherDraft.usage_type} onChange={(event) => patchVoucher({ usage_type: event.target.value as ShopVoucherUsage })}><option value="SINGLE_USE">Sekali pakai · dipilih saat checkout</option><option value="DURATION">Durasi · otomatis aktif dan berulang</option></select></label>
        </div>
        <label className="block"><span className="label">Deskripsi / ketentuan</span><textarea className="input mt-1 min-h-16 w-full" maxLength={500} value={voucherDraft.description} onChange={(event) => patchVoucher({ description: event.target.value })} placeholder="Jelaskan ketentuan voucher kepada pengguna."/></label>
        {voucherDraft.usage_type === 'DURATION' && <label className="block max-w-xs"><span className="label">Durasi aktif setelah diterbitkan (jam)</span><input className="input mt-1 w-full" type="number" min={1} max={720} value={voucherDraft.duration_hours} onChange={(event) => patchVoucher({ duration_hours: Number(event.target.value) })}/><span className="mt-1 block text-[10px] text-slate-500">Voucher mulai aktif otomatis saat diberikan ke akun pengguna.</span></label>}

        <div className="grid gap-3 lg:grid-cols-2">
          <label className="block"><span className="label">Kelompok manfaat (aturan stacking)</span><select className="input mt-1 w-full" value={voucherDraft.benefit_group} onChange={(event) => {
            const group = event.target.value as ShopVoucherGroup;
            patchVoucher({ benefit_group: group, benefit_type: group === 'PRICE_DISCOUNT' ? 'PERCENT' : group === 'BUY_X_GET_Y' ? 'BUY_X_GET_Y' : 'FREE_SHIPPING' });
          }}><option value="PRICE_DISCOUNT">Diskon harga (persentase / nominal)</option><option value="BUY_X_GET_Y">Beli X gratis Y</option><option value="FREE_SHIPPING">Gratis ongkir</option></select></label>
          {voucherDraft.benefit_group === 'PRICE_DISCOUNT'
            ? <div className="grid grid-cols-[1fr_130px] gap-2">
                <label className="block"><span className="label">Nilai diskon</span><input className="input mt-1 w-full" type="number" min={1} max={voucherDraft.benefit_type === 'PERCENT' ? 100 : undefined} step={voucherDraft.benefit_type === 'PERCENT' ? '0.01' : '1'} value={voucherDraft.discount_value} onChange={(event) => patchVoucher({ discount_value: Number(event.target.value) })}/></label>
                <label className="block"><span className="label">Tipe diskon</span><select className="input mt-1 w-full" value={voucherDraft.benefit_type} onChange={(event) => patchVoucher({ benefit_type: event.target.value as 'PERCENT' | 'FIXED' })}><option value="PERCENT">Persen (%)</option><option value="FIXED">Nominal</option></select></label>
              </div>
            : voucherDraft.benefit_group === 'BUY_X_GET_Y'
              ? <div className="grid grid-cols-2 gap-2">
                  <label className="block"><span className="label">Beli minimal</span><input className="input mt-1 w-full" type="number" min={1} max={100} value={voucherDraft.buy_quantity} onChange={(event) => patchVoucher({ buy_quantity: Number(event.target.value) })}/></label>
                  <label className="block"><span className="label">Gratis</span><input className="input mt-1 w-full" type="number" min={1} max={100} value={voucherDraft.free_quantity} onChange={(event) => patchVoucher({ free_quantity: Number(event.target.value) })}/></label>
                </div>
              : <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-3 text-xs text-slate-400">Gratis ongkir dapat digabung dengan satu voucher dari kelompok manfaat lain. Hanya bisa dipilih untuk pesanan yang memiliki biaya pengiriman.</div>}
        </div>
        {voucherDraft.benefit_group === 'PRICE_DISCOUNT' && voucherDraft.benefit_type === 'FIXED' && <label className="block max-w-xs"><span className="label">Mata uang potongan nominal</span><select className="input mt-1 w-full" value={voucherDraft.discount_currency} onChange={(event) => patchVoucher({ discount_currency: event.target.value as 'IDR' | 'EDU_COIN' })}><option value="IDR">Rupiah</option><option value="EDU_COIN">Edu Coin</option></select></label>}

        <div className="grid gap-3 lg:grid-cols-3">
          <label className="block"><span className="label">Cakupan produk</span><select className="input mt-1 w-full" value={voucherDraft.scope_type} onChange={(event) => patchVoucher({ scope_type: event.target.value as VoucherDraft['scope_type'], product_ids: [], category_ids: [] })}><option value="ALL">Semua produk</option><option value="CATEGORY">Kategori tertentu</option><option value="PRODUCT">Produk tertentu</option></select></label>
          {voucherDraft.scope_type === 'CATEGORY'
            ? <label className="block"><span className="label">Kategori target</span><select className="input mt-1 w-full" value={voucherDraft.category_ids[0] ?? ''} onChange={(event) => patchVoucher({ category_ids: event.target.value ? [event.target.value] : [] })}><option value="">Pilih kategori</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.label}</option>)}</select></label>
            : voucherDraft.scope_type === 'PRODUCT'
              ? <label className="block"><span className="label">Produk target</span><select className="input mt-1 w-full" value={voucherDraft.product_ids[0] ?? ''} onChange={(event) => patchVoucher({ product_ids: event.target.value ? [event.target.value] : [] })}><option value="">Pilih produk</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select></label>
              : <div className="flex items-end text-xs text-slate-500">Berlaku untuk semua produk yang memenuhi ketentuan.</div>}
          <label className="block"><span className="label">Minimal pembelian</span><input className="input mt-1 w-full" type="number" min={0} step={1} value={voucherDraft.min_purchase} onChange={(event) => patchVoucher({ min_purchase: Number(event.target.value) })}/></label>
        </div>
        <div className="grid gap-3 lg:grid-cols-3">
          <label className="block"><span className="label">Mulai berlaku</span><input className="input mt-1 w-full" type="datetime-local" value={voucherDraft.starts_at} onChange={(event) => patchVoucher({ starts_at: event.target.value })} required/></label>
          <label className="block"><span className="label">Kedaluwarsa (opsional)</span><input className="input mt-1 w-full" type="datetime-local" value={voucherDraft.ends_at} onChange={(event) => patchVoucher({ ends_at: event.target.value })}/></label>
          <label className="flex items-end gap-2 pb-2 text-xs text-fg"><input type="checkbox" checked={voucherDraft.is_active} onChange={(event) => patchVoucher({ is_active: event.target.checked })}/>Aturan voucher aktif</label>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-800 pt-4">
          <Button size="sm" onClick={() => void saveVoucher()} disabled={busyVoucher} loading={busyVoucher} icon={<Save size={14}/>}>{voucherDraft.id ? 'Simpan aturan' : 'Buat voucher'}</Button>
          {voucherDraft.id && <Button size="sm" variant="outline" onClick={() => setVoucherDraft(emptyVoucher)} disabled={busyVoucher} icon={<X size={13}/>}>Batal edit</Button>}
        </div>

        <div className="grid gap-4 border-t border-slate-800 pt-5 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.85fr)]">
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2"><h5 className="text-xs font-semibold text-slate-200">Aturan voucher</h5><span className="text-[10px] text-slate-500">{voucherDefinitions.length} aturan</span></div>
            {voucherDefinitions.length ? <div className="space-y-2">
              {voucherDefinitions.map((definition) => <div key={definition.id} className="rounded-xl border border-slate-800 bg-slate-900/50 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-semibold text-slate-100">{definition.name}</p><Badge color={definition.is_active ? 'moss' : 'default'}>{definition.is_active ? 'Aktif' : 'Nonaktif'}</Badge></div>
                <div className="mt-1 flex flex-wrap gap-1.5 text-[10px] text-slate-400"><Badge color="info">{definition.usage_type === 'DURATION' ? definition.duration_hours + ' jam · berulang' : 'Sekali pakai'}</Badge><Badge>{benefitLabel(definition.benefit_group)}</Badge><span className="self-center font-semibold text-emerald-300">{voucherValueLabel(definition)}</span></div>
                <p className="mt-1 text-[10px] text-slate-500">{definition.scope_type === 'ALL' ? 'Semua produk' : definition.scope_type === 'PRODUCT' ? 'Produk tertentu' : 'Kategori tertentu'} · Minimum {definition.min_purchase.toLocaleString('id-ID')}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <button type="button" onClick={() => editVoucher(definition)} disabled={busyVoucher} className="rounded-lg border border-slate-700 p-1.5 text-slate-400 hover:text-sky-300" aria-label="Edit aturan voucher"><Pencil size={12}/></button>
                  <button type="button" onClick={() => void toggleVoucherDefinition(definition)} disabled={busyVoucher} className="rounded-lg border border-slate-700 px-2 py-1 text-[10px] text-slate-300 hover:text-amber-300">{definition.is_active ? 'Nonaktifkan' : 'Aktifkan'}</button>
                  {definition.is_active && <button type="button" onClick={() => setIssueDefinitionId(definition.id)} className="rounded-lg border border-emerald-500/20 px-2 py-1 text-[10px] text-emerald-300 hover:bg-emerald-500/10">Berikan ke pengguna</button>}
                </div>
              </div>)}
            </div> : <p className="rounded-xl border border-dashed border-slate-700 p-5 text-center text-xs text-slate-500">Belum ada aturan voucher.</p>}
          </div>
          <div className="space-y-3">
            <div><h5 className="text-xs font-semibold text-slate-200">Terbitkan voucher ke pengguna</h5><p className="mt-1 text-[10px] text-slate-500">Masukkan username pengguna yang menerima voucher ini.</p></div>
            <label className="block"><span className="label">Aturan voucher</span><select className="input mt-1 w-full" value={issueDefinitionId} onChange={(event) => setIssueDefinitionId(event.target.value)}><option value="">Pilih voucher aktif</option>{voucherDefinitions.filter((item) => item.is_active).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <label className="block"><span className="label">Username penerima</span><input className="input mt-1 w-full" value={issueUsername} onChange={(event) => setIssueUsername(event.target.value)} placeholder="@username"/></label>
            <Button size="sm" className="w-full" onClick={() => void issueVoucher()} loading={busyVoucher} disabled={busyVoucher || !issueDefinitionId || !issueUsername.trim()}>Berikan voucher</Button>
            <p className="text-[10px] leading-5 text-slate-500">Voucher durasi otomatis mulai menghitung saat diterbitkan. Voucher sekali pakai masuk ke koleksi dan baru dapat dipilih di Step 1 checkout.</p>
            <div className="border-t border-slate-800 pt-3">
              <h5 className="mb-2 text-xs font-semibold text-slate-200">Riwayat penerbitan terbaru</h5>
              {issuedVouchers.length ? <div className="max-h-64 space-y-1.5 overflow-y-auto">
                {issuedVouchers.slice(0,30).map((item) => <div key={item.id} className="flex items-center justify-between gap-2 rounded-lg bg-slate-900/50 px-2.5 py-2">
                  <div className="min-w-0"><p className="truncate text-[10px] font-semibold text-slate-200">{item.voucher_name}</p><p className="text-[9px] text-slate-500">@{item.username} · {new Date(item.issued_at).toLocaleDateString('id-ID')}</p></div>
                  <Badge color={item.status === 'ACTIVE' || item.status === 'READY' ? 'moss' : item.status === 'USED' ? 'info' : 'default'}>{voucherStatusLabel(item.status)}</Badge>
                </div>)}
              </div> : <p className="text-[10px] text-slate-500">Belum ada voucher yang diterbitkan.</p>}
            </div>
          </div>
        </div>
      </div>
    </Card>
    {(error || success) && <div className={'rounded-xl border px-3 py-2 text-xs ' + (error ? 'border-red-500/20 bg-red-500/5 text-red-300' : 'border-emerald-500/20 bg-emerald-500/5 text-emerald-300')}>{error || success}</div>}
    {loading && <div className="flex items-center justify-center gap-2 py-2 text-[10px] text-slate-500"><Loader2 size={12} className="animate-spin"/>Memuat pengaturan promo…</div>}
  </div>;
}
