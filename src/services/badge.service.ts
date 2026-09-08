import { supabase } from '@/lib/supabase';

export type BadgeAwardType = 'MANUAL' | 'AUTOMATIC' | 'EVENT';
export type BadgeStatus = 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
export type BadgeRarity = 'Common' | 'Uncommon' | 'Rare' | 'Epic' | 'Legendary' | 'Special';
export type BadgeConditionField = 'competition_wins' | 'competitions_joined' | 'awards_count' | 'daily_checkin_streak' | 'total_xp' | 'edu_coin' | 'followers' | 'following' | 'grade';
export type BadgeConditionOperator = '>=' | '>' | '=' | '<=' | '<' | '!=';

export type BadgeCondition = {
  field: BadgeConditionField;
  operator: BadgeConditionOperator;
  value: string | number;
};

export type BadgeRuleConfig = { conditions: BadgeCondition[] };

export type Badge = {
  id: string;
  code: string;
  name: string;
  slug: string;
  description: string;
  icon_url: string | null;
  icon_emoji: string | null;
  category: string;
  rarity: BadgeRarity;
  status: BadgeStatus;
  award_type: BadgeAwardType;
  rule_config: BadgeRuleConfig;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type UserBadge = {
  id: string;
  user_id: string;
  badge_id: string;
  awarded_at: string;
  awarded_by: string | null;
  award_source: string;
  reason: string;
  source_reference: string | null;
  metadata: Record<string, unknown>;
};

const normaliseRule = (value: unknown): BadgeRuleConfig => {
  if (!value || typeof value !== 'object') return { conditions: [] };
  const conditions = Array.isArray((value as { conditions?: unknown }).conditions)
    ? (value as { conditions: BadgeCondition[] }).conditions
    : [];
  return { conditions };
};

const mapBadge = (value: unknown): Badge => {
  const row = value as Badge;
  return { ...row, rule_config: normaliseRule(row.rule_config) };
};

export async function listAdminBadges(): Promise<Badge[]> {
  const { data, error } = await supabase.from('badges').select('*').order('status').order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(mapBadge);
}

export async function saveBadge(input: Partial<Badge> & { name: string; code: string; slug: string; description: string; category: string; rarity: BadgeRarity; status: BadgeStatus; award_type: BadgeAwardType; rule_config: BadgeRuleConfig }) {
  const payload = {
    code: input.code.trim().toUpperCase(),
    name: input.name.trim(),
    slug: input.slug.trim().toLowerCase(),
    description: input.description.trim(),
    icon_url: input.icon_url?.trim() || null,
    icon_emoji: input.icon_emoji?.trim() || null,
    category: input.category.trim() || 'Khusus',
    rarity: input.rarity,
    status: input.status,
    award_type: input.award_type,
    rule_config: normaliseRule(input.rule_config),
    updated_at: new Date().toISOString(),
  };

  const request = input.id
    ? supabase.from('badges').update(payload).eq('id', input.id).select('*').single()
    : supabase.from('badges').insert(payload).select('*').single();
  const { data, error } = await request;
  if (error) throw error;
  return mapBadge(data);
}

export async function archiveBadge(id: string) {
  const { error } = await supabase.from('badges').update({ status: 'ARCHIVED', updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}

export async function awardBadge(userId: string, badgeId: string, reason: string, sourceReference?: string) {
  const { data, error } = await supabase.from('user_badges').insert({
    user_id: userId,
    badge_id: badgeId,
    award_source: 'MANUAL',
    reason: reason.trim(),
    source_reference: sourceReference?.trim() || null,
  }).select('*').single();
  if (error) throw error;
  return data as UserBadge;
}

export async function revokeBadge(userBadgeId: string, reason: string) {
  const { error } = await supabase.from('user_badges').delete().eq('id', userBadgeId);
  if (error) throw error;
  await supabase.from('badge_audit_logs').insert({ action: 'REVOKED', reason: reason.trim(), metadata: { user_badge_id: userBadgeId } });
}

export async function getBadgeOwners(badgeId: string, limit = 100) {
  const { data, error } = await supabase
    .from('user_badges')
    .select('id,user_id,badge_id,awarded_at,award_source,reason,source_reference,profiles:user_id(id,username,full_name,institution,avatar_url)')
    .eq('badge_id', badgeId)
    .order('awarded_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

export async function getBadgeCounts(badgeIds: string[]) {
  if (!badgeIds.length) return new Map<string, number>();
  const { data, error } = await supabase.from('user_badges').select('badge_id').in('badge_id', badgeIds);
  if (error) throw error;
  const counts = new Map<string, number>();
  for (const row of data ?? []) counts.set(String(row.badge_id), (counts.get(String(row.badge_id)) ?? 0) + 1);
  return counts;
}

export async function evaluateAutomaticBadges() {
  const { data, error } = await supabase.rpc('admin_evaluate_badges');
  if (error) throw error;
  return Number(data ?? 0);
}
