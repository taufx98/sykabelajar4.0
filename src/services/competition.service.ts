import { supabase } from '@/lib/supabase';

export async function listPublicCompetitions(limit = 30) {
  const boundedLimit = Math.min(50, Math.max(1, Math.floor(limit)));
  const { data, error } = await supabase
    .from('competitions')
    .select('id,organizer_id,slug,title,short_description,description,category,status,registration_starts_at,registration_ends_at,starts_at,ends_at,announcement_at,poster_url,poster_public_id,poster_asset_meta,juknis_url,visibility,config,created_at,updated_at,poster_width,poster_height,poster_version,poster_resource_type,kisi_kisi_published,kisi_kisi_content,category_codes,excluded_category_codes,target_grades,excluded_grades,twibbon_mode,twibbon_frame_url,twibbon_frame_public_id,twibbon_external_url,participant_mode')
    .in('status', ['PUBLISHED', 'REGISTRATION_OPEN', 'LIVE', 'REGISTRATION_CLOSED', 'SUBMISSION_CLOSED', 'GRADING', 'RESULT_PUBLISHED', 'ARCHIVED'])
    .eq('visibility', 'PUBLIC')
    .order('created_at', { ascending: false })
    .limit(boundedLimit);
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

export type CanonicalParticipant = {
  id: string;
  competition_id: string;
  registration_id: string | null;
  user_id: string | null;
  collective_participant_id: string | null;
  participant_type: 'INDIVIDUAL' | 'COLLECTIVE';
  participant_code: string | null;
  full_name: string;
  class_name: string | null;
  grade: string | null;
  school_id: string | null;
  photo_url: string | null;
};

export async function getMyCanonicalParticipant(competitionId: string) {
  const { data, error } = await supabase.rpc('get_my_canonical_participant', { p_competition_id: competitionId });
  if (error) throw error;
  return data as CanonicalParticipant | null;
}

export type CompetitionAttempt = {
  id: string;
  competition_id: string;
  participant_id: string | null;
  canonical_participant_id: string | null;
  collective_participant_id: string | null;
  registration_id: string | null;
  attempt_number: number;
  status: string;
  started_at: string | null;
  expires_at: string | null;
  submitted_at: string | null;
  finalized_at: string | null;
  score: number;
};

export async function startCompetitionAttempt(competitionId: string) {
  const { data, error } = await supabase.rpc('start_competition_attempt', { p_competition_id: competitionId });
  if (error) throw error;
  return data as CompetitionAttempt;
}

export async function getMyCanonicalCompetitionResult(competitionId: string) {
  const { data, error } = await supabase.rpc('get_my_canonical_competition_result', { p_competition_id: competitionId });
  if (error) throw error;
  return data;
}
