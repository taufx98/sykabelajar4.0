import { supabase } from '@/lib/supabase';

export async function listPublicCompetitions() {
  const { data, error } = await supabase
    .from('competitions')
    .select('*')
    .in('status', ['PUBLISHED', 'REGISTRATION_OPEN', 'LIVE', 'REGISTRATION_CLOSED', 'SUBMISSION_CLOSED', 'GRADING', 'RESULT_PUBLISHED', 'ARCHIVED'])
    .eq('visibility', 'PUBLIC')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function getCompetitionBySlug(slug: string) {
  const { data, error } = await supabase.from('competitions').select('*').eq('slug', slug).maybeSingle();
  if (error) throw error;
  return data;
}

export async function getCompetitionDetails(competitionId: string) {
  const [{ data: competition, error: competitionError }, { data: levels, error: levelError }, { data: rules, error: rulesError }, { data: rewards, error: rewardsError }, { data: twibbons, error: twibbonError }, { count: questionCount, error: questionError }] = await Promise.all([
    supabase.from('competitions').select('*').eq('id', competitionId).maybeSingle(),
    supabase.from('competition_levels').select('*').eq('competition_id', competitionId).order('created_at', { ascending: true }),
    supabase.from('registration_rules').select('*').eq('competition_id', competitionId).maybeSingle(),
    supabase.from('competition_rewards').select('*').eq('competition_id', competitionId).order('points', { ascending: false }),
    supabase.from('twibbon_templates').select('*').eq('competition_id', competitionId).eq('is_active', true).order('created_at', { ascending: false }),
    supabase.from('questions').select('id', { count: 'exact', head: true }).eq('competition_id', competitionId).eq('status', 'PUBLISHED'),
  ]);
  for (const error of [competitionError, levelError, rulesError, rewardsError, twibbonError, questionError]) if (error) throw error;
  if (!competition) return null;
  return { competition, levels: levels ?? [], rules: rules, rewards: rewards ?? [], twibbons: twibbons ?? [], questionCount: questionCount ?? 0 };
}

export async function getRegistrationsForCompetition(competitionId: string) {
  const { data, error } = await supabase.from('registrations').select('id,user_id,competition_level_id,status,submitted_at,approved_at,rejected_at,metadata').eq('competition_id', competitionId);
  if (error) throw error;
  return data ?? [];
}
