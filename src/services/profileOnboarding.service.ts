import { supabase } from '@/lib/supabase';

export interface CompleteBetterAuthProfileInput {
  username: string;
  fullName: string;
  birthDate: string;
  institution: string;
  grade: string;
  subjects: string[];
}

/**
 * Initial profile completion for Better Auth identities.
 * The database function binds the write to auth.uid(), the Better Auth issuer,
 * a verified private identity, and a username that has not already been claimed.
 */
export async function completeBetterAuthProfile(input: CompleteBetterAuthProfileInput) {
  const { data, error } = await supabase.rpc('complete_better_auth_profile', {
    p_username: input.username.trim().toLowerCase(),
    p_full_name: input.fullName.trim(),
    p_birth_date: input.birthDate,
    p_institution: input.institution.trim(),
    p_grade: input.grade,
    p_subjects: input.subjects.join(','),
  });
  if (error) throw error;
  return data as { user_id: string; username: string; completed: boolean };
}
