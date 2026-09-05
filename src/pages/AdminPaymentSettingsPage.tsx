import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Banknote, ImagePlus, Plus, Trash2, UploadCloud, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { useApp } from '@/store/AppContext';
import { adminCreateOrganizerPaymentMethod, adminDeleteOrganizerPaymentMethod, listOrganizerPaymentMethods, type OrganizerPaymentMethod } from '@/services/commerce.service';
import { deleteImage, uploadImage } from '@/services/cloudinary.service';

const PAYMENT_TYPES = [
  ['BANK_TRANSFER', 'Bank Transfer'],
  ['QRIS', 'QRIS'],
  ['EWALLET', 'E-Wallet'],
  ['MIDTRANS', 'Midtrans'],
  ['SNAP', 'Snap / Payment Gateway'],
  ['OTHER', 'Lainnya'],
] as const;

type FormState = {
  paymentType: string;
  bankName: string;
  accountNumber: string;
  accountName: string;
  instructions: string;
  randomCodeEnabled: boolean;
  imageFile: File | null;
  imagePreview: string;
};

const EMPTY: FormState = {
  paymentType: 'BANK_TRANSFER', bankName: '', accountNumber: '', accountName: '', instructions: '', randomCodeEnabled: false, imageFile: null, imagePreview: '',
};

function typeLabel(type: string) {
  return PAYMENT_TYPES.find(([value]) => value === type)?.[1] ?? type;
}

function meta(method: OrganizerPaymentMethod) {
  return {
    bank: String(method.details?.bank_name ?? ''),
    account: String(method.details?.account_number ?? ''),
    name: String(method.details?.account_name ?? ''),
    instructions: String(method.details?.instructions ?? method.details?.text ?? ''),
    random: Boolean(method.details?.random_code_enabled),
  };
}

