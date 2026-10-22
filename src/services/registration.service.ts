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
  eduCoinBypass?: boolean;
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

export async function submitRegistrationWithIntegrity(
  input: SubmitRegistrationInput & { integrityAgreed: boolean; eduCoinBypass?: boolean },
) {
  if (!input.integrityAgreed) throw new Error('INTEGRITY_AGREEMENT_REQUIRED');

  const bypass = Boolean(input.eduCoinBypass);
  const socialProofUrl = bypass ? null : input.socialProofUrl.trim() || null;
  const socialUsername = bypass ? null : input.socialUsername.trim().replace(/^@+/, '') || null;
  if (!bypass && (!socialProofUrl || !socialUsername)) {
    throw new Error('SOCIAL_PROOF_OR_COIN_REQUIRED');
  }

  const { data, error } = await supabase.rpc('register_for_competition_with_integrity_and_coin_bypass', {
    p_competition_id: input.competitionId,
    p_participation_key: input.participationKey ?? null,
    p_competition_level_id: input.competitionLevelId ?? null,
    p_social_proof_url: socialProofUrl,
    p_social_platform: bypass ? null : input.socialPlatform,
    p_social_username: socialUsername,
    p_referral_code: input.referralCode?.trim() || null,
    p_integrity_agreed: input.integrityAgreed,
    p_edu_coin_bypass: bypass,
  });
  if (error) throw error;
  if (!data) throw new Error('Pendaftaran gagal dibuat.');

  const payload = data as {
    registration?: any;
    edu_coin_balance?: number | null;
    edu_coin_spent?: number;
    edu_coin_bypass?: boolean;
  };
  return {
    record: payload.registration ?? data,
    created: true,
    eduCoinBalance: payload.edu_coin_balance ?? null,
    eduCoinSpent: Number(payload.edu_coin_spent ?? 0),
    eduCoinBypass: Boolean(payload.edu_coin_bypass ?? bypass),
  };
}

export async function submitRegistration(input: SubmitRegistrationInput) {
  const socialProofUrl = input.socialProofUrl.trim() || null;
  const socialUsername = input.socialUsername.trim().replace(/^@+/, '') || null;
  if (Boolean(socialProofUrl) !== Boolean(socialUsername)) {
    throw new Error('Isi username dan link postingan bersama-sama.');
  }

  const { data, error } = await supabase.rpc('register_for_competition', {
    p_competition_id: input.competitionId,
    p_participation_key: input.participationKey ?? null,
    p_competition_level_id: input.competitionLevelId ?? null,
    p_social_proof_url: socialProofUrl,
    p_twibbon_completed: Boolean(input.twibbonCompleted),
    p_social_platform: input.socialPlatform,
    p_social_username: socialUsername,
    p_referral_code: input.referralCode?.trim() || null,
  });
  if (error) throw error;
  if (!data) throw new Error('Pendaftaran gagal dibuat.');
  return { record: data, created: true };
}
