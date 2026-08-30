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
  const { data, error } = await supabase.rpc('get_active_organizer_entitlements', { p_organizer_id: organizerId });
  if (error) throw error;
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  if (!rows.length) return null;

  // The RPC authoritatively selects the currently valid plan. Dates are fetched
  // separately only for display; entitlement access remains server-authoritative.
  const { data: plan, error: planError } = await supabase
    .from('organizer_plans')
    .select('plan_code,starts_at,ends_at,is_active')
    .eq('organizer_id', organizerId)
    .eq('plan_code', String(rows[0].plan_code))
    .eq('is_active', true)
    .lte('starts_at', new Date().toISOString())
    .order('starts_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (planError) throw planError;
  if (!plan) return null;

  return {
    planCode: String(plan.plan_code),
    startsAt: String(plan.starts_at),
    endsAt: plan.ends_at ? String(plan.ends_at) : null,
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
