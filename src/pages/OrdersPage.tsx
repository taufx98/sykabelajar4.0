import { useEffect, useMemo, useRef, useState } from 'react';
import { ShoppingBag, Package, Plus, Minus, Loader2, Upload, X, Coins, BadgeCheck, QrCode, GraduationCap, HeartHandshake, FileText, Sparkles, CreditCard, Copy } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { formatRupiah, formatShortDate } from '@/lib/utils';
import { createCollectiveCertificateOrderWithProof, createProductOrderWithEduCoin, createProductOrderWithProof, listActiveProducts, listOrganizerPaymentMethods, type CommerceProduct, type OrganizerPaymentMethod } from '@/services/commerce.service';
import { useApp } from '@/store/AppContext';
import { uploadImage } from '@/services/cloudinary.service';
import { createCheckoutPayment, getPublicPaymentGatewayStatus } from '@/services/payment.service';
import { supabase } from '@/lib/supabase';
import { listCurrentUserOrganizers, type CurrentOrganizer } from '@/services/organizerAuth.service';
import { getCollectiveCertificatePrice, listTeacherCollectiveParticipants, prepareCollectiveCertificate, type CollectiveParticipant } from '@/services/collectiveParticipant.service';

type BadgeOption = { id: string; name: string; icon_emoji: string | null; rarity: string };

function productTypeLabel(type: string) {
  const labels: Record<string, string> = {
    EDU_COIN_TOPUP: 'Paket Edu Coin',
    BADGE: 'Badge profil',
    CERTIFICATE_SERIALS: 'QR / Serial Sertifikat',
    COLLECTIVE_CERTIFICATE: 'Sertifikat peserta kolektif',
    DIGITAL_ITEM: 'Layanan / materi lomba',
    DONATION: 'Donasi',
  };
  return labels[type] ?? 'Produk SYKABELAJAR';
}

function productIcon(type: string) {
  if (type === 'EDU_COIN_TOPUP') return Coins;
  if (type === 'BADGE') return BadgeCheck;
  if (type === 'CERTIFICATE_SERIALS') return QrCode;
  if (type === 'COLLECTIVE_CERTIFICATE') return GraduationCap;
  if (type === 'DONATION') return HeartHandshake;
  return FileText;
}

function productBenefit(product: CommerceProduct, badges: Map<string, BadgeOption>) {
  const metadata = product.metadata ?? {};
  if (product.product_type === 'EDU_COIN_TOPUP') return `+${Number(metadata.coin_amount ?? 0).toLocaleString('id-ID')} Edu Coin setelah pembayaran disetujui`;
  if (product.product_type === 'BADGE') {
    const badge = badges.get(String(metadata.badge_id ?? ''));
    return badge ? `${badge.icon_emoji ? badge.icon_emoji + ' ' : ''}${badge.name} · ${badge.rarity}` : 'Badge profil SYKABELAJAR';
  }
  if (product.product_type === 'CERTIFICATE_SERIALS') return `${Number(metadata.serial_quantity ?? 0).toLocaleString('id-ID')} QR / Serial sertifikat untuk organisasi pilihanmu`;
  if (product.product_type === 'COLLECTIVE_CERTIFICATE') return 'Untuk peserta kolektif yang sudah menyelesaikan lomba dan memenuhi syarat sertifikat';
  if (product.product_type === 'DONATION') return 'Dukungan untuk kegiatan dan pengembangan SYKABELAJAR';
  return product.short_description || product.description || 'Penunjang kegiatan belajar dan lomba';
}

function productErrorMessage(error: unknown) {
  const message = String((error as { message?: string } | null)?.message ?? '');
  if (message.includes('PRODUCT_NOT_AVAILABLE')) return 'Produk ini tidak tersedia untuk akunmu atau sudah tidak bisa dipesan.';
  if (message.includes('PRODUCT_TYPE_NOT_SUPPORTED')) return 'Jenis produk ini belum bisa dipesan melalui Shop.';
  if (message.includes('INSUFFICIENT_EDU_COIN')) return 'Saldo Edu Coin tidak mencukupi untuk pembelian ini.';
  if (message.includes('PRODUCT_CURRENCY_NOT_SUPPORTED')) return 'Produk ini tidak mendukung pembayaran Edu Coin.';
  if (message.includes('INVALID_QUANTITY')) return 'Jumlah paket tidak valid.';
  if (message.includes('PAYMENT_PROOF_REQUIRED')) return 'Unggah bukti pembayaran sebelum mengirim pesanan.';
  if (message.includes('WHATSAPP_REQUIRED')) return 'Nomor WhatsApp wajib diisi.';
  if (message.includes('BADGE_ALREADY_OWNED')) return 'Badge ini sudah ada di koleksimu.';
  if (message.includes('ORGANIZER_REQUIRED')) return 'Pilih organisasi yang akan menerima QR / Serial sertifikat.';
  if (message.includes('ORGANIZER_ACCESS_DENIED')) return 'Kamu tidak memiliki akses ke organisasi yang dipilih.';
  if (message.includes('SERIAL_QUANTITY_INVALID')) return 'Jumlah QR / Serial pada paket belum valid.';
  if (message.includes('RESULT_NOT_FINALIZED')) return 'Peserta belum menyelesaikan lomba. Sertifikat belum bisa dipesan.';
  if (message.includes('RESULT_NOT_PUBLISHED')) return 'Hasil lomba belum diumumkan. Sertifikat belum bisa dipesan.';
  if (message.includes('CERTIFICATE_PRICE_NOT_CONFIGURED')) return 'Harga sertifikat peserta belum diatur oleh admin.';
  if (message.includes('CERTIFICATE_PAYMENT_ALREADY_SUBMITTED')) return 'Bukti pembayaran sertifikat ini sudah dikirim.';
  return message || 'Pesanan belum berhasil diproses. Coba lagi.';
}

