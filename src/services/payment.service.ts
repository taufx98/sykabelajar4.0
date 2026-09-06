import { supabase } from '@/lib/supabase';

export type PaymentProviderCode='MIDTRANS'|'MANUAL';
export type PaymentRequest={orderId:string;provider?:PaymentProviderCode};
export type PaymentResult={ok:true;provider:PaymentProviderCode;token?:string|null;redirect_url?:string|null};

export interface PaymentProvider { readonly code:PaymentProviderCode; createPayment(orderId:string):Promise<PaymentResult>; }
const midtransProvider:PaymentProvider={code:'MIDTRANS',async createPayment(orderId){const{data,error}=await supabase.functions.invoke('midtrans-create-payment',{body:{order_id:orderId}});if(error)throw error;if(!data?.ok)throw new Error(data?.error??'Checkout Midtrans gagal.');return data as PaymentResult}};
const manualProvider:PaymentProvider={code:'MANUAL',async createPayment(){throw new Error('Provider MANUAL menggunakan alur bukti pembayaran/order review dan tidak membuat payment session otomatis.')}};
const providers:Record<PaymentProviderCode,PaymentProvider>={MIDTRANS:midtransProvider,MANUAL:manualProvider};
export function getPaymentProvider(provider:PaymentProviderCode='MIDTRANS'){return providers[provider]};
export async function createPayment({orderId,provider='MIDTRANS'}:PaymentRequest){if(!orderId)throw new Error('Order ID wajib diisi.');return getPaymentProvider(provider).createPayment(orderId)};
export async function createMidtransPayment(orderId:string){return createPayment({orderId,provider:'MIDTRANS'})}