export function AdminPaymentSettingsPage() {
  const { toast } = useApp();
  const [methods, setMethods] = useState<OrganizerPaymentMethod[]>([]);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  async function load() {
    try {
      setMethods(await listOrganizerPaymentMethods());
    } catch (error: any) {
      toast(error?.message || 'Gagal memuat metode pembayaran.', 'error');
    }
  }

  useEffect(() => { void load(); }, []);

  function resetForm() {
    if (form.imagePreview) URL.revokeObjectURL(form.imagePreview);
    setForm(EMPTY);
    if (inputRef.current) inputRef.current.value = '';
  }

  function chooseImage(file?: File) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast('QRIS harus berupa gambar.', 'error');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast('Ukuran gambar maksimal 5MB.', 'error');
      return;
    }
    if (form.imagePreview) URL.revokeObjectURL(form.imagePreview);
    setForm((current) => ({ ...current, imageFile: file, imagePreview: URL.createObjectURL(file) }));
  }

  async function createMethod() {
    const type = form.paymentType.toUpperCase();
    if (type === 'BANK_TRANSFER' && (!form.bankName.trim() || !form.accountNumber.trim() || !form.accountName.trim())) {
      toast('Nama bank, nomor rekening, dan atas nama wajib diisi.', 'error');
      return;
    }
    if (type === 'QRIS' && !form.imageFile) {
      toast('Upload gambar QRIS terlebih dahulu.', 'error');
      return;
    }
    setBusy(true);
    let uploaded: any = null;
    try {
      if (form.imageFile) uploaded = await uploadImage(form.imageFile, { folder: 'sykabelajar/payment-methods' });
      const created = await adminCreateOrganizerPaymentMethod({
        name: typeLabel(type),
        paymentType: type,
        details: {
          bank_name: form.bankName.trim() || null,
          account_number: form.accountNumber.trim() || null,
          account_name: form.accountName.trim() || null,
          instructions: form.instructions.trim() || null,
          random_code_enabled: type === 'BANK_TRANSFER' && form.randomCodeEnabled,
        },
        sortOrder: methods.length + 1,
        imageUrl: uploaded?.secure_url ?? null,
        imagePublicId: uploaded?.public_id ?? null,
      });
      setMethods((current) => [...current, created]);
      toast(type === 'QRIS' ? 'QRIS dan gambar berhasil disimpan.' : 'Metode pembayaran berhasil ditambahkan.', 'success');
      resetForm();
      setOpen(false);
    } catch (error: any) {
      if (uploaded?.public_id) await deleteImage(uploaded.public_id, uploaded.resource_type || 'image').catch(() => undefined);
      toast(error?.message || 'Gagal menyimpan metode pembayaran.', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function removeMethod(method: OrganizerPaymentMethod) {
    if (!confirm(`Hapus ${method.name}?`)) return;
    setBusy(true);
    try {
      await adminDeleteOrganizerPaymentMethod(method.id);
      if (method.image_public_id) await deleteImage(method.image_public_id).catch(() => undefined);
      setMethods((current) => current.filter((item) => item.id !== method.id));
      toast('Metode pembayaran dihapus.', 'success');
    } catch (error: any) {
      toast(error?.message || 'Gagal menghapus metode pembayaran.', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen surface-bg px-4 py-6 text-fg-secondary md:px-8 md:py-9">
      <div className="mx-auto max-w-6xl space-y-5">
        <Link to="/admin" className="inline-flex items-center gap-2 text-xs text-fg-muted hover:text-fg"><ArrowLeft size={14}/> Kembali ke Control Center</Link>
        <header className="rounded-3xl border border-surface-border bg-surface-elevated/20 p-5 md:p-7">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-accent">Admin Commerce</p>
              <h1 className="mt-1 text-3xl font-bold text-fg">Metode Pembayaran</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-fg-muted">Atur metode pembayaran yang tampil pada checkout Organizer. Gambar QRIS disimpan sebagai media dan URL-nya dicatat pada Supabase.</p>
            </div>
            <Badge color="moss">{methods.length} aktif</Badge>
          </div>
        </header>

        {!open ? (
          <button type="button" onClick={() => setOpen(true)} className="flex w-full items-center justify-between rounded-2xl border border-dashed border-accent/40 bg-accent/5 p-5 text-left hover:bg-accent/10">
            <div className="flex items-center gap-3"><div className="rounded-xl bg-accent/10 p-2.5"><Plus size={18} className="text-accent"/></div><div><p className="font-semibold text-fg">Tambah metode pembayaran</p><p className="mt-1 text-xs text-fg-muted">Khusus QRIS, gambar wajib diupload sebelum disimpan.</p></div></div>
            <span className="text-xs font-semibold text-accent">Tambah →</span>
          </button>
        ) : (
          <Card className="p-5 md:p-7">
            <div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-accent">Metode baru</p><h2 className="mt-1 text-xl font-bold text-fg">Tambah pembayaran</h2></div><button type="button" onClick={() => { resetForm(); setOpen(false); }} className="rounded-lg p-2 text-fg-muted hover:bg-surface-elevated"><X size={16}/></button></div>
            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              <label className="text-xs font-medium text-fg-muted">Jenis pembayaran<select className="input mt-1 w-full" value={form.paymentType} onChange={(e) => setForm((v) => ({ ...v, paymentType: e.target.value, imageFile: e.target.value === 'QRIS' ? v.imageFile : v.imageFile, }))}>{PAYMENT_TYPES.map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              {form.paymentType === 'BANK_TRANSFER' && <><label className="text-xs font-medium text-fg-muted">Nama bank<input className="input mt-1 w-full" value={form.bankName} onChange={(e) => setForm((v) => ({ ...v, bankName: e.target.value }))} placeholder="BCA"/></label><label className="text-xs font-medium text-fg-muted">Nomor rekening<input className="input mt-1 w-full" value={form.accountNumber} onChange={(e) => setForm((v) => ({ ...v, accountNumber: e.target.value }))} placeholder="1234567890"/></label><label className="text-xs font-medium text-fg-muted">Atas nama<input className="input mt-1 w-full" value={form.accountName} onChange={(e) => setForm((v) => ({ ...v, accountName: e.target.value }))} placeholder="PT SykaBelajar Indonesia"/></label></>}
              <label className="text-xs font-medium text-fg-muted lg:col-span-2">Instruksi pembayaran<input className="input mt-1 w-full" value={form.instructions} onChange={(e) => setForm((v) => ({ ...v, instructions: e.target.value }))} placeholder="Instruksi yang akan muncul pada checkout"/></label>
              {form.paymentType === 'BANK_TRANSFER' && <label className="flex items-start gap-3 rounded-xl border border-accent/20 bg-accent/5 p-3 text-sm text-fg lg:col-span-2"><input type="checkbox" className="mt-0.5" checked={form.randomCodeEnabled} onChange={(e) => setForm((v) => ({ ...v, randomCodeEnabled: e.target.checked }))}/><span><strong className="block">Random 3 digit</strong><span className="text-xs text-fg-muted">Tambahkan kode unik pada nominal transfer.</span></span></label>}
              {form.paymentType === 'QRIS' && <div className="lg:col-span-2 rounded-2xl border-2 border-accent/40 bg-accent/5 p-5"><div className="flex items-start gap-3"><ImagePlus className="mt-0.5 text-accent" size={20}/><div><p className="font-bold text-fg">Gambar QRIS</p><p className="mt-1 text-xs leading-5 text-fg-muted">Upload QRIS yang akan ditampilkan ke user setelah user memilih metode QRIS.</p></div></div><input ref={inputRef} className="hidden" type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => chooseImage(e.target.files?.[0])}/><Button className="mt-4" size="sm" onClick={() => inputRef.current?.click()} icon={<UploadCloud size={15}/>}>{form.imageFile ? 'Ganti gambar QRIS' : 'Pilih gambar QRIS'}</Button>{form.imagePreview && <div className="mt-4 overflow-hidden rounded-2xl border border-surface-border bg-black/20 p-3"><img src={form.imagePreview} alt="Preview QRIS" className="mx-auto max-h-72 w-full object-contain"/></div>}</div>}
            </div>
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button variant="outline" disabled={busy} onClick={() => { resetForm(); setOpen(false); }}>Batal</Button><Button disabled={busy} loading={busy} onClick={() => void createMethod()} icon={<Plus size={15}/>}>Simpan Metode</Button></div>
          </Card>
        )}

        <div className="grid gap-4 md:grid-cols-2">{methods.map((method) => { const m = meta(method); const qr = String(method.payment_type).toUpperCase() === 'QRIS'; return <Card key={method.id} className="p-5"><div className="flex items-start gap-3"><div className="rounded-xl bg-accent/10 p-2.5"><Banknote size={18} className="text-accent"/></div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h2 className="font-bold text-fg">{method.name}</h2><Badge color="info">{typeLabel(String(method.payment_type).toUpperCase())}</Badge>{method.image_url && <Badge color="moss">Ada gambar</Badge>}</div>{m.bank && <p className="mt-3 text-sm font-semibold text-fg">{m.bank}</p>}{m.account && <p className="mt-1 font-mono text-sm text-fg">{m.account}</p>}{m.name && <p className="mt-1 text-xs text-fg-muted">a.n. {m.name}</p>}{m.instructions && <p className="mt-3 text-xs leading-5 text-fg-muted">{m.instructions}</p>}{m.random && <p className="mt-3 text-xs font-semibold text-accent">Random 3 digit aktif</p>}{qr && method.image_url && <div className="mt-4 rounded-2xl border border-surface-border bg-surface-elevated/25 p-3"><img src={method.image_url} alt="QRIS tersimpan" className="mx-auto max-h-64 w-full object-contain"/></div>}</div><button type="button" disabled={busy} onClick={() => void removeMethod(method)} className="rounded-lg p-2 text-red-400 hover:bg-red-500/10" title="Hapus"><Trash2 size={16}/></button></div></Card>})}</div>

        {!methods.length && <Card className="p-10 text-center"><Banknote size={26} className="mx-auto text-fg-muted"/><p className="mt-3 font-semibold text-fg">Belum ada metode pembayaran aktif</p><p className="mt-1 text-xs text-fg-muted">Tambahkan Bank Transfer atau QRIS dari panel di atas.</p></Card>}
      </div>
    </div>
  );
}
