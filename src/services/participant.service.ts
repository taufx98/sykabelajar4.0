import { supabase } from '@/lib/supabase';

export type ParticipantCoreItem = {
  participant: {
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
  competition: {
    id: string;
    slug: string;
    title: string;
    status: string;
    poster_url: string | null;
  };
  registration: {
    id: string | null;
    status: string | null;
    submitted_at: string | null;
    approved_at: string | null;
    rejected_at: string | null;
  };
  latest_attempt: {
    id: string;
    status: string;
    attempt_number: number;
    started_at: string | null;
    expires_at: string | null;
    submitted_at: string | null;
    finalized_at: string | null;
    score: number;
  } | null;
  certificate_count: number;
};

/**
 * Canonical participant dashboard data for authenticated individual users.
 * The RPC is server-authoritative and does not expose the participants table directly.
 */
export async function listMyParticipantCore(): Promise<ParticipantCoreItem[]> {
  const { data, error } = await supabase.rpc('list_my_participant_core');
  if (error) throw error;
  return (data ?? []) as ParticipantCoreItem[];
}

/**
 * Fetch one canonical individual participant for a competition.
 */
export async function getMyParticipantCore(competitionId: string): Promise<ParticipantCoreItem['participant'] | null> {
  const { data, error } = await supabase.rpc('get_my_canonical_participant', {
    p_competition_id: competitionId,
  });
  if (error) throw error;
  return (data ?? null) as ParticipantCoreItem['participant'] | null;
}

export type ParticipantDashboardItem = {
  entry_id: string;
  participant_type: 'INDIVIDUAL' | 'COLLECTIVE';
  participant: {
    id: string | null;
    full_name: string;
    participant_type: 'INDIVIDUAL' | 'COLLECTIVE';
    participant_code: string | null;
    class_name: string | null;
    grade: string | null;
  } | null;
  competition: {
    id: string;
    slug: string;
    title: string;
    category: string;
    status: string;
    poster_url: string | null;
    registration_starts_at: string | null;
    registration_ends_at: string | null;
    starts_at: string | null;
    ends_at: string | null;
    announcement_at: string | null;
  };
  registration: {
    id: string;
    status: string;
    submitted_at: string | null;
    approved_at: string | null;
    rejected_at: string | null;
    rejection_reason: string | null;
  } | null;
  latest_attempt: {
    id: string;
    status: string;
    attempt_number: number;
    started_at: string | null;
    expires_at: string | null;
    submitted_at: string | null;
    finalized_at: string | null;
  } | null;
  result: {
    published: boolean;
    score: number | null;
    rank: number | null;
    finalized_at: string | null;
  };
  certificate_count: number;
  published_certificate_count: number;
};

/**
 * List only competitions registered by the signed-in user and collective
 * participant histories explicitly claimed by that same account.
 * Result scores and ranks are returned only after official publication.
 */
export async function listMyCompetitionDashboard(): Promise<ParticipantDashboardItem[]> {
  const { data, error } = await supabase.rpc('list_my_competition_dashboard');
  if (error) throw error;
  return (data ?? []) as ParticipantDashboardItem[];
}
