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

export async function generateOrganizerSerials(organizerId: string, quantity: number) {
  const { data, error } = await supabase.rpc('generate_organizer_serials', {
    p_organizer_id: organizerId,
    p_quantity: quantity,
  });
  if (error) throw error;
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
