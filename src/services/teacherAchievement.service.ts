import { supabase } from '@/lib/supabase';

export type TeacherAchievementRow = {
  collective_participant_id: string;
  canonical_participant_id: string;
  competition_id: string;
  competition_title: string;
  competition_status: string;
  student_name: string;
  class_name: string | null;
  grade: string | null;
  participant_code: string;
  participant_status: string;
  attempt_status: string | null;
  score: number | null;
  rank: number | null;
  finalized_at: string | null;
  certificate_status: string | null;
  certificate_serial_number: string | null;
  certificate_url: string | null;
  certificate_issued_at: string | null;
};

export async function listTeacherAchievementReport(input?: {
  competitionId?: string | null;
  search?: string;
}): Promise<TeacherAchievementRow[]> {
  const { data, error } = await supabase.rpc('list_teacher_achievement_report', {
    p_competition_id: input?.competitionId || null,
    p_search: input?.search?.trim() || null,
  });
  if (error) throw error;
  return (data ?? []) as TeacherAchievementRow[];
}
