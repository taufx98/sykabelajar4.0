import { supabase } from '@/lib/supabase';

export interface OrganizerEntitlement {
  capability: string;
  limit_value: number | null;
  config: Record<string, unknown>;
}

export interface ActiveOrganizerPlan {
  planCode: string;
  startsAt: string;
  endsAt: string | null;
  isActive: boolean;
}

export async function getActiveOrganizerPlan(organizerId: string): Promise<ActiveOrganizerPlan | null> {
  const { data, error } = await supabase.rpc('get_organizer_effective_plan', {
    p_organizer_id: organizerId,
  });
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  if (!row) return null;

  return {
    planCode: String(row.plan_code),
    startsAt: String(row.starts_at),
    endsAt: row.ends_at ? String(row.ends_at) : null,
    isActive: true,
  };
}
export async function getActiveOrganizerEntitlements(organizerId: string): Promise<{
  planCode: string | null;
  entitlements: OrganizerEntitlement[];
  plan: ActiveOrganizerPlan | null;
}> {
  const { data, error } = await supabase.rpc('get_active_organizer_entitlements', { p_organizer_id: organizerId });
  if (error) throw error;
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  if (!rows.length) return { planCode: null, entitlements: [], plan: null };

  const planCode = String(rows[0].plan_code);
  const entitlements = rows.map((row) => ({
    capability: String(row.entitlement_capability ?? ''),
    limit_value: row.limit_value == null ? null : Number(row.limit_value),
    config: (row.config ?? {}) as Record<string, unknown>,
  }));

  const plan = await getActiveOrganizerPlan(organizerId);
  return { planCode, entitlements, plan };
}
