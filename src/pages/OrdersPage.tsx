import { useEffect, useMemo, useRef, useState } from 'react';
import { ShoppingBag, Package, Loader2, Upload, X, CreditCard, Copy, Eye, Trash2, RefreshCw, XCircle, Star, QrCode, UploadCloud, Wallet } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { ShopExperience } from '@/components/shop/ShopExperience';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { formatRupiah, formatShortDate } from '@/lib/utils';
import { createCollectiveCertificateOrderWithProof, createProductOrderWithEduCoin, createProductOrderWithProof, listActiveProducts, listOrganizerPaymentMethods, type CommerceProduct, type OrganizerPaymentMethod } from '@/services/commerce.service';
import { useApp } from '@/store/AppContext';
import { useLanguage } from '@/lib/LanguageContext';
import { uploadImage } from '@/services/cloudinary.service';
import { createCheckoutPayment, getPublicPaymentGatewayStatus, reconcileGatewayPaymentReturn } from '@/services/payment.service';
import { supabase } from '@/lib/supabase';
import { listCurrentUserOrganizers, type CurrentOrganizer } from '@/services/organizerAuth.service';
import { getCollectiveCertificatePrice, listTeacherCollectiveParticipants, prepareCollectiveCertificate, type CollectiveParticipant } from '@/services/collectiveParticipant.service';
import type { ProductReviewSummary } from '@/services/shopEngagement.service';

type BadgeOption = { id: string; name: string; icon_emoji: string | null; rarity: string };
type GatewayReturnCheck = { orderId: string; status: 'checking' | 'paid' | 'pending' | 'cancelled' };

