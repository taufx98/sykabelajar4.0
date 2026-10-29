import { supabase } from '@/lib/supabase';

export type PaymentProviderCode = 'MIDTRANS' | 'XENITHPAY' | 'MANUAL';
export type PaymentRequest = { orderId: string; provider?: PaymentProviderCode };
export type PaymentResult = {
  ok: true;
  provider: PaymentProviderCode;
  token?: string | null;
  redirect_url?: string | null;
  provider_reference?: string | null;
  payment_code?: string | null;
  payment_code_type?: string | null;
  expires_at?: string | null;
  details?: Record<string, unknown>;
  reused?: boolean;
};

export interface PaymentProvider {
  readonly code: PaymentProviderCode | 'GLOBAL';
  createPayment(orderId: string): Promise<PaymentResult>;
}

/**
 * Payment creation is routed by the server-side global setting.
 * The browser must not choose provider or send provider credentials.
 */
const globalGatewayProvider: PaymentProvider = {
  code: 'GLOBAL',
  async createPayment(orderId) {
    const { data, error } = await supabase.functions.invoke('payment-gateway-create', { body: { order_id: orderId } });
    if (error) {
      const context = (error as { context?: Response }).context;
      if (context && typeof context.json === 'function') {
        try {
          const details = await context.clone().json();
          throw new Error(String(details?.message || details?.error || error.message || 'Checkout pembayaran gagal.'));
        } catch (parseError) {
          if (parseError instanceof Error && parseError.message !== error.message) throw parseError;
        }
      }
      throw error;
    }
    if (!data?.ok) throw new Error(String(data?.message || data?.error || 'Checkout pembayaran gagal.'));
    return data as PaymentResult;
  },
};

const manualProvider: PaymentProvider = {
  code: 'MANUAL',
  async createPayment() {
    throw new Error('Provider MANUAL menggunakan alur transfer atau bukti pembayaran dan tidak membuat sesi otomatis.');
  },
};

export function getPaymentProvider(provider: PaymentProviderCode | 'GLOBAL' = 'GLOBAL') {
  if (provider === 'MANUAL') return manualProvider;
  // Legacy provider arguments are accepted for compatibility, but selection is global/server-side.
  return globalGatewayProvider;
}

export async function createPayment({ orderId }: PaymentRequest): Promise<PaymentResult> {
  if (!orderId) throw new Error('Order ID wajib diisi.');
  return globalGatewayProvider.createPayment(orderId);
}

/** Backward-compatible alias. Provider aktif tetap diputuskan oleh konfigurasi global server. */
export async function createMidtransPayment(orderId: string): Promise<PaymentResult> {
  return createPayment({ orderId });
}

/** Preferred name for any checkout flow that needs automatic payment. */
export async function createCheckoutPayment(orderId: string): Promise<PaymentResult> {
  return createPayment({ orderId });
}

export async function getPublicPaymentGatewayStatus() {
  const { data, error } = await supabase.functions.invoke('payment-gateway-public', { body: {} });
  if (error) throw error;
  if (!data?.ok) throw new Error(String(data?.message || data?.error || 'Status payment gateway gagal dimuat.'));
  return {
    activeProvider: String(data.activeProvider ?? 'MANUAL') as PaymentProviderCode,
    providerName: String(data.providerName ?? 'Manual / transfer rekening'),
    environment: String(data.environment ?? 'sandbox'),
    automaticPaymentsEnabled: Boolean(data.automaticPaymentsEnabled),
    checkoutEnabled: Boolean(data.checkoutEnabled),
  };
}


export type GatewayReturnReconciliation = {
  ok: true;
  status: string;
  order_id: string;
  verified?: boolean;
  already_paid?: boolean;
  reason?: string;
};

/**
 * Verifies a gateway return against the provider API on the server.
 * The browser return URL is never accepted as proof of payment.
 */
export async function reconcileGatewayPaymentReturn(
  orderId: string,
  transactionId?: string | null,
): Promise<GatewayReturnReconciliation> {
  if (!orderId) throw new Error('Order ID wajib diisi untuk verifikasi pembayaran.');
  const body: Record<string, string> = { order_id: orderId };
  if (transactionId) body.transaction_id = transactionId;

  const { data, error } = await supabase.functions.invoke('payment-gateway-reconcile', { body });
  if (error) {
    const context = (error as { context?: Response }).context;
    if (context && typeof context.json === 'function') {
      try {
        const details = await context.clone().json();
        throw new Error(String(details?.message || details?.error || error.message || 'Verifikasi pembayaran gagal.'));
      } catch (parseError) {
        if (parseError instanceof Error && parseError.message !== 'Unexpected end of JSON input') throw parseError;
      }
    }
    throw error;
  }
  if (!data?.ok) throw new Error(String(data?.message || data?.error || 'Verifikasi pembayaran belum berhasil.'));
  return data as GatewayReturnReconciliation;
}
