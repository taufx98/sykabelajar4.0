import { supabase } from '@/lib/supabase';

export interface CompetitionConfigInput {
  level: {
    code: string;
    label: string;
    allowed_grades: string[];
    points: number;
    registration_starts_at?: string;
    registration_ends_at?: string;
    starts_at?: string;
    ends_at?: string;
    announcement_at?: string;
    config?: Record<string, unknown>;
  };
  registration_rule: {
    allowed_grades: string[];
    require_twibbon: boolean;
    require_social_proof: boolean;
    express_enabled: boolean;
    express_cost: number;
    max_participants?: number | null;
    approval_mode: string;
    config?: Record<string, unknown>;
  };
  rewards: Array<{
    rank_code: string;
    title: string;
    points: number;
    emblem_name?: string | null;
    certificate_enabled: boolean;
    config?: Record<string, unknown>;
  }>;
}

export async function getCompetitionConfig(competitionId: string) {
  const [level, rule, rewards] = await Promise.all([
    supabase.from('competition_levels').select('*').eq('competition_id', competitionId).order('created_at').limit(1).maybeSingle(),
    supabase.from('registration_rules').select('*').eq('competition_id', competitionId).maybeSingle(),
    supabase.from('competition_rewards').select('*').eq('competition_id', competitionId).order('created_at'),
  ]);
  if (level.error) throw level.error;
  if (rule.error) throw rule.error;
  if (rewards.error) throw rewards.error;
  return { level: level.data, registrationRule: rule.data, rewards: rewards.data ?? [] };
}

export async function saveCompetitionConfig(competitionId: string, config: CompetitionConfigInput) {
  const { data, error } = await supabase.rpc('save_organizer_competition_config', {
    p_competition_id: competitionId,
    p_level: config.level,
    p_registration_rule: config.registration_rule,
    p_rewards: config.rewards,
  });
  if (error) throw error;
  return data;
}