function checkoutProductBadge(product: CommerceProduct) {
  const configured = product.metadata?.shop_badge ?? product.metadata?.badge_label;
  if (typeof configured === 'string' && configured.trim()) return configured.trim();
  const labels: Record<string, string> = {
    EDU_COIN_TOPUP: 'Paket Edu Coin',
    BADGE: 'Badge Profil',
    CERTIFICATE_SERIALS: 'QR / Serial Sertifikat',
    COLLECTIVE_CERTIFICATE: 'Sertifikat Peserta',
    DIGITAL_ITEM: 'Item Lomba & Bypass',
    DONATION: 'Dukungan SYKABELAJAR',
    VOUCHER: 'Voucher Diskon',
  };
  return labels[product.product_type] ?? product.product_type.replaceAll('_', ' ');
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
  if (message.includes('WHATSAPP_REQUIRED')) return 'Nomor WhatsApp wajib diisi dan minimal 9 digit.';
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
  const { t, language } = useLanguage();
  const [products, setProducts] = useState<CommerceProduct[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [orderIntentsById, setOrderIntentsById] = useState<Record<string, any>>({});
  const [selectedOrderForDetails, setSelectedOrderForDetails] = useState<any | null>(null);
  const [orderActionId, setOrderActionId] = useState('');
  const [selected, setSelected] = useState<CommerceProduct | null>(null);
  const [selectedReviewSummary, setSelectedReviewSummary] = useState<ProductReviewSummary | null>(null);
  const [selectedSalesCount, setSelectedSalesCount] = useState(0);
  const [purchaseStep, setPurchaseStep] = useState<1 | 2 | 3>(1);
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
  const [gatewayReturnCheck, setGatewayReturnCheck] = useState<GatewayReturnCheck | null>(null);
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
        const orderRows = orderData ?? [];
        const orderIds = orderRows.map((row: any) => String(row.id));
        let intentRows: any[] = [];
        if (orderIds.length) {
          const { data: intentData, error: intentError } = await supabase
            .from('payment_intents')
            .select('id,order_id,provider,provider_reference,amount,status,created_at,updated_at')
            .in('order_id', orderIds)
            .order('created_at', { ascending: false });
          if (intentError) throw intentError;
          intentRows = intentData ?? [];
        }
        const { data: archivedRows, error: archivedError } = await supabase
          .from('user_order_history_archives')
          .select('order_id')
          .eq('user_id', userId);
        if (archivedError) throw archivedError;

        const intentMap: Record<string, any> = {};
        for (const intent of intentRows) {
          const orderId = String(intent.order_id);
          if (!intentMap[orderId]) intentMap[orderId] = intent;
        }
        const archivedIds = new Set((archivedRows ?? []).map((row: any) => String(row.order_id)));
        setOrderIntentsById(intentMap);
        setOrders(orderRows.filter((row: any) => !archivedIds.has(String(row.id))));
        setOwnedBadgeIds(new Set((ownedBadges ?? []).map((row: any) => String(row.badge_id))));
        setEduCoinBalance(Number(wallet?.edu_coin ?? 0));
      } else {
        setOrders([]);
        setOrderIntentsById({});
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

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const returnedOrderId = String(params.get('orderId') ?? '').trim();
    const transactionId = String(params.get('transactionId') ?? '').trim();
    if (params.get('payment') !== 'return' || !returnedOrderId || !user?.id) return;

    let active = true;
    let timer: number | undefined;
    let checks = 0;
    let reconcileAttempts = 0;
    const maxChecks = 18;

    setGatewayReturnCheck({ orderId: returnedOrderId, status: 'checking' });

    const verifyReturn = async () => {
      checks += 1;

      // The return URL is not evidence of payment. Ask our server to query XenithPay
      // with stored credentials, and let the server fulfill only a matching SUCCESS transaction.
      if (reconcileAttempts < 3) {
        reconcileAttempts += 1;
        try {
          await reconcileGatewayPaymentReturn(returnedOrderId, transactionId || null);
        } catch {
          // Keep the status pending; the authenticated webhook may still arrive later.
        }
      }

      if (!active) return;
      try {
        const [{ data: order, error: orderError }, { data: intentRows, error: intentError }] = await Promise.all([
          supabase.from('orders')
            .select('id,user_id,status,total,currency,updated_at,payment_provider,payment_proof_status')
            .eq('id', returnedOrderId)
            .eq('user_id', user.id)
            .maybeSingle(),
          supabase.from('payment_intents')
            .select('id,order_id,provider,status,amount,provider_reference,updated_at')
            .eq('order_id', returnedOrderId)
            .order('updated_at', { ascending: false })
            .limit(1),
        ]);
        if (!active) return;

        const intent = Array.isArray(intentRows) ? intentRows[0] : null;
        if (!orderError && !intentError && order) {
          setOrders((current) => current.map((row) => String(row.id) === returnedOrderId ? { ...row, ...order } : row));
          if (intent) {
            setOrderIntentsById((current) => ({ ...current, [returnedOrderId]: intent }));
          }

          const orderStatus = String(order.status ?? '').toUpperCase();
          const intentStatus = String(intent?.status ?? '').toUpperCase();
          if (orderStatus === 'PAID' && intentStatus === 'PAID') {
            setGatewayReturnCheck({ orderId: returnedOrderId, status: 'paid' });
            void load();
            return;
          }

          if (['CANCELLED', 'CANCELED', 'REFUNDED'].includes(orderStatus)
            || ['CANCELLED', 'CANCELED', 'EXPIRED', 'FAILED', 'REFUNDED'].includes(intentStatus)) {
            setGatewayReturnCheck({ orderId: returnedOrderId, status: 'cancelled' });
            return;
          }
        }
      } catch {
        // A temporary read issue should not be interpreted as either a successful or failed payment.
      }

      if (checks >= maxChecks) {
        setGatewayReturnCheck({ orderId: returnedOrderId, status: 'pending' });
        return;
      }
      timer = window.setTimeout(verifyReturn, 5000);
    };

    void verifyReturn();
    return () => {
      active = false;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [user?.id]);


  const isQuantityPackage = selected ? ['EDU_COIN_TOPUP', 'DIGITAL_ITEM', 'DONATION'].includes(selected.product_type) : false;
  const displayPrice = (product: CommerceProduct) => product.product_type === 'COLLECTIVE_CERTIFICATE'
    ? Number(certificatePrice ?? 0)
    : Number(product.price ?? 0);
  const isEduCoinCheckout = selected?.currency === 'EDU_COIN';
  const selectedPaymentMethod = paymentMethods.find((method) => method.id === paymentMethod) ?? null;
  const usablePaymentMethods = paymentMethods.filter((method) => method.details?.global_gateway === true || ['BANK_TRANSFER', 'MANUAL_TRANSFER', 'QRIS', 'EWALLET'].includes(String(method.payment_type).trim().toUpperCase()));
  const isGlobalGatewayCheckout = !isEduCoinCheckout && selectedPaymentMethod?.details?.global_gateway === true;
  const checkoutPaymentMethods = usablePaymentMethods.filter((method) => method.details?.global_gateway !== true || gatewayStatus?.checkoutEnabled);
  const checkoutQuantity = selected && isQuantityPackage ? quantity : 1;
  const checkoutTotal = selected ? displayPrice(selected) * checkoutQuantity : 0;
  const formatProductPrice = (price: number, currency: string) => currency === 'EDU_COIN'
    ? `${Number(price).toLocaleString('id-ID')} Edu Coin`
    : formatRupiah(price);
  const needsWhatsapp = Boolean(selected && (!isEduCoinCheckout || ['DIGITAL_ITEM', 'DONATION'].includes(selected.product_type)));
  const whatsappDigitCount = whatsapp.replace(/\\D/g, '').length;
  const isWhatsappValid = whatsappDigitCount >= 9;
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
    setSelectedReviewSummary(null);
    setSelectedSalesCount(0);
    setPurchaseStep(1);
    setQuantity(1);
    setProofFile(null);
    setProofPreview('');
    setWhatsapp('');
    setSelectedParticipantId('');
    setError('');
  };

  const goToPurchaseStep = (step: 1 | 2 | 3) => {
    if (submitting) return;
    if (step === 2) {
      if (selected?.product_type === 'BADGE' && ownsSelectedBadge) {
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
      if (isEduCoinCheckout && selected && !['DIGITAL_ITEM', 'DONATION', 'BADGE', 'CERTIFICATE_SERIALS'].includes(selected.product_type)) {
        setError('Jenis produk ini tidak mendukung pembayaran Edu Coin.');
        return;
      }
      if (selectedNeedsParticipant && !(Number(certificatePrice) > 0)) {
        setError('Harga sertifikat belum diatur. Hubungi admin atau periksa pengaturan sertifikat peserta.');
        return;
      }
    }
    if (step === 3) {
      if (!isEduCoinCheckout && !selectedPaymentMethod) {
        setError('Belum ada metode pembayaran yang aktif. Periksa pengaturan pembayaran admin.');
        return;
      }
      if (isGlobalGatewayCheckout && !gatewayStatus?.checkoutEnabled) {
        setError('Pembayaran otomatis sedang tidak tersedia. Pilih metode manual yang diaktifkan admin.');
        return;
      }
    }
    setError('');
    setPurchaseStep(step);
  };

  const copyPaymentValue = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setMessage('Informasi pembayaran disalin.');
    } catch {
      setError('Browser tidak mengizinkan penyalinan otomatis. Salin informasi pembayaran secara manual.');
    }
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
      if (needsWhatsapp && !isWhatsappValid) {
        setError(whatsapp.trim() ? 'Nomor WhatsApp harus berisi minimal 9 digit.' : 'Nomor WhatsApp wajib diisi.');
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
        setSelectedReviewSummary(null);
        setSelectedSalesCount(0);
        setPurchaseStep(1);
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
    if (needsWhatsapp && !isWhatsappValid) {
      setError(whatsapp.trim() ? 'Nomor WhatsApp harus berisi minimal 9 digit.' : 'Nomor WhatsApp wajib diisi.');
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
          setSelectedReviewSummary(null);
          setSelectedSalesCount(0);
          setPurchaseStep(1);
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
      setSelectedReviewSummary(null);
      setSelectedSalesCount(0);
      setPurchaseStep(1);
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
    const provider = String(order.payment_provider ?? '').toUpperCase();
    const proofStatus = String(order.payment_proof_status ?? '').toUpperCase();
    if (status === 'PAID') {
      const type = order.order_items?.[0]?.product_type;
      return String(order.order_items?.[0]?.product_ref ?? '') === 'COLLECTIVE_CERTIFICATE' ? 'Sertifikat diterbitkan' : ['DIGITAL_ITEM', 'DONATION'].includes(String(type)) ? 'Terverifikasi' : 'Manfaat diberikan';
    }
    if (status === 'CANCELLED' || status === 'CANCELED' || status === 'REFUNDED') return 'Ditolak / dibatalkan';
    if (status === 'PENDING_PAYMENT' || status === 'PENDING') {
      if (provider === 'GLOBAL' || provider === 'MIDTRANS' || provider === 'XENITHPAY') return 'Menunggu pembayaran';
      return proofStatus === 'SUBMITTED' ? 'Menunggu verifikasi admin' : 'Menunggu pembayaran';
    }
    if (status === 'PROCESSING') return 'Sedang diproses';
    return 'Menunggu verifikasi admin';
  };

  const continueGatewayPayment = async (orderId: string) => {
    if (!orderId || submitting) return;
    setPendingGatewayOrderId(orderId);
    setSubmitting(true);
    setGatewayPaymentError('');
    setError('');
    setMessage('');
    try {
      const payment = await createCheckoutPayment(orderId);
      setGatewayPaymentResult(payment);
      setPendingGatewayOrderId('');
      if (payment.redirect_url) { window.location.assign(payment.redirect_url); return; }
      setMessage(`Instruksi pembayaran untuk pesanan #${orderId.slice(0, 8)} sudah siap. Selesaikan pembayaran menggunakan detail di bawah.`);
      await load();
    } catch (gatewayError: any) {
      setGatewayPaymentError(gatewayError?.message || 'Sesi pembayaran belum berhasil dibuat.');
      setMessage(`Pesanan #${orderId.slice(0, 8)} masih menunggu pembayaran. Gunakan tombol Lanjutkan pembayaran setelah memeriksa pesan error.`);
    } finally {
      setSubmitting(false);
    }
  };


  const itemForOrder = (order: any) => Array.isArray(order.order_items) ? order.order_items[0] : order.order_items;
  const itemTitle = (order: any) => {
    const item = itemForOrder(order);
    return item?.name ?? ('Pesanan #' + String(order.id ?? '').slice(0, 8));
  };
  const terminalOrder = (order: any) => ['PAID', 'COMPLETED', 'CANCELLED', 'CANCELED', 'REFUNDED'].includes(String(order.status ?? '').toUpperCase());
  const isShopOrder = (order: any) => {
    const item = itemForOrder(order);
    const type = String(item?.product_type ?? '').toUpperCase();
    return ['EDU_COIN_TOPUP', 'BADGE', 'CERTIFICATE_SERIALS', 'DONATION'].includes(type)
      || (type === 'DIGITAL_ITEM' && Boolean(item?.metadata?.shop_metadata) && String(item?.product_ref ?? '') !== 'COLLECTIVE_CERTIFICATE');
  };
  const canCancelOrder = (order: any) => {
    const id = String(order.id ?? '');
    const status = String(order.status ?? '').toUpperCase();
    const proofStatus = String(order.payment_proof_status ?? '').toUpperCase();
    const intentStatus = String(orderIntentsById[id]?.status ?? '').toUpperCase();
    const intentFinal = ['FAILED', 'EXPIRED', 'CANCELLED', 'REJECTED'].includes(intentStatus);
    return status === 'PENDING_PAYMENT'
      && proofStatus !== 'SUBMITTED'
      && !order.payment_proof_url
      && isShopOrder(order)
      && (!orderIntentsById[id] || intentFinal);
  };

  const cancelPendingOrder = async (order: any) => {
    const orderId = String(order.id ?? '');
    if (!orderId || orderActionId) return;
    if (!window.confirm('Batalkan pesanan #' + orderId.slice(0, 8) + '? Pesanan yang dibatalkan tidak bisa dilanjutkan kembali.')) return;
    setOrderActionId(orderId);
    setError('');
    setMessage('');
    try {
      const { error: cancelError } = await supabase.rpc('cancel_my_pending_order', { p_order_id: orderId });
      if (cancelError) throw cancelError;
      setMessage('Pesanan #' + orderId.slice(0, 8) + ' dibatalkan. Catatan transaksi tetap tersimpan untuk keperluan administrasi.');
      setSelectedOrderForDetails(null);
      await load();
    } catch (actionError: any) {
      const detail = String(actionError?.message ?? '');
      if (detail.includes('PAYMENT_SESSION_ACTIVE')) {
        setError('Sesi pembayaran masih aktif. Lanjutkan pembayaran yang sudah dibuat atau tunggu sampai sesi pembayaran dinyatakan kedaluwarsa oleh provider.');
      } else if (detail.includes('PAYMENT_PROOF_SUBMITTED')) {
        setError('Bukti pembayaran sudah dikirim sehingga pesanan tidak dapat dibatalkan sendiri. Hubungi admin untuk pemeriksaan.');
      } else {
        setError(detail || 'Pesanan belum bisa dibatalkan. Muat ulang riwayat dan coba lagi.');
      }
    } finally {
      setOrderActionId('');
    }
  };

  const archiveOrder = async (order: any) => {
    const orderId = String(order.id ?? '');
    if (!orderId || orderActionId) return;
    if (!window.confirm('Hapus pesanan #' + orderId.slice(0, 8) + ' dari riwayat pribadimu? Catatan transaksi tetap disimpan untuk admin.')) return;
    setOrderActionId(orderId);
    setError('');
    setMessage('');
    try {
      const { error: archiveError } = await supabase.rpc('archive_my_order_history', { p_order_id: orderId });
      if (archiveError) throw archiveError;
      setOrders((current) => current.filter((row) => String(row.id) !== orderId));
      setSelectedOrderForDetails(null);
      setMessage('Pesanan dihapus dari riwayat pribadimu. Catatan transaksi tetap tersimpan di sistem.');
    } catch (actionError: any) {
      setError(actionError?.message || 'Pesanan belum bisa dihapus dari riwayat.');
    } finally {
      setOrderActionId('');
    }
  };


  return <div>
    <div className="p-4 space-y-6">
      {error && <Card className="p-3 border-red-500/20 text-sm text-red-300">{error}</Card>}
      {message && <Card className="p-3 border-moss-500/20 text-sm text-accent">{message}</Card>}
      {gatewayReturnCheck?.status === 'checking' && (
        <Card className="flex items-start gap-3 border-blue-500/20 bg-blue-500/5 p-4">
          <Loader2 size={18} className="mt-0.5 animate-spin text-blue-400" />
          <div>
            <p className="text-sm font-semibold text-fg">Memverifikasi pembayaran</p>
            <p className="mt-1 text-xs leading-5 text-fg-muted">Kami sedang mencocokkan transaksi dengan data XenithPay. Pesanan baru dinyatakan selesai setelah status dan nominal terverifikasi oleh server.</p>
          </div>
        </Card>
      )}
      {gatewayReturnCheck?.status === 'paid' && (
        <Card className="flex items-start gap-3 border-emerald-500/20 bg-emerald-500/5 p-4">
          <CreditCard size={18} className="mt-0.5 text-emerald-400" />
          <div>
            <p className="text-sm font-semibold text-fg">Pembayaran terverifikasi</p>
            <p className="mt-1 text-xs leading-5 text-fg-muted">Pesanan #{gatewayReturnCheck.orderId.slice(0, 8)} telah diperbarui menjadi selesai berdasarkan konfirmasi gateway.</p>
          </div>
        </Card>
      )}
      {gatewayReturnCheck?.status === 'pending' && (
        <Card className="flex items-start gap-3 border-amber-500/20 bg-amber-500/5 p-4">
          <RefreshCw size={18} className="mt-0.5 text-amber-300" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-fg">Konfirmasi pembayaran belum diterima</p>
            <p className="mt-1 text-xs leading-5 text-fg-muted">Status pesanan masih menunggu konfirmasi resmi dari XenithPay. Jangan membuat pesanan baru atau membayar ulang dulu. Coba muat ulang untuk memeriksa status terbaru.</p>
            <Button size="sm" variant="outline" className="mt-3" onClick={() => window.location.reload()}>Periksa lagi</Button>
          </div>
        </Card>
      )}
      {gatewayReturnCheck?.status === 'cancelled' && (
        <Card className="flex items-start gap-3 border-red-500/20 bg-red-500/5 p-4">
          <XCircle size={18} className="mt-0.5 text-red-400" />
          <div>
            <p className="text-sm font-semibold text-fg">Transaksi belum berhasil</p>
            <p className="mt-1 text-xs leading-5 text-fg-muted">Gateway melaporkan transaksi dibatalkan atau kedaluwarsa. Pesanan tidak ditandai lunas.</p>
          </div>
        </Card>
      )}{gatewayPaymentError && <Card className="border-amber-500/20 bg-amber-500/5 p-4"><div className="flex items-start gap-3"><CreditCard size={18} className="mt-0.5 text-amber-300"/><div className="min-w-0 flex-1"><p className="text-sm font-semibold text-fg">Sesi pembayaran otomatis belum siap</p><p className="mt-1 break-words text-xs leading-5 text-fg-muted">{gatewayPaymentError}</p><Button size="sm" className="mt-3" loading={submitting} disabled={submitting||!pendingGatewayOrderId} onClick={()=>void retryGatewayPayment()}>Coba buat sesi lagi</Button></div></div></Card>}{gatewayPaymentResult && !gatewayPaymentResult.redirect_url && <Card className="border-accent/20 p-4"><div className="flex items-start gap-3"><CreditCard size={18} className="mt-0.5 text-accent"/><div className="min-w-0 flex-1"><p className="text-sm font-semibold text-fg">Instruksi pembayaran · {gatewayStatus?.providerName||gatewayPaymentResult.provider}</p><p className="mt-1 text-xs leading-5 text-fg-muted">Status pesanan akan diperbarui otomatis setelah webhook provider tervalidasi.</p>{gatewayPaymentResult.payment_code&&<div className="mt-3 rounded-xl border border-surface-border bg-surface-elevated/25 p-3"><p className="text-[10px] font-bold uppercase tracking-wider text-fg-muted">{gatewayPaymentResult.payment_code_type||'Kode pembayaran'}</p><div className="mt-1 flex items-center justify-between gap-2"><p className="break-all font-mono text-lg font-bold text-fg">{gatewayPaymentResult.payment_code}</p><button type="button" className="rounded-lg border border-surface-border p-2 text-fg-muted hover:text-fg" onClick={()=>{void navigator.clipboard?.writeText(String(gatewayPaymentResult.payment_code));setMessage('Kode pembayaran disalin.')}} aria-label="Salin kode pembayaran"><Copy size={14}/></button></div></div>}</div></div></Card>}
      <ShopExperience
        products={products}
        userId={user?.id}
        loading={loading}
        ordersCount={orders.length}
        historyContent={(
      <section>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2"><ShoppingBag size={17} className="text-accent"/><div><h3 className="font-display text-xl font-bold text-fg">{t('orders.history')}</h3><p className="text-xs text-fg-muted mt-0.5">{language === 'en' ? 'View details, continue payment, or clear the list without deleting the admin transaction record.' : 'Lihat detail, lanjutkan pembayaran, atau bersihkan riwayat tanpa menghapus catatan transaksi admin.'}</p></div></div>
          <Button size="sm" variant="outline" disabled={loading} onClick={() => void load()}><RefreshCw size={13} className={loading ? 'mr-1 animate-spin' : 'mr-1'}/> Segarkan</Button>
        </div>
        <div className="space-y-2">
          {orders.map((order) => <Card key={order.id} className="p-4">
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-3 md:flex-row md:items-center">
                <Package size={18} className="text-accent"/>
                <div className="flex-1 min-w-0"><p className="text-sm font-semibold text-fg">{itemTitle(order)}</p><p className="text-xs text-slate-500">{formatShortDate(order.created_at)} · Pesanan #{String(order.id).slice(0, 8)}</p><p className="mt-1 text-xs text-fg-muted">{String(order.payment_method ?? 'Metode belum tercatat')} · {['GLOBAL', 'MIDTRANS', 'XENITHPAY'].includes(String(order.payment_provider ?? '').toUpperCase()) ? (gatewayStatus?.providerName || 'Gateway otomatis') : 'Pembayaran manual / internal'}</p></div>
                <div className="flex flex-wrap items-center gap-3">
                  <b className="text-fg">{formatProductPrice(Number(order.total || 0), String(order.currency ?? 'IDR'))}</b>
                  <Badge>{statusLabelForOrder(order)}</Badge>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 border-t surface-border pt-3">
                {String(order.status ?? '').toUpperCase() === 'PENDING_PAYMENT' && ['GLOBAL', 'MIDTRANS', 'XENITHPAY'].includes(String(order.payment_provider ?? '').toUpperCase()) && <Button size="sm" disabled={submitting} loading={submitting && pendingGatewayOrderId === String(order.id)} onClick={() => void continueGatewayPayment(String(order.id))}><CreditCard size={13} className="mr-1"/>Lanjutkan pembayaran</Button>}
                <Button size="sm" variant="outline" onClick={() => setSelectedOrderForDetails(order)}><Eye size={13} className="mr-1"/>Lihat detail</Button>
                {canCancelOrder(order) && <Button size="sm" variant="outline" disabled={Boolean(orderActionId)} loading={orderActionId === String(order.id)} onClick={() => void cancelPendingOrder(order)}><XCircle size={13} className="mr-1"/>Batalkan pesanan</Button>}
                {terminalOrder(order) && <Button size="sm" variant="outline" disabled={Boolean(orderActionId)} loading={orderActionId === String(order.id)} onClick={() => void archiveOrder(order)}><Trash2 size={13} className="mr-1"/>Hapus dari riwayat</Button>}
                {String(order.status ?? '').toUpperCase() === 'PENDING_PAYMENT' && ['GLOBAL', 'MIDTRANS', 'XENITHPAY'].includes(String(order.payment_provider ?? '').toUpperCase()) && orderIntentsById[String(order.id)] && !canCancelOrder(order) && <span className="text-xs text-fg-muted">Sesi pembayaran dibuat; batalkan hanya setelah status sesi berakhir.</span>}
              </div>
            </div>
          </Card>)}
          {!loading && !orders.length && <Card className="p-6 text-center text-sm text-slate-500">{language === 'en' ? 'No orders in history yet. New orders will appear here and can be resumed while unpaid.' : 'Belum ada pesanan di riwayat. Pesanan baru akan muncul di sini dan dapat dibuka kembali selama belum dibayar.'}</Card>}
        </div>
      </section>
        )}
        productBenefit={(product) => productBenefit(product, badgeOptions)}
        displayPrice={displayPrice}
        formatProductPrice={formatProductPrice}
        getBuyState={(product) => {
          const badgeId = product.product_type === 'BADGE' ? String(product.metadata?.badge_id ?? '') : '';
          const alreadyOwned = Boolean(badgeId && ownedBadgeIds.has(badgeId));
          const unavailableCertificatePrice = product.product_type === 'COLLECTIVE_CERTIFICATE' && displayPrice(product) <= 0;
          const cannotBuySerials = product.product_type === 'CERTIFICATE_SERIALS' && organizers.length === 0;
          return {
            disabled: alreadyOwned || unavailableCertificatePrice || cannotBuySerials,
            label: alreadyOwned ? 'Sudah dimiliki'
              : unavailableCertificatePrice ? 'Belum tersedia'
                : cannotBuySerials ? 'Butuh organisasi aktif' : 'Pilih & pesan',
          };
        }}
        onBuy={(product, summary, salesCount) => {
          setSelected(product);
          setSelectedReviewSummary(summary ?? null);
          setSelectedSalesCount(salesCount ?? 0);
          setPurchaseStep(1);
          setQuantity(1);
          setProofFile(null);
          setProofPreview('');
          setSelectedParticipantId('');
          setError('');
          setMessage('');
        }}
      />
    </div>

    {selectedOrderForDetails && <div className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-4" onClick={(event) => { if (event.target === event.currentTarget) setSelectedOrderForDetails(null); }}>
      <Card className="w-full max-w-xl p-5 max-h-[92vh] overflow-auto">
        {(() => {
          const detailOrder = selectedOrderForDetails;
          const detailItem = itemForOrder(detailOrder);
          const detailIntent = orderIntentsById[String(detailOrder.id)] ?? null;
          return <>
            <div className="flex items-start justify-between gap-3">
              <div><p className="text-[10px] font-bold uppercase tracking-wider text-accent">{language === 'en' ? 'Transaction details' : 'Detail transaksi'}</p><h3 className="mt-1 font-display text-xl font-bold text-fg">{itemTitle(detailOrder)}</h3><p className="mt-1 text-xs text-fg-muted">Pesanan #{String(detailOrder.id).slice(0, 8)} · {formatShortDate(detailOrder.created_at)}</p></div>
              <button type="button" onClick={() => setSelectedOrderForDetails(null)} className="rounded-lg p-2 text-fg-muted hover:bg-surface-elevated" aria-label="Tutup detail"><X size={17}/></button>
            </div>
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-xl border surface-border p-3"><p className="text-xs text-fg-muted">Total</p><p className="mt-1 text-lg font-bold text-fg">{formatProductPrice(Number(detailOrder.total ?? 0), String(detailOrder.currency ?? 'IDR'))}</p></div>
              <div className="rounded-xl border surface-border p-3"><p className="text-xs text-fg-muted">{t('orders.status')}</p><p className="mt-1 font-semibold text-fg">{statusLabelForOrder(detailOrder)}</p><p className="mt-1 text-xs text-fg-muted">Status sistem: {String(detailOrder.status ?? '-')}</p></div>
              <div className="rounded-xl border surface-border p-3"><p className="text-xs text-fg-muted">Metode pembayaran</p><p className="mt-1 text-sm font-semibold text-fg">{String(detailOrder.payment_method ?? 'Belum ditentukan')}</p><p className="mt-1 text-xs text-fg-muted">{String(detailOrder.payment_provider ?? 'Provider belum tercatat')}</p></div>
              <div className="rounded-xl border surface-border p-3"><p className="text-xs text-fg-muted">{language === 'en' ? 'Payment proof' : 'Bukti pembayaran'}</p>{detailOrder.payment_proof_url ? <a className="mt-1 inline-block text-sm font-semibold text-accent underline" href={String(detailOrder.payment_proof_url)} target="_blank" rel="noreferrer">Lihat bukti pembayaran</a> : <p className="mt-1 text-sm text-fg-muted">Belum ada bukti transfer manual.</p>}<p className="mt-1 text-xs text-fg-muted">Status bukti: {String(detailOrder.payment_proof_status ?? 'NOT_SUBMITTED')}</p></div>
            </div>
            <div className="mt-4 rounded-xl border surface-border p-3">
              <p className="text-xs font-semibold text-fg">Ringkasan barang</p>
              <div className="mt-2 flex items-start justify-between gap-3"><div><p className="text-sm text-fg">{String(detailItem?.name ?? itemTitle(detailOrder))}</p><p className="text-xs text-fg-muted">Jumlah: {Number(detailItem?.quantity ?? 1)} × {formatProductPrice(Number(detailItem?.unit_price ?? detailOrder.total ?? 0), String(detailOrder.currency ?? 'IDR'))}</p></div><p className="text-sm font-semibold text-fg">{formatProductPrice(Number(detailItem?.line_total ?? detailOrder.total ?? 0), String(detailOrder.currency ?? 'IDR'))}</p></div>
            </div>
            {detailIntent && <div className="mt-4 rounded-xl border border-accent/20 bg-accent/5 p-3">
              <p className="text-sm font-semibold text-fg">Sesi pembayaran gateway</p><p className="mt-1 text-xs text-fg-muted">{String(detailIntent.provider ?? 'Provider')} · status sesi: {String(detailIntent.status ?? 'UNKNOWN')}</p>
              {detailIntent.provider_reference && <div className="mt-2 flex items-center justify-between gap-2"><p className="break-all font-mono text-xs text-fg-muted">Referensi: {String(detailIntent.provider_reference)}</p><button type="button" className="rounded-lg border surface-border p-2" onClick={() => { void navigator.clipboard?.writeText(String(detailIntent.provider_reference)); setMessage('Referensi pembayaran disalin.'); }} aria-label="Salin referensi pembayaran"><Copy size={13}/></button></div>}
              <p className="mt-2 text-xs leading-5 text-fg-muted">Pesanan otomatis menjadi lunas setelah konfirmasi provider diterima dan diverifikasi server. Jangan menekan tombol bukti lunas di halaman provider tanpa benar-benar menyelesaikan proses yang diminta.</p>
            </div>}
            {detailOrder.admin_review_note && <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3"><p className="text-xs font-semibold text-fg">Catatan admin</p><p className="mt-1 whitespace-pre-line text-sm text-fg-muted">{String(detailOrder.admin_review_note)}</p></div>}
            {String(detailOrder.status ?? '').toUpperCase() === 'PENDING_PAYMENT' && ['GLOBAL', 'MIDTRANS', 'XENITHPAY'].includes(String(detailOrder.payment_provider ?? '').toUpperCase()) && <Button className="mt-4 w-full" disabled={submitting} loading={submitting && pendingGatewayOrderId === String(detailOrder.id)} onClick={() => { const id = String(detailOrder.id); setSelectedOrderForDetails(null); void continueGatewayPayment(id); }}><CreditCard size={14} className="mr-1"/>Lanjutkan pembayaran</Button>}
            {canCancelOrder(detailOrder) && <Button className="mt-3 w-full" variant="outline" disabled={Boolean(orderActionId)} loading={orderActionId === String(detailOrder.id)} onClick={() => void cancelPendingOrder(detailOrder)}><XCircle size={14} className="mr-1"/>Batalkan pesanan</Button>}
            {terminalOrder(detailOrder) && <Button className="mt-3 w-full" variant="outline" disabled={Boolean(orderActionId)} loading={orderActionId === String(detailOrder.id)} onClick={() => void archiveOrder(detailOrder)}><Trash2 size={14} className="mr-1"/>Hapus dari riwayat</Button>}
          </>;
        })()}
      </Card>
    </div>}

    {selected && <div
      className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4"
      style={{ fontFamily: "'Inter', sans-serif" }}
    >
      <div role="dialog" aria-modal="true" aria-label="Detail Produk dan Pembelian" className="bg-[#151F32] border border-slate-700/80 rounded-2xl w-full max-w-xl overflow-hidden shadow-2xl max-h-[90vh] flex flex-col">
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/60 shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-blue-500"/>
            <h3 className="font-bold text-slate-100 text-base">Detail Produk & Pembelian</h3>
          </div>
          <button type="button" onClick={close} disabled={submitting} className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition disabled:opacity-50" aria-label="Tutup pembelian"><X size={20}/></button>
        </div>

        <div className="bg-slate-900/40 px-6 py-3 border-b border-slate-800/80 shrink-0">
          <div className="flex items-center justify-between gap-2 text-[10px] sm:text-xs font-semibold">
            {([
              { step: 1, label: 'Detail & Jumlah' },
              { step: 2, label: 'Metode Bayar' },
              { step: 3, label: 'Konfirmasi' },
            ] as const).map((item, index) => (
              <div key={item.step} className="flex min-w-0 flex-1 items-center">
                <div className={'flex min-w-0 items-center gap-1.5 sm:gap-2 ' + (purchaseStep === item.step
                  ? 'text-blue-400 font-semibold'
                  : purchaseStep > item.step ? 'text-emerald-400 font-semibold' : 'text-slate-500')}>
                  <span className={'w-5 h-5 shrink-0 rounded-full flex items-center justify-center text-[10px] ' + (purchaseStep === item.step
                    ? 'bg-blue-600 text-white'
                    : purchaseStep > item.step ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-400')}>{item.step}</span>
                  <span className="truncate">{item.label}</span>
                </div>
                {index < 2 && <div className="mx-2 h-px min-w-2 flex-1 bg-slate-700"/>}
              </div>
            ))}
          </div>
        </div>

        <div className="p-4 sm:p-6 overflow-y-auto">
          {purchaseStep === 1 && <div className="space-y-5">
            <div className="flex gap-4 p-3 rounded-xl bg-slate-900/60 border border-slate-800">
              <div className="w-20 h-20 shrink-0 overflow-hidden rounded-lg border border-slate-700 bg-slate-950">
                {selected.image_url
                  ? <img src={selected.image_url} alt={selected.name} className="w-full h-full object-cover"/>
                  : <div className="flex h-full items-center justify-center"><ShoppingBag size={25} className="text-slate-600"/></div>}
              </div>
              <div className="flex-1 min-w-0">
                <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold bg-blue-500/20 text-blue-400 border border-blue-500/30">{checkoutProductBadge(selected)}</span>
                <h4 className="font-bold text-white text-base mt-1 truncate">{selected.name}</h4>
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400 mt-1">
                  <span className="flex items-center text-amber-400 font-bold gap-1"><Star size={13} className="fill-amber-400"/>{selectedReviewSummary?.average_rating != null ? selectedReviewSummary.average_rating.toFixed(1) : 'Belum ada rating'}</span>
                  <span>•</span>
                  <span>{selectedSalesCount.toLocaleString('id-ID')} Terjual</span>
                </div>
                <div className="text-blue-400 font-bold text-lg mt-1">{formatProductPrice(displayPrice(selected), selected.currency)}</div>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Deskripsi Produk</label>
              <p className="text-xs text-slate-400 bg-slate-900/30 p-3 rounded-lg border border-slate-800 leading-relaxed whitespace-pre-line">{productBenefit(selected, badgeOptions)}</p>
            </div>

            {isQuantityPackage && <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-slate-800/80 pt-2">
              <span className="text-[11px] font-semibold text-slate-300">Jumlah Paket</span>
              <div className="flex items-center rounded-lg border border-slate-700 bg-slate-900/80">
                <button type="button" aria-label="Kurangi jumlah paket" onClick={() => setQuantity((value) => Math.max(1, value - 1))} disabled={submitting || quantity <= 1} className="px-3 py-1 text-slate-400 hover:text-white disabled:opacity-40 font-bold text-base">−</button>
                <span className="w-10 text-center text-sm font-bold text-white">{quantity}</span>
                <button type="button" aria-label="Tambah jumlah paket" onClick={() => setQuantity((value) => Math.min(100, value + 1))} disabled={submitting || quantity >= 100} className="px-3 py-1 text-slate-400 hover:text-white disabled:opacity-40 font-bold text-base">+</button>
              </div>
            </div>}

            {selectedNeedsOrganizer && <label className="block">
              <span className="block text-xs font-semibold text-slate-300 mb-1.5">Organisasi penerima QR / Serial <span className="text-red-400">*</span></span>
              <select className="w-full bg-slate-900/80 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500" value={selectedOrganizerId} onChange={(event) => setSelectedOrganizerId(event.target.value)} disabled={submitting} required>
                <option value="">Pilih organisasi yang kamu kelola</option>
                {organizers.map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}
              </select>
              <span className="mt-1 block text-[10px] text-slate-500">Serial akan masuk ke inventaris organisasi yang dipilih.</span>
            </label>}

            {selectedNeedsParticipant && <label className="block">
              <span className="block text-xs font-semibold text-slate-300 mb-1.5">Peserta yang akan menerima sertifikat <span className="text-red-400">*</span></span>
              <select className="w-full bg-slate-900/80 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500" value={selectedParticipantId} onChange={(event) => setSelectedParticipantId(event.target.value)} disabled={submitting} required>
                <option value="">Pilih peserta dengan hasil selesai</option>
                {eligibleParticipants.map((participant) => <option key={participant.participant_id} value={participant.participant_id}>{participant.full_name} · {participant.competition_title}</option>)}
              </select>
              <span className="mt-1 block text-[10px] text-slate-500">Backend akan memeriksa ulang kelayakan peserta dan status pengumuman hasil.</span>
            </label>}

            {error && <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">{error}</div>}
            {isEduCoinCheckout && <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs text-slate-300">
              Saldo tersedia: <b className="text-white">{eduCoinBalance == null ? 'Tidak tersedia' : eduCoinBalance.toLocaleString('id-ID') + ' Edu Coin'}</b>
            </div>}

            <div className="pt-3 border-t border-slate-800 flex flex-wrap items-center gap-3">
              <button type="button" onClick={close} disabled={submitting} className="rounded-xl bg-slate-800 px-4 py-2.5 text-xs font-semibold text-slate-300 transition hover:bg-slate-700 disabled:opacity-50">Batal</button>
              <div className="ml-auto">
                <span className="text-xs text-slate-400 block">Total Pembayaran:</span>
                <span className="text-lg font-extrabold text-white">{formatProductPrice(checkoutTotal, String(selected.currency ?? 'IDR'))}</span>
              </div>
              <button type="button" onClick={() => goToPurchaseStep(2)} disabled={submitting} className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-lg shadow-blue-600/30 transition disabled:opacity-50">
                Lanjut ke Pembayaran <span aria-hidden="true">→</span>
              </button>
            </div>
          </div>}

          {purchaseStep === 2 && <div className="space-y-4">
            <label className="block text-xs font-semibold text-slate-300 mb-1">Pilih Metode Pembayaran</label>
            {isEduCoinCheckout
              ? <label className="payment-option flex items-center justify-between p-3 rounded-xl border border-blue-500 bg-blue-500/10 cursor-default">
                  <div className="flex items-center gap-3">
                    <input type="radio" checked readOnly className="text-blue-600 focus:ring-0"/>
                    <div>
                      <div className="text-xs font-bold text-white flex items-center gap-2">Pembayaran Edu Coin <span className="bg-emerald-500/20 text-emerald-400 text-[9px] px-1.5 py-0.5 rounded font-semibold">Otomatis</span></div>
                      <div className="text-[11px] text-slate-400">Saldo dipotong dan transaksi dicatat oleh backend.</div>
                    </div>
                  </div>
                  <CreditCard size={20} className="text-slate-400"/>
                </label>
              : checkoutPaymentMethods.length ? <div className="space-y-2.5">
                  {checkoutPaymentMethods.map((method) => {
                    const isAutomatic = method.details?.global_gateway === true;
                    const selectedMethod = paymentMethod === method.id;
                    return <label key={method.id} className={'payment-option flex items-center justify-between p-3 rounded-xl border cursor-pointer transition ' + (selectedMethod ? 'border-blue-500 bg-blue-500/10' : 'border-slate-700 bg-slate-900/50 hover:border-blue-500')}>
                      <div className="flex min-w-0 items-center gap-3">
                        <input type="radio" name="shop-payment-method" value={method.id} checked={selectedMethod} onChange={() => { setPaymentMethod(method.id); setProofFile(null); setError(''); }} disabled={submitting} className="text-blue-600 focus:ring-0"/>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2 text-xs font-bold text-white">
                            <span>{method.name}</span>
                            <span className={'text-[9px] px-1.5 py-0.5 rounded font-semibold ' + (isAutomatic ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400')}>{isAutomatic ? 'Otomatis' : 'Verifikasi Admin'}</span>
                          </div>
                          <div className="text-[11px] text-slate-400">{isAutomatic ? 'Pembayaran diproses melalui gateway yang aktif di admin.' : String(method.payment_type).replaceAll('_', ' ') + ' · Unggah bukti setelah transfer.'}</div>
                        </div>
                      </div>
                      {String(method.payment_type).toUpperCase() === 'QRIS'
                        ? <QrCode size={20} className="shrink-0 text-slate-400"/>
                        : String(method.payment_type).toUpperCase() === 'EWALLET'
                          ? <Wallet size={20} className="shrink-0 text-slate-400"/>
                          : isAutomatic
                            ? <CreditCard size={20} className="shrink-0 text-slate-400"/>
                            : <UploadCloud size={20} className="shrink-0 text-slate-400"/>}
                    </label>;
                  })}
                </div>
              : <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-xs leading-5 text-slate-300">Belum ada metode pembayaran aktif. Admin perlu mengaktifkan metode melalui Pengaturan Pembayaran.</div>}

            {error && <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">{error}</div>}
            <div className="pt-4 border-t border-slate-800 flex items-center justify-between gap-2">
              <button type="button" onClick={() => goToPurchaseStep(1)} disabled={submitting} className="px-3 sm:px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold transition disabled:opacity-50">Kembali</button>
              <button type="button" onClick={close} disabled={submitting} className="px-3 sm:px-4 py-2 text-slate-400 hover:text-white rounded-xl text-xs font-semibold transition disabled:opacity-50">Batal</button>
              <button type="button" onClick={() => goToPurchaseStep(3)} disabled={submitting || (!isEduCoinCheckout && checkoutPaymentMethods.length === 0)} className="px-4 sm:px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-lg shadow-blue-600/30 transition disabled:opacity-50">
                Lanjut Konfirmasi <span aria-hidden="true">→</span>
              </button>
            </div>
          </div>}

          {purchaseStep === 3 && <div className="space-y-4">
            <div className="bg-slate-900/80 p-4 rounded-xl border border-slate-800 space-y-2 text-xs">
              <div className="flex justify-between gap-3 text-slate-400"><span>Item:</span><span className="font-bold text-white text-right">{selected.name}</span></div>
              <div className="flex justify-between gap-3 text-slate-400"><span>Jumlah:</span><span className="font-bold text-white">{checkoutQuantity} Paket</span></div>
              <div className="flex justify-between gap-3 text-slate-400"><span>Metode Pembayaran:</span><span className="font-bold text-blue-400 text-right">{isEduCoinCheckout ? 'Edu Coin' : isGlobalGatewayCheckout ? gatewayStatus?.providerName || 'Gateway otomatis' : selectedPaymentMethod?.name || 'Belum dipilih'}</span></div>
              <div className="flex justify-between gap-3 text-slate-400 pt-2 border-t border-slate-800"><span className="font-bold text-slate-200">Total Yang Harus Dibayar:</span><span className="font-extrabold text-blue-400 text-sm">{formatProductPrice(checkoutTotal, String(selected.currency ?? 'IDR'))}</span></div>
            </div>

            {needsWhatsapp && <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
              <label className="block">
                <span className="block text-xs font-semibold text-slate-300 mb-1.5">Nomor WhatsApp <span className="text-red-400">*</span></span>
                <input
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  maxLength={24}
                  aria-invalid={whatsapp.trim().length > 0 && !isWhatsappValid}
                  className={'w-full rounded-lg border bg-slate-950/70 px-3 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500 ' + (whatsapp.trim().length > 0 && !isWhatsappValid ? 'border-red-500/70' : 'border-slate-700')}
                  placeholder="Contoh: 08xxxxxxxxxx"
                  value={whatsapp}
                  onChange={(event) => setWhatsapp(event.target.value)}
                  disabled={submitting}
                  required
                />
                <span className={'mt-1.5 block text-[10px] ' + (whatsapp.trim().length > 0 && !isWhatsappValid ? 'text-red-300' : 'text-slate-500')}>
                  Minimal 9 digit untuk koordinasi pengiriman dan pemrosesan produk · {whatsappDigitCount}/9 digit
                </span>
              </label>
            </div>}

            {isEduCoinCheckout
              ? <div className="bg-slate-900/90 border border-slate-700/80 p-4 rounded-xl space-y-3">
                  <div className="flex items-center justify-between text-xs text-slate-300"><span>Saldo Edu Coin</span><b className="text-white">{eduCoinBalance == null ? 'Tidak tersedia' : eduCoinBalance.toLocaleString('id-ID') + ' Edu Coin'}</b></div>
                  <div className="flex items-center justify-between text-xs text-slate-300"><span>Total pembayaran</span><b className="text-blue-400">{formatProductPrice(checkoutTotal, 'EDU_COIN')}</b></div>
                  {eduCoinBalance != null && eduCoinBalance < checkoutTotal && <p className="text-[10px] text-red-300">Saldo tidak mencukupi. Isi saldo Edu Coin terlebih dahulu.</p>}
                  <p className="text-[10px] leading-5 text-slate-400">Tidak perlu bukti transfer. Backend akan memeriksa harga dan saldo terbaru, lalu mencatat transaksi secara bersamaan.</p>
                </div>
              : isGlobalGatewayCheckout
                ? <div className="bg-slate-900/90 border border-slate-700/80 p-4 rounded-xl space-y-2">
                    <p className="text-xs font-semibold text-slate-300">Pembayaran otomatis · {gatewayStatus?.providerName || selectedPaymentMethod?.name}</p>
                    <p className="text-[11px] leading-relaxed text-slate-400">Setelah konfirmasi, pesanan akan disimpan dan halaman pembayaran dari penyedia yang dikonfigurasi admin akan dibuka. Status transaksi diperbarui setelah callback penyedia tervalidasi.</p>
                  </div>
                : selectedPaymentMethod
                  ? <div className="bg-slate-900/90 border border-slate-700/80 p-4 rounded-xl space-y-3">
                      <div>
                        <p className="text-xs font-semibold text-slate-300">{selectedPaymentMethod.name}</p>
                        {Boolean(selectedPaymentMethod.details?.bank_name) && <p className="mt-1 text-[11px] text-slate-400">Bank: <span className="text-white">{String(selectedPaymentMethod.details.bank_name)}</span></p>}
                        {Boolean(selectedPaymentMethod.details?.account_number) && <div className="mt-2 flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950 p-3"><div><span className="block text-[10px] font-bold uppercase text-slate-500">Nomor rekening</span><span className="font-mono text-base font-extrabold tracking-wider text-blue-400">{String(selectedPaymentMethod.details.account_number)}</span></div><button type="button" onClick={() => void copyPaymentValue(String(selectedPaymentMethod.details.account_number))} className="inline-flex items-center gap-1 rounded-lg border border-blue-500/30 bg-blue-600/20 px-3 py-1.5 text-xs font-bold text-blue-300"><Copy size={13}/>Salin</button></div>}
                        {Boolean(selectedPaymentMethod.details?.account_name) && <p className="text-[11px] text-slate-400">Atas nama: <span className="text-white">{String(selectedPaymentMethod.details.account_name)}</span></p>}
                        {typeof selectedPaymentMethod.details?.instructions === 'string' && selectedPaymentMethod.details.instructions && <p className="whitespace-pre-line text-[11px] leading-relaxed text-slate-400">{selectedPaymentMethod.details.instructions}</p>}
                        {(selectedPaymentMethod.image_url || (typeof selectedPaymentMethod.details?.image_url === 'string' ? selectedPaymentMethod.details.image_url : '')) && <img src={selectedPaymentMethod.image_url || String(selectedPaymentMethod.details.image_url)} alt={selectedPaymentMethod.name} className="mt-2 max-h-48 w-full rounded-lg object-contain bg-white p-2"/>}
                      </div>
                      <div className="space-y-2">
                        <label className="block text-xs font-semibold text-amber-400">Unggah Bukti Transfer (Manual) <span className="text-red-400">*</span></label>
                        <div className="border-2 border-dashed border-slate-700 hover:border-blue-500 rounded-xl p-4 text-center bg-slate-900/40 cursor-pointer transition">
                          <Upload size={28} className="text-slate-500 mx-auto mb-1"/>
                          <label className="cursor-pointer text-xs text-slate-300 font-medium">{proofFile ? 'Ganti bukti pembayaran' : 'Klik untuk pilih gambar bukti transfer'}<input ref={proofRef} type="file" accept="image/*" className="sr-only" onChange={chooseProof} disabled={submitting}/></label>
                          <span className="block text-[10px] text-slate-500">JPG, PNG · Maksimal 5 MB</span>
                        </div>
                        {proofPreview && <img src={proofPreview} alt="Pratinjau bukti pembayaran" className="max-h-48 w-full rounded-xl border border-slate-800 object-contain"/>}
                      </div>
                    </div>
                  : <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-slate-300">Pilih metode pembayaran yang aktif sebelum melanjutkan.</div>}

            {error && <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">{error}</div>}
            <div className="pt-3 border-t border-slate-800 flex items-center justify-between gap-2">
              <button type="button" onClick={() => goToPurchaseStep(2)} disabled={submitting} className="px-3 sm:px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold transition disabled:opacity-50">Kembali</button>
              <button type="button" onClick={close} disabled={submitting} className="px-3 sm:px-4 py-2 text-slate-400 hover:text-white rounded-xl text-xs font-semibold transition disabled:opacity-50">Batal</button>
              <button type="button" onClick={() => void submit()} disabled={submitting || (!isEduCoinCheckout && !isGlobalGatewayCheckout && !proofFile) || (isEduCoinCheckout && eduCoinBalance != null && eduCoinBalance < checkoutTotal) || (selectedNeedsParticipant && !(Number(certificatePrice) > 0))} className="px-4 sm:px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-lg shadow-emerald-600/30 transition disabled:opacity-50">
                {submitting ? <Loader2 size={15} className="animate-spin"/> : null}
                Konfirmasi & Bayar Sekarang
              </button>
            </div>
          </div>}
        </div>
      </div>
    </div>}
  </div>;
}
