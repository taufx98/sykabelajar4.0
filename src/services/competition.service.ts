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


/**
 * Returns the nearest future public registration deadlines for the Home sidebar.
 * Keep this query intentionally narrow and order by deadline (not creation date),
 * so recently created competitions are not limited by the five-item Home snapshot.
 */
export async function listUpcomingPublicCompetitionDeadlines(limit = 3) {
  const boundedLimit = Math.min(10, Math.max(1, Math.floor(limit)));
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('competitions')
    .select('id,slug,title,status,registration_starts_at,registration_ends_at,starts_at,ends_at')
    .eq('visibility', 'PUBLIC')
    .in('status', ['PUBLISHED', 'REGISTRATION_OPEN'])
    .not('registration_ends_at', 'is', null)
    .gte('registration_ends_at', now)
    .order('registration_ends_at', { ascending: true })
    .limit(boundedLimit);
  if (error) throw error;
  return data ?? [];
}

export async function syncCompetitionRegistrationStatus(competitionId: string) {
  const { data, error } = await supabase.rpc('sync_competition_registration_status', {
    p_competition_id: competitionId,
  });
  if (error) throw error;
  return String(data ?? '');
}

export async function getCompetitionBySlug(slug: string) {
  const { data, error } = await supabase.from('competitions').select('*').eq('slug', slug).maybeSingle();
  if (error) throw error;
  if (!data) return null;

  // A visitor arriving during the configured opening window should not need
  // an organizer to manually change PUBLISHED to REGISTRATION_OPEN.
  if (['PUBLISHED', 'REGISTRATION_OPEN'].includes(String(data.status))) {
    await syncCompetitionRegistrationStatus(String(data.id));
    const { data: refreshed, error: refreshError } = await supabase
      .from('competitions')
      .select('*')
      .eq('id', data.id)
      .maybeSingle();
    if (refreshError) throw refreshError;
    return refreshed ?? data;
  }

  return data;
}

export async function getCompetitionDetails(competitionId: string) {
  const [
    { data: competition, error: competitionError },
    { data: levels, error: levelError },
    { data: rules, error: rulesError },
    { data: rewards, error: rewardsError },
    { data: twibbons, error: twibbonError },
    { data: summaryRows, error: summaryError },
  ] = await Promise.all([
    supabase.from('competitions').select('*').eq('id', competitionId).maybeSingle(),
    supabase.from('competition_levels').select('*').eq('competition_id', competitionId).order('created_at', { ascending: true }),
    supabase.from('registration_rules').select('*').eq('competition_id', competitionId).maybeSingle(),
    supabase.from('competition_rewards').select('*').eq('competition_id', competitionId).order('points', { ascending: false }),
    supabase.from('twibbon_templates').select('*').eq('competition_id', competitionId).eq('is_active', true).order('created_at', { ascending: false }),
    supabase.rpc('get_public_competition_detail_summary', { p_competition_id: competitionId }),
  ]);

  for (const error of [competitionError, levelError, rulesError, rewardsError, twibbonError, summaryError]) {
    if (error) throw error;
  }
  if (!competition) return null;

  const summary = Array.isArray(summaryRows) ? summaryRows[0] : summaryRows;
  const participantCount = Number(summary?.participant_count ?? 0);
  const questionCount = Number(summary?.question_count ?? 0);

  return {
    competition: {
      ...competition,
      participant_count: participantCount,
    },
    organizer: {
      name: String(summary?.organizer_name ?? 'Penyelenggara'),
      logoUrl: summary?.organizer_logo_url ? String(summary.organizer_logo_url) : null,
    },
    questionBank: summary?.question_bank_name
      ? {
          name: String(summary.question_bank_name),
          providerName: summary.question_provider_name ? String(summary.question_provider_name) : null,
        }
      : null,
    participantCount,
    levels: levels ?? [],
    rules,
    rewards: rewards ?? [],
    twibbons: twibbons ?? [],
    questionCount,
  };
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
