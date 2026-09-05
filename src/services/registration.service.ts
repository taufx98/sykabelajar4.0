import { supabase } from '@/lib/supabase';

export interface SubmitRegistrationInput {
  competitionId: string;
  userId: string;
  socialPlatform: 'instagram' | 'tiktok';
  socialUsername: string;
  socialProofUrl: string;
  competitionLevelId?: string | null;
  participationKey?: string | null;
  twibbonCompleted?: boolean;
  referralCode?: string | null;
}

export async function checkRegistrationEligibility(competitionId: string, grade?: string | null) {
  const { data, error } = await supabase.rpc('check_registration_eligibility', {
    p_competition_id: competitionId,
    p_grade: grade ?? null,
  });
  if (error) throw error;
  return data as { eligible: boolean; reason?: string | null; allowed_grades?: string[] };
}

export async function submitRegistration(input: SubmitRegistrationInput) {
  const socialProofUrl = input.socialProofUrl.trim();
  if (!socialProofUrl) throw new Error('Link postingan wajib diisi.');
  if (!input.socialUsername.trim()) throw new Error('Username media sosial wajib diisi.');

  const { data, error } = await supabase.rpc('register_for_competition', {
    p_competition_id: input.competitionId,
    p_participation_key: input.participationKey ?? null,
    p_competition_level_id: input.competitionLevelId ?? null,
    p_social_proof_url: socialProofUrl,
    p_twibbon_completed: Boolean(input.twibbonCompleted),
    p_social_platform: input.socialPlatform,
    p_social_username: input.socialUsername.trim().replace(/^@+/, ''),
    p_referral_code: input.referralCode?.trim() || null,
  });
  if (error) throw error;
  if (!data) throw new Error('Pendaftaran gagal dibuat.');
  return { record: data, created: true };
}
