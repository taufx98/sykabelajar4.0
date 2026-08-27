import { supabase } from '@/lib/supabase';

export async function createMidtransPayment(orderId: string) {
  if (!orderId) throw new Error('Order ID wajib diisi.');
  const { data, error } = await supabase.functions.invoke('midtrans-create-payment', { body: { order_id: orderId } });
  if (error) throw error;
  if (!data?.ok) throw new Error(data?.error ?? 'Checkout Midtrans gagal.');
  return data as { ok: true; provider: 'MIDTRANS'; token?: string | null; redirect_url?: string | null };
}
