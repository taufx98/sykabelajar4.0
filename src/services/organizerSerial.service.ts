import { supabase } from '@/lib/supabase';

export type OrganizerSerialStatus = 'AVAILABLE' | 'ASSIGNED' | 'REVOKED' | string;

export interface OrganizerSerial {
  id: string;
  organizer_id: string;
  serial_code: string;
  qr_payload: string;
  status: OrganizerSerialStatus;
  certificate_id: string | null;
  assigned_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

const GENERATE_RPC_NAME = 'generate_organizer_serials';
const GENERATE_HEALTH_KEY = `__rpc_health:${GENERATE_RPC_NAME}`;

export async function listOrganizerSerials(organizerId: string, limit = 500) {
  const { data, error } = await supabase
    .from('organizer_serials')
    .select('id,organizer_id,serial_code,qr_payload,status,certificate_id,assigned_at,revoked_at,created_at')
    .eq('organizer_id', organizerId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as OrganizerSerial[];
}

async function getGenerateRpcHealth() {
  const { data, error } = await supabase
    .from('global_settings')
    .select('value')
    .eq('key', GENERATE_HEALTH_KEY)
    .maybeSingle();
  if (error) throw error;
  return (data?.value ?? null) as { status?: string; error_code?: string; error_message?: string } | null;
}

async function reportGenerateRpcFailure(error: unknown) {
  const rpcError = error as { code?: string; message?: string } | null;
  const errorCode = typeof rpcError?.code === 'string' ? rpcError.code : 'XX000';
  const errorMessage = error instanceof Error ? error.message : String(rpcError?.message ?? error ?? 'Unknown RPC error');

  try {
    await supabase.rpc('report_rpc_failure', {
      p_rpc_name: GENERATE_RPC_NAME,
      p_error_code: errorCode,
      p_error_message: errorMessage,
    });
  } catch {
    // Error reporting must never replace or hide the original RPC error.
  }
}

export async function generateOrganizerSerials(organizerId: string, quantity: number) {
  const health = await getGenerateRpcHealth();
  if (health?.status === 'BLOCKED') {
    const detail = health.error_message ? ` Detail: ${health.error_message}` : '';
    throw new Error(`Pembuatan QR / Serial sedang diblokir sementara karena RPC mengalami error.${detail}`);
  }

  const { data, error } = await supabase.rpc(GENERATE_RPC_NAME, {
    p_organizer_id: organizerId,
    p_quantity: quantity,
  });
  if (error) {
    await reportGenerateRpcFailure(error);
    if (error.code === '42702') {
      throw new Error('Pembuatan QR / Serial diblokir karena terjadi error pada sistem. Error telah dicatat ke Error Intelligence.');
    }
    throw error;
  }
  return (data ?? []) as Array<Pick<OrganizerSerial, 'id' | 'serial_code' | 'qr_payload' | 'status'>>;
}

export async function revokeOrganizerSerial(serialId: string) {
  const { data, error } = await supabase.rpc('revoke_organizer_serial', {
    p_serial_id: serialId,
  });
  if (error) throw error;
  return data as OrganizerSerial;
}

export async function assignOrganizerSerial(serialId: string, certificateId: string) {
  const { data, error } = await supabase.rpc('assign_organizer_serial', {
    p_serial_id: serialId,
    p_certificate_id: certificateId,
  });
  if (error) throw error;
  return data as OrganizerSerial;
}
