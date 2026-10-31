import { supabase } from '@/lib/supabase';

export type CompetitionResultRow = {
  rank: number;
  full_name: string;
  participant_type: 'INDIVIDUAL' | 'COLLECTIVE' | string;
  participant_code: string | null;
  class_name: string | null;
  grade: string | null;
  school_name: string | null;
  score: number;
  finalized_at: string | null;
};

export type OrganizerCompetitionResultsOverview = {
  competition: {
    id: string;
    slug: string;
    title: string;
    category: string;
    status: string;
    visibility: string;
    announcement_at: string | null;
    poster_url: string | null;
  };
  readiness: {
    participant_count: number;
    result_count: number;
    pending_attempt_count: number;
    manual_pending_count: number;
    expired_attempt_count: number;
    legacy_active_count: number;
    missing_canonical_count: number;
    can_publish: boolean;
  };
  results: CompetitionResultRow[];
  result_limit: number;
  result_offset: number;
};

export type PublicCompetitionResults = {
  competition: {
    id: string;
    slug: string;
    title: string;
    category: string;
    status: string;
    poster_url: string | null;
    announcement_at: string | null;
    published_at: string | null;
  };
  result_count: number;
  results: CompetitionResultRow[];
  result_limit: number;
  result_offset: number;
};

export async function getOrganizerCompetitionResults(
  competitionId: string,
  offset = 0,
): Promise<OrganizerCompetitionResultsOverview> {
  const { data, error } = await supabase.rpc('get_organizer_competition_result_overview', {
    p_competition_id: competitionId,
    p_limit: 500,
    p_offset: Math.max(0, Math.floor(offset)),
  });
  if (error) throw error;
  return data as OrganizerCompetitionResultsOverview;
}

export async function startCompetitionGrading(competitionId: string) {
  const { data, error } = await supabase.rpc('transition_competition', {
    p_competition_id: competitionId,
    p_to_status: 'GRADING',
    p_reason: 'Organizer started official competition grading',
  });
  if (error) throw error;
  return data;
}

export async function publishCompetitionResults(competitionId: string) {
  const { data, error } = await supabase.rpc('publish_competition_results', {
    p_competition_id: competitionId,
  });
  if (error) throw error;
  return data as {
    competition_id: string;
    status: string;
    published: boolean;
    already_published: boolean;
    result_count?: number;
    published_at?: string;
  };
}

export async function getPublicCompetitionResults(
  slug: string,
  offset = 0,
): Promise<PublicCompetitionResults> {
  const { data, error } = await supabase.rpc('get_public_competition_results', {
    p_slug: slug,
    p_limit: 500,
    p_offset: Math.max(0, Math.floor(offset)),
  });
  if (error) throw error;
  return data as PublicCompetitionResults;
}