function statusLabel(status: string) {
  const value = status.toUpperCase();
  if (value === 'PAID') return 'Selesai';
  if (value === 'CANCELLED' || value === 'CANCELED' || value === 'REFUNDED') return 'Dibatalkan';
  if (value === 'PROCESSING') return 'Sedang diproses';
  if (value === 'COMPLETED') return 'Selesai';
  return 'Menunggu verifikasi';
}

export function OrdersPage() {
  const { user } = useApp();
  const [products, setProducts] = useState<CommerceProduct[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [selected, setSelected] = useState<CommerceProduct | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [paymentMethods, setPaymentMethods] = useState<OrganizerPaymentMethod[]>([]);
  const [gatewayStatus, setGatewayStatus] = useState<Awaited<ReturnType<typeof getPublicPaymentGatewayStatus>> | null>(null);
  const [gatewayPaymentResult, setGatewayPaymentResult] = useState<Awaited<ReturnType<typeof createCheckoutPayment>> | null>(null);
  const [gatewayPaymentError, setGatewayPaymentError] = useState('');
  const [pendingGatewayOrderId, setPendingGatewayOrderId] = useState('');
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [proofPreview, setProofPreview] = useState('');
  const [organizers, setOrganizers] = useState<CurrentOrganizer[]>([]);
  const [selectedOrganizerId, setSelectedOrganizerId] = useState('');
  const [participants, setParticipants] = useState<CollectiveParticipant[]>([]);
  const [selectedParticipantId, setSelectedParticipantId] = useState('');
  const [certificatePrice, setCertificatePrice] = useState<number | null>(null);
  const [ownedBadgeIds, setOwnedBadgeIds] = useState<Set<string>>(new Set());
  const [badgeOptions, setBadgeOptions] = useState<Map<string, BadgeOption>>(new Map());
  const [eduCoinBalance, setEduCoinBalance] = useState<number | null>(null);
  const proofRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!proofFile) {
      setProofPreview('');
      return;
    }
    const url = URL.createObjectURL(proofFile);
    setProofPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [proofFile]);

  const load = async () => {
    setLoading(true);
    try {
      const [{ data: session }, catalog, gateway, configuredMethods] = await Promise.all([
        supabase.auth.getSession(),
        listActiveProducts(),
        getPublicPaymentGatewayStatus().catch(() => null),
        listOrganizerPaymentMethods().catch(() => [] as OrganizerPaymentMethod[]),
      ]);
      setGatewayStatus(gateway);
      setPaymentMethods(configuredMethods);
      const globalMethod = configuredMethods.find((method) => method.details?.global_gateway === true);
      const usableManualMethods = configuredMethods.filter((method) => ['BANK_TRANSFER', 'MANUAL_TRANSFER', 'QRIS', 'EWALLET'].includes(String(method.payment_type).trim().toUpperCase()));
      setPaymentMethod((current) => {
        if (current && configuredMethods.some((method) => method.id === current) && (current !== globalMethod?.id || gateway?.checkoutEnabled)) return current;
        if (gateway?.checkoutEnabled && globalMethod) return globalMethod.id;
        return usableManualMethods[0]?.id ?? '';
      });
      const role = String(user?.role ?? 'pelajar');
      const audience = role === 'guru' ? 'teacher' : role === 'penyelenggara' ? 'organizer' : 'student';
      const visible = catalog.filter((product) => role === 'admin' || (Array.isArray(product.audiences) && product.audiences.includes(audience)));
      setProducts(visible);

      if (session.session?.user) {
        const userId = session.session.user.id;
        const [{ data: orderData, error: orderError }, { data: ownedBadges, error: badgeError }, { data: wallet, error: walletError }] = await Promise.all([
          supabase.from('orders').select('*,order_items(*)').eq('user_id', userId).order('created_at', { ascending: false }).limit(100),
          supabase.from('user_badges').select('badge_id').eq('user_id', userId),
          supabase.from('profiles').select('edu_coin').eq('id', userId).maybeSingle(),
        ]);
        if (orderError) throw orderError;
        if (badgeError) throw badgeError;
        if (walletError) throw walletError;
        setOrders(orderData ?? []);
        setOwnedBadgeIds(new Set((ownedBadges ?? []).map((row: any) => String(row.badge_id))));
        setEduCoinBalance(Number(wallet?.edu_coin ?? 0));
      } else {
        setOrders([]);
        setOwnedBadgeIds(new Set());
        setEduCoinBalance(null);
      }

      const badgeIds = [...new Set(visible.filter((p) => p.product_type === 'BADGE').map((p) => String(p.metadata?.badge_id ?? '')).filter(Boolean))];
      if (badgeIds.length) {
        const { data, error: badgeCatalogError } = await supabase.from('badges').select('id,name,icon_emoji,rarity').in('id', badgeIds);
        if (badgeCatalogError) throw badgeCatalogError;
        setBadgeOptions(new Map((data ?? []).map((row: any) => [String(row.id), row as BadgeOption])));
      } else {
        setBadgeOptions(new Map());
      }

      if (role === 'penyelenggara' || role === 'admin') {
        try {
          const managed = await listCurrentUserOrganizers();
          setOrganizers(managed);
          setSelectedOrganizerId((current) => current && managed.some((org) => org.id === current) ? current : (managed[0]?.id ?? ''));
        } catch {
          setOrganizers([]);
          setSelectedOrganizerId('');
        }
      } else {
        setOrganizers([]);
        setSelectedOrganizerId('');
      }

      if (role === 'guru' && visible.some((product) => product.product_type === 'COLLECTIVE_CERTIFICATE')) {
        try {
          const [rows, price] = await Promise.all([listTeacherCollectiveParticipants(), getCollectiveCertificatePrice()]);
          setParticipants(rows.filter((row) => row.attempt_status === 'FINALIZED'));
          setCertificatePrice(price);
        } catch {
          setParticipants([]);
          setCertificatePrice(null);
        }
      } else {
        setParticipants([]);
        setCertificatePrice(null);
        setSelectedParticipantId('');
      }
    } catch (loadError) {
      setError(productErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [user?.role]);

  const isQuantityPackage = selected ? ['EDU_COIN_TOPUP', 'DIGITAL_ITEM', 'DONATION'].includes(selected.product_type) : false;
  const displayPrice = (product: CommerceProduct) => product.product_type === 'COLLECTIVE_CERTIFICATE'
    ? Number(certificatePrice ?? 0)
    : Number(product.price ?? 0);
  const isEduCoinCheckout = selected?.currency === 'EDU_COIN';
  const selectedPaymentMethod = paymentMethods.find((method) => method.id === paymentMethod) ?? null;
  const usablePaymentMethods = paymentMethods.filter((method) => method.details?.global_gateway === true || ['BANK_TRANSFER', 'MANUAL_TRANSFER', 'QRIS', 'EWALLET'].includes(String(method.payment_type).trim().toUpperCase()));
  const isGlobalGatewayCheckout = !isEduCoinCheckout && selectedPaymentMethod?.details?.global_gateway === true;
  const checkoutQuantity = selected && isQuantityPackage ? quantity : 1;
  const checkoutTotal = selected ? displayPrice(selected) * checkoutQuantity : 0;
  const formatProductPrice = (price: number, currency: string) => currency === 'EDU_COIN'
    ? `${Number(price).toLocaleString('id-ID')} Edu Coin`
    : formatRupiah(price);
  const needsWhatsapp = Boolean(selected && (!isEduCoinCheckout || ['DIGITAL_ITEM', 'DONATION'].includes(selected.product_type)));
  const selectedBadgeId = selected?.product_type === 'BADGE' ? String(selected.metadata.badge_id ?? '') : '';
  const ownsSelectedBadge = Boolean(selectedBadgeId && ownedBadgeIds.has(selectedBadgeId));
  const selectedNeedsOrganizer = selected?.product_type === 'CERTIFICATE_SERIALS';
  const selectedNeedsParticipant = selected?.product_type === 'COLLECTIVE_CERTIFICATE';
  const eligibleParticipants = useMemo(() => participants.filter((row) => row.attempt_status === 'FINALIZED'), [participants]);

  const chooseProof = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/') || file.size > 5 * 1024 * 1024) {
      setError('Bukti pembayaran harus berupa gambar maksimal 5 MB.');
      event.target.value = '';
      return;
    }
    setProofFile(file);
    event.target.value = '';
    setError('');
  };

  const close = () => {
    if (submitting) return;
    setSelected(null);
    setQuantity(1);
    setProofFile(null);
    setProofPreview('');
    setWhatsapp('');
    setSelectedParticipantId('');
    setError('');
  };

  const submit = async () => {
    if (!selected) return;
    if (selected.product_type === 'BADGE' && ownsSelectedBadge) {
      setError('Badge ini sudah ada di koleksimu.');
      return;
    }
    if (selectedNeedsOrganizer && !selectedOrganizerId) {
      setError('Pilih organisasi yang akan menerima QR / Serial sertifikat.');
      return;
    }
    if (selectedNeedsParticipant && !selectedParticipantId) {
      setError('Pilih peserta yang sudah menyelesaikan lomba.');
      return;
    }
    if (isEduCoinCheckout) {
      if (!['DIGITAL_ITEM', 'DONATION', 'BADGE', 'CERTIFICATE_SERIALS'].includes(selected.product_type)) {
        setError('Jenis produk ini tidak mendukung pembayaran Edu Coin.');
        return;
      }
      if (['DIGITAL_ITEM', 'DONATION'].includes(selected.product_type) && !whatsapp.trim()) {
        setError('Nomor WhatsApp wajib diisi untuk produk yang diproses tim.');
        return;
      }
      setSubmitting(true);
      setError('');
      setMessage('');
      try {
        const order = await createProductOrderWithEduCoin({
          productId: selected.id,
          quantity: checkoutQuantity,
          whatsapp,
          targetOrganizerId: selectedNeedsOrganizer ? selectedOrganizerId : null,
        });
        const orderReference = String(order?.id ?? '').slice(0, 8);
        const purchasedName = selected.name;
        setSelected(null);
        setQuantity(1);
        setProofFile(null);
        setProofPreview('');
        setWhatsapp('');
        setSelectedParticipantId('');
        setError('');
        setMessage(`Pembelian ${orderReference ? `#${orderReference}` : ''} untuk “${purchasedName}” berhasil dibayar dengan Edu Coin. Saldo sudah dipotong otomatis oleh sistem.`);
        await load();
      } catch (checkoutError) {
        setError(productErrorMessage(checkoutError));
      } finally {
        setSubmitting(false);
      }
      return;
    }
    if (!isEduCoinCheckout && !selectedPaymentMethod) {
      setError('Belum ada metode pembayaran yang aktif. Periksa pengaturan pembayaran admin.');
      return;
    }
    if (isGlobalGatewayCheckout && !gatewayStatus?.checkoutEnabled) {
      setError('Pembayaran otomatis sedang tidak tersedia. Pilih metode manual yang diaktifkan admin.');
      return;
    }
    if (!isGlobalGatewayCheckout && !proofFile) {
      setError('Unggah bukti pembayaran sebelum mengirim pesanan.');
      return;
    }
    if (!whatsapp.trim()) {
      setError('Nomor WhatsApp wajib diisi.');
      return;
    }
    if (selectedNeedsParticipant && !(Number(certificatePrice) > 0)) {
      setError('Harga sertifikat belum diatur. Hubungi admin atau periksa pengaturan sertifikat peserta.');
      return;
    }

    setSubmitting(true);
    setError('');
    setMessage('');
    try {
      const upload = isGlobalGatewayCheckout ? null : await uploadImage(proofFile!, `sykabelajar/payment-proofs/${selected.id}`);
      const paymentMethodValue = isGlobalGatewayCheckout ? 'GATEWAY_GLOBAL' : `METHOD:${selectedPaymentMethod!.id}`;
      let order: any;
      if (selectedNeedsParticipant) {
        const participant = eligibleParticipants.find((row) => row.participant_id === selectedParticipantId);
        if (!participant) throw new Error('Peserta yang dipilih tidak lagi memenuhi syarat untuk sertifikat.');
        const prepared = await prepareCollectiveCertificate(participant.participant_id);
        const certificate = Array.isArray(prepared) ? prepared[0] : prepared;
        if (!certificate || typeof certificate !== 'object' || !('id' in certificate)) {
          throw new Error('Sertifikat belum bisa disiapkan. Pastikan hasil lomba sudah diumumkan.');
        }
        order = await createCollectiveCertificateOrderWithProof({
          certificateId: String((certificate as Record<string, unknown>).id),
          paymentMethod: paymentMethodValue,
          proofUrl: upload?.secure_url ?? null,
          proofPublicId: upload?.public_id,
          proofWidth: upload?.width,
          proofHeight: upload?.height,
          proofVersion: upload?.version?.toString(),
          proofResourceType: upload?.resource_type,
          whatsapp,
        });
      } else {
        order = await createProductOrderWithProof({
          productId: selected.id,
          quantity: isQuantityPackage ? quantity : 1,
          whatsapp,
          paymentMethod: paymentMethodValue,
          proofUrl: upload?.secure_url ?? null,
          proofPublicId: upload?.public_id,
          proofWidth: upload?.width,
          proofHeight: upload?.height,
          proofVersion: upload?.version?.toString(),
          proofResourceType: upload?.resource_type,
          targetOrganizerId: selectedNeedsOrganizer ? selectedOrganizerId : null,
        });
      }
      const orderReference = String(order?.id ?? '').slice(0, 8);
      if (isGlobalGatewayCheckout) {
        const orderId = String(order?.id ?? '');
        if (!orderId) throw new Error('Order tersimpan tetapi ID pesanan tidak terbaca. Hubungi admin.');
        setPendingGatewayOrderId(orderId);
        try {
          const payment = await createCheckoutPayment(orderId);
          setGatewayPaymentResult(payment);
          setGatewayPaymentError('');
          setPendingGatewayOrderId('');
          if (payment.redirect_url) { window.location.assign(payment.redirect_url); return; }
          setMessage(`Pesanan #${orderReference} siap dibayar melalui ${gatewayStatus?.providerName || payment.provider}.`);
        } catch (gatewayError: any) {
          const detail = gatewayError?.message || 'Sesi pembayaran belum berhasil dibuat.';
          setGatewayPaymentError(detail);
          setMessage(`Pesanan #${orderReference} sudah tersimpan. Buat ulang sesi pembayaran menggunakan tombol di bawah—jangan membuat order baru.`);
          setSelected(null);
          setQuantity(1);
          setProofFile(null);
          setProofPreview('');
          setWhatsapp('');
          setSelectedParticipantId('');
          await load();
          return;
        }
      } else {
        setGatewayPaymentResult(null);
        setMessage(`Pesanan ${orderReference ? `#${orderReference}` : ''} berhasil dikirim. Tim SYKABELAJAR akan memeriksa pembayaran sebelum manfaat diberikan.`);
      }
      setSelected(null);
      setQuantity(1);
      setProofFile(null);
      setProofPreview('');
      setWhatsapp('');
      setSelectedParticipantId('');
      setError('');
      await load();
    } catch (checkoutError) {
      setError(productErrorMessage(checkoutError));
    } finally {
      setSubmitting(false);
    }
  };

  const retryGatewayPayment = async () => {
    if (!pendingGatewayOrderId || submitting) return;
    setSubmitting(true);
    setGatewayPaymentError('');
    try {
      const payment = await createCheckoutPayment(pendingGatewayOrderId);
      setGatewayPaymentResult(payment);
      setPendingGatewayOrderId('');
      if (payment.redirect_url) { window.location.assign(payment.redirect_url); return; }
      setMessage('Instruksi pembayaran otomatis sudah siap. Selesaikan pembayaran menggunakan kode di bawah.');
      await load();
    } catch (gatewayError: any) {
      setGatewayPaymentError(gatewayError?.message || 'Sesi pembayaran belum berhasil dibuat.');
    } finally { setSubmitting(false); }
  };

  const statusLabelForOrder = (order: any) => {
    const status = String(order.status ?? '').toUpperCase();
    if (status === 'PAID') {
      const type = order.order_items?.[0]?.product_type;
      return String(order.order_items?.[0]?.product_ref ?? '') === 'COLLECTIVE_CERTIFICATE' ? 'Sertifikat diterbitkan' : ['DIGITAL_ITEM', 'DONATION'].includes(String(type)) ? 'Terverifikasi' : 'Manfaat diberikan';
    }
    if (status === 'CANCELLED' || status === 'CANCELED' || status === 'REFUNDED') return 'Ditolak / dibatalkan';
    return 'Menunggu verifikasi admin';
  };

  const itemTitle = (order: any) => {
    const item = Array.isArray(order.order_items) ? order.order_items[0] : order.order_items;
    return item?.name ?? `Pesanan #${String(order.id ?? '').slice(0, 8)}`;
  };

  return <div>
    <div className="sticky top-0 z-20 glass border-b surface-border px-4 py-3">
      <h2 className="font-display font-bold text-lg text-fg">Shop & Pesanan</h2>
      <p className="text-xs text-slate-500">Produk dan layanan penunjang lomba SYKABELAJAR. Produk berharga Rupiah diverifikasi admin; pembayaran Edu Coin diproses otomatis oleh sistem.</p>
    </div>
    <div className="p-4 space-y-6">
      {error && <Card className="p-3 border-red-500/20 text-sm text-red-300">{error}</Card>}
      {message && <Card className="p-3 border-moss-500/20 text-sm text-accent">{message}</Card>}{gatewayPaymentError && <Card className="border-amber-500/20 bg-amber-500/5 p-4"><div className="flex items-start gap-3"><CreditCard size={18} className="mt-0.5 text-amber-300"/><div className="min-w-0 flex-1"><p className="text-sm font-semibold text-fg">Sesi pembayaran otomatis belum siap</p><p className="mt-1 break-words text-xs leading-5 text-fg-muted">{gatewayPaymentError}</p><Button size="sm" className="mt-3" loading={submitting} disabled={submitting||!pendingGatewayOrderId} onClick={()=>void retryGatewayPayment()}>Coba buat sesi lagi</Button></div></div></Card>}{gatewayPaymentResult && !gatewayPaymentResult.redirect_url && <Card className="border-accent/20 p-4"><div className="flex items-start gap-3"><CreditCard size={18} className="mt-0.5 text-accent"/><div className="min-w-0 flex-1"><p className="text-sm font-semibold text-fg">Instruksi pembayaran · {gatewayStatus?.providerName||gatewayPaymentResult.provider}</p><p className="mt-1 text-xs leading-5 text-fg-muted">Status pesanan akan diperbarui otomatis setelah webhook provider tervalidasi.</p>{gatewayPaymentResult.payment_code&&<div className="mt-3 rounded-xl border border-surface-border bg-surface-elevated/25 p-3"><p className="text-[10px] font-bold uppercase tracking-wider text-fg-muted">{gatewayPaymentResult.payment_code_type||'Kode pembayaran'}</p><div className="mt-1 flex items-center justify-between gap-2"><p className="break-all font-mono text-lg font-bold text-fg">{gatewayPaymentResult.payment_code}</p><button type="button" className="rounded-lg border border-surface-border p-2 text-fg-muted hover:text-fg" onClick={()=>{void navigator.clipboard?.writeText(String(gatewayPaymentResult.payment_code));setMessage('Kode pembayaran disalin.')}} aria-label="Salin kode pembayaran"><Copy size={14}/></button></div></div>}</div></div></Card>}
      <section>
        <div className="flex items-center justify-between mb-3">
          <div><p className="text-xs text-accent font-semibold">SHOP SYKABELAJAR</p><h3 className="font-display text-xl font-bold text-fg">Manfaat dan layanan</h3></div>
          {loading && <Loader2 size={16} className="animate-spin text-slate-500"/>}
        </div>
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {products.map((product) => {
            const Icon = productIcon(product.product_type);
            const price = displayPrice(product);
            const badgeId = product.product_type === 'BADGE' ? String(product.metadata.badge_id ?? '') : '';
            const alreadyOwned = Boolean(badgeId && ownedBadgeIds.has(badgeId));
            const unavailableCertificatePrice = product.product_type === 'COLLECTIVE_CERTIFICATE' && price <= 0;
            const needsOrganizer = product.product_type === 'CERTIFICATE_SERIALS';
            const cannotBuySerials = needsOrganizer && organizers.length === 0;
            return <Card key={product.id} className="overflow-hidden border surface-border">
              {product.image_url && <img src={product.image_url} alt={product.name} loading="lazy" className="w-full aspect-[16/8] object-cover"/>}
              <div className="p-4">
                <div className="flex items-start gap-3">
                  <div className="rounded-xl bg-accent/10 p-2 text-accent"><Icon size={18}/></div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap gap-1.5 items-center"><p className="text-sm font-semibold text-fg">{product.name}</p>{product.is_featured && <Badge color="moss"><Sparkles size={10} className="mr-1 inline"/>Pilihan</Badge>}</div>
                    <p className="text-xs text-fg-muted mt-1">{productTypeLabel(product.product_type)}</p>
                  </div>
                </div>
                <p className="text-sm text-slate-500 mt-3">{productBenefit(product, badgeOptions)}</p>
                <p className="text-lg font-bold text-accent mt-3">{unavailableCertificatePrice ? 'Harga belum diatur' : formatProductPrice(price, product.currency)}</p>
                <Button size="sm" fullWidth className="mt-3 w-full" disabled={alreadyOwned || unavailableCertificatePrice || cannotBuySerials} onClick={() => { setSelected(product); setQuantity(1); setProofFile(null); setProofPreview(''); setSelectedParticipantId(''); setError(''); setPaymentMethod(gatewayStatus?.checkoutEnabled ? 'GATEWAY_GLOBAL' : 'BANK_TRANSFER'); }}>
                  {alreadyOwned ? 'Sudah dimiliki' : unavailableCertificatePrice ? 'Belum tersedia' : cannotBuySerials ? 'Butuh organisasi aktif' : 'Pilih & pesan'}
                </Button>
              </div>
            </Card>;
          })}
          {!loading && !products.length && <Card className="p-8 text-center col-span-full text-sm text-slate-500">Belum ada manfaat lomba aktif di Shop. Produk baru akan tampil di sini setelah admin mengaktifkannya.</Card>}
        </div>
      </section>

      <section>
        <div className="flex items-center gap-2 mb-3"><ShoppingBag size={17} className="text-accent"/><h3 className="font-display text-xl font-bold text-fg">Riwayat pesanan</h3></div>
        <div className="space-y-2">
          {orders.map((order) => <Card key={order.id} className="p-4">
            <div className="flex flex-col md:flex-row md:items-center gap-3">
              <Package size={18} className="text-accent"/>
              <div className="flex-1 min-w-0"><p className="text-sm text-fg">{itemTitle(order)}</p><p className="text-xs text-slate-500">{formatShortDate(order.created_at)} · Pesanan #{String(order.id).slice(0, 8)}</p></div>
              <b className="text-fg">{formatProductPrice(Number(order.total || 0), String(order.currency ?? 'IDR'))}</b><Badge>{statusLabelForOrder(order)}</Badge>
            </div>
          </Card>)}
          {!loading && !orders.length && <Card className="p-6 text-center text-sm text-slate-500">Belum ada pesanan. Pesanan akan tercatat setelah pembayaran manual dikirim atau pembayaran Edu Coin diproses oleh sistem.</Card>}
        </div>
      </section>
    </div>

    {selected && <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
      <Card className="w-full max-w-lg p-5 max-h-[92vh] overflow-auto">
        <div className="flex items-center justify-between gap-3">
          <div><h3 className="font-display text-lg font-bold text-fg">Konfirmasi pesanan</h3><p className="text-sm text-slate-400 mt-1">{selected.name}</p></div>
          <button onClick={close} disabled={submitting} className="p-2 rounded-lg hover:bg-white/5 text-slate-400" aria-label="Tutup"><X size={18}/></button>
        </div>
        <p className="mt-3 text-sm text-fg-muted">{productBenefit(selected, badgeOptions)}</p>

        {isQuantityPackage && <div className="flex items-center justify-between mt-5">
          <span className="text-sm text-slate-400">Jumlah paket</span>
          <div className="flex items-center gap-3">
            <button className="w-8 h-8 rounded-lg surface-elevated text-white" onClick={() => setQuantity((value) => Math.max(1, value - 1))} disabled={submitting}><Minus size={14} className="mx-auto"/></button>
            <span className="w-6 text-center text-fg">{quantity}</span>
            <button className="w-8 h-8 rounded-lg surface-elevated text-white" onClick={() => setQuantity((value) => Math.min(100, value + 1))} disabled={submitting || quantity >= 100}><Plus size={14} className="mx-auto"/></button>
          </div>
        </div>}

        {selectedNeedsOrganizer && <label className="block mt-4">
          <span className="label">Organisasi penerima QR / Serial <span className="text-red-400">*</span></span>
          <select className="input mt-1 w-full" value={selectedOrganizerId} onChange={(event) => setSelectedOrganizerId(event.target.value)} disabled={submitting} required>
            <option value="">Pilih organisasi yang kamu kelola</option>
            {organizers.map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}
          </select>
          <span className="mt-1 block text-xs text-fg-muted">Serial masuk ke inventaris organisasi dan dapat dipasangkan ke sertifikat yang sesuai.</span>
        </label>}

        {selectedNeedsParticipant && <label className="block mt-4">
          <span className="label">Peserta yang akan menerima sertifikat <span className="text-red-400">*</span></span>
          <select className="input mt-1 w-full" value={selectedParticipantId} onChange={(event) => setSelectedParticipantId(event.target.value)} disabled={submitting} required>
            <option value="">Pilih peserta dengan hasil selesai</option>
            {eligibleParticipants.map((participant) => <option key={participant.participant_id} value={participant.participant_id}>{participant.full_name} · {participant.competition_title}</option>)}
          </select>
          <span className="mt-1 block text-xs text-fg-muted">Sistem akan mengecek ulang kelayakan peserta dan status pengumuman hasil di backend.</span>
        </label>}

        {needsWhatsapp && <label className="block mt-4"><span className="label">Nomor WhatsApp <span className="text-red-400">*</span></span><input className="input mt-1 w-full" placeholder="Contoh: 08xxxxxxxxxx" value={whatsapp} onChange={(event) => setWhatsapp(event.target.value)} disabled={submitting} required={needsWhatsapp}/><span className="mt-1 block text-xs text-fg-muted">{isEduCoinCheckout ? 'Dipakai tim untuk tindak lanjut produk ini; tidak ada bukti transfer.' : 'Digunakan untuk koordinasi pesanan jika diperlukan.'}</span></label>}
        {isEduCoinCheckout
          ? <div className="mt-4 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3">
              <div className="flex items-center justify-between gap-3"><span className="text-sm text-fg-muted">Saldo Edu Coin</span><span className="font-semibold text-fg">{eduCoinBalance == null ? 'Tidak tersedia' : eduCoinBalance.toLocaleString('id-ID') + ' Edu Coin'}</span></div>
              <div className="mt-2 flex items-center justify-between gap-3"><span className="text-sm text-fg-muted">Total pembayaran</span><span className="font-bold text-accent">{formatProductPrice(checkoutTotal, 'EDU_COIN')}</span></div>
              {eduCoinBalance != null && eduCoinBalance < checkoutTotal && <p className="mt-2 text-xs text-red-300">Saldo tidak mencukupi. Isi saldo Edu Coin terlebih dahulu.</p>}
              <p className="mt-2 text-xs leading-5 text-fg-muted">Tidak perlu bukti transfer. Backend mengecek harga dan saldo terbaru, lalu memotong koin serta mencatat transaksi secara bersamaan. Saldo yang terlihat di sini hanya informasi; server tetap memvalidasi ulang saat pembayaran.</p>
            </div>
          : <>
              <label className="block mt-3"><span className="label">Metode pembayaran</span><select className="input mt-1 w-full" value={paymentMethod} onChange={(event) => { setPaymentMethod(event.target.value); setProofFile(null); }} disabled={submitting}><option value="">Pilih metode pembayaran</option>{usablePaymentMethods.filter((method) => method.details?.global_gateway !== true || gatewayStatus?.checkoutEnabled).map((method) => <option key={method.id} value={method.id}>{method.name} · {method.details?.global_gateway === true ? (gatewayStatus?.providerName || 'Gateway Global') : String(method.payment_type).replaceAll('_', ' ')}</option>)}</select></label>
              {isGlobalGatewayCheckout ? <div className="mt-4 rounded-xl border border-accent/20 bg-accent/5 p-3"><p className="text-sm font-semibold text-fg">Pembayaran otomatis · {gatewayStatus?.providerName || 'Gateway Global'}</p><p className="mt-1 text-xs leading-5 text-fg-muted">Provider mengikuti pengaturan admin. Tidak perlu upload bukti transfer; status pesanan akan diperbarui setelah callback provider tervalidasi.</p></div> : selectedPaymentMethod ? <div className="mt-4 rounded-xl border surface-border p-3"><p className="text-sm font-semibold text-fg">{selectedPaymentMethod.name}</p>{selectedPaymentMethod.details?.bank_name && <p className="mt-1 text-xs text-fg-muted">Bank: <span className="text-fg">{String(selectedPaymentMethod.details.bank_name)}</span></p>}{selectedPaymentMethod.details?.account_number && <p className="mt-1 text-xs text-fg-muted">Nomor rekening: <span className="font-mono text-fg">{String(selectedPaymentMethod.details.account_number)}</span></p>}{selectedPaymentMethod.details?.account_name && <p className="mt-1 text-xs text-fg-muted">Atas nama: <span className="text-fg">{String(selectedPaymentMethod.details.account_name)}</span></p>}{typeof selectedPaymentMethod.details?.instructions === 'string' && selectedPaymentMethod.details.instructions && <p className="mt-2 whitespace-pre-line text-xs leading-5 text-fg-muted">{selectedPaymentMethod.details.instructions}</p>}{(selectedPaymentMethod.image_url || (typeof selectedPaymentMethod.details?.image_url === 'string' ? selectedPaymentMethod.details.image_url : '')) && <img src={selectedPaymentMethod.image_url || String(selectedPaymentMethod.details.image_url)} alt={selectedPaymentMethod.name} className="mt-3 max-h-48 rounded-lg object-contain"/>}<div className="mt-4"><span className="label">Bukti pembayaran <span className="text-red-400">*</span></span><p className="text-xs text-fg-muted mt-1">Unggah bukti transfer yang menampilkan nominal dan status pembayaran.</p><label className="mt-2 flex items-center gap-2 input cursor-pointer"><Upload size={15}/><span>{proofFile ? 'Ganti bukti pembayaran' : 'Pilih gambar bukti'}</span><input ref={proofRef} type="file" accept="image/*" className="sr-only" onChange={chooseProof} disabled={submitting}/></label>{proofPreview && <img src={proofPreview} alt="Pratinjau bukti pembayaran" className="mt-3 w-full max-h-48 object-contain rounded-xl border surface-border"/>}</div></div> : <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-xs leading-5 text-fg-muted">Belum ada metode pembayaran yang aktif. Admin perlu mengaktifkan atau menambahkan metode di Pengaturan Pembayaran.</div>}
            </>}
        {error && <div className="mt-4 rounded-xl border border-red-500/20 bg-red-500/5 px-3 py-2 text-sm text-red-300">{error}</div>}
        <div className="flex items-center justify-between mt-5 pt-4 border-t surface-border"><span className="text-sm text-slate-400">Total pesanan</span><span className="text-lg font-bold text-fg">{formatProductPrice(checkoutTotal, String(selected.currency ?? 'IDR'))}</span></div>
        <div className="flex gap-2 mt-5"><Button variant="outline" fullWidth onClick={close} disabled={submitting}>Batal</Button><Button fullWidth loading={submitting} disabled={submitting || (selectedNeedsParticipant && !(Number(certificatePrice) > 0)) || (isEduCoinCheckout && eduCoinBalance != null && eduCoinBalance < checkoutTotal)} onClick={() => void submit()}>{isEduCoinCheckout ? 'Beli dengan Edu Coin' : 'Kirim untuk verifikasi'}</Button></div>
      </Card>
    </div>}
  </div>;
}
