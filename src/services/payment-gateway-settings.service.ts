import { supabase } from '@/lib/supabase';

export type GatewayProviderCode = 'MIDTRANS' | 'XENITHPAY';
export type GatewayEnvironment = 'sandbox' | 'production';
export type ActivePaymentProvider = GatewayProviderCode | 'MANUAL';

export interface GatewayEnvironmentStatus {
  configured: boolean;
  serverKeyConfigured: boolean;
  clientKeyConfigured: boolean;
  apiKeyConfigured: boolean;
  apiSecretConfigured: boolean;
  webhookSecretConfigured: boolean;
  paymentMethod: string;
  paymentChannel: string;
  returnUrl: string;
}
export interface GatewayProviderStatus {
  provider: GatewayProviderCode;
  enabled: boolean;
  environment: GatewayEnvironment;
  environments: Record<GatewayEnvironment, GatewayEnvironmentStatus>;
}
export interface GlobalPaymentGatewaySettings {
  activeProvider: ActivePaymentProvider;
  automaticPaymentsEnabled: boolean;
  webhookUrl: string;
  providers: Record<GatewayProviderCode, GatewayProviderStatus>;
}
export interface GatewayEnvironmentInput {
  serverKey?: string;
  clientKey?: string;
  apiKey?: string;
  apiSecret?: string;
  webhookSecret?: string;
  paymentMethod?: string;
  paymentChannel?: string;
  returnUrl?: string;
  clearCredentials?: boolean;
}
export interface GatewayProviderInput {
  enabled: boolean;
  environment: GatewayEnvironment;
  environments: Record<GatewayEnvironment, GatewayEnvironmentInput>;
}
export interface SaveGlobalPaymentGatewayInput {
  activeProvider: ActivePaymentProvider;
  automaticPaymentsEnabled: boolean;
  providers: Record<GatewayProviderCode, GatewayProviderInput>;
}

async function invokeAdmin(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('payment-gateway-admin', { body });
  if (error) {
    const context = (error as { context?: Response }).context;
    if (context && typeof context.json === 'function') {
      try {
        const details = await context.clone().json();
        throw new Error(String(details?.message || details?.error || error.message || 'Permintaan pengaturan gateway gagal.'));
      } catch (parseError) {
        if (parseError instanceof Error && parseError.message !== error.message) throw parseError;
      }
    }
    throw error;
  }
  if (!data?.ok) throw new Error(String(data?.message || data?.error || 'Permintaan pengaturan gateway gagal.'));
  return data;
}

export async function getGlobalPaymentGatewaySettings(): Promise<GlobalPaymentGatewaySettings> {
  const data = await invokeAdmin({ action: 'get' });
  return data.settings as GlobalPaymentGatewaySettings;
}

export async function saveGlobalPaymentGatewaySettings(settings: SaveGlobalPaymentGatewayInput): Promise<GlobalPaymentGatewaySettings> {
  const data = await invokeAdmin({ action: 'save', settings });
  return data.settings as GlobalPaymentGatewaySettings;
}

export async function testGlobalPaymentGatewayConnection(
  provider: GatewayProviderCode,
  environment: GatewayEnvironment,
  providers: Record<GatewayProviderCode, GatewayProviderInput>,
): Promise<string> {
  const data = await invokeAdmin({ action: 'test', provider, environment, providers });
  return String(data.message || 'Koneksi berhasil diverifikasi.');
}
